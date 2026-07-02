# PMM v0.80 Agent Preflight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Build PMM v0.80 Agent Preflight so AI can diagnose PMM readiness, version drift, MCP capability mismatch, data-root issues, KB freshness, and repair actions before relying on PMM context.

**Architecture:** Add a focused `src/agent/environment-health.js` core that gathers diagnostics and returns `agent-preflight` JSON. Expose it through CLI and MCP, then let `prepare_agent_brief` include or stop on preflight state before returning development context.

**Tech Stack:** Node.js CommonJS, Node built-in `assert`, PMM external-data layout, MCP JSON-RPC handler in `src/mcp/server.js`, existing workspace registry and source freshness helpers.

**Completion Status:** Completed on 2026-07-02. Final wrap-up added PMM self-bootstrap coverage for `codex-tools/project-memory-manager` paths, rebuilt PMM's own project-global KB, and verified CLI preflight as `ready` with fresh 122-file source snapshot. The current Codex MCP process may need a restart to reload source changes made during this wrap-up.

---

## File Structure

- Create `src/agent/environment-health.js`
  - Pure Agent Preflight core.
  - Depends on `createWorkspaceContext`, `loadSkillVersion`, `buildKbFreshnessStatus`, `diagnoseDataRoot`, `resolveWorkspace`, `workspaceHashFromRoot`, `readJsonSafe` style local helpers.
  - Exports `agentPreflight`, `buildHealthScore`, `requiredMcpToolsForVersion`, and small internal helpers only when tests need direct coverage.
- Create `src/commands/agent/agent-preflight.js`
  - Parses CLI arguments with the existing `execution-loop-cli` parser.
  - Prints readable text or JSON.
- Create `src/bin/agent-preflight.js`
  - Thin executable wrapper matching existing `src/bin/prepare-agent-brief.js` style.
- Create `tests/agent-preflight.test.js`
  - Unit-level coverage for ready, stale KB, MCP mismatch, registry missing, missing data root, and partial diagnostic failure.
- Modify `src/mcp/server.js`
  - Import `agentPreflight`.
  - Add `agent_preflight` tool definition.
  - Add tool handler before `prepare_agent_brief`.
  - Pass current `TOOL_DEFINITIONS` names and current skill summary into the core.
- Modify `src/agent/memory-recall.js`
  - Import `agentPreflight`.
  - Add `preflight` to `prepareAgentBrief`.
  - Return a blocked brief when preflight status is `blocked`.
- Modify `tests/mcp-server.test.js`
  - Assert `agent_preflight` appears in `tools/list`.
  - Assert MCP preflight returns `_mcpQuery.tool === "agent_preflight"`.
- Modify `tests/agent-memory-recall.test.js`
  - Assert `prepareAgentBrief` includes `preflight`.
  - Add one blocked preflight case with `runtimeTools` missing `agent_preflight`.
- Modify `package.json`
  - Add `test:preflight`.
  - Include `agent-preflight.test.js` in `test:agent`.
- Modify docs: `README.md`, `SKILL.md`, `docs/user/mcp-first.md`, `docs/reference/cli.md`, `docs/reference/mcp-tools.md`, `docs/guides/troubleshooting.md`.
- Modify `skill-version.json`
  - Bump to `0.80.0`.
  - Add capabilities `agent-preflight`, `agent-environment-health`, `mcp-agent-preflight`, `cli-agent-preflight`, `pmm-self-diagnosis-repair-plan`.

## Task 1: Agent Preflight Core Tests

**Files:**
- Create: `tests/agent-preflight.test.js`
- Read: `src/shared/workspace-layout.js`
- Read: `src/shared/workspace-registry.js`
- Read: `src/shared/source-snapshot.js`
- Read: `src/maintenance/show-version.js`

- [x] **Step 1: Write the failing test file**

Create `tests/agent-preflight.test.js` with these tests. This file intentionally imports `agentPreflight` before it exists.

