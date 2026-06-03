#!/usr/bin/env node

const { createWorkspaceContext, parseLayoutArgs } = require('../../shared/workspace-layout');
const {
    discoverFeaturesForContext,
    writeFeatureCandidates,
} = require('../../discovery/feature-discovery');

function parseArgs(argv) {
    const layoutArgs = parseLayoutArgs(argv);
    const args = {
        root: layoutArgs.workspaceRoot || '',
        dataRoot: layoutArgs.dataRoot || '',
        layout: layoutArgs.layout || '',
        limit: 20,
        minConfidence: 'low',
        write: true,
        json: false,
    };

    for (let index = 0; index < argv.length; index++) {
        const token = argv[index];
        if (token === '--root' || token === '--workspace-root') {
            args.root = argv[++index] || '';
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
        if (token === '--limit') {
            args.limit = Number.parseInt(argv[++index], 10) || 20;
            continue;
        }
        if (token === '--min-confidence') {
            args.minConfidence = argv[++index] || 'low';
            continue;
        }
        if (token === '--no-write') {
            args.write = false;
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
        workspaceRoot: args.root || process.cwd(),
        dataRoot: args.dataRoot,
        layout: args.layout,
    });
    const candidates = discoverFeaturesForContext(context, {
        limit: args.limit,
        minConfidence: args.minConfidence,
    });
    const written = args.write ? writeFeatureCandidates(context, candidates, args) : null;
    const result = {
        kind: 'feature-discovery',
        workspaceRoot: context.workspaceRoot,
        dataRoot: context.dataRoot,
        candidateCount: candidates.length,
        candidates,
        outputPath: written?.filePath || '',
    };

    if (args.json) {
        console.log(JSON.stringify(result, null, 2));
        return result;
    }

    console.log(`Feature candidates discovered: ${candidates.length}`);
    if (written?.filePath) {
        console.log(`- output: ${written.filePath}`);
    }
    for (const candidate of candidates.slice(0, 10)) {
        console.log(`- ${candidate.featureKey} (${candidate.confidence}, score ${candidate.score})`);
    }
    return result;
}

module.exports = {
    parseArgs,
    run,
};

if (require.main === module) {
    try {
        run();
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    }
}
