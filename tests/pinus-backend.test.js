const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const fixtureRoot = path.join(__dirname, 'fixtures', 'pinus-sample');
const { run: buildChainKb } = require('../scripts/build_chain_kb');
const { run: queryChainKb } = require('../scripts/query_chain_kb');
const { loadSkillVersion, run: showSkillVersion } = require('../scripts/show_skill_version');
const { validateSkillVersion } = require('../scripts/validate_skill_package');

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

function parseTraversal(output) {
    return JSON.parse(output);
}

function runVersionAssertions() {
    const versionInfo = loadSkillVersion(repoRoot);
    assert.equal(versionInfo.name, 'project-memory-manager');
    assert.equal(versionInfo.version, '0.2.0');
    assert.ok(Array.isArray(versionInfo.capabilities) && versionInfo.capabilities.length > 0);

    const textOutput = runWithCapturedOutput(showSkillVersion, ['--text', repoRoot], repoRoot);
    assert.ok(textOutput.includes('project-memory-manager@0.2.0'));
    assert.ok(textOutput.includes('capabilities:'));

    const missingVersionCheck = validateSkillVersion(fixtureRoot, 'project-memory-manager');
    assert.equal(missingVersionCheck.valid, false);
    assert.ok(missingVersionCheck.message.includes('旧版安装副本'));
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
    assert.ok(graph.nodes.some(node => node.type === 'event' && node.name === 'tableSynced'));
    assert.ok(graph.nodes.some(node => node.type === 'state' && node.meta?.statePath === 'syncState'));

    const nestedCwd = path.join(tempRoot, 'app', 'http', 'routes', 'activity');
    const endpointTraversal = namesFromTraversal(
        runWithCapturedOutput(queryChainKb, ['--feature', 'pinus-sample', '--from', 'GET /activity/goldenEgg/getGoldenEggReward', '--direction', 'downstream', '--depth', '3', '--json'], nestedCwd)
    );
    assert.ok(endpointTraversal.includes('goldenEgg.http_get_activity_goldenegg_getgoldeneggreward'));
    assert.ok(endpointTraversal.includes('goldenEgg.getGoldenEggReward'));

    const explicitAliasTraversal = parseTraversal(
        runWithCapturedOutput(queryChainKb, ['--feature', 'pinus-sample', '--downstream', 'GET /activity/goldenEgg/getGoldenEggReward', '--depth', '3', '--json'], nestedCwd)
    );
    assert.equal(explicitAliasTraversal.inputQuery, 'GET /activity/goldenEgg/getGoldenEggReward');
    assert.equal(explicitAliasTraversal.resolvedStart?.name, 'GET /activity/goldenEgg/getGoldenEggReward');
    assert.deepEqual(
        explicitAliasTraversal.traversal.map(item => item.node?.name).filter(Boolean),
        endpointTraversal
    );

    const routeTraversal = namesFromTraversal(
        runWithCapturedOutput(queryChainKb, ['--feature', 'pinus-sample', '--downstream', 'reqSyncTable', '--depth', '2', '--json'], nestedCwd)
    );
    assert.ok(routeTraversal.includes('TableMsg.reqSyncTable'));

    const methodTraversal = namesFromTraversal(
        runWithCapturedOutput(queryChainKb, ['--feature', 'pinus-sample', '--from', 'goldenEgg.getGoldenEggReward', '--direction', 'downstream', '--depth', '3', '--json'], nestedCwd)
    );
    assert.ok(methodTraversal.includes('tbUserAccount'));
    assert.ok(methodTraversal.includes('goldenEggLotteryRecordTable'));
    assert.ok(methodTraversal.includes('goldenEggUserInfoTable'));
    assert.ok(methodTraversal.includes('Rpc.updateUserAsset'));

    const typedMethodTraversal = parseTraversal(
        runWithCapturedOutput(queryChainKb, ['--feature', 'pinus-sample', '--method', 'getGoldenEggReward', '--downstream', '--depth', '3', '--json'], nestedCwd)
    );
    assert.equal(typedMethodTraversal.inputQuery, 'getGoldenEggReward');
    assert.equal(typedMethodTraversal.resolvedStart?.name, 'goldenEgg.getGoldenEggReward');
    assert.ok(typedMethodTraversal.traversal.some(item => item.node?.name === 'tbUserAccount'));

    const typedMethodUpstream = namesFromTraversal(
        runWithCapturedOutput(queryChainKb, ['--feature', 'pinus-sample', '--method', 'getGoldenEggReward', '--upstream', '--depth', '2', '--json'], nestedCwd)
    );
    assert.ok(typedMethodUpstream.includes('GET /activity/goldenEgg/getGoldenEggReward'));

    const typedRequestUpstream = namesFromTraversal(
        runWithCapturedOutput(queryChainKb, ['--feature', 'pinus-sample', '--request', 'pkplayer.Rpc.updateUserAsset', '--upstream', '--depth', '2', '--json'], nestedCwd)
    );
    assert.ok(typedRequestUpstream.includes('goldenEgg.getGoldenEggReward'));

    const typedEventUpstream = namesFromTraversal(
        runWithCapturedOutput(queryChainKb, ['--feature', 'pinus-sample', '--event', 'tableSynced', '--upstream', '--depth', '2', '--json'], nestedCwd)
    );
    assert.ok(typedEventUpstream.includes('TableMsg.reqSyncTable'));
    assert.ok(typedEventUpstream.includes('TableMsg.init'));

    const typedStateUpstream = namesFromTraversal(
        runWithCapturedOutput(queryChainKb, ['--feature', 'pinus-sample', '--state', 'syncState', '--upstream', '--depth', '2', '--json'], nestedCwd)
    );
    assert.ok(typedStateUpstream.includes('TableMsg.reqSyncTable'));
    assert.ok(typedStateUpstream.includes('TableMsg.handleTableSynced'));

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
    runVersionAssertions();
    runFixtureAssertions();
    runQyserverAssertions();
    console.log('pinus-backend validation passed');
} catch (error) {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exit(1);
}
