const fs = require('fs');
const path = require('path');
const { agentPreflight } = require('./environment-health');
const { decidePmmUsage, planTaskExecution } = require('./execution-loop');
const { ensureDir, readJsonSafe, writeJsonAtomic } = require('../shared/common');
const { createWorkspaceContext } = require('../shared/workspace-layout');
const { parseTaskTerms, termValues } = require('./task-terms');

const DEFAULT_RECALL_LIMIT = 8;
const DEFAULT_SCAN_LIMIT = 200;
const MIN_RECALL_SCORE = 3;
const GENERIC_RECALL_TERMS = new Set([
    'ani', 'animation', 'effect', 'http', 'https', 'handler', 'login', 'mj',
    '调用', '验证', '绑定', '登录', '后台', '前台', '前端', '后端', '链路',
]);

function toPosix(value = '') {
    return String(value || '').replace(/\\/g, '/');
}

function normalizeText(value = '') {
    return toPosix(value).toLowerCase();
}

function asArray(value) {
    if (Array.isArray(value)) {
        return value;
    }
    if (value == null || value === '') {
        return [];
    }
    return [value];
}

function uniq(values = []) {
    return Array.from(new Set(values.filter(Boolean)));
}

function uniqBy(items = [], keyFn) {
    const seen = new Set();
    const result = [];
    for (const item of items) {
        const key = keyFn(item);
        if (!key || seen.has(key)) {
            continue;
        }
        seen.add(key);
        result.push(item);
    }
    return result;
}

function clampInteger(value, fallback, max) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return Math.min(parsed, max);
}

function outcomePath(context) {
    return path.join(context.paths.stateDir, 'agent-outcomes', 'task-outcomes.jsonl');
}

function playbookPath(context) {
    return path.join(context.paths.stateDir, 'agent-playbook.json');
}

function splitFiles(values = []) {
    return uniq(asArray(values)
        .flatMap(value => String(value || '').split(/[\n,;]+/))
        .map(file => toPosix(file).trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean));
}

function readOutcomeRecords(context, options = {}) {
    const limit = clampInteger(options.scanLimit || options.limit, DEFAULT_SCAN_LIMIT, 1000);
    const filePath = outcomePath(context);
    if (!fs.existsSync(filePath)) {
        return [];
    }
    const lines = fs.readFileSync(filePath, 'utf8')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);
    return lines
        .map((line, index) => {
            try {
                return {
                    ...JSON.parse(line),
                    _line: index + 1,
                };
            } catch (error) {
                return {
                    kind: 'agent-task-outcome',
                    task: '',
                    outcome: '',
                    changedFiles: [],
                    validation: [],
                    observations: [`无法解析 outcome 第 ${index + 1} 行: ${error.message}`],
                    recordedAt: '',
                    _line: index + 1,
                    _invalid: true,
                };
            }
        })
        .reverse()
        .slice(0, limit);
}

function loadPlaybook(context) {
    return readJsonSafe(playbookPath(context), {
        required: false,
        defaultValue: {
            kind: 'agent-project-playbook',
            workspaceRoot: context.workspaceRoot,
            dataRoot: context.dataRoot,
            rules: [],
            updatedAt: null,
        },
    });
}

function recordSearchText(record = {}) {
    return normalizeText([
        record.task,
        record.outcome,
        ...(record.changedFiles || []),
        ...(record.validation || []),
        ...(record.observations || []),
    ].filter(Boolean).join(' '));
}

function recordStrongSearchText(record = {}) {
    return normalizeText([
        record.task,
        record.outcome,
        ...(record.changedFiles || []),
    ].filter(Boolean).join(' '));
}

function isStrongRecallTerm(term = {}) {
    const value = normalizeText(term.value || term);
    if (!value || GENERIC_RECALL_TERMS.has(value)) {
        return false;
    }
    if (term.source === 'cjk-ngram' || Number(term.weight || 0) <= 0.5) {
        return false;
    }
    if (/^[a-z0-9]+$/.test(value) && value.length <= 2) {
        return false;
    }
    return true;
}

