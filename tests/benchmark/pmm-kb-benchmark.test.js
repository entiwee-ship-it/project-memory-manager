const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createWorkspaceContext } = require('../../src/shared/workspace-layout');
const {
    buildLayoutArgv,
    buildMixedSelectors,
    parseArgs,
    parseWorkerArgv,
    readAndParseJson,
    runBenchmark,
    summarizeSamples,
    validateArgs,
    workerArgv,
} = require('./pmm-kb-benchmark');

const benchmarkBin = path.join(__dirname, 'pmm-kb-benchmark.js');

function snapshotFiles(root) {
    const result = {};
    const visit = current => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const absolutePath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                visit(absolutePath);
                continue;
            }
            result[path.relative(root, absolutePath).replace(/\\/g, '/')] = fs.readFileSync(absolutePath, 'utf8');
        }
    };
    visit(root);
    return result;
}

async function main() {
    const parsed = parseArgs([
        '--workspace-root', 'E:/workspace/sample',
        '--data-root', 'E:/pmm-data',
        '--iterations', '5',
        '--warmup', '2',
        '--parse-iterations', '2',
        '--mixed-queries', '6',
        '--method', 'Sample.run',
        '--freshness-policy', 'require_fresh',
    ]);
    assert.equal(parsed.workspaceRoot, 'E:/workspace/sample');
    assert.equal(parsed.dataRoot, 'E:/pmm-data');
    assert.equal(parsed.iterations, 5);
    assert.equal(parsed.warmup, 2);
    assert.equal(parsed.parseIterations, 2);
    assert.equal(parsed.mixedQueries, 6);
    assert.equal(parsed.method, 'Sample.run');
    assert.equal(parsed.freshnessPolicy, 'require_fresh');
    assert.doesNotThrow(() => validateArgs(parsed));

    assert.throws(
        () => validateArgs(parseArgs([])),
        /MISSING_WORKSPACE_ROOT/
    );
    assert.throws(
        () => parseArgs(['--workspace-root']),
        /MISSING_ARGUMENT_VALUE: --workspace-root/
    );
    assert.throws(
        () => parseArgs(['--iterations', '3x']),
        /INVALID_INTEGER: --iterations/
    );
    assert.throws(
        () => parseArgs(['--iterations', '51']),
        /INTEGER_OUT_OF_RANGE: --iterations/
    );
    assert.throws(
        () => parseArgs(['--unknown']),
        /Unknown benchmark argument/
    );
    assert.throws(
        () => validateArgs(parseArgs([
            '--workspace-root', 'E:/workspace/sample',
            '--data-root', 'E:/pmm-data',
            '--freshness-policy', 'auto_rebuild',
        ])),
        /INVALID_FRESHNESS_POLICY/
    );
    assert.throws(
        () => validateArgs({
            ...parsed,
            layout: 'legacy-project-memory',
        }),
        /MCP_BENCHMARK_REQUIRES_EXTERNAL_DATA_LAYOUT/
    );
    assert.doesNotThrow(() => validateArgs({
        ...parsed,
        layout: 'legacy-project-memory',
        skipMcp: true,
    }));
    assert.throws(
        () => validateArgs({
            ...parsed,
            skipCli: true,
            skipMcp: true,
            skipParse: true,
        }),
        /NO_BENCHMARK_SELECTED/
    );

    assert.deepEqual(buildLayoutArgv(parsed), [
        '--workspace-root', 'E:/workspace/sample',
        '--data-root', 'E:/pmm-data',
        '--layout', 'external-data',
        '--json',
        '--method', 'Sample.run',
    ]);
    assert.deepEqual(workerArgv(parsed), [
        benchmarkBin,
        '--worker',
        '--workspace-root', 'E:/workspace/sample',
        '--data-root', 'E:/pmm-data',
        '--layout', 'external-data',
        '--freshness-policy', 'require_fresh',
        '--iterations', '1',
        '--skip-cli',
        '--skip-parse',
        '--method', 'Sample.run',
    ]);
    assert.deepEqual(parseWorkerArgv('E:/pmm-data/sample.json'), [
        '--expose-gc',
        benchmarkBin,
        '--parse-worker',
        'E:/pmm-data/sample.json',
    ]);

    assert.deepEqual(buildMixedSelectors({
        methods: { 'A.run': {}, 'B.run': {} },
        messages: { HELLO: {} },
        endpoints: { 'GET /api/demo': {} },
    }, 4), [
        { method: 'A.run' },
        { message: 'HELLO' },
        { endpoint: 'GET /api/demo' },
        { method: 'B.run' },
    ]);

    assert.deepEqual(summarizeSamples([
        { elapsedMs: 10, queryElapsedMs: 1 },
        { elapsedMs: 20, queryElapsedMs: 2 },
        { elapsedMs: 30, queryElapsedMs: 3 },
        { elapsedMs: 40, queryElapsedMs: 4 },
    ]), {
        count: 4,
        minMs: 10,
        meanMs: 25,
        p50Ms: 20,
        p95Ms: 40,
        maxMs: 40,
    });
    assert.deepEqual(summarizeSamples([
        { queryElapsedMs: 1 },
        { queryElapsedMs: 3 },
    ], 'queryElapsedMs'), {
        count: 2,
        minMs: 1,
        meanMs: 2,
        p50Ms: 1,
        p95Ms: 3,
        maxMs: 3,
    });

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-benchmark-contract-'));
    const jsonPath = path.join(tempRoot, 'sample.json');
    fs.writeFileSync(jsonPath, JSON.stringify({ ok: true, items: [1, 2, 3] }), 'utf8');
    const measured = readAndParseJson(jsonPath);
    assert.equal(measured.file, jsonPath.replace(/\\/g, '/'));
    assert.equal(measured.bytes, fs.statSync(jsonPath).size);
    assert.deepEqual(measured.topLevelKeys, ['ok', 'items']);
    assert.ok(measured.readMs >= 0);
    assert.ok(measured.parseMs >= 0);
    assert.ok(measured.memoryAfter.rssMiB > 0);

    const workspaceRoot = path.join(tempRoot, 'workspace');
    const dataRoot = path.join(tempRoot, 'data');
    fs.mkdirSync(workspaceRoot, { recursive: true });
    const context = createWorkspaceContext({ workspaceRoot, dataRoot, layout: 'external-data' });
    fs.mkdirSync(context.paths.projectGlobalDir, { recursive: true });
    fs.mkdirSync(path.dirname(context.paths.projectProtocols), { recursive: true });
    fs.writeFileSync(path.join(context.paths.projectGlobalDir, 'chain.graph.json'), '{"nodes":[],"edges":[]}\n');
    fs.writeFileSync(path.join(context.paths.projectGlobalDir, 'chain.lookup.json'), '{"nodesByType":{}}\n');
    fs.writeFileSync(path.join(context.paths.projectGlobalDir, 'build.report.json'), '{"sourceSnapshot":{}}\n');
    fs.writeFileSync(context.paths.projectProtocols, '{"summary":{}}\n');

    const parseOnlyArgs = parseArgs([
        '--workspace-root', workspaceRoot,
        '--data-root', dataRoot,
        '--iterations', '0',
        '--parse-iterations', '1',
        '--skip-cli',
        '--skip-mcp',
    ]);
    const before = snapshotFiles(tempRoot);
    const benchmark = await runBenchmark(parseOnlyArgs);
    const after = snapshotFiles(tempRoot);
    assert.deepEqual(after, before, 'parse-only benchmark must not write target workspace or PMM data');
    assert.equal(benchmark.kind, 'pmm-kb-benchmark');
    assert.equal(benchmark.artifactParse.graph.summary.count, 1);
    assert.equal(benchmark.artifactParse.graph.readSummary.count, 1);
    assert.equal(benchmark.artifactParse.graph.parseSummary.count, 1);
    assert.equal(benchmark.artifactParse.graph.processSummary.count, 1);
    assert.equal(benchmark.artifactParse.graph.bytes, fs.statSync(path.join(context.paths.projectGlobalDir, 'chain.graph.json')).size);
    assert.equal(benchmark.artifactParse.graph.bytesStable, true);
    assert.equal(benchmark.artifactParse.graph.samples[0].artifactShape.hasNodes, true);
    assert.equal(benchmark.artifactParse.report.samples[0].artifactShape.hasSourceSnapshot, true);
    assert.ok(benchmark.artifactParse.graph.samples[0].processElapsedMs >= benchmark.artifactParse.graph.samples[0].elapsedMs);

    const help = spawnSync(process.execPath, [benchmarkBin, '--help'], {
        encoding: 'utf8',
        windowsHide: true,
    });
    assert.equal(help.status, 0);
    assert.match(help.stdout, /PMM large-KB benchmark \(read-only\)/);

    const missingArgs = spawnSync(process.execPath, [benchmarkBin], {
        encoding: 'utf8',
        windowsHide: true,
        env: {
            ...process.env,
            PMM_BENCHMARK_WORKSPACE: '',
            PMM_BENCHMARK_DATA_ROOT: '',
        },
    });
    assert.notEqual(missingArgs.status, 0);
    assert.match(missingArgs.stderr, /MISSING_WORKSPACE_ROOT/);

    const parseOnlyCli = spawnSync(process.execPath, [
        benchmarkBin,
        '--workspace-root', workspaceRoot,
        '--data-root', dataRoot,
        '--iterations', '0',
        '--parse-iterations', '1',
        '--skip-cli',
        '--skip-mcp',
    ], {
        encoding: 'utf8',
        windowsHide: true,
    });
    assert.equal(parseOnlyCli.status, 0, parseOnlyCli.stderr);
    assert.equal(JSON.parse(parseOnlyCli.stdout).kind, 'pmm-kb-benchmark');
    assert.deepEqual(snapshotFiles(tempRoot), before, 'CLI parse-only benchmark must remain read-only');

    console.log('PMM KB benchmark contract validation passed');
}

main().catch(error => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exit(1);
});
