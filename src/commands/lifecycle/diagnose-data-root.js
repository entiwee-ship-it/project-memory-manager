#!/usr/bin/env node

const path = require('path');
const { diagnoseDataRoot } = require('../../shared/workspace-registry');

function parseArgs(argv) {
    const args = {
        dataRoot: '',
        json: false,
    };

    for (let index = 0; index < argv.length; index++) {
        const token = argv[index];
        if (token === '--data-root') {
            args.dataRoot = path.resolve(argv[++index] || '');
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
    const result = diagnoseDataRoot({ dataRoot: args.dataRoot });
    if (args.json) {
        console.log(JSON.stringify(result, null, 2));
        return result;
    }
    console.log(`PMM data root: ${result.dataRoot}`);
    console.log(`Registry: ${result.registryExists ? result.registryPath : '<missing>'}`);
    console.log(`Workspaces: ${result.workspaceCount}`);
    console.log(`Issues: ${result.issueCount}`);
    for (const issue of result.issues) {
        console.log(`- [${issue.severity}] ${issue.code}: ${issue.message}`);
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
