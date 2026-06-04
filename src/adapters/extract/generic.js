const fs = require('fs');
const path = require('path');

/**
 * 从项目根目录解析导入路径
 * 支持常见的项目根目录路径模式，如 app/, src/, config/, types/ 等
 */
function resolveFromProjectRoot(specifier, context) {
    const cwd = context?.cwd || process.cwd();
    // 统一使用正斜杠，然后让 path.resolve 处理平台差异
    const normalizedSpecifier = normalizeSlashes(specifier);
    const basePath = path.resolve(cwd, normalizedSpecifier);
    const candidates = [
        basePath,
        `${basePath}.ts`,
        `${basePath}.tsx`,
        `${basePath}.js`,
        `${basePath}.jsx`,
        `${basePath}.vue`,
        path.join(basePath, 'index.ts'),
        path.join(basePath, 'index.tsx'),
        path.join(basePath, 'index.js'),
        path.join(basePath, 'index.jsx'),
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return candidate;
        }
    }

    return null;
}

function resolveCandidatePath(basePath) {
    const candidates = [
        basePath,
        `${basePath}.ts`,
        `${basePath}.tsx`,
        `${basePath}.js`,
        `${basePath}.jsx`,
        `${basePath}.vue`,
        path.join(basePath, 'index.ts'),
        path.join(basePath, 'index.tsx'),
        path.join(basePath, 'index.js'),
        path.join(basePath, 'index.jsx'),
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return candidate;
        }
    }

    return null;
}

/**
 * 规范化路径分隔符为 /
 */
function normalizeSlashes(filePath) {
    return String(filePath || '').replace(/\\/g, '/');
}

/**
 * 检查是否为项目根目录路径导入
 * 支持常见的根目录路径前缀
 */
function isProjectRootPath(specifier) {
    // 统一使用正斜杠进行匹配（兼容 Windows 反斜杠）
    const normalized = normalizeSlashes(specifier);
    
    // 支持常见的项目根目录路径模式
    const rootPathPatterns = [
        /^app\//,           // app/common/utils
        /^src\//,           // src/components/...
        /^config\//,        // config/...
        /^types\//,         // types/...
        /^lib\//,           // lib/...
        /^shared\//,        // shared/...
        /^common\//,        // common/...
        /^utils\//,         // utils/...
        /^services\//,      // services/...
        /^models\//,        // models/...
        /^components\//,    // components/...
        /^pages\//,         // pages/...
        /^api\//,           // api/...
        /^db\//,            // db/schema/...
    ];
    return rootPathPatterns.some(pattern => pattern.test(normalized));
}

function resolveAliasPath(specifier, context) {
    const normalized = normalizeSlashes(specifier);
    if (!normalized.startsWith('@/')) {
        return null;
    }

    const relativePath = normalized.slice(2);
    const roots = [
        ...(context?.methodRootsAbs || []),
        ...(context?.componentRootsAbs || []),
        ...(context?.assetRootsAbs || []),
    ];
    const srcRoots = roots.filter(rootPath => path.basename(rootPath).toLowerCase() === 'src');
    const candidates = srcRoots.length > 0
        ? srcRoots
        : [path.join(context?.cwd || process.cwd(), 'src')];

    for (const rootPath of candidates) {
        const resolved = resolveCandidatePath(path.join(rootPath, relativePath));
        if (resolved) {
            return resolved;
        }
    }

    return null;
}

function resolveImportPath(specifier, scriptFile, context) {
    // 优先处理相对路径
    if (specifier.startsWith('./') || specifier.startsWith('../')) {
        const basePath = path.resolve(path.dirname(scriptFile), specifier);
        return resolveCandidatePath(basePath);
    }

    const aliasResolved = resolveAliasPath(specifier, context);
    if (aliasResolved) {
        return aliasResolved;
    }

    // 处理项目根目录路径（如 app/common/utils）
    if (isProjectRootPath(specifier)) {
        return resolveFromProjectRoot(specifier, context);
    }

    return null;
}

function collectScriptMeta() {
    return new Map();
}

function collectPrefabMeta() {
    return new Map();
}

module.exports = {
    name: 'generic',
    resolveImportPath,
    collectScriptMeta,
    collectPrefabMeta,
};
