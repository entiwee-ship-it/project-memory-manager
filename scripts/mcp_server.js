#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const { createWorkspaceContext } = require('./lib/workspace-layout');
const { run: initProjectMemory } = require('./init_project_memory');
const { run: detectProjectTopology } = require('./detect_project_topology');
const { run: buildProjectKb } = require('./build_project_kb');
const { run: discoverFeaturesCli } = require('./discover_features');
const { run: buildFeatureIndexCli } = require('./build_feature_index');
const { run: queryProjectKb } = require('./query_project_kb');
const { loadSkillVersion } = require('./show_skill_version');

const jobs = new Map();
let nextJobId = 1;

const TOOL_DEFINITIONS = [
    {
        name: 'inspect_workspace',
        description: 'Inspect a target workspace without writing PMM files into it.',
        inputSchema: {
            type: 'object',
            properties: {
                workspaceRoot: { type: 'string' },
                dataRoot: { type: 'string' },
            },
            required: ['workspaceRoot'],
        },
    },
    {
        name: 'get_current_state',
        description: 'Return PMM data-root state for a target workspace.',
        inputSchema: {
            type: 'object',
            properties: {
                workspaceRoot: { type: 'string' },
                dataRoot: { type: 'string' },
            },
            required: ['workspaceRoot'],
        },
    },
    {
        name: 'build_project_index',
        description: 'Build project-global KB into PMM data root.',
        inputSchema: {
            type: 'object',
            properties: {
                workspaceRoot: { type: 'string' },
                dataRoot: { type: 'string' },
                dryRun: { type: 'boolean' },
            },
            required: ['workspaceRoot'],
        },
    },
    {
        name: 'init_workspace',
        description: 'Initialize PMM external data for a target workspace without writing memory files into the workspace.',
        inputSchema: {
            type: 'object',
            properties: {
                workspaceRoot: { type: 'string' },
                dataRoot: { type: 'string' },
                name: { type: 'string' },
            },
            required: ['workspaceRoot'],
        },
    },
    {
        name: 'detect_topology',
        description: 'Detect workspace topology and write project-profile.json into PMM data root.',
        inputSchema: {
            type: 'object',
            properties: {
                workspaceRoot: { type: 'string' },
                dataRoot: { type: 'string' },
            },
            required: ['workspaceRoot'],
        },
    },
    {
        name: 'diagnose_workspace',
        description: 'Diagnose PMM external-data state and suggest the next lifecycle action.',
        inputSchema: {
            type: 'object',
            properties: {
                workspaceRoot: { type: 'string' },
                dataRoot: { type: 'string' },
            },
            required: ['workspaceRoot'],
        },
    },
    {
        name: 'start_build_project_index',
        description: 'Start an asynchronous project-global KB build job.',
        inputSchema: {
            type: 'object',
            properties: {
                workspaceRoot: { type: 'string' },
                dataRoot: { type: 'string' },
                forceTopology: { type: 'boolean' },
            },
            required: ['workspaceRoot'],
        },
    },
    {
        name: 'get_job_status',
        description: 'Return current status for an asynchronous PMM job.',
        inputSchema: {
            type: 'object',
            properties: {
                jobId: { type: 'string' },
            },
            required: ['jobId'],
        },
    },
    {
        name: 'get_job_result',
        description: 'Return final result and workspace state for an asynchronous PMM job.',
        inputSchema: {
            type: 'object',
            properties: {
                jobId: { type: 'string' },
            },
            required: ['jobId'],
        },
    },
    {
        name: 'discover_features',
        description: 'Discover feature candidates from project-global KB and optionally write feature-candidates.json.',
        inputSchema: {
            type: 'object',
            properties: {
                workspaceRoot: { type: 'string' },
                dataRoot: { type: 'string' },
                limit: { type: 'number' },
                minConfidence: { type: 'string' },
                write: { type: 'boolean' },
            },
            required: ['workspaceRoot'],
        },
    },
    {
        name: 'build_feature_index',
        description: 'Generate a feature KB config from a discovered candidate and optionally build it.',
        inputSchema: {
            type: 'object',
            properties: {
                workspaceRoot: { type: 'string' },
                dataRoot: { type: 'string' },
                featureKey: { type: 'string' },
                dryRun: { type: 'boolean' },
            },
            required: ['workspaceRoot', 'featureKey'],
        },
    },
    {
        name: 'query_project_chain',
        description: 'Query project-global KB from PMM data root.',
        inputSchema: {
            type: 'object',
            properties: {
                workspaceRoot: { type: 'string' },
                dataRoot: { type: 'string' },
                message: { type: 'string' },
                timing: { type: 'string' },
                phase: { type: 'string' },
                transition: { type: 'string' },
                event: { type: 'string' },
                method: { type: 'string' },
                request: { type: 'string' },
                state: { type: 'string' },
                type: { type: 'string' },
                name: { type: 'string' },
                tag: { type: 'string' },
                file: { type: 'string' },
                from: { type: 'string' },
                direction: { type: 'string' },
                upstream: { type: 'boolean' },
                downstream: { type: 'boolean' },
                limit: { type: 'number' },
                depth: { type: 'number' },
            },
            required: ['workspaceRoot'],
        },
    },
];

