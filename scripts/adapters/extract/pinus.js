const fs = require('fs');
const path = require('path');
const generic = require('./generic');

function resolveFromProjectRoot(specifier, context) {
    const cwd = context?.cwd || process.cwd();
    const basePath = path.resolve(cwd, specifier);
    const candidates = [
        basePath,
        `${basePath}.ts`,
        `${basePath}.tsx`,
        `${basePath}.js`,
        `${basePath}.jsx`,
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

function resolveImportPath(specifier, scriptFile, context) {
    const genericResolved = generic.resolveImportPath(specifier, scriptFile, context);
    if (genericResolved) {
        return genericResolved;
    }

    // 统一使用正斜杠进行匹配（兼容 Windows 反斜杠）
    const normalized = String(specifier || '').replace(/\\/g, '/');
    if (/^(app|config|types)\//.test(normalized)) {
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
    name: 'pinus',
    resolveImportPath,
    collectScriptMeta,
    collectPrefabMeta,
};
