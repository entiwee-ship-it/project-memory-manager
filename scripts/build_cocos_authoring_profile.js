#!/usr/bin/env node

const path = require('path');
const { normalize, repoRelative } = require('./lib/common');
const { createWorkspaceContext, parseLayoutArgs } = require('./lib/workspace-layout');
const {
    buildProjectAuthoringProfile,
    loadProjectAuthoringProfile,
    writeProjectAuthoringProfile,
} = require('./lib/cocos-authoring');

function displayPath(filePath, root) {
    const relative = repoRelative(filePath, root);
    return relative.startsWith('..') ? normalize(filePath) : relative;
}

function parseArgs(argv) {
    const layoutArgs = parseLayoutArgs(argv);
    const args = {
        root: layoutArgs.workspaceRoot || '',
        dataRoot: layoutArgs.dataRoot || '',
        layout: layoutArgs.layout || '',
        feature: '',
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
        if (token === '--feature') {
            args.feature = argv[++index] || '';
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
    const root = context.workspaceRoot;
    const freshProfile = buildProjectAuthoringProfile(context, args.feature);
    const existingProfile = args.feature ? loadProjectAuthoringProfile(context) : null;
    const profile = args.feature
        ? {
            ...(existingProfile || {}),
            generatedAt: freshProfile.generatedAt,
            builtWithSkill: freshProfile.builtWithSkill,
            projectRoot: freshProfile.projectRoot,
            features: {
                ...((existingProfile && existingProfile.features) || {}),
                ...(freshProfile.features || {}),
            },
        }
        : freshProfile;
    const outputPath = writeProjectAuthoringProfile(context, profile);
    const result = {
        kind: 'cocos-authoring-profile-build',
        root: normalize(root),
        outputPath: displayPath(outputPath, root),
        featureCount: Object.keys(profile.features || {}).length,
        featureKeys: Object.keys(profile.features || {}).sort((left, right) => left.localeCompare(right)),
        builtWithSkill: profile.builtWithSkill || null,
    };

    if (args.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
    }

    console.log(`Cocos 创作画像已生成: ${result.root}`);
    console.log(`- output: ${result.outputPath}`);
    console.log(`- features: ${result.featureCount}`);
    if (result.featureKeys.length > 0) {
        console.log(`- keys: ${result.featureKeys.join(', ')}`);
    }
}

module.exports = {
    buildProjectAuthoringProfile,
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
