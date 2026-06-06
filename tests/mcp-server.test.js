const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { handleMcpRequest } = require('../src/mcp/server');
const { buildLookup } = require('../src/graph/build-chain-kb');
const { createWorkspaceContext } = require('../src/shared/workspace-layout');

function makeWorkspace(prefix = 'pmm-mcp-workspace-') {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-mcp-data-'));
    return { workspaceRoot, dataRoot };
}

function parseTextResult(response) {
    assert.equal(response.jsonrpc, '2.0');
    assert.ok(response.result);
    assert.ok(Array.isArray(response.result.content));
    assert.equal(response.result.content[0].type, 'text');
    return JSON.parse(response.result.content[0].text);
}

async function callTool(name, args, id = Math.floor(Math.random() * 100000)) {
    return handleMcpRequest({
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: {
            name,
            arguments: args,
        },
    });
}

function writeWebsiteWorkspace(workspaceRoot) {
    const websiteRoot = path.join(workspaceRoot, 'official-website');
    fs.mkdirSync(path.join(websiteRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(websiteRoot, 'package.json'), JSON.stringify({
        dependencies: {
            vue: '^3.5.0',
            'vue-router': '^4.0.0',
        },
        devDependencies: {
            vite: '^7.0.0',
            '@vitejs/plugin-vue': '^6.0.0',
        },
    }, null, 2));
    fs.writeFileSync(path.join(websiteRoot, 'src', 'main.js'), 'export function mountApp(){ return "ok"; }\n');
}

function writeFeatureDiscoveryWorkspace(workspaceRoot) {
    writeWebsiteWorkspace(workspaceRoot);
    const serverRoot = path.join(workspaceRoot, 'qy-server', 'game-server');
    const routeRoot = path.join(serverRoot, 'app', 'http', 'routes', 'activity');
    fs.mkdirSync(routeRoot, { recursive: true });
    fs.writeFileSync(path.join(serverRoot, 'package.json'), JSON.stringify({
        dependencies: {
            express: '^4.18.0',
            pinus: '^2.0.0',
        },
    }, null, 2));
    fs.writeFileSync(path.join(routeRoot, 'goldenEgg.ts'), [
        'import express from "express";',
        'const router = express.Router();',
        'router.get("/activity/goldenEgg/getActivityInfo", function getActivityInfo(req, res) {',
        '  res.json({ ok: true });',
        '});',
        'export default router;',
        '',
    ].join('\n'));
}

function writeAmbiguousFeatureKb(workspaceRoot, dataRoot) {
    const context = createWorkspaceContext({
        workspaceRoot,
        dataRoot,
        layout: 'external-data',
    });
    const featureKey = 'ambiguous-entrypoints';
    const kbDir = path.join(context.paths.featuresDir, featureKey);
    fs.mkdirSync(kbDir, { recursive: true });
    fs.mkdirSync(context.paths.stateDir, { recursive: true });
    const graph = {
        featureKey,
        featureName: 'Ambiguous Entrypoints',
        nodes: [
            {
                id: 'endpoint:club:create',
                type: 'endpoint',
                name: 'POST /club/createClub',
                file: 'app/http/routes/club.ts',
                line: 12,
                area: 'backend',
                meta: { method: 'POST', path: '/club/createClub', tags: ['createclub', 'club'] },
            },
            {
                id: 'route:club:create',
                type: 'route',
                name: 'pkplayer.Rpc.createClub',
                file: 'app/servers/pkplayer/remote/Rpc.ts',
                line: 31,
                area: 'backend',
                meta: { route: 'pkplayer.Rpc.createClub', kind: 'pinus-remote', protocol: 'pinus-rpc', tags: ['createclub', 'club'] },
            },
            {
                id: 'method:club:handler',
                type: 'method',
                name: 'ClubService.handleCreateClub',
                file: 'app/modules/club/ClubService.ts',
                line: 50,
                area: 'backend',
                meta: { methodName: 'handleCreateClub', tags: ['createclub', 'club'] },
            },
        ],
        edges: [],
    };
    const lookup = buildLookup(graph);
    fs.writeFileSync(path.join(kbDir, 'chain.graph.json'), `${JSON.stringify(graph, null, 2)}\n`);
    fs.writeFileSync(path.join(kbDir, 'chain.lookup.json'), `${JSON.stringify(lookup, null, 2)}\n`);
    fs.writeFileSync(
        context.paths.featureRegistry,
        `${JSON.stringify({
            generatedAt: '2026-06-03T00:00:00.000Z',
            features: [
                {
                    featureKey,
                    featureName: 'Ambiguous Entrypoints',
                    kbDir,
                    outputs: {
                        graph: path.join(kbDir, 'chain.graph.json'),
                        lookup: path.join(kbDir, 'chain.lookup.json'),
                    },
                },
            ],
        }, null, 2)}\n`
    );
    return featureKey;
}

async function testToolsList() {
    const response = await handleMcpRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
    });
    assert.equal(response.id, 1);
    assert.equal(Array.isArray(response.result.tools), true);
    const names = response.result.tools.map(tool => tool.name);
    for (const expectedName of [
        'inspect_workspace',
        'get_current_state',
        'init_workspace',
        'detect_topology',
        'diagnose_workspace',
        'check_kb_freshness',
        'build_project_index',
        'start_build_project_index',
        'get_job_status',
        'get_job_result',
        'discover_features',
        'build_feature_index',
        'query_project_chain',
        'query_feature_chain',
    ]) {
        assert.ok(names.includes(expectedName), `missing MCP tool: ${expectedName}`);
    }
}

