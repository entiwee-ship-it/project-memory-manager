const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const fixtureRoot = path.join(__dirname, 'fixtures', 'pinus-sample');
const { run: buildChainKb } = require('../scripts/build_chain_kb');
const { run: queryChainKb } = require('../scripts/query_chain_kb');

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function runWithCapturedOutput(fn, args, cwd) {
    const originalCwd = process.cwd();
    const originalLog = console.log;
    const logs = [];

    try {
        process.chdir(cwd);
        console.log = (...values) => {
            logs.push(values.map(value => String(value)).join(' '));
        };
        fn(args);
        return logs.join('\n');
    } finally {
        console.log = originalLog;
        process.chdir(originalCwd);
    }
}

function copyFixtureToTemp() {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-pinus-'));
    fs.cpSync(fixtureRoot, tempRoot, { recursive: true });
    return tempRoot;
}

function buildFixture(tempRoot) {
    runWithCapturedOutput(buildChainKb, ['--root', tempRoot, '--config', 'pinus-kb.json'], repoRoot);
    return {
        graph: readJson(path.join(tempRoot, 'project-memory', 'kb', 'features', 'pinus-sample', 'chain.graph.json')),
    };
}

function namesFromTraversal(output) {
    const parsed = JSON.parse(output);
    return parsed.traversal.map(item => item.node?.name).filter(Boolean);
}

function runFixtureAssertions() {
    const tempRoot = copyFixtureToTemp();
    const { graph } = buildFixture(tempRoot);

    assert.ok(graph.nodes.some(node => node.type === 'endpoint' && node.name === 'GET /activity/goldenEgg/getGoldenEggReward'));
    assert.ok(graph.nodes.some(node => node.type === 'route' && node.name === 'reqSyncTable'));
    assert.ok(graph.nodes.some(node => node.type === 'route' && node.name === 'pkroom.handler.tableMsg'));
    assert.ok(graph.nodes.some(node => node.type === 'table' && node.name === 'tbUserAccount'));
    assert.ok(graph.nodes.some(node => node.type === 'table' && node.name === 'goldenEggLotteryRecordTable'));
    assert.ok(graph.nodes.some(node => node.type === 'table' && node.name === 'goldenEggUserInfoTable'));

    const nestedCwd = path.join(tempRoot, 'app', 'http', 'routes', 'activity');
    const endpointTraversal = namesFromTraversal(
        runWithCapturedOutput(queryChainKb, ['--feature', 'pinus-sample', '--from', 'GET /activity/goldenEgg/getGoldenEggReward', '--direction', 'downstream', '--depth', '3', '--json'], nestedCwd)
    );
    assert.ok(endpointTraversal.includes('goldenEgg.http_get_activity_goldenegg_getgoldeneggreward'));
    assert.ok(endpointTraversal.includes('goldenEgg.getGoldenEggReward'));

    const routeTraversal = namesFromTraversal(
        runWithCapturedOutput(queryChainKb, ['--feature', 'pinus-sample', '--from', 'reqSyncTable', '--direction', 'downstream', '--depth', '2', '--json'], nestedCwd)
    );
    assert.ok(routeTraversal.includes('TableMsg.reqSyncTable'));

    const methodTraversal = namesFromTraversal(
        runWithCapturedOutput(queryChainKb, ['--feature', 'pinus-sample', '--from', 'goldenEgg.getGoldenEggReward', '--direction', 'downstream', '--depth', '3', '--json'], nestedCwd)
    );
    assert.ok(methodTraversal.includes('tbUserAccount'));
    assert.ok(methodTraversal.includes('goldenEggLotteryRecordTable'));
    assert.ok(methodTraversal.includes('goldenEggUserInfoTable'));
    assert.ok(methodTraversal.includes('Rpc.updateUserAsset'));

    const registry = readJson(path.join(tempRoot, 'project-memory', 'state', 'feature-registry.json'));
    const featureIndex = readJson(path.join(tempRoot, 'project-memory', 'kb', 'indexes', 'features.json'));
    assert.equal(registry.features[0].featureKey, 'pinus-sample');
    assert.equal(featureIndex.features[0].featureKey, 'pinus-sample');
}

