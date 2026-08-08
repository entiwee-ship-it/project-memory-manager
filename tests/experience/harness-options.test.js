const assert = require('node:assert/strict');
const {
    fixtureLoadOptions,
    loadRunFixtures,
} = require('./pmm-experience-harness.test');

const skipped = fixtureLoadOptions({
    skipPathCheck: true,
    workspaceRoot: 'Z:/missing-qy-project',
});
assert.equal(skipped.checkPaths, false);
assert.equal(skipped.workspaceRoot, 'Z:/missing-qy-project');
assert.equal(loadRunFixtures({
    skipPathCheck: true,
    workspaceRoot: 'Z:/missing-qy-project',
}).length, 12);

const strict = fixtureLoadOptions({
    skipPathCheck: false,
    workspaceRoot: 'Z:/missing-qy-project',
});
assert.equal(strict.checkPaths, true);
assert.throws(
    () => loadRunFixtures({
        skipPathCheck: false,
        workspaceRoot: 'Z:/missing-qy-project',
    }),
    /path does not exist/
);

console.log('experience harness option validation passed');
