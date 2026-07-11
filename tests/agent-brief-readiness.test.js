const assert = require('node:assert/strict');
const { READINESS_VALUES, buildCoverage, evaluateBriefReadiness } = require('../src/agent/brief-readiness');

assert.deepEqual(READINESS_VALUES, ['ready', 'needs_selector', 'needs_source_confirmation', 'blocked']);

assert.equal(evaluateBriefReadiness({ intent: 'implement', freshness: 'stale' }).readiness, 'blocked');
assert.equal(evaluateBriefReadiness({ intent: 'understand', freshness: 'fresh', ambiguityCount: 2 }).readiness, 'needs_selector');
assert.equal(evaluateBriefReadiness({
    intent: 'implement',
    risk: 'high',
    freshness: 'fresh',
    files: ['ui.vue'],
    callers: [],
    backend: [],
    tables: [],
    validationCommands: ['npm test'],
    applicability: { backend: true, data: true },
}).readiness, 'needs_source_confirmation');
assert.equal(evaluateBriefReadiness({
    intent: 'simple',
    freshness: 'fresh',
    files: ['View.vue'],
    validationCommands: ['npm test'],
}).readiness, 'ready');

const coverage = buildCoverage({
    intent: 'understand',
    files: ['src/entry.ts'],
    entrypoints: ['entry'],
    implementations: ['impl'],
    callers: [],
    backend: [],
    tables: [],
    validationCommands: [],
});
assert.equal(coverage.entrypoint, true);
assert.equal(coverage.implementation, true);
assert.equal(coverage.callers, null);
assert.equal(coverage.backend, null);
assert.equal(coverage.data, null);
assert.equal(coverage.validation, null);

const missing = evaluateBriefReadiness({
    intent: 'review',
    risk: 'high',
    freshness: 'fresh',
    files: ['src/order.ts'],
    implementations: ['order'],
    callers: [],
    backend: [],
    tables: [],
    validationCommands: [],
    applicability: { backend: true, data: true },
});
assert.ok(missing.missingEvidence.some(item => item.dimension === 'callers'));
assert.ok(missing.missingEvidence.some(item => item.dimension === 'backend'));
assert.ok(missing.missingEvidence.some(item => item.dimension === 'data'));
assert.ok(missing.missingEvidence.some(item => item.dimension === 'validation'));
console.log('agent brief readiness validation passed');
