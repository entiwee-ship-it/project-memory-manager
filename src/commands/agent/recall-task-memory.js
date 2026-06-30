#!/usr/bin/env node

const { recallTaskMemory } = require('../../agent/memory-recall');
const { parseExecutionArgs, printJsonIfRequested } = require('./execution-loop-cli');

function parseArgs(argv = []) {
    const args = parseExecutionArgs(argv);
    if (!args.workspaceRoot) {
        throw new Error('用法: node src/bin/recall-task-memory.js --workspace-root <project-root> --task <任务> [--json]');
    }
    return args;
}

function printText(result) {
    console.log(`Memory recall: ${result.task || '(empty task)'}`);
    console.log(`- outcomes: ${result.totalOutcomeRecords}`);
    console.log(`- recalled: ${result.recalledTasks.length}`);
    for (const item of result.recalledTasks) {
        console.log(`  - [${item.confidence}] ${item.task}: ${item.outcome}`);
    }
    console.log('- relatedFiles:');
    for (const item of result.relatedFiles.slice(0, 10)) {
        console.log(`  - ${item.value} (${item.count})`);
    }
}

function run(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    const result = recallTaskMemory(args);
    if (!printJsonIfRequested(args, result)) {
        printText(result);
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
