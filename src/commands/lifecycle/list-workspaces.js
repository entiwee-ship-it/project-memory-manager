#!/usr/bin/env node

const path = require('path');
const { listRegisteredWorkspaces } = require('../../shared/workspace-registry');

function parseArgs(argv) {
    const args = {
        dataRoot: '',
        includeMissing: true,
        json: false,
    };

    for (let index = 0; index < argv.length; index++) {
        const token = argv[index];
        if (token === '--data-root') {
            args.dataRoot = path.resolve(argv[++index] || '');
            continue;
        }
        if (token === '--hide-missing') {
            args.includeMissing = false;
            continue;
        }
        if (token === '--include-missing') {
            args.includeMissing = true;
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
    const result = listRegisteredWorkspaces({
        dataRoot: args.dataRoot,
        includeMissing: args.includeMissing,
    });
    if (args.json) {
        console.log(JSON.stringify(result, null, 2));
        return result;
    }
    console.log(`PMM data root: ${result.dataRoot}`);
    console.log(`Workspaces: ${result.count}`);
    for (const workspace of result.workspaces) {
        console.log(`- ${workspace.projectName || workspace.workspaceId}`);
        console.log(`  root: ${workspace.workspaceRoot || '<unknown>'}`);
        console.log(`  memory: ${workspace.memoryRoot || '<unknown>'}`);
    }
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
