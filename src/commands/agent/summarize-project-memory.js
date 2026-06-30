#!/usr/bin/env node

const { summarizeProjectMemory } = require('../../agent/memory-recall');
const { parseExecutionArgs, printJsonIfRequested } = require('./execution-loop-cli');

function parseArgs(argv = []) {
    const args = parseExecutionArgs(argv);
    if (!args.workspaceRoot) {
        throw new Error('用法: node src/bin/summarize-project-memory.js --workspace-root <project-root> [--json]');
    }
    return args;
}

function printText(result) {
    console.log(`Project memory: ${result.workspaceRoot}`);
    console.log(`- outcomes: ${result.outcomeCount}`);
    console.log(`- playbookRules: ${result.playbook.ruleCount}`);
    console.log('- latestOutcomes:');
    for (const item of result.latestOutcomes.slice(0, 8)) {
        console.log(`  - ${item.task}: ${item.outcome}`);
    }
    console.log('- frequentFiles:');
    for (const item of result.frequentFiles.slice(0, 10)) {
        console.log(`  - ${item.value} (${item.count})`);
    }
}

function run(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    const result = summarizeProjectMemory(args);
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