function textResult(value) {
    return {
        content: [
            {
                type: 'text',
                text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
            },
        ],
    };
}

function toolArgs(params = {}) {
    return params.arguments && typeof params.arguments === 'object' ? params.arguments : {};
}

function layoutArgv(args = {}) {
    const argv = ['--workspace-root', args.workspaceRoot, '--layout', 'external-data'];
    if (args.dataRoot) {
        argv.push('--data-root', args.dataRoot);
    }
    return argv;
}

function readJsonSafe(filePath, fallback = null) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return fallback;
    }
}

function hasConfiguredAreaRoots(projectProfile) {
    return Object.values(projectProfile?.areas || {}).some(
        roots => Array.isArray(roots) && roots.length > 0
    );
}

function captureConsoleLog(fn) {
    const output = [];
    const oldLog = console.log;
    try {
        console.log = (...values) => output.push(values.map(value => String(value)).join(' '));
        const value = fn();
        return { output: output.join('\n'), value };
    } finally {
        console.log = oldLog;
    }
}

function buildWorkspaceState(args) {
    const context = createWorkspaceContext({
        workspaceRoot: args.workspaceRoot,
        dataRoot: args.dataRoot,
        layout: 'external-data',
    });
    const projectProfile = readJsonSafe(context.paths.projectProfile, null);
    const hasProjectProfile = Boolean(projectProfile);
    const hasAreaRoots = hasConfiguredAreaRoots(projectProfile);
    const hasProjectGlobalKb = fs.existsSync(path.join(context.paths.projectGlobalDir, 'chain.graph.json'))
        && fs.existsSync(path.join(context.paths.projectGlobalDir, 'chain.lookup.json'));
    return {
        workspaceRoot: context.workspaceRoot,
        dataRoot: context.dataRoot,
        layout: context.layout,
        workspaceId: context.workspaceId,
        memoryRoot: context.memoryRoot,
        manifest: context.paths.manifest,
        projectProfile: context.paths.projectProfile,
        featureRegistry: context.paths.featureRegistry,
        projectGlobalDir: context.paths.projectGlobalDir,
        initialized: fs.existsSync(context.paths.manifest),
        hasProjectProfile,
        hasConfiguredAreaRoots: hasAreaRoots,
        hasProjectGlobalKb,
        legacyProjectMemoryExists: fs.existsSync(path.join(context.workspaceRoot, 'project-memory')),
        areas: projectProfile?.areas || null,
        stacks: projectProfile?.stacks || null,
        suggestedNextAction: !fs.existsSync(context.paths.manifest)
            ? 'init_workspace'
            : (!hasProjectProfile || !hasAreaRoots)
                ? 'detect_topology'
                : !hasProjectGlobalKb
                    ? 'build_project_index'
                    : 'query_project_chain',
    };
}

function inspectWorkspace(args) {
    const context = createWorkspaceContext({
        workspaceRoot: args.workspaceRoot,
        dataRoot: args.dataRoot,
        layout: 'external-data',
    });
    return textResult({
        workspaceRoot: context.workspaceRoot,
        dataRoot: context.dataRoot,
        workspaceId: context.workspaceId,
        memoryRoot: context.memoryRoot,
        layout: context.layout,
    });
}

function getCurrentState(args) {
    return textResult(buildWorkspaceState(args));
}

function initWorkspace(args) {
    const argv = [...layoutArgv(args)];
    if (args.name) {
        argv.push('--name', args.name);
    }
    const captured = captureConsoleLog(() => initProjectMemory(argv));
    return textResult({
        ...buildWorkspaceState(args),
        initialized: true,
        output: captured.output,
    });
}

