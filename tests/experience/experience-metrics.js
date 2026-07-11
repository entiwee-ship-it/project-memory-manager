function normalizePath(value = '') {
    return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

function uniquePaths(values = []) {
    const seen = new Set();
    const result = [];
    for (const value of values) {
        const normalized = normalizePath(value);
        if (!normalized || seen.has(normalized)) {
            continue;
        }
        seen.add(normalized);
        result.push(String(value).replace(/\\/g, '/'));
    }
    return result;
}

function pathMatches(actual, expected) {
    const left = normalizePath(actual);
    const right = normalizePath(expected);
    return left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`);
}

function scoreFileRecommendations(fixture, recommendedFiles = []) {
    const files = uniquePaths(recommendedFiles);
    const required = fixture.requiredFiles || [];
    const accepted = fixture.acceptedFiles || [];
    const requiredIn = limit => required.filter(expected => files.slice(0, limit).some(file => pathMatches(file, expected))).length;
    const relevant = file => required.some(expected => pathMatches(file, expected))
        || accepted.some(expected => pathMatches(file, expected));
    const forbidden = file => (fixture.forbiddenDomains || []).some(domain => normalizePath(file).includes(normalizePath(domain)));
    const noise = files.filter(file => forbidden(file) || !relevant(file));
    return {
        recommendedFiles: files,
        top5Recall: required.length ? requiredIn(5) / required.length : 1,
        top10Recall: required.length ? requiredIn(10) / required.length : 1,
        noiseRatio: files.length ? noise.length / files.length : 0,
        missingTop10: required.filter(expected => !files.slice(0, 10).some(file => pathMatches(file, expected))),
        noiseFiles: noise,
    };
}

function scoreEvidenceCoverage(fixture, payload = {}) {
    const text = JSON.stringify(payload).toLowerCase();
    const requiredEvidence = fixture.requiredEvidence || {};
    const dimensions = {};
    for (const [dimension, values] of Object.entries(requiredEvidence)) {
        dimensions[dimension] = values.length === 0
            ? null
            : values.every(value => text.includes(String(value).toLowerCase()));
    }
    return dimensions;
}

function scoreMemoryRecall(fixture, recalledTasks = []) {
    const expected = fixture.intent === 'resume' ? 1 : 0;
    const matching = recalledTasks.filter(item => {
        const text = JSON.stringify(item).toLowerCase();
        return fixture.intent === 'resume' && (text.includes('商品快照') || text.includes('e61e81d6'));
    }).length;
    return {
        expected,
        recalled: recalledTasks.length,
        matching,
        precision: recalledTasks.length ? matching / recalledTasks.length : expected === 0 ? 1 : 0,
    };
}

function scoreResumeCompleteness(fixture, payload = {}) {
    if (fixture.intent !== 'resume') {
        return null;
    }
    const text = JSON.stringify(payload).toLowerCase();
    const expectation = fixture.resumeExpectation;
    const containsAll = values => values.every(value => text.includes(String(value).toLowerCase()));
    return {
        statusComplete: containsAll(expectation.completed),
        validationComplete: containsAll(expectation.validation),
        riskComplete: containsAll(expectation.remainingRisks),
        nextActionCorrect: text.includes(expectation.nextAction.toLowerCase()),
    };
}

function scoreWorkflow(fixture, fileMetrics, payload = {}) {
    const directRounds = fixture.directSourceBaseline.searchRounds.length
        + fixture.directSourceBaseline.correctionRounds;
    const selectorRounds = Array.isArray(payload?.sourceConfirmation) ? payload.sourceConfirmation.length : 0;
    const correctionRounds = fileMetrics.missingTop10.length > 0 ? 1 : 0;
    const searchRounds = 1;
    return {
        directRounds,
        searchRounds,
        selectorRounds,
        correctionRounds,
        improved: searchRounds + selectorRounds + correctionRounds < directRounds,
        planAdoptable: fileMetrics.top5Recall >= 0.8
            && fileMetrics.noiseRatio <= 0.2
            && (fixture.risk !== 'high' || fileMetrics.missingTop10.length === 0),
    };
}

function aggregateExperienceResults(results = []) {
    const average = field => results.reduce((sum, item) => sum + field(item), 0) / Math.max(results.length, 1);
    const resumeResults = results.map(item => item.resumeMetrics).filter(Boolean);
    return {
        taskCount: results.length,
        top5Recall: average(item => item.fileMetrics.top5Recall),
        top10Recall: average(item => item.fileMetrics.top10Recall),
        maxNoiseRatio: Math.max(0, ...results.map(item => item.fileMetrics.noiseRatio)),
        planAdoptableRate: average(item => item.workflowMetrics.planAdoptable ? 1 : 0),
        memoryPrecision: average(item => item.memoryMetrics.precision),
        workflowImprovementRate: average(item => item.workflowMetrics.improved ? 1 : 0),
        highRiskCoreEvidenceMisses: results.filter(item => item.risk === 'high' && item.fileMetrics.missingTop10.length > 0).length,
        resumeFailures: resumeResults.filter(item => !Object.values(item).every(Boolean)).length,
        worstTop5Task: [...results].sort((a, b) => a.fileMetrics.top5Recall - b.fileMetrics.top5Recall)[0]?.taskId || '',
        worstNoiseTask: [...results].sort((a, b) => b.fileMetrics.noiseRatio - a.fileMetrics.noiseRatio)[0]?.taskId || '',
    };
}

function categorizeExperienceFailures(results = []) {
    const categories = {
        missing_required_file: [],
        high_risk_evidence_gap: [],
        cross_domain_noise: [],
        plan_not_adoptable: [],
        memory_false_positive: [],
        resume_incomplete: [],
        workflow_not_improved: [],
    };
    for (const result of results) {
        if (result.fileMetrics.missingTop10.length > 0) {
            categories.missing_required_file.push({
                taskId: result.taskId,
                missingFiles: result.fileMetrics.missingTop10,
            });
        }
        if (result.risk === 'high' && result.fileMetrics.missingTop10.length > 0) {
            categories.high_risk_evidence_gap.push({
                taskId: result.taskId,
                missingFiles: result.fileMetrics.missingTop10,
                evidenceCoverage: result.evidenceCoverage,
            });
        }
        if (result.fileMetrics.noiseRatio > 0.2) {
            categories.cross_domain_noise.push({
                taskId: result.taskId,
                noiseRatio: result.fileMetrics.noiseRatio,
                noiseFiles: result.fileMetrics.noiseFiles,
            });
        }
        if (!result.workflowMetrics.planAdoptable) {
            categories.plan_not_adoptable.push({ taskId: result.taskId });
        }
        if (result.memoryMetrics.precision < 0.9) {
            categories.memory_false_positive.push({
                taskId: result.taskId,
                recalled: result.memoryMetrics.recalled,
                matching: result.memoryMetrics.matching,
            });
        }
        if (result.resumeMetrics && !Object.values(result.resumeMetrics).every(Boolean)) {
            categories.resume_incomplete.push({
                taskId: result.taskId,
                resumeMetrics: result.resumeMetrics,
            });
        }
        if (!result.workflowMetrics.improved) {
            categories.workflow_not_improved.push({
                taskId: result.taskId,
                directRounds: result.workflowMetrics.directRounds,
                pmmRounds: result.workflowMetrics.searchRounds
                    + result.workflowMetrics.selectorRounds
                    + result.workflowMetrics.correctionRounds,
            });
        }
    }
    return categories;
}

module.exports = {
    aggregateExperienceResults,
    categorizeExperienceFailures,
    scoreEvidenceCoverage,
    scoreFileRecommendations,
    scoreMemoryRecall,
    scoreResumeCompleteness,
    scoreWorkflow,
};
