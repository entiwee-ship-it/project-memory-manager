#!/usr/bin/env node

const { parseLayoutArgs } = require('../../shared/workspace-layout');
const { explainFeatureForAgent } = require('../../agent/context-pack');

function parseArgs(argv = []) {
    const layoutArgs = parseLayoutArgs(argv);
    const args = {
        workspaceRoot: layoutArgs.workspaceRoot || '',
        dataRoot: layoutArgs.dataRoot || '',
        layout: layoutArgs.layout || '',
        featureKey: '',
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
        if (token === '--feature-key' || token === '--feature') {
            args.featureKey = argv[++index] || '';
            continue;
        }
        if (token === '--json') {
            args.json = true;
        }
    }

    if (!args.featureKey) {
        throw new Error('用法: node src/bin/explain-feature-for-agent.js --workspace-root <project-root> --feature <key> [--json]');
    }
    return args;
}

function printText(result) {
    console.log(`Feature: ${result.feature.featureKey} (${result.feature.featureName})`);
    console.log(`- responsibility: ${result.responsibility}`);
    console.log(`- endpoints: ${result.apiEndpoints.map(item => item.name).join(', ') || '(none)'}`);
    console.log(`- tables: ${result.prismaModels.map(item => item.name).join(', ') || '(none)'}`);
    console.log(`- services: ${result.externalServices.map(item => item.name).join(', ') || '(none)'}`);
    console.log('- riskPoints:');
    for (const item of result.editRiskPoints || []) {
        console.log(`  - ${item}`);
    }
}

function run(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    const result = explainFeatureForAgent(args);
    if (args.json) {
        console.log(JSON.stringify(result, null, 2));
        return result;
    }
    printText(result);
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
