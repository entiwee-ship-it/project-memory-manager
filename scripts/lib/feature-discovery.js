const path = require('path');
const { normalize, readJsonSafe, timestamp, writeJsonAtomic } = require('./common');

const STOP_WORDS = new Set([
    'app',
    'api',
    'assets',
    'client',
    'common',
    'component',
    'components',
    'controller',
    'controllers',
    'handler',
    'http',
    'index',
    'lib',
    'message',
    'method',
    'node',
    'project',
    'request',
    'response',
    'route',
    'routes',
    'rpc',
    'script',
    'server',
    'service',
    'services',
    'src',
    'state',
    'utils',
    'view',
    'views',
    'workspace',
]);

const ACTION_WORDS = new Set([
    'add',
    'create',
    'delete',
    'fetch',
    'find',
    'get',
    'list',
    'load',
    'post',
    'query',
    'remove',
    'save',
    'set',
    'sync',
    'update',
]);

const LOW_VALUE_PATH_SEGMENTS = new Set([
    'activity',
    'api',
    'app',
    'assets',
    'bundle',
    'common',
    'commom',
    'config',
    'effect',
    'effects',
    'game',
    'handler',
    'http',
    'lobby',
    'listmode',
    'list-mode',
    'majiang',
    'mj',
    'mj-common',
    'modelmj',
    'model-mj',
    'pk-common',
    'poker',
    'campaign',
    'campaigns',
    'prefab',
    'prefabs',
    'remote',
    'routes',
    'script',
    'servers',
    'settlement',
    'src',
    'ui',
    'zp-common',
    'zipai',
]);

function splitWords(value = '') {
    return String(value || '')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[^A-Za-z0-9\u4e00-\u9fa5]+/g, ' ')
        .split(/\s+/)
        .map(item => item.trim())
        .filter(Boolean);
}

