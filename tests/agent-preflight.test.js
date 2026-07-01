const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { agentPreflight, requiredMcpToolsForVersion } = require('../src/agent/environment-health');
const { loadSkillVersion } = require('../src/maintenance/show-version');
const { buildSourceSnapshot } = require('../src/shared/source-snapshot');
const { createWorkspaceContext } = require('../src/shared/workspace-layout');
const { registerWorkspace } = require('../src/shared/workspace-registry');

const repoRoot = path.resolve(__dirname, '..');
const sourceVersion = loadSkillVersion(repoRoot);

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, value) {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function createFixture(options = {}) {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-preflight-workspace-'));
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-preflight-data-'));
    ensureDir(path.join(workspaceRoot, 'src'));
    fs.writeFileSync(path.join(workspaceRoot, 'src', 'index.js'), 'module.exports = {};\n');
    fs.writeFileSync(path.join(workspaceRoot, 'package.json'), '{"name":"preflight-fixture"}\n');
    const context = createWorkspaceContext({ workspaceRoot, dataRoot });
    if (options.register !== false) {
        registerWorkspace(context, { name: 'preflight-fixture' });
    }
    return { workspaceRoot, dataRoot, context };
}

function writeFreshProjectKb(fixture, options = {}) {
    const config = {
        kind: 'project-global-kb-config',
        methodRoots: ['src'],
    };
    const snapshot = buildSourceSnapshot(fixture.workspaceRoot, config);
    writeJson(path.join(fixture.context.paths.configsDir, 'project-global.json'), config);
    writeJson(path.join(fixture.context.paths.projectGlobalDir, 'chain.graph.json'), {
        kind: 'chain-graph',
        builtWithSkill: {
            name: sourceVersion.name,
            version: options.version || sourceVersion.version,
            repo: sourceVersion.repo,
        },
        sourceSnapshot: snapshot,
        nodes: [],
        edges: [],
    });
    writeJson(path.join(fixture.context.paths.projectGlobalDir, 'chain.lookup.json'), {
        nodesById: {},
        adjacency: {
            incoming: {},
            outgoing: {},
        },
    });
}

function writeTaskMemory(fixture) {
    const outcomePath = path.join(fixture.context.paths.stateDir, 'agent-outcomes', 'task-outcomes.jsonl');
    ensureDir(path.dirname(outcomePath));
    fs.writeFileSync(outcomePath, `${JSON.stringify({
        kind: 'agent-task-outcome',
        task: '历史任务',
        outcome: '已验证',
        changedFiles: ['src/index.js'],
        validation: ['node tests/agent-preflight.test.js'],
        observations: [],
    })}\n`);
}

function runPreflight(fixture, overrides = {}) {
    return agentPreflight({
        workspaceRoot: fixture.workspaceRoot,
        dataRoot: fixture.dataRoot,
        installedSkillRoot: repoRoot,
        runtimeVersion: sourceVersion.version,
        runtimeTools: requiredMcpToolsForVersion(sourceVersion.version),
        ...overrides,
    });
}

function assertRepairAction(result, action) {
    assert.ok(result.repairPlan.some(item => item.id === action), `expected repair id ${action}`);
    assert.ok(result.repairPlan.some(item => item.action === action), `expected repair action ${action}`);
}

function assertCheckCodes(result) {
    const codes = result.health.checks.map(check => check.code);
    for (const code of [
        'source_version_detected',
        'mcp_runtime_version_detected',
        'mcp_capability_match',
        'skill_installation_match',
        'data_root_consistent',
        'workspace_registered',
        'kb_freshness_ready',
        'task_memory_available',
    ]) {
        assert.ok(codes.includes(code), `expected check code ${code}`);
    }
    for (const check of result.health.checks) {
        assert.ok(['ok', 'warn', 'fail'].includes(check.status), `invalid check status ${check.status}`);
    }
}

function findCheck(result, code) {
    return result.health.checks.find(check => check.code === code);
}

function testReady() {
    const fixture = createFixture();
    writeFreshProjectKb(fixture);
    writeTaskMemory(fixture);
    const result = runPreflight(fixture);
    assert.equal(result.kind, 'agent-preflight');
    assert.equal(result.status, 'ready');
    assert.equal(result.health.score, 100);
    assert.equal(result.workspaceId, fixture.context.workspaceId);
    assertCheckCodes(result);
    assert.deepEqual(result.repairPlan, []);
}

function testRuntimeVersionObjectMatchesSourceVersion() {
    const fixture = createFixture();
    writeFreshProjectKb(fixture);
    writeTaskMemory(fixture);
    const result = runPreflight(fixture, {
        runtimeVersion: {
            name: 'project-memory-manager',
            version: sourceVersion.version,
            repo: '',
        },
    });
    const runtimeVersionCheck = findCheck(result, 'mcp_runtime_version_detected');
    assert.equal(runtimeVersionCheck.status, 'ok');
    assert.equal(runtimeVersionCheck.details.actualVersion, sourceVersion.version);
    assert.notEqual(runtimeVersionCheck.details.actualVersion, '[object Object]');
    assert.ok(!result.findings.some(item => item.code === 'mcp_runtime_version_mismatch'));
}

function testStaleKbNeedsRebuild() {
    const fixture = createFixture();
    writeFreshProjectKb(fixture, { version: '0.0.0' });
    writeTaskMemory(fixture);
    const result = runPreflight(fixture);
    assert.equal(result.status, 'needs_action');
    assert.ok(result.findings.some(item => item.code === 'kb_freshness_not_ready'));
    assertRepairAction(result, 'rebuild_project_kb');
}

function testMcpCapabilityMismatchBlocks() {
    const fixture = createFixture();
    writeFreshProjectKb(fixture);
    writeTaskMemory(fixture);
    const tools = requiredMcpToolsForVersion().filter(tool => tool !== 'agent_preflight');
    const result = runPreflight(fixture, { runtimeTools: tools });
    assert.equal(result.status, 'blocked');
    assert.ok(result.findings.some(item => item.code === 'mcp_capability_mismatch'));
    assertRepairAction(result, 'restart_codex_mcp');
    assert.equal(result.nextAction.type, 'restart_codex');
}

function testRegistryMissingNeedsRegistration() {
    const fixture = createFixture({ register: false });
    writeFreshProjectKb(fixture);
    writeTaskMemory(fixture);
    const result = runPreflight(fixture);
    assert.equal(result.status, 'needs_action');
    assertRepairAction(result, 'register_workspace');
}

function testMissingDataRootBlocks() {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-preflight-workspace-'));
    const dataRoot = path.join(os.tmpdir(), `pmm-preflight-missing-${Date.now()}`);
    const result = agentPreflight({
        workspaceRoot,
        dataRoot,
        installedSkillRoot: repoRoot,
        runtimeVersion: sourceVersion.version,
        runtimeTools: requiredMcpToolsForVersion(),
    });
    assert.equal(result.status, 'blocked');
    assertRepairAction(result, 'init_workspace');
    assert.equal(result.nextAction.type, 'run_command');
}

function testPartialDiagnosticFailureDoesNotThrow() {
    const fixture = createFixture();
    ensureDir(fixture.context.paths.projectGlobalDir);
    fs.writeFileSync(path.join(fixture.context.paths.projectGlobalDir, 'chain.graph.json'), '{broken');
    writeJson(path.join(fixture.context.paths.projectGlobalDir, 'chain.lookup.json'), {});
    writeTaskMemory(fixture);
    const result = runPreflight(fixture);
    assert.equal(result.kind, 'agent-preflight');
    assert.ok(result.diagnostics.length >= 1);
    assertCheckCodes(result);
}

function testCliJson() {
    const fixture = createFixture();
    writeFreshProjectKb(fixture);
    writeTaskMemory(fixture);
    const child = spawnSync(process.execPath, [
        path.join(repoRoot, 'src/bin/agent-preflight.js'),
        '--workspace-root', fixture.workspaceRoot,
        '--data-root', fixture.dataRoot,
        '--installed-skill-root', repoRoot,
        '--json',
    ], {
        cwd: repoRoot,
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 20 * 1024 * 1024,
    });
    assert.equal(child.status, 0, child.stderr || child.stdout);
    const result = JSON.parse(child.stdout);
    assert.equal(result.kind, 'agent-preflight');
    assert.equal(result.workspaceRoot, path.resolve(fixture.workspaceRoot));
    assertCheckCodes(result);
}

testReady();
testRuntimeVersionObjectMatchesSourceVersion();
testStaleKbNeedsRebuild();
testMcpCapabilityMismatchBlocks();
testRegistryMissingNeedsRegistration();
testMissingDataRootBlocks();
testPartialDiagnosticFailureDoesNotThrow();
testCliJson();

console.log('agent-preflight validation passed');