function detectTopology(args) {
    const captured = captureConsoleLog(() => detectProjectTopology(layoutArgv(args)));
    return textResult({
        ...buildWorkspaceState(args),
        output: captured.output,
    });
}

function ensureWorkspacePrepared(args) {
    let state = buildWorkspaceState(args);
    const output = [];
    if (!state.initialized) {
        output.push(captureConsoleLog(() => initProjectMemory(layoutArgv(args))).output);
        state = buildWorkspaceState(args);
    }
    if (!state.hasProjectProfile || !state.hasConfiguredAreaRoots) {
        output.push(captureConsoleLog(() => detectProjectTopology(layoutArgv(args))).output);
        state = buildWorkspaceState(args);
    }
    return {
        state,
        output: output.filter(Boolean).join('\n'),
    };
}

function diagnoseWorkspace(args) {
    const state = buildWorkspaceState(args);
    const missingAreaRoots = [];
    for (const roots of Object.values(state.areas || {})) {
        for (const areaRoot of Array.isArray(roots) ? roots : []) {
            if (!fs.existsSync(path.resolve(state.workspaceRoot, areaRoot))) {
                missingAreaRoots.push(areaRoot);
            }
        }
    }
    return textResult({
        ...state,
        missingAreaRoots,
        isHealthy: state.initialized && state.hasProjectProfile && state.hasConfiguredAreaRoots && missingAreaRoots.length === 0,
    });
}

function buildProjectIndex(args) {
    if (args.dryRun !== false) {
        return inspectWorkspace(args);
    }
    const prepared = ensureWorkspacePrepared(args);
    const captured = captureConsoleLog(() => buildProjectKb(layoutArgv(args)));
    return textResult({
        ...buildWorkspaceState(args),
        output: [prepared.output, captured.output].filter(Boolean).join('\n'),
    });
}

function createJob(type, args) {
    const jobId = `job-${Date.now()}-${nextJobId++}`;
    const job = {
        jobId,
        type,
        args: { ...args },
        status: 'queued',
        phase: 'queued',
        startedAt: null,
        endedAt: null,
        exitCode: null,
        output: '',
        error: '',
    };
    jobs.set(jobId, job);
    return job;
}

function runNodeScript(job, phase, scriptName, args) {
    return new Promise(resolve => {
        job.phase = phase;
        const child = spawn(process.execPath, [path.join(__dirname, scriptName), ...args], {
            cwd: path.resolve(__dirname, '..'),
            windowsHide: true,
        });
        child.stdout.on('data', chunk => {
            job.output += chunk.toString();
        });
        child.stderr.on('data', chunk => {
            job.error += chunk.toString();
        });
        child.on('close', code => {
            job.exitCode = code;
            resolve(code === 0);
        });
        child.on('error', error => {
            job.error += `${error.message}\n`;
            job.exitCode = 1;
            resolve(false);
        });
    });
}

async function runBuildJob(job) {
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    const args = layoutArgv(job.args);
    const initOk = await runNodeScript(job, 'init', 'init_project_memory.js', args);
    if (!initOk) {
        job.status = 'failed';
        job.endedAt = new Date().toISOString();
        return;
    }
    if (job.args.forceTopology !== false) {
        const topologyOk = await runNodeScript(job, 'topology', 'detect_project_topology.js', args);
        if (!topologyOk) {
            job.status = 'failed';
            job.endedAt = new Date().toISOString();
            return;
        }
    }
    const buildOk = await runNodeScript(job, 'build', 'build_project_kb.js', args);
    job.status = buildOk ? 'succeeded' : 'failed';
    job.phase = buildOk ? 'done' : job.phase;
    job.endedAt = new Date().toISOString();
}

function publicJob(job) {
    return {
        jobId: job.jobId,
        type: job.type,
        status: job.status,
        phase: job.phase,
        startedAt: job.startedAt,
        endedAt: job.endedAt,
        exitCode: job.exitCode,
        outputTail: job.output.slice(-4000),
        errorTail: job.error.slice(-4000),
    };
}

function startBuildProjectIndex(args) {
    const job = createJob('build_project_index', args);
    setImmediate(() => runBuildJob(job));
    return textResult(publicJob(job));
}

function getJobStatus(args) {
    const job = jobs.get(args.jobId);
    if (!job) {
        return textResult({ status: 'missing', jobId: args.jobId, isError: true });
    }
    return textResult(publicJob(job));
}

