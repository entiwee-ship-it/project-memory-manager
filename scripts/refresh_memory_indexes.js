#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { readJson, timestamp, writeJson } = require('./lib/common');
const { normalizeConfig, normalizeFeatureRecord, toPosixPath } = require('./lib/feature-kb');
const { createWorkspaceContext, parseLayoutArgs } = require('./lib/workspace-layout');

function parseArgs(argv) {
    const layoutArgs = parseLayoutArgs(argv);
    const args = {
        root: layoutArgs.workspaceRoot || '',
        dataRoot: layoutArgs.dataRoot || '',
        layout: layoutArgs.layout || '',
    };

    for (let index = 0; index < argv.length; index++) {
        if (argv[index] === '--root' || argv[index] === '--workspace-root') {
            args.root = argv[++index] || '';
            continue;
        }
        if (argv[index] === '--data-root') {
            args.dataRoot = argv[++index] || '';
            continue;
        }
        if (argv[index] === '--layout') {
            args.layout = argv[++index] || '';
        }
    }

    return args;
}

function firstHeading(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const match = content.match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : path.basename(filePath, path.extname(filePath));
}

function memoryRelative(context, filePath) {
    return path.relative(context.memoryRoot, filePath).replace(/\\/g, '/');
}

function scanFeatureDirs(context) {
    const featuresRoot = context.paths.featuresDir;
    if (!fs.existsSync(featuresRoot)) {
        return [];
    }

    return fs.readdirSync(featuresRoot, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => {
            const featureKey = entry.name;
            const kbDir = toPosixPath(path.join(featuresRoot, featureKey));
            return normalizeFeatureRecord({
                featureKey,
                featureName: featureKey,
                kbDir,
            });
        });
}

function mergeFeatureRecords(...groups) {
    const merged = new Map();
    for (const group of groups) {
        for (const record of group) {
            const normalized = normalizeFeatureRecord(record);
            if (!normalized.featureKey) {
                continue;
            }
            const existing = merged.get(normalized.featureKey) || {};
            merged.set(normalized.featureKey, {
                ...existing,
                ...normalized,
                outputs: {
                    ...(existing.outputs || {}),
                    ...(normalized.outputs || {}),
                },
            });
        }
    }
    return Array.from(merged.values()).sort((left, right) => left.featureKey.localeCompare(right.featureKey));
}

function run(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    const context = createWorkspaceContext({
        workspaceRoot: args.root || process.cwd(),
        dataRoot: args.dataRoot,
        layout: args.layout,
    });
    const root = context.workspaceRoot;
    const workDir = path.join(context.memoryRoot, 'docs', 'work', 'active');
    const configDir = context.paths.configsDir;
    const domainDirs = [
        path.join(context.memoryRoot, 'docs', 'domains'),
        path.join(context.memoryRoot, 'docs', 'games'),
    ];

    const workFiles = fs.existsSync(workDir)
        ? fs.readdirSync(workDir).filter(name => name.endsWith('.md')).map(name => path.join(workDir, name))
        : [];
    const configFiles = fs.existsSync(configDir)
        ? fs.readdirSync(configDir).filter(name => name.endsWith('.json')).map(name => path.join(configDir, name))
        : [];
    const domainFiles = domainDirs.flatMap(domainDir => (
        fs.existsSync(domainDir)
            ? fs.readdirSync(domainDir).filter(name => name.endsWith('.md')).map(name => path.join(domainDir, name))
            : []
    ));
    const registryPath = context.paths.featureRegistry;
    const existingRegistry = fs.existsSync(registryPath) ? readJson(registryPath) : { features: [] };
    const existingFeatures = Array.isArray(existingRegistry.features) ? existingRegistry.features : [];

    const generatedAt = timestamp();
    const activeWorks = workFiles.map(filePath => ({
        title: firstHeading(filePath),
        path: memoryRelative(context, filePath),
        status: 'active',
    }));

    const featuresFromConfigs = configFiles.map(filePath => {
        const normalized = normalizeConfig(readJson(filePath)).config;
        return normalizeFeatureRecord({
            featureKey: normalized.featureKey,
            featureName: normalized.featureName,
            summary: normalized.summary || '',
            areas: Array.isArray(normalized.areas) ? normalized.areas : [],
            configPath: toPosixPath(filePath),
            docsDir: normalized.docs?.featureDir || '',
            kbDir: normalized.kbDir,
            outputs: normalized.outputs || {},
            type: normalized.type || '',
        });
    });
    const featuresFromKbDirs = scanFeatureDirs(context);
    const features = mergeFeatureRecords(existingFeatures, featuresFromConfigs, featuresFromKbDirs);

    const domains = domainFiles.map(filePath => ({
        title: firstHeading(filePath),
        path: memoryRelative(context, filePath),
    }));

    writeJson(path.join(context.paths.stateDir, 'active-work.json'), {
        generatedAt,
        activeWorks,
    });
    writeJson(context.paths.featureRegistry, {
        generatedAt,
        features,
    });
    writeJson(context.paths.featureIndex, {
        generatedAt,
        features,
    });
    writeJson(path.join(context.paths.indexesDir, 'domains.json'), {
        generatedAt,
        domains,
    });
    writeJson(path.join(context.paths.indexesDir, 'games.json'), {
        generatedAt,
        games: domains,
    });

    console.log(`记忆索引已刷新: ${root}`);
}

module.exports = {
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
