#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { readJson, resolveProjectRoot, timestamp, writeJson } = require('./lib/common');
const { normalizeConfig, normalizeFeatureRecord, toPosixPath } = require('./lib/feature-kb');

function parseArgs(argv) {
    const args = {
        root: '',
    };

    for (let index = 0; index < argv.length; index++) {
        if (argv[index] === '--root') {
            args.root = argv[++index] || '';
        }
    }

    return args;
}

function firstHeading(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const match = content.match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : path.basename(filePath, path.extname(filePath));
}

function scanFeatureDirs(featuresRoot) {
    if (!fs.existsSync(featuresRoot)) {
        return [];
    }

    return fs.readdirSync(featuresRoot, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => {
            const featureKey = entry.name;
            const kbDir = toPosixPath(path.join(path.relative(path.dirname(featuresRoot), featuresRoot), featureKey));
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
    const root = resolveProjectRoot(args.root || process.cwd());
    const workDir = path.join(root, 'project-memory', 'docs', 'work', 'active');
    const configDir = path.join(root, 'project-memory', 'kb', 'configs');
    const domainDirs = [
        path.join(root, 'project-memory', 'docs', 'domains'),
        path.join(root, 'project-memory', 'docs', 'games'),
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
    const registryPath = path.join(root, 'project-memory', 'state', 'feature-registry.json');
    const existingRegistry = fs.existsSync(registryPath) ? readJson(registryPath) : { features: [] };
    const existingFeatures = Array.isArray(existingRegistry.features) ? existingRegistry.features : [];

    const generatedAt = timestamp();
    const activeWorks = workFiles.map(filePath => ({
        title: firstHeading(filePath),
        path: path.relative(root, filePath).replace(/\\/g, '/'),
        status: 'active',
    }));

    const featuresFromConfigs = configFiles.map(filePath => {
        const normalized = normalizeConfig(readJson(filePath)).config;
        return normalizeFeatureRecord({
            featureKey: normalized.featureKey,
            featureName: normalized.featureName,
            summary: normalized.summary || '',
            areas: Array.isArray(normalized.areas) ? normalized.areas : [],
            configPath: path.relative(root, filePath).replace(/\\/g, '/'),
            docsDir: normalized.docs?.featureDir || '',
            kbDir: normalized.kbDir,
            outputs: normalized.outputs || {},
            type: normalized.type || '',
        });
    });
    const featuresFromKbDirs = scanFeatureDirs(path.join(root, 'project-memory', 'kb', 'features'));
    const features = mergeFeatureRecords(existingFeatures, featuresFromConfigs, featuresFromKbDirs);

    const domains = domainFiles.map(filePath => ({
        title: firstHeading(filePath),
        path: path.relative(root, filePath).replace(/\\/g, '/'),
    }));

    writeJson(path.join(root, 'project-memory', 'state', 'active-work.json'), {
        generatedAt,
        activeWorks,
    });
    writeJson(path.join(root, 'project-memory', 'state', 'feature-registry.json'), {
        generatedAt,
        features,
    });
    writeJson(path.join(root, 'project-memory', 'kb', 'indexes', 'features.json'), {
        generatedAt,
        features,
    });
    writeJson(path.join(root, 'project-memory', 'kb', 'indexes', 'domains.json'), {
        generatedAt,
        domains,
    });
    writeJson(path.join(root, 'project-memory', 'kb', 'indexes', 'games.json'), {
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
