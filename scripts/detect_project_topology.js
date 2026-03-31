#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { ensureDir, listFilesRecursive, normalize, writeJson } = require('./lib/common');
const { getTopologyAdapters } = require('./adapters/topology');

const MANIFEST_BASENAMES = new Set([
    'package.json',
    'go.mod',
    'pom.xml',
    'build.gradle',
    'build.gradle.kts',
    'requirements.txt',
    'pyproject.toml',
]);

const IGNORED_PATH_SEGMENTS = new Set([
    'node_modules',
    '.store',
    '.git',
    'project-memory',
    '.kimi',
    'dist',
    'build',
    '.runtime',
    '.venv',
    'venv',
    'coverage',
    '.next',
    '.nuxt',
    '.turbo',
    '.cache',
]);

function hasIgnoredSegment(relativePath) {
    const segments = normalize(relativePath).toLowerCase().split('/').filter(Boolean);
    return segments.some(segment => IGNORED_PATH_SEGMENTS.has(segment));
}

function parseArgs(argv) {
    const args = {
        root: '',
        out: '',
    };

    for (let index = 0; index < argv.length; index++) {
        const token = argv[index];
        if (token === '--root') {
            args.root = path.resolve(argv[++index]);
            continue;
        }
        if (token === '--out') {
            args.out = path.resolve(argv[++index]);
        }
    }

    // 如果没有指定 root，使用 cwd
    if (!args.root) {
        args.root = process.cwd();
    }
    
    // 如果没有指定 out，基于 root 生成默认路径
    if (!args.out) {
        args.out = path.join(args.root, 'project-memory', 'state', 'project-profile.json');
    }

    return args;
}

function readPackage(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return null;
    }
}

function readText(filePath) {
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch {
        return '';
    }
}

function classifyAreaFromPath(relativePath, adapters) {
    for (const adapter of adapters) {
        const area = adapter.classifyAreaFromPath?.(relativePath);
        if (area && area !== 'unknown') {
            return area;
        }
    }
    return 'unknown';
}

function canonicalAreaRoot(relativeDir, area, adapters) {
    for (const adapter of adapters) {
        const areaRoot = adapter.canonicalAreaRoot?.(relativeDir, area);
        if (areaRoot && areaRoot !== 'unknown') {
            return normalize(areaRoot);
        }
    }
    return normalize(relativeDir);
}

function detectStacksFromManifest(manifestName, pkg, relativeDir, adapters, manifestText = '') {
    const stacks = new Set();
    for (const adapter of adapters) {
        const adapterStacks = adapter.detectStacksFromManifest?.({ manifestName, pkg, manifestText, relativeDir }) || [];
        for (const stack of adapterStacks) {
            stacks.add(stack);
        }
    }
    return stacks;
}

function detectIntegrations(root, adapters) {
    const integrations = {
        primary: [],
        secondary: [],
    };

    for (const adapter of adapters) {
        const adapterIntegrations = adapter.detectIntegrations?.(root) || { primary: [], secondary: [] };
        for (const item of adapterIntegrations.primary || []) {
            if (!integrations.primary.includes(item)) {
                integrations.primary.push(item);
            }
        }
        for (const item of adapterIntegrations.secondary || []) {
            if (!integrations.secondary.includes(item)) {
                integrations.secondary.push(item);
            }
        }
    }

    return integrations;
}

function run(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    const root = args.root;
    const adapters = getTopologyAdapters(root);
    const manifests = listFilesRecursive(
        root,
        filePath => MANIFEST_BASENAMES.has(path.basename(filePath).toLowerCase()),
        [],
        {
            ignorePath: filePath => hasIgnoredSegment(path.relative(root, filePath)),
        }
    ).filter(filePath => !hasIgnoredSegment(path.relative(root, filePath)));

    const areas = {
        frontend: new Set(),
        backend: new Set(),
        shared: new Set(),
        contract: new Set(),
        data: new Set(),
        ops: new Set(),
    };
    const stacks = {
        frontend: new Set(),
        backend: new Set(),
        shared: new Set(),
        contract: new Set(),
        data: new Set(),
        ops: new Set(),
    };

    for (const manifestPath of manifests) {
        const relativeDir = path.relative(root, path.dirname(manifestPath));
        const area = classifyAreaFromPath(relativeDir, adapters);
        if (area === 'unknown') {
            continue;
        }
        const areaRoot = canonicalAreaRoot(relativeDir, area, adapters);
        areas[area].add(areaRoot);

        const shouldContributeStacks = normalize(relativeDir) === areaRoot || area === 'ops';
        if (!shouldContributeStacks) {
            continue;
        }

        const manifestName = path.basename(manifestPath);
        const pkg = manifestName === 'package.json' ? readPackage(manifestPath) : null;
        const manifestText = manifestName === 'package.json' ? '' : readText(manifestPath);
        for (const stack of detectStacksFromManifest(manifestName, pkg, relativeDir, adapters, manifestText)) {
            stacks[area].add(stack);
        }
    }

    if (fs.existsSync(path.join(root, 'tools'))) {
        areas.ops.add('tools');
        stacks.ops.add('powershell');
        stacks.ops.add('batch');
    }

    const frontendCount = areas.frontend.size;
    const backendCount = areas.backend.size;
    const projectType = frontendCount > 0 && backendCount > 0
        ? (backendCount > 1 ? 'multi-service' : 'full-stack')
        : 'single-stack';

    const profile = {
        projectName: path.basename(root),
        projectType,
        areas: Object.fromEntries(
            Object.entries(areas).map(([area, values]) => [area, Array.from(values).sort((left, right) => left.localeCompare(right))])
        ),
        stacks: Object.fromEntries(
            Object.entries(stacks).map(([area, values]) => [area, Array.from(values).sort((left, right) => left.localeCompare(right))])
        ),
        integration: detectIntegrations(root, adapters),
    };

    ensureDir(path.dirname(args.out));
    writeJson(args.out, profile);
    console.log(`项目画像已输出: ${args.out}`);
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
