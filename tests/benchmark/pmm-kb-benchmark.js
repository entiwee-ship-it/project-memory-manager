#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createWorkspaceContext } = require('../../src/shared/workspace-layout');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const QUERY_PROJECT_BIN = path.join(REPO_ROOT, 'src', 'bin', 'query-project.js');
const DEFAULT_ITERATIONS = 3;
const DEFAULT_WARMUP = 1;
const DEFAULT_PARSE_ITERATIONS = 1;
const MAX_ITERATIONS = 50;

function readOptionValue(argv, index, option) {
    const value = argv[index + 1];
    if (value == null || value === '' || /^--?/.test(String(value))) {
        throw new Error(`MISSING_ARGUMENT_VALUE: ${option}`);
    }
    return value;
}

function parseBoundedInteger(value, option, max = MAX_ITERATIONS) {
    if (!/^\d+$/.test(String(value || ''))) {
        throw new Error(`INVALID_INTEGER: ${option} must be a non-negative integer.`);
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed > max) {
        throw new Error(`INTEGER_OUT_OF_RANGE: ${option} must be between 0 and ${max}.`);
    }
    return parsed;
}

function parseArgs(argv = process.argv.slice(2)) {
    const args = {
        workspaceRoot: process.env.PMM_BENCHMARK_WORKSPACE || '',
        dataRoot: process.env.PMM_BENCHMARK_DATA_ROOT || '',
        layout: process.env.PMM_BENCHMARK_LAYOUT || 'external-data',
        iterations: DEFAULT_ITERATIONS,
        warmup: DEFAULT_WARMUP,
        parseIterations: DEFAULT_PARSE_ITERATIONS,
        freshnessPolicy: 'allow_stale',
        method: '',
        skipCli: false,
        skipMcp: false,
        skipParse: false,
        worker: false,
        parseWorkerFile: '',
        help: false,
    };

    for (let index = 0; index < argv.length; index++) {
        const token = argv[index];
        if (token === '--workspace-root') {
            args.workspaceRoot = readOptionValue(argv, index, token);
            index++;
        } else if (token === '--data-root') {
            args.dataRoot = readOptionValue(argv, index, token);
            index++;
        } else if (token === '--layout') {
            args.layout = readOptionValue(argv, index, token);
            index++;
        } else if (token === '--iterations') {
            args.iterations = parseBoundedInteger(readOptionValue(argv, index, token), token);
            index++;
        } else if (token === '--warmup') {
            args.warmup = parseBoundedInteger(readOptionValue(argv, index, token), token, 10);
            index++;
        } else if (token === '--parse-iterations') {
            args.parseIterations = parseBoundedInteger(readOptionValue(argv, index, token), token, 10);
            index++;
        } else if (token === '--freshness-policy') {
            args.freshnessPolicy = readOptionValue(argv, index, token);
            index++;
        } else if (token === '--method') {
            args.method = readOptionValue(argv, index, token);
            index++;
        } else if (token === '--skip-cli') {
            args.skipCli = true;
        } else if (token === '--skip-mcp') {
            args.skipMcp = true;
        } else if (token === '--skip-parse') {
            args.skipParse = true;
        } else if (token === '--worker') {
            args.worker = true;
        } else if (token === '--parse-worker') {
            args.parseWorkerFile = readOptionValue(argv, index, token);
            index++;
        } else if (token === '--help' || token === '-h') {
            args.help = true;
        } else {
            throw new Error(`Unknown benchmark argument: ${token}`);
        }
    }
    return args;
}

function usage() {
    return [
        'PMM large-KB benchmark (read-only)',
        '',
        'Required:',
        '  --workspace-root <project-root>',
        '  --data-root <pmm-data-root>',
        '',
        'Options:',
        `  --iterations <n>        cold/warm query samples, default ${DEFAULT_ITERATIONS}`,
        `  --warmup <n>           warm MCP calls before measurement, default ${DEFAULT_WARMUP}`,
        `  --parse-iterations <n> artifact read/parse samples, default ${DEFAULT_PARSE_ITERATIONS}`,
        '  --method <name>         benchmark an exact method selector instead of summary',
        '  --freshness-policy <allow_stale|require_fresh>',
        '  --skip-cli              skip query-project child-process samples',
        '  --skip-mcp              skip MCP cold/warm samples',
        '  --skip-parse            skip graph/lookup/protocol read+parse samples',
        '',
        'The benchmark never builds or registers a workspace. It only reads existing PMM artifacts.',
    ].join('\n');
}

