#!/usr/bin/env node

const { run: buildChainKb } = require('../src/graph/build-chain-kb');
const { writeJsonAtomic } = require('../src/shared/common');
const { createWorkspaceContext, parseLayoutArgs } = require('../src/shared/workspace-layout');
const {
    discoverFeaturesForContext,
    generateFeatureConfig,
    readFeatureCandidates,
    writeFeatureCandidates,
} = require('../src/discovery/feature-discovery');

function parseArgs(argv) {
    const layoutArgs = parseLayoutArgs(argv);
    const args = {
        root: layoutArgs.workspaceRoot || '',
        dataRoot: layoutArgs.dataRoot || '',
        layout: layoutArgs.layout || '',
        featureKey: '',
        dryRun: false,
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
        if (token === '--feature-key' || token === '--feature') {
            args.featureKey = argv[++index] || '';
            continue;
        }
        if (token === '--dry-run') {
            args.dryRun = true;
            continue;
        }
        if (token === '--json') {
            args.json = true;
        }
    }

    if (!args.featureKey) {
        throw new Error('用法: node scripts/build_feature_index.js --workspace-root <project-root> --feature-key <key> [--dry-run]');
    }

    return args;
}

function ensureCandidates(context) {
    const existing = readFeatureCandidates(context);
    if (Array.isArray(existing.candidates) && existing.candidates.length > 0) {
        return existing.candidates;
    }
    const candidates = discoverFeaturesForContext(context, { limit: 50, minConfidence: 'low' });
    writeFeatureCandidates(context, candidates);
    return candidates;
}

function run(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    const context = createWorkspaceContext({
        workspaceRoot: args.root || process.cwd(),
        dataRoot: args.dataRoot,
        layout: args.layout,
    });
    const candidates = ensureCandidates(context);
    const candidate = candidates.find(item => item.featureKey === args.featureKey);
    if (!candidate) {
        const available = candidates.slice(0, 15).map(item => item.featureKey).join(', ');
        throw new Error(`未找到 feature candidate: ${args.featureKey}\n可用候选: ${available}`);
    }

    const { config, configPath } = generateFeatureConfig({ context, candidate });
    writeJsonAtomic(configPath, config);
    let built = false;
    if (!args.dryRun) {
        buildChainKb([
            '--workspace-root', context.workspaceRoot,
            '--data-root', context.dataRoot,
            '--layout', context.layout,
            '--config', configPath,
        ]);
        built = true;
    }

    const result = {
        kind: 'feature-index-build',
        workspaceRoot: context.workspaceRoot,
        dataRoot: context.dataRoot,
        featureKey: candidate.featureKey,
        configPath,
        config,
        built,
    };

    if (args.json) {
        console.log(JSON.stringify(result, null, 2));
        return result;
    }

    console.log(`Feature config generated: ${configPath}`);
    console.log(`- feature: ${candidate.featureKey}`);
    console.log(`- built: ${built}`);
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
