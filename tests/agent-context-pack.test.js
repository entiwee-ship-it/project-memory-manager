const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { prepareTaskContext, explainFeatureForAgent, analyzeChangeImpact, parseChangedFiles } = require('../src/agent/context-pack');
const { run: buildChainKb } = require('../src/graph/build-chain-kb');
const { discoverFeaturesForContext, writeFeatureCandidates } = require('../src/discovery/feature-discovery');
const { run: buildFeatureIndex } = require('../src/commands/build/build-feature');
const { createWorkspaceContext } = require('../src/shared/workspace-layout');
const { writeJsonAtomic } = require('../src/shared/common');
const { handleMcpRequest } = require('../src/mcp/server');

const repoRoot = path.resolve(__dirname, '..');
const fixtureRoot = path.join(__dirname, 'fixtures', 'next-fullstack-sample');

function withQuietConsole(fn) {
    const oldLog = console.log;
    const oldWarn = console.warn;
    try {
        console.log = () => {};
        console.warn = () => {};
        return fn();
    } finally {
        console.log = oldLog;
        console.warn = oldWarn;
    }
}

function createAgentFixture() {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-agent-next-'));
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-agent-data-'));
    fs.cpSync(fixtureRoot, workspaceRoot, { recursive: true });
    const context = createWorkspaceContext({ workspaceRoot, dataRoot, layout: 'external-data' });
    const projectConfigPath = path.join(context.paths.configsDir, 'project-global.json');
    writeJsonAtomic(projectConfigPath, {
        featureKey: 'project-global',
        featureName: 'Project Global KB',
        summary: 'Fixture project-global KB',
        type: 'project-global',
        registerFeature: false,
        areas: ['frontend', 'backend', 'data'],
        methodRoots: ['app', 'lib'],
        outputs: {
            scan: path.join(context.paths.projectGlobalDir, 'scan.raw.json'),
            graph: path.join(context.paths.projectGlobalDir, 'chain.graph.json'),
            lookup: path.join(context.paths.projectGlobalDir, 'chain.lookup.json'),
            report: path.join(context.paths.projectGlobalDir, 'build.report.json'),
        },
    });

    withQuietConsole(() => buildChainKb([
        '--workspace-root', workspaceRoot,
        '--data-root', dataRoot,
        '--layout', 'external-data',
        '--config', projectConfigPath,
    ]));

    const candidates = discoverFeaturesForContext(context, { limit: 20, minConfidence: 'low' });
    writeFeatureCandidates(context, candidates, { limit: 20, minConfidence: 'low' });
    for (const featureKey of ['settings', 'chat', 'facebook-oauth']) {
        withQuietConsole(() => buildFeatureIndex([
            '--workspace-root', workspaceRoot,
            '--data-root', dataRoot,
            '--feature-key', featureKey,
            '--json',
        ]));
    }

    return { workspaceRoot, dataRoot, context, candidates };
}

function names(items = []) {
    return items.map(item => item.name || item.featureKey || item).filter(Boolean);
}

function assertIncludes(values, expected, message = '') {
    assert.ok(values.includes(expected), message || `expected ${JSON.stringify(values)} to include ${expected}`);
}

function parseToolResult(response) {
    assert.equal(response.jsonrpc, '2.0');
    assert.ok(response.result);
    assert.equal(response.result.content[0].type, 'text');
    return JSON.parse(response.result.content[0].text);
}

async function callTool(name, args) {
    return handleMcpRequest({
        jsonrpc: '2.0',
        id: Math.floor(Math.random() * 100000),
        method: 'tools/call',
        params: { name, arguments: args },
    });
}

function testPrepareSettingsContext(fixture) {
    const result = prepareTaskContext({
        workspaceRoot: fixture.workspaceRoot,
        dataRoot: fixture.dataRoot,
        task: '修改 settings 页 AI 配置保存逻辑',
    });

    assert.equal(result.kind, 'agent-task-context');
    assertIncludes(names(result.relevantFeatures), 'settings');
    assertIncludes(names(result.keyEntrypoints.endpoints), 'GET /api/ai/config');
    assertIncludes(names(result.keyEntrypoints.endpoints), 'POST /api/ai/config');
    assertIncludes(names(result.keyEntrypoints.requests), 'GET /api/ai/config');
    assertIncludes(names(result.keyEntrypoints.requests), 'POST /api/ai/config');
    assertIncludes(names(result.dataAccess.tables), 'aiConfig');
    assertIncludes(result.criticalFiles, 'app/settings/page.tsx');
    assertIncludes(result.criticalFiles, 'app/api/ai/config/route.ts');
    assertIncludes(result.criticalFiles, 'lib/api-client.ts');
    assert.ok(result.evidence.some(item => item.file && item.confidence && (item.nodeId || item.edgeType)));
    assert.ok(result.evidence.some(item => item.method || item.endpoint));
}

function testPrepareChatContext(fixture) {
    const result = prepareTaskContext({
        workspaceRoot: fixture.workspaceRoot,
        dataRoot: fixture.dataRoot,
        task: '修复 chat 流式回复',
    });

    assertIncludes(names(result.relevantFeatures), 'chat');
    assertIncludes(names(result.keyEntrypoints.endpoints), 'GET /api/chat');
    assertIncludes(names(result.keyEntrypoints.endpoints), 'POST /api/chat');
    assert.ok(names(result.keyEntrypoints.methods).some(name => name.includes('streamChatCompletion')));
    assertIncludes(names(result.externalServices), 'Anthropic Claude');
    assertIncludes(names(result.dataAccess.tables), 'message');
    assertIncludes(names(result.dataAccess.tables), 'conversation');
    assertIncludes(result.criticalFiles, 'app/chat/page.tsx');
}