async function testInitialize() {
    const response = await handleMcpRequest({
        jsonrpc: '2.0',
        id: 2,
        method: 'initialize',
        params: {},
    });
    assert.equal(response.result.serverInfo.name, 'project-memory-manager');
    assert.equal(response.result.capabilities.tools.listChanged, false);
}

async function testDiagnoseUninitializedWorkspace() {
    const { workspaceRoot, dataRoot } = makeWorkspace();
    fs.writeFileSync(path.join(workspaceRoot, 'package.json'), '{"dependencies":{"vue":"latest","vite":"latest"}}\n');

    const response = await callTool('diagnose_workspace', { workspaceRoot, dataRoot });
    const result = parseTextResult(response);

    assert.equal(result.workspaceRoot, path.resolve(workspaceRoot));
    assert.equal(result.layout, 'external-data');
    assert.equal(result.initialized, false);
    assert.equal(result.hasProjectProfile, false);
    assert.equal(result.hasConfiguredAreaRoots, false);
    assert.equal(result.legacyProjectMemoryExists, false);
    assert.equal(fs.existsSync(path.join(workspaceRoot, 'project-memory')), false);
    assert.equal(result.suggestedNextAction, 'init_workspace');
}

async function testInitAndDetectTopologyViaMcp() {
    const { workspaceRoot, dataRoot } = makeWorkspace();
    writeWebsiteWorkspace(workspaceRoot);

    const initResponse = await callTool('init_workspace', { workspaceRoot, dataRoot, name: 'sample' });
    const initResult = parseTextResult(initResponse);
    assert.equal(initResult.initialized, true);
    assert.equal(initResult.hasConfiguredAreaRoots, false);
    assert.equal(initResult.suggestedNextAction, 'detect_topology');
    assert.equal(fs.existsSync(path.join(workspaceRoot, 'project-memory')), false);

    const topologyResponse = await callTool('detect_topology', { workspaceRoot, dataRoot });
    const topology = parseTextResult(topologyResponse);
    assert.ok(topology.areas.frontend.includes('official-website'));
    assert.equal(topology.hasConfiguredAreaRoots, true);
    assert.ok(topology.stacks.frontend.includes('vue'));
    assert.ok(topology.stacks.frontend.includes('vite'));
}