function validateArgs(args) {
    if (!String(args.workspaceRoot || '').trim()) {
        throw new Error('MISSING_WORKSPACE_ROOT: pass --workspace-root or PMM_BENCHMARK_WORKSPACE.');
    }
    if (!String(args.dataRoot || '').trim()) {
        throw new Error('MISSING_DATA_ROOT: pass --data-root or PMM_BENCHMARK_DATA_ROOT.');
    }
    if (!['allow_stale', 'require_fresh'].includes(args.freshnessPolicy)) {
        throw new Error(`INVALID_FRESHNESS_POLICY: ${args.freshnessPolicy}`);
    }
    if (!args.skipMcp && args.layout !== 'external-data') {
        throw new Error('MCP_BENCHMARK_REQUIRES_EXTERNAL_DATA_LAYOUT: pass --layout external-data or --skip-mcp.');
    }
    if (args.iterations <= 0 && (!args.skipCli || !args.skipMcp)) {
        throw new Error('INVALID_ITERATIONS: query benchmark iterations must be greater than zero.');
    }
    if (args.parseIterations <= 0 && !args.skipParse) {
        throw new Error('INVALID_PARSE_ITERATIONS: parse iterations must be greater than zero.');
    }
    if (args.skipCli && args.skipMcp && args.skipParse) {
        throw new Error('NO_BENCHMARK_SELECTED: enable at least one of CLI, MCP, or artifact parsing.');
    }
}

function round(value, digits = 2) {
    return Number(Number(value || 0).toFixed(digits));
}

function elapsedMs(startedAt) {
    return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

function memorySnapshot() {
    const usage = process.memoryUsage();
    return {
        rssMiB: round(usage.rss / 1024 / 1024),
        heapUsedMiB: round(usage.heapUsed / 1024 / 1024),
        externalMiB: round(usage.external / 1024 / 1024),
    };
}

function percentile(sortedValues, ratio) {
    if (sortedValues.length <= 0) {
        return 0;
    }
    const index = Math.min(sortedValues.length - 1, Math.ceil(sortedValues.length * ratio) - 1);
    return sortedValues[Math.max(0, index)];
}

function summarizeSamples(samples, field = 'elapsedMs') {
    const values = samples
        .map(sample => Number(sample[field]))
        .filter(Number.isFinite)
        .sort((left, right) => left - right);
    if (values.length <= 0) {
        return { count: 0, minMs: 0, meanMs: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 };
    }
    return {
        count: values.length,
        minMs: round(values[0]),
        meanMs: round(values.reduce((sum, value) => sum + value, 0) / values.length),
        p50Ms: round(percentile(values, 0.50)),
        p95Ms: round(percentile(values, 0.95)),
        maxMs: round(values[values.length - 1]),
    };
}

function resolveArtifacts(args) {
    const context = createWorkspaceContext({
        workspaceRoot: args.workspaceRoot,
        dataRoot: args.dataRoot,
        layout: args.layout,
    });
    const artifacts = {
        graph: path.join(context.paths.projectGlobalDir, 'chain.graph.json'),
        lookup: path.join(context.paths.projectGlobalDir, 'chain.lookup.json'),
        protocols: context.paths.projectProtocols,
    };
    for (const [name, filePath] of Object.entries(artifacts)) {
        if (!fs.existsSync(filePath)) {
            throw new Error(`MISSING_ARTIFACT: ${name} not found: ${filePath}`);
        }
    }
    return { context, artifacts };
}

function readAndParseJson(filePath) {
    if (typeof global.gc === 'function') {
        global.gc();
    }
    const memoryBefore = memorySnapshot();
    const startedAt = process.hrtime.bigint();
    const raw = fs.readFileSync(filePath, 'utf8');
    const readMs = elapsedMs(startedAt);
    const parseStartedAt = process.hrtime.bigint();
    const value = JSON.parse(raw.replace(/^\uFEFF/, ''));
    const parseMs = elapsedMs(parseStartedAt);
    const memoryAfter = memorySnapshot();
    return {
        file: filePath.replace(/\\/g, '/'),
        bytes: Buffer.byteLength(raw),
        readMs: round(readMs),
        parseMs: round(parseMs),
        elapsedMs: round(readMs + parseMs),
        topLevelKeys: value && typeof value === 'object' ? Object.keys(value).slice(0, 12) : [],
        memoryBefore,
        memoryAfter,
    };
}

function buildLayoutArgv(args) {
    const argv = [
        '--workspace-root', args.workspaceRoot,
        '--data-root', args.dataRoot,
        '--layout', args.layout,
        '--json',
    ];
    if (args.method) {
        argv.push('--method', args.method);
    }
    return argv;
}

function runCliColdSample(args) {
    const startedAt = process.hrtime.bigint();
    const child = spawnSync(process.execPath, [QUERY_PROJECT_BIN, ...buildLayoutArgv(args)], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 20 * 1024 * 1024,
    });
    const processMs = elapsedMs(startedAt);
    if (child.error) {
        throw child.error;
    }
    if (child.status !== 0) {
        throw new Error((child.stderr || child.stdout || `query-project exited with ${child.status}`).trim());
    }
    const payload = JSON.parse(child.stdout || '{}');
    return {
        elapsedMs: round(processMs),
        outputBytes: Buffer.byteLength(child.stdout || ''),
        freshnessStatus: payload.kbFreshness?.status || '',
    };
}