function slugifyWords(words = []) {
    return words
        .flatMap(splitWords)
        .map(word => word.toLowerCase())
        .filter(word => word && !STOP_WORDS.has(word))
        .join('-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

function titleizeKey(featureKey = '') {
    return String(featureKey || '')
        .split('-')
        .filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

function relativeFileDir(workspaceRoot, filePath = '') {
    if (!filePath) {
        return '';
    }
    const relative = path.relative(workspaceRoot, filePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        const marker = '/qyProject/';
        const normalizedFile = normalize(filePath);
        const markerIndex = normalizedFile.toLowerCase().indexOf(marker.toLowerCase());
        if (markerIndex >= 0) {
            return normalize(path.dirname(normalizedFile.slice(markerIndex + marker.length)));
        }
    }
    return normalize(path.dirname(relative));
}

function inferAreaFromFile(relativeDir = '', fallback = '') {
    if (fallback && fallback !== 'unknown') {
        return fallback;
    }
    const first = normalize(relativeDir).split('/')[0] || '';
    if (first === 'cms-client' || first === 'xy-client' || first === 'official-website') {
        return 'frontend';
    }
    if (first === 'cms-server' || first === 'qy-server') {
        return 'backend';
    }
    return fallback || 'unknown';
}

function normalizePathSegments(value = '') {
    return String(value || '')
        .split(/[\\/]+/)
        .map(segment => segment.trim())
        .filter(Boolean);
}

function endpointSeed(node) {
    const endpointPath = node.meta?.path || node.name || '';
    const segments = normalizePathSegments(endpointPath.replace(/^[A-Z]+\s+/i, ''));
    const words = [];
    for (const segment of segments) {
        const normalizedSegment = segment.toLowerCase();
        if (LOW_VALUE_PATH_SEGMENTS.has(normalizedSegment) && segments.length > 1) {
            continue;
        }
        const segmentWords = splitWords(segment);
        const firstWord = segmentWords[0]?.toLowerCase() || '';
        if (ACTION_WORDS.has(firstWord)) {
            break;
        }
        words.push(...segmentWords);
        if (words.length >= 3) {
            break;
        }
    }
    const featureKey = slugifyWords(words);
    if (!featureKey) {
        return null;
    }
    return {
        featureKey,
        sourceKind: 'endpoint',
        weight: 45,
        reason: `HTTP endpoint ${endpointPath}`,
    };
}

function serverSegmentFromFile(filePath = '') {
    const segments = normalize(filePath).split('/');
    const serverIndex = segments.findIndex(segment => segment === 'servers');
    if (serverIndex >= 0 && segments[serverIndex + 1]) {
        return segments[serverIndex + 1];
    }
    return '';
}

function messageSeed(node) {
    const serverSegment = serverSegmentFromFile(node.file);
    const featureKey = slugifyWords([serverSegment]);
    if (!featureKey) {
        return null;
    }
    return {
        featureKey,
        sourceKind: node.type,
        weight: node.type === 'message' ? 40 : 35,
        reason: `${node.type} ${node.name}`,
    };
}

function gameplaySegmentFromFile(filePath = '') {
    const segments = normalize(filePath).split('/');
    const gameIndex = segments.findIndex(segment => segment.toLowerCase() === 'game');
    if (gameIndex < 0) {
        return '';
    }
    const afterGame = segments.slice(gameIndex + 1).filter(segment => !/\.[A-Za-z0-9]+$/.test(segment));
    const meaningful = afterGame.find(segment => {
        const normalized = segment.toLowerCase();
        return !LOW_VALUE_PATH_SEGMENTS.has(normalized) && !/^\d+$/.test(normalized) && !/^\d+d$/.test(normalized);
    });
    return meaningful || '';
}

function pathSeed(node) {
    const segment = gameplaySegmentFromFile(node.file);
    const featureKey = slugifyWords([segment]);
    if (!featureKey) {
        return null;
    }
    return {
        featureKey,
        sourceKind: node.type,
        weight: node.type === 'method' || node.type === 'script' ? 25 : 12,
        reason: `source path ${node.file}`,
    };
}

function seedsForNode(node) {
    if (node.type === 'endpoint') {
        return [endpointSeed(node)].filter(Boolean);
    }
    if (node.type === 'message' || node.type === 'route') {
        return [messageSeed(node), pathSeed(node)].filter(Boolean);
    }
    return [pathSeed(node)].filter(Boolean);
}

function adminRootInfo(node, workspaceRoot) {
    const relativeDir = relativeFileDir(workspaceRoot, node.file);
    const segments = normalizePathSegments(relativeDir);
    const cmsIndex = segments.findIndex(segment => segment === 'cms-client' || segment === 'cms-server');
    if (cmsIndex < 0) {
        return null;
    }
    const appSegment = segments[cmsIndex];
    const rootSegments = segments.slice(0, cmsIndex + 1);
    if (segments[cmsIndex + 1] === 'src') {
        rootSegments.push('src');
    }
    const projectSegment = segments[cmsIndex - 1] || path.basename(workspaceRoot);
    return {
        appSegment,
        projectSegment,
        area: appSegment === 'cms-client' ? 'frontend' : 'backend',
        methodRoot: normalize(rootSegments.join('/')),
        relativeDir,
    };
}

function projectFeaturePrefix(projectSegment = '') {
    const normalized = String(projectSegment || '')
        .trim()
        .replace(/[^A-Za-z0-9]+/g, '')
        .toLowerCase();
    if (!normalized || normalized === 'workspace') {
        return '';
    }
    return normalized;
}

function projectFeatureName(prefix = '') {
    if (prefix === 'qyproject') {
        return 'QY Project Admin';
    }
    return titleizeKey(`${prefix ? `${prefix}-` : ''}admin`);
}

function addAdminFullstackCandidates(candidatesByKey, graph, workspaceRoot) {
    const adminNodes = [];
    const roots = new Set();
    const areas = new Set();
    const projectPrefixes = [];

    for (const node of graph.nodes || []) {
        const info = adminRootInfo(node, workspaceRoot);
        if (!info) {
            continue;
        }
        adminNodes.push({ node, info });
        roots.add(info.methodRoot);
        areas.add(info.area);
        const prefix = projectFeaturePrefix(info.projectSegment);
        if (prefix) {
            projectPrefixes.push(prefix);
        }
    }

    if (!adminNodes.some(item => item.info.appSegment === 'cms-client')
        || !adminNodes.some(item => item.info.appSegment === 'cms-server')) {
        return;
    }

    const prefix = projectPrefixes[0] || '';
    const featureKey = prefix ? `${prefix}-admin` : 'admin';
    const candidate = candidatesByKey.get(featureKey) || createCandidate(featureKey);
    candidate.featureName = candidate.featureName === titleizeKey(featureKey)
        ? projectFeatureName(prefix)
        : candidate.featureName;
    candidate.summary = candidate.summary || 'Discovered CMS admin fullstack candidate from cms-client and cms-server roots.';
    candidate.reason = candidate.reason || 'cms-client and cms-server root pair';
    candidate.score += 80 + Math.min(adminNodes.length, 20);

    for (const area of areas) {
        addUnique(candidate.areas, area);
    }
    for (const root of roots) {
        addUnique(candidate.methodRoots, root);
    }
    for (const { node } of adminNodes) {
        if (candidate.evidence.length >= 12) {
            break;
        }
        candidate.evidence.push({
            type: node.type,
            name: node.name,
            file: normalize(node.file || ''),
            reason: 'cms-client/cms-server admin fullstack structure',
        });
    }

    candidatesByKey.set(featureKey, candidate);
}

function addUnique(target, value) {
    if (value && !target.includes(value)) {
        target.push(value);
    }
}

function createCandidate(featureKey) {
    return {
        featureKey,
        featureName: titleizeKey(featureKey),
        summary: '',
        confidence: 'low',
        score: 0,
        areas: [],
        methodRoots: [],
        componentRoots: [],
        assetRoots: [],
        prefabs: [],
        evidence: [],
        reason: '',
    };
}

function addEvidence(candidate, node, seed, workspaceRoot) {
    const relativeDir = relativeFileDir(workspaceRoot, node.file);
    const area = inferAreaFromFile(relativeDir, node.area || '');
    candidate.score += seed.weight;
    addUnique(candidate.areas, area !== 'unknown' ? area : '');
    addUnique(candidate.methodRoots, relativeDir);
    if (node.type === 'component' && /\.prefab$/i.test(node.file || '')) {
        addUnique(candidate.prefabs, normalize(path.relative(workspaceRoot, node.file)));
    }
    if (candidate.evidence.length < 12) {
        candidate.evidence.push({
            type: node.type,
            name: node.name,
            file: normalize(node.file || ''),
            reason: seed.reason,
        });
    }
}

function finalizeCandidate(candidate) {
    candidate.areas.sort((left, right) => left.localeCompare(right));
    candidate.methodRoots = candidate.methodRoots
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right));
    candidate.componentRoots.sort((left, right) => left.localeCompare(right));
    candidate.assetRoots.sort((left, right) => left.localeCompare(right));
    candidate.prefabs.sort((left, right) => left.localeCompare(right));
    candidate.confidence = candidate.score >= 40 ? 'high' : candidate.score >= 25 ? 'medium' : 'low';
    candidate.summary = candidate.summary || `Discovered feature candidate ${candidate.featureName}`;
    candidate.reason = candidate.evidence[0]?.reason || candidate.reason || '';
    return candidate;
}

function confidenceRank(value = '') {
    return { high: 3, medium: 2, low: 1 }[value] || 0;
}

function discoverFeatureCandidates(options = {}) {
    const graph = options.graph || { nodes: [] };
    const workspaceRoot = path.resolve(options.workspaceRoot || process.cwd());
    const limit = Number.isFinite(options.limit) ? options.limit : 20;
    const minConfidence = options.minConfidence || 'low';
    const minRank = confidenceRank(minConfidence);
    const candidatesByKey = new Map();

    for (const node of graph.nodes || []) {
        for (const seed of seedsForNode(node)) {
            if (!seed.featureKey) {
                continue;
            }
            const candidate = candidatesByKey.get(seed.featureKey) || createCandidate(seed.featureKey);
            addEvidence(candidate, node, seed, workspaceRoot);
            candidatesByKey.set(seed.featureKey, candidate);
        }
    }
    addAdminFullstackCandidates(candidatesByKey, graph, workspaceRoot);

    return Array.from(candidatesByKey.values())
        .map(finalizeCandidate)
        .filter(candidate => confidenceRank(candidate.confidence) >= minRank)
        .sort((left, right) => (
            confidenceRank(right.confidence) - confidenceRank(left.confidence)
            || right.score - left.score
            || left.featureKey.localeCompare(right.featureKey)
        ))
        .slice(0, limit);
}

function loadProjectGraph(context) {
    return readJsonSafe(path.join(context.paths.projectGlobalDir, 'chain.graph.json'), { required: true });
}

function discoverFeaturesForContext(context, options = {}) {
    return discoverFeatureCandidates({
        graph: loadProjectGraph(context),
        workspaceRoot: context.workspaceRoot,
        limit: options.limit,
        minConfidence: options.minConfidence,
    });
}

function featureCandidatesPath(context) {
    return path.join(context.paths.stateDir, 'feature-candidates.json');
}

function writeFeatureCandidates(context, candidates, options = {}) {
    const filePath = featureCandidatesPath(context);
    const payload = {
        kind: 'feature-candidates',
        generatedAt: timestamp(),
        workspaceRoot: normalize(context.workspaceRoot),
        projectGlobalDir: normalize(context.paths.projectGlobalDir),
        minConfidence: options.minConfidence || 'low',
        candidates,
    };
    writeJsonAtomic(filePath, payload);
    return { filePath, payload };
}

function readFeatureCandidates(context) {
    return readJsonSafe(featureCandidatesPath(context), {
        required: false,
        defaultValue: { candidates: [] },
    });
}

function generateFeatureConfig({ context, candidate }) {
    const featureDir = path.join(context.paths.featuresDir, candidate.featureKey);
    const configPath = path.join(context.paths.configsDir, `${candidate.featureKey}.json`);
    const config = {
        featureKey: candidate.featureKey,
        featureName: candidate.featureName,
        summary: candidate.summary || '',
        type: 'feature',
        registerFeature: true,
        areas: candidate.areas || [],
        methodRoots: candidate.methodRoots || [],
        componentRoots: candidate.componentRoots || [],
        assetRoots: candidate.assetRoots || [],
        prefabs: candidate.prefabs || [],
        outputs: {
            scan: path.join(featureDir, 'scan.raw.json'),
            graph: path.join(featureDir, 'chain.graph.json'),
            lookup: path.join(featureDir, 'chain.lookup.json'),
            report: path.join(featureDir, 'build.report.json'),
        },
        docs: {
            featureDir: path.join(context.memoryRoot, 'docs', 'features', candidate.featureKey),
            featureIndex: path.join(context.memoryRoot, 'docs', 'features', candidate.featureKey, 'FEATURE.md'),
        },
    };
    return { config, configPath };
}

module.exports = {
    discoverFeatureCandidates,
    discoverFeaturesForContext,
    featureCandidatesPath,
    generateFeatureConfig,
    readFeatureCandidates,
    writeFeatureCandidates,
};
