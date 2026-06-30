const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const {
    ensureDir,
    pathExists,
    readJsonSafe,
    writeJsonAtomic,
} = require('./common');
const {
    defaultDataRoot,
    workspaceIdFromRoot,
} = require('./workspace-layout');

const REGISTRY_KIND = 'pmm-workspace-registry';
const REGISTRY_VERSION = 1;

function normalizeSlashes(value = '') {
    return String(value || '').replace(/\\/g, '/');
}

function normalizeIdentityPath(root) {
    return normalizeSlashes(path.resolve(root))
        .replace(/^[A-Za-z]:/, match => match[0].toLowerCase())
        .toLowerCase();
}

function resolveDataRoot(dataRoot = '') {
    return path.resolve(dataRoot || process.env.PMM_DATA_ROOT || defaultDataRoot());
}

function workspaceRegistryPath(dataRoot = '') {
    return path.join(resolveDataRoot(dataRoot), 'workspace-registry.json');
}

function workspaceHashFromRoot(root) {
    return crypto
        .createHash('sha1')
        .update(normalizeIdentityPath(root))
        .digest('hex')
        .slice(0, 12);
}

function readPackageName(workspaceRoot) {
    const packagePath = path.join(workspaceRoot, 'package.json');
    if (!pathExists(packagePath)) {
        return '';
    }
    const pkg = readJsonSafe(packagePath, { required: false, defaultValue: null });
    return typeof pkg?.name === 'string' ? pkg.name.trim() : '';
}

function redactGitRemote(remote) {
    return String(remote || '').trim().replace(/(https?:\/\/)([^/@]+@)/i, '$1');
}

function gitValue(workspaceRoot, args) {
    if (!workspaceRoot || !pathExists(path.join(workspaceRoot, '.git'))) {
        return '';
    }
    const child = spawnSync('git', ['-C', workspaceRoot, ...args], {
        encoding: 'utf8',
        timeout: 1500,
        windowsHide: true,
    });
    if (child.status !== 0 || child.error) {
        return '';
    }
    return String(child.stdout || '').trim();
}

function buildWorkspaceIdentity(context, options = {}) {
    const workspaceRoot = path.resolve(context.workspaceRoot);
    const dataRoot = resolveDataRoot(context.dataRoot);
    const packageName = readPackageName(workspaceRoot);
    const now = new Date().toISOString();
    const projectName = String(options.name || options.projectName || packageName || path.basename(workspaceRoot)).trim();
    const gitRemote = redactGitRemote(options.gitRemote || gitValue(workspaceRoot, ['remote', 'get-url', 'origin']));

    return {
        workspaceHash: workspaceHashFromRoot(workspaceRoot),
        workspaceId: context.workspaceId || workspaceIdFromRoot(workspaceRoot),
        workspaceRoot,
        dataRoot,
        memoryRoot: path.resolve(context.memoryRoot),
        manifestPath: path.resolve(context.paths.manifest),
        registryPath: workspaceRegistryPath(dataRoot),
        layout: context.layout,
        projectName,
        packageName,
        gitRemote,
        gitBranch: String(options.gitBranch || gitValue(workspaceRoot, ['branch', '--show-current']) || '').trim(),
        createdAt: now,
        updatedAt: now,
        lastSeenAt: now,
    };
}

function emptyRegistry(dataRoot = '') {
    const resolvedDataRoot = resolveDataRoot(dataRoot);
    return {
        kind: REGISTRY_KIND,
        version: REGISTRY_VERSION,
        dataRoot: resolvedDataRoot,
        updatedAt: null,
        workspaces: [],
    };
}

