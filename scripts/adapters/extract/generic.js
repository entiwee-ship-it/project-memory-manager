const fs = require('fs');
const path = require('path');

function resolveImportPath(specifier, scriptFile) {
    if (!(specifier.startsWith('./') || specifier.startsWith('../'))) {
        return null;
    }

    const basePath = path.resolve(path.dirname(scriptFile), specifier);
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
