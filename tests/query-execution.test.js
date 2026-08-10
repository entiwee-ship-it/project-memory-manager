'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { executeQuery: executeProjectQuery, run: runProjectQuery } = require('../src/commands/query/query-project');
const { buildLookup } = require('../src/graph/build-chain-kb');
const { executeQuery: executeFeatureQuery, run: runFeatureQuery } = require('../src/query/query-chain');
const { ensureDir, writeJsonAtomic } = require('../src/shared/common');
const { toPersistedLookup } = require('../src/shared/kb-lookup');
const { createWorkspaceContext } = require('../src/shared/workspace-layout');

function makeFixture() {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-query-execution-'));
    const workspaceRoot = path.join(tempRoot, 'workspace');
    const dataRoot = path.join(tempRoot, 'data');
    ensureDir(workspaceRoot);
    const context = createWorkspaceContext({ workspaceRoot, dataRoot, layout: 'external-data' });
    ensureDir(context.paths.projectGlobalDir);
    ensureDir(path.dirname(context.paths.featureRegistry));
    ensureDir(context.paths.configsDir);

    const graphPath = path.join(context.paths.projectGlobalDir, 'chain.graph.json');
    const lookupPath = path.join(context.paths.projectGlobalDir, 'chain.lookup.json');
    const reportPath = path.join(context.paths.projectGlobalDir, 'build.report.json');
    const configPath = path.join(context.paths.configsDir, 'project-global.json');
    const graph = {
        featureKey: 'project-global',
        featureName: 'Project Global',
        nodes: [{
            id: 'method:demo:run',
            type: 'method',
            name: 'Demo.run',
            file: 'src/demo.js',
            line: 4,
            area: 'shared',
            stack: 'node',
            meta: { methodName: 'run' },
        }],
        edges: [],
    };
    writeJsonAtomic(graphPath, graph);
    writeJsonAtomic(lookupPath, toPersistedLookup(buildLookup(graph)));
    writeJsonAtomic(reportPath, { kind: 'kb-build-report' });
    writeJsonAtomic(configPath, { featureKey: 'project-global', inputs: { scripts: [] } });
    writeJsonAtomic(context.paths.projectProtocols, { summary: {} });
    writeJsonAtomic(context.paths.featureRegistry, {
        features: [{
            featureKey: 'project-global',
            featureName: 'Project Global',
            kbDir: context.paths.projectGlobalDir,
            configPath,
            outputs: { graph: graphPath, lookup: lookupPath, report: reportPath },
        }],
    });
    return { workspaceRoot, dataRoot };
}

function captureJson(fn) {
    const output = [];
    const originalLog = console.log;
    console.log = value => output.push(String(value));
    try {
        fn();
    } finally {
        console.log = originalLog;
    }
    return JSON.parse(output.join('\n'));
}

function main() {
    const { workspaceRoot, dataRoot } = makeFixture();
    const projectArgv = [
        '--workspace-root', workspaceRoot,
        '--data-root', dataRoot,
        '--layout', 'external-data',
        '--method', 'Demo.run',
        '--json',
    ];
    const featureArgv = ['--feature', 'project-global', ...projectArgv];

    const projectPayload = executeProjectQuery(projectArgv).payload;
    const projectCliPayload = captureJson(() => runProjectQuery(projectArgv));
    assert.deepEqual(projectCliPayload, projectPayload);

    const featurePayload = executeFeatureQuery(featureArgv).payload;
    const featureCliPayload = captureJson(() => runFeatureQuery(featureArgv));
    assert.deepEqual(featureCliPayload, featurePayload);
    assert.equal(featurePayload.name, 'Demo.run');

    const providedFreshness = { kind: 'kb-freshness', status: 'fresh', provided: true };
    const projectSummary = executeProjectQuery([
        '--workspace-root', workspaceRoot,
        '--data-root', dataRoot,
        '--layout', 'external-data',
        '--json',
    ], { kbVersionStatus: providedFreshness }).payload;
    assert.strictEqual(projectSummary.kbFreshness, providedFreshness);

    const featureSummary = executeFeatureQuery([
        '--feature', 'project-global',
        '--workspace-root', workspaceRoot,
        '--data-root', dataRoot,
        '--layout', 'external-data',
        '--json',
    ], { kbVersionStatus: providedFreshness }).payload;
    assert.strictEqual(featureSummary.kbFreshness, providedFreshness);
    console.log('query-execution tests passed');
}

main();
