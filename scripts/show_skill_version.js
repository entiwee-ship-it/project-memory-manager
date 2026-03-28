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

function detectInstallContext(skillPath) {
    const normalized = String(path.resolve(skillPath)).replace(/\\/g, '/').toLowerCase();
    if (normalized.includes('/.codex/skills/') || normalized.includes('/.agents/skills/')) {
        return 'installed-copy';
    }
    return 'source-repo';
}

function buildUpgradeGuidance(versionInfo, skillPath) {
    const installCommand = versionInfo.installCommand
        || `npx skills add ${versionInfo.repo} --skill ${versionInfo.name} -g -a codex -y`;
    const updateCommands = Array.isArray(versionInfo.updateCommands) && versionInfo.updateCommands.length > 0
        ? versionInfo.updateCommands
        : ['npx skills check', 'npx skills update'];
    const rebuildCommand = versionInfo.rebuildCommand
        || 'node scripts/rebuild_kbs.js --root <project-root>';

    return {
        policy: versionInfo.upgradePolicy || 'edit-source-repo-only',
        message: versionInfo.upgradeMessage || 'Never edit the installed skill copy directly. Fix the GitHub source repo, push, then reinstall/update the skill.',
        installCommand,
        updateCommands,
        rebuildCommand,
    };
}

function describeSkillVersion(skillPath) {
    const versionInfo = loadSkillVersion(skillPath);
    return {
        ...versionInfo,
        installContext: detectInstallContext(skillPath),
        upgradeGuidance: buildUpgradeGuidance(versionInfo, skillPath),
    };
}

function formatText(versionInfo) {
    const capabilities = Array.isArray(versionInfo.capabilities) ? versionInfo.capabilities.join(', ') : '';
    const updateCommands = (versionInfo.upgradeGuidance?.updateCommands || []).join(' ; ');
    return [
        `${versionInfo.name}@${versionInfo.version}`,
        `releaseDate: ${versionInfo.releaseDate || '(none)'}`,
        `repo: ${versionInfo.repo || '(none)'}`,
        `installContext: ${versionInfo.installContext || 'unknown'}`,
        `capabilities: ${capabilities || '(none)'}`,
        `upgradePolicy: ${versionInfo.upgradeGuidance?.policy || '(none)'}`,
        `upgradeMessage: ${versionInfo.upgradeGuidance?.message || '(none)'}`,
        `installCommand: ${versionInfo.upgradeGuidance?.installCommand || '(none)'}`,
        `updateCommands: ${updateCommands || '(none)'}`,
        `postUpdateRebuild: ${versionInfo.upgradeGuidance?.rebuildCommand || '(none)'}`,
    ].join('\n');
}

function run(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    const versionInfo = describeSkillVersion(args.skillPath);
    if (args.text) {
        console.log(formatText(versionInfo));
        return;
    }
    console.log(JSON.stringify(versionInfo, null, 2));
}

module.exports = {
    describeSkillVersion,
    detectInstallContext,
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
