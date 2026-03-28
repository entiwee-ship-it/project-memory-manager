const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const pinusFixtureRoot = path.join(__dirname, 'fixtures', 'pinus-sample');
const cocosFixtureRoot = path.join(__dirname, 'fixtures', 'cocos-http-sample');
const { run: buildChainKb } = require('../scripts/build_chain_kb');
const { run: queryChainKb } = require('../scripts/query_chain_kb');
const { run: queryKb } = require('../scripts/query_kb');
const { run: rebuildKbs } = require('../scripts/rebuild_kbs');
const { run: refreshMemoryIndexes } = require('../scripts/refresh_memory_indexes');
const { detectInstallContext, loadSkillVersion, run: showSkillVersion } = require('../scripts/show_skill_version');
const { validateSkillVersion } = require('../scripts/validate_skill_package');

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function runWithCapturedOutput(fn, args, cwd) {
    const originalCwd = process.cwd();
    const originalLog = console.log;
    const originalWarn = console.warn;
    const logs = [];

    try {
        process.chdir(cwd);
        console.log = (...values) => {
            logs.push(values.map(value => String(value)).join(' '));
        };
        console.warn = (...values) => {
            logs.push(values.map(value => String(value)).join(' '));
        };
        fn(args);
        return logs.join('\n');
    } finally {
        console.log = originalLog;
        console.warn = originalWarn;
        process.chdir(originalCwd);
    }
}

function copyFixtureToTemp(fixtureRoot, prefix) {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    fs.cpSync(fixtureRoot, tempRoot, { recursive: true });
    return tempRoot;
}

