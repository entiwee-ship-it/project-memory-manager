const fs = require('fs');
const path = require('path');
const { analyzeChangeImpact, parseChangedFiles, prepareTaskContext } = require('./context-pack');
const { ensureDir } = require('../shared/common');
const { createWorkspaceContext } = require('../shared/workspace-layout');

const UI_FILE_PATTERN = /\.(vue|tsx|jsx|css|scss|less|html)$/i;
const SOURCE_FILE_PATTERN = /\.(ts|tsx|js|jsx|vue|css|scss|less|html|prisma)$/i;
const BROAD_ROOTS = new Set(['app', 'src', 'lib', 'components', 'server', 'cms-client', 'cms-server', 'frontend', 'backend']);

function toPosix(value = '') {
    return String(value || '').replace(/\\/g, '/');
}

function normalizeText(value = '') {
    return toPosix(value).toLowerCase();
}

function uniq(values = []) {
    return Array.from(new Set(values.filter(Boolean)));
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

function collectInputFiles(options = {}) {
    return uniq([
        ...asArray(options.knownFiles),
        ...asArray(options.files),
        ...asArray(options.file),
        ...parseChangedFiles(options),
    ].flatMap(value => String(value || '').split(/[\n,;]+/))
        .map(file => toPosix(file).trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean));
}

function collectKnownFiles(options = {}) {
    return uniq([
        ...asArray(options.knownFiles),
        ...asArray(options.files),
        ...asArray(options.file),
    ].flatMap(value => String(value || '').split(/[\n,;]+/))
        .map(file => toPosix(file).trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean));
}

function collectChangedInputFiles(options = {}) {
    return parseChangedFiles(options);
}

function matchSignals(text, files = []) {
    const combined = normalizeText([text, ...files].join(' '));
    const signals = [];
    const add = (key, label, pattern) => {
        if (pattern.test(combined)) {
            signals.push({ key, label, confidence: 'high' });
        }
    };
    add('api', '涉及 API、HTTP route 或前后端接口', /(?:^|[\s/])api(?:[\s/]|$)|endpoint|route\.ts|接口|后端|http|request/);
    add('data', '涉及数据库、Prisma model 或表读写', /prisma|schema\.prisma|database|db|sql|table|model|数据表|数据库|读写/);
    add('auth', '涉及鉴权、会话、token 或加密', /auth|login|logout|register|oauth|session|token|secret|encrypt|decrypt|登录|鉴权|授权|密钥/);
    add('external-service', '涉及外部服务依赖', /facebook|graph|anthropic|claude|stripe|openai|external-service|第三方|外部服务/);
    add('commerce', '涉及商城、交易、订单或活动链路', /mall|shop|gift|activity|campaign|order|payment|transaction|商城|交易|订单|支付|活动|赠送/);
    add('cross-module', '可能跨模块或跨端改动', /跨模块|跨端|前后端|全链路|完整链路|联动|影响面|调用链/);
    return signals;
}

function fileRoots(files = []) {
    return uniq(files.map(file => normalizeText(file).split('/').filter(Boolean)[0] || '').filter(Boolean));
}

function classifyFiles(files = []) {
    const roots = fileRoots(files);
    const sourceFiles = files.filter(file => SOURCE_FILE_PATTERN.test(file));
    const uiFiles = files.filter(file => UI_FILE_PATTERN.test(file));
    const apiFiles = files.filter(file => /(?:^|\/)app\/api\/|route\.(ts|js)$|(?:^|\/)api\//i.test(file));
    const dataFiles = files.filter(file => /(?:^|\/)prisma\/|schema\.prisma|(?:^|\/)db\//i.test(file));
    const broadRootCount = roots.filter(root => BROAD_ROOTS.has(root)).length;
    return {
        roots,
        sourceFiles,
        uiFiles,
        apiFiles,
        dataFiles,
        allUiSource: sourceFiles.length > 0 && sourceFiles.every(file => UI_FILE_PATTERN.test(file)),
        crossRoot: roots.length > 1 && broadRootCount > 1,
    };
}

function confidenceFromGate(decision, riskSignals = []) {
    if (decision === 'required' || riskSignals.length >= 2) {
        return 'high';
    }
    if (decision === 'recommended') {
        return 'medium';
    }
    return 'medium';
}

function chooseRecommendedTool({ decision, files, hasDiff, featureKey }) {
    if (featureKey) {
        return 'explain_feature_for_agent';
    }
    if (hasDiff || files.length > 0) {
        if (decision === 'optional_skip_allowed') {
            return 'validate_edit_scope';
        }
        return 'analyze_change_impact';
    }
    return 'prepare_task_context';
}

function buildGateEvidence({ task, files, riskSignals, decision, fileInfo }) {
    return [
        {
            kind: 'usage-gate',
            confidence: confidenceFromGate(decision, riskSignals),
            reason: `任务词和文件范围触发 PMM 使用决策: ${decision}`,
            task: task || '',
            files,
            riskSignals: riskSignals.map(item => item.key),
        },
        ...files.slice(0, 12).map(file => ({
            kind: 'file',
            file,
            confidence: fileInfo.apiFiles.includes(file) || fileInfo.dataFiles.includes(file) ? 'high' : 'medium',
            reason: '输入文件参与 PMM 使用门禁判断',
        })),
    ];
}

function decidePmmUsage(options = {}) {
    const task = String(options.task || options.query || '').trim();
    const files = collectInputFiles(options);
    const fileInfo = classifyFiles(files);
    const riskSignals = matchSignals(task, files);
    const hasDiff = Boolean(String(options.diff || options.diffFile || '').trim());
    const hasChangedFiles = files.length > 0 || hasDiff;
    const hasRisk = riskSignals.length > 0 || fileInfo.apiFiles.length > 0 || fileInfo.dataFiles.length > 0;
    const isSmallScopedUi = hasChangedFiles
        && files.length > 0
        && files.length <= 4
        && fileInfo.allUiSource
        && !fileInfo.apiFiles.length
        && !fileInfo.dataFiles.length
        && !riskSignals.some(signal => ['api', 'data', 'auth', 'external-service', 'cross-module'].includes(signal.key));

    let decision = 'recommended';
    const reasons = [];
    const skipConditions = [];

    if (!task && !hasChangedFiles) {
        decision = 'required';
        reasons.push('未提供任务或文件范围，需要先用 PMM 定位项目上下文。');
    } else if (isSmallScopedUi) {
        decision = 'optional_skip_allowed';
        reasons.push('输入是少量明确 UI 源文件，允许跳过深度链路查询，但必须留下 PMM 使用门禁证据。');
        skipConditions.push('只修改列出的 UI 文件。');
        skipConditions.push('不新增 API、数据表、auth、外部服务或跨模块调用。');
        skipConditions.push('提交前至少运行 validate_edit_scope 或等价 changed files 复核。');
    } else if (hasRisk || fileInfo.crossRoot || !hasChangedFiles) {
        decision = 'required';
        reasons.push('任务或文件范围包含 API、数据、鉴权、外部服务、交易/活动或跨模块风险信号。');
    } else {
        decision = 'recommended';
        reasons.push('任务有一定源码范围，但风险信号不强；建议使用 PMM 准备上下文，避免漏掉相关调用链。');
    }

    const recommendedTool = chooseRecommendedTool({
        decision,
        files,
        hasDiff,
        featureKey: options.featureKey || options.feature,
    });
    const pmmRequired = decision === 'required';
    const deepPmmRequired = decision !== 'optional_skip_allowed';
    const nextActions = [];
    if (decision === 'optional_skip_allowed') {
        nextActions.push(`可先围绕 ${files.join(', ')} 修改，但回答中必须说明已通过 decide_pmm_usage 门禁。`);
        nextActions.push('改完后运行 validate_edit_scope 或 analyze_change_impact 复核影响范围。');
    } else {
        nextActions.push(`先调用 ${recommendedTool} 获取 PMM 证据，再进入源码修改。`);
    }
    if (decision === 'required' && !hasChangedFiles) {
        nextActions.push('如果任务仍然模糊，先用 prepare_task_context 自动匹配 feature、endpoint、method、table 和 external-service。');
    }

    return {
        kind: 'agent-pmm-usage-decision',
        task,
        files,
        decision,
        pmmRequired,
        deepPmmRequired,
        recommendedTool,
        reasons,
        riskSignals,
        skipConditions,
        nextActions,
        evidence: buildGateEvidence({ task, files, riskSignals, decision, fileInfo }),
    };
}

function runOptionalContext(options = {}) {
    try {
        return prepareTaskContext(options);
    } catch (error) {
        return {
            unavailable: true,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

function runOptionalImpact(options = {}) {
    try {
        return analyzeChangeImpact(options);
    } catch (error) {
        return {
            unavailable: true,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

function planTaskExecution(options = {}) {
    const gate = decidePmmUsage(options);
    const context = gate.deepPmmRequired
        ? runOptionalContext({ ...options, task: gate.task })
        : null;
    const targetFiles = context && !context.unavailable
        ? context.criticalFiles.slice(0, 12)
        : gate.files.slice(0, 12);
    const validationCommands = context && !context.unavailable
        ? context.validation.recommendedCommands || []
        : ['运行项目已有的最小相关测试或构建命令。'];
    const editBoundary = context && !context.unavailable
        ? context.editBoundary
        : {
            primaryFiles: gate.files,
            relatedRoots: [],
            guidance: gate.skipConditions,
        };

    return {
        kind: 'agent-task-execution-plan',
        task: gate.task,
        pmmGate: gate,
        contextStatus: context?.unavailable ? 'context-unavailable' : (context ? 'context-ready' : 'gate-only'),
        targetFiles,
        editBoundary,
        steps: [
            {
                step: '确认范围',
                action: gate.deepPmmRequired ? '依据 PMM 上下文确认 feature、入口、表和外部服务。' : '依据 Usage Gate 只处理明确 UI 文件。',
                evidence: gate.evidence.slice(0, 3),
            },
            {
                step: '最小实现',
                action: '优先修改 targetFiles / primaryFiles；任何新增文件或跨根目录扩展都先重新跑 validate_edit_scope。',
            },
            {
                step: '局部验证',
                action: '运行推荐验证命令；如果命令不可用，记录不可用原因并执行等价最小验证。',
            },
            {
                step: '提交前复核',
                action: '运行 analyze_change_impact 或 review_patch_for_agent 检查影响面、风险和缺失测试。',
            },
        ],
        validation: {
            recommendedCommands: validationCommands,
        },
        uncertainties: [
            ...(context?.uncertainties || []),
            ...(context?.unavailable ? [`无法读取 PMM 上下文: ${context.error}`] : []),
        ],
        evidence: [
            ...gate.evidence,
            ...((context && !context.unavailable) ? context.evidence.slice(0, 8) : []),
        ],
    };
}

function pathIsWithinBoundary(file, boundary = {}) {
    const normalized = normalizeText(file);
    const primary = (boundary.primaryFiles || []).map(normalizeText);
    const roots = (boundary.relatedRoots || []).map(value => normalizeText(value).replace(/\/+$/, '')).filter(Boolean);
    return primary.some(item => normalized === item || normalized.endsWith(`/${item}`) || item.endsWith(`/${normalized}`))
        || roots.some(root => normalized === root || normalized.startsWith(`${root}/`));
}

function validateEditScope(options = {}) {
    const gate = decidePmmUsage(options);
    const knownFiles = collectKnownFiles(options);
    const actualChangedFiles = collectChangedInputFiles(options);
    const changedFiles = actualChangedFiles.length
        ? actualChangedFiles
        : (knownFiles.length ? knownFiles : collectInputFiles(options));
    const context = gate.deepPmmRequired
        ? runOptionalContext({ ...options, task: gate.task })
        : null;
    const impact = changedFiles.length ? runOptionalImpact(options) : null;
    const boundary = context && !context.unavailable
        ? context.editBoundary
        : { primaryFiles: knownFiles.length ? knownFiles : gate.files, relatedRoots: [] };
    const outOfScopeFiles = changedFiles.filter(file => !pathIsWithinBoundary(file, boundary));
    const hardRiskKeys = new Set(['api', 'data', 'auth', 'external-service', 'cross-module']);
    const riskyFiles = changedFiles.filter(file => {
        const signalKeys = matchSignals('', [file]).map(signal => signal.key);
        return signalKeys.some(key => hardRiskKeys.has(key))
            || (gate.decision !== 'optional_skip_allowed' && signalKeys.includes('commerce'));
    });
    const missingExpectedFiles = context && !context.unavailable
        ? (context.criticalFiles || [])
            .filter(file => /(?:api|route|prisma|lib\/api-client|settings|chat)/i.test(file))
            .filter(file => !changedFiles.some(changed => normalizeText(changed) === normalizeText(file)))
            .slice(0, 8)
        : [];
    let verdict = 'within_scope';
    if (context?.unavailable && gate.deepPmmRequired) {
        verdict = 'pmm_context_unavailable';
    } else if (outOfScopeFiles.length > 0 || riskyFiles.length > 0) {
        verdict = 'scope_review_needed';
    } else if (missingExpectedFiles.length > 0 && gate.deepPmmRequired) {
        verdict = 'possibly_incomplete';
    }

    return {
        kind: 'agent-edit-scope-validation',
        task: gate.task,
        changedFiles,
        verdict,
        pmmGate: gate,
        outOfScopeFiles,
        riskyFiles,
        missingExpectedFiles,
        impactSummary: impact?.unavailable ? { unavailable: true, error: impact.error } : (impact ? {
            affectedFeatures: impact.affectedFeatures,
            affectedEntrypoints: impact.affectedEntrypoints,
            affectedData: impact.affectedData,
            affectedExternalServices: impact.affectedExternalServices,
            risk: impact.risk,
            validation: impact.validation,
        } : null),
        requiredFollowUp: buildScopeFollowUp({ verdict, outOfScopeFiles, riskyFiles, missingExpectedFiles }),
        evidence: [
            ...gate.evidence,
            ...((impact && !impact.unavailable) ? impact.evidence.slice(0, 8) : []),
        ],
    };
}

function buildScopeFollowUp({ verdict, outOfScopeFiles, riskyFiles, missingExpectedFiles }) {
    if (verdict === 'within_scope') {
        return ['当前 changed files 与 PMM 建议边界一致，继续执行推荐验证。'];
    }
    const followUp = [];
    if (outOfScopeFiles.length) {
        followUp.push(`复核越界文件: ${outOfScopeFiles.join(', ')}`);
    }
    if (riskyFiles.length) {
        followUp.push(`复核高风险文件: ${riskyFiles.join(', ')}`);
    }
    if (missingExpectedFiles.length) {
        followUp.push(`确认是否漏改关键文件: ${missingExpectedFiles.join(', ')}`);
    }
    return followUp;
}

function reviewPatchForAgent(options = {}) {
    const scope = validateEditScope(options);
    const findings = [];
    if (scope.verdict !== 'within_scope') {
        findings.push({
            severity: scope.verdict === 'pmm_context_unavailable' ? 'high' : 'medium',
            title: '改动范围需要复核',
            detail: scope.requiredFollowUp.join(' '),
        });
    }
    const impactRisk = scope.impactSummary?.risk?.level || 'unknown';
    if (impactRisk === 'high') {
        findings.push({
            severity: 'high',
            title: '高风险链路变更',
            detail: '影响面包含 auth/token/external-service/Prisma 写入等高风险信号，需要重点验证调用链和错误处理。',
        });
    }
    if (scope.impactSummary?.validation?.rebuildFeatureKb) {
        findings.push({
            severity: 'low',
            title: '需要重建 KB',
            detail: 'changed files 影响 feature KB，提交后建议重建相关 feature KB。',
        });
    }
    return {
        kind: 'agent-patch-review',
        task: scope.task,
        verdict: findings.some(item => item.severity === 'high') ? 'changes_requested' : 'review_ready',
        scope,
        findings,
        reviewChecklist: [
            '前端 request 与后端 endpoint 是否仍匹配。',
            'Prisma/table 写入是否有验证或回滚路径。',
            'external-service 错误处理和凭据边界是否保留。',
            '是否运行了 PMM 推荐验证命令或记录了不可用原因。',
        ],
        evidence: scope.evidence,
    };
}

function recordTaskOutcome(options = {}) {
    const context = createWorkspaceContext({
        workspaceRoot: options.workspaceRoot,
        dataRoot: options.dataRoot,
        layout: options.layout,
    });
    const changedFiles = collectChangedInputFiles(options);
    const record = {
        kind: 'agent-task-outcome',
        recordedAt: new Date().toISOString(),
        task: String(options.task || options.query || '').trim(),
        outcome: String(options.outcome || options.summary || '').trim(),
        changedFiles: changedFiles.length ? changedFiles : collectInputFiles(options),
        validation: asArray(options.validation || options.validationCommands),
        observations: asArray(options.observations || options.notes),
        confidence: options.confidence || 'medium',
    };
    if (!record.task) {
        throw new Error('record_task_outcome 需要 task');
    }
    if (!record.outcome) {
        throw new Error('record_task_outcome 需要 outcome 或 summary');
    }
    const outputDir = path.join(context.paths.stateDir, 'agent-outcomes');
    ensureDir(outputDir);
    const outputPath = path.join(outputDir, 'task-outcomes.jsonl');
    fs.appendFileSync(outputPath, `${JSON.stringify(record)}\n`, 'utf8');
    return {
        kind: 'agent-task-outcome-record',
        workspaceRoot: context.workspaceRoot,
        dataRoot: context.dataRoot,
        outputPath,
        record,
    };
}

module.exports = {
    decidePmmUsage,
    planTaskExecution,
    recordTaskOutcome,
    reviewPatchForAgent,
    validateEditScope,
};