function normalizeRegistryEntry(entry = {}, dataRoot = '', source = 'registry') {
    const resolvedDataRoot = resolveDataRoot(dataRoot);
    const workspaceRoot = entry.workspaceRoot ? path.resolve(entry.workspaceRoot) : '';
    const workspaceId = String(entry.workspaceId || (workspaceRoot ? workspaceIdFromRoot(workspaceRoot) : '')).trim();
    const memoryRoot = entry.memoryRoot
        ? path.resolve(entry.memoryRoot)
        : (workspaceId ? path.join(resolvedDataRoot, 'workspaces', workspaceId) : '');
    const workspaceHash = String(entry.workspaceHash || (workspaceRoot ? workspaceHashFromRoot(workspaceRoot) : '')).trim();
    const manifestPath = entry.manifestPath
        ? path.resolve(entry.manifestPath)
        : (memoryRoot ? path.join(memoryRoot, 'workspace-manifest.json') : '');

    return {
        workspaceHash,
        workspaceId,
        workspaceRoot,
        dataRoot: resolvedDataRoot,
        memoryRoot,
        manifestPath,
        registryPath: workspaceRegistryPath(resolvedDataRoot),
        layout: entry.layout || 'external-data',
        projectName: String(entry.projectName || entry.name || (workspaceRoot ? path.basename(workspaceRoot) : workspaceId)).trim(),
        packageName: String(entry.packageName || '').trim(),
        gitRemote: redactGitRemote(entry.gitRemote),
        gitBranch: String(entry.gitBranch || '').trim(),
        createdAt: entry.createdAt || null,
        updatedAt: entry.updatedAt || null,
        lastSeenAt: entry.lastSeenAt || null,
        registered: source === 'registry' ? entry.registered !== false : false,
        registrySource: source,
    };
}

function loadWorkspaceRegistry(dataRoot = '') {
    const resolvedDataRoot = resolveDataRoot(dataRoot);
    const registry = readJsonSafe(workspaceRegistryPath(resolvedDataRoot), {
        required: false,
        defaultValue: emptyRegistry(resolvedDataRoot),
    });
    if (!registry || typeof registry !== 'object' || Array.isArray(registry)) {
        return emptyRegistry(resolvedDataRoot);
    }
    return {
        kind: registry.kind || REGISTRY_KIND,
        version: registry.version || REGISTRY_VERSION,
        dataRoot: resolvedDataRoot,
        updatedAt: registry.updatedAt || null,
        workspaces: Array.isArray(registry.workspaces)
            ? registry.workspaces.map(entry => normalizeRegistryEntry(entry, resolvedDataRoot, 'registry'))
            : [],
    };
}

function writeWorkspaceRegistry(dataRoot, registry) {
    const resolvedDataRoot = resolveDataRoot(dataRoot);
    ensureDir(resolvedDataRoot);
    writeJsonAtomic(workspaceRegistryPath(resolvedDataRoot), {
        kind: REGISTRY_KIND,
        version: REGISTRY_VERSION,
        dataRoot: resolvedDataRoot,
        updatedAt: registry.updatedAt || new Date().toISOString(),
        workspaces: registry.workspaces,
    });
}

function readWorkspaceManifest(manifestPath, dataRoot) {
    const manifest = readJsonSafe(manifestPath, { required: false, defaultValue: null });
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        return null;
    }
    const memoryRoot = path.dirname(manifestPath);
    return normalizeRegistryEntry({
        ...manifest,
        memoryRoot,
        manifestPath,
        dataRoot,
    }, dataRoot, 'manifest');
}

function discoverWorkspaceManifests(dataRoot = '') {
    const resolvedDataRoot = resolveDataRoot(dataRoot);
    const workspacesDir = path.join(resolvedDataRoot, 'workspaces');
    if (!pathExists(workspacesDir)) {
        return [];
    }
    let entries;
    try {
        entries = fs.readdirSync(workspacesDir, { withFileTypes: true });
    } catch {
        return [];
    }
    return entries
        .filter(entry => entry.isDirectory())
        .map(entry => readWorkspaceManifest(path.join(workspacesDir, entry.name, 'workspace-manifest.json'), resolvedDataRoot))
        .filter(Boolean);
}

function entryKey(entry) {
    if (entry.workspaceHash) {
        return `hash:${entry.workspaceHash}`;
    }
    if (entry.workspaceRoot) {
        return `root:${normalizeIdentityPath(entry.workspaceRoot)}`;
    }
    if (entry.memoryRoot) {
        return `memory:${normalizeIdentityPath(entry.memoryRoot)}`;
    }
    return `id:${entry.workspaceId}`;
}

function mergeEntries(primary, secondary) {
    return {
        ...secondary,
        ...primary,
        manifestPath: primary.manifestPath || secondary.manifestPath,
        createdAt: primary.createdAt || secondary.createdAt,
        updatedAt: primary.updatedAt || secondary.updatedAt,
        lastSeenAt: primary.lastSeenAt || secondary.lastSeenAt,
        registered: primary.registered || secondary.registered,
        registrySource: primary.registrySource === 'registry' ? 'registry' : secondary.registrySource,
    };
}

