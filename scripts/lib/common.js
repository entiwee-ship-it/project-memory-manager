const fs = require('fs');
const path = require('path');

function normalize(filePath) {
    return String(filePath || '').split(path.sep).join('/');
}

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function pathExists(targetPath) {
    try {
        fs.accessSync(targetPath);
        return true;
    } catch {
        return false;
    }
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function writeJson(filePath, value) {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeText(filePath, value) {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, value, 'utf8');
}

function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
}

function listFilesRecursive(rootPath, matcher = () => true, acc = [], options = {}) {
    const ignorePath = typeof options.ignorePath === 'function' ? options.ignorePath : () => false;
    if (!fs.existsSync(rootPath)) {
        return acc;
    }

    let stat;
    try {
        stat = fs.statSync(rootPath);
    } catch {
        return acc;
    }
    if (stat.isFile()) {
        if (!ignorePath(rootPath) && matcher(rootPath)) {
            acc.push(rootPath);
        }
        return acc;
    }

    let entries;
    try {
        entries = fs.readdirSync(rootPath, { withFileTypes: true });
    } catch {
        return acc;
    }
    for (const entry of entries) {
        const fullPath = path.join(rootPath, entry.name);
        if (ignorePath(fullPath)) {
            continue;
        }
        if (entry.isDirectory()) {
            listFilesRecursive(fullPath, matcher, acc, options);
            continue;
        }
        if (matcher(fullPath)) {
            acc.push(fullPath);
        }
    }

    return acc;
}

function repoRelative(filePath, root = process.cwd()) {
    return normalize(path.relative(root, path.resolve(filePath)));
}

function findProjectRoot(startDir = process.cwd()) {
    let current = path.resolve(startDir);

    while (true) {
        if (pathExists(path.join(current, 'project-memory'))) {
            return current;
        }

        const parent = path.dirname(current);
        if (parent === current) {
            return null;
        }
        current = parent;
    }
}

function resolveProjectRoot(startDir = process.cwd()) {
    const envRoot = String(process.env.PMM_PROJECT_ROOT || '').trim();
    if (envRoot) {
        const resolvedEnvRoot = path.resolve(envRoot);
        if (pathExists(path.join(resolvedEnvRoot, 'project-memory'))) {
            return resolvedEnvRoot;
        }
    }

    return findProjectRoot(startDir) || path.resolve(startDir);
}

function slugify(input) {
    return String(input || '')
        .trim()
        .replace(/[^\w.-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase();
}

function loadProjectProfile(root = process.cwd()) {
    const profilePath = path.join(root, 'project-memory', 'state', 'project-profile.json');
    if (!fs.existsSync(profilePath)) {
        return null;
    }
    return readJson(profilePath);
}

function makeAreaRootMap(config = {}, projectProfile = null, root = process.cwd()) {
    const areaMap = new Map();
    const source = config.areaRoots || projectProfile?.areas || {};

    for (const [area, roots] of Object.entries(source)) {
        const normalizedRoots = (Array.isArray(roots) ? roots : [])
            .map(item => path.resolve(root, item))
            .map(normalize);
        areaMap.set(area, normalizedRoots);
    }

    return areaMap;
}

function inferArea(filePath, config = {}, projectProfile = null, root = process.cwd()) {
    const target = normalize(path.resolve(root, filePath));
    const areaRoots = makeAreaRootMap(config, projectProfile, root);
    let bestArea = 'unknown';
    let bestLength = -1;

    for (const [area, roots] of areaRoots.entries()) {
        for (const areaRoot of roots) {
            if (!areaRoot) {
                continue;
            }
            if (target === areaRoot || target.startsWith(`${areaRoot}/`)) {
                if (areaRoot.length > bestLength) {
                    bestArea = area;
                    bestLength = areaRoot.length;
                }
            }
        }
    }

    return bestArea;
}

function inferStacks(area, projectProfile = null) {
    const stacks = projectProfile?.stacks?.[area];
    return Array.isArray(stacks) ? stacks : [];
}

function timestamp() {
    return new Date().toISOString();
}

module.exports = {
    ensureDir,
    findProjectRoot,
    hasOwn,
    inferArea,
    inferStacks,
    listFilesRecursive,
    loadProjectProfile,
    normalize,
    pathExists,
    readJson,
    repoRelative,
    resolveProjectRoot,
    slugify,
    timestamp,
    writeJson,
    writeText,
};
