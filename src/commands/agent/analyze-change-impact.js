#!/usr/bin/env node

const fs = require('fs');
const { parseLayoutArgs } = require('../../shared/workspace-layout');
const { analyzeChangeImpact } = require('../../agent/context-pack');

function parseArgs(argv = []) {
    const layoutArgs = parseLayoutArgs(argv);
    const args = {
        workspaceRoot: layoutArgs.workspaceRoot || '',
        dataRoot: layoutArgs.dataRoot || '',
        layout: layoutArgs.layout || '',
        changedFiles: [],
        diff: '',
        diffFile: '',
        depth: 3,
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
        if (token === '--changed-file') {
            args.changedFiles.push(argv[++index] || '');
            continue;
        }
        if (token === '--changed-files') {
            args.changedFiles.push(argv[++index] || '');
            continue;
        }
        if (token === '--diff') {
            args.diff = argv[++index] || '';
            continue;
        }
        if (token === '--diff-file') {
            args.diffFile = argv[++index] || '';
            continue;
        }
        if (token === '--stdin-diff') {
            args.diff = fs.readFileSync(0, 'utf8');
            continue;
        }
        if (token === '--depth') {
            args.depth = Number.parseInt(argv[++index], 10) || 3;
            continue;
        }
        if (token === '--json') {
            args.json = true;
        }
    }

    if (!args.changedFiles.length && !args.diff && !args.diffFile) {
        throw new Error('用法: node src/bin/analyze-change-impact.js --workspace-root <project-root> --changed-file <path> [--json]');
    }
    return args;
}

function printText(result) {
    console.log(`Change impact: ${result.risk.level}`);
    console.log(`- files: ${result.changedFiles.join(', ') || '(none)'}`);
    console.log(`- features: ${result.affectedFeatures.map(item => item.featureKey).join(', ') || '(none)'}`);
    console.log(`- endpoints: ${result.affectedEntrypoints.endpoints.map(item => item.name).join(', ') || '(none)'}`);
    console.log(`- tables: ${result.affectedData.tables.map(item => item.name).join(', ') || '(none)'}`);
    console.log(`- services: ${result.affectedExternalServices.map(item => item.name).join(', ') || '(none)'}`);
    console.log('- validation:');
    for (const command of result.validation.recommendedCommands || []) {
        console.log(`  - ${command}`);
    }
}

function run(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    const result = analyzeChangeImpact(args);
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
