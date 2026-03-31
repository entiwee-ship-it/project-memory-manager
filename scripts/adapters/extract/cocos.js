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

function registerUuidVariants(map, uuid, info) {
    if (!uuid) {
        return;
    }

    map.set(uuid, info);
    const shortUuid = compressUuid(uuid);
    map.set(shortUuid, info);
    map.set(shortUuid.replace(/\+/g, 'P').replace(/\//g, 'S'), info);
}

function findAssetBases(context) {
    const bases = new Set([...(context.assetRootsAbs || [])]);
    
    // 从 componentRootsAbs 中提取 assets 根目录
    // 例如: E:/xile/xy-client/assets/script/game/... -> E:/xile/xy-client/assets
    for (const root of context.componentRootsAbs || []) {
        const normalized = normalize(root);
        const assetsIndex = normalized.indexOf('/assets/');
        if (assetsIndex !== -1) {
            bases.add(normalized.slice(0, assetsIndex + '/assets/'.length - 1));
        } else if (normalized.endsWith('/assets')) {
            bases.add(normalized);
        }
    }
    
    return Array.from(bases);
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

            const scriptInfo = {
                shortUuid: compressUuid(meta.uuid),
                uuid: meta.uuid,
                path: normalize(scriptFile),
                name: path.basename(scriptFile, '.ts'),
            };

            registerUuidVariants(map, meta.uuid, scriptInfo);
        }
    }
    return map;
}

function inferAssetKind(assetPath, meta = {}, options = {}) {
    const extension = path.extname(assetPath).toLowerCase();
    if (options.subAssetKind) {
        return options.subAssetKind;
    }
    if (extension === '.prefab' || meta.importer === 'prefab') {
        return 'Prefab';
    }
    if (extension === '.png' || extension === '.jpg' || extension === '.jpeg' || extension === '.webp') {
        return meta.importer === 'texture' ? 'Texture2D' : 'ImageAsset';
    }
    if (extension === '.plist' || meta.importer === 'sprite-atlas') {
        return 'SpriteAtlas';
    }
    if (extension === '.mp3' || extension === '.wav' || extension === '.ogg') {
        return 'AudioClip';
    }
    if (extension === '.json') {
        return 'JsonAsset';
    }
    return meta.importer || extension.replace(/^\./, '') || 'Asset';
}

function collectAssetMeta(assetRoots) {
    const map = new Map();
    for (const root of assetRoots) {
        const metaFiles = listFilesRecursive(root, filePath => filePath.endsWith('.meta'));
        for (const metaFile of metaFiles) {
            const meta = readJson(metaFile);
            if (!meta.uuid) {
                continue;
            }

            const assetFile = metaFile.slice(0, -5);
            if (!fs.existsSync(assetFile)) {
                continue;
            }

            const assetInfo = {
                uuid: meta.uuid,
                shortUuid: compressUuid(meta.uuid),
                path: normalize(assetFile),
                name: path.basename(assetFile, path.extname(assetFile)),
                ext: path.extname(assetFile).toLowerCase(),
                importer: meta.importer || '',
                assetKind: inferAssetKind(assetFile, meta),
                isPrefab: assetFile.endsWith('.prefab'),
            };
            registerUuidVariants(map, meta.uuid, assetInfo);

            const subMetas = meta.subMetas && typeof meta.subMetas === 'object' ? meta.subMetas : {};
            for (const [subAssetName, subMeta] of Object.entries(subMetas)) {
                if (!subMeta?.uuid) {
                    continue;
                }
                const subAssetInfo = {
                    uuid: subMeta.uuid,
                    shortUuid: compressUuid(subMeta.uuid),
                    path: normalize(assetFile),
                    name: subMeta.displayName || subAssetName || assetInfo.name,
                    ext: assetInfo.ext,
                    importer: meta.importer || '',
                    assetKind: inferAssetKind(assetFile, meta, {
                        subAssetKind: subMeta.importer === 'sprite-frame' || meta.importer === 'texture'
                            ? 'SpriteFrame'
                            : subMeta.importer || '',
                    }),
                    parentUuid: meta.uuid,
                    subAssetName,
                    isPrefab: false,
                };
                registerUuidVariants(map, subMeta.uuid, subAssetInfo);
            }
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
    collectAssetMeta,
    collectScriptMeta,
    collectPrefabMeta,
};