function collectWorkspaceEntries(dataRoot = '') {
    const resolvedDataRoot = resolveDataRoot(dataRoot);
    const registry = loadWorkspaceRegistry(resolvedDataRoot);
    const byKey = new Map();

    for (const entry of registry.workspaces) {
        byKey.set(entryKey(entry), entry);
    }

    for (const manifestEntry of discoverWorkspaceManifests(resolvedDataRoot)) {
        const key = entryKey(manifestEntry);
        const existing = byKey.get(key);
        if (existing) {
            byKey.set(key, mergeEntries(existing, manifestEntry));
            continue;
        }
        const rootMatch = Array.from(byKey.entries()).find(([, entry]) => (
            entry.workspaceRoot
            && manifestEntry.workspaceRoot
            && normalizeIdentityPath(entry.workspaceRoot) === normalizeIdentityPath(manifestEntry.workspaceRoot)
        ));
        if (rootMatch) {
            byKey.set(rootMatch[0], mergeEntries(rootMatch[1], manifestEntry));
            continue;
        }
        byKey.set(key, manifestEntry);
    }

    return {
        dataRoot: resolvedDataRoot,
        registryPath: workspaceRegistryPath(resolvedDataRoot),
        entries: Array.from(byKey.values()),
    };
}

function withExistence(entry) {
    return {
        ...entry,
        workspaceRootExists: entry.workspaceRoot ? pathExists(entry.workspaceRoot) : false,
        memoryRootExists: entry.memoryRoot ? pathExists(entry.memoryRoot) : false,
        manifestExists: entry.manifestPath ? pathExists(entry.manifestPath) : false,
    };
}

function writeWorkspaceManifest(context, identity) {
    const previous = readJsonSafe(context.paths.manifest, { required: false, defaultValue: null });
    const now = new Date().toISOString();
    const createdAt = previous?.createdAt || identity.createdAt || now;
    writeJsonAtomic(context.paths.manifest, {
        ...(previous && typeof previous === 'object' && !Array.isArray(previous) ? previous : {}),
        workspaceRoot: identity.workspaceRoot,
        workspaceId: identity.workspaceId,
        workspaceHash: identity.workspaceHash,
        layout: identity.layout,
        dataRoot: identity.dataRoot,
        memoryRoot: identity.memoryRoot,
        registryPath: identity.registryPath,
        projectName: identity.projectName,
        packageName: identity.packageName,
        gitRemote: identity.gitRemote,
        gitBranch: identity.gitBranch,
        createdAt,
        updatedAt: now,
        lastSeenAt: now,
    });
}

function registerWorkspace(context, options = {}) {
    const identity = buildWorkspaceIdentity(context, options);
    const registry = loadWorkspaceRegistry(identity.dataRoot);
    const now = new Date().toISOString();
    const currentRootKey = normalizeIdentityPath(identity.workspaceRoot);
    let index = registry.workspaces.findIndex(entry => entry.workspaceHash === identity.workspaceHash);
    if (index < 0) {
        index = registry.workspaces.findIndex(entry => (
            entry.workspaceRoot && normalizeIdentityPath(entry.workspaceRoot) === currentRootKey
        ));
    }

    const previous = index >= 0 ? registry.workspaces[index] : null;
    const entry = {
        ...(previous || {}),
        ...identity,
        createdAt: previous?.createdAt || identity.createdAt,
        updatedAt: now,
        lastSeenAt: now,
        registered: true,
        registrySource: 'registry',
    };

    if (index >= 0) {
        registry.workspaces[index] = entry;
    } else {
        registry.workspaces.push(entry);
    }
    registry.updatedAt = now;
    registry.workspaces.sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));

    ensureDir(identity.memoryRoot);
    writeWorkspaceManifest(context, entry);
    writeWorkspaceRegistry(identity.dataRoot, registry);

    return {
        kind: 'workspace-registration',
        ok: true,
        registered: true,
        dataRoot: identity.dataRoot,
        registryPath: identity.registryPath,
        manifestPath: identity.manifestPath,
        workspace: withExistence(entry),
    };
}

function groupByWorkspaceId(entries) {
    const groups = new Map();
    for (const entry of entries) {
        const key = entry.workspaceId || '';
        if (!key) {
            continue;
        }
        if (!groups.has(key)) {
            groups.set(key, []);
        }
        groups.get(key).push(entry);
    }
    return groups;
}