```javascript
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { agentPreflight } = require('../src/agent/environment-health');
const { buildSourceSnapshot } = require('../src/shared/source-snapshot');
const { createWorkspaceContext } = require('../src/shared/workspace-layout');
const { registerWorkspace } = require('../src/shared/workspace-registry');
const { ensureDir, writeJsonAtomic } = require('../src/shared/common');
const { loadSkillVersion } = require('../src/maintenance/show-version');

const repoRoot = path.resolve(__dirname, '..');

function makeWorkspace(prefix = 'pmm-preflight-workspace-') {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-preflight-data-'));
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, 'package.json'), JSON.stringify({ name: 'preflight-sample' }, null, 2));
    fs.writeFileSync(path.join(workspaceRoot, 'src', 'index.js'), 'module.exports = { ok: true };\n');
    return { workspaceRoot, dataRoot };
}

function writeReadyKb(workspaceRoot, dataRoot, versionOverride = '') {
    const context = createWorkspaceContext({ workspaceRoot, dataRoot, layout: 'external-data' });
    const config = { componentRoots: ['src'] };
    const currentSkill = loadSkillVersion(repoRoot);
    const sourceSnapshot = buildSourceSnapshot(workspaceRoot, config);
    ensureDir(context.paths.configsDir);
    ensureDir(context.paths.projectGlobalDir);
    writeJsonAtomic(path.join(context.paths.configsDir, 'project-global.json'), config);
    writeJsonAtomic(path.join(context.paths.projectGlobalDir, 'chain.graph.json'), {
        kind: 'chain-graph',
        nodes: [],
        edges: [],
        sourceSnapshot,
        builtWithSkill: {
            name: currentSkill.name,
            version: versionOverride || currentSkill.version,
            repo: currentSkill.repo,
        },
    });
    writeJsonAtomic(path.join(context.paths.projectGlobalDir, 'chain.lookup.json'), {
        kind: 'chain-lookup',
        byId: {},
    });
    ensureDir(path.join(context.paths.stateDir, 'agent-outcomes'));
    fs.writeFileSync(path.join(context.paths.stateDir, 'agent-outcomes', 'task-outcomes.jsonl'), '', 'utf8');
    writeJsonAtomic(path.join(context.paths.stateDir, 'agent-playbook.json'), {
        kind: 'agent-project-playbook',
        rules: [],
    });
    return context;
}

function runtimeTools(includePreflight = true) {
    const names = [
        'get_current_state',
        'register_workspace',
        'diagnose_data_root',
        'start_build_project_index',
        'prepare_agent_brief',
    ];
    if (includePreflight) {
        names.push('agent_preflight');
    }
    return names;
}

function assertHasRepair(result, id) {
    assert.ok(result.repairPlan.some(action => action.id === id), `expected repair action ${id}`);
}

function testReadyPreflight() {
    const { workspaceRoot, dataRoot } = makeWorkspace();
    const context = writeReadyKb(workspaceRoot, dataRoot);
    registerWorkspace(context, { name: 'preflight-sample' });

    const result = agentPreflight({
        workspaceRoot,
        dataRoot,
        installedSkillRoot: repoRoot,
        runtimeTools: runtimeTools(true),
        runtimeVersion: loadSkillVersion(repoRoot),
    });

    assert.equal(result.kind, 'agent-preflight');
    assert.equal(result.status, 'ready');
    assert.equal(result.nextAction.type, 'continue');
    assert.equal(result.health.checks.every(check => check.status === 'ok'), true);
    assert.equal(result.workspaceRoot, path.resolve(workspaceRoot));
    assert.equal(result.dataRoot, path.resolve(dataRoot));
}

function testStaleKbNeedsRebuild() {
    const { workspaceRoot, dataRoot } = makeWorkspace();
    const context = writeReadyKb(workspaceRoot, dataRoot, '0.0.0');
    registerWorkspace(context, { name: 'preflight-sample' });

    const result = agentPreflight({
        workspaceRoot,
        dataRoot,
        installedSkillRoot: repoRoot,
        runtimeTools: runtimeTools(true),
        runtimeVersion: loadSkillVersion(repoRoot),
    });

    assert.equal(result.status, 'needs_action');
    assert.ok(result.findings.some(finding => finding.code === 'kb_freshness_not_ready'));
    assertHasRepair(result, 'rebuild_project_kb');
    assert.equal(result.nextAction.type, 'run_command');
}

function testMcpCapabilityMismatchBlocks() {
    const { workspaceRoot, dataRoot } = makeWorkspace();
    const context = writeReadyKb(workspaceRoot, dataRoot);
    registerWorkspace(context, { name: 'preflight-sample' });

    const result = agentPreflight({
        workspaceRoot,
        dataRoot,
        installedSkillRoot: repoRoot,
        runtimeTools: runtimeTools(false),
        runtimeVersion: loadSkillVersion(repoRoot),
    });

    assert.equal(result.status, 'blocked');
    assert.ok(result.findings.some(finding => finding.code === 'mcp_capability_mismatch'));
    assertHasRepair(result, 'restart_codex_mcp');
    assert.equal(result.nextAction.type, 'restart_codex');
}

function testRegistryMissingNeedsRegistration() {
    const { workspaceRoot, dataRoot } = makeWorkspace();
    writeReadyKb(workspaceRoot, dataRoot);

    const result = agentPreflight({
        workspaceRoot,
        dataRoot,
        installedSkillRoot: repoRoot,
        runtimeTools: runtimeTools(true),
        runtimeVersion: loadSkillVersion(repoRoot),
    });

    assert.equal(result.status, 'needs_action');
    assert.ok(result.findings.some(finding => finding.code === 'workspace_not_registered'));
    assertHasRepair(result, 'register_workspace');
}

function testMissingDataRootBlocksWithInitCommand() {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-preflight-missing-root-'));
    const dataRoot = path.join(os.tmpdir(), `pmm-preflight-missing-data-${Date.now()}`);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, 'src', 'index.js'), 'module.exports = {};\n');

    const result = agentPreflight({
        workspaceRoot,
        dataRoot,
        installedSkillRoot: repoRoot,
        runtimeTools: runtimeTools(true),
        runtimeVersion: loadSkillVersion(repoRoot),
    });

    assert.equal(result.status, 'blocked');
    assert.ok(result.findings.some(finding => finding.code === 'data_root_missing'));
    assertHasRepair(result, 'init_workspace');
}

function testInstalledSkillFailureDoesNotCrash() {
    const { workspaceRoot, dataRoot } = makeWorkspace();
    const context = writeReadyKb(workspaceRoot, dataRoot);
    registerWorkspace(context, { name: 'preflight-sample' });

    const result = agentPreflight({
        workspaceRoot,
        dataRoot,
        installedSkillRoot: path.join(dataRoot, 'not-a-skill'),
        runtimeTools: runtimeTools(true),
        runtimeVersion: loadSkillVersion(repoRoot),
    });

    assert.equal(result.kind, 'agent-preflight');
    assert.equal(result.status, 'needs_action');
    assert.ok(result.findings.some(finding => finding.code === 'skill_installation_unreadable'));
}

testReadyPreflight();
testStaleKbNeedsRebuild();
testMcpCapabilityMismatchBlocks();
testRegistryMissingNeedsRegistration();
testMissingDataRootBlocksWithInitCommand();
testInstalledSkillFailureDoesNotCrash();
console.log('agent-preflight validation passed');
```

