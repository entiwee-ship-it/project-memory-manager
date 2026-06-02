const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { handleMcpRequest } = require('../scripts/mcp_server');

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
        'build_project_index',
        'start_build_project_index',
        'get_job_status',
        'get_job_result',
        'query_project_chain',
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

Promise.all([
    testInitialize(),
    testToolsList(),
    testDiagnoseUninitializedWorkspace(),
    testInitAndDetectTopologyViaMcp(),
    testDetectTopologyKeepsManualAreaRoots(),
    testBuildProjectIndexAutoPreparesWorkspace(),
    testAsyncBuildJob(),
])
    .then(() => console.log('mcp-server validation passed'))
    .catch(error => {
        console.error(error.stack || error.message);
        process.exit(1);
    });