function getJobResult(args) {
    const job = jobs.get(args.jobId);
    if (!job) {
        return textResult({ status: 'missing', jobId: args.jobId, isError: true });
    }
    return textResult({
        ...publicJob(job),
        ...buildWorkspaceState(job.args),
    });
}

function discoverFeatures(args) {
    const argv = [...layoutArgv(args), '--json'];
    if (Number.isFinite(args.limit)) {
        argv.push('--limit', String(args.limit));
    }
    if (args.minConfidence) {
        argv.push('--min-confidence', args.minConfidence);
    }
    if (args.write === false) {
        argv.push('--no-write');
    }
    const captured = captureConsoleLog(() => discoverFeaturesCli(argv));
    return textResult(captured.value || captured.output);
}

function buildFeatureIndex(args) {
    const argv = [...layoutArgv(args), '--feature-key', args.featureKey, '--json'];
    if (args.dryRun !== false) {
        argv.push('--dry-run');
    }
    const captured = captureConsoleLog(() => buildFeatureIndexCli(argv));
    return textResult({
        ...(captured.value || {}),
        workspaceState: buildWorkspaceState(args),
    });
}

function queryProjectChain(args) {
    const argv = [...layoutArgv(args), '--json'];
    for (const key of ['message', 'timing', 'phase', 'transition', 'event', 'method', 'request', 'state', 'type', 'name', 'tag', 'file', 'from', 'direction']) {
        if (args[key]) {
            argv.push(`--${key}`, args[key]);
        }
    }
    for (const key of ['limit', 'depth']) {
        if (Number.isFinite(args[key])) {
            argv.push(`--${key}`, String(args[key]));
        }
    }
    if (args.upstream) {
        argv.push('--upstream');
    }
    if (args.downstream) {
        argv.push('--downstream');
    }
    const captured = captureConsoleLog(() => queryProjectKb(argv));
    return textResult(captured.output);
}

async function handleMcpRequest(request) {
    if (request.method === 'initialize') {
        const version = loadSkillVersion(path.resolve(__dirname, '..')).version;
        return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
                protocolVersion: '2024-11-05',
                capabilities: { tools: { listChanged: false } },
                serverInfo: { name: 'project-memory-manager', version },
            },
        };
    }
    if (request.method === 'tools/list') {
        return { jsonrpc: '2.0', id: request.id, result: { tools: TOOL_DEFINITIONS } };
    }
    if (request.method === 'tools/call') {
        const name = request.params?.name;
        const args = toolArgs(request.params);
        const result = name === 'inspect_workspace'
            ? inspectWorkspace(args)
            : name === 'get_current_state'
                ? getCurrentState(args)
                : name === 'init_workspace'
                    ? initWorkspace(args)
                    : name === 'detect_topology'
                        ? detectTopology(args)
                        : name === 'diagnose_workspace'
                            ? diagnoseWorkspace(args)
                            : name === 'build_project_index'
                                ? buildProjectIndex(args)
                                : name === 'start_build_project_index'
                                    ? startBuildProjectIndex(args)
                                    : name === 'get_job_status'
                                        ? getJobStatus(args)
                                        : name === 'get_job_result'
                                            ? getJobResult(args)
                                            : name === 'discover_features'
                                                ? discoverFeatures(args)
                                                : name === 'build_feature_index'
                                                    ? buildFeatureIndex(args)
                                                    : name === 'query_project_chain'
                                                        ? queryProjectChain(args)
                                                        : textResult({ error: `Unknown tool: ${name}` });
        return { jsonrpc: '2.0', id: request.id, result };
    }
    if (request.id == null) {
        return null;
    }
    return {
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32601, message: `Unsupported method: ${request.method}` },
    };
}

function startStdioServer() {
    const rl = readline.createInterface({ input: process.stdin });
    rl.on('line', async line => {
        if (!line.trim()) {
            return;
        }
        try {
            const request = JSON.parse(line.replace(/^\uFEFF/, ''));
            const response = await handleMcpRequest(request);
            if (response) {
                process.stdout.write(`${JSON.stringify(response)}\n`);
            }
        } catch (error) {
            process.stdout.write(`${JSON.stringify({
                jsonrpc: '2.0',
                id: null,
                error: { code: -32603, message: error.message },
            })}\n`);
        }
    });
}

module.exports = { handleMcpRequest, startStdioServer };

if (require.main === module) {
    startStdioServer();
}
