#!/usr/bin/env node

const { decidePmmUsage } = require('../../agent/execution-loop');
const { hasTaskOrChangeInput, parseExecutionArgs, printJsonIfRequested } = require('./execution-loop-cli');

function parseArgs(argv = []) {
    const args = parseExecutionArgs(argv);
    if (!hasTaskOrChangeInput(args)) {
        throw new Error('用法: node src/bin/decide-pmm-usage.js --task <任务> [--known-file <path>] [--json]');
    }
    return args;
}

function printText(result) {
    console.log(`PMM usage: ${result.decision}`);
    console.log(`- required: ${result.pmmRequired}`);
    console.log(`- deepRequired: ${result.deepPmmRequired}`);
    console.log(`- recommendedTool: ${result.recommendedTool}`);
    console.log(`- files: ${result.files.join(', ') || '(none)'}`);
    console.log('- reasons:');
    for (const reason of result.reasons) {
        console.log(`  - ${reason}`);
    }
    if (result.skipConditions.length) {
        console.log('- skipConditions:');
        for (const condition of result.skipConditions) {
            console.log(`  - ${condition}`);
        }
    }
}

function run(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    const result = decidePmmUsage(args);
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