function scoreRecord(record, queryTerms = [], queryFiles = []) {
    const text = recordSearchText(record);
    const strongText = recordStrongSearchText(record);
    const changedFiles = splitFiles(record.changedFiles || []);
    const reasons = [];
    let matchScore = 0;
    let strongMatchScore = 0;

    for (const input of queryTerms) {
        const term = typeof input === 'string' ? { value: normalizeText(input), weight: 1 } : input;
        const normalized = normalizeText(term?.value || '');
        if (!normalized) {
            continue;
        }
        if (normalizeText(record.task || '').includes(normalized)) {
            const contribution = 8 * (term.weight || 1);
            matchScore += contribution;
            if (isStrongRecallTerm(term)) {
                strongMatchScore += contribution;
            }
            reasons.push(`任务命中: ${normalized}`);
        } else if (text.includes(normalized)) {
            const contribution = (normalized.includes('/') ? 6 : 3) * (term.weight || 1);
            matchScore += contribution;
            if (isStrongRecallTerm(term) && strongText.includes(normalized)) {
                strongMatchScore += contribution;
            }
            reasons.push(`内容命中: ${normalized}`);
        }
    }

    for (const file of queryFiles) {
        const normalized = normalizeText(file);
        const root = normalized.split('/').slice(0, 3).join('/');
        for (const changed of changedFiles.map(normalizeText)) {
            if (changed === normalized || changed.endsWith(`/${normalized}`) || normalized.endsWith(`/${changed}`)) {
                matchScore += 12;
                strongMatchScore += 12;
                reasons.push(`文件精确命中: ${file}`);
            } else if (root && changed.includes(root)) {
                matchScore += 4;
                strongMatchScore += 4;
                reasons.push(`文件区域命中: ${root}`);
            }
        }
    }

    let score = matchScore;
    if (matchScore > 0 && recordedRecently(record.recordedAt)) {
        score += 0.25;
        reasons.push('最近任务 tie-break');
    }

    return {
        score,
        matchScore,
        strongMatchScore,
        reasons: uniq(reasons).slice(0, 8),
    };
}

function recordedRecently(value = '') {
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) {
        return false;
    }
    return Date.now() - timestamp < 1000 * 60 * 60 * 24 * 30;
}

function confidenceFromScore(score) {
    if (score >= 20) {
        return 'high';
    }
    if (score >= 8) {
        return 'medium';
    }
    return 'low';
}

function compactRecord(record, scoreInfo) {
    const hasRelevance = Number.isFinite(scoreInfo?.score);
    return {
        task: record.task || '',
        outcome: record.outcome || '',
        recordedAt: record.recordedAt || '',
        changedFiles: splitFiles(record.changedFiles || []).slice(0, 12),
        validation: asArray(record.validation || []).slice(0, 8),
        observations: asArray(record.observations || []).slice(0, 8),
        outcomeConfidence: record.confidence || 'unknown',
        relevanceConfidence: hasRelevance ? confidenceFromScore(scoreInfo.score) : null,
        relevanceScore: hasRelevance ? scoreInfo.score : null,
        reasons: scoreInfo?.reasons || [],
        sourceLine: record._line || null,
    };
}

function countValues(values = []) {
    const counts = new Map();
    for (const value of values.filter(Boolean)) {
        counts.set(value, (counts.get(value) || 0) + 1);
    }
    return Array.from(counts.entries())
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .map(([value, count]) => ({ value, count }));
}

function selectRelevantRules(playbook, terms = [], files = [], limit = 8) {
    const normalizedTerms = termValues(terms).map(normalizeText);
    const normalizedFiles = files.map(normalizeText);
    return (playbook.rules || [])
        .map(rule => {
            const text = normalizeText([
                rule.title,
                rule.body,
                rule.category,
                ...(rule.tags || []),
                ...(rule.files || []),
            ].filter(Boolean).join(' '));
            let score = 0;
            for (const term of normalizedTerms) {
                if (term && text.includes(term)) {
                    score += term.includes('/') ? 6 : 3;
                }
            }
            for (const file of normalizedFiles) {
                if (file && text.includes(file)) {
                    score += 8;
                }
            }
            return { rule, score };
        })
        .filter(item => item.score > 0)
        .sort((left, right) => right.score - left.score || String(left.rule.title || '').localeCompare(String(right.rule.title || '')))
        .slice(0, limit)
        .map(item => ({
            ...item.rule,
            relevanceScore: item.score,
        }));
}

