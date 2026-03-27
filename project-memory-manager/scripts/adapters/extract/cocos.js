const fs = require('fs');
const path = require('path');
const { listFilesRecursive, normalize, readJson } = require('../../lib/common');

const BASE64_KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function compressUuid(uuid) {
    const normalizedUuid = uuid.replace(/-/g, '');
    if (normalizedUuid.length !== 32) {
        return uuid;
    }

    let compressed = normalizedUuid.slice(0, 5);
    for (let index = 5; index < normalizedUuid.length; index += 3) {
        const segment = normalizedUuid.slice(index, index + 3);
        const value = parseInt(segment, 16);
        compressed += BASE64_KEYS[value >> 6] + BASE64_KEYS[value & 0x3f];
    }

    return compressed;
}

function findAssetBases(context) {
    return Array.from(new Set([...(context.assetRootsAbs || []), ...(context.componentRootsAbs || [])]));
}

function findOopsBases(context) {
    const bases = [];
    for (const fullPath of [...(context.componentRootsAbs || []), ...(context.assetRootsAbs || [])]) {
        const normalizedPath = normalize(fullPath);
        const marker = '/oops-plugin-framework/assets';
        const markerIndex = normalizedPath.indexOf(marker);
        if (markerIndex !== -1) {
            bases.push(normalizedPath.slice(0, markerIndex + marker.length));
        }
    }
    return Array.from(new Set(bases));
}

function resolveImportPath(specifier, scriptFile, context) {
    const candidates = [];
    if (specifier.startsWith('db://assets/')) {
        const relativePath = specifier.slice('db://assets/'.length);
        for (const baseRoot of findAssetBases(context)) {
            const basePath = path.resolve(baseRoot, relativePath);
            candidates.push(basePath, `${basePath}.ts`, path.join(basePath, 'index.ts'));
        }
    } else if (specifier.startsWith('db://oops-framework/')) {
        const relativePath = specifier.slice('db://oops-framework/'.length);
        for (const baseRoot of findOopsBases(context)) {
            const basePath = path.resolve(baseRoot, relativePath);
            candidates.push(basePath, `${basePath}.ts`, path.join(basePath, 'index.ts'));
        }
    }

    for (const candidate of candidates) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return candidate;
        }
    }
    return null;
}

function collectScriptMeta(componentRoots) {
    const map = new Map();
    for (const root of componentRoots) {
        const metaFiles = listFilesRecursive(root, filePath => filePath.endsWith('.ts.meta'));
        for (const metaFile of metaFiles) {
            const meta = readJson(metaFile);
            if (!meta.uuid) {
                continue;
            }

            const scriptFile = metaFile.slice(0, -5);
            if (!fs.existsSync(scriptFile)) {
                continue;
            }

            const shortUuid = compressUuid(meta.uuid);
            const scriptInfo = {
                shortUuid,
                uuid: meta.uuid,
                path: normalize(scriptFile),
                name: path.basename(scriptFile, '.ts'),
            };

            map.set(shortUuid, scriptInfo);
            map.set(shortUuid.replace(/\+/g, 'P').replace(/\//g, 'S'), scriptInfo);
        }
    }
    return map;
}

function collectPrefabMeta(assetRoots) {
    const map = new Map();
    for (const root of assetRoots) {
        const metaFiles = listFilesRecursive(root, filePath => filePath.endsWith('.prefab.meta'));
        for (const metaFile of metaFiles) {
            const meta = readJson(metaFile);
            if (!meta.uuid) {
                continue;
            }
            const prefabFile = metaFile.slice(0, -5);
            map.set(meta.uuid, normalize(prefabFile));
        }
    }
    return map;
}

module.exports = {
    name: 'cocos',
    resolveImportPath,
    collectScriptMeta,
    collectPrefabMeta,
};