async function testDetectTopologyKeepsManualAreaRoots() {
    const { workspaceRoot, dataRoot } = makeWorkspace();
    writeWebsiteWorkspace(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'manual-tool', 'src'), { recursive: true });

    const initResponse = await callTool('init_workspace', { workspaceRoot, dataRoot, name: 'custom-name' });
    const initResult = parseTextResult(initResponse);
    const manualProfile = {
        projectName: 'custom-name',
        projectType: 'single-stack',
        areas: {
            frontend: [],
            backend: [],
            shared: ['manual-tool'],
            contract: [],
            data: [],
            ops: [],
        },
        stacks: {
            frontend: [],
            backend: [],
            shared: ['manual'],
            contract: [],
            data: [],
            ops: [],
        },
        integration: {
            primary: [],
            secondary: [],
        },
    };
    fs.writeFileSync(initResult.projectProfile, JSON.stringify(manualProfile, null, 2));

    const topologyResponse = await callTool('detect_topology', { workspaceRoot, dataRoot });
    const topology = parseTextResult(topologyResponse);

    assert.equal(topology.areas.frontend.includes('official-website'), true);
    assert.equal(topology.areas.shared.includes('manual-tool'), true);
    assert.equal(topology.stacks.shared.includes('manual'), true);

    const persisted = JSON.parse(fs.readFileSync(initResult.projectProfile, 'utf8'));
    assert.equal(persisted.projectName, 'custom-name');
    assert.equal(persisted.areas.shared.includes('manual-tool'), true);
}

async function testBuildProjectIndexAutoPreparesWorkspace() {
    const { workspaceRoot, dataRoot } = makeWorkspace();
    writeWebsiteWorkspace(workspaceRoot);

    const response = await callTool('build_project_index', { workspaceRoot, dataRoot, dryRun: false });
    const result = parseTextResult(response);

    assert.equal(result.initialized, true);
    assert.equal(result.hasProjectProfile, true);
    assert.equal(result.hasConfiguredAreaRoots, true);
    assert.equal(result.hasProjectGlobalKb, true);
    assert.ok(result.output.includes('项目全局 KB 已构建'));
    assert.equal(fs.existsSync(path.join(workspaceRoot, 'project-memory')), false);

    const queryResponse = await callTool('query_project_chain', { workspaceRoot, dataRoot });
    const summary = parseTextResult(queryResponse);
    assert.equal(summary.kind, 'project-summary');
    assert.equal(summary.project.layout, 'external-data');
}

async function testProjectFreshnessDetectsSourceChanges() {
    const { workspaceRoot, dataRoot } = makeWorkspace();
    writeWebsiteWorkspace(workspaceRoot);

    const buildResponse = await callTool('build_project_index', { workspaceRoot, dataRoot, dryRun: false });
    const built = parseTextResult(buildResponse);
    assert.equal(built.projectGlobalFreshness.status, 'fresh');
    assert.equal(built.projectGlobalFreshness.stale, false);

    const freshResponse = await callTool('check_kb_freshness', { workspaceRoot, dataRoot });
    const fresh = parseTextResult(freshResponse);
    assert.equal(fresh.projectGlobal.status, 'fresh');
    assert.equal(fresh.projectGlobal.stale, false);
    assert.equal(fresh.projectGlobal.reasonCodes.length, 0);

    fs.appendFileSync(path.join(workspaceRoot, 'official-website', 'src', 'main.js'), 'export function changed(){ return "changed"; }\n');

    const staleStateResponse = await callTool('get_current_state', { workspaceRoot, dataRoot });
    const staleState = parseTextResult(staleStateResponse);
    assert.equal(staleState.projectGlobalFreshness.status, 'stale');
    assert.equal(staleState.projectGlobalFreshness.stale, true);
    assert.ok(staleState.projectGlobalFreshness.reasonCodes.includes('source-files-changed'));
    assert.equal(staleState.suggestedNextAction, 'build_project_index');

    const staleResponse = await callTool('check_kb_freshness', { workspaceRoot, dataRoot });
    const stale = parseTextResult(staleResponse);
    assert.equal(stale.projectGlobal.status, 'stale');
    assert.ok(stale.projectGlobal.changedFiles.some(item => item.path.endsWith('official-website/src/main.js')));
    assert.equal(stale.projectGlobal.recommendedAction, 'build_project_index');
}