- [x] **Step 2: Run the test to verify it fails**

Run:

```powershell
node tests/agent-preflight.test.js
```

Expected: FAIL with a `Cannot find module '../src/agent/environment-health'` error.

- [x] **Step 3: Commit the failing test**

Run:

```powershell
git add tests/agent-preflight.test.js
git commit -m "测试 PMM v0.80 Agent Preflight 核心"
```

Expected: commit succeeds and contains only the new failing test.

## Task 2: Environment Health Core

**Files:**
- Create: `src/agent/environment-health.js`
- Modify: `tests/agent-preflight.test.js` only if an assertion exposes a mismatch with the public shape below.

- [x] **Step 1: Implement the Agent Preflight public shape**

Create `src/agent/environment-health.js`. Use this public shape exactly so later CLI and MCP tasks have a stable contract.

```javascript
const fs = require('fs');
const path = require('path');
const { createWorkspaceContext } = require('../shared/workspace-layout');
const { buildKbFreshnessStatus } = require('../shared/source-snapshot');
const {
    diagnoseDataRoot,
    resolveWorkspace,
    workspaceHashFromRoot,
} = require('../shared/workspace-registry');
const { loadSkillVersion } = require('../maintenance/show-version');

const REQUIRED_MCP_TOOLS = [
    'agent_preflight',
    'get_current_state',
    'register_workspace',
    'diagnose_data_root',
    'start_build_project_index',
    'prepare_agent_brief',
];

function readJsonSafe(filePath, fallback = null) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
    } catch {
        return fallback;
    }
}

function normalizeStatus(value) {
    return ['ok', 'warn', 'fail'].includes(value) ? value : 'warn';
}

function check(code, status, message, details = {}) {
    return {
        code,
        status: normalizeStatus(status),
        message,
        details,
    };
}

function buildHealthScore(checks) {
    const penalty = checks.reduce((sum, item) => {
        if (item.status === 'fail') {
            return sum + 30;
        }
        if (item.status === 'warn') {
            return sum + 10;
        }
        return sum;
    }, 0);
    return Math.max(0, Math.min(100, 100 - penalty));
}

function requiredMcpToolsForVersion() {
    return REQUIRED_MCP_TOOLS.slice();
}

function readProjectGlobalFreshness(context, currentSkill) {
    const graphPath = path.join(context.paths.projectGlobalDir, 'chain.graph.json');
    const lookupPath = path.join(context.paths.projectGlobalDir, 'chain.lookup.json');
    const configPath = path.join(context.paths.configsDir, 'project-global.json');
    const graph = readJsonSafe(graphPath, null);
    const hasLookup = fs.existsSync(lookupPath);
    if (!graph || !hasLookup) {
        return buildKbFreshnessStatus({
            root: context.workspaceRoot,
            graph: null,
            config: null,
            currentSkill,
            recommendedAction: 'build_project_index',
        });
    }
    return buildKbFreshnessStatus({
        root: context.workspaceRoot,
        graph,
        config: readJsonSafe(configPath, null),
        currentSkill,
        recommendedAction: 'build_project_index',
    });
}

function loadInstalledSkillVersion(options) {
    const candidates = [
        options.installedSkillRoot,
        process.env.PMM_INSTALLED_SKILL_ROOT,
        process.env.AGENTS_HOME ? path.join(process.env.AGENTS_HOME, 'skills', 'project-memory-manager') : '',
        process.env.USERPROFILE ? path.join(process.env.USERPROFILE, '.agents', 'skills', 'project-memory-manager') : '',
        process.env.HOME ? path.join(process.env.HOME, '.agents', 'skills', 'project-memory-manager') : '',
    ].filter(Boolean);
    for (const candidate of candidates) {
        try {
            return {
                root: path.resolve(candidate),
                version: loadSkillVersion(candidate),
                readable: true,
            };
        } catch {
            continue;
        }
    }
    return {
        root: candidates[0] ? path.resolve(candidates[0]) : '',
        version: null,
        readable: false,
    };
}

function repair(id, title, severity, command, extra = {}) {
    return {
        id,
        title,
        severity,
        command: command || '',
        safeToAutoRun: Boolean(extra.safeToAutoRun),
        requiresUserAction: Boolean(extra.requiresUserAction),
        afterAction: extra.afterAction || 'agent_preflight',
    };
}

function commandQuote(value) {
    return `"${String(value || '').replace(/"/g, '\\"')}"`;
}

