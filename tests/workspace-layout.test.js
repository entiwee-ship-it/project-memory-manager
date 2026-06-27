const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    createWorkspaceContext,
    defaultDataRoot,
    parseLayoutArgs,
    workspaceIdFromRoot,
} = require('../src/shared/workspace-layout');
const { run: initProjectMemory } = require('../src/commands/lifecycle/init-workspace');
const { run: detectProjectTopology } = require('../src/commands/lifecycle/detect-topology');
const { run: buildProjectKb } = require('../src/commands/build/build-project');
const { computeImportResolutionStats, run: buildChainKb } = require('../src/graph/build-chain-kb');
const { run: queryProjectKb } = require('../src/commands/query/query-project');
const { run: queryKb } = require('../src/commands/query/query-feature');
const { run: refreshMemoryIndexes } = require('../src/lifecycle/refresh-memory-indexes');
const { run: buildCocosAuthoringProfile } = require('../src/commands/cocos/build-cocos-authoring-profile');
const { buildKbFreshnessStatus } = require('../src/shared/source-snapshot');

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
    const groupRoot = path.join(workspaceRoot, 'qyproject');
    const serviceRoot = path.join(groupRoot, 'cms-server');
    fs.mkdirSync(path.join(serviceRoot, 'src'), { recursive: true });
    fs.mkdirSync(path.join(serviceRoot, 'node_modules', 'noisy-lib'), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, 'codex-work', 'work', 'tmp', '2026-06-03-noise'), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, 'codex-work', 'work', 'active', 'legacy-root-backups', 'old-login'), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, 'codex-tools', 'project-memory-data', 'workspaces', 'sample'), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, 'codex-tools', 'project-memory-manager', 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, 'codex-tools', 'other-tool'), { recursive: true });
    fs.writeFileSync(path.join(serviceRoot, 'package.json'), '{"dependencies":{"typescript":"latest","express":"latest"}}\n');
    fs.writeFileSync(path.join(serviceRoot, 'src', 'sample.ts'), 'export function ping(){ return "pong"; }\n');
    fs.writeFileSync(path.join(serviceRoot, 'node_modules', 'noisy-lib', 'index.ts'), 'export function dependencyNoise(){ return "noise"; }\n');
    fs.writeFileSync(path.join(workspaceRoot, 'codex-work', 'work', 'tmp', '2026-06-03-noise', 'LoginViewComp.ts'), 'export function handleLogin(){ return "tmp-noise"; }\n');
    fs.writeFileSync(path.join(workspaceRoot, 'codex-work', 'work', 'active', 'legacy-root-backups', 'old-login', 'LegacyLogin.ts'), 'export function legacyLoginNoise(){ return "legacy-noise"; }\n');
    fs.writeFileSync(path.join(workspaceRoot, 'codex-tools', 'project-memory-data', 'workspaces', 'sample', 'DataNoise.ts'), 'export function dataRootNoise(){ return "data-noise"; }\n');
    fs.writeFileSync(path.join(workspaceRoot, 'codex-tools', 'project-memory-manager', 'scripts', 'ToolNoise.ts'), 'export function toolSourceNoise(){ return "tool-noise"; }\n');
    fs.writeFileSync(path.join(workspaceRoot, 'codex-tools', 'other-tool', 'OtherToolNoise.ts'), 'export function otherToolNoise(){ return "tool-noise"; }\n');

    initProjectMemory(['--workspace-root', workspaceRoot, '--data-root', dataRoot, '--name', 'global-sample']);
    detectProjectTopology(['--workspace-root', workspaceRoot, '--data-root', dataRoot]);
    const context = createWorkspaceContext({ workspaceRoot, dataRoot });
    fs.writeFileSync(context.paths.projectProfile, JSON.stringify({
        projectName: 'global-sample',
        projectType: 'multi-repo',
        areas: {
            frontend: [],
            backend: ['qyproject', 'qyproject/cms-server', 'codex-work', 'codex-tools', 'codex-tools/project-memory-data', 'codex-tools/project-memory-manager'],
            shared: [],
            contract: [],
            data: [],
            ops: [],
        },
        stacks: {
            frontend: [],
            backend: ['node', 'typescript'],
            shared: [],
            contract: [],
            data: [],
            ops: [],
        },
        integration: {
            primary: ['qyproject/cms-server'],
            secondary: [],
        },
    }, null, 2));
    buildProjectKb(['--workspace-root', workspaceRoot, '--data-root', dataRoot]);

    assert.equal(fs.existsSync(path.join(workspaceRoot, 'project-memory')), false);
    assert.equal(fs.existsSync(path.join(context.paths.projectGlobalDir, 'chain.graph.json')), true);
    const graph = JSON.parse(fs.readFileSync(path.join(context.paths.projectGlobalDir, 'chain.graph.json'), 'utf8'));
    assert.equal(graph.sourceSnapshot.kind, 'source-snapshot');
    assert.equal(graph.sourceSnapshot.staleCheckVersion, 2);
    assert.ok(graph.sourceSnapshot.files.some(item => item.path === 'qyproject/cms-server/src/sample.ts'));
    assert.equal(graph.nodes.some(node => String(node.file || '').includes('node_modules')), false);
    assert.equal(graph.nodes.some(node => String(node.file || '').includes('codex-work/work/tmp')), false);
    assert.equal(graph.nodes.some(node => String(node.file || '').includes('legacy-root-backups')), false);
    assert.equal(graph.nodes.some(node => String(node.file || '').includes('project-memory-data')), false);
    assert.equal(graph.nodes.some(node => String(node.file || '').includes('project-memory-manager')), false);
    assert.equal(graph.nodes.some(node => String(node.file || '').includes('codex-tools/other-tool')), false);
    assert.equal(graph.nodes.some(node => node.type === 'method' && node.name.includes('dependencyNoise')), false);
    assert.equal(graph.nodes.some(node => node.type === 'method' && node.name.includes('handleLogin')), false);
    assert.equal(graph.nodes.some(node => node.type === 'method' && node.name.includes('legacyLoginNoise')), false);
    assert.equal(graph.nodes.some(node => node.type === 'method' && node.name.includes('dataRootNoise')), false);
    assert.equal(graph.nodes.some(node => node.type === 'method' && node.name.includes('toolSourceNoise')), false);
    assert.equal(graph.nodes.some(node => node.type === 'method' && node.name.includes('otherToolNoise')), false);
    const projectGlobalConfig = JSON.parse(fs.readFileSync(path.join(context.paths.configsDir, 'project-global.json'), 'utf8'));
    assert.equal(projectGlobalConfig.registerFeature, true);
    assert.equal(projectGlobalConfig.methodRoots.some(root => root.includes('codex-work')), false);
    assert.equal(projectGlobalConfig.methodRoots.some(root => root.includes('codex-tools')), false);
    assert.equal(projectGlobalConfig.methodRoots.some(root => root.includes('project-memory-data')), false);
    assert.equal(projectGlobalConfig.methodRoots.some(root => root.includes('project-memory-manager')), false);

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

    const refreshedRegistry = JSON.parse(fs.readFileSync(context.paths.featureRegistry, 'utf8'));
    const refreshedFeature = refreshedRegistry.features.find(feature => feature.featureKey === 'feature-sample');
    assert.equal(refreshedFeature.configPath, configPath.replace(/\\/g, '/'));

    assert.equal(fs.existsSync(path.join(workspaceRoot, 'project-memory')), false);
    assert.equal(fs.existsSync(context.paths.featureIndex), true);
    assert.equal(fs.existsSync(path.join(context.paths.stateDir, 'cocos-authoring-profile.json')), true);
}