function runQyserverAssertions() {
    const qyserverRoot = 'E:/xile/qyserver/game-server';
    if (!fs.existsSync(qyserverRoot)) {
        console.log('qyserver integration skipped: E:/xile/qyserver/game-server not found');
        return;
    }

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-qyserver-'));
    fs.mkdirSync(path.join(tempRoot, 'project-memory', 'state'), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, 'project-memory', 'docs', 'features', 'backend-core'), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, 'project-memory', 'state', 'feature-registry.json'), '{\n  "generatedAt": null,\n  "features": []\n}\n');
    fs.writeFileSync(
        path.join(tempRoot, 'project-memory', 'state', 'project-profile.json'),
        `${JSON.stringify({
            areas: {
                backend: [path.join(qyserverRoot, 'app')],
                data: [path.join(qyserverRoot, 'app', 'db', 'schema')],
            },
            stacks: {
                backend: ['node', 'pinus'],
                data: ['mysql', 'drizzle'],
            },
        }, null, 2)}\n`
    );
    fs.writeFileSync(path.join(tempRoot, 'project-memory', 'docs', 'features', 'backend-core', 'FEATURE.md'), '# Backend Core\n');
    fs.writeFileSync(
        path.join(tempRoot, 'qyserver-backend.json'),
        `${JSON.stringify({
            featureName: 'Backend Core',
            featureKey: 'backend-core',
            summary: 'External qyserver validation',
            extractorAdapter: 'pinus',
            areas: ['backend', 'data'],
            scanTargets: {
                handlers: [path.join(qyserverRoot, 'app', 'servers', 'pkroom', 'handler', 'handler.ts')],
                remotes: [path.join(qyserverRoot, 'app', 'servers', 'pkplayer', 'remote', 'Rpc.ts')],
                modules: [path.join(qyserverRoot, 'app', 'modules', 'activity', 'goldenEgg.ts'), path.join(qyserverRoot, 'app', 'servers', 'pkroom', 'games', 'modules', 'TableMsg.ts')],
                routes: [path.join(qyserverRoot, 'app', 'http', 'routes', 'activity', 'goldenEgg.ts')],
                schemas: [
                    path.join(qyserverRoot, 'app', 'db', 'schema', 'activity', 'goldenEggLotteryRecordSchema.ts'),
                    path.join(qyserverRoot, 'app', 'db', 'schema', 'activity', 'goldenEggUserInfoSchema.ts'),
                    path.join(qyserverRoot, 'app', 'db', 'schema', 'users.ts'),
                ],
            },
            outputs: {
                scan: 'project-memory/kb/features/backend-core/scan.raw.json',
                graph: 'project-memory/kb/features/backend-core/chain.graph.json',
                lookup: 'project-memory/kb/features/backend-core/chain.lookup.json',
                report: 'project-memory/kb/features/backend-core/build.report.json',
            },
            docs: {
                featureDir: 'project-memory/docs/features/backend-core',
                featureIndex: 'project-memory/docs/features/backend-core/FEATURE.md',
            },
        }, null, 2)}\n`
    );

    runWithCapturedOutput(buildChainKb, ['--root', tempRoot, '--config', 'qyserver-backend.json'], repoRoot);

    const nestedCwd = path.join(tempRoot, 'nested', 'check');
    fs.mkdirSync(nestedCwd, { recursive: true });

    const methodTraversal = namesFromTraversal(
        runWithCapturedOutput(queryChainKb, ['--feature', 'backend-core', '--from', 'goldenEgg.getGoldenEggReward', '--direction', 'downstream', '--depth', '3', '--json'], nestedCwd)
    );
    assert.ok(methodTraversal.includes('tbUserAccount'));
    assert.ok(methodTraversal.includes('goldenEggLotteryRecordTable'));
    assert.ok(methodTraversal.includes('goldenEggUserInfoTable'));
    assert.ok(methodTraversal.includes('Rpc.updateUserAsset'));

    const roomTraversal = namesFromTraversal(
        runWithCapturedOutput(queryChainKb, ['--feature', 'backend-core', '--from', 'reqSyncTable', '--direction', 'downstream', '--depth', '2', '--json'], nestedCwd)
    );
    assert.ok(roomTraversal.includes('TableMsg.reqSyncTable'));
}

try {
    runFixtureAssertions();
    runQyserverAssertions();
    console.log('pinus-backend validation passed');
} catch (error) {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exit(1);
}