async function testProjectFreshnessUnknownWithoutSourceSnapshot() {
    const { workspaceRoot, dataRoot } = makeWorkspace();
    writeWebsiteWorkspace(workspaceRoot);

    await callTool('build_project_index', { workspaceRoot, dataRoot, dryRun: false });

    const context = createWorkspaceContext({
        workspaceRoot,
        dataRoot,
        layout: 'external-data',
    });
    const graphPath = path.join(context.paths.projectGlobalDir, 'chain.graph.json');
    const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
    delete graph.sourceSnapshot;
    fs.writeFileSync(graphPath, `${JSON.stringify(graph, null, 2)}\n`);

    const response = await callTool('check_kb_freshness', { workspaceRoot, dataRoot });
    const result = parseTextResult(response);
    assert.equal(result.projectGlobal.status, 'unknown');
    assert.equal(result.projectGlobal.stale, true);
    assert.ok(result.projectGlobal.reasonCodes.includes('missing-source-snapshot'));
    assert.equal(result.projectGlobal.recommendedAction, 'build_project_index');
}

async function testQueryProjectChainCacheInvalidatesOnKbMtime() {
    const { workspaceRoot, dataRoot } = makeWorkspace();
    writeWebsiteWorkspace(workspaceRoot);

    await callTool('build_project_index', { workspaceRoot, dataRoot, dryRun: false });

    const firstResponse = await callTool('query_project_chain', {
        workspaceRoot,
        dataRoot,
        type: 'method',
        name: 'mountApp',
        limit: 5000,
        freshnessPolicy: 'allow_stale',
    });
    const first = parseTextResult(firstResponse);
    assert.equal(first._mcpCache.hit, false);
    assert.equal(first._mcpQuery.limit, 100);
    assert.equal(first.kbFreshness.status, 'fresh');

    const secondResponse = await callTool('query_project_chain', {
        workspaceRoot,
        dataRoot,
        type: 'method',
        name: 'mountApp',
        limit: 5000,
        freshnessPolicy: 'allow_stale',
    });
    const second = parseTextResult(secondResponse);
    assert.equal(second._mcpCache.hit, true);
    assert.equal(second._mcpQuery.limit, 100);

    fs.appendFileSync(path.join(workspaceRoot, 'official-website', 'src', 'main.js'), 'export function cacheChanged(){ return "changed"; }\n');

    const sourceChangedResponse = await callTool('query_project_chain', {
        workspaceRoot,
        dataRoot,
        type: 'method',
        name: 'mountApp',
        limit: 5000,
        freshnessPolicy: 'allow_stale',
    });
    const sourceChanged = parseTextResult(sourceChangedResponse);
    assert.equal(sourceChanged._mcpCache.hit, false);
    assert.equal(sourceChanged._mcpCache.invalidatedBySource, true);
    assert.equal(sourceChanged.kbFreshness.status, 'stale');
    assert.ok(sourceChanged.kbFreshness.reasonCodes.includes('source-files-changed'));

    const context = createWorkspaceContext({
        workspaceRoot,
        dataRoot,
        layout: 'external-data',
    });
    const graphPath = path.join(context.paths.projectGlobalDir, 'chain.graph.json');
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(graphPath, later, later);

    const thirdResponse = await callTool('query_project_chain', {
        workspaceRoot,
        dataRoot,
        type: 'method',
        name: 'mountApp',
        limit: 5000,
        freshnessPolicy: 'allow_stale',
    });
    const third = parseTextResult(thirdResponse);
    assert.equal(third._mcpCache.hit, false);
    assert.equal(third._mcpCache.invalidatedByMtime, true);
}