function workerArgv(args) {
    const argv = [
        __filename,
        '--worker',
        '--workspace-root', args.workspaceRoot,
        '--data-root', args.dataRoot,
        '--layout', args.layout,
        '--freshness-policy', args.freshnessPolicy,
        '--iterations', '1',
        '--skip-cli',
        '--skip-parse',
    ];
    if (args.method) {
        argv.push('--method', args.method);
    }
    return argv;
}

function parseWorkerOutput(output) {
    const lines = String(output || '').trim().split(/\r?\n/).filter(Boolean);
    return JSON.parse(lines[lines.length - 1] || '{}');
}

function parseWorkerArgv(filePath) {
    return [
        '--expose-gc',
        __filename,
        '--parse-worker',
        filePath,
    ];
}

function runParseColdSample(filePath) {
    const startedAt = process.hrtime.bigint();
    const child = spawnSync(process.execPath, parseWorkerArgv(filePath), {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 20 * 1024 * 1024,
    });
    const processMs = elapsedMs(startedAt);
    if (child.error) {
        throw child.error;
    }
    if (child.status !== 0) {
        throw new Error((child.stderr || child.stdout || `parse benchmark worker exited with ${child.status}`).trim());
    }
    return {
        ...parseWorkerOutput(child.stdout),
        processElapsedMs: round(processMs),
    };
}

function runMcpColdSample(args) {
    const startedAt = process.hrtime.bigint();
    const child = spawnSync(process.execPath, workerArgv(args), {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 20 * 1024 * 1024,
    });
    const processMs = elapsedMs(startedAt);
    if (child.error) {
        throw child.error;
    }
    if (child.status !== 0) {
        throw new Error((child.stderr || child.stdout || `benchmark worker exited with ${child.status}`).trim());
    }
    return {
        ...parseWorkerOutput(child.stdout),
        elapsedMs: round(processMs),
    };
}

function mcpArguments(args) {
    return {
        workspaceRoot: args.workspaceRoot,
        dataRoot: args.dataRoot,
        freshnessPolicy: args.freshnessPolicy,
        detail: 'compact',
        ...(args.method ? { method: args.method } : {}),
    };
}

async function callMcpQuery(args, id) {
    const { handleMcpRequest } = require('../../src/mcp/server');
    const response = await handleMcpRequest({
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: {
            name: 'query_project_chain',
            arguments: mcpArguments(args),
        },
    });
    const text = response?.result?.content?.find(item => item.type === 'text')?.text || '';
    if (!text) {
        throw new Error('MCP query returned no text payload.');
    }
    const payload = JSON.parse(text);
    if (payload.ok === false) {
        throw new Error(payload.error || payload.message || 'MCP query failed.');
    }
    return payload;
}

async function runMcpWarmSamples(args) {
    for (let index = 0; index < args.warmup; index++) {
        await callMcpQuery(args, 10_000 + index);
    }
    const samples = [];
    for (let index = 0; index < args.iterations; index++) {
        const startedAt = process.hrtime.bigint();
        const payload = await callMcpQuery(args, 20_000 + index);
        samples.push({
            elapsedMs: round(elapsedMs(startedAt)),
            queryElapsedMs: Number(payload._mcpCache?.elapsedMs || 0),
            cacheHit: Boolean(payload._mcpCache?.hit),
            freshnessStatus: payload.kbFreshness?.status || payload._mcpFreshness?.finalStatus || '',
        });
    }
    return samples;
}

