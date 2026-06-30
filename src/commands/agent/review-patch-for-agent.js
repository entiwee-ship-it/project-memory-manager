#!/usr/bin/env node

const { reviewPatchForAgent } = require('../../agent/execution-loop');
const { hasTaskOrChangeInput, parseExecutionArgs, printJsonIfRequested } = require('./execution-loop-cli');

function parseArgs(argv = []) {
    const args = parseExecutionArgs(argv);
    if (!hasTaskOrChangeInput(args)) {
        throw new Error('用法: node src/bin/review-patch-for-agent.js --workspace-root <project-root> --task <任务> --changed-file <path> [--json]');
    }
    return args;
}

function printText(result) {
    console.log(`Patch review: ${result.verdict}`);
    console.log(`- scope: ${result.scope.verdict}`);
    console.log('- findings:');
    if (!result.findings.length) {
        console.log('  - (none)');
    }
    for (const finding of result.findings) {
        console.log(`  - [${finding.severity}] ${finding.title}: ${finding.detail}`);
    }
    console.log('- checklist:');
    for (const item of result.reviewChecklist) {
        console.log(`  - ${item}`);
    }
}

function run(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    const result = reviewPatchForAgent(args);
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
