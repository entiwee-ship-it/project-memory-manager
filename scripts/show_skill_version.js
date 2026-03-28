#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
    const args = {
        text: false,
        skillPath: path.resolve(__dirname, '..'),
    };

    for (const token of argv) {
        if (token === '--text') {
            args.text = true;
            continue;
        }
        if (!token.startsWith('--')) {
            args.skillPath = path.resolve(token);
        }
    }

    return args;
}

function loadSkillVersion(skillPath) {
    const versionPath = path.join(skillPath, 'skill-version.json');
    if (!fs.existsSync(versionPath)) {
        throw new Error(`未找到 skill-version.json: ${versionPath}`);
    }

    const versionInfo = JSON.parse(fs.readFileSync(versionPath, 'utf8').replace(/^\uFEFF/, ''));
    if (!versionInfo || typeof versionInfo !== 'object') {
        throw new Error('skill-version.json 格式无效');
    }
    return versionInfo;
}

function formatText(versionInfo) {
    const capabilities = Array.isArray(versionInfo.capabilities) ? versionInfo.capabilities.join(', ') : '';
    return [
        `${versionInfo.name}@${versionInfo.version}`,
        `releaseDate: ${versionInfo.releaseDate || '(none)'}`,
        `repo: ${versionInfo.repo || '(none)'}`,
        `capabilities: ${capabilities || '(none)'}`,
    ].join('\n');
}

function run(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    const versionInfo = loadSkillVersion(args.skillPath);
    if (args.text) {
        console.log(formatText(versionInfo));
        return;
    }
    console.log(JSON.stringify(versionInfo, null, 2));
}

module.exports = {
    loadSkillVersion,
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
