#!/usr/bin/env node

const { recordTaskOutcome } = require('../../agent/execution-loop');
const { parseExecutionArgs, printJsonIfRequested } = require('./execution-loop-cli');

function parseArgs(argv = []) {
    const args = parseExecutionArgs(argv);
    if (!String(args.task || '').trim() || !String(args.outcome || args.summary || '').trim()) {
        throw new Error('用法: node src/bin/record-task-outcome.js --workspace-root <project-root> --task <任务> --outcome <结果摘要> [--changed-file <path>] [--json]');
    }
    return args;
}

function printText(result) {
    console.log(`Task outcome recorded: ${result.outputPath}`);
    console.log(`- task: ${result.record.task}`);
    console.log(`- outcome: ${result.record.outcome}`);
    console.log(`- changedFiles: ${result.record.changedFiles.join(', ') || '(none)'}`);
}

function run(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    const result = recordTaskOutcome(args);
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