function testGeneratedSnapshotFilesUseContentHash() {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-generated-workspace-'));
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-generated-data-'));
    const kbDir = path.join(dataRoot, 'kb');
    const srcRoot = path.join(workspaceRoot, 'cms-server', 'src');
    const generatedDir = path.join(srcRoot, 'config');
    const ignoredDir = path.join(srcRoot, 'generated');
    fs.mkdirSync(generatedDir, { recursive: true });
    fs.mkdirSync(ignoredDir, { recursive: true });
    fs.writeFileSync(path.join(srcRoot, 'app.ts'), 'export function appEntry(){ return "ok"; }\n');
    const generatedFile = path.join(generatedDir, 'built-env.ts');
    fs.writeFileSync(generatedFile, 'export const ENV_NAME = "dev";\n');
    fs.writeFileSync(path.join(ignoredDir, 'noise.ts'), 'export function ignoredNoise(){ return "noise"; }\n');

    const configPath = path.join(dataRoot, 'project-global.json');
    fs.writeFileSync(configPath, JSON.stringify({
        featureKey: 'project-global',
        featureName: 'Project Global KB',
        methodRoots: ['cms-server/src'],
        snapshotIgnore: ['cms-server/src/generated/**'],
        generatedFiles: ['cms-server/src/config/built-env.ts'],
        outputs: {
            scan: path.join(kbDir, 'scan.raw.json'),
            graph: path.join(kbDir, 'chain.graph.json'),
            lookup: path.join(kbDir, 'chain.lookup.json'),
            report: path.join(kbDir, 'build.report.json'),
        },
    }, null, 2));

    buildChainKb(['--workspace-root', workspaceRoot, '--data-root', dataRoot, '--config', configPath]);
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const graph = JSON.parse(fs.readFileSync(path.join(kbDir, 'chain.graph.json'), 'utf8'));
    const sourceFiles = graph.sourceSnapshot.files.map(item => item.path);
    assert.equal(graph.sourceSnapshot.staleCheckVersion, 2);
    assert.equal(sourceFiles.includes('cms-server/src/generated/noise.ts'), false);
    const generatedSignature = graph.sourceSnapshot.files.find(item => item.path === 'cms-server/src/config/built-env.ts');
    assert.equal(generatedSignature.generated, true);
    assert.ok(generatedSignature.contentHash);

    const later = new Date(Date.now() + 5000);
    fs.utimesSync(generatedFile, later, later);
    const mtimeOnly = buildKbFreshnessStatus({
        root: workspaceRoot,
        graph,
        config,
        recommendedAction: 'build_project_index',
    });
    assert.equal(mtimeOnly.status, 'fresh');
    assert.equal(mtimeOnly.changeCounts.mtimeOnly, 1);
    assert.equal(mtimeOnly.mtimeOnlyFiles[0].generated, true);

    fs.writeFileSync(generatedFile, 'export const ENV_NAME = "prod";\n');
    const stale = buildKbFreshnessStatus({
        root: workspaceRoot,
        graph,
        config,
        recommendedAction: 'build_project_index',
    });
    assert.equal(stale.status, 'stale');
    assert.ok(stale.reasonCodes.includes('source-files-changed'));
    assert.ok(stale.changedFiles.some(item => item.path === 'cms-server/src/config/built-env.ts' && item.generated === true));
}

