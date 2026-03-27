#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { readJson, timestamp, writeJson } = require('./lib/common');

function firstHeading(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const match = content.match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : path.basename(filePath, path.extname(filePath));
}

function run() {
    const root = process.cwd();
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

    const generatedAt = timestamp();
    const activeWorks = workFiles.map(filePath => ({
        title: firstHeading(filePath),
        path: path.relative(root, filePath).replace(/\\/g, '/'),
        status: 'active',
    }));

    const features = configFiles.map(filePath => {
        const config = readJson(filePath);
        return {
            featureKey: config.featureKey,
            featureName: config.featureName,
            summary: config.summary || '',
            areas: Array.isArray(config.areas) ? config.areas : [],
            configPath: path.relative(root, filePath).replace(/\\/g, '/'),
            docsDir: config.docs?.featureDir || '',
            kbDir: `project-memory/kb/features/${config.featureKey}`,
            outputs: config.outputs || {},
        };
    });

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

    console.log('记忆索引已刷新');
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