function recallTaskMemory(options = {}) {
    const context = createWorkspaceContext({
        workspaceRoot: options.workspaceRoot,
        dataRoot: options.dataRoot,
        layout: options.layout,
    });
    const task = String(options.task || options.query || '').trim();
    const knownFiles = splitFiles([options.knownFiles, options.files, options.file, options.changedFiles, options.changedFile]);
    const limit = clampInteger(options.limit, DEFAULT_RECALL_LIMIT, 50);
    const queryTerms = parseTaskTerms(task, knownFiles).terms;
    const records = readOutcomeRecords(context, options);
    const recalledTasks = records
        .map(record => ({ record, scoreInfo: scoreRecord(record, queryTerms, knownFiles) }))
        .filter(item => item.scoreInfo.matchScore >= MIN_RECALL_SCORE && item.scoreInfo.strongMatchScore >= MIN_RECALL_SCORE)
        .sort((left, right) => right.scoreInfo.score - left.scoreInfo.score || String(right.record.recordedAt || '').localeCompare(String(left.record.recordedAt || '')))
        .slice(0, limit)
        .map(item => compactRecord(item.record, item.scoreInfo));
    const relatedFiles = countValues(recalledTasks.flatMap(record => record.changedFiles)).slice(0, 16);
    const validationCommands = countValues(recalledTasks.flatMap(record => record.validation)).slice(0, 12);
    const observations = uniq(recalledTasks.flatMap(record => record.observations)).slice(0, 16);
    const playbook = loadPlaybook(context);
    const relevantRules = selectRelevantRules(playbook, queryTerms, knownFiles, 8);

    return {
        kind: 'agent-memory-recall',
        workspaceRoot: context.workspaceRoot,
        dataRoot: context.dataRoot,
        task,
        queryTerms: termValues(queryTerms),
        knownFiles,
        totalOutcomeRecords: records.filter(record => !record._invalid).length,
        recalledTasks,
        relatedFiles,
        validationCommands,
        observations,
        relevantRules,
        evidence: [
            ...recalledTasks.slice(0, 8).map(record => ({
                kind: 'task-outcome',
                confidence: record.relevanceConfidence,
                reason: record.reasons.join('; '),
                task: record.task,
                recordedAt: record.recordedAt,
                files: record.changedFiles,
            })),
            ...relevantRules.slice(0, 5).map(rule => ({
                kind: 'playbook-rule',
                confidence: rule.relevanceScore >= 10 ? 'high' : 'medium',
                reason: rule.title || rule.body || '',
                category: rule.category || '',
            })),
        ],
    };
}

function ruleInputList(options = {}) {
    const explicit = asArray(options.rules || options.rule)
        .flatMap(value => String(value || '').split(/[\n;]+/))
        .map(value => value.trim())
        .filter(Boolean);
    if (explicit.length) {
        return explicit.map(rule => ({
            title: rule.length > 48 ? `${rule.slice(0, 48)}...` : rule,
            body: rule,
            category: options.category || 'manual',
            tags: termValues(parseTaskTerms(rule).terms).slice(0, 8),
            files: splitFiles(options.changedFiles || options.knownFiles || options.files || options.file),
            source: options.source || 'manual',
        }));
    }
    return inferRulesFromOutcome(options);
}

