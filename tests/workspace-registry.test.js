const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createWorkspaceContext } = require('../src/shared/workspace-layout');
const {
    diagnoseDataRoot,
    listRegisteredWorkspaces,
    registerWorkspace,
    resolveWorkspace,
    workspaceHashFromRoot,
    workspaceRegistryPath,
} = require('../src/shared/workspace-registry');
const { run: initProjectMemory } = require('../src/commands/lifecycle/init-workspace');
const { run: detectProjectTopology } = require('../src/commands/lifecycle/detect-topology');

const repoRoot = path.resolve(__dirname, '..');

function makeWorkspace(prefix = 'pmm-registry-workspace-') {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-registry-data-'));
    return { workspaceRoot, dataRoot };
}

function writePackage(workspaceRoot, name = 'sample-project') {
    fs.writeFileSync(path.join(workspaceRoot, 'package.json'), `${JSON.stringify({
        name,
        dependencies: { typescript: 'latest' },
    }, null, 2)}\n`);
}

function parseJsonOutput(result) {
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return JSON.parse(String(result.stdout || '').trim());
}

function runNode(script, args) {
    return spawnSync(process.execPath, [path.join(repoRoot, script), ...args], {
        cwd: repoRoot,
        encoding: 'utf8',
        windowsHide: true,
    });
}

function testRegisterWritesRegistryAndManifest() {
    const { workspaceRoot, dataRoot } = makeWorkspace();
    writePackage(workspaceRoot, '@demo/registry-one');
    const context = createWorkspaceContext({ workspaceRoot, dataRoot });
    const result = registerWorkspace(context, { name: 'registry-one' });

    assert.equal(result.ok, true);
    assert.equal(result.workspace.workspaceRoot, path.resolve(workspaceRoot));
    assert.equal(result.workspace.workspaceHash, workspaceHashFromRoot(workspaceRoot));
    assert.equal(fs.existsSync(workspaceRegistryPath(dataRoot)), true);
    assert.equal(fs.existsSync(context.paths.manifest), true);
    assert.equal(fs.existsSync(path.join(workspaceRoot, 'project-memory')), false);

    const manifest = JSON.parse(fs.readFileSync(context.paths.manifest, 'utf8'));
    assert.equal(manifest.workspaceHash, workspaceHashFromRoot(workspaceRoot));
    assert.equal(manifest.registryPath, workspaceRegistryPath(dataRoot));

    const registry = JSON.parse(fs.readFileSync(workspaceRegistryPath(dataRoot), 'utf8'));
    assert.equal(registry.kind, 'pmm-workspace-registry');
    assert.equal(registry.workspaces.length, 1);
    assert.equal(registry.workspaces[0].projectName, 'registry-one');
}

function testListAndResolveRegisteredWorkspaces() {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-registry-data-'));
    const firstRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-registry-first-'));
    const secondRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-registry-second-'));
    writePackage(firstRoot, 'first-project');
    writePackage(secondRoot, 'second-project');
    const first = registerWorkspace(createWorkspaceContext({ workspaceRoot: firstRoot, dataRoot }), { name: 'first-project' });
    const second = registerWorkspace(createWorkspaceContext({ workspaceRoot: secondRoot, dataRoot }), { name: 'second-project' });

    const listed = listRegisteredWorkspaces({ dataRoot, includeMissing: true });
    assert.equal(listed.count, 2);
    assert.ok(listed.workspaces.some(item => item.workspaceHash === first.workspace.workspaceHash));
    assert.ok(listed.workspaces.some(item => item.workspaceHash === second.workspace.workspaceHash));

    const byRoot = resolveWorkspace({ dataRoot, workspaceRoot: firstRoot });
    assert.equal(byRoot.ok, true);
    assert.equal(byRoot.resolved.workspaceHash, first.workspace.workspaceHash);

    const byHash = resolveWorkspace({ dataRoot, workspaceHash: second.workspace.workspaceHash });
    assert.equal(byHash.ok, true);
    assert.equal(byHash.resolved.workspaceRoot, path.resolve(secondRoot));

    const byName = resolveWorkspace({ dataRoot, name: 'first-project' });
    assert.equal(byName.ok, true);
    assert.equal(byName.resolved.workspaceRoot, path.resolve(firstRoot));
}

