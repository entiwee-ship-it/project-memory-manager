const fs = require('fs');
const { parseLayoutArgs } = require('../../shared/workspace-layout');

function pushArg(args, key, value) {
    const normalized = String(value || '').trim();
    if (normalized) {
        args[key].push(normalized);
    }
}

function parseExecutionArgs(argv = []) {
    const layoutArgs = parseLayoutArgs(argv);
    const args = {
        workspaceRoot: layoutArgs.workspaceRoot || '',
        dataRoot: layoutArgs.dataRoot || '',
        layout: layoutArgs.layout || '',
        task: '',
        query: '',
        featureKey: '',
        knownFiles: [],
        changedFiles: [],
        diff: '',
        diffFile: '',
        depth: 4,
        limit: 20,
        outcome: '',
        summary: '',
        validation: [],
        observations: [],
        confidence: 'medium',
        json: false,
    };

    for (let index = 0; index < argv.length; index++) {
        const token = argv[index];
        if (token === '--workspace-root' || token === '--root') {
            args.workspaceRoot = argv[++index] || '';
            continue;
        }
        if (token === '--data-root') {
            args.dataRoot = argv[++index] || '';
            continue;
        }
        if (token === '--layout') {
            args.layout = argv[++index] || '';
            continue;
        }
        if (token === '--task' || token === '--query') {
            args.task = argv[++index] || '';
            args.query = args.task;
            continue;
        }
        if (token === '--feature-key' || token === '--feature') {
            args.featureKey = argv[++index] || '';
            continue;
        }
        if (token === '--known-file' || token === '--file') {
            pushArg(args, 'knownFiles', argv[++index]);
            continue;
        }
        if (token === '--changed-file') {
            pushArg(args, 'changedFiles', argv[++index]);
            continue;
        }
        if (token === '--changed-files') {
            pushArg(args, 'changedFiles', argv[++index]);
            continue;
        }
        if (token === '--diff') {
            args.diff = argv[++index] || '';
            continue;
        }
        if (token === '--diff-file') {
            args.diffFile = argv[++index] || '';
            continue;
        }
        if (token === '--stdin-diff') {
            args.diff = fs.readFileSync(0, 'utf8');
            continue;
        }
        if (token === '--depth') {
            args.depth = Number.parseInt(argv[++index], 10) || 4;
            continue;
        }
        if (token === '--limit') {
            args.limit = Number.parseInt(argv[++index], 10) || 20;
            continue;
        }
        if (token === '--outcome' || token === '--summary') {
            args.outcome = argv[++index] || '';
            args.summary = args.outcome;
            continue;
        }
        if (token === '--validation') {
            pushArg(args, 'validation', argv[++index]);
            continue;
        }
        if (token === '--observation' || token === '--note') {
            pushArg(args, 'observations', argv[++index]);
            continue;
        }
        if (token === '--confidence') {
            args.confidence = argv[++index] || 'medium';
            continue;
        }
        if (token === '--json') {
            args.json = true;
        }
    }

    return args;
}

function hasTaskOrChangeInput(args) {
    return Boolean(
        String(args.task || args.query || '').trim()
        || args.knownFiles.length
        || args.changedFiles.length
        || String(args.diff || '').trim()
        || String(args.diffFile || '').trim()
    );
}

function printJsonIfRequested(args, result) {
    if (args.json) {
        console.log(JSON.stringify(result, null, 2));
        return true;
    }
    return false;
}

module.exports = {
    hasTaskOrChangeInput,
    parseExecutionArgs,
    printJsonIfRequested,
};