function detectWorkspaceIssues(options = {}) {
    const collected = collectWorkspaceEntries(options.dataRoot);
    const entries = collected.entries.map(withExistence);
    const issues = [];

    for (const [workspaceId, group] of groupByWorkspaceId(entries).entries()) {
        const identities = new Set(group.map(entry => entry.workspaceHash || normalizeIdentityPath(entry.workspaceRoot || entry.memoryRoot)));
        if (group.length > 1 && identities.size > 1) {
            issues.push({
                severity: 'error',
                code: 'WORKSPACE_ID_COLLISION',
                message: `workspaceId collision: ${workspaceId}`,
                workspaceId,
                entries: group.map(entry => ({
                    workspaceHash: entry.workspaceHash,
                    workspaceRoot: entry.workspaceRoot,
                    memoryRoot: entry.memoryRoot,
                })),
            });
        }
    }

    for (const entry of entries) {
        if (entry.workspaceRoot && !entry.workspaceRootExists) {
            issues.push({
                severity: 'warning',
                code: 'WORKSPACE_ROOT_MISSING',
                message: `workspace root is missing: ${entry.workspaceRoot}`,
                workspaceHash: entry.workspaceHash,
                workspaceId: entry.workspaceId,
            });
        }
        if (entry.memoryRoot && !entry.memoryRootExists) {
            issues.push({
                severity: 'warning',
                code: 'MEMORY_ROOT_MISSING',
                message: `memory root is missing: ${entry.memoryRoot}`,
                workspaceHash: entry.workspaceHash,
                workspaceId: entry.workspaceId,
            });
        }
        if (entry.memoryRootExists && entry.manifestPath && !entry.manifestExists) {
            issues.push({
                severity: 'warning',
                code: 'MANIFEST_MISSING',
                message: `workspace manifest is missing: ${entry.manifestPath}`,
                workspaceHash: entry.workspaceHash,
                workspaceId: entry.workspaceId,
            });
        }
    }

    return issues;
}

function listRegisteredWorkspaces(options = {}) {
    const collected = collectWorkspaceEntries(options.dataRoot);
    const workspaces = collected.entries
        .map(withExistence)
        .filter(entry => options.includeMissing !== false || entry.memoryRootExists || entry.workspaceRootExists)
        .sort((left, right) => String(right.updatedAt || right.lastSeenAt || '').localeCompare(String(left.updatedAt || left.lastSeenAt || '')));
    return {
        kind: 'workspace-list',
        dataRoot: collected.dataRoot,
        registryPath: collected.registryPath,
        registryExists: pathExists(collected.registryPath),
        count: workspaces.length,
        workspaces,
    };
}

function normalizeComparableRemote(value) {
    return redactGitRemote(value).replace(/\.git$/i, '').toLowerCase();
}

function scoreWorkspace(entry, query) {
    const reasons = [];
    let score = 0;
    if (query.workspaceHash && entry.workspaceHash === query.workspaceHash) {
        score += 100;
        reasons.push('workspaceHash');
    }
    if (query.workspaceRoot && entry.workspaceRoot && normalizeIdentityPath(entry.workspaceRoot) === normalizeIdentityPath(query.workspaceRoot)) {
        score += 100;
        reasons.push('workspaceRoot');
    }
    if (query.workspaceId && entry.workspaceId === query.workspaceId) {
        score += 80;
        reasons.push('workspaceId');
    }
    if (query.gitRemote && entry.gitRemote && normalizeComparableRemote(entry.gitRemote) === normalizeComparableRemote(query.gitRemote)) {
        score += 60;
        reasons.push('gitRemote');
    }
    if (query.name) {
        const needle = String(query.name).toLowerCase();
        const names = [entry.projectName, entry.packageName, path.basename(entry.workspaceRoot || '')]
            .filter(Boolean)
            .map(value => String(value).toLowerCase());
        if (names.includes(needle)) {
            score += 50;
            reasons.push('name');
        } else if (names.some(value => value.includes(needle))) {
            score += 25;
            reasons.push('partialName');
        }
    }
    return { score, reasons };
}