function testExplainFacebookFeature(fixture) {
    const result = explainFeatureForAgent({
        workspaceRoot: fixture.workspaceRoot,
        dataRoot: fixture.dataRoot,
        featureKey: 'facebook-oauth',
    });

    assert.equal(result.kind, 'agent-feature-card');
    assert.equal(result.feature.featureKey, 'facebook-oauth');
    assertIncludes(names(result.apiEndpoints), 'GET /api/facebook/oauth/callback');
    assertIncludes(names(result.apiEndpoints), 'GET /api/facebook/oauth/status');
    assertIncludes(names(result.externalServices), 'Facebook Graph API');
    assertIncludes(names(result.prismaModels), 'facebookConnection');
    assert.ok(result.mainDataFlows.length > 0);
    assert.ok(result.editRiskPoints.some(item => item.includes('外部服务')));
}

function testAnalyzeChangeImpact(fixture) {
    const result = analyzeChangeImpact({
        workspaceRoot: fixture.workspaceRoot,
        dataRoot: fixture.dataRoot,
        changedFiles: ['app/settings/page.tsx', 'app/api/chat/route.ts'],
    });

    assert.equal(result.kind, 'agent-change-impact');
    assertIncludes(result.changedFiles, 'app/settings/page.tsx');
    assertIncludes(result.changedFiles, 'app/api/chat/route.ts');
    assertIncludes(names(result.affectedFeatures), 'settings');
    assertIncludes(names(result.affectedFeatures), 'chat');
    assertIncludes(names(result.affectedEntrypoints.endpoints), 'GET /api/ai/config');
    assertIncludes(names(result.affectedEntrypoints.endpoints), 'GET /api/chat');
    assertIncludes(names(result.affectedData.tables), 'aiConfig');
    assertIncludes(names(result.affectedData.tables), 'message');
    assert.notEqual(result.risk.level, 'unknown');
    assert.equal(result.validation.rebuildFeatureKb, true);
    assert.equal(result.validation.rebuildProjectKb, true);
    assert.ok(result.validation.recommendedCommands.length > 0);
}

function testDiffFileParsing() {
    const diffFile = path.join(os.tmpdir(), `pmm-agent-diff-${Date.now()}.patch`);
    fs.writeFileSync(diffFile, [
        'diff --git a/app/settings/page.tsx b/app/settings/page.tsx',
        '+++ b/app/settings/page.tsx',
        'diff --git a/app/api/chat/route.ts b/app/api/chat/route.ts',
        '+++ b/app/api/chat/route.ts',
        '',
    ].join('\n'));
    const files = parseChangedFiles({ diffFile });
    assert.deepEqual(files, ['app/settings/page.tsx', 'app/api/chat/route.ts']);
}

function testCliFallback(fixture) {
    const child = spawnSync(process.execPath, [
        path.join(repoRoot, 'src/bin/prepare-task-context.js'),
        '--workspace-root', fixture.workspaceRoot,
        '--data-root', fixture.dataRoot,
        '--task', '修改 settings 页 AI 配置保存逻辑',
        '--json',
    ], {
        cwd: repoRoot,
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 20 * 1024 * 1024,
    });
    assert.equal(child.status, 0, child.stderr || child.stdout);
    const result = JSON.parse(child.stdout);
    assert.equal(result.kind, 'agent-task-context');
    assertIncludes(names(result.keyEntrypoints.endpoints), 'GET /api/ai/config');
}

async function testMcpTools(fixture) {
    const listResponse = await handleMcpRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
    });
    const toolNames = listResponse.result.tools.map(tool => tool.name);
    assertIncludes(toolNames, 'prepare_task_context');
    assertIncludes(toolNames, 'explain_feature_for_agent');
    assertIncludes(toolNames, 'analyze_change_impact');

    const taskContext = parseToolResult(await callTool('prepare_task_context', {
        workspaceRoot: fixture.workspaceRoot,
        dataRoot: fixture.dataRoot,
        task: '修复 chat 流式回复',
        freshnessPolicy: 'allow_stale',
    }));
    assert.equal(taskContext.kind, 'agent-task-context');
    assert.equal(taskContext._mcpFreshness.policy, 'allow_stale');
    assertIncludes(names(taskContext.keyEntrypoints.endpoints), 'GET /api/chat');

    const featureCard = parseToolResult(await callTool('explain_feature_for_agent', {
        workspaceRoot: fixture.workspaceRoot,
        dataRoot: fixture.dataRoot,
        featureKey: 'facebook-oauth',
        freshnessPolicy: 'allow_stale',
    }));
    assert.equal(featureCard.kind, 'agent-feature-card');
    assertIncludes(names(featureCard.externalServices), 'Facebook Graph API');

    const impact = parseToolResult(await callTool('analyze_change_impact', {
        workspaceRoot: fixture.workspaceRoot,
        dataRoot: fixture.dataRoot,
        changedFiles: ['app/settings/page.tsx'],
        freshnessPolicy: 'allow_stale',
    }));
    assert.equal(impact.kind, 'agent-change-impact');
    assertIncludes(names(impact.affectedFeatures), 'settings');
}

(async () => {
    const fixture = createAgentFixture();
    testPrepareSettingsContext(fixture);
    testPrepareChatContext(fixture);
    testExplainFacebookFeature(fixture);
    testAnalyzeChangeImpact(fixture);
    testDiffFileParsing();
    testCliFallback(fixture);
    await testMcpTools(fixture);
    console.log('agent-context-pack validation passed');
})().catch(error => {
    console.error(error.stack || error.message);
    process.exit(1);
});
