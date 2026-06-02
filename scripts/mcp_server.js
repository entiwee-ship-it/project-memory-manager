#!/usr/bin/env node

const path = require('path');
const readline = require('readline');
const { createWorkspaceContext } = require('./lib/workspace-layout');
const { run: buildProjectKb } = require('./build_project_kb');
const { run: queryProjectKb } = require('./query_project_kb');
const { loadSkillVersion } = require('./show_skill_version');

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
    const context = createWorkspaceContext({
        workspaceRoot: args.workspaceRoot,
        dataRoot: args.dataRoot,
        layout: 'external-data',
    });
    return textResult({
        workspaceRoot: context.workspaceRoot,
        dataRoot: context.dataRoot,
        layout: context.layout,
        manifest: context.paths.manifest,
        projectProfile: context.paths.projectProfile,
        featureRegistry: context.paths.featureRegistry,
        projectGlobalDir: context.paths.projectGlobalDir,
    });
}

function buildProjectIndex(args) {
    if (args.dryRun !== false) {
        return inspectWorkspace(args);
    }
    const captured = captureConsoleLog(() => buildProjectKb(layoutArgv(args)));
    const state = JSON.parse(getCurrentState(args).content[0].text);
    return textResult({
        ...state,
        output: captured.output,
    });
}

function queryProjectChain(args) {
    const argv = [...layoutArgv(args), '--json'];
    for (const key of ['message', 'timing', 'phase', 'transition']) {
        if (args[key]) {
            argv.push(`--${key}`, args[key]);
        }
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
                : name === 'build_project_index'
                    ? buildProjectIndex(args)
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