function testImportStatsClassifyExternalDependencies() {
    const stats = computeImportResolutionStats({
        scripts: [
            {
                methods: [],
                imports: [
                    { specifier: 'vue' },
                    { specifier: 'vue-router' },
                    { specifier: 'vue' },
                    { specifier: 'element-plus/es/components' },
                    { specifier: '@/utils/api' },
                    { specifier: './local' },
                    { specifier: 'cc' },
                    { specifier: 'node:assert' },
                ],
            },
        ],
    });

    assert.deepEqual(stats.externalImports.map(item => [item.specifier, item.count]), [
        ['vue', 2],
        ['element-plus', 1],
        ['vue-router', 1],
    ]);
    assert.deepEqual(stats.unresolvedInternalImports.map(item => [item.specifier, item.count]), [
        ['./local', 1],
        ['@/utils/api', 1],
    ]);
    assert.equal(stats.unresolvedImports.includes('vue'), false);
}

function testTsconfigPathsResolveRootAlias() {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-next-alias-'));
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-next-alias-data-'));
    const context = createWorkspaceContext({ workspaceRoot, dataRoot });
    const kbDir = path.join(context.paths.featuresDir, 'next-alias');
    const configPath = path.join(context.paths.configsDir, 'next-alias.json');

    fs.mkdirSync(path.join(workspaceRoot, 'app', 'api', 'chat'), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, 'lib'), { recursive: true });
    fs.mkdirSync(context.paths.configsDir, { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, 'package.json'), '{"dependencies":{"next":"latest","typescript":"latest"}}\n');
    fs.writeFileSync(path.join(workspaceRoot, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
            paths: {
                '@/*': ['./*'],
            },
        },
    }, null, 2));
    fs.writeFileSync(path.join(workspaceRoot, 'lib', 'auth.ts'), 'export function requireAuth(){ return true; }\n');
    fs.writeFileSync(
        path.join(workspaceRoot, 'app', 'api', 'chat', 'route.ts'),
        'import { requireAuth } from "@/lib/auth";\nexport function POST(){ return requireAuth(); }\n'
    );
    fs.writeFileSync(configPath, JSON.stringify({
        featureKey: 'next-alias',
        featureName: 'Next Alias',
        methodRoots: ['app', 'lib'],
        outputs: {
            scan: path.join(kbDir, 'scan.raw.json'),
            graph: path.join(kbDir, 'chain.graph.json'),
            lookup: path.join(kbDir, 'chain.lookup.json'),
            report: path.join(kbDir, 'build.report.json'),
        },
    }, null, 2));

    buildChainKb(['--workspace-root', workspaceRoot, '--data-root', dataRoot, '--config', configPath]);
    const scan = JSON.parse(fs.readFileSync(path.join(kbDir, 'scan.raw.json'), 'utf8'));
    const routeScript = scan.scripts.find(script => script.scriptPath.endsWith('app/api/chat/route.ts'));
    const authImport = routeScript.imports.find(item => item.specifier === '@/lib/auth');

    assert.ok(authImport.resolvedPath.endsWith('lib/auth.ts'));
    assert.equal(authImport.resolvedVia, 'generic');
}