function resolveWorkspace(options = {}) {
    const dataRoot = resolveDataRoot(options.dataRoot);
    const query = {
        workspaceRoot: options.workspaceRoot ? path.resolve(options.workspaceRoot) : '',
        workspaceId: String(options.workspaceId || '').trim(),
        workspaceHash: String(options.workspaceHash || '').trim(),
        gitRemote: redactGitRemote(options.gitRemote || ''),
        name: String(options.name || options.projectName || '').trim(),
    };
    if (!query.workspaceHash && query.workspaceRoot) {
        query.workspaceHash = workspaceHashFromRoot(query.workspaceRoot);
    }
    const hasQuery = Object.values(query).some(Boolean);
    if (!hasQuery) {
        return {
            kind: 'workspace-resolution',
            ok: false,
            error: 'NO_QUERY',
            message: 'resolve_workspace requires workspaceRoot, workspaceId, workspaceHash, gitRemote, or name.',
            dataRoot,
            query,
            matches: [],
            matchCount: 0,
            ambiguous: false,
            resolved: null,
        };
    }

    const matches = collectWorkspaceEntries(dataRoot).entries
        .map(withExistence)
        .map(entry => ({ entry, match: scoreWorkspace(entry, query) }))
        .filter(item => item.match.score > 0)
        .sort((left, right) => right.match.score - left.match.score)
        .map(item => ({
            ...item.entry,
            matchScore: item.match.score,
            matchReasons: item.match.reasons,
        }));

    return {
        kind: 'workspace-resolution',
        ok: matches.length > 0,
        dataRoot,
        registryPath: workspaceRegistryPath(dataRoot),
        query,
        matches,
        matchCount: matches.length,
        ambiguous: matches.length > 1,
        resolved: matches.length === 1 ? matches[0] : null,
    };
}

function diagnoseDataRoot(options = {}) {
    const dataRoot = resolveDataRoot(options.dataRoot);
    const list = listRegisteredWorkspaces({ dataRoot, includeMissing: true });
    const issues = detectWorkspaceIssues({ dataRoot });
    const hasErrors = issues.some(issue => issue.severity === 'error');
    const hasWarnings = issues.some(issue => issue.severity === 'warning');
    const suggestedActions = [];
    if (!list.registryExists && list.count > 0) {
        suggestedActions.push('register_workspace');
    }
    if (issues.some(issue => issue.code === 'WORKSPACE_ID_COLLISION')) {
        suggestedActions.push('resolve_workspace');
    }
    if (issues.some(issue => issue.code === 'MANIFEST_MISSING')) {
        suggestedActions.push('register_workspace');
    }

    return {
        kind: 'data-root-diagnosis',
        ok: !hasErrors,
        dataRoot,
        dataRootExists: pathExists(dataRoot),
        registryPath: list.registryPath,
        registryExists: list.registryExists,
        workspacesDir: path.join(dataRoot, 'workspaces'),
        workspacesDirExists: pathExists(path.join(dataRoot, 'workspaces')),
        workspaceCount: list.count,
        registeredCount: list.workspaces.filter(entry => entry.registered).length,
        manifestOnlyCount: list.workspaces.filter(entry => !entry.registered && entry.registrySource === 'manifest').length,
        issueCount: issues.length,
        hasWarnings,
        hasErrors,
        issues,
        suggestedActions: Array.from(new Set(suggestedActions)),
        workspaces: list.workspaces,
    };
}

function summarizeDataRoot(options = {}) {
    const diagnosis = diagnoseDataRoot(options);
    return {
        kind: 'data-root-summary',
        ok: diagnosis.ok,
        dataRoot: diagnosis.dataRoot,
        workspaceCount: diagnosis.workspaceCount,
        registeredCount: diagnosis.registeredCount,
        issueCount: diagnosis.issueCount,
        hasErrors: diagnosis.hasErrors,
        hasWarnings: diagnosis.hasWarnings,
        suggestedActions: diagnosis.suggestedActions,
    };
}

module.exports = {
    REGISTRY_KIND,
    REGISTRY_VERSION,
    buildWorkspaceIdentity,
    collectWorkspaceEntries,
    diagnoseDataRoot,
    detectWorkspaceIssues,
    listRegisteredWorkspaces,
    loadWorkspaceRegistry,
    normalizeIdentityPath,
    redactGitRemote,
    registerWorkspace,
    resolveDataRoot,
    resolveWorkspace,
    summarizeDataRoot,
    workspaceHashFromRoot,
    workspaceRegistryPath,
};
