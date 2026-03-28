const generic = require('./generic');
const cocos = require('./cocos');
const pinus = require('./pinus');

function inferExtractProfile(args = {}) {
    const prefabInputs = Array.isArray(args.prefabs) ? args.prefabs : [];
    if (prefabInputs.some(item => String(item || '').toLowerCase().endsWith('.prefab'))) {
        return 'cocos';
    }
    const methodRoots = Array.isArray(args.methodRoots) ? args.methodRoots : [];
    const componentRoots = Array.isArray(args.componentRoots) ? args.componentRoots : [];
    const assetRoots = Array.isArray(args.assetRoots) ? args.assetRoots : [];
    const allRoots = [...methodRoots, ...componentRoots, ...assetRoots].map(item => String(item || '').toLowerCase());
    if (allRoots.some(item => item.includes('/app/servers/') || item.includes('\\app\\servers\\') || item.includes('/app/http/routes/') || item.includes('\\app\\http\\routes\\'))) {
        return 'pinus';
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
        case 'pinus':
            return [pinus, generic];
        default:
            return selectedMode === 'cocos'
                ? [cocos, generic]
                : selectedMode === 'pinus'
                  ? [pinus, generic]
                  : [generic];
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