function testGenericNodeToolTopologyBuildsProjectKb() {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-node-tool-'));
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-node-tool-data-'));
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, 'package.json'), JSON.stringify({
        name: 'node-tool',
        main: 'src/index.js',
        dependencies: {
            typescript: 'latest',
        },
    }, null, 2));
    fs.writeFileSync(path.join(workspaceRoot, 'src', 'index.ts'), 'export function runTool(){ return "ok"; }\n');

    initProjectMemory(['--workspace-root', workspaceRoot, '--data-root', dataRoot, '--name', 'node-tool']);
    detectProjectTopology(['--workspace-root', workspaceRoot, '--data-root', dataRoot]);
    buildProjectKb(['--workspace-root', workspaceRoot, '--data-root', dataRoot]);

    const context = createWorkspaceContext({ workspaceRoot, dataRoot });
    const profile = JSON.parse(fs.readFileSync(context.paths.projectProfile, 'utf8'));
    const graph = JSON.parse(fs.readFileSync(path.join(context.paths.projectGlobalDir, 'chain.graph.json'), 'utf8'));

    assert.deepEqual(profile.areas.shared, ['']);
    assert.ok(profile.stacks.shared.includes('nodejs'));
    assert.ok(profile.stacks.shared.includes('typescript'));
    assert.ok(graph.nodes.some(node => node.type === 'method' && node.name.includes('runTool')));
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
testGeneratedSnapshotFilesUseContentHash();
testImportStatsClassifyExternalDependencies();
testTsconfigPathsResolveRootAlias();
testGenericNodeToolTopologyBuildsProjectKb();
console.log('workspace-layout validation passed');
