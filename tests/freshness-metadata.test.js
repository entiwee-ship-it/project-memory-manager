'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { __testing } = require('../src/mcp/server');
const { ensureDir, writeJsonAtomic } = require('../src/shared/common');
const { buildSourceSnapshot } = require('../src/shared/source-snapshot');
const { createWorkspaceContext } = require('../src/shared/workspace-layout');

function makeFixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-freshness-metadata-'));
    const workspaceRoot = path.join(root, 'workspace');
    const dataRoot = path.join(root, 'data');
    const sourcePath = path.join(workspaceRoot, 'src', 'index.js');
    ensureDir(path.dirname(sourcePath));
    fs.writeFileSync(sourcePath, 'module.exports = 1;\n');

    const context = createWorkspaceContext({
        workspaceRoot,
        dataRoot,
        layout: 'external-data',
    });
    ensureDir(context.paths.projectGlobalDir);
    ensureDir(context.paths.configsDir);

    const config = {
        featureKey: 'project-global',
        inputs: {
            scripts: ['src/**/*.js'],
            prefabs: [],
        },
    };
    const sourceSnapshot = buildSourceSnapshot(workspaceRoot, config);
    writeJsonAtomic(path.join(context.paths.configsDir, 'project-global.json'), config);
    writeJsonAtomic(path.join(context.paths.projectGlobalDir, 'build.report.json'), {
        kind: 'kb-build-report',
        sourceSnapshot,
    });
    fs.writeFileSync(path.join(context.paths.projectGlobalDir, 'chain.graph.json'), '{invalid-json');
    writeJsonAtomic(path.join(context.paths.projectGlobalDir, 'chain.lookup.json'), {});
    return { context, sourceSnapshot };
}

function testReportMetadataAvoidsGraphParse() {
    const { context } = makeFixture();
    const freshness = __testing.buildGlobalFreshness(context);
    assert.equal(freshness.status, 'fresh');
    assert.equal(freshness.stale, false);
}

function testLegacyGraphFallback() {
    const { context, sourceSnapshot } = makeFixture();
    fs.rmSync(path.join(context.paths.projectGlobalDir, 'build.report.json'));
    writeJsonAtomic(path.join(context.paths.projectGlobalDir, 'chain.graph.json'), {
        sourceSnapshot,
    });
    const freshness = __testing.buildGlobalFreshness(context);
    assert.equal(freshness.status, 'fresh');
}

testReportMetadataAvoidsGraphParse();
testLegacyGraphFallback();
console.log('freshness-metadata tests passed');
