const DETAIL_COMPACT = 'compact';
const DETAIL_FULL = 'full';
const OUTPUT_DETAILS = new Set([DETAIL_COMPACT, DETAIL_FULL]);
const DEFAULT_COMPACT_BUDGET = 8000;
const TOOL_OUTPUT_BUDGETS = {
    recall_task_memory: 6000,
    summarize_project_memory: 6000,
};

function cloneJson(value) {
    if (value == null) {
        return value;
    }
    return JSON.parse(JSON.stringify(value));
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

function truncateText(value, maxLength = 240) {
    const text = String(value == null ? '' : value);
    if (text.length <= maxLength) {
        return text;
    }
    return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function truncateStrings(value, maxLength = 240) {
    if (typeof value === 'string') {
        return truncateText(value, maxLength);
    }
    if (Array.isArray(value)) {
        return value.map(item => truncateStrings(item, maxLength));
    }
    if (!value || typeof value !== 'object') {
        return value;
    }
    const result = {};
    for (const [key, item] of Object.entries(value)) {
        result[key] = truncateStrings(item, maxLength);
    }
    return result;
}

function collectShrinkableArrays(value, arrays = []) {
    if (Array.isArray(value)) {
        arrays.push(value);
        for (const item of value) {
            collectShrinkableArrays(item, arrays);
        }
        return arrays;
    }
    if (!value || typeof value !== 'object') {
        return arrays;
    }
    for (const item of Object.values(value)) {
        collectShrinkableArrays(item, arrays);
    }
    return arrays;
}

function serializedLength(value) {
    return JSON.stringify(value, null, 2).length;
}

function enforceCompactBudget(payload, budget = DEFAULT_COMPACT_BUDGET) {
    let result = truncateStrings(payload, 240);
    result._output = {
        ...(result._output || {}),
        detail: DETAIL_COMPACT,
        budgetChars: budget,
    };
    let truncated = false;
    let attempts = 0;
    while (serializedLength(result) > budget && attempts < 100) {
        const arrays = collectShrinkableArrays(result)
            .filter(items => items.length > 1)
            .sort((left, right) => serializedLength(right) - serializedLength(left));
        if (!arrays.length) {
            break;
        }
        arrays[0].splice(Math.ceil(arrays[0].length / 2));
        truncated = true;
        attempts += 1;
    }
    if (serializedLength(result) > budget) {
        result = truncateStrings(result, 120);
        truncated = true;
    }
    if (serializedLength(result) > budget) {
        result = truncateStrings(result, 64);
        truncated = true;
    }
    result._output = {
        ...(result._output || {}),
        detail: DETAIL_COMPACT,
        budgetChars: budget,
        truncated,
    };
    return result;
}

function normalizeDetail(value = '') {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'debug' || normalized === 'raw' || normalized === 'verbose') {
        return DETAIL_FULL;
    }
    if (normalized === 'summary' || normalized === 'short' || normalized === 'minimal') {
        return DETAIL_COMPACT;
    }
    return OUTPUT_DETAILS.has(normalized) ? normalized : '';
}

function resolveOutputDetail(options = {}, fallback = DETAIL_COMPACT) {
    if (options.full === true) {
        return DETAIL_FULL;
    }
    if (options.compact === true) {
        return DETAIL_COMPACT;
    }
    return normalizeDetail(options.detail || options.verbosity || options.outputDetail) || fallback;
}

function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function boolOrDefault(object, key, fallback) {
    return hasOwn(object, key) ? Boolean(object[key]) : fallback;
}

function inferFreshnessStale(value = {}) {
    if (hasOwn(value, 'stale')) {
        return Boolean(value.stale);
    }
    const status = String(value.status || '').toLowerCase();
    return ['missing', 'stale', 'unknown', 'blocked', 'error'].includes(status);
}

function comparablePath(value = '') {
    return String(value || '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '').toLowerCase();
}

function isExternalDataRootFile(filePath = '', dataRoot = '') {
    const normalizedFile = comparablePath(filePath);
    const normalizedRoot = comparablePath(dataRoot);
    if (!normalizedFile || !normalizedRoot) {
        return false;
    }
    return normalizedFile === normalizedRoot || normalizedFile.startsWith(`${normalizedRoot}/`);
}

function isAbsoluteLikePath(filePath = '') {
    const normalized = comparablePath(filePath);
    return /^[a-z]:\//.test(normalized) || normalized.startsWith('/');
}

function isInsidePath(filePath = '', rootPath = '') {
    const normalizedFile = comparablePath(filePath);
    const normalizedRoot = comparablePath(rootPath);
    if (!normalizedFile || !normalizedRoot) {
        return false;
    }
    return normalizedFile === normalizedRoot || normalizedFile.startsWith(`${normalizedRoot}/`);
}

function isSourceCandidate(filePath = '', dataRoot = '', workspaceRoot = '') {
    if (isExternalDataRootFile(filePath, dataRoot)) {
        return false;
    }
    if (isAbsoluteLikePath(filePath) && workspaceRoot) {
        return isInsidePath(filePath, workspaceRoot);
    }
    return true;
}

function filterSourceFiles(files = [], dataRoot = '', workspaceRoot = '') {
    return asArray(files).filter(file => isSourceCandidate(file, dataRoot, workspaceRoot));
}

function itemValue(item) {
    if (typeof item === 'string') {
        return item;
    }
    if (!item || typeof item !== 'object') {
        return '';
    }
    return item.value || item.command || item.file || item.path || '';
}

function containsInternalPmmPath(value = '', dataRoot = '') {
    const normalized = comparablePath(value);
    const normalizedRoot = comparablePath(dataRoot);
    return Boolean(
        (normalizedRoot && normalized.includes(normalizedRoot))
        || normalized.includes('/.agents/skills/project-memory-manager')
        || normalized.includes('/.codex/plugins/')
    );
}

function filterFileItems(items = [], dataRoot = '', workspaceRoot = '') {
    return asArray(items).filter(item => {
        const candidate = itemValue(item);
        return !candidate || isSourceCandidate(candidate, dataRoot, workspaceRoot);
    });
}

function filterValidationCommands(commands = [], dataRoot = '') {
    return asArray(commands).filter(command => !containsInternalPmmPath(itemValue(command), dataRoot));
}

function compactNode(node = {}, dataRoot = '', workspaceRoot = '') {
    if (!node || typeof node !== 'object') {
        return node || null;
    }
    const result = {};
    for (const key of ['id', 'type', 'name', 'line', 'area']) {
        if (node[key] !== undefined && node[key] !== '') {
            result[key] = node[key];
        }
    }
    if (node.file && isSourceCandidate(node.file, dataRoot, workspaceRoot)) {
        result.file = node.file;
    }
    const meta = node.meta || {};
    const protocolFields = {
        httpMethod: node.httpMethod || meta.method,
        httpPath: node.httpPath || meta.path,
        route: node.route || meta.route,
        protocol: node.routeProtocol || node.requestProtocol || node.messageProtocol || meta.protocol,
        transport: node.requestTransport || meta.transport,
        target: node.target || meta.target,
    };
    for (const [key, value] of Object.entries(protocolFields)) {
        if (value !== undefined && value !== '') {
            result[key] = value;
        }
    }
    return result;
}

function compactEdgeEndpoint(value, dataRoot = '', workspaceRoot = '') {
    if (!value) {
        return null;
    }
    if (typeof value === 'object') {
        return compactNode(value, dataRoot, workspaceRoot);
    }
    return { id: value };
}

function compactEdge(edge = {}, dataRoot = '', workspaceRoot = '') {
    return {
        type: edge.type || '',
        sourceKind: edge.sourceKind || '',
        from: compactEdgeEndpoint(edge.from, dataRoot, workspaceRoot),
        to: compactEdgeEndpoint(edge.to, dataRoot, workspaceRoot),
    };
}

function compactTraversalItem(item = {}, dataRoot = '', workspaceRoot = '') {
    const edge = item.edge || item;
    const node = compactNode(item.node || {}, dataRoot, workspaceRoot);
    const direction = item.direction || '';
    const knownSide = node && Object.keys(node).length ? node : null;
    const from = direction === 'upstream'
        ? knownSide
        : compactEdgeEndpoint(edge.from, dataRoot, workspaceRoot);
    const to = direction === 'upstream'
        ? compactEdgeEndpoint(edge.to, dataRoot, workspaceRoot)
        : knownSide;
    return {
        direction,
        depth: item.depth ?? null,
        type: edge.type || item.type || '',
        sourceKind: edge.sourceKind || item.sourceKind || '',
        from,
        to,
    };
}

function compactFeature(feature = {}) {
    const result = {};
    for (const key of ['featureKey', 'featureName', 'summary', 'confidence', 'kbDir']) {
        if (feature[key] !== undefined && feature[key] !== '') {
            result[key] = feature[key];
        }
    }
    return result;
}

function compactTable(table = {}, dataRoot = '', workspaceRoot = '') {
    return {
        ...compactNode(table, dataRoot, workspaceRoot),
        reads: asArray(table.reads).slice(0, 4).map(item => ({
            method: item.method || item.name || '',
            file: isSourceCandidate(item.file, dataRoot, workspaceRoot) ? item.file : '',
            line: item.line ?? null,
        })),
        writes: asArray(table.writes).slice(0, 4).map(item => ({
            method: item.method || item.name || '',
            file: isSourceCandidate(item.file, dataRoot, workspaceRoot) ? item.file : '',
            line: item.line ?? null,
        })),
    };
}

function compactCountedItem(item = {}) {
    if (typeof item === 'string') {
        return item;
    }
    return {
        value: item.value || item.file || item.command || '',
        count: item.count ?? null,
    };
}

function compactVersionInfo(value) {
    if (!value || typeof value !== 'object') {
        return null;
    }
    const result = {};
    for (const key of ['name', 'version', 'repo']) {
        if (value[key]) {
            result[key] = value[key];
        }
    }
    return Object.keys(result).length ? result : null;
}

function compactFreshness(value) {
    if (!value || typeof value !== 'object') {
        return value || null;
    }
    const stale = inferFreshnessStale(value);
    const result = {
        kind: value.kind || 'kb-freshness',
        status: value.status || '',
        stale,
        querySafe: boolOrDefault(value, 'querySafe', !stale),
        sourceFallbackAllowed: boolOrDefault(value, 'sourceFallbackAllowed', !stale),
        mustRefreshBeforeQuery: boolOrDefault(value, 'mustRefreshBeforeQuery', stale),
        mustRefreshBeforeSourceFallback: boolOrDefault(value, 'mustRefreshBeforeSourceFallback', stale),
        reasonCodes: asArray(value.reasonCodes).slice(0, 8),
        reasons: asArray(value.reasons).slice(0, 6),
        recommendedAction: value.recommendedAction || '',
        changeCounts: value.changeCounts || {
            added: asArray(value.addedFiles).length,
            deleted: asArray(value.deletedFiles).length,
            changed: asArray(value.changedFiles).length,
            mtimeOnly: asArray(value.mtimeOnlyFiles).length,
        },
    };
    if (value.sourceSnapshot) {
        result.sourceSnapshot = {
            generatedAt: value.sourceSnapshot.generatedAt || null,
            fileCount: value.sourceSnapshot.fileCount ?? null,
            strategy: value.sourceSnapshot.strategy || '',
        };
    }
    if (value.currentSnapshot) {
        result.currentSnapshot = {
            fileCount: value.currentSnapshot.fileCount ?? null,
        };
    }
    const builtWithSkill = compactVersionInfo(value.builtWithSkill);
    if (builtWithSkill) {
        result.builtWithSkill = builtWithSkill;
    }
    const currentSkill = compactVersionInfo(value.currentSkill);
    if (currentSkill) {
        result.currentSkill = currentSkill;
    }
    return result;
}

function compactFreshnessMeta(meta) {
    if (!meta || typeof meta !== 'object') {
        return meta || null;
    }
    const result = {};
    for (const key of ['scope', 'policy', 'initialStatus', 'finalStatus', 'rebuilt', 'blocked', 'error']) {
        if (meta[key] !== undefined && meta[key] !== '') {
            result[key] = meta[key];
        }
    }
    if (meta.initial) {
        result.initial = compactFreshness(meta.initial);
    }
    if (meta.final) {
        result.final = compactFreshness(meta.final);
    }
    return result;
}

function healthCheckCounts(checks = []) {
    const counts = { ok: 0, warn: 0, fail: 0, total: checks.length };
    for (const check of checks) {
        if (check.status === 'ok') {
            counts.ok += 1;
        } else if (check.status === 'fail') {
            counts.fail += 1;
        } else {
            counts.warn += 1;
        }
    }
    return counts;
}

function compactCheckDetails(details = {}) {
    if (!details || typeof details !== 'object') {
        return {};
    }
    const result = {};
    for (const key of [
        'version',
        'runtimeVersion',
        'actualVersion',
        'sourceVersion',
        'installedVersion',
        'workspaceRoot',
        'dataRoot',
        'workspaceId',
        'workspaceHash',
        'matchCount',
        'missingTools',
        'reason',
    ]) {
        if (details[key] !== undefined && details[key] !== '') {
            result[key] = details[key];
        }
    }
    if (details.kbFreshness) {
        result.kbFreshness = compactFreshness(details.kbFreshness);
    }
    return result;
}

function compactCheck(check = {}) {
    const result = {
        code: check.code || '',
        status: check.status || 'warn',
        message: check.message || '',
    };
    const details = compactCheckDetails(check.details || {});
    if (Object.keys(details).length) {
        result.details = details;
    }
    return result;
}

function compactFinding(finding = {}) {
    const result = {};
    for (const key of ['code', 'severity', 'message', 'summary', 'status', 'expected', 'actual', 'actualVersion']) {
        if (finding[key] !== undefined && finding[key] !== '') {
            result[key] = finding[key];
        }
    }
    if (finding.reasonCodes) {
        result.reasonCodes = asArray(finding.reasonCodes).slice(0, 8);
    }
    if (finding.missingTools) {
        result.missingTools = asArray(finding.missingTools).slice(0, 12);
    }
    return result;
}

function compactRepair(repair = {}) {
    const result = {};
    for (const key of ['id', 'action', 'reason', 'command']) {
        if (repair[key]) {
            result[key] = repair[key];
        }
    }
    return result;
}

function summarizePreflight(preflight = {}) {
    const checks = asArray(preflight.health?.checks);
    const issues = checks.filter(check => check.status !== 'ok').map(compactCheck);
    return {
        kind: 'agent-preflight-summary',
        status: preflight.status || '',
        health: {
            score: preflight.health?.score ?? null,
            checkCounts: healthCheckCounts(checks),
            checks: issues,
        },
        findings: asArray(preflight.findings).map(compactFinding).slice(0, 8),
        repairPlan: asArray(preflight.repairPlan).map(compactRepair).slice(0, 6),
        nextAction: preflight.nextAction || null,
    };
}

function compactAgentPreflight(preflight = {}) {
    const summary = summarizePreflight(preflight);
    const result = {
        kind: preflight.kind || 'agent-preflight',
        status: preflight.status || '',
        workspaceRoot: preflight.workspaceRoot || '',
        dataRoot: preflight.dataRoot || '',
        workspaceId: preflight.workspaceId || '',
        workspaceHash: preflight.workspaceHash || '',
        health: summary.health,
        findings: summary.findings,
        repairPlan: summary.repairPlan,
        nextAction: preflight.nextAction || null,
        _output: {
            detail: DETAIL_COMPACT,
            fullDetail: 'Pass detail=full to include complete diagnostics.',
        },
    };
    if (asArray(preflight.diagnostics).length) {
        result.diagnostics = asArray(preflight.diagnostics).slice(0, 8);
    }
    return result;
}

function compactEvidence(evidence = [], limit = 8, dataRoot = '', workspaceRoot = '') {
    return asArray(evidence).slice(0, limit).map(item => {
        const result = {};
        for (const key of ['kind', 'confidence', 'reason', 'file', 'method', 'endpoint', 'nodeId', 'edgeType', 'task', 'recordedAt', 'category']) {
            if (item && item[key] !== undefined && item[key] !== '') {
                if (key === 'file' && !isSourceCandidate(item[key], dataRoot, workspaceRoot)) {
                    continue;
                }
                result[key] = item[key];
            }
        }
        if (item?.files) {
            result.files = filterSourceFiles(item.files, dataRoot, workspaceRoot).slice(0, 8);
        }
        return result;
    });
}

function compactMemory(memory = {}, dataRoot = '', workspaceRoot = '') {
    return {
        kind: memory.kind || 'agent-memory-recall',
        task: memory.task || '',
        queryTerms: asArray(memory.queryTerms).slice(0, 12),
        knownFiles: filterSourceFiles(memory.knownFiles, dataRoot, workspaceRoot).slice(0, 12),
        totalOutcomeRecords: memory.totalOutcomeRecords || 0,
        recalledTasks: asArray(memory.recalledTasks).slice(0, 4).map(record => ({
            task: record.task || '',
            outcome: record.outcome || '',
            recordedAt: record.recordedAt || '',
            changedFiles: filterSourceFiles(record.changedFiles, dataRoot, workspaceRoot).slice(0, 8),
            validation: filterValidationCommands(record.validation, dataRoot).slice(0, 5),
            observations: asArray(record.observations).slice(0, 5),
            outcomeConfidence: record.outcomeConfidence || 'unknown',
            relevanceConfidence: record.relevanceConfidence || null,
            relevanceScore: record.relevanceScore ?? null,
            reasons: asArray(record.reasons).slice(0, 4),
        })),
        relatedFiles: filterFileItems(memory.relatedFiles, dataRoot, workspaceRoot).slice(0, 10),
        validationCommands: filterValidationCommands(memory.validationCommands, dataRoot).slice(0, 8),
        observations: asArray(memory.observations).slice(0, 8),
        relevantRules: asArray(memory.relevantRules).slice(0, 5),
    };
}

function compactPmmGate(gate = {}) {
    return {
        kind: gate.kind || 'agent-pmm-usage-decision',
        decision: gate.decision || '',
        pmmRequired: Boolean(gate.pmmRequired),
        deepPmmRequired: Boolean(gate.deepPmmRequired),
        recommendedTool: gate.recommendedTool || '',
        reasons: asArray(gate.reasons).slice(0, 6),
        riskSignals: asArray(gate.riskSignals).slice(0, 8),
        skipConditions: asArray(gate.skipConditions).slice(0, 6),
        nextActions: asArray(gate.nextActions).slice(0, 6),
    };
}

function compactExecutionPlan(plan = {}, dataRoot = '', workspaceRoot = '') {
    return {
        contextStatus: plan.contextStatus || '',
        targetFiles: filterSourceFiles(plan.targetFiles, dataRoot, workspaceRoot).slice(0, 16),
        editBoundary: {
            primaryFiles: filterSourceFiles(plan.editBoundary?.primaryFiles, dataRoot, workspaceRoot).slice(0, 16),
            relatedRoots: asArray(plan.editBoundary?.relatedRoots).slice(0, 8),
            guidance: asArray(plan.editBoundary?.guidance).slice(0, 6),
        },
        steps: asArray(plan.steps).slice(0, 5).map(step => ({
            step: step.step || '',
            action: step.action || '',
            evidence: compactEvidence(step.evidence || [], 4, dataRoot, workspaceRoot),
        })),
        validation: {
            recommendedCommands: filterValidationCommands(plan.validation?.recommendedCommands, dataRoot).slice(0, 8),
        },
        uncertainties: asArray(plan.uncertainties).slice(0, 8),
    };
}

function compactAgentBrief(brief = {}) {
    const dataRoot = brief.dataRoot || '';
    const workspaceRoot = brief.workspaceRoot || '';
    return {
        kind: brief.kind || 'agent-brief',
        workspaceRoot,
        dataRoot,
        task: brief.task || '',
        preflightSummary: summarizePreflight(brief.preflight || {}),
        pmmGate: compactPmmGate(brief.pmmGate || {}),
        executionPlan: compactExecutionPlan(brief.executionPlan || {}, dataRoot, workspaceRoot),
        memory: compactMemory(brief.memory || {}, dataRoot, workspaceRoot),
        recommendedFiles: filterSourceFiles(brief.recommendedFiles, dataRoot, workspaceRoot).slice(0, 16),
        validation: {
            recommendedCommands: filterValidationCommands(brief.validation?.recommendedCommands, dataRoot).slice(0, 10),
        },
        risksAndNotes: asArray(brief.risksAndNotes).slice(0, 12),
        nextActions: asArray(brief.nextActions).slice(0, 8),
        evidence: compactEvidence(brief.evidence || [], 10, dataRoot, workspaceRoot),
        _output: {
            detail: DETAIL_COMPACT,
            fullDetail: 'Pass detail=full to include complete preflight and memory diagnostics.',
        },
    };
}

function compactTaskContext(context = {}) {
    const dataRoot = context.dataRoot || '';
    const workspaceRoot = context.workspaceRoot || '';
    return {
        kind: context.kind || 'agent-task-context',
        workspaceRoot,
        dataRoot,
        task: context.task || '',
        taskUnderstanding: {
            rawTask: context.taskUnderstanding?.rawTask || context.task || '',
            extractedTerms: asArray(context.taskUnderstanding?.extractedTerms).slice(0, 16),
            inferredFeatures: asArray(context.taskUnderstanding?.inferredFeatures).slice(0, 8),
            inferredEntrypoints: asArray(context.taskUnderstanding?.inferredEntrypoints).slice(0, 8),
        },
        relevantFeatures: asArray(context.relevantFeatures).slice(0, 6).map(compactFeature),
        keyEntrypoints: {
            endpoints: asArray(context.keyEntrypoints?.endpoints).slice(0, 6).map(node => compactNode(node, dataRoot, workspaceRoot)),
            requests: asArray(context.keyEntrypoints?.requests).slice(0, 6).map(node => compactNode(node, dataRoot, workspaceRoot)),
            methods: asArray(context.keyEntrypoints?.methods).slice(0, 8).map(node => compactNode(node, dataRoot, workspaceRoot)),
        },
        criticalFiles: filterSourceFiles(context.criticalFiles, dataRoot, workspaceRoot).slice(0, 12),
        callChains: asArray(context.callChains).slice(0, 3).map(chain => ({
            start: compactNode(chain.start || {}, dataRoot, workspaceRoot),
            nodes: asArray(chain.nodes).slice(0, 8).map(node => compactNode(node, dataRoot, workspaceRoot)),
            edges: asArray(chain.edges).slice(0, 8).map(edge => compactEdge(edge, dataRoot, workspaceRoot)),
        })),
        dataAccess: {
            tables: asArray(context.dataAccess?.tables).slice(0, 8).map(table => compactTable(table, dataRoot, workspaceRoot)),
        },
        externalServices: asArray(context.externalServices).slice(0, 6).map(node => compactNode(node, dataRoot, workspaceRoot)),
        editBoundary: {
            primaryFiles: filterSourceFiles(context.editBoundary?.primaryFiles, dataRoot, workspaceRoot).slice(0, 12),
            relatedRoots: asArray(context.editBoundary?.relatedRoots).slice(0, 8),
            guidance: asArray(context.editBoundary?.guidance).slice(0, 5),
        },
        validation: {
            recommendedCommands: filterValidationCommands(context.validation?.recommendedCommands, dataRoot).slice(0, 8),
        },
        uncertainties: asArray(context.uncertainties).slice(0, 6),
        evidence: compactEvidence(context.evidence || [], 8, dataRoot, workspaceRoot),
        _output: {
            detail: DETAIL_COMPACT,
            fullDetail: 'Pass detail=full to include complete task context, node metadata, and call chains.',
        },
    };
}

function compactChangeImpact(impact = {}) {
    const dataRoot = impact.dataRoot || '';
    const workspaceRoot = impact.workspaceRoot || '';
    return {
        kind: impact.kind || 'agent-change-impact',
        workspaceRoot,
        dataRoot,
        changedFiles: filterSourceFiles(impact.changedFiles, dataRoot, workspaceRoot).slice(0, 16),
        affectedFeatures: asArray(impact.affectedFeatures).slice(0, 8).map(compactFeature),
        affectedEntrypoints: {
            endpoints: asArray(impact.affectedEntrypoints?.endpoints).slice(0, 6).map(node => compactNode(node, dataRoot, workspaceRoot)),
            requests: asArray(impact.affectedEntrypoints?.requests).slice(0, 6).map(node => compactNode(node, dataRoot, workspaceRoot)),
            methods: asArray(impact.affectedEntrypoints?.methods).slice(0, 8).map(node => compactNode(node, dataRoot, workspaceRoot)),
        },
        affectedData: {
            tables: asArray(impact.affectedData?.tables).slice(0, 8).map(table => compactTable(table, dataRoot, workspaceRoot)),
        },
        affectedExternalServices: asArray(impact.affectedExternalServices).slice(0, 6).map(node => compactNode(node, dataRoot, workspaceRoot)),
        risk: {
            level: impact.risk?.level || 'unknown',
            reasons: asArray(impact.risk?.reasons).slice(0, 6),
        },
        reviewFocus: asArray(impact.reviewFocus).slice(0, 8).map(edge => compactEdge(edge, dataRoot, workspaceRoot)),
        validation: {
            recommendedCommands: filterValidationCommands(impact.validation?.recommendedCommands, dataRoot).slice(0, 8),
            rebuildFeatureKb: Boolean(impact.validation?.rebuildFeatureKb),
            rebuildProjectKb: Boolean(impact.validation?.rebuildProjectKb),
        },
        evidence: compactEvidence(impact.evidence || [], 8, dataRoot, workspaceRoot),
        _output: {
            detail: DETAIL_COMPACT,
            fullDetail: 'Pass detail=full to include complete impact graph evidence.',
        },
    };
}

function compactExecutionPlanResult(plan = {}) {
    const dataRoot = plan.dataRoot || '';
    const workspaceRoot = plan.workspaceRoot || '';
    return {
        kind: plan.kind || 'agent-task-execution-plan',
        task: plan.task || '',
        pmmGate: compactPmmGate(plan.pmmGate || {}),
        ...compactExecutionPlan(plan, dataRoot, workspaceRoot),
        evidence: compactEvidence(plan.evidence || [], 8, dataRoot, workspaceRoot),
        _output: {
            detail: DETAIL_COMPACT,
            fullDetail: 'Pass detail=full to include complete execution context evidence.',
        },
    };
}

function compactEditScopeValidation(scope = {}) {
    const dataRoot = scope.dataRoot || scope.impactSummary?.dataRoot || '';
    const workspaceRoot = scope.workspaceRoot || scope.impactSummary?.workspaceRoot || '';
    return {
        kind: scope.kind || 'agent-edit-scope-validation',
        task: scope.task || '',
        verdict: scope.verdict || '',
        changedFiles: filterSourceFiles(scope.changedFiles, dataRoot, workspaceRoot).slice(0, 16),
        pmmGate: compactPmmGate(scope.pmmGate || {}),
        outOfScopeFiles: filterSourceFiles(scope.outOfScopeFiles, dataRoot, workspaceRoot).slice(0, 12),
        informationalOutOfScopeFiles: filterSourceFiles(scope.informationalOutOfScopeFiles, dataRoot, workspaceRoot).slice(0, 12),
        riskyFiles: filterSourceFiles(scope.riskyFiles, dataRoot, workspaceRoot).slice(0, 12),
        missingExpectedFiles: filterSourceFiles(scope.missingExpectedFiles, dataRoot, workspaceRoot).slice(0, 12),
        impactSummary: scope.impactSummary ? compactChangeImpact({
            ...scope.impactSummary,
            workspaceRoot,
            dataRoot,
            kind: 'agent-change-impact-summary',
        }) : null,
        requiredFollowUp: asArray(scope.requiredFollowUp).slice(0, 8),
        evidence: compactEvidence(scope.evidence || [], 8, dataRoot, workspaceRoot),
        _output: {
            detail: DETAIL_COMPACT,
            fullDetail: 'Pass detail=full to include complete edit-scope impact evidence.',
        },
    };
}

function compactPatchReview(review = {}) {
    return {
        kind: review.kind || 'agent-patch-review',
        task: review.task || '',
        verdict: review.verdict || '',
        scope: compactEditScopeValidation(review.scope || {}),
        findings: asArray(review.findings).slice(0, 8).map(finding => ({
            severity: finding.severity || '',
            title: finding.title || '',
            detail: finding.detail || finding.message || '',
        })),
        reviewChecklist: asArray(review.reviewChecklist).slice(0, 8),
        evidence: compactEvidence(review.evidence || [], 8, review.scope?.dataRoot || '', review.scope?.workspaceRoot || ''),
        _output: {
            detail: DETAIL_COMPACT,
            fullDetail: 'Pass detail=full to include complete patch review scope and evidence.',
        },
    };
}

function compactRecallMemory(memory = {}) {
    const dataRoot = memory.dataRoot || '';
    const workspaceRoot = memory.workspaceRoot || '';
    return {
        workspaceRoot,
        dataRoot,
        ...compactMemory(memory, dataRoot, workspaceRoot),
        evidence: compactEvidence(memory.evidence || [], 8, dataRoot, workspaceRoot),
        _output: {
            detail: DETAIL_COMPACT,
            fullDetail: 'Pass detail=full to include complete recalled outcomes and observations.',
        },
    };
}

function compactProjectMemorySummary(summary = {}) {
    const dataRoot = summary.dataRoot || '';
    const workspaceRoot = summary.workspaceRoot || '';
    return {
        kind: summary.kind || 'agent-project-memory-summary',
        workspaceRoot,
        dataRoot,
        outcomeCount: summary.outcomeCount || 0,
        latestOutcomes: asArray(summary.latestOutcomes).slice(0, 6).map(record => ({
            task: record.task || '',
            outcome: record.outcome || '',
            recordedAt: record.recordedAt || '',
            changedFiles: filterSourceFiles(record.changedFiles, dataRoot, workspaceRoot).slice(0, 6),
            validation: filterValidationCommands(record.validation, dataRoot).slice(0, 4),
            outcomeConfidence: record.outcomeConfidence || 'unknown',
        })),
        frequentFiles: asArray(summary.frequentFiles).slice(0, 12).map(compactCountedItem),
        frequentValidationCommands: filterValidationCommands(summary.frequentValidationCommands, dataRoot).slice(0, 8).map(compactCountedItem),
        playbook: {
            updatedAt: summary.playbook?.updatedAt || null,
            ruleCount: summary.playbook?.ruleCount || 0,
            rules: asArray(summary.playbook?.rules).slice(0, 6).map(rule => ({
                title: rule.title || '',
                body: rule.body || '',
                category: rule.category || '',
                files: filterSourceFiles(rule.files, dataRoot, workspaceRoot).slice(0, 5),
            })),
        },
        _output: {
            detail: DETAIL_COMPACT,
            fullDetail: 'Pass detail=full to include complete project memory paths and records.',
        },
    };
}

function compactRecommendations(recommendations = {}, dataRoot = '', workspaceRoot = '') {
    return {
        groups: asArray(recommendations.groups).slice(0, 8).map(group => ({
            key: group.key || '',
            label: group.label || group.title || '',
            count: group.count ?? asArray(group.candidates || group.items).length,
            candidates: asArray(group.candidates || group.items).slice(0, 5).map(item => (
                typeof item === 'string' ? item : compactNode(item, dataRoot, workspaceRoot)
            )),
        })),
    };
}

function compactQueryItem(item, dataRoot = '', workspaceRoot = '') {
    if (item == null || typeof item !== 'object') {
        return item;
    }
    if (item.type || item.name || item.file || item.id) {
        return compactNode(item, dataRoot, workspaceRoot);
    }
    const result = {};
    for (const key of ['key', 'kind', 'status', 'label', 'title', 'count', 'value', 'path', 'method', 'route', 'protocol']) {
        if (item[key] !== undefined && item[key] !== '') {
            result[key] = item[key];
        }
    }
    return result;
}

function compactProjectQuery(payload = {}) {
    const dataRoot = payload.project?.dataRoot || payload.dataRoot || '';
    const workspaceRoot = payload.project?.root || payload.workspaceRoot || '';
    const result = {};
    for (const key of ['kind', 'inputQuery', 'direction', 'depth', 'mode', 'focus', 'purpose', 'useWhen', 'detail', 'prefabPath', 'scriptPath', 'excludedPrefabPath']) {
        if (payload[key] !== undefined && payload[key] !== '') {
            result[key] = payload[key];
        }
    }
    if (payload.project) {
        result.project = {
            root: payload.project.root || '',
            dataRoot: payload.project.dataRoot || '',
            layout: payload.project.layout || '',
        };
    }
    if (payload.feature) {
        result.feature = compactFeature(payload.feature);
    }
    if (payload.counts) {
        result.counts = cloneJson(payload.counts);
    }
    if (payload.protocolsSummary) {
        result.protocolsSummary = cloneJson(payload.protocolsSummary);
    }
    if (payload.builtWithSkill) {
        result.builtWithSkill = compactVersionInfo(payload.builtWithSkill);
    }
    if (payload.kbFreshness || payload.kbVersionStatus) {
        result.kbFreshness = compactFreshness(payload.kbFreshness || payload.kbVersionStatus);
    }
    if (payload.resolvedStart) {
        result.resolvedStart = compactNode(payload.resolvedStart, dataRoot, workspaceRoot);
    }
    if (payload.traversal) {
        result.traversal = asArray(payload.traversal).slice(0, 24).map(item => compactTraversalItem(item, dataRoot, workspaceRoot));
    }
    if (payload.relatedHelpers) {
        result.relatedHelpers = asArray(payload.relatedHelpers).slice(0, 10).map(item => compactNode(item, dataRoot, workspaceRoot));
    }
    if (payload.dataAccessSummary) {
        result.dataAccessSummary = {
            counts: cloneJson(payload.dataAccessSummary.counts || {}),
            tables: asArray(payload.dataAccessSummary.tables).slice(0, 8).map(table => compactTable(table, dataRoot, workspaceRoot)),
        };
    }
    if (payload.result) {
        result.result = asArray(payload.result).slice(0, 20).map(item => compactQueryItem(item, dataRoot, workspaceRoot));
    }
    if (payload.ambiguous) {
        result.ambiguous = asArray(payload.ambiguous).slice(0, 20).map(item => compactQueryItem(item, dataRoot, workspaceRoot));
    }
    if (payload.recommendations) {
        result.recommendations = compactRecommendations(payload.recommendations, dataRoot, workspaceRoot);
    }
    for (const key of ['examples', 'defaultWorkflow', 'artifacts', 'customScripts', 'builtinComponents', 'unresolvedComponents', 'prefabs', 'usages']) {
        if (payload[key]) {
            result[key] = asArray(payload[key]).slice(0, 10).map(item => compactQueryItem(item, dataRoot, workspaceRoot));
        }
    }
    result._output = {
        detail: DETAIL_COMPACT,
        fullDetail: 'Pass detail=full to include complete query nodes, metadata, artifacts, and snapshots.',
    };
    return result;
}

function compactErrorResult(payload = {}) {
    return {
        ok: false,
        error: payload.error || 'PMM_QUERY_FAILED',
        message: payload.message || '',
        timedOut: Boolean(payload.timedOut),
        stdout: truncateText(payload.stdout || '', 1000),
        stderr: truncateText(payload.stderr || '', 1000),
        kbFreshness: payload.kbFreshness ? compactFreshness(payload.kbFreshness) : undefined,
        _output: {
            detail: DETAIL_COMPACT,
            fullDetail: 'Pass detail=full to include complete query error output.',
        },
    };
}

function compactWorkspaceIdentity(identity = {}) {
    if (!identity || typeof identity !== 'object') {
        return identity || null;
    }
    const result = {};
    for (const key of ['workspaceId', 'workspaceHash', 'workspaceRoot', 'registryPath', 'matchedBy']) {
        if (identity[key] !== undefined && identity[key] !== '') {
            result[key] = identity[key];
        }
    }
    return Object.keys(result).length ? result : null;
}

function compactWorkspaceState(state = {}) {
    const result = {
        workspaceRoot: state.workspaceRoot || '',
        dataRoot: state.dataRoot || '',
        layout: state.layout || '',
        workspaceId: state.workspaceId || '',
        workspaceHash: state.workspaceHash || '',
        memoryRoot: state.memoryRoot || '',
        manifest: state.manifest || '',
        registryPath: state.registryPath || '',
        projectProfile: state.projectProfile || '',
        featureRegistry: state.featureRegistry || '',
        projectGlobalDir: state.projectGlobalDir || '',
        initialized: Boolean(state.initialized),
        hasProjectProfile: Boolean(state.hasProjectProfile),
        hasConfiguredAreaRoots: Boolean(state.hasConfiguredAreaRoots),
        hasProjectGlobalKb: Boolean(state.hasProjectGlobalKb),
        projectGlobalFreshness: compactFreshness(state.projectGlobalFreshness),
        legacyProjectMemoryExists: Boolean(state.legacyProjectMemoryExists),
        workspaceIdentity: compactWorkspaceIdentity(state.workspaceIdentity),
        areas: state.areas || null,
        stacks: state.stacks || null,
        suggestedNextAction: state.suggestedNextAction || '',
        _output: {
            detail: DETAIL_COMPACT,
            fullDetail: 'Pass detail=full to include complete workspace diagnostics.',
        },
    };
    return result;
}

function compactKbFreshnessResult(payload = {}) {
    const result = {
        workspaceRoot: payload.workspaceRoot || '',
        dataRoot: payload.dataRoot || '',
        layout: payload.layout || '',
        projectGlobal: compactFreshness(payload.projectGlobal),
        _output: {
            detail: DETAIL_COMPACT,
            fullDetail: 'Pass detail=full to include complete freshness diagnostics and changed file lists.',
        },
    };
    if (payload.feature) {
        result.feature = {
            featureKey: payload.feature.featureKey || '',
            freshness: compactFreshness(payload.feature.freshness),
        };
    }
    return result;
}

function attachProjectedMetadata(projected, source, detail) {
    if (!projected || typeof projected !== 'object') {
        return projected;
    }
    if (source?._mcpFreshness) {
        projected._mcpFreshness = detail === DETAIL_FULL
            ? cloneJson(source._mcpFreshness)
            : compactFreshnessMeta(source._mcpFreshness);
    }
    if (source?._mcpCache) {
        projected._mcpCache = detail === DETAIL_FULL
            ? cloneJson(source._mcpCache)
            : {
                hit: Boolean(source._mcpCache.hit),
                elapsedMs: source._mcpCache.elapsedMs ?? null,
                cachedAt: source._mcpCache.cachedAt || '',
                invalidatedByMtime: Boolean(source._mcpCache.invalidatedByMtime),
                invalidatedBySource: Boolean(source._mcpCache.invalidatedBySource),
            };
    }
    if (source?._mcpQuery) {
        projected._mcpQuery = {
            ...cloneJson(source._mcpQuery),
            detail,
        };
    }
    return projected;
}

function projectAgentOutput(payload, options = {}, toolName = '') {
    const detail = resolveOutputDetail(options, DETAIL_COMPACT);
    if (detail === DETAIL_FULL) {
        const full = cloneJson(payload);
        if (full && typeof full === 'object') {
            if (full._mcpQuery) {
                full._mcpQuery.detail = DETAIL_FULL;
            }
            full._output = {
                ...(full._output || {}),
                detail: DETAIL_FULL,
            };
        }
        return full;
    }

    let projected;
    if (payload?.ok === false) {
        projected = compactErrorResult(payload);
    } else if (toolName === 'agent_preflight' || payload?.kind === 'agent-preflight') {
        projected = compactAgentPreflight(payload);
    } else if (toolName === 'prepare_agent_brief' || payload?.kind === 'agent-brief') {
        projected = compactAgentBrief(payload);
    } else if (toolName === 'prepare_task_context' || payload?.kind === 'agent-task-context') {
        projected = compactTaskContext(payload);
    } else if (toolName === 'analyze_change_impact' || payload?.kind === 'agent-change-impact') {
        projected = compactChangeImpact(payload);
    } else if (toolName === 'plan_task_execution' || payload?.kind === 'agent-task-execution-plan') {
        projected = compactExecutionPlanResult(payload);
    } else if (toolName === 'validate_edit_scope' || payload?.kind === 'agent-edit-scope-validation') {
        projected = compactEditScopeValidation(payload);
    } else if (toolName === 'review_patch_for_agent' || payload?.kind === 'agent-patch-review') {
        projected = compactPatchReview(payload);
    } else if (toolName === 'recall_task_memory' || payload?.kind === 'agent-memory-recall') {
        projected = compactRecallMemory(payload);
    } else if (toolName === 'summarize_project_memory' || payload?.kind === 'agent-project-memory-summary') {
        projected = compactProjectMemorySummary(payload);
    } else if (toolName === 'query_project_chain' || toolName === 'query_feature_chain') {
        projected = compactProjectQuery(payload);
    } else if (toolName === 'get_current_state') {
        projected = compactWorkspaceState(payload);
    } else if (toolName === 'check_kb_freshness') {
        projected = compactKbFreshnessResult(payload);
    } else {
        projected = cloneJson(payload);
        if (projected && typeof projected === 'object') {
            projected._output = {
                ...(projected._output || {}),
                detail: DETAIL_COMPACT,
            };
        }
    }
    const withMetadata = attachProjectedMetadata(projected, payload, DETAIL_COMPACT);
    return enforceCompactBudget(withMetadata, TOOL_OUTPUT_BUDGETS[toolName] || DEFAULT_COMPACT_BUDGET);
}

module.exports = {
    compactFreshness,
    compactFreshnessMeta,
    compactProjectQuery,
    enforceCompactBudget,
    projectAgentOutput,
    resolveOutputDetail,
    summarizePreflight,
    truncateText,
};