async function testQueryProjectChainAutoRebuildsStaleKb() {
    const { workspaceRoot, dataRoot } = makeWorkspace();
    writeWebsiteWorkspace(workspaceRoot);

    await callTool('build_project_index', { workspaceRoot, dataRoot, dryRun: false });
    fs.appendFileSync(path.join(workspaceRoot, 'official-website', 'src', 'main.js'), 'export function autoRebuild(){ return "fresh"; }\n');

    const response = await callTool('query_project_chain', {
        workspaceRoot,
        dataRoot,
        type: 'method',
        name: 'autoRebuild',
    });
    const result = parseTextResult(response);

    assert.equal(Array.isArray(result.result), true);
    assert.equal(result.kbFreshness.status, 'fresh');
    assert.equal(result._mcpFreshness.policy, 'auto_rebuild');
    assert.equal(result._mcpFreshness.initialStatus, 'stale');
    assert.equal(result._mcpFreshness.rebuilt, true);
    assert.equal(result._mcpFreshness.finalStatus, 'fresh');
    assert.ok(result.result.some(match => match.name === 'main.autoRebuild'));
}

async function testQueryProjectChainRequireFreshBlocksStaleKb() {
    const { workspaceRoot, dataRoot } = makeWorkspace();
    writeWebsiteWorkspace(workspaceRoot);

    await callTool('build_project_index', { workspaceRoot, dataRoot, dryRun: false });
    fs.appendFileSync(path.join(workspaceRoot, 'official-website', 'src', 'main.js'), 'export function blockedByRequireFresh(){ return "stale"; }\n');

    const response = await callTool('query_project_chain', {
        workspaceRoot,
        dataRoot,
        type: 'method',
        name: 'blockedByRequireFresh',
        freshnessPolicy: 'require_fresh',
    });
    const result = parseTextResult(response);

    assert.equal(result.ok, false);
    assert.equal(result.error, 'KB_NOT_FRESH');
    assert.equal(result.kbFreshness.status, 'stale');
    assert.equal(result._mcpFreshness.policy, 'require_fresh');
    assert.equal(result._mcpFreshness.rebuilt, false);
    assert.equal(result._mcpFreshness.finalStatus, 'stale');
}

async function waitForJob(jobId, maxAttempts = 40) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const response = await callTool('get_job_status', { jobId });
        const result = parseTextResult(response);
        if (result.status === 'succeeded' || result.status === 'failed') {
            return result;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`job did not finish: ${jobId}`);
}

async function testAsyncBuildJob() {
    const { workspaceRoot, dataRoot } = makeWorkspace();
    writeWebsiteWorkspace(workspaceRoot);

    const startResponse = await callTool('start_build_project_index', { workspaceRoot, dataRoot });
    const started = parseTextResult(startResponse);
    assert.ok(started.jobId);
    assert.equal(started.status, 'queued');

    const finished = await waitForJob(started.jobId);
    assert.equal(finished.status, 'succeeded');
    assert.equal(finished.phase, 'done');

    const resultResponse = await callTool('get_job_result', { jobId: started.jobId });
    const result = parseTextResult(resultResponse);
    assert.equal(result.status, 'succeeded');
    assert.equal(result.hasProjectGlobalKb, true);
}

async function testDiscoverAndBuildFeatureIndexDryRun() {
    const { workspaceRoot, dataRoot } = makeWorkspace();
    writeFeatureDiscoveryWorkspace(workspaceRoot);

    await callTool('build_project_index', { workspaceRoot, dataRoot, dryRun: false });
    const discoverResponse = await callTool('discover_features', {
        workspaceRoot,
        dataRoot,
        limit: 5,
        minConfidence: 'low',
    });
    const discovered = parseTextResult(discoverResponse);
    assert.equal(discovered.kind, 'feature-discovery');
    assert.equal(discovered.candidateCount > 0, true);
    assert.ok(discovered.outputPath.endsWith('feature-candidates.json'));

    const featureKey = discovered.candidates[0].featureKey;
    const buildResponse = await callTool('build_feature_index', {
        workspaceRoot,
        dataRoot,
        featureKey,
        dryRun: true,
    });
    const result = parseTextResult(buildResponse);
    assert.equal(result.kind, 'feature-index-build');
    assert.equal(result.featureKey, featureKey);
    assert.equal(result.built, false);
    assert.equal(result.workspaceState.hasProjectGlobalKb, true);
    assert.equal(fs.existsSync(path.join(workspaceRoot, 'project-memory')), false);
}

