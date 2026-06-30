const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const {
    prepareAgentBrief,
    recallTaskMemory,
    summarizeProjectMemory,
    updateProjectPlaybook,
} = require('../src/agent/memory-recall');
const { recordTaskOutcome } = require('../src/agent/execution-loop');
const { handleMcpRequest } = require('../src/mcp/server');

const repoRoot = path.resolve(__dirname, '..');

function createMemoryFixture() {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-memory-workspace-'));
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-memory-data-'));
    fs.mkdirSync(path.join(workspaceRoot, 'app', 'api', 'facebook', 'oauth', 'callback'), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, 'app', 'api', 'chat'), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, 'package.json'), '{"scripts":{"test":"node --test"}}\n');

    recordTaskOutcome({
        workspaceRoot,
        dataRoot,
        task: '修复 Facebook OAuth token 保存逻辑',
        outcome: '修复 callback 中 token 加密保存，并验证 status route',
        changedFiles: [
            'app/api/facebook/oauth/callback/route.ts',
            'app/api/facebook/oauth/status/route.ts',
            'lib/facebook-client.ts',
        ],
        validation: ['npm run test:oauth', 'npm run build'],
        observations: ['Facebook OAuth 修改必须复核 authorize/callback/status 三条 route'],
    });
    recordTaskOutcome({
        workspaceRoot,
        dataRoot,
        task: '修复 chat 流式回复错误处理',
        outcome: '补充 Anthropic stream 错误提示',
        changedFiles: ['app/api/chat/route.ts', 'app/chat/page.tsx'],
        validation: ['npm run test:chat'],
        observations: ['chat route 变更要复核 EventSource 客户端显示'],
    });
    updateProjectPlaybook({
        workspaceRoot,
        dataRoot,
        rule: '涉及 Facebook OAuth 时必须同时复核 authorize、callback、status route 和 token 加密边界。',
        category: 'oauth',
        source: 'test',
        changedFiles: ['app/api/facebook/oauth/callback/route.ts'],
    });
    return { workspaceRoot, dataRoot };
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

function testRecallTaskMemory(fixture) {
    const result = recallTaskMemory({
        workspaceRoot: fixture.workspaceRoot,
        dataRoot: fixture.dataRoot,
        task: '继续修复 Facebook OAuth token 保存',
    });
    assert.equal(result.kind, 'agent-memory-recall');
    assert.equal(result.totalOutcomeRecords, 2);
    assert.ok(result.recalledTasks.length >= 1);
    assert.equal(result.recalledTasks[0].task, '修复 Facebook OAuth token 保存逻辑');
    assertIncludes(result.relatedFiles.map(item => item.value), 'app/api/facebook/oauth/callback/route.ts');
    assertIncludes(result.validationCommands.map(item => item.value), 'npm run test:oauth');
    assert.ok(result.relevantRules.some(rule => rule.category === 'oauth'));
}

function testPrepareAgentBrief(fixture) {
    const result = prepareAgentBrief({
        workspaceRoot: fixture.workspaceRoot,
        dataRoot: fixture.dataRoot,
        task: '继续修复 Facebook OAuth token 保存',
    });
    assert.equal(result.kind, 'agent-brief');
    assert.equal(result.pmmGate.decision, 'required');
    assert.ok(result.memory.recalledTasks.length >= 1);
    assertIncludes(result.recommendedFiles, 'app/api/facebook/oauth/callback/route.ts');
    assertIncludes(result.validation.recommendedCommands, 'npm run test:oauth');
    assert.ok(result.risksAndNotes.some(note => note.includes('Facebook OAuth')));
}

function testSummarizeProjectMemory(fixture) {
    const result = summarizeProjectMemory({
        workspaceRoot: fixture.workspaceRoot,
        dataRoot: fixture.dataRoot,
    });
    assert.equal(result.kind, 'agent-project-memory-summary');
    assert.equal(result.outcomeCount, 2);
    assert.equal(result.playbook.ruleCount, 1);
    assertIncludes(result.frequentFiles.map(item => item.value), 'app/api/chat/route.ts');
}

function testUpdateProjectPlaybookInference(fixture) {
    const result = updateProjectPlaybook({
        workspaceRoot: fixture.workspaceRoot,
        dataRoot: fixture.dataRoot,
        task: '修改 auth token session 逻辑',
        changedFiles: ['app/api/auth/login/route.ts'],
        outcome: '调整 JWT session 过期处理',
    });
    assert.equal(result.kind, 'agent-project-playbook-update');
    assert.ok(result.ruleCount >= 2);
    assert.ok(result.addedOrUpdated.some(rule => rule.category === 'security'));
}

function testCliFallback(fixture) {
    const child = spawnSync(process.execPath, [
        path.join(repoRoot, 'src/bin/recall-task-memory.js'),
        '--workspace-root', fixture.workspaceRoot,
        '--data-root', fixture.dataRoot,
        '--task', 'Facebook OAuth token 保存',
        '--json',
    ], {
        cwd: repoRoot,
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 20 * 1024 * 1024,
    });
    assert.equal(child.status, 0, child.stderr || child.stdout);
    const result = JSON.parse(child.stdout);
    assert.equal(result.kind, 'agent-memory-recall');
    assert.equal(result.recalledTasks[0].task, '修复 Facebook OAuth token 保存逻辑');
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
        'recall_task_memory',
        'prepare_agent_brief',
        'summarize_project_memory',
        'update_project_playbook',
    ]) {
        assertIncludes(toolNames, expected);
    }

    const recall = parseToolResult(await callTool('recall_task_memory', {
        workspaceRoot: fixture.workspaceRoot,
        dataRoot: fixture.dataRoot,
        task: 'Facebook OAuth token 保存',
    }));
    assert.equal(recall.kind, 'agent-memory-recall');
    assert.equal(recall._mcpQuery.tool, 'recall_task_memory');
    assert.equal(recall.recalledTasks[0].task, '修复 Facebook OAuth token 保存逻辑');

    const brief = parseToolResult(await callTool('prepare_agent_brief', {
        workspaceRoot: fixture.workspaceRoot,
        dataRoot: fixture.dataRoot,
        task: '赠送活动 UI 小改',
        knownFiles: ['cms-client/src/views/mall/gift-activity/components/ProductStep.vue'],
    }));
    assert.equal(brief.kind, 'agent-brief');
    assert.equal(brief._mcpFreshness.policy, 'gate-only');
}

(async () => {
    const fixture = createMemoryFixture();
    testRecallTaskMemory(fixture);
    testPrepareAgentBrief(fixture);
    testSummarizeProjectMemory(fixture);
    testUpdateProjectPlaybookInference(fixture);
    testCliFallback(fixture);
    await testMcpTools(fixture);
    console.log('agent-memory-recall validation passed');
})().catch(error => {
    console.error(error.stack || error.message);
    process.exit(1);
});
