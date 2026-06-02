const path = require('path');

const DEFAULT_LAYOUT = 'external-data';
const LEGACY_LAYOUT = 'legacy-project-memory';
const VALID_LAYOUTS = new Set([DEFAULT_LAYOUT, LEGACY_LAYOUT]);

function normalizeSlashes(value = '') {
    return String(value || '').replace(/\\/g, '/');
}

function toolRoot() {
    return path.resolve(__dirname, '..', '..');
}

function defaultDataRoot() {
    return path.join(toolRoot(), '.runtime', 'data');
}

function workspaceIdFromRoot(root) {
    return normalizeSlashes(path.resolve(root))
        .replace(/^[A-Za-z]:/, match => match[0].toLowerCase())
        .replace(/[^A-Za-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase();
}

function parseLayoutArgs(argv = []) {
    const parsed = {
        workspaceRoot: '',
        dataRoot: '',
        layout: '',
        passthrough: [],
    };

    for (let index = 0; index < argv.length; index++) {
        const token = argv[index];
        if (token === '--workspace-root' || token === '--root') {
            parsed.workspaceRoot = path.resolve(argv[++index] || process.cwd());
            continue;
        }
        if (token === '--data-root') {
            parsed.dataRoot = path.resolve(argv[++index] || '');
            continue;
        }
        if (token === '--layout') {
            parsed.layout = argv[++index] || '';
            continue;
        }
        parsed.passthrough.push(token);
    }

    return parsed;
}

function resolveLayout(value = '') {
    const layout = String(value || process.env.PMM_LAYOUT || DEFAULT_LAYOUT).trim() || DEFAULT_LAYOUT;
    if (!VALID_LAYOUTS.has(layout)) {
        throw new Error(`Unsupported PMM layout: ${layout}`);
    }
    return layout;
}

function createWorkspaceContext(options = {}) {
    const workspaceRoot = path.resolve(options.workspaceRoot || process.cwd());
    const layout = resolveLayout(options.layout);
    const dataRoot = path.resolve(options.dataRoot || process.env.PMM_DATA_ROOT || defaultDataRoot());
    const workspaceId = workspaceIdFromRoot(workspaceRoot);
    const memoryRoot = layout === LEGACY_LAYOUT
        ? path.join(workspaceRoot, 'project-memory')
        : path.join(dataRoot, 'workspaces', workspaceId);

    return {
        layout,
        workspaceRoot,
        dataRoot,
        workspaceId,
        memoryRoot,
        paths: {
            manifest: path.join(memoryRoot, 'workspace-manifest.json'),
            stateDir: path.join(memoryRoot, 'state'),
            kbDir: path.join(memoryRoot, 'kb'),
            configsDir: path.join(memoryRoot, 'kb', 'configs'),
            featuresDir: path.join(memoryRoot, 'kb', 'features'),
            indexesDir: path.join(memoryRoot, 'kb', 'indexes'),
            projectGlobalDir: path.join(memoryRoot, 'kb', 'project-global'),
            reportsDir: path.join(memoryRoot, 'reports'),
            locksDir: path.join(memoryRoot, 'locks'),
            tmpDir: path.join(memoryRoot, 'tmp'),
            projectProfile: path.join(memoryRoot, 'state', 'project-profile.json'),
            featureRegistry: path.join(memoryRoot, 'state', 'feature-registry.json'),
            featureIndex: path.join(memoryRoot, 'kb', 'indexes', 'features.json'),
            projectProtocols: path.join(memoryRoot, 'state', 'project-protocols.json'),
            rebuildReport: path.join(memoryRoot, 'reports', 'rebuild-report.json'),
        },
    };
}

function createWorkspaceContextFromArgv(argv = [], defaults = {}) {
    const parsed = parseLayoutArgs(argv);
    return createWorkspaceContext({
        workspaceRoot: parsed.workspaceRoot || defaults.workspaceRoot || process.cwd(),
        dataRoot: parsed.dataRoot || defaults.dataRoot || '',
        layout: parsed.layout || defaults.layout || '',
    });
}

module.exports = {
    DEFAULT_LAYOUT,
    LEGACY_LAYOUT,
    createWorkspaceContext,
    createWorkspaceContextFromArgv,
    defaultDataRoot,
    parseLayoutArgs,
    resolveLayout,
    toolRoot,
    workspaceIdFromRoot,
};
