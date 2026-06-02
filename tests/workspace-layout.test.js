const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    createWorkspaceContext,
    parseLayoutArgs,
    workspaceIdFromRoot,
} = require('../scripts/lib/workspace-layout');
const { run: initProjectMemory } = require('../scripts/init_project_memory');
const { run: detectProjectTopology } = require('../scripts/detect_project_topology');
const { run: buildProjectKb } = require('../scripts/build_project_kb');
const { run: queryProjectKb } = require('../scripts/query_project_kb');

function testWorkspaceId() {
    assert.equal(workspaceIdFromRoot('E:/xile-workspace'), 'e-xile-workspace');
    assert.equal(workspaceIdFromRoot('C:\\Users\\Administrator\\Project A'), 'c-users-administrator-project-a');
}

function testExternalDataContext() {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-target-'));
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-data-'));
    const context = createWorkspaceContext({
        workspaceRoot,
        dataRoot,
        layout: 'external-data',
    });

    assert.equal(context.layout, 'external-data');
    assert.equal(context.workspaceRoot, path.resolve(workspaceRoot));
    assert.equal(context.dataRoot, path.resolve(dataRoot));
    assert.equal(context.memoryRoot.startsWith(path.resolve(dataRoot)), true);
    assert.equal(context.paths.projectProfile.endsWith(path.join('state', 'project-profile.json')), true);
    assert.equal(fs.existsSync(path.join(workspaceRoot, 'project-memory')), false);
}

function testLegacyContext() {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-legacy-'));
    const context = createWorkspaceContext({
        workspaceRoot,
        layout: 'legacy-project-memory',
    });

    assert.equal(context.layout, 'legacy-project-memory');
    assert.equal(context.memoryRoot, path.join(path.resolve(workspaceRoot), 'project-memory'));
    assert.equal(context.paths.projectProfile, path.join(path.resolve(workspaceRoot), 'project-memory', 'state', 'project-profile.json'));
}

function testParseArgs() {
    const parsed = parseLayoutArgs(['--workspace-root', 'E:/xile-workspace', '--data-root', 'D:/pmm-data', '--layout', 'external-data']);
    assert.equal(parsed.workspaceRoot, path.resolve('E:/xile-workspace'));
    assert.equal(parsed.dataRoot, path.resolve('D:/pmm-data'));
    assert.equal(parsed.layout, 'external-data');
}

function testInitAndTopologyUseExternalData() {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-workspace-'));
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-data-'));
    fs.writeFileSync(path.join(workspaceRoot, 'package.json'), '{"dependencies":{"vite":"latest"}}\n');

    initProjectMemory(['--workspace-root', workspaceRoot, '--data-root', dataRoot, '--name', 'sample']);
    detectProjectTopology(['--workspace-root', workspaceRoot, '--data-root', dataRoot]);

    const context = createWorkspaceContext({ workspaceRoot, dataRoot });
    assert.equal(fs.existsSync(path.join(workspaceRoot, 'project-memory')), false);
    assert.equal(fs.existsSync(context.paths.projectProfile), true);
    assert.equal(fs.existsSync(context.paths.featureRegistry), true);
    assert.equal(fs.existsSync(context.paths.manifest), true);
}

function captureOutput(fn, args, cwd) {
    const oldCwd = process.cwd();
    const oldLog = console.log;
    const logs = [];
    try {
        process.chdir(cwd);
        console.log = (...values) => logs.push(values.map(value => String(value)).join(' '));
        fn(args);
        return logs.join('\n');
    } finally {
        console.log = oldLog;
        process.chdir(oldCwd);
    }
}

function testProjectKbExternalData() {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-global-workspace-'));
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-global-data-'));
    const serviceRoot = path.join(workspaceRoot, 'server', 'api');
    fs.mkdirSync(path.join(serviceRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(serviceRoot, 'package.json'), '{"dependencies":{"typescript":"latest","express":"latest"}}\n');
    fs.writeFileSync(path.join(serviceRoot, 'src', 'sample.ts'), 'export function ping(){ return "pong"; }\n');

    initProjectMemory(['--workspace-root', workspaceRoot, '--data-root', dataRoot, '--name', 'global-sample']);
    detectProjectTopology(['--workspace-root', workspaceRoot, '--data-root', dataRoot]);
    buildProjectKb(['--workspace-root', workspaceRoot, '--data-root', dataRoot]);

    const context = createWorkspaceContext({ workspaceRoot, dataRoot });
    assert.equal(fs.existsSync(path.join(workspaceRoot, 'project-memory')), false);
    assert.equal(fs.existsSync(path.join(context.paths.projectGlobalDir, 'chain.graph.json')), true);

    const output = captureOutput(queryProjectKb, ['--workspace-root', workspaceRoot, '--data-root', dataRoot, '--json'], workspaceRoot);
    const parsed = JSON.parse(output);
    assert.equal(parsed.kind, 'project-summary');
}

testWorkspaceId();
testExternalDataContext();
testLegacyContext();
testParseArgs();
testInitAndTopologyUseExternalData();
testProjectKbExternalData();
console.log('workspace-layout validation passed');
