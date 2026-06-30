#!/usr/bin/env node

const { updateProjectPlaybook } = require('../../agent/memory-recall');
const { parseExecutionArgs, printJsonIfRequested } = require('./execution-loop-cli');

function parseArgs(argv = []) {
    const args = parseExecutionArgs(argv);
    const hasRuleInput = args.rules.length || args.task || args.outcome || args.summary || args.changedFiles.length || args.knownFiles.length;
    if (!args.workspaceRoot || !hasRuleInput) {
        throw new Error('用法: node src/bin/update-project-playbook.js --workspace-root <project-root> --rule <项目规则> [--json]');
    }
    return args;
}

function printText(result) {
    console.log(`Project playbook updated: ${result.outputPath}`);
    console.log(`- rules: ${result.ruleCount}`);
    console.log('- addedOrUpdated:');
    for (const rule of result.addedOrUpdated) {
        console.log(`  - [${rule.category}] ${rule.title}`);
    }
}

function run(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    const result = updateProjectPlaybook(args);
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