function buildFindingsAndRepairs(checks, context, freshness) {
    const findings = [];
    const repairPlan = [];
    const addFinding = (item, severity, summary) => {
        findings.push({
            code: item.code,
            severity,
            summary,
            message: item.message,
            details: item.details || {},
        });
    };
    for (const item of checks) {
        if (item.status === 'ok') {
            continue;
        }
        if (item.code === 'data_root_consistent' && item.details.reason === 'missing') {
            addFinding(item, 'error', 'PMM dataRoot 不存在，当前项目还不能可靠使用 PMM。');
            repairPlan.push(repair(
                'init_workspace',
                '初始化 PMM 外置数据根',
                'error',
                `node src/bin/init-workspace.js --workspace-root ${commandQuote(context.workspaceRoot)} --data-root ${commandQuote(context.dataRoot)}`,
                { safeToAutoRun: true }
            ));
        } else if (item.code === 'workspace_registered') {
            addFinding(item, 'warn', '当前 workspace 没有登记到共享数据根 registry。');
            repairPlan.push(repair(
                'register_workspace',
                '登记当前 workspace',
                'warn',
                `node src/bin/register-workspace.js --workspace-root ${commandQuote(context.workspaceRoot)} --data-root ${commandQuote(context.dataRoot)} --json`,
                { safeToAutoRun: true }
            ));
        } else if (item.code === 'kb_freshness_ready') {
            addFinding(item, 'warn', 'project-global KB 不是 fresh。');
            repairPlan.push(repair(
                'rebuild_project_kb',
                '重建 project-global KB',
                'warn',
                `node src/bin/build-project.js --workspace-root ${commandQuote(context.workspaceRoot)} --data-root ${commandQuote(context.dataRoot)} --json`,
                { safeToAutoRun: true }
            ));
        } else if (item.code === 'mcp_capability_match') {
            addFinding(item, 'error', '当前 MCP 进程缺少当前版本应暴露的工具，可能是旧进程。');
            repairPlan.push(repair(
                'restart_codex_mcp',
                '重启 Codex 以重新加载 PMM MCP',
                'error',
                '',
                { requiresUserAction: true, afterAction: 'agent_preflight' }
            ));
        } else if (item.code === 'skill_installation_match') {
            addFinding(item, 'warn', '已安装 skill 与源码版本不一致或无法读取。');
            repairPlan.push(repair(
                'reinstall_skill',
                '重新安装 project-memory-manager skill',
                'warn',
                'npx skills add https://github.com/entiwee-ship-it/project-memory-manager.git --skill project-memory-manager -g -a codex -y --full-depth',
                { requiresUserAction: true }
            ));
        } else {
            addFinding(item, item.status === 'fail' ? 'error' : 'warn', item.message);
        }
    }
    return { findings, repairPlan, freshness };
}

function chooseStatus(checks) {
    if (checks.some(item => item.status === 'fail')) {
        return 'blocked';
    }
    if (checks.some(item => item.status === 'warn')) {
        return 'needs_action';
    }
    return 'ready';
}

function chooseNextAction(status, repairPlan) {
    if (status === 'ready') {
        return { type: 'continue', reason: 'PMM preflight ready.', command: '' };
    }
    const first = repairPlan[0];
    if (!first) {
        return { type: 'ask_user', reason: 'PMM preflight found issues but no automatic repair action was available.', command: '' };
    }
    if (first.id === 'restart_codex_mcp') {
        return { type: 'restart_codex', reason: first.title, command: '' };
    }
    if (first.command) {
        return { type: 'run_command', reason: first.title, command: first.command };
    }
    return { type: 'ask_user', reason: first.title, command: '' };
}

function agentPreflight(options = {}) {
    const context = createWorkspaceContext({
        workspaceRoot: options.workspaceRoot,
        dataRoot: options.dataRoot,
        layout: options.layout || 'external-data',
    });
    const checks = [];
    let sourceVersion = null;
    try {
        sourceVersion = loadSkillVersion(path.resolve(__dirname, '..', '..'));
        checks.push(check('source_version_detected', 'ok', `源码版本: ${sourceVersion.name}@${sourceVersion.version}`, { sourceVersion }));
    } catch (error) {
        checks.push(check('source_version_detected', 'fail', '无法读取源码 skill-version.json。', { error: error.message }));
    }

    const runtimeVersion = options.runtimeVersion || null;
    checks.push(runtimeVersion && runtimeVersion.version
        ? check('mcp_runtime_version_detected', 'ok', `MCP 运行版本: ${runtimeVersion.name || 'project-memory-manager'}@${runtimeVersion.version}`, { runtimeVersion })
        : check('mcp_runtime_version_detected', 'warn', '当前入口未提供 MCP 运行版本，CLI 模式只做源码侧诊断。'));

    const runtimeTools = Array.isArray(options.runtimeTools) ? options.runtimeTools : null;
    if (runtimeTools) {
        const missingTools = REQUIRED_MCP_TOOLS.filter(name => !runtimeTools.includes(name));
        checks.push(missingTools.length
            ? check('mcp_capability_match', 'fail', `MCP 缺少工具: ${missingTools.join(', ')}`, { missingTools })
            : check('mcp_capability_match', 'ok', 'MCP 工具能力与 v0.80 要求一致。', { requiredTools: REQUIRED_MCP_TOOLS }));
    } else {
        checks.push(check('mcp_capability_match', 'warn', '当前入口未提供 MCP 工具列表，无法判断是否为旧 MCP 进程。'));
    }

    const installed = loadInstalledSkillVersion(options);
    if (!installed.readable) {
        checks.push(check('skill_installation_match', 'warn', '无法读取已安装 skill 版本。', { reason: 'skill_installation_unreadable', root: installed.root }));
    } else if (sourceVersion && installed.version.version !== sourceVersion.version) {
        checks.push(check('skill_installation_match', 'warn', `已安装 skill 是 ${installed.version.version}，源码是 ${sourceVersion.version}。`, { installedSkill: installed.version, sourceVersion }));
    } else {
        checks.push(check('skill_installation_match', 'ok', '已安装 skill 与源码版本一致。', { installedSkill: installed.version }));
    }

    const dataRootExists = fs.existsSync(context.dataRoot);
    checks.push(dataRootExists
        ? check('data_root_consistent', 'ok', 'PMM dataRoot 存在。', { dataRoot: context.dataRoot })
        : check('data_root_consistent', 'fail', 'PMM dataRoot 不存在。', { dataRoot: context.dataRoot, reason: 'missing' }));

    let dataRootDiagnosis = null;
    let workspaceResolution = null;
    if (dataRootExists) {
        dataRootDiagnosis = diagnoseDataRoot({ dataRoot: context.dataRoot });
        workspaceResolution = resolveWorkspace({ dataRoot: context.dataRoot, workspaceRoot: context.workspaceRoot });
        checks.push(workspaceResolution.ok
            ? check('workspace_registered', 'ok', '当前 workspace 已登记到 registry。', { workspaceHash: workspaceResolution.resolved?.workspaceHash || workspaceHashFromRoot(context.workspaceRoot) })
            : check('workspace_registered', 'warn', '当前 workspace 未登记到 registry。', { workspaceHash: workspaceHashFromRoot(context.workspaceRoot), registryPath: dataRootDiagnosis.registryPath }));
    }

    const freshness = readProjectGlobalFreshness(context, sourceVersion);
    checks.push(freshness.status === 'fresh'
        ? check('kb_freshness_ready', 'ok', 'project-global KB 是 fresh。', { status: freshness.status })
        : check('kb_freshness_ready', dataRootExists ? 'warn' : 'fail', `project-global KB 状态为 ${freshness.status}。`, { freshness }));

    const outcomePath = path.join(context.paths.stateDir, 'agent-outcomes', 'task-outcomes.jsonl');
    const playbookPath = path.join(context.paths.stateDir, 'agent-playbook.json');
    checks.push(fs.existsSync(context.paths.stateDir)
        ? check('task_memory_available', 'ok', 'Agent 记忆目录可访问。', { outcomePath, playbookPath })
        : check('task_memory_available', 'warn', 'Agent 记忆目录尚不存在。', { outcomePath, playbookPath }));

    const { findings, repairPlan } = buildFindingsAndRepairs(checks, context, freshness);
    const status = chooseStatus(checks);
    return {
        kind: 'agent-preflight',
        status,
        workspaceRoot: context.workspaceRoot,
        dataRoot: context.dataRoot,
        workspaceId: context.workspaceId,
        workspaceHash: workspaceHashFromRoot(context.workspaceRoot),
        health: {
            score: buildHealthScore(checks),
            checks,
        },
        findings,
        repairPlan,
        nextAction: chooseNextAction(status, repairPlan),
        diagnostics: {
            sourceVersion,
            runtimeVersion,
            dataRootDiagnosis,
            workspaceResolution,
            projectGlobalFreshness: freshness,
        },
    };
}