function inferRulesFromOutcome(options = {}) {
    const taskText = normalizeText([options.task, options.outcome, options.summary, ...(asArray(options.observations || options.notes))].join(' '));
    const files = splitFiles(options.changedFiles || options.knownFiles || options.files || options.file);
    const rules = [];
    const add = (title, body, category, tags = []) => {
        rules.push({
            title,
            body,
            category,
            tags,
            files,
            source: 'inferred',
        });
    };
    if (/facebook|oauth|graph/.test(taskText) || files.some(file => /facebook\/oauth/i.test(file))) {
        add('Facebook OAuth 变更复核 callback/status/authorize', '涉及 Facebook OAuth 时，优先同时检查 authorize、callback、status 相关 route，并复核 token 保存、错误处理和外部服务返回。', 'oauth', ['facebook', 'oauth', 'token']);
    }
    if (/token|auth|session|jwt|secret|encrypt|decrypt/.test(taskText) || files.some(file => /auth|token|session/i.test(file))) {
        add('鉴权和 token 变更需要安全边界复核', '涉及 auth、session、token、JWT 或加密逻辑时，必须复核凭据边界、过期处理、错误路径和日志泄漏风险。', 'security', ['auth', 'token', 'security']);
    }
    if (/prisma|database|schema|db/.test(taskText) || files.some(file => /prisma|schema\.prisma|db/i.test(file))) {
        add('数据模型变更需要迁移和回滚验证', '涉及 Prisma 或数据库读写时，确认 schema、迁移、数据兼容和回滚路径，并运行最小数据库相关验证。', 'data', ['prisma', 'database']);
    }
    if (files.some(file => /(?:^|\/)app\/api\//i.test(file))) {
        add('API route 变更需要前后端链路验证', '修改 API route 后，应复核前端 request、route handler、服务层、数据表和外部服务链路是否仍匹配。', 'api', ['api', 'fullstack']);
    }
    return rules;
}

function normalizeRule(rule = {}, context, options = {}) {
    const body = String(rule.body || rule.text || rule.title || '').trim();
    const title = String(rule.title || body.slice(0, 48) || '项目规则').trim();
    return {
        id: normalizeText(`${rule.category || options.category || 'general'}:${title}:${body}`)
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 96),
        title,
        body,
        category: String(rule.category || options.category || 'general').trim(),
        tags: uniq(asArray(rule.tags || options.tags).flatMap(item => String(item || '').split(/[\s,;]+/)).map(normalizeText)).slice(0, 12),
        files: splitFiles(rule.files || options.changedFiles || options.knownFiles || options.files || options.file).slice(0, 16),
        source: rule.source || options.source || 'manual',
        updatedAt: new Date().toISOString(),
    };
}

function updateProjectPlaybook(options = {}) {
    const context = createWorkspaceContext({
        workspaceRoot: options.workspaceRoot,
        dataRoot: options.dataRoot,
        layout: options.layout,
    });
    const current = loadPlaybook(context);
    const incoming = ruleInputList(options)
        .map(rule => normalizeRule(rule, context, options))
        .filter(rule => rule.body);
    if (!incoming.length) {
        throw new Error('update_project_playbook 需要 rule/rules，或可推断规则的 task/outcome/changedFiles');
    }
    const merged = new Map();
    for (const rule of current.rules || []) {
        merged.set(rule.id || normalizeRule(rule, context, options).id, rule);
    }
    for (const rule of incoming) {
        const old = merged.get(rule.id);
        merged.set(rule.id, {
            ...(old || {}),
            ...rule,
            hitCount: (old?.hitCount || 0) + 1,
            createdAt: old?.createdAt || new Date().toISOString(),
        });
    }
    const playbook = {
        kind: 'agent-project-playbook',
        workspaceRoot: context.workspaceRoot,
        dataRoot: context.dataRoot,
        updatedAt: new Date().toISOString(),
        rules: Array.from(merged.values())
            .sort((left, right) => String(left.category || '').localeCompare(String(right.category || '')) || String(left.title || '').localeCompare(String(right.title || ''))),
    };
    ensureDir(path.dirname(playbookPath(context)));
    writeJsonAtomic(playbookPath(context), playbook);
    return {
        kind: 'agent-project-playbook-update',
        workspaceRoot: context.workspaceRoot,
        dataRoot: context.dataRoot,
        outputPath: playbookPath(context),
        addedOrUpdated: incoming,
        ruleCount: playbook.rules.length,
        playbook,
    };
}

function summarizeProjectMemory(options = {}) {
    const context = createWorkspaceContext({
        workspaceRoot: options.workspaceRoot,
        dataRoot: options.dataRoot,
        layout: options.layout,
    });
    const limit = clampInteger(options.limit, 10, 50);
    const records = readOutcomeRecords(context, { scanLimit: options.scanLimit || 500 });
    const playbook = loadPlaybook(context);
    const validRecords = records.filter(record => !record._invalid);
    return {
        kind: 'agent-project-memory-summary',
        workspaceRoot: context.workspaceRoot,
        dataRoot: context.dataRoot,
        outcomePath: outcomePath(context),
        playbookPath: playbookPath(context),
        outcomeCount: validRecords.length,
        latestOutcomes: validRecords.slice(0, limit).map(record => compactRecord(record, { score: null, reasons: ['最近任务记录'] })),
        frequentFiles: countValues(validRecords.flatMap(record => splitFiles(record.changedFiles || []))).slice(0, 20),
        frequentValidationCommands: countValues(validRecords.flatMap(record => asArray(record.validation || []))).slice(0, 12),
        playbook: {
            updatedAt: playbook.updatedAt || null,
            ruleCount: (playbook.rules || []).length,
            rules: (playbook.rules || []).slice(0, limit),
        },
    };
}

