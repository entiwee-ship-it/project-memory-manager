#!/usr/bin/env node

const { prepareAgentBrief } = require('../../agent/memory-recall');
const { hasTaskOrChangeInput, parseExecutionArgs, printJsonIfRequested } = require('./execution-loop-cli');

function parseArgs(argv = []) {
    const args = parseExecutionArgs(argv);
    if (!args.workspaceRoot || !hasTaskOrChangeInput(args)) {
        throw new Error('用法: node src/bin/prepare-agent-brief.js --workspace-root <project-root> --task <任务> [--json]');
    }
    return args;
}

function printText(result) {
    console.log(`Agent brief: ${result.task || '(empty task)'}`);
    console.log(`- gate: ${result.pmmGate.decision}`);
    console.log(`- contextStatus: ${result.executionPlan.contextStatus}`);
    console.log(`- recalledTasks: ${result.memory.recalledTasks.length}`);
    console.log('- recommendedFiles:');
    for (const file of result.recommendedFiles.slice(0, 12)) {
        console.log(`  - ${file}`);
    }
    console.log('- validation:');
    for (const command of result.validation.recommendedCommands.slice(0, 8)) {
        console.log(`  - ${command}`);
    }
}

function run(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    const result = prepareAgentBrief(args);
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