async function runWorker(args) {
    validateArgs(args);
    const startedAt = process.hrtime.bigint();
    const payload = await callMcpQuery(args, 1);
    process.stdout.write(`${JSON.stringify({
        workerElapsedMs: round(elapsedMs(startedAt)),
        queryElapsedMs: Number(payload._mcpCache?.elapsedMs || 0),
        cacheHit: Boolean(payload._mcpCache?.hit),
        freshnessStatus: payload.kbFreshness?.status || payload._mcpFreshness?.finalStatus || '',
        memory: memorySnapshot(),
    })}\n`);
}

function runParseWorker(args) {
    process.stdout.write(`${JSON.stringify(readAndParseJson(args.parseWorkerFile))}\n`);
}

function runParseBenchmarks(args, artifacts) {
    const result = {};
    for (const [name, filePath] of Object.entries(artifacts)) {
        const samples = [];
        for (let index = 0; index < args.parseIterations; index++) {
            samples.push(runParseColdSample(filePath));
        }
        result[name] = {
            samples,
            summary: summarizeSamples(samples),
            readSummary: summarizeSamples(samples, 'readMs'),
            parseSummary: summarizeSamples(samples, 'parseMs'),
            processSummary: summarizeSamples(samples, 'processElapsedMs'),
        };
    }
    return result;
}

async function runBenchmark(args) {
    validateArgs(args);
    const { context, artifacts } = resolveArtifacts(args);
    const result = {
        kind: 'pmm-kb-benchmark',
        generatedAt: new Date().toISOString(),
        runtime: {
            node: process.version,
            v8: process.versions.v8,
            platform: process.platform,
            arch: process.arch,
        },
        target: {
            workspaceRoot: context.workspaceRoot,
            dataRoot: context.dataRoot,
            workspaceId: context.workspaceId,
            layout: context.layout,
            freshnessPolicy: args.freshnessPolicy,
            method: args.method || null,
        },
        options: {
            iterations: args.iterations,
            warmup: args.warmup,
            parseIterations: args.parseIterations,
        },
        warnings: [
            'cold means a new Node process; the operating-system file cache may still be warm.',
            args.freshnessPolicy === 'allow_stale'
                ? 'allow_stale benchmarks existing artifacts and never rebuilds them.'
                : 'require_fresh never rebuilds artifacts; stale targets fail instead of changing workspace state.',
            'freshnessPolicy applies to MCP samples; query-project CLI samples are read-only and report freshness without enforcing that policy.',
            'artifact parse samples run in isolated Node processes; memory snapshots are observations before/after parse, not a sampled peak profiler.',
        ],
    };

    if (!args.skipCli) {
        const samples = Array.from({ length: args.iterations }, () => runCliColdSample(args));
        result.cliCold = { samples, summary: summarizeSamples(samples) };
    }
    if (!args.skipMcp) {
        const coldSamples = Array.from({ length: args.iterations }, () => runMcpColdSample(args));
        const warmSamples = await runMcpWarmSamples(args);
        result.mcpCold = {
            samples: coldSamples,
            summary: summarizeSamples(coldSamples),
            workerSummary: summarizeSamples(coldSamples, 'workerElapsedMs'),
            querySummary: summarizeSamples(coldSamples, 'queryElapsedMs'),
            cacheHits: coldSamples.filter(sample => sample.cacheHit).length,
        };
        result.mcpWarm = {
            samples: warmSamples,
            summary: summarizeSamples(warmSamples),
            querySummary: summarizeSamples(warmSamples, 'queryElapsedMs'),
            cacheHits: warmSamples.filter(sample => sample.cacheHit).length,
        };
    }
    if (!args.skipParse) {
        result.artifactParse = runParseBenchmarks(args, artifacts);
    }
    return result;
}

async function main(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    if (args.help) {
        console.log(usage());
        return;
    }
    if (args.parseWorkerFile) {
        runParseWorker(args);
        return;
    }
    if (args.worker) {
        await runWorker(args);
        return;
    }
    const result = await runBenchmark(args);
    console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
    main().catch(error => {
        console.error(error instanceof Error ? error.stack || error.message : error);
        process.exit(1);
    });
}

module.exports = {
    buildLayoutArgv,
    memorySnapshot,
    parseArgs,
    parseWorkerArgv,
    readAndParseJson,
    runBenchmark,
    summarizeSamples,
    validateArgs,
    workerArgv,
};
