#!/usr/bin/env node

const { parseLayoutArgs } = require('../../shared/workspace-layout');
const { prepareTaskContext } = require('../../agent/context-pack');

function parseArgs(argv = []) {
    const layoutArgs = parseLayoutArgs(argv);
    const args = {
        workspaceRoot: layoutArgs.workspaceRoot || '',
        dataRoot: layoutArgs.dataRoot || '',
        layout: layoutArgs.layout || '',
        task: '',
        depth: 4,
        limit: 8,
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
            continue;
        }
        if (token === '--depth') {
            args.depth = Number.parseInt(argv[++index], 10) || 4;
            continue;
        }
        if (token === '--limit') {
            args.limit = Number.parseInt(argv[++index], 10) || 8;
            continue;
        }
        if (token === '--json') {
            args.json = true;
        }
    }

    if (!args.task) {
        throw new Error('用法: node src/bin/prepare-task-context.js --workspace-root <project-root> --task <自然语言任务> [--json]');
    }
    return args;
}

function printText(result) {
    console.log(`任务上下文: ${result.task}`);
    console.log(`- features: ${result.relevantFeatures.map(item => item.featureKey).join(', ') || '(none)'}`);
    console.log(`- endpoints: ${result.keyEntrypoints.endpoints.map(item => item.name).join(', ') || '(none)'}`);
    console.log(`- tables: ${result.dataAccess.tables.map(item => item.name).join(', ') || '(none)'}`);
    console.log(`- services: ${result.externalServices.map(item => item.name).join(', ') || '(none)'}`);
    console.log('- criticalFiles:');
    for (const file of result.criticalFiles.slice(0, 10)) {
        console.log(`  - ${file}`);
    }
    console.log('- validation:');
    for (const command of result.validation.recommendedCommands || []) {
        console.log(`  - ${command}`);
    }
}

function run(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    const result = prepareTaskContext(args);
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