/**
 * 生成 Agent 执行 brief，并在返回旧 PMM 上下文前执行 preflight 门禁。
 *
 * @param {object} options brief 输入参数。
 * @returns {object} Agent brief 稳定返回结构。
 */
function prepareAgentBrief(options = {}) {
    const task = String(options.task || options.query || '').trim();
    const preflight = agentPreflight(options);
    const pmmGate = decidePmmUsage(options);
    const memory = recallTaskMemory({ ...options, task });
    if (preflight.status === 'blocked') {
        return {
            kind: 'agent-brief',
            workspaceRoot: memory.workspaceRoot,
            dataRoot: memory.dataRoot,
            task,
            preflight,
            pmmGate,
            executionPlan: {
                contextStatus: 'preflight-blocked',
                targetFiles: [],
                editBoundary: {
                    primaryFiles: [],
                    relatedRoots: [],
                    guidance: [
                        'Agent Preflight 处于 blocked 状态，先执行 preflight.nextAction。',
                        '阻断解除前不得使用旧 project-global KB 作为可用上下文。',
                    ],
                },
                steps: [
                    {
                        step: '修复 preflight 阻断',
                        action: '先执行 preflight.nextAction，再重新生成 agent brief。',
                        evidence: preflight.findings.slice(0, 8),
                    },
                ],
                validation: {
                    recommendedCommands: [],
                },
                uncertainties: preflight.findings.map(finding => finding.message || finding.code),
            },
            memory,
            recommendedFiles: [],
            validation: {
                recommendedCommands: [],
            },
            risksAndNotes: [
                'Agent Preflight blocked，已禁止返回看似可用的旧 PMM 上下文。',
                ...preflight.findings.map(finding => finding.message || finding.code),
            ],
            nextActions: [preflight.nextAction],
            evidence: [
                ...(memory.evidence || []).slice(0, 12),
            ],
        };
    }

    const executionPlan = planTaskExecution(options);
    const recommendedFiles = uniq([
        ...(executionPlan.targetFiles || []),
        ...memory.relatedFiles.map(item => item.value),
    ]).slice(0, 20);
    const validationCommands = uniq([
        ...((executionPlan.validation && executionPlan.validation.recommendedCommands) || []),
        ...memory.validationCommands.map(item => item.value),
    ]).slice(0, 16);
    const risksAndNotes = uniq([
        ...((executionPlan.uncertainties || [])),
        ...memory.observations,
        ...memory.relevantRules.map(rule => rule.body || rule.title).filter(Boolean),
    ]).slice(0, 20);

    return {
        kind: 'agent-brief',
        workspaceRoot: memory.workspaceRoot,
        dataRoot: memory.dataRoot,
        task,
        preflight,
        pmmGate,
        executionPlan: {
            contextStatus: executionPlan.contextStatus,
            targetFiles: executionPlan.targetFiles,
            editBoundary: executionPlan.editBoundary,
            steps: executionPlan.steps,
            validation: executionPlan.validation,
            uncertainties: executionPlan.uncertainties,
        },
        memory,
        recommendedFiles,
        validation: {
            recommendedCommands: validationCommands,
        },
        risksAndNotes,
        nextActions: [
            pmmGate.deepPmmRequired ? '先依据 executionPlan.targetFiles 和 PMM evidence 精读源码。' : '按 Usage Gate 限定在明确文件范围内修改。',
            memory.recalledTasks.length ? '复用 recalledTasks 中的历史验证命令和风险观察。' : '当前没有命中的历史任务，完成后调用 record_task_outcome 沉淀记忆。',
            '提交前运行 validate_edit_scope 或 review_patch_for_agent。',
        ],
        evidence: [
            ...(executionPlan.evidence || []).slice(0, 12),
            ...(memory.evidence || []).slice(0, 12),
        ],
    };
}

module.exports = {
    loadPlaybook,
    prepareAgentBrief,
    recallTaskMemory,
    readOutcomeRecords,
    summarizeProjectMemory,
    updateProjectPlaybook,
};