function buildFixture(tempRoot, configName, featureKey) {
    runWithCapturedOutput(buildChainKb, ['--root', tempRoot, '--config', configName], repoRoot);
    return {
        graph: readJson(path.join(tempRoot, 'project-memory', 'kb', 'features', featureKey, 'chain.graph.json')),
        report: readJson(path.join(tempRoot, 'project-memory', 'kb', 'features', featureKey, 'build.report.json')),
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
    assert.equal(versionInfo.version, '0.5.0');
    assert.ok(Array.isArray(versionInfo.capabilities) && versionInfo.capabilities.length > 0);
    assert.equal(versionInfo.upgradePolicy, 'edit-source-repo-only');
    assert.ok(String(versionInfo.rebuildCommand || '').includes('rebuild_kbs.js'));

    const textOutput = runWithCapturedOutput(showSkillVersion, ['--text', repoRoot], repoRoot);
    assert.ok(textOutput.includes('project-memory-manager@0.5.0'));
    assert.ok(textOutput.includes('capabilities:'));
    assert.ok(textOutput.includes('upgradePolicy: edit-source-repo-only'));
    assert.ok(textOutput.includes('postUpdateRebuild:'));

    assert.equal(detectInstallContext(path.join(repoRoot, '.codex', 'skills', 'project-memory-manager')), 'installed-copy');

    const missingVersionCheck = validateSkillVersion(pinusFixtureRoot, 'project-memory-manager');
    assert.equal(missingVersionCheck.valid, false);
    assert.ok(missingVersionCheck.message.includes('旧版安装副本'));
}

function runFixtureAssertions() {
    const tempRoot = copyFixtureToTemp(pinusFixtureRoot, 'pmm-pinus-');
    const { graph, report } = buildFixture(tempRoot, 'pinus-kb.json', 'pinus-sample');

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

    const featureSummary = parseTraversal(
        runWithCapturedOutput(queryKb, ['--feature', 'pinus-sample', '--json'], nestedCwd)
    );
    assert.equal(featureSummary.kind, 'feature-summary');
    assert.equal(featureSummary.feature.featureKey, 'pinus-sample');
    assert.ok(featureSummary.counts.nodes > 0);
    assert.ok(featureSummary.purpose.includes('默认查询入口'));
    assert.ok(Array.isArray(featureSummary.defaultWorkflow) && featureSummary.defaultWorkflow.length >= 3);
    assert.ok(Array.isArray(featureSummary.artifacts) && featureSummary.artifacts.some(item => item.key === 'entrypoint' && item.file === 'scripts/query_kb.js'));
    assert.ok(Array.isArray(featureSummary.examples) && featureSummary.examples.length > 0);
    assert.ok(featureSummary.examples.some(item => item.includes('scripts/query_kb.js')));
    assert.equal(featureSummary.kbVersionStatus.builtWithSkill.version, '0.5.0');
    assert.equal(featureSummary.kbVersionStatus.stale, false);

    const featureSummaryText = runWithCapturedOutput(queryKb, ['--feature', 'pinus-sample'], nestedCwd);
    assert.ok(featureSummaryText.includes('scripts/query_kb.js'));
    assert.ok(featureSummaryText.includes('build.report.json'));
    assert.ok(featureSummaryText.includes('builtWithSkill: project-memory-manager@0.5.0'));

    assert.equal(report.kind, 'kb-build-report');
    assert.ok(report.purpose.includes('构建汇总'));
    assert.equal(report.builtWithSkill.version, '0.5.0');
    assert.ok(Array.isArray(report.queryExamples) && report.queryExamples.some(item => item.includes('scripts/query_kb.js')));
    assert.ok(String(report.postSkillUpdateAction || '').includes('rebuild_kbs.js'));
    assert.ok(Array.isArray(report.artifacts) && report.artifacts.some(item => item.key === 'lookup'));
    assert.ok(report.counts.nodesByType.method > 0);

    const registry = readJson(path.join(tempRoot, 'project-memory', 'state', 'feature-registry.json'));
    const featureIndex = readJson(path.join(tempRoot, 'project-memory', 'kb', 'indexes', 'features.json'));
    assert.equal(registry.features[0].featureKey, 'pinus-sample');
    assert.equal(featureIndex.features[0].featureKey, 'pinus-sample');
}

function runFrontendHttpAssertions() {
    const tempRoot = copyFixtureToTemp(cocosFixtureRoot, 'pmm-cocos-');
    const { graph } = buildFixture(tempRoot, 'cocos-http-kb.json', 'cocos-http-sample');

    const payApiMethod = graph.nodes.find(node => node.type === 'method' && node.name === 'PayApi.getOrderPayment');
    assert.ok(payApiMethod);

    const requestNames = graph.nodes.filter(node => node.type === 'request').map(node => node.name);
    assert.ok(requestNames.includes('POST /order/pay/getOrderPayment'));
    assert.ok(requestNames.includes('PUT /direct/request'));
    assert.ok(requestNames.includes('POST /direct/fetch'));
    assert.ok(requestNames.includes('GET /direct/axios'));
    assert.ok(requestNames.includes('DELETE /direct/axios-call'));

    const payRequestNode = graph.nodes.find(node => node.type === 'request' && node.name === 'POST /order/pay/getOrderPayment');
    assert.equal(payRequestNode.meta?.protocol, 'http');
    assert.equal(payRequestNode.meta?.httpMethod, 'POST');
    assert.equal(payRequestNode.meta?.transport, 'http-client');

    const nestedCwd = path.join(tempRoot, 'assets', 'script', 'platform', 'service');
    const paymentTraversal = namesFromTraversal(
        runWithCapturedOutput(queryChainKb, ['--feature', 'cocos-http-sample', '--method', 'checkPaymentStatus', '--downstream', '--depth', '3', '--json'], nestedCwd)
    );
    assert.ok(paymentTraversal.includes('PayApi.getOrderPayment'));
    assert.ok(paymentTraversal.includes('POST /order/pay/getOrderPayment'));

    const payRequestUpstream = namesFromTraversal(
        runWithCapturedOutput(queryChainKb, ['--feature', 'cocos-http-sample', '--request', 'POST /order/pay/getOrderPayment', '--upstream', '--depth', '2', '--json'], nestedCwd)
    );
    assert.ok(payRequestUpstream.includes('PayApi.getOrderPayment'));

    const directRequestTraversal = namesFromTraversal(
        runWithCapturedOutput(queryChainKb, ['--feature', 'cocos-http-sample', '--method', 'runDirectRequests', '--downstream', '--depth', '3', '--json'], nestedCwd)
    );
    assert.ok(directRequestTraversal.includes('DirectHttpApi.sendInlineRequest'));
    assert.ok(directRequestTraversal.includes('PUT /direct/request'));
    assert.ok(directRequestTraversal.includes('POST /direct/fetch'));
    assert.ok(directRequestTraversal.includes('GET /direct/axios'));
    assert.ok(directRequestTraversal.includes('DELETE /direct/axios-call'));

    const requestSearch = parseTraversal(
        runWithCapturedOutput(queryChainKb, ['--feature', 'cocos-http-sample', '--type', 'request', '--name', 'getOrderPayment', '--json'], nestedCwd)
    );
    assert.ok(Array.isArray(requestSearch) && requestSearch.some(item => item.requestHttpMethod === 'POST' && item.requestTransport === 'http-client'));
}

function runRebuildAssertions() {
    const tempRoot = copyFixtureToTemp(pinusFixtureRoot, 'pmm-rebuild-');
    buildFixture(tempRoot, 'pinus-kb.json', 'pinus-sample');

    const graphPath = path.join(tempRoot, 'project-memory', 'kb', 'features', 'pinus-sample', 'chain.graph.json');
    const lookupPath = path.join(tempRoot, 'project-memory', 'kb', 'features', 'pinus-sample', 'chain.lookup.json');
    const reportPath = path.join(tempRoot, 'project-memory', 'kb', 'features', 'pinus-sample', 'build.report.json');
    const staleGraph = readJson(graphPath);
    const staleLookup = readJson(lookupPath);
    const staleReport = readJson(reportPath);
    staleGraph.builtWithSkill = { name: 'project-memory-manager', version: '0.0.0', repo: staleGraph.builtWithSkill?.repo || '' };
    staleLookup.builtWithSkill = { name: 'project-memory-manager', version: '0.0.0', repo: staleLookup.builtWithSkill?.repo || '' };
    staleReport.builtWithSkill = { name: 'project-memory-manager', version: '0.0.0', repo: staleReport.builtWithSkill?.repo || '' };
    fs.writeFileSync(graphPath, `${JSON.stringify(staleGraph, null, 2)}\n`);
    fs.writeFileSync(lookupPath, `${JSON.stringify(staleLookup, null, 2)}\n`);
    fs.writeFileSync(reportPath, `${JSON.stringify(staleReport, null, 2)}\n`);

    const nestedCwd = path.join(tempRoot, 'app', 'http', 'routes', 'activity');
    const staleSummaryText = runWithCapturedOutput(queryKb, ['--feature', 'pinus-sample'], nestedCwd);
    assert.ok(staleSummaryText.includes('[stale-kb]'));
    assert.ok(staleSummaryText.includes('rebuild_kbs.js'));

    const rebuildLogs = runWithCapturedOutput(rebuildKbs, ['--root', tempRoot], repoRoot);
    assert.ok(rebuildLogs.includes('重建 KB:'));
    assert.ok(rebuildLogs.includes('KB 重建完成: 1 个 feature'));

    const rebuiltGraph = readJson(graphPath);
    const rebuiltReport = readJson(reportPath);
    assert.equal(rebuiltGraph.builtWithSkill.version, '0.5.0');
    assert.equal(rebuiltReport.builtWithSkill.version, '0.5.0');
}

function runLegacyCompatibilityAssertions() {
    const tempRoot = copyFixtureToTemp(pinusFixtureRoot, 'pmm-pinus-');
    const legacyConfigPath = path.join(tempRoot, 'legacy-kb.json');
    fs.writeFileSync(
        legacyConfigPath,
        `${JSON.stringify({
            key: 'legacy-pinus',
            name: 'Legacy Pinus',
            outputDir: 'project-memory/kb/features/legacy-pinus',
            extractorAdapter: 'pinus',
            areas: ['backend', 'data'],
            scanTargets: {
                handlers: ['app/servers/*/handler/*.ts'],
                remotes: ['app/servers/*/remote/*.ts'],
                modules: ['app/modules/**/*.ts', 'app/servers/pkroom/games/modules/TableMsg.ts'],
                routes: ['app/http/routes/**/*.ts'],
                schemas: ['app/db/schema/**/*.ts'],
            },
            docs: {
                featureDir: 'project-memory/docs/features/legacy-pinus',
                featureIndex: 'project-memory/docs/features/legacy-pinus/FEATURE.md',
            },
        }, null, 2)}\n`
    );
    fs.mkdirSync(path.join(tempRoot, 'project-memory', 'docs', 'features', 'legacy-pinus'), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, 'project-memory', 'docs', 'features', 'legacy-pinus', 'FEATURE.md'), '# Legacy Pinus\n');

    const buildLogs = runWithCapturedOutput(buildChainKb, ['--root', tempRoot, '--config', 'legacy-kb.json'], repoRoot);
    assert.ok(buildLogs.includes('[deprecated]'));
    assert.ok(fs.existsSync(path.join(tempRoot, 'project-memory', 'kb', 'features', 'legacy-pinus', 'chain.graph.json')));
    assert.ok(fs.existsSync(path.join(tempRoot, 'project-memory', 'kb', 'features', 'legacy-pinus', 'graph.json')));
    assert.ok(fs.existsSync(path.join(tempRoot, 'project-memory', 'kb', 'features', 'legacy-pinus', 'chain.lookup.json')));
    assert.ok(fs.existsSync(path.join(tempRoot, 'project-memory', 'kb', 'features', 'legacy-pinus', 'lookup.json')));

    const nestedCwd = path.join(tempRoot, 'app', 'http', 'routes', 'activity');
    const legacySummary = parseTraversal(
        runWithCapturedOutput(queryChainKb, ['--feature', 'legacy-pinus', '--json'], nestedCwd)
    );
    assert.equal(legacySummary.kind, 'feature-summary');

    const legacyRegistryPath = path.join(tempRoot, 'project-memory', 'state', 'feature-registry.json');
    fs.writeFileSync(
        legacyRegistryPath,
        `${JSON.stringify({
            generatedAt: null,
            features: [
                {
                    key: 'legacy-registry',
                    name: 'Legacy Registry',
                    graphPath: 'project-memory/kb/features/legacy-pinus/graph.json',
                    lookupPath: 'project-memory/kb/features/legacy-pinus/lookup.json',
                },
            ],
        }, null, 2)}\n`
    );

    const legacyRegistryTraversal = namesFromTraversal(
        runWithCapturedOutput(queryChainKb, ['--feature', 'legacy-registry', '--downstream', 'GET /activity/goldenEgg/getGoldenEggReward', '--depth', '3', '--json'], nestedCwd)
    );
    assert.ok(legacyRegistryTraversal.includes('goldenEgg.getGoldenEggReward'));

    const configDir = path.join(tempRoot, 'project-memory', 'kb', 'configs');
    fs.mkdirSync(configDir, { recursive: true });
    fs.copyFileSync(legacyConfigPath, path.join(configDir, 'legacy-kb.json'));
    runWithCapturedOutput(refreshMemoryIndexes, ['--root', tempRoot], repoRoot);
    const refreshedRegistry = readJson(legacyRegistryPath);
    assert.ok(refreshedRegistry.features.some(feature => feature.featureKey === 'legacy-pinus'));
    assert.ok(!refreshedRegistry.features.some(feature => feature.key));

    const missingFieldConfigPath = path.join(tempRoot, 'invalid-kb.json');
    fs.writeFileSync(missingFieldConfigPath, '{\n  "type": "domain"\n}\n');
    assert.throws(
        () => runWithCapturedOutput(buildChainKb, ['--root', tempRoot, '--config', 'invalid-kb.json'], repoRoot),
        /KB 配置缺少必要字段/
    );
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
    runFrontendHttpAssertions();
    runRebuildAssertions();
    runLegacyCompatibilityAssertions();
    runQyserverAssertions();
    console.log('pinus-backend validation passed');
} catch (error) {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exit(1);
}
