const READINESS_VALUES = ['ready', 'needs_selector', 'needs_source_confirmation', 'blocked'];

const REQUIRED_COVERAGE = {
    understand: ['entrypoint', 'implementation'],
    implement: ['entrypoint', 'implementation', 'callers', 'validation'],
    debug: ['entrypoint', 'implementation', 'validation'],
    resume: ['validation'],
    review: ['implementation', 'callers', 'validation'],
    simple: ['implementation', 'validation'],
};

function asArray(value) {
    if (Array.isArray(value)) {
        return value.filter(Boolean);
    }
    return value ? [value] : [];
}

function hasEvidence(...values) {
    return values.some(value => asArray(value).length > 0);
}

function applicableDimensions(intent, applicability = {}) {
    const required = new Set(REQUIRED_COVERAGE[intent] || REQUIRED_COVERAGE.implement);
    for (const dimension of ['entrypoint', 'implementation', 'callers', 'backend', 'data', 'validation']) {
        if (applicability[dimension] === true) {
            required.add(dimension);
        }
        if (applicability[dimension] === false) {
            required.delete(dimension);
        }
    }
    return required;
}

function buildCoverage(options = {}) {
    const intent = options.intent || 'implement';
    const required = applicableDimensions(intent, options.applicability || {});
    const values = {
        entrypoint: hasEvidence(options.entrypoints, options.endpoints, options.requests),
        implementation: hasEvidence(options.implementations, options.methods, options.files),
        callers: hasEvidence(options.callers),
        backend: hasEvidence(options.backend, options.endpoints),
        data: hasEvidence(options.tables, options.data),
        validation: hasEvidence(options.validationCommands, options.validation),
    };
    return Object.fromEntries(Object.entries(values).map(([dimension, value]) => [
        dimension,
        required.has(dimension) ? value : null,
    ]));
}

function missingReason(dimension, options = {}) {
    const highRisk = options.risk === 'high';
    const reasons = {
        entrypoint: 'task has no confirmed entrypoint, request, or endpoint evidence',
        implementation: 'task has no confirmed implementation file or method evidence',
        callers: highRisk
            ? 'high-risk task has no caller or changed-file neighbor evidence'
            : 'task has no caller evidence',
        backend: 'high-risk task has no endpoint or backend implementation evidence',
        data: 'high-risk task has no table or data-access evidence',
        validation: 'task has no concrete validation command or contract evidence',
    };
    return reasons[dimension];
}

function recommendedSelector(dimension) {
    const selectors = {
        entrypoint: { type: 'method' },
        implementation: { type: 'method' },
        callers: { direction: 'upstream' },
        backend: { type: 'endpoint' },
        data: { type: 'table' },
        validation: { focus: 'validation' },
    };
    return selectors[dimension];
}

function evaluateBriefReadiness(options = {}) {
    const intent = options.intent || 'implement';
    const freshness = String(options.freshness || 'unknown').toLowerCase();
    const coverage = buildCoverage(options);
    const sourceConfirmation = asArray(options.sourceConfirmation);

    if (freshness !== 'fresh') {
        return {
            readiness: 'blocked',
            coverage,
            missingEvidence: [{
                dimension: 'freshness',
                reason: `project-global KB freshness is ${freshness}`,
                recommendedSelector: { action: 'rebuild_project_index' },
            }],
            sourceConfirmation: [],
        };
    }

    if (Number(options.ambiguityCount || 0) > 1) {
        return {
            readiness: 'needs_selector',
            coverage,
            missingEvidence: [{
                dimension: 'selector',
                reason: `${options.ambiguityCount} plausible entrypoints require disambiguation`,
                recommendedSelector: options.recommendedSelector || { type: 'method', grouped: true },
            }],
            sourceConfirmation,
        };
    }

    const missingEvidence = Object.entries(coverage)
        .filter(([, value]) => value === false)
        .map(([dimension]) => ({
            dimension,
            reason: missingReason(dimension, options),
            recommendedSelector: recommendedSelector(dimension),
        }));

    if (missingEvidence.length > 0 || sourceConfirmation.length > 0) {
        return {
            readiness: 'needs_source_confirmation',
            coverage,
            missingEvidence,
            sourceConfirmation,
        };
    }

    return {
        readiness: 'ready',
        coverage,
        missingEvidence: [],
        sourceConfirmation: [],
    };
}

module.exports = {
    READINESS_VALUES,
    REQUIRED_COVERAGE,
    buildCoverage,
    evaluateBriefReadiness,
};
