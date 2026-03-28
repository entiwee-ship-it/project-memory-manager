#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { resolveProjectRoot, readJson } = require('./lib/common');
const { normalizeFeatureRecord } = require('./lib/feature-kb');
const { run: buildChainKb } = require('./build_chain_kb');
const { run: buildProjectKb } = require('./build_project_kb');
const { run: refreshMemoryIndexes } = require('./refresh_memory_indexes');

function parseArgs(argv) {
    const args = {
        root: '',
        feature: '',
    };

    for (let index = 0; index < argv.length; index++) {
        if (argv[index] === '--root') {
            args.root = argv[++index] || '';
            continue;
        }
        if (argv[index] === '--feature') {
            args.feature = argv[++index] || '';
        }
    }

    return args;
}

function collectConfigPaths(root) {
    const registryPath = path.join(root, 'project-memory', 'state', 'feature-registry.json');
    const results = [];
    const seen = new Set();

    if (fs.existsSync(registryPath)) {
        const registry = readJson(registryPath);
        for (const item of registry.features || []) {
            const feature = normalizeFeatureRecord(item);
            if (!feature.configPath) {
                continue;
            }
            const absoluteConfigPath = path.resolve(root, feature.configPath);
            if (!fs.existsSync(absoluteConfigPath)) {
                continue;
            }
            if (seen.has(absoluteConfigPath)) {
                continue;
            }
            seen.add(absoluteConfigPath);
            results.push({
                featureKey: feature.featureKey,
                configPath: absoluteConfigPath,
            });
        }
    }

    const configDir = path.join(root, 'project-memory', 'kb', 'configs');
    if (fs.existsSync(configDir)) {
        for (const entry of fs.readdirSync(configDir, { withFileTypes: true })) {
            if (!entry.isFile() || !entry.name.endsWith('.json')) {
                continue;
            }
            const absoluteConfigPath = path.join(configDir, entry.name);
            if (seen.has(absoluteConfigPath)) {
                continue;
            }
            seen.add(absoluteConfigPath);
            results.push({
                featureKey: '',
                configPath: absoluteConfigPath,
            });
        }
    }

    return results;
}

function resolveTargets(root, featureKey) {
    const allTargets = collectConfigPaths(root);
    if (!featureKey) {
        return allTargets;
    }

    const matches = allTargets.filter(item => {
        if (item.featureKey === featureKey) {
            return true;
        }
        const baseName = path.basename(item.configPath, path.extname(item.configPath));
        return baseName === featureKey;
    });
    return matches;
}

function run(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    const root = resolveProjectRoot(args.root || process.cwd());
    if (!args.feature || args.feature === 'project-global') {
        buildProjectKb(['--root', root]);
        if (args.feature === 'project-global') {
            refreshMemoryIndexes(['--root', root]);
            console.log('KB 重建完成: project-global');
            return;
        }
    }

    const targets = resolveTargets(root, args.feature)
        .filter(target => target.featureKey !== 'project-global' && path.basename(target.configPath, path.extname(target.configPath)) !== 'project-global');

    if (targets.length <= 0) {
        throw new Error(args.feature
            ? `未找到可重建的 KB 配置: ${args.feature}`
            : '未找到可重建的 KB 配置；请确认 feature-registry.json 或 project-memory/kb/configs 下存在配置');
    }

    const rebuilt = [];
    for (const target of targets) {
        console.log(`重建 KB: ${path.relative(root, target.configPath).replace(/\\/g, '/')}`);
        buildChainKb(['--root', root, '--config', target.configPath]);
        rebuilt.push(target.configPath);
    }

    refreshMemoryIndexes(['--root', root]);
    console.log(`KB 重建完成: project-global + ${rebuilt.length} 个 feature`);
}

module.exports = {
    collectConfigPaths,
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