function testDiagnoseDetectsWorkspaceIdCollision() {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-registry-collision-'));
    fs.writeFileSync(workspaceRegistryPath(dataRoot), `${JSON.stringify({
        kind: 'pmm-workspace-registry',
        version: 1,
        dataRoot,
        updatedAt: '2026-06-30T00:00:00.000Z',
        workspaces: [
            {
                workspaceHash: 'aaaaaaaaaaaa',
                workspaceId: 'same-id',
                workspaceRoot: path.join(os.tmpdir(), 'pmm-collision-a'),
                memoryRoot: path.join(dataRoot, 'workspaces', 'same-id-a'),
                projectName: 'collision-a',
            },
            {
                workspaceHash: 'bbbbbbbbbbbb',
                workspaceId: 'same-id',
                workspaceRoot: path.join(os.tmpdir(), 'pmm-collision-b'),
                memoryRoot: path.join(dataRoot, 'workspaces', 'same-id-b'),
                projectName: 'collision-b',
            },
        ],
    }, null, 2)}\n`);

    const diagnosis = diagnoseDataRoot({ dataRoot });
    assert.equal(diagnosis.ok, false);
    assert.ok(diagnosis.issues.some(issue => issue.code === 'WORKSPACE_ID_COLLISION'));
}

function testLifecycleCommandsAutoRegisterWorkspace() {
    const { workspaceRoot, dataRoot } = makeWorkspace();
    writePackage(workspaceRoot, 'lifecycle-project');

    initProjectMemory(['--workspace-root', workspaceRoot, '--data-root', dataRoot, '--name', 'lifecycle-project']);
    detectProjectTopology(['--workspace-root', workspaceRoot, '--data-root', dataRoot]);

    const listed = listRegisteredWorkspaces({ dataRoot, includeMissing: true });
    assert.equal(listed.count, 1);
    assert.equal(listed.workspaces[0].projectName, 'lifecycle-project');
    assert.equal(listed.workspaces[0].manifestExists, true);
    assert.equal(listed.workspaces[0].workspaceHash, workspaceHashFromRoot(workspaceRoot));
}

function testCliEntrypointsReturnJson() {
    const { workspaceRoot, dataRoot } = makeWorkspace();
    writePackage(workspaceRoot, 'cli-project');

    const registered = parseJsonOutput(runNode('src/bin/register-workspace.js', [
        '--workspace-root', workspaceRoot,
        '--data-root', dataRoot,
        '--name', 'cli-project',
        '--json',
    ]));
    assert.equal(registered.workspace.projectName, 'cli-project');

    const listed = parseJsonOutput(runNode('src/bin/list-workspaces.js', [
        '--data-root', dataRoot,
        '--json',
    ]));
    assert.equal(listed.count, 1);

    const resolved = parseJsonOutput(runNode('src/bin/resolve-workspace.js', [
        '--data-root', dataRoot,
        '--workspace-root', workspaceRoot,
        '--json',
    ]));
    assert.equal(resolved.ok, true);
    assert.equal(resolved.resolved.workspaceHash, workspaceHashFromRoot(workspaceRoot));

    const diagnosis = parseJsonOutput(runNode('src/bin/diagnose-data-root.js', [
        '--data-root', dataRoot,
        '--json',
    ]));
    assert.equal(diagnosis.ok, true);
    assert.equal(diagnosis.workspaceCount, 1);
}

testRegisterWritesRegistryAndManifest();
testListAndResolveRegisteredWorkspaces();
testDiagnoseDetectsWorkspaceIdCollision();
testLifecycleCommandsAutoRegisterWorkspace();
testCliEntrypointsReturnJson();
console.log('workspace-registry validation passed');
