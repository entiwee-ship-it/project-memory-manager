#!/usr/bin/env node

const { planTaskExecution } = require('../../agent/execution-loop');
const { hasTaskOrChangeInput, parseExecutionArgs, printJsonIfRequested } = require('./execution-loop-cli');

function parseArgs(argv = []) {
    const args = parseExecutionArgs(argv);
    if (!hasTaskOrChangeInput(args)) {
        throw new Error('用法: node src/bin/plan-task-execution.js --workspace-root <project-root> --task <任务> [--json]');
    }
    return args;
}

function printText(result) {
    console.log(`Task plan: ${result.task || '(empty task)'}`);
    console.log(`- pmmGate: ${result.pmmGate.decision}`);
    console.log(`- contextStatus: ${result.contextStatus}`);
    console.log('- targetFiles:');
    for (const file of result.targetFiles) {
        console.log(`  - ${file}`);
    }
    console.log('- steps:');
    for (const item of result.steps) {
        console.log(`  - ${item.step}: ${item.action}`);
    }
    console.log('- validation:');
    for (const command of result.validation.recommendedCommands || []) {
        console.log(`  - ${command}`);
    }
}

function run(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    const result = planTaskExecution(args);
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
