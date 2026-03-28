#!/usr/bin/env node

const path = require('path');
const { resolveProjectRoot, normalize, repoRelative } = require('./lib/common');
const {
    buildProjectAuthoringProfile,
    loadProjectAuthoringProfile,
    writeProjectAuthoringProfile,
} = require('./lib/cocos-authoring');

function parseArgs(argv) {
    const args = {
        root: '',
        feature: '',
        json: false,
    };

    for (let index = 0; index < argv.length; index++) {
        const token = argv[index];
        if (token === '--root') {
            args.root = argv[++index] || '';
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
    const root = resolveProjectRoot(args.root || process.cwd());
    const freshProfile = buildProjectAuthoringProfile(root, args.feature);
    const existingProfile = args.feature ? loadProjectAuthoringProfile(root) : null;
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
    const outputPath = writeProjectAuthoringProfile(root, profile);
    const result = {
        kind: 'cocos-authoring-profile-build',
        root: normalize(root),
        outputPath: repoRelative(outputPath, root),
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
