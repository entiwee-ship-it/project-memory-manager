#!/usr/bin/env node

const path = require('path');
const { createWorkspaceContext, parseLayoutArgs } = require('../../shared/workspace-layout');
const { registerWorkspace } = require('../../shared/workspace-registry');

function parseArgs(argv) {
    const layoutArgs = parseLayoutArgs(argv);
    const args = {
        workspaceRoot: layoutArgs.workspaceRoot || process.cwd(),
        dataRoot: layoutArgs.dataRoot || '',
        layout: layoutArgs.layout || '',
        name: '',
        json: false,
    };

    for (let index = 0; index < argv.length; index++) {
        const token = argv[index];
        if (token === '--workspace-root' || token === '--root') {
            args.workspaceRoot = path.resolve(argv[++index]);
            continue;
        }
        if (token === '--data-root') {
            args.dataRoot = path.resolve(argv[++index] || '');
            continue;
        }
        if (token === '--layout') {
            args.layout = argv[++index] || '';
            continue;
        }
        if (token === '--name') {
            args.name = argv[++index] || '';
            continue;
        }
        if (token === '--json') {
            args.json = true;
        }
    }

    return args;
}

function run(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    const context = createWorkspaceContext({
        workspaceRoot: args.workspaceRoot,
        dataRoot: args.dataRoot,
        layout: args.layout,
    });
    const result = registerWorkspace(context, { name: args.name });
    if (args.json) {
        console.log(JSON.stringify(result, null, 2));
        return result;
    }
    console.log(`PMM workspace registered: ${result.workspace.projectName}`);
    console.log(`Workspace root: ${result.workspace.workspaceRoot}`);
    console.log(`Memory root: ${result.workspace.memoryRoot}`);
    console.log(`Registry: ${result.registryPath}`);
    return result;
}

module.exports = { run };

if (require.main === module) {
    try {
        run();
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    }
}
