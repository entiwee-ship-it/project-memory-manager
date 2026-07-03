const DETAIL_COMPACT = 'compact';
const DETAIL_FULL = 'full';
const OUTPUT_DETAILS = new Set([DETAIL_COMPACT, DETAIL_FULL]);

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
    const result = {
        kind: value.kind || 'kb-freshness',
        status: value.status || '',
        stale: Boolean(value.stale),
        querySafe: Boolean(value.querySafe),
        sourceFallbackAllowed: Boolean(value.sourceFallbackAllowed),
        mustRefreshBeforeQuery: Boolean(value.mustRefreshBeforeQuery),
        mustRefreshBeforeSourceFallback: Boolean(value.mustRefreshBeforeSourceFallback),
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

function compactEvidence(evidence = [], limit = 8) {
    return asArray(evidence).slice(0, limit).map(item => {
        const result = {};
        for (const key of ['kind', 'confidence', 'reason', 'file', 'method', 'endpoint', 'nodeId', 'edgeType', 'task', 'recordedAt', 'category']) {
            if (item && item[key] !== undefined && item[key] !== '') {
                result[key] = item[key];
            }
        }
        if (item?.files) {
            result.files = asArray(item.files).slice(0, 8);
        }
        return result;
    });
}

function compactMemory(memory = {}) {
    return {
        kind: memory.kind || 'agent-memory-recall',
        task: memory.task || '',
        queryTerms: asArray(memory.queryTerms).slice(0, 12),
        knownFiles: asArray(memory.knownFiles).slice(0, 12),
        totalOutcomeRecords: memory.totalOutcomeRecords || 0,
        recalledTasks: asArray(memory.recalledTasks).slice(0, 4).map(record => ({
            task: record.task || '',
            outcome: record.outcome || '',
            recordedAt: record.recordedAt || '',
            changedFiles: asArray(record.changedFiles).slice(0, 8),
            validation: asArray(record.validation).slice(0, 5),
            observations: asArray(record.observations).slice(0, 5),
            confidence: record.confidence || '',
            reasons: asArray(record.reasons).slice(0, 4),
        })),
        relatedFiles: asArray(memory.relatedFiles).slice(0, 10),
        validationCommands: asArray(memory.validationCommands).slice(0, 8),
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

function compactExecutionPlan(plan = {}) {
    return {
        contextStatus: plan.contextStatus || '',
        targetFiles: asArray(plan.targetFiles).slice(0, 16),
        editBoundary: {
            primaryFiles: asArray(plan.editBoundary?.primaryFiles).slice(0, 16),
            relatedRoots: asArray(plan.editBoundary?.relatedRoots).slice(0, 8),
            guidance: asArray(plan.editBoundary?.guidance).slice(0, 6),
        },
        steps: asArray(plan.steps).slice(0, 5).map(step => ({
            step: step.step || '',
            action: step.action || '',
            evidence: compactEvidence(step.evidence || [], 4),
        })),
        validation: {
            recommendedCommands: asArray(plan.validation?.recommendedCommands).slice(0, 8),
        },
        uncertainties: asArray(plan.uncertainties).slice(0, 8),
    };
}

function compactAgentBrief(brief = {}) {
    return {
        kind: brief.kind || 'agent-brief',
        workspaceRoot: brief.workspaceRoot || '',
        dataRoot: brief.dataRoot || '',
        task: brief.task || '',
        preflightSummary: summarizePreflight(brief.preflight || {}),
        pmmGate: compactPmmGate(brief.pmmGate || {}),
        executionPlan: compactExecutionPlan(brief.executionPlan || {}),
        memory: compactMemory(brief.memory || {}),
        recommendedFiles: asArray(brief.recommendedFiles).slice(0, 16),
        validation: {
            recommendedCommands: asArray(brief.validation?.recommendedCommands).slice(0, 10),
        },
        risksAndNotes: asArray(brief.risksAndNotes).slice(0, 12),
        nextActions: asArray(brief.nextActions).slice(0, 8),
        evidence: compactEvidence(brief.evidence || [], 10),
        _output: {
            detail: DETAIL_COMPACT,
            fullDetail: 'Pass detail=full to include complete preflight and memory diagnostics.',
        },
    };
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
    if (toolName === 'agent_preflight' || payload?.kind === 'agent-preflight') {
        projected = compactAgentPreflight(payload);
    } else if (toolName === 'prepare_agent_brief' || payload?.kind === 'agent-brief') {
        projected = compactAgentBrief(payload);
    } else {
        projected = cloneJson(payload);
        if (projected && typeof projected === 'object') {
            projected._output = {
                ...(projected._output || {}),
                detail: DETAIL_COMPACT,
            };
        }
    }
    return attachProjectedMetadata(projected, payload, DETAIL_COMPACT);
}

module.exports = {
    compactFreshness,
    compactFreshnessMeta,
    projectAgentOutput,
    resolveOutputDetail,
    summarizePreflight,
};
