const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');

function exists(relativePath) {
    return fs.existsSync(path.join(root, relativePath));
}

function readJson(relativePath) {
    return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function testNoLegacyRuntimeRoots() {
    assert.equal(exists('scripts'), false, 'legacy scripts directory must be removed');
    assert.equal(exists('project-memory'), false, 'root project-memory runtime data must not live in source repo');
}

function testRequiredSourceDirectories() {
    for (const dir of [
        'src/bin',
        'src/commands',
        'src/agent',
        'src/mcp',
        'src/lifecycle',
        'src/extraction',
        'src/graph',
        'src/query',
        'src/discovery',
        'src/adapters',
        'src/maintenance',
        'src/shared',
    ]) {
        assert.equal(exists(dir), true, `missing source directory: ${dir}`);
    }
}

function testRequiredBins() {
    for (const file of [
        'src/bin/mcp.js',
        'src/bin/init-workspace.js',
        'src/bin/detect-topology.js',
        'src/bin/build-project.js',
        'src/bin/discover-features.js',
        'src/bin/build-feature.js',
        'src/bin/query-project.js',
        'src/bin/query-feature.js',
        'src/bin/query-chain.js',
        'src/bin/prepare-task-context.js',
        'src/bin/explain-feature-for-agent.js',
        'src/bin/analyze-change-impact.js',
        'src/bin/decide-pmm-usage.js',
        'src/bin/plan-task-execution.js',
        'src/bin/validate-edit-scope.js',
        'src/bin/review-patch-for-agent.js',
        'src/bin/record-task-outcome.js',
        'src/bin/recall-task-memory.js',
        'src/bin/prepare-agent-brief.js',
        'src/bin/summarize-project-memory.js',
        'src/bin/update-project-playbook.js',
        'src/bin/rebuild-kbs.js',
        'src/bin/validate-package.js',
    ]) {
        assert.equal(exists(file), true, `missing bin: ${file}`);
        const mod = require(path.join(root, file));
        assert.equal(typeof mod.run, 'function', `bin must export run(): ${file}`);
    }
}

function testPackageAndVersionUseNewEntrypoints() {
    const pkg = readJson('package.json');
    assert.equal(pkg.scripts.mcp, 'node src/bin/mcp.js');
    assert.equal(pkg.scripts['test:source-layout'], 'node tests/source-layout.test.js');

    const version = readJson('skill-version.json');
    assert.equal(version.rebuildCommand, 'node src/bin/rebuild-kbs.js --workspace-root <project-root>');
}

testNoLegacyRuntimeRoots();
testRequiredSourceDirectories();
testRequiredBins();
testPackageAndVersionUseNewEntrypoints();
console.log('source-layout validation passed');
