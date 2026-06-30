#!/usr/bin/env node

const { validateEditScope } = require('../../agent/execution-loop');
const { hasTaskOrChangeInput, parseExecutionArgs, printJsonIfRequested } = require('./execution-loop-cli');

function parseArgs(argv = []) {
    const args = parseExecutionArgs(argv);
    if (!hasTaskOrChangeInput(args)) {
        throw new Error('用法: node src/bin/validate-edit-scope.js --workspace-root <project-root> --task <任务> --changed-file <path> [--json]');
    }
    return args;
}

function printText(result) {
    console.log(`Edit scope: ${result.verdict}`);
    console.log(`- gate: ${result.pmmGate.decision}`);
    console.log(`- changedFiles: ${result.changedFiles.join(', ') || '(none)'}`);
    if (result.outOfScopeFiles.length) {
        console.log(`- outOfScopeFiles: ${result.outOfScopeFiles.join(', ')}`);
    }
    if (result.riskyFiles.length) {
        console.log(`- riskyFiles: ${result.riskyFiles.join(', ')}`);
    }
    if (result.missingExpectedFiles.length) {
        console.log(`- missingExpectedFiles: ${result.missingExpectedFiles.join(', ')}`);
    }
    console.log('- requiredFollowUp:');
    for (const item of result.requiredFollowUp) {
        console.log(`  - ${item}`);
    }
}

function run(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    const result = validateEditScope(args);
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
