const fs = require('fs');
const path = require('path');

const pathConfigCache = new Map();

function stripJsonComments(content) {
    const input = String(content || '');
    let output = '';
    let inString = false;
    let stringQuote = '';
    let escaped = false;

    for (let index = 0; index < input.length; index++) {
        const char = input[index];
        const next = input[index + 1];

        if (inString) {
            output += char;
            if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === stringQuote) {
                inString = false;
                stringQuote = '';
            }
            continue;
        }

        if (char === '"' || char === "'") {
            inString = true;
            stringQuote = char;
            output += char;
            continue;
        }

        if (char === '/' && next === '/') {
            while (index < input.length && input[index] !== '\n') {
                index++;
            }
            output += '\n';
            continue;
        }

        if (char === '/' && next === '*') {
            index += 2;
            while (index < input.length && !(input[index] === '*' && input[index + 1] === '/')) {
                index++;
            }
            index++;
            continue;
        }

        output += char;
    }

    return output;
}

function readJsonConfig(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
        try {
            return JSON.parse(content);
        } catch {
            return JSON.parse(stripJsonComments(content));
        }
    } catch {
        return null;
    }
}

function normalizePathPattern(value) {
    return normalizeSlashes(String(value || '').trim());
}

function loadPathConfig(cwd = process.cwd()) {
    const root = path.resolve(cwd || process.cwd());
    if (pathConfigCache.has(root)) {
        return pathConfigCache.get(root);
    }

    const configPath = ['tsconfig.json', 'jsconfig.json']
        .map(name => path.join(root, name))
        .find(candidate => fs.existsSync(candidate));
    if (!configPath) {
        pathConfigCache.set(root, null);
        return null;
    }

    const config = readJsonConfig(configPath);
    const compilerOptions = config?.compilerOptions || {};
    const rawPaths = compilerOptions.paths && typeof compilerOptions.paths === 'object'
        ? compilerOptions.paths
        : {};
    const baseUrl = compilerOptions.baseUrl
        ? path.resolve(path.dirname(configPath), compilerOptions.baseUrl)
        : path.dirname(configPath);
    const mappings = [];

    for (const [aliasPattern, targets] of Object.entries(rawPaths)) {
        const normalizedAlias = normalizePathPattern(aliasPattern);
        const targetPatterns = (Array.isArray(targets) ? targets : [])
            .map(normalizePathPattern)
            .filter(Boolean);
        if (normalizedAlias && targetPatterns.length > 0) {
            mappings.push({ aliasPattern: normalizedAlias, targetPatterns });
        }
    }

    const loaded = {
        configPath,
        baseUrl,
        mappings,
    };
    pathConfigCache.set(root, loaded);
    return loaded;
}

function matchAliasPattern(specifier, aliasPattern) {
    const starIndex = aliasPattern.indexOf('*');
    if (starIndex < 0) {
        return specifier === aliasPattern ? '' : null;
    }
    const prefix = aliasPattern.slice(0, starIndex);
    const suffix = aliasPattern.slice(starIndex + 1);
    if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) {
        return null;
    }
    return specifier.slice(prefix.length, specifier.length - suffix.length);
}

function applyTargetPattern(targetPattern, wildcardValue) {
    if (targetPattern.includes('*')) {
        return targetPattern.replace(/\*/g, wildcardValue);
    }
    return wildcardValue ? path.join(targetPattern, wildcardValue) : targetPattern;
}

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
    const configResolved = resolveConfiguredAliasPath(normalized, context);
    if (configResolved) {
        return configResolved;
    }

    if (!normalized.startsWith('@/') && !normalized.startsWith('~/')) {
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

function resolveConfiguredAliasPath(specifier, context) {
    const pathConfig = loadPathConfig(context?.cwd || process.cwd());
    if (!pathConfig || pathConfig.mappings.length <= 0) {
        return null;
    }

    for (const mapping of pathConfig.mappings) {
        const wildcardValue = matchAliasPattern(specifier, mapping.aliasPattern);
        if (wildcardValue === null) {
            continue;
        }
        for (const targetPattern of mapping.targetPatterns) {
            const target = applyTargetPattern(targetPattern, wildcardValue);
            const resolved = resolveCandidatePath(path.resolve(pathConfig.baseUrl, target));
            if (resolved) {
                return resolved;
            }
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