module.exports = {
    agentPreflight,
    buildHealthScore,
    requiredMcpToolsForVersion,
};
```

- [x] **Step 2: Run the core test**

Run:

```powershell
node tests/agent-preflight.test.js
```

Expected: PASS with `agent-preflight validation passed`.

- [x] **Step 3: Commit the core**

Run:

```powershell
git add src/agent/environment-health.js tests/agent-preflight.test.js
git commit -m "实现 PMM v0.80 Agent Preflight 核心"
```

Expected: commit succeeds.

## Task 3: CLI Entry

**Files:**
- Create: `src/commands/agent/agent-preflight.js`
- Create: `src/bin/agent-preflight.js`
- Modify: `tests/agent-preflight.test.js`
- Modify: `package.json`

- [x] **Step 1: Add a failing CLI fallback test**

Append this test before the final `console.log` in `tests/agent-preflight.test.js`, and call it before the log.

```javascript
function testCliPreflight(fixture = makeWorkspace('pmm-preflight-cli-')) {
    const context = writeReadyKb(fixture.workspaceRoot, fixture.dataRoot);
    registerWorkspace(context, { name: 'preflight-cli-sample' });
    const child = require('node:child_process').spawnSync(process.execPath, [
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
    assert.ok(['ready', 'needs_action'].includes(result.status));
}
```

Add this call near the bottom:

```javascript
testCliPreflight();
```

- [x] **Step 2: Run the test to verify it fails**

Run:

```powershell
node tests/agent-preflight.test.js
```

Expected: FAIL because `src/bin/agent-preflight.js` does not exist.

- [x] **Step 3: Implement command module**

Create `src/commands/agent/agent-preflight.js`:

```javascript
#!/usr/bin/env node

const { agentPreflight } = require('../../agent/environment-health');
const { parseExecutionArgs, printJsonIfRequested } = require('./execution-loop-cli');

function parseArgs(argv = []) {
    const args = parseExecutionArgs(argv);
    for (let index = 0; index < argv.length; index++) {
        const token = argv[index];
        if (token === '--installed-skill-root') {
            args.installedSkillRoot = argv[++index] || '';
        }
    }
    if (!args.workspaceRoot) {
        throw new Error('用法: node src/bin/agent-preflight.js --workspace-root <project-root> [--data-root <pmm-data-root>] [--json]');
    }
    return args;
}

function printText(result) {
    console.log(`Agent preflight: ${result.status}`);
    console.log(`- score: ${result.health.score}`);
    console.log(`- workspaceRoot: ${result.workspaceRoot}`);
    console.log(`- dataRoot: ${result.dataRoot}`);
    console.log(`- nextAction: ${result.nextAction.type}`);
    if (result.nextAction.command) {
        console.log(`- command: ${result.nextAction.command}`);
    }
    for (const finding of result.findings.slice(0, 8)) {
        console.log(`- ${finding.severity}: ${finding.code} ${finding.summary}`);
    }
}

function run(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    const result = agentPreflight(args);
    if (!printJsonIfRequested(args, result)) {
        printText(result);
    }
    return result;
}

module.exports = {
    parseArgs,
    run,
};

if (require.main === module) {
    try {
        run();
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    }
}
```

- [x] **Step 4: Implement thin bin wrapper**

Create `src/bin/agent-preflight.js`:

```javascript
#!/usr/bin/env node

const { run } = require('../commands/agent/agent-preflight');

if (require.main === module) {
    try {
        run(process.argv.slice(2));
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    }
}

module.exports = { run };
```

- [x] **Step 5: Add package scripts**

Modify `package.json` scripts:

```json
"test:preflight": "node tests/agent-preflight.test.js",
"test:agent": "node tests/agent-context-pack.test.js && node tests/agent-execution-loop.test.js && node tests/agent-memory-recall.test.js && node tests/agent-preflight.test.js"
```

Keep the existing script names unchanged.

- [x] **Step 6: Run CLI tests**

Run:

```powershell
npm.cmd run test:preflight
```

Expected: PASS with `agent-preflight validation passed`.

- [x] **Step 7: Commit CLI entry**

Run:

```powershell
git add src/commands/agent/agent-preflight.js src/bin/agent-preflight.js tests/agent-preflight.test.js package.json
git commit -m "增加 PMM Agent Preflight CLI"
```

Expected: commit succeeds.

## Task 4: MCP Tool

**Files:**
- Modify: `src/mcp/server.js`
- Modify: `tests/mcp-server.test.js`

- [x] **Step 1: Add failing MCP tests**

In `tests/mcp-server.test.js`, add `agent_preflight` to the expected tool list in `testToolsList`.

Add this test after `testWorkspaceRegistryToolsViaMcp`:

```javascript
async function testAgentPreflightViaMcp() {
    const { workspaceRoot, dataRoot } = makeWorkspace('pmm-mcp-preflight-workspace-');
    writeWebsiteWorkspace(workspaceRoot);

    const response = await callTool('agent_preflight', {
        workspaceRoot,
        dataRoot,
    });
    const result = parseTextResult(response);
    assert.equal(result.kind, 'agent-preflight');
    assert.ok(['blocked', 'needs_action', 'ready'].includes(result.status));
    assert.equal(result._mcpQuery.tool, 'agent_preflight');
    assert.ok(Array.isArray(result.health.checks));
}
```

Call it in the async runner near the bottom:

```javascript
await testAgentPreflightViaMcp();
```

- [x] **Step 2: Run MCP test to verify it fails**

Run:

```powershell
npm.cmd run test:mcp
```

Expected: FAIL with missing MCP tool `agent_preflight`.

- [x] **Step 3: Wire MCP imports and tool definition**

In `src/mcp/server.js`, add:

```javascript
const { agentPreflight } = require('../agent/environment-health');
```

Add this tool definition before `prepare_agent_brief`:

```javascript
{
    name: 'agent_preflight',
    description: 'Diagnose whether PMM is ready for an AI task and return health checks, findings, repair actions, and next action.',
    inputSchema: {
        type: 'object',
        properties: {
            workspaceRoot: { type: 'string' },
            dataRoot: { type: 'string' },
            task: { type: 'string' },
            query: { type: 'string' },
        },
        required: ['workspaceRoot'],
    },
},
```

- [x] **Step 4: Add MCP handler**

Add a function near `prepareAgentBriefTool`:

```javascript
function agentPreflightTool(args) {
    if (!hasWorkspaceRoot(args)) {
        return textResult({
            ok: false,
            error: 'MISSING_WORKSPACE_ROOT',
            message: 'agent_preflight 需要 workspaceRoot。',
        });
    }
    const payload = agentPreflight({
        ...args,
        layout: 'external-data',
        runtimeTools: TOOL_DEFINITIONS.map(tool => tool.name),
        runtimeVersion: currentSkillSummary(),
    });
    return textResult({
        ...payload,
        _mcpQuery: agentQueryMeta(args, 'agent_preflight'),
    });
}
```

In the `tools/call` chain, add `agent_preflight` before `prepare_agent_brief`:

```javascript
: name === 'agent_preflight'
    ? agentPreflightTool(args)
```

- [x] **Step 5: Run MCP test**

Run:

```powershell
npm.cmd run test:mcp
```

Expected: PASS with the existing MCP validation message.

- [x] **Step 6: Commit MCP tool**

Run:

```powershell
git add src/mcp/server.js tests/mcp-server.test.js
git commit -m "接入 PMM Agent Preflight MCP 工具"
```

Expected: commit succeeds.

## Task 5: Prepare Agent Brief Integration

**Files:**
- Modify: `src/agent/memory-recall.js`
- Modify: `tests/agent-memory-recall.test.js`

- [x] **Step 1: Add failing brief tests**

In `tests/agent-memory-recall.test.js`, update `testPrepareAgentBrief`:

```javascript
assert.equal(result.preflight.kind, 'agent-preflight');
assert.ok(['ready', 'needs_action', 'blocked'].includes(result.preflight.status));
```

Add this test:

```javascript
function testPrepareAgentBriefBlockedByPreflight(fixture) {
    const result = prepareAgentBrief({
        workspaceRoot: fixture.workspaceRoot,
        dataRoot: fixture.dataRoot,
        task: '继续修复 Facebook OAuth token 保存',
        runtimeTools: ['get_current_state'],
        runtimeVersion: { name: 'project-memory-manager', version: '0.80.0', repo: '' },
    });
    assert.equal(result.kind, 'agent-brief');
    assert.equal(result.preflight.status, 'blocked');
    assert.equal(result.executionPlan.contextStatus, 'preflight-blocked');
    assert.ok(result.nextActions.some(action => action.includes('Agent Preflight')));
}
```

Call it after `testPrepareAgentBrief(fixture)`.

- [x] **Step 2: Run memory test to verify it fails**

Run:

```powershell
node tests/agent-memory-recall.test.js
```

Expected: FAIL because `prepareAgentBrief` does not return `preflight`.

- [x] **Step 3: Integrate preflight into memory recall**

In `src/agent/memory-recall.js`, add:

```javascript
const { agentPreflight } = require('./environment-health');
```

At the start of `prepareAgentBrief`, after `task`, add:

```javascript
const preflight = agentPreflight(options);
if (preflight.status === 'blocked') {
    const memory = recallTaskMemory({ ...options, task });
    return {
        kind: 'agent-brief',
        workspaceRoot: memory.workspaceRoot,
        dataRoot: memory.dataRoot,
        task,
        preflight,
        pmmGate: decidePmmUsage(options),
        executionPlan: {
            contextStatus: 'preflight-blocked',
            targetFiles: [],
            editBoundary: {
                primaryFiles: [],
                relatedRoots: [],
                guidance: ['Agent Preflight blocked PMM context. Execute preflight.nextAction before source work.'],
            },
            steps: [
                {
                    step: '修复 PMM 环境',
                    action: preflight.nextAction.command || preflight.nextAction.reason,
                    evidence: preflight.findings.slice(0, 5),
                },
            ],
            validation: {
                recommendedCommands: preflight.nextAction.command ? [preflight.nextAction.command] : [],
            },
            uncertainties: preflight.findings.map(finding => finding.summary || finding.message),
        },
        memory,
        recommendedFiles: [],
        validation: {
            recommendedCommands: preflight.nextAction.command ? [preflight.nextAction.command] : [],
        },
        risksAndNotes: preflight.findings.map(finding => finding.summary || finding.message),
        nextActions: [
            'Agent Preflight blocked PMM context;先执行 preflight.nextAction。',
            '修复后重新调用 agent_preflight 或 prepare_agent_brief。',
        ],
        evidence: preflight.findings.map(finding => ({
            kind: 'preflight-finding',
            confidence: finding.severity === 'error' ? 'high' : 'medium',
            reason: finding.summary || finding.message,
            code: finding.code,
        })),
    };
}
```

In the normal return object, add:

```javascript
preflight,
```

Place it after `task`.

- [x] **Step 4: Run agent memory test**

Run:

```powershell
node tests/agent-memory-recall.test.js
```

Expected: PASS with `agent-memory-recall validation passed`.

- [x] **Step 5: Run full agent suite**

Run:

```powershell
npm.cmd run test:agent
```

Expected: PASS for context pack, execution loop, memory recall, and preflight tests.

- [x] **Step 6: Commit brief integration**

Run:

```powershell
git add src/agent/memory-recall.js tests/agent-memory-recall.test.js
git commit -m "让 Agent Brief 接入 Preflight 门禁"
```

Expected: commit succeeds.

## Task 6: Documentation And Version

**Files:**
- Modify: `README.md`
- Modify: `SKILL.md`
- Modify: `docs/user/mcp-first.md`
- Modify: `docs/reference/cli.md`
- Modify: `docs/reference/mcp-tools.md`
- Modify: `docs/guides/troubleshooting.md`
- Modify: `skill-version.json`
- Modify: `tests/source-layout.test.js` only if version metadata expectations need adjustment.

- [x] **Step 1: Update version metadata**

In `skill-version.json`, set:

```json
"version": "0.80.0"
```

Append these capability strings to `capabilities`:

```json
"agent-preflight",
"agent-environment-health",
"mcp-agent-preflight",
"cli-agent-preflight",
"pmm-self-diagnosis-repair-plan"
```

- [x] **Step 2: Update README**

In `README.md`, add `agent_preflight` before `prepare_agent_brief` in the MCP tool list:

```markdown
- `agent_preflight`：AI 开发任务开始前的 PMM 自检入口，返回 health、findings、repairPlan 和 nextAction。
```

In the Agent execution section, make the first sentence:

```markdown
PMM v0.80 起，AI 接到开发任务时先调用 `agent_preflight` 判断 PMM 环境是否 ready；ready 后再进入 `prepare_agent_brief`。如果 preflight 返回 `blocked`，先按 `nextAction` 修复 MCP、数据根或 KB freshness。
```

- [x] **Step 3: Update SKILL.md**

In `SKILL.md` MCP priority flow, insert `agent_preflight` before `get_current_state`:

```markdown
1. `agent_preflight`：开发任务开始前先确认 PMM 是否 ready；如果返回 `blocked` 或 `needs_action`，先执行 `nextAction` 或修复建议，再相信 PMM 上下文。
```

Renumber the following list items.

- [x] **Step 4: Update CLI reference**

In `docs/reference/cli.md`, add:

```markdown
### `agent-preflight.js`

```powershell
node src/bin/agent-preflight.js --workspace-root <project-root> --data-root <pmm-data-root> --task "修复登录接口" --json
```

返回 `agent-preflight`，包含 `status`、`health.checks`、`findings`、`repairPlan` 和 `nextAction`。AI 应在 `status=ready` 后继续调用 `prepare-agent-brief.js`。
```

- [x] **Step 5: Update MCP tools reference**

In `docs/reference/mcp-tools.md`, add a section:

```markdown
### `agent_preflight`

用途：AI 开发任务开始前检查 PMM 环境是否可用。

输入：

- `workspaceRoot`
- `dataRoot`
- `task` / `query`

输出：

- `status`: `ready`、`needs_action` 或 `blocked`
- `health.checks`: 稳定 code 的检查项
- `findings`: 面向用户和 AI 的问题解释
- `repairPlan`: 可执行或需用户介入的修复动作
- `nextAction`: 下一步应继续、运行命令、重启 Codex 或询问用户
```

- [x] **Step 6: Update troubleshooting**

In `docs/guides/troubleshooting.md`, add:

```markdown
## MCP 旧进程或版本漂移

现象：源码和已安装 skill 已升级，但 MCP 工具列表缺少新工具，或 KB freshness 显示由旧 PMM 版本构建。

处理：

1. 调用 `agent_preflight`。
2. 如果 `findings.code=mcp_capability_mismatch`，重启 Codex 后再次调用 `agent_preflight`。
3. 如果 `findings.code=kb_freshness_not_ready`，运行 `start_build_project_index(wait:true)` 或 CLI `node src/bin/build-project.js --workspace-root <project-root> --data-root <pmm-data-root> --json`。
4. 如果 `findings.code=skill_installation_unreadable` 或安装版本不一致，重新执行 `skill-version.json` 中的安装命令。
```

- [x] **Step 7: Run docs and package validation**

Run:

```powershell
node src/bin/validate-package.js .
npm.cmd run test:source-layout
```

Expected: both commands exit 0.

- [x] **Step 8: Commit docs and version**

Run:

```powershell
git add README.md SKILL.md docs/user/mcp-first.md docs/reference/cli.md docs/reference/mcp-tools.md docs/guides/troubleshooting.md skill-version.json tests/source-layout.test.js
git commit -m "发布 PMM v0.80 文档和版本元数据"
```

Expected: commit succeeds. If `tests/source-layout.test.js` was unchanged, `git add` prints no error and commit excludes it.

## Task 7: Final Verification And Release Commit Check

**Files:**
- No planned source edits.
- Optional external data write: PMM task outcome in `02_runtime/project-memory-data`.

- [x] **Step 1: Run targeted test suite**

Run:

```powershell
npm.cmd run test:preflight
npm.cmd run test:agent
npm.cmd run test:mcp
npm.cmd run test:registry
npm.cmd run test:layout
node src/bin/validate-package.js .
```

Expected: every command exits 0.

- [x] **Step 2: Run broader regression where cheap**

Run:

```powershell
npm.cmd run test:path
npm.cmd run test:source-layout
npm.cmd run test:summary
```

Expected: every command exits 0.

- [x] **Step 3: Exercise real PMM project preflight**

Run:

```powershell
node src/bin/agent-preflight.js --workspace-root "D:/GitHubProject/personal-public/entiwee-ship-it__project-memory-manager/01_working-copy" --data-root "D:/GitHubProject/personal-public/entiwee-ship-it__project-memory-manager/02_runtime/project-memory-data" --installed-skill-root "." --json
```

Expected: JSON parses and `kind` is `agent-preflight`. `status` may be `needs_action` if the current KB is stale before rebuilding; that is acceptable only if `repairPlan` includes `rebuild_project_kb`.

- [x] **Step 4: Rebuild PMM's own KB after v0.80 changes**

Run:

```powershell
node src/bin/build-project.js --workspace-root "D:/GitHubProject/personal-public/entiwee-ship-it__project-memory-manager/01_working-copy" --data-root "D:/GitHubProject/personal-public/entiwee-ship-it__project-memory-manager/02_runtime/project-memory-data" --json
```

Expected: command exits 0 and writes a project-global KB built with `project-memory-manager@0.80.0`.

- [x] **Step 5: Re-run real PMM project preflight**

Run:

```powershell
node src/bin/agent-preflight.js --workspace-root "D:/GitHubProject/personal-public/entiwee-ship-it__project-memory-manager/01_working-copy" --data-root "D:/GitHubProject/personal-public/entiwee-ship-it__project-memory-manager/02_runtime/project-memory-data" --installed-skill-root "." --json
```

Expected: `status` is `ready` or `needs_action` only for CLI-only MCP runtime warnings. It must not be `blocked`.

- [x] **Step 6: Review final diff**

Run:

```powershell
git status --short --branch
git log --oneline -8
git diff --check
```

Expected: no whitespace errors. Working tree contains only intended v0.80 changes if previous tasks were not committed one-by-one; otherwise it is clean and ahead of origin by the v0.80 commits.

- [x] **Step 7: Record PMM task outcome**

Run:

```powershell
node src/bin/record-task-outcome.js --workspace-root "D:/GitHubProject/personal-public/entiwee-ship-it__project-memory-manager/01_working-copy" --data-root "D:/GitHubProject/personal-public/entiwee-ship-it__project-memory-manager/02_runtime/project-memory-data" --task "发布 PMM v0.80 Agent Preflight" --outcome "完成 AI 自检与自愈 preflight，覆盖版本一致性、MCP 能力、数据根、registry、KB freshness 和修复计划。" --changed-file "src/agent/environment-health.js" --changed-file "src/mcp/server.js" --changed-file "src/agent/memory-recall.js" --changed-file "tests/agent-preflight.test.js" --validation "npm.cmd run test:preflight" --validation "npm.cmd run test:agent" --validation "npm.cmd run test:mcp" --validation "node src/bin/validate-package.js ." --confidence medium --json
```

Expected: outcome record writes to external PMM data root, not to the source repository.

## Self-Review Checklist

- Spec coverage:
  - Unified `agent_preflight`: Task 2, Task 3, Task 4.
  - Version and MCP capability mismatch: Task 2 tests and core checks.
  - Data root and registry diagnostics: Task 2 tests and core checks.
  - KB freshness and rebuild action: Task 2 tests and Task 7 real preflight.
  - `prepare_agent_brief` gate: Task 5.
  - Docs and version metadata: Task 6.
- Scope check:
  - This is one subsystem: Agent Preflight around existing PMM diagnostics.
  - It does not redesign registry, query, freshness, or install flows.
- Type consistency:
  - Public status values are `ready`, `needs_action`, `blocked`.
  - Check statuses are `ok`, `warn`, `fail`.
  - Repair fields are `id`, `title`, `severity`, `safeToAutoRun`, `command`, `requiresUserAction`, `afterAction`.
  - MCP tool name is `agent_preflight`; CLI file is `agent-preflight.js`.
