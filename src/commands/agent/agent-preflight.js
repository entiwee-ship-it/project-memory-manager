#!/usr/bin/env node

const path = require('node:path');
const { agentPreflight } = require('../../agent/environment-health');
const { parseLayoutArgs } = require('../../shared/workspace-layout');

/**
 * 追加非空数组参数。
 *
 * @param {string[]} values 输出数组。
 * @param {string} value 输入值。
 */
function pushValues(values, value) {
    String(value || '')
        .split(/[\n,;]+/)
        .map(item => item.trim())
        .filter(Boolean)
        .forEach(item => values.push(item));
}

/**
 * 解析 agent-preflight CLI 参数。
 *
 * @param {string[]} argv 命令行参数。
 * @returns {object} 归一化后的参数。
 */
function parseArgs(argv = []) {
    const layoutArgs = parseLayoutArgs(argv);
    const args = {
        workspaceRoot: layoutArgs.workspaceRoot || '',
        dataRoot: layoutArgs.dataRoot || '',
        layout: layoutArgs.layout || '',
        installedSkillRoot: '',
        runtimeVersion: '',
        runtimeTools: [],
        json: false,
    };

    for (let index = 0; index < argv.length; index++) {
        const token = argv[index];
        if (token === '--workspace-root' || token === '--root') {
            args.workspaceRoot = path.resolve(argv[++index] || process.cwd());
            continue;
        }
        if (token === '--data-root') {
            args.dataRoot = path.resolve(argv[++index] || '');
            continue;
        }
        if (token === '--layout') {
            args.layout = argv[++index] || '';
            continue;
        }
        if (token === '--installed-skill-root') {
            args.installedSkillRoot = path.resolve(argv[++index] || '');
            continue;
        }
        if (token === '--runtime-version' || token === '--mcp-runtime-version') {
            args.runtimeVersion = argv[++index] || '';
            continue;
        }
        if (token === '--runtime-tool' || token === '--mcp-tool') {
            pushValues(args.runtimeTools, argv[++index]);
            continue;
        }
        if (token === '--runtime-tools' || token === '--mcp-tools') {
            pushValues(args.runtimeTools, argv[++index]);
            continue;
        }
        if (token === '--json') {
            args.json = true;
        }
    }

    if (!args.workspaceRoot) {
        throw new Error('用法: node src/bin/agent-preflight.js --workspace-root <project-root> --data-root <data-root> [--installed-skill-root <skill-root>] [--json]');
    }
    return args;
}

/**
 * 输出面向操作者的文本版 preflight 摘要。
 *
 * @param {object} result agentPreflight 返回值。
 */
function printText(result) {
    console.log(`Agent preflight: ${result.status}`);
    console.log(`- score: ${result.health.score}`);
    console.log(`- workspaceRoot: ${result.workspaceRoot}`);
    console.log(`- dataRoot: ${result.dataRoot}`);
    console.log(`- nextAction: ${result.nextAction.type}:${result.nextAction.action}`);
    if (result.nextAction.command) {
        console.log(`- command: ${result.nextAction.command}`);
    }
    console.log('- findings:');
    if (!result.findings.length) {
        console.log('  - (none)');
    }
    for (const finding of result.findings) {
        console.log(`  - [${finding.severity || 'warn'}] ${finding.code}: ${finding.message || ''}`);
    }
}

/**
 * 执行 agent-preflight CLI。
 *
 * @param {string[]} argv 命令行参数。
 * @returns {object} agentPreflight 返回值。
 */
function run(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    const result = agentPreflight(args);
    if (args.json) {
        console.log(JSON.stringify(result, null, 2));
        return result;
    }
    printText(result);
    return result;
}

module.exports = {
    parseArgs,
    printText,
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
