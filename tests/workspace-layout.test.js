const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    createWorkspaceContext,
    defaultDataRoot,
    parseLayoutArgs,
    workspaceIdFromRoot,
} = require('../scripts/lib/workspace-layout');
const { run: initProjectMemory } = require('../scripts/init_project_memory');
const { run: detectProjectTopology } = require('../scripts/detect_project_topology');
const { run: buildProjectKb } = require('../scripts/build_project_kb');
const { run: buildChainKb } = require('../scripts/build_chain_kb');
const { run: queryProjectKb } = require('../scripts/query_project_kb');
const { run: queryKb } = require('../scripts/query_kb');
const { run: refreshMemoryIndexes } = require('../scripts/refresh_memory_indexes');
const { run: buildCocosAuthoringProfile } = require('../scripts/build_cocos_authoring_profile');

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

function testLegacyContextFindsAncestorProjectMemory() {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-legacy-ancestor-'));
    const nestedRoot = path.join(workspaceRoot, 'app', 'http', 'routes');
    fs.mkdirSync(path.join(workspaceRoot, 'project-memory', 'state'), { recursive: true });
    fs.mkdirSync(nestedRoot, { recursive: true });

    const context = createWorkspaceContext({
        workspaceRoot: nestedRoot,
        layout: 'legacy-project-memory',
    });

    assert.equal(context.workspaceRoot, path.resolve(workspaceRoot));
    assert.equal(context.paths.featureRegistry, path.join(path.resolve(workspaceRoot), 'project-memory', 'state', 'feature-registry.json'));
}

function testParseArgs() {
    const parsed = parseLayoutArgs(['--workspace-root', 'E:/xile-workspace', '--data-root', 'D:/pmm-data', '--layout', 'external-data']);
    assert.equal(parsed.workspaceRoot, path.resolve('E:/xile-workspace'));
    assert.equal(parsed.dataRoot, path.resolve('D:/pmm-data'));
    assert.equal(parsed.layout, 'external-data');
}

function testDefaultDataRootIsOutsideToolSource() {
    const repoRoot = path.resolve(__dirname, '..');
    assert.equal(defaultDataRoot(), path.join(path.dirname(repoRoot), 'project-memory-data'));
    assert.equal(defaultDataRoot().startsWith(path.join(repoRoot, '.runtime')), false);
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
    const projectGlobalConfig = JSON.parse(fs.readFileSync(path.join(context.paths.configsDir, 'project-global.json'), 'utf8'));
    assert.equal(projectGlobalConfig.registerFeature, true);

    const registry = JSON.parse(fs.readFileSync(context.paths.featureRegistry, 'utf8'));
    assert.equal(registry.features.some(feature => feature.featureKey === 'project-global'), true);

    const output = captureOutput(queryProjectKb, ['--workspace-root', workspaceRoot, '--data-root', dataRoot, '--json'], workspaceRoot);
    const parsed = JSON.parse(output);
    assert.equal(parsed.kind, 'project-summary');

    const featureOutput = captureOutput(queryKb, ['--workspace-root', workspaceRoot, '--data-root', dataRoot, '--feature', 'project-global', '--json'], workspaceRoot);
    const featureSummary = JSON.parse(featureOutput);
    assert.equal(featureSummary.kind, 'feature-summary');
    assert.equal(featureSummary.feature.featureKey, 'project-global');
}

function testFeatureKbExternalData() {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-feature-workspace-'));
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-feature-data-'));
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, 'package.json'), '{"dependencies":{"typescript":"latest"}}\n');
    fs.writeFileSync(path.join(workspaceRoot, 'src', 'feature.ts'), 'export class Feature { run(){ return 1; } }\n');

    initProjectMemory(['--workspace-root', workspaceRoot, '--data-root', dataRoot, '--name', 'feature-sample']);
    detectProjectTopology(['--workspace-root', workspaceRoot, '--data-root', dataRoot]);
    const context = createWorkspaceContext({ workspaceRoot, dataRoot });
    const featureDir = path.join(context.paths.featuresDir, 'feature-sample');
    const configPath = path.join(context.paths.configsDir, 'feature-sample.json');
    fs.mkdirSync(context.paths.configsDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
        featureKey: 'feature-sample',
        featureName: 'Feature Sample',
        methodRoots: ['src'],
        outputs: {
            scan: path.join(featureDir, 'scan.raw.json'),
            graph: path.join(featureDir, 'chain.graph.json'),
            lookup: path.join(featureDir, 'chain.lookup.json'),
            report: path.join(featureDir, 'build.report.json'),
        },
        docs: {
            featureDir: path.join(context.memoryRoot, 'docs', 'features', 'feature-sample'),
            featureIndex: path.join(context.memoryRoot, 'docs', 'features', 'feature-sample', 'FEATURE.md'),
        },
    }, null, 2));

    buildChainKb(['--workspace-root', workspaceRoot, '--data-root', dataRoot, '--config', configPath]);

    assert.equal(fs.existsSync(path.join(workspaceRoot, 'project-memory')), false);
    assert.equal(fs.existsSync(context.paths.featureRegistry), true);
    assert.equal(fs.existsSync(path.join(featureDir, 'chain.graph.json')), true);

    const output = captureOutput(queryKb, ['--workspace-root', workspaceRoot, '--data-root', dataRoot, '--feature', 'feature-sample', '--json'], workspaceRoot);
    const parsed = JSON.parse(output);
    assert.equal(parsed.kind, 'feature-summary');

    refreshMemoryIndexes(['--workspace-root', workspaceRoot, '--data-root', dataRoot]);
    buildCocosAuthoringProfile(['--workspace-root', workspaceRoot, '--data-root', dataRoot]);

    assert.equal(fs.existsSync(path.join(workspaceRoot, 'project-memory')), false);
    assert.equal(fs.existsSync(context.paths.featureIndex), true);
    assert.equal(fs.existsSync(path.join(context.paths.stateDir, 'cocos-authoring-profile.json')), true);
}

testWorkspaceId();
testExternalDataContext();
testLegacyContext();
testLegacyContextFindsAncestorProjectMemory();
testParseArgs();
testDefaultDataRootIsOutsideToolSource();
testInitAndTopologyUseExternalData();
testProjectKbExternalData();
testFeatureKbExternalData();
console.log('workspace-layout validation passed');
