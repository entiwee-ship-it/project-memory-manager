const generic = require('./generic');
const cocos = require('./cocos');

function inferExtractProfile(args = {}) {
    const prefabInputs = Array.isArray(args.prefabs) ? args.prefabs : [];
    if (prefabInputs.some(item => String(item || '').toLowerCase().endsWith('.prefab'))) {
        return 'cocos';
    }
    return 'generic';
}

function getExtractAdapters(mode = 'auto', args = {}) {
    const selectedMode = mode === 'auto' ? inferExtractProfile(args) : mode;
    switch (selectedMode) {
        case 'generic':
            return [generic];
        case 'cocos':
            return [cocos, generic];
        default:
            return selectedMode === 'cocos' ? [cocos, generic] : [generic];
    }
}

function createExtractContext(args, cwd = process.cwd()) {
    return {
        cwd,
        adapterMode: args.adapter || 'auto',
        componentRootsAbs: (args.componentRoots || []).map(item => require('path').resolve(cwd, item)),
        assetRootsAbs: (args.assetRoots || []).map(item => require('path').resolve(cwd, item)),
        methodRootsAbs: (args.methodRoots || []).map(item => require('path').resolve(cwd, item)),
        adapters: getExtractAdapters(args.adapter || 'auto', args),
    };
}

module.exports = {
    createExtractContext,
    inferExtractProfile,
    getExtractAdapters,
};
