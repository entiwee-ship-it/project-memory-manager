const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const {
    decidePmmUsage,
    planTaskExecution,
    recordTaskOutcome,
    reviewPatchForAgent,
    validateEditScope,
} = require('../src/agent/execution-loop');
const { run: buildChainKb } = require('../src/graph/build-chain-kb');
const { discoverFeaturesForContext, writeFeatureCandidates } = require('../src/discovery/feature-discovery');
const { run: buildFeatureIndex } = require('../src/commands/build/build-feature');
const { createWorkspaceContext } = require('../src/shared/workspace-layout');
const { writeJsonAtomic } = require('../src/shared/common');
const { handleMcpRequest } = require('../src/mcp/server');

const repoRoot = path.resolve(__dirname, '..');
const fixtureRoot = path.join(__dirname, 'fixtures', 'next-fullstack-sample');

const screenshotUiFiles = [
    'cms-client/src/views/mall/gift-activity/components/ProductStep.vue',
    'cms-client/src/views/mall/gift-activity/components/ConfigStep.vue',
    'cms-client/src/views/mall/gift-activity/components/ActivityDataRail.vue',
];

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

function createExecutionFixture() {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-execution-next-'));
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-execution-data-'));
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

    return { workspaceRoot, dataRoot };
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

function testSmallUiGate() {
    const result = decidePmmUsage({
        task: '赠送活动 UI 小改',
        knownFiles: screenshotUiFiles,
    });
    assert.equal(result.kind, 'agent-pmm-usage-decision');
    assert.equal(result.decision, 'optional_skip_allowed');
    assert.equal(result.deepPmmRequired, false);
    assert.equal(result.recommendedTool, 'validate_edit_scope');
    assert.ok(result.skipConditions.length > 0);
    assert.ok(result.riskSignals.some(signal => signal.key === 'commerce'));
}

function testSettingsGateRequiresPmm() {
    const result = decidePmmUsage({
        task: '修改 settings 页 AI 配置保存逻辑',
    });
    assert.equal(result.decision, 'required');
    assert.equal(result.pmmRequired, true);
    assert.equal(result.recommendedTool, 'prepare_task_context');
}

function testOptionalUiValidation() {
    const result = validateEditScope({
        task: '赠送活动 UI 小改',
        knownFiles: screenshotUiFiles,
        changedFiles: screenshotUiFiles,
    });
    assert.equal(result.kind, 'agent-edit-scope-validation');
    assert.equal(result.verdict, 'within_scope');
    assert.equal(result.riskyFiles.length, 0);
}

function testOptionalUiOutOfScopeValidation() {
    const result = validateEditScope({
        task: '赠送活动 UI 小改',
        knownFiles: screenshotUiFiles,
        changedFiles: ['README.md'],
    });
    assert.notEqual(result.verdict, 'within_scope');
    assertIncludes(result.outOfScopeFiles, 'README.md');
}

function testPlanSettingsExecution(fixture) {
    const result = planTaskExecution({
        workspaceRoot: fixture.workspaceRoot,
        dataRoot: fixture.dataRoot,
        task: '修改 settings 页 AI 配置保存逻辑',
    });
    assert.equal(result.kind, 'agent-task-execution-plan');
    assert.equal(result.pmmGate.decision, 'required');
    assert.equal(result.contextStatus, 'context-ready');
    assertIncludes(result.targetFiles, 'app/settings/page.tsx');
    assertIncludes(result.targetFiles, 'app/api/ai/config/route.ts');
    assert.ok(result.steps.length >= 4);
}

function testValidateSettingsScope(fixture) {
    const result = validateEditScope({
        workspaceRoot: fixture.workspaceRoot,
        dataRoot: fixture.dataRoot,
        task: '修改 settings 页 AI 配置保存逻辑',
        changedFiles: ['app/settings/page.tsx', 'app/api/ai/config/route.ts', 'lib/api-client.ts'],
    });
    assert.equal(result.kind, 'agent-edit-scope-validation');
    assert.notEqual(result.verdict, 'pmm_context_unavailable');
    assertIncludes(names(result.impactSummary.affectedFeatures), 'settings');
    assertIncludes(names(result.impactSummary.affectedEntrypoints.endpoints), 'GET /api/ai/config');
}

function testReviewPatchForAgent(fixture) {
    const result = reviewPatchForAgent({
        workspaceRoot: fixture.workspaceRoot,
        dataRoot: fixture.dataRoot,
        task: '修复 chat 流式回复',
        changedFiles: ['app/api/chat/route.ts'],
    });
    assert.equal(result.kind, 'agent-patch-review');
    assert.equal(result.verdict, 'changes_requested');
    assert.ok(result.findings.some(item => item.severity === 'high' || item.severity === 'medium'));
}

function testRecordTaskOutcome(fixture) {
    const result = recordTaskOutcome({
        workspaceRoot: fixture.workspaceRoot,
        dataRoot: fixture.dataRoot,
        task: '修改 settings 页 AI 配置保存逻辑',
        outcome: '完成 settings 保存逻辑并通过相关测试',
        changedFiles: ['app/settings/page.tsx'],
        validation: ['npm test'],
        observations: ['PMM gate required'],
    });
    assert.equal(result.kind, 'agent-task-outcome-record');
    assert.equal(fs.existsSync(result.outputPath), true);
    const lines = fs.readFileSync(result.outputPath, 'utf8').trim().split(/\r?\n/);
    const last = JSON.parse(lines.at(-1));
    assert.equal(last.task, '修改 settings 页 AI 配置保存逻辑');
    assertIncludes(last.changedFiles, 'app/settings/page.tsx');
}

function testCliFallback() {
    const child = spawnSync(process.execPath, [
        path.join(repoRoot, 'src/bin/decide-pmm-usage.js'),
        '--task', '赠送活动 UI 小改',
        '--known-file', screenshotUiFiles[0],
        '--known-file', screenshotUiFiles[1],
        '--known-file', screenshotUiFiles[2],
        '--json',
    ], {
        cwd: repoRoot,
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 20 * 1024 * 1024,
    });
    assert.equal(child.status, 0, child.stderr || child.stdout);
    const result = JSON.parse(child.stdout);
    assert.equal(result.kind, 'agent-pmm-usage-decision');
    assert.equal(result.decision, 'optional_skip_allowed');
}

async function testMcpTools(fixture) {
    const listResponse = await handleMcpRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
    });
    const toolNames = listResponse.result.tools.map(tool => tool.name);
    for (const expected of [
        'decide_pmm_usage',
        'plan_task_execution',
        'validate_edit_scope',
        'review_patch_for_agent',
        'record_task_outcome',
    ]) {
        assertIncludes(toolNames, expected);
    }

    const gate = parseToolResult(await callTool('decide_pmm_usage', {
        task: '赠送活动 UI 小改',
        knownFiles: screenshotUiFiles,
    }));
    assert.equal(gate.kind, 'agent-pmm-usage-decision');
    assert.equal(gate.decision, 'optional_skip_allowed');

    const plan = parseToolResult(await callTool('plan_task_execution', {
        workspaceRoot: fixture.workspaceRoot,
        dataRoot: fixture.dataRoot,
        task: '修改 settings 页 AI 配置保存逻辑',
        freshnessPolicy: 'allow_stale',
    }));
    assert.equal(plan.kind, 'agent-task-execution-plan');
    assert.equal(plan._mcpFreshness.policy, 'allow_stale');
    assertIncludes(plan.targetFiles, 'app/settings/page.tsx');

    const outcome = parseToolResult(await callTool('record_task_outcome', {
        workspaceRoot: fixture.workspaceRoot,
        dataRoot: fixture.dataRoot,
        task: '记录 v0.60 MCP 工具测试',
        outcome: 'MCP 工具可调用',
        changedFiles: ['src/mcp/server.js'],
    }));
    assert.equal(outcome.kind, 'agent-task-outcome-record');
    assert.equal(fs.existsSync(outcome.outputPath), true);
}

(async () => {
    testSmallUiGate();
    testSettingsGateRequiresPmm();
    testOptionalUiValidation();
    testOptionalUiOutOfScopeValidation();
    const fixture = createExecutionFixture();
    testPlanSettingsExecution(fixture);
    testValidateSettingsScope(fixture);
    testReviewPatchForAgent(fixture);
    testRecordTaskOutcome(fixture);
    testCliFallback();
    await testMcpTools(fixture);
    console.log('agent-execution-loop validation passed');
})().catch(error => {
    console.error(error.stack || error.message);
    process.exit(1);
});
