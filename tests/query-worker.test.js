'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { QueryWorkerClient } = require('../src/mcp/query-worker-client');

async function main() {
    const workerPath = path.join(__dirname, 'fixtures', 'query-worker-stub.js');
    const client = new QueryWorkerClient({ workerPath });

    const first = await client.run('echo', ['first'], 1000);
    const second = await client.run('echo', ['second'], 1000);
    assert.equal(first.ok, true);
    assert.equal(first.workerReused, false);
    assert.equal(second.ok, true);
    assert.equal(second.workerReused, true);
    assert.equal(second.workerThreadId, first.workerThreadId);

    const queued = await Promise.all([
        client.run('delay', [30], 1000),
        client.run('echo', ['queued'], 1000),
    ]);
    assert.equal(queued[0].ok, true);
    assert.equal(queued[1].ok, true);
    assert.equal(queued[1].payload.argv[0], 'queued');

    const timedOut = await client.run('delay', [200], 25);
    assert.equal(timedOut.ok, false);
    assert.equal(timedOut.timedOut, true);
    assert.match(timedOut.error, /timed out after 25ms/);

    const afterTimeout = await client.run('echo', ['after-timeout'], 1000);
    assert.equal(afterTimeout.ok, true);
    assert.ok(afterTimeout.workerGeneration > first.workerGeneration);
    assert.notEqual(afterTimeout.workerThreadId, first.workerThreadId);

    const crashed = await client.run('crash', [], 1000);
    assert.equal(crashed.ok, false);
    assert.match(crashed.error, /exited with code 17/);

    const afterCrash = await client.run('echo', ['after-crash'], 1000);
    assert.equal(afterCrash.ok, true);
    assert.ok(afterCrash.workerGeneration > afterTimeout.workerGeneration);

    const cloneFailure = await client.run('echo', [], 1000, { invalid: () => undefined });
    assert.equal(cloneFailure.ok, false);
    assert.match(cloneFailure.error, /could not be cloned/);

    const afterCloneFailure = await client.run('echo', ['after-clone-failure'], 1000);
    assert.equal(afterCloneFailure.ok, true);
    assert.ok(afterCloneFailure.workerGeneration > afterCrash.workerGeneration);

    await client.close();
    const afterClose = await client.run('echo', [], 1000);
    assert.equal(afterClose.ok, false);
    assert.match(afterClose.error, /closed/);

    const idleClient = new QueryWorkerClient({ workerPath, idleTimeoutMs: 20 });
    const beforeIdle = await idleClient.run('echo', ['before-idle'], 1000);
    await new Promise(resolve => setTimeout(resolve, 60));
    const afterIdle = await idleClient.run('echo', ['after-idle'], 1000);
    assert.equal(afterIdle.ok, true);
    assert.ok(afterIdle.workerGeneration > beforeIdle.workerGeneration);
    await idleClient.close();
    console.log('query-worker tests passed');
}

main().catch(error => {
    console.error(error.stack || error.message);
    process.exit(1);
});