async function testQueryFeatureChainViaMcp() {
    const { workspaceRoot, dataRoot } = makeWorkspace();
    const feature = writeAmbiguousFeatureKb(workspaceRoot, dataRoot);

    const summaryResponse = await callTool('query_feature_chain', {
        workspaceRoot,
        dataRoot,
        feature,
        freshnessPolicy: 'allow_stale',
    });
    const summary = parseTextResult(summaryResponse);
    assert.equal(summary.kind, 'feature-summary');
    assert.equal(summary.feature.featureKey, feature);

    const chainResponse = await callTool('query_feature_chain', {
        workspaceRoot,
        dataRoot,
        feature,
        downstream: true,
        from: 'createClub',
        freshnessPolicy: 'allow_stale',
    });
    const chain = parseTextResult(chainResponse);
    assert.ok(Array.isArray(chain.ambiguous));
    assert.ok(chain.recommendations);
    assert.ok(chain.recommendations.groups.some(group => group.key === 'http-endpoint'));
    assert.ok(chain.recommendations.groups.some(group => group.key === 'pinus-route'));
    assert.ok(chain.recommendations.groups.some(group => group.key === 'method'));
}

async function testQueryFeatureChainAutoRebuildsStaleKb() {
    const { workspaceRoot, dataRoot } = makeWorkspace();
    writeFeatureDiscoveryWorkspace(workspaceRoot);

    await callTool('build_project_index', { workspaceRoot, dataRoot, dryRun: false });
    const discoverResponse = await callTool('discover_features', {
        workspaceRoot,
        dataRoot,
        limit: 5,
        minConfidence: 'low',
    });
    const discovered = parseTextResult(discoverResponse);
    const featureKey = discovered.candidates[0].featureKey;
    await callTool('build_feature_index', {
        workspaceRoot,
        dataRoot,
        featureKey,
        dryRun: false,
    });

    fs.appendFileSync(path.join(workspaceRoot, 'qy-server', 'game-server', 'app', 'http', 'routes', 'activity', 'goldenEgg.ts'), [
        'export function autoFeatureRebuild(){ return "fresh"; }',
        '',
    ].join('\n'));

    const response = await callTool('query_feature_chain', {
        workspaceRoot,
        dataRoot,
        feature: featureKey,
        type: 'method',
        name: 'autoFeatureRebuild',
    });
    const result = parseTextResult(response);

    assert.equal(Array.isArray(result.result), true);
    assert.equal(result.kbFreshness.status, 'fresh');
    assert.equal(result._mcpFreshness.policy, 'auto_rebuild');
    assert.equal(result._mcpFreshness.initialStatus, 'stale');
    assert.equal(result._mcpFreshness.rebuilt, true);
    assert.equal(result._mcpFreshness.finalStatus, 'fresh');
    assert.ok(result.result.some(match => match.name.endsWith('.autoFeatureRebuild')));
}

Promise.all([
    testInitialize(),
    testToolsList(),
    testDiagnoseUninitializedWorkspace(),
    testInitAndDetectTopologyViaMcp(),
    testDetectTopologyKeepsManualAreaRoots(),
    testBuildProjectIndexAutoPreparesWorkspace(),
    testProjectFreshnessDetectsSourceChanges(),
    testProjectFreshnessUnknownWithoutSourceSnapshot(),
    testQueryProjectChainCacheInvalidatesOnKbMtime(),
    testQueryProjectChainAutoRebuildsStaleKb(),
    testQueryProjectChainRequireFreshBlocksStaleKb(),
    testAsyncBuildJob(),
    testDiscoverAndBuildFeatureIndexDryRun(),
    testQueryFeatureChainViaMcp(),
    testQueryFeatureChainAutoRebuildsStaleKb(),
])
    .then(() => console.log('mcp-server validation passed'))
    .catch(error => {
        console.error(error.stack || error.message);
        process.exit(1);
    });
