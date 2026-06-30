#!/usr/bin/env node

const path = require('path');
const { resolveWorkspace } = require('../../shared/workspace-registry');

function parseArgs(argv) {
    const args = {
        dataRoot: '',
        workspaceRoot: '',
        workspaceId: '',
        workspaceHash: '',
        gitRemote: '',
        name: '',
        json: false,
    };

    for (let index = 0; index < argv.length; index++) {
        const token = argv[index];
        if (token === '--data-root') {
            args.dataRoot = path.resolve(argv[++index] || '');
            continue;
        }
        if (token === '--workspace-root' || token === '--root') {
            args.workspaceRoot = path.resolve(argv[++index] || process.cwd());
            continue;
        }
        if (token === '--workspace-id') {
            args.workspaceId = argv[++index] || '';
            continue;
        }
        if (token === '--workspace-hash') {
            args.workspaceHash = argv[++index] || '';
            continue;
        }
        if (token === '--git-remote') {
            args.gitRemote = argv[++index] || '';
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
    const result = resolveWorkspace(args);
    if (args.json) {
        console.log(JSON.stringify(result, null, 2));
        return result;
    }
    console.log(`PMM data root: ${result.dataRoot}`);
    console.log(`Matches: ${result.matchCount}`);
    for (const workspace of result.matches) {
        console.log(`- ${workspace.projectName || workspace.workspaceId} (${workspace.matchReasons.join(', ')})`);
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
