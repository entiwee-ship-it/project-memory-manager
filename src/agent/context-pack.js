const fs = require('fs');
const path = require('path');
const { buildLookup } = require('../graph/build-chain-kb');
const { loadFeatureLookupArtifacts, normalizeFeatureRecord, titleizeSlug } = require('../graph/feature-kb');
const { pathExists, readJsonSafe } = require('../shared/common');
const { createWorkspaceContext } = require('../shared/workspace-layout');

const DEFAULT_LIMIT = 8;
const DEFAULT_DEPTH = 4;

function toPosix(value = '') {
    return String(value || '').replace(/\\/g, '/');
}

function normalizeText(value = '') {
    return toPosix(value).toLowerCase();
}

function uniq(values = []) {
    return Array.from(new Set(values.filter(Boolean)));
}

function uniqBy(items = [], keyFn) {
    const seen = new Set();
    const result = [];
    for (const item of items) {
        const key = keyFn(item);
        if (!key || seen.has(key)) {
            continue;
        }
        seen.add(key);
        result.push(item);
    }
    return result;
}

function workspaceRelative(workspaceRoot, filePath = '') {
    if (!filePath) {
        return '';
    }
    const normalized = toPosix(filePath);
    const root = toPosix(path.resolve(workspaceRoot));
    const absolute = path.isAbsolute(filePath) ? toPosix(path.resolve(filePath)) : normalized;
    if (absolute.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
        return absolute.slice(root.length + 1);
    }
    return normalized;
}

function compactMeta(node) {
    const meta = node?.meta || {};
    const result = {};
    for (const key of ['method', 'path', 'route', 'protocol', 'transport', 'callee', 'importPath', 'serviceKind', 'target', 'host', 'packageName', 'sourceKind']) {
        if (meta[key]) {
            result[key] = meta[key];
        }
    }
    return result;
}

function compactNode(node, workspaceRoot) {
    if (!node) {
        return null;
    }
    return {
        id: node.id,
        type: node.type,
        name: node.name,
        file: workspaceRelative(workspaceRoot, node.file || ''),
        line: node.line ?? null,
        area: node.area || '',
        meta: compactMeta(node),
    };
}

function compactEdge(edge = {}, lookup, workspaceRoot) {
    const fromNode = lookup.nodesById?.[edge.from] || null;
    const toNode = lookup.nodesById?.[edge.to] || null;
    return {
        type: edge.type || '',
        sourceKind: edge.sourceKind || '',
        from: fromNode ? compactNode(fromNode, workspaceRoot) : { id: edge.from || '' },
        to: toNode ? compactNode(toNode, workspaceRoot) : { id: edge.to || '' },
        meta: edge.meta || {},
    };
}

function evidenceFromNode(node, workspaceRoot, reason = '', confidence = 'medium') {
    const method = node?.type === 'method' ? node.name || '' : '';
    const endpoint = ['endpoint', 'request'].includes(node?.type) ? node.name || '' : '';
    return {
        kind: 'node',
        nodeId: node?.id || '',
        nodeType: node?.type || '',
        name: node?.name || '',
        file: workspaceRelative(workspaceRoot, node?.file || ''),
        line: node?.line ?? null,
        method,
        endpoint,
        confidence,
        reason,
    };
}

function evidenceFromEdge(edge, lookup, workspaceRoot, reason = '', confidence = 'medium') {
    const fromNode = lookup.nodesById?.[edge.from] || null;
    const toNode = lookup.nodesById?.[edge.to] || null;
    const edgeNodes = [fromNode, toNode].filter(Boolean);
    const method = edgeNodes.find(node => node.type === 'method')?.name || '';
    const endpoint = edgeNodes.find(node => ['endpoint', 'request'].includes(node.type))?.name || '';
    return {
        kind: 'edge',
        edgeType: edge.type || '',
        sourceKind: edge.sourceKind || '',
        from: fromNode ? compactNode(fromNode, workspaceRoot) : { id: edge.from || '' },
        to: toNode ? compactNode(toNode, workspaceRoot) : { id: edge.to || '' },
        method,
        endpoint,
        confidence,
        reason,
    };
}

function confidenceFromScore(score) {
    if (score >= 18) {
        return 'high';
    }
    if (score >= 8) {
        return 'medium';
    }
    return 'low';
}

function parseTaskTerms(task = '') {
    const raw = String(task || '').trim();
    const text = normalizeText(raw);
    const terms = new Set();
    for (const part of text.split(/[^a-z0-9_./:-]+/i)) {
        const token = part.trim();
        if (token.length >= 2) {
            terms.add(token);
        }
    }
    const add = (...items) => items.forEach(item => terms.add(normalizeText(item)));

    if (/settings|setting|设置/.test(text)) {
        add('settings', 'Setting', 'SettingsPage', 'loadSettings', 'loadStatus', 'loadAiConfig', 'saveSettings');
    }
    if (/ai|模型|配置|config/.test(text)) {
        add('ai', 'aiConfig', 'getAiConfig', 'saveAiConfig', '/api/ai/config', '/api/ai/models');
    }
    if (/保存|save|更新|修改/.test(text)) {
        add('save', 'post', 'update', 'create', 'upsert');
    }
    if (/chat|聊天|流式|回复|对话|stream/.test(text)) {
        add('chat', '/api/chat', 'handleChat', 'streamChatCompletion', 'conversation', 'message', 'Anthropic', 'Claude');
    }
    if (/facebook|graph|oauth|授权|脸书/.test(text)) {
        add('facebook', 'facebook-oauth', 'Facebook Graph API', 'facebookConnection', '/api/facebook/oauth');
    }
    if (/auth|login|logout|register|登录|注册|登出/.test(text)) {
        add('auth', 'login', 'logout', 'register', '/api/auth');
    }
    if (/operation|operations|发布|同步|评论|campaign/.test(text)) {
        add('operations', '/api/operations', 'executePostToFacebook', 'syncPosts', 'syncComments', 'campaign');
    }
    return {
        raw,
        normalized: text,
        terms: Array.from(terms).filter(Boolean),
    };
}

function nodeSearchText(node) {
    const meta = node?.meta || {};
    return normalizeText([
        node?.type,
        node?.name,
        node?.file,
        node?.area,
        ...(Array.isArray(node?.stack) ? node.stack : []),
        ...Object.values(meta).flatMap(value => Array.isArray(value) ? value : [value]),
        ...(Array.isArray(meta.tags) ? meta.tags : []),
    ].filter(Boolean).join(' '));
}

function scoreNode(node, terms = []) {
    const text = nodeSearchText(node);
    let score = 0;
    for (const term of terms) {
        const normalized = normalizeText(term);
        if (!normalized) {
            continue;
        }
        if (node.name && normalizeText(node.name) === normalized) {
            score += 12;
        } else if (text.includes(normalized)) {
            score += normalized.includes('/') ? 8 : 5;
        }
    }
    if (['endpoint', 'request'].includes(node.type)) {
        score += 3;
    }
    if (node.type === 'method') {
        score += 2;
    }
    if (['table', 'external-service'].includes(node.type)) {
        score += 1;
    }
    return score;
}

function loadJsonIfExists(filePath, fallback) {
    return readJsonSafe(filePath, { required: false, defaultValue: fallback });
}

function loadProjectArtifacts(context) {
    const graphPath = path.join(context.paths.projectGlobalDir, 'chain.graph.json');
    if (!pathExists(graphPath)) {
        throw new Error(`project-global KB 不存在，请先构建: ${graphPath}`);
    }
    const graph = readJsonSafe(graphPath);
    const lookupPath = path.join(context.paths.projectGlobalDir, 'chain.lookup.json');
    const lookup = pathExists(lookupPath) ? readJsonSafe(lookupPath) : buildLookup(graph);
    return { graph, lookup, graphPath, lookupPath };
}

function loadFeatureRegistry(context) {
    const registry = loadJsonIfExists(context.paths.featureRegistry, { features: [] });
    return (registry.features || []).map(item => normalizeFeatureRecord(item));
}

function listFeatureConfigs(context) {
    if (!fs.existsSync(context.paths.configsDir)) {
        return [];
    }
    return fs.readdirSync(context.paths.configsDir)
        .filter(file => file.endsWith('.json') && file !== 'project-global.json')
        .map(file => {
            const configPath = path.join(context.paths.configsDir, file);
            const config = loadJsonIfExists(configPath, null);
            if (!config) {
                return null;
            }
            return {
                ...config,
                featureKey: config.featureKey || path.basename(file, '.json'),
                featureName: config.featureName || titleizeSlug(config.featureKey || path.basename(file, '.json')),
                configPath,
            };
        })
        .filter(Boolean);
}

function loadFeatureCandidates(context) {
    const candidatesPath = path.join(context.paths.stateDir, 'feature-candidates.json');
    const data = loadJsonIfExists(candidatesPath, { candidates: [] });
    return Array.isArray(data.candidates) ? data.candidates : [];
}

function makeFeatureCatalog(context) {
    const registry = loadFeatureRegistry(context);
    const configs = listFeatureConfigs(context);
    const candidates = loadFeatureCandidates(context);
    const byKey = new Map();
    for (const item of [...candidates, ...configs, ...registry]) {
        const key = String(item.featureKey || '').trim();
        if (!key) {
            continue;
        }
        const previous = byKey.get(key) || {};
        byKey.set(key, {
            ...previous,
            ...item,
            featureKey: key,
            featureName: item.featureName || previous.featureName || titleizeSlug(key),
            summary: item.summary || previous.summary || '',
            areas: Array.isArray(item.areas) ? item.areas : (previous.areas || []),
            methodRoots: Array.isArray(item.methodRoots) ? item.methodRoots : (previous.methodRoots || []),
            evidence: Array.isArray(item.evidence) ? item.evidence : (previous.evidence || []),
            configPath: item.configPath || previous.configPath || '',
            kbDir: item.kbDir || previous.kbDir || '',
            outputs: item.outputs || previous.outputs || {},
        });
    }
    return [...byKey.values()].sort((left, right) => left.featureKey.localeCompare(right.featureKey));
}

function featureSearchText(feature = {}) {
    return normalizeText([
        feature.featureKey,
        feature.featureName,
        feature.summary,
        ...(feature.areas || []),
        ...(feature.methodRoots || []),
        ...(feature.evidence || []).flatMap(item => [item.name, item.file, item.reason, item.type]),
    ].filter(Boolean).join(' '));
}

function scoreFeature(feature, terms = [], files = []) {
    const text = featureSearchText(feature);
    let score = 0;
    for (const term of terms) {
        const normalized = normalizeText(term);
        if (!normalized) {
            continue;
        }
        if (normalizeText(feature.featureKey) === normalized) {
            score += 20;
        } else if (text.includes(normalized)) {
            score += normalized.includes('/') ? 8 : 6;
        }
    }
    for (const file of files) {
        const rel = normalizeText(file);
        if (!rel) {
            continue;
        }
        if ((feature.methodRoots || []).some(root => featureRootMatchesFile(root, rel) && isSpecificFeatureRoot(root))) {
            score += 10;
        }
        if ((feature.evidence || []).some(item => evidenceFileMatches(item.file, rel))) {
            score += 12;
        }
    }
    return score;
}

function normalizeFeatureRoot(root = '') {
    return normalizeText(root).replace(/\/+$/, '');
}

function isSpecificFeatureRoot(root = '') {
    const normalized = normalizeFeatureRoot(root);
    if (!normalized) {
        return false;
    }
    const broadRoots = new Set(['.', 'app', 'src', 'lib', 'components', 'server', 'assets']);
    return !broadRoots.has(normalized) && normalized.split('/').filter(Boolean).length >= 2;
}

function featureRootMatchesFile(root = '', file = '') {
    const normalizedRoot = normalizeFeatureRoot(root);
    const normalizedFile = normalizeText(file);
    return Boolean(normalizedRoot && normalizedFile && (normalizedFile === normalizedRoot || normalizedFile.startsWith(`${normalizedRoot}/`)));
}

function evidenceFileMatches(evidenceFile = '', file = '') {
    const evidence = normalizeText(evidenceFile);
    const normalizedFile = normalizeText(file);
    return Boolean(evidence && normalizedFile && (evidence === normalizedFile || evidence.endsWith(`/${normalizedFile}`) || normalizedFile.endsWith(`/${evidence}`)));
}

function pickScoredNodes(graph, terms, options = {}) {
    const limit = options.limit || DEFAULT_LIMIT;
    return [...(graph.nodes || [])]
        .map(node => ({ node, score: scoreNode(node, terms) }))
        .filter(item => item.score > 0)
        .sort((left, right) => right.score - left.score || String(left.node.name).localeCompare(String(right.node.name)))
        .slice(0, limit);
}

function traverse(lookup, startIds = [], options = {}) {
    const depthLimit = options.depth || DEFAULT_DEPTH;
    const directions = options.directions || ['downstream'];
    const visited = new Set(startIds);
    const edgeSeen = new Set();
    const result = [];
    const queue = startIds.map(id => ({ id, depth: 0 }));

    while (queue.length > 0) {
        const current = queue.shift();
        for (const direction of directions) {
            const bucket = direction === 'upstream' ? lookup.adjacency?.incoming : lookup.adjacency?.outgoing;
            const edges = bucket?.[current.id] || [];
            for (const edge of edges) {
                const nextId = direction === 'upstream' ? edge.from : edge.to;
                const edgeKey = `${direction}:${edge.from}:${edge.to}:${edge.type}:${edge.sourceKind || ''}`;
                if (!edgeSeen.has(edgeKey)) {
                    edgeSeen.add(edgeKey);
                    result.push({
                        direction,
                        depth: current.depth + 1,
                        edge,
                        node: lookup.nodesById?.[nextId] || null,
                    });
                }
                if (current.depth + 1 >= depthLimit || visited.has(nextId)) {
                    continue;
                }
                visited.add(nextId);
                queue.push({ id: nextId, depth: current.depth + 1 });
            }
        }
    }
    return result;
}

function nodesFromTraversal(traversal = []) {
    return traversal.map(item => item.node).filter(Boolean);
}

function collectByType(nodes = [], type, limit = DEFAULT_LIMIT) {
    return uniqBy(nodes.filter(node => node.type === type), node => node.id).slice(0, limit);
}

function collectDataAccess(traversal = [], lookup, workspaceRoot) {
    const tables = new Map();
    const evidence = [];
    for (const item of traversal) {
        const edge = item.edge || {};
        if (!['reads', 'writes'].includes(edge.type)) {
            continue;
        }
        const fromNode = lookup.nodesById?.[edge.from] || null;
        const toNode = lookup.nodesById?.[edge.to] || null;
        const tableNode = toNode?.type === 'table' ? toNode : (fromNode?.type === 'table' ? fromNode : null);
        const actorNode = tableNode?.id === edge.to ? fromNode : toNode;
        if (!tableNode) {
            continue;
        }
        if (!tables.has(tableNode.id)) {
            tables.set(tableNode.id, {
                ...compactNode(tableNode, workspaceRoot),
                reads: [],
                writes: [],
            });
        }
        const access = {
            method: actorNode?.name || '',
            file: workspaceRelative(workspaceRoot, actorNode?.file || ''),
            line: actorNode?.line ?? null,
            operation: edge.meta?.operation || '',
            edgeType: edge.type,
        };
        tables.get(tableNode.id)[edge.type === 'reads' ? 'reads' : 'writes'].push(access);
        evidence.push(evidenceFromEdge(edge, lookup, workspaceRoot, `数据表 ${edge.type}`, 'high'));
    }
    return {
        tables: [...tables.values()].sort((left, right) => left.name.localeCompare(right.name)),
        evidence,
    };
}

function compactChain(startNode, traversal, lookup, workspaceRoot, limit = 16) {
    const nodes = [startNode, ...nodesFromTraversal(traversal)].filter(Boolean);
    const edges = traversal.map(item => item.edge).filter(Boolean);
    return {
        start: compactNode(startNode, workspaceRoot),
        nodes: uniqBy(nodes, node => node.id).slice(0, limit).map(node => compactNode(node, workspaceRoot)),
        edges: uniqBy(edges, edge => `${edge.from}:${edge.to}:${edge.type}:${edge.sourceKind || ''}`)
            .slice(0, limit)
            .map(edge => compactEdge(edge, lookup, workspaceRoot)),
    };
}

function inferValidationCommands(workspaceRoot, context, source = {}) {
    const packageJson = loadJsonIfExists(path.join(workspaceRoot, 'package.json'), null);
    const scripts = packageJson?.scripts || {};
    const commands = [];
    if (scripts.test) {
        commands.push('npm test');
    }
    if (scripts.lint) {
        commands.push('npm run lint');
    }
    if (scripts['typecheck']) {
        commands.push('npm run typecheck');
    }
    if (scripts.build) {
        commands.push('npm run build');
    }
    const featureKeys = (source.features || []).map(feature => feature.featureKey).filter(Boolean).slice(0, 3);
    commands.push(`node src/bin/build-project.js --workspace-root "${context.workspaceRoot}" --data-root "${context.dataRoot}" --json`);
    for (const featureKey of featureKeys) {
        commands.push(`node src/bin/build-feature.js --workspace-root "${context.workspaceRoot}" --data-root "${context.dataRoot}" --feature-key ${featureKey} --json`);
    }
    return uniq(commands).slice(0, 8);
}

function buildEditBoundary(files = [], features = []) {
    const primaryFiles = uniq(files).slice(0, 12);
    const featureRoots = uniq(features.flatMap(feature => feature.methodRoots || [])).slice(0, 12);
    return {
        primaryFiles,
        relatedRoots: featureRoots,
        guidance: [
            '优先围绕 primaryFiles 和 relatedRoots 修改；先查证再扩大范围。',
            '不要把 PMM 运行数据写入目标项目源码目录。',
            '不要读取或提交 .env、密钥、令牌、Cookie 或生产配置。',
            '涉及 external-service、auth、Prisma 写入时增加验证和回归测试。',
        ],
    };
}

function summarizeTaskUnderstanding(taskInfo, features, nodes) {
    return {
        rawTask: taskInfo.raw,
        extractedTerms: taskInfo.terms.slice(0, 24),
        inferredFeatures: features.map(feature => feature.featureKey),
        inferredEntrypoints: nodes
            .filter(node => ['endpoint', 'request', 'method'].includes(node.type))
            .slice(0, 8)
            .map(node => `${node.type}:${node.name}`),
    };
}

function prepareTaskContext(options = {}) {
    const context = createWorkspaceContext({
        workspaceRoot: options.workspaceRoot,
        dataRoot: options.dataRoot,
        layout: options.layout,
    });
    const { graph, lookup } = loadProjectArtifacts(context);
    const taskInfo = parseTaskTerms(options.task || options.query || '');
    const limit = options.limit || DEFAULT_LIMIT;
    const scoredNodes = pickScoredNodes(graph, taskInfo.terms, { limit: Math.max(limit * 3, 20) });
    const startNodes = scoredNodes.slice(0, limit).map(item => item.node);
    const startIds = startNodes.map(node => node.id);
    const traversal = traverse(lookup, startIds, { depth: options.depth || DEFAULT_DEPTH, directions: ['downstream', 'upstream'] });
    const relatedNodes = uniqBy([...startNodes, ...nodesFromTraversal(traversal)], node => node.id);
    const files = uniq(relatedNodes.map(node => workspaceRelative(context.workspaceRoot, node.file || '')).filter(Boolean));
    const startFiles = uniq(startNodes.map(node => workspaceRelative(context.workspaceRoot, node.file || '')).filter(Boolean));
    const featureScoringFiles = startFiles.length ? startFiles : files;
    const features = makeFeatureCatalog(context)
        .map(feature => ({ feature, score: scoreFeature(feature, taskInfo.terms, featureScoringFiles) }))
        .filter(item => item.score > 0)
        .sort((left, right) => right.score - left.score || left.feature.featureKey.localeCompare(right.feature.featureKey))
        .slice(0, limit)
        .map(item => ({
            featureKey: item.feature.featureKey,
            featureName: item.feature.featureName,
            summary: item.feature.summary || '',
            confidence: confidenceFromScore(item.score),
            methodRoots: item.feature.methodRoots || [],
        }));
    const compactFeatures = features.map(feature => ({
        featureKey: feature.featureKey,
        featureName: feature.featureName,
        summary: feature.summary,
        confidence: feature.confidence,
    }));
    const dataAccess = collectDataAccess(traversal, lookup, context.workspaceRoot);
    const externalServices = uniqBy(
        collectByType(relatedNodes, 'external-service', limit * 2).map(node => compactNode(node, context.workspaceRoot)),
        node => node.name
    ).slice(0, limit);
    const endpoints = collectByType(relatedNodes, 'endpoint', limit).map(node => compactNode(node, context.workspaceRoot));
    const requests = collectByType(relatedNodes, 'request', limit).map(node => compactNode(node, context.workspaceRoot));
    const methods = collectByType(relatedNodes, 'method', limit * 2).map(node => compactNode(node, context.workspaceRoot));
    const tables = collectByType(relatedNodes, 'table', limit).map(node => compactNode(node, context.workspaceRoot));
    const callChains = startNodes.slice(0, 3).map(node => compactChain(
        node,
        traversal.filter(item => item.edge?.from === node.id || item.edge?.to === node.id || item.depth <= 2),
        lookup,
        context.workspaceRoot
    ));
    return {
        kind: 'agent-task-context',
        workspaceRoot: context.workspaceRoot,
        dataRoot: context.dataRoot,
        task: taskInfo.raw,
        taskUnderstanding: summarizeTaskUnderstanding(taskInfo, compactFeatures, startNodes),
        relevantFeatures: compactFeatures,
        keyEntrypoints: {
            endpoints,
            requests,
            methods: methods.slice(0, limit),
        },
        criticalFiles: files.slice(0, 16),
        callChains,
        dataAccess: {
            tables: dataAccess.tables.length ? dataAccess.tables : tables.map(table => ({ ...table, reads: [], writes: [] })),
        },
        externalServices,
        editBoundary: buildEditBoundary(files, features),
        validation: {
            recommendedCommands: inferValidationCommands(context.workspaceRoot, context, { features }),
        },
        uncertainties: buildUncertainties({ taskInfo, features, startNodes, dataAccess, externalServices }),
        evidence: uniqBy(
            [
                ...scoredNodes.slice(0, 16).map(item => evidenceFromNode(item.node, context.workspaceRoot, `任务词命中，score=${item.score}`, confidenceFromScore(item.score))),
                ...dataAccess.evidence.slice(0, 8),
            ],
            item => `${item.kind}:${item.nodeId || item.edgeType}:${item.name || ''}:${item.file || ''}:${item.line || ''}`
        ),
    };
}

function buildUncertainties({ taskInfo, features, startNodes, dataAccess, externalServices }) {
    const uncertainties = [];
    if (!taskInfo.raw) {
        uncertainties.push('未提供自然语言任务，只能基于空查询返回有限上下文。');
    }
    if (!features.length) {
        uncertainties.push('未命中高置信 feature；建议先运行 discover-features 或提供更具体的入口词。');
    }
    if (!startNodes.length) {
        uncertainties.push('未命中明确入口节点；建议改用 endpoint/method/file 进一步收窄。');
    }
    if (!dataAccess.tables.length) {
        uncertainties.push('当前上下文未发现数据表读写；可能是功能无数据库访问，或需要扩大链路深度。');
    }
    if (!externalServices.length) {
        uncertainties.push('当前上下文未发现外部服务依赖；可能是功能无外部调用，或目标是动态 URL。');
    }
    return uncertainties;
}

function loadFeatureArtifactsForAgent(context, featureKey) {
    const record = loadFeatureRegistry(context).find(item => item.featureKey === featureKey);
    if (!record) {
        throw new Error(`未找到 feature KB: ${featureKey}`);
    }
    return loadFeatureLookupArtifacts(context.workspaceRoot, record);
}

function summarizeFeatureDataFlows(graph, lookup, workspaceRoot) {
    const startNodes = (graph.nodes || [])
        .filter(node => ['endpoint', 'request'].includes(node.type))
        .slice(0, 4);
    if (!startNodes.length) {
        startNodes.push(...(graph.nodes || []).filter(node => node.type === 'method').slice(0, 3));
    }
    return startNodes.map(node => compactChain(
        node,
        traverse(lookup, [node.id], { depth: 3, directions: ['downstream'] }),
        lookup,
        workspaceRoot,
        12
    ));
}

function explainFeatureForAgent(options = {}) {
    const context = createWorkspaceContext({
        workspaceRoot: options.workspaceRoot,
        dataRoot: options.dataRoot,
        layout: options.layout,
    });
    const featureKey = String(options.featureKey || options.feature || '').trim();
    if (!featureKey) {
        throw new Error('缺少 featureKey');
    }
    const artifacts = loadFeatureArtifactsForAgent(context, featureKey);
    const { feature, graph, lookup } = artifacts;
    const nodes = graph.nodes || [];
    const endpoints = collectByType(nodes, 'endpoint', 20).map(node => compactNode(node, context.workspaceRoot));
    const requests = collectByType(nodes, 'request', 20).map(node => compactNode(node, context.workspaceRoot));
    const tables = collectByType(nodes, 'table', 20).map(node => compactNode(node, context.workspaceRoot));
    const externalServices = uniqBy(
        collectByType(nodes, 'external-service', 40).map(node => compactNode(node, context.workspaceRoot)),
        node => node.name
    ).slice(0, 20);
    const pageEntries = nodes
        .filter(node => node.type === 'method' && /(?:^|\/)app\/[^/]+\/page\.(tsx?|jsx?)$/i.test(toPosix(node.file || '')))
        .slice(0, 12)
        .map(node => compactNode(node, context.workspaceRoot));
    const coreMethods = [...nodes]
        .filter(node => node.type === 'method')
        .map(node => ({
            node,
            degree: (lookup.adjacency?.incoming?.[node.id] || []).length + (lookup.adjacency?.outgoing?.[node.id] || []).length,
        }))
        .sort((left, right) => right.degree - left.degree || left.node.name.localeCompare(right.node.name))
        .slice(0, 16)
        .map(item => compactNode(item.node, context.workspaceRoot));
    const dataFlows = summarizeFeatureDataFlows(graph, lookup, context.workspaceRoot);
    const riskPoints = inferRiskPoints({ endpoints, tables, externalServices, coreMethods });
    return {
        kind: 'agent-feature-card',
        workspaceRoot: context.workspaceRoot,
        dataRoot: context.dataRoot,
        feature: {
            featureKey: feature.featureKey,
            featureName: feature.featureName,
            summary: feature.summary || '',
            areas: feature.areas || [],
        },
        responsibility: feature.summary || `${feature.featureName} 功能模块，涉及 ${endpoints.length} 个 endpoint、${tables.length} 个数据模型、${externalServices.length} 个外部服务。`,
        pageEntries,
        apiEndpoints: endpoints,
        apiRequests: requests,
        coreMethods,
        prismaModels: tables,
        externalServices,
        mainDataFlows: dataFlows,
        editRiskPoints: riskPoints,
        validation: {
            recommendedCommands: inferValidationCommands(context.workspaceRoot, context, { features: [feature] }),
        },
        evidence: [
            ...endpoints.slice(0, 8).map(node => evidenceFromNode({ ...node, meta: node.meta || {} }, context.workspaceRoot, 'feature endpoint', 'high')),
            ...tables.slice(0, 8).map(node => ({ kind: 'node', nodeId: node.id, nodeType: node.type, name: node.name, file: node.file, line: node.line, confidence: 'high', reason: 'feature Prisma/table model' })),
            ...externalServices.slice(0, 8).map(node => ({ kind: 'node', nodeId: node.id, nodeType: node.type, name: node.name, file: node.file, line: node.line, confidence: 'high', reason: 'feature external service' })),
        ],
    };
}

function inferRiskPoints({ endpoints = [], tables = [], externalServices = [], coreMethods = [] }) {
    const risks = [];
    if (endpoints.length) {
        risks.push('修改 API route 时要同时验证前端 request 到 endpoint 的匹配链路。');
    }
    if (tables.some(table => (table.name || '').toLowerCase().includes('user') || (table.reads || table.writes))) {
        risks.push('涉及 Prisma model 时要关注读写语义、迁移兼容和数据回滚路径。');
    } else if (tables.length) {
        risks.push('涉及 Prisma model，建议验证 dataAccessSummary 和关键读写分支。');
    }
    if (externalServices.length) {
        risks.push(`涉及外部服务：${externalServices.map(item => item.name).join(', ')}，需要保留错误处理和凭据边界。`);
    }
    if (coreMethods.some(method => /auth|session|token|encrypt|decrypt/i.test(`${method.name} ${method.file}`))) {
        risks.push('链路包含鉴权、会话或加密逻辑，修改前后要额外复核安全边界。');
    }
    return risks.length ? risks : ['未发现明显高风险依赖；仍建议运行 feature KB 重建和相关测试。'];
}

function parseChangedFiles(options = {}) {
    const files = [];
    const add = value => {
        String(value || '')
            .split(/[\n,;]+/)
            .map(item => item.trim())
            .filter(Boolean)
            .forEach(item => files.push(item));
    };
    const addDiff = value => {
        const diffText = String(value || '');
        for (const line of diffText.split(/\r?\n/)) {
            const diffMatch = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
            if (diffMatch) {
                files.push(diffMatch[2]);
                continue;
            }
            const fileMatch = line.match(/^\+\+\+ b\/(.+)$/);
            if (fileMatch && fileMatch[1] !== '/dev/null') {
                files.push(fileMatch[1]);
            }
        }
    };
    if (Array.isArray(options.changedFiles)) {
        options.changedFiles.forEach(add);
    } else {
        add(options.changedFiles || '');
    }
    add(options.changedFile || '');
    addDiff(options.diff || '');
    if (options.diffFile) {
        addDiff(fs.readFileSync(options.diffFile, 'utf8'));
    }
    return uniq(files.map(file => toPosix(file).replace(/^["']|["']$/g, '').replace(/^b\//, '').replace(/^a\//, '')));
}

function nodeMatchesChangedFile(node, changedFile, workspaceRoot) {
    const nodeFile = normalizeText(workspaceRelative(workspaceRoot, node.file || ''));
    const changed = normalizeText(workspaceRelative(workspaceRoot, changedFile || ''));
    return Boolean(nodeFile && changed && (nodeFile === changed || nodeFile.endsWith(`/${changed}`) || changed.endsWith(`/${nodeFile}`)));
}

function featureMatchesChangedFile(feature, changedFile) {
    const changed = normalizeText(changedFile);
    if (!changed) {
        return false;
    }
    return (feature.methodRoots || []).some(root => isSpecificFeatureRoot(root) && featureRootMatchesFile(root, changed))
        || (feature.evidence || []).some(item => evidenceFileMatches(item.file, changed));
}

function inferRiskLevel(nodes = [], traversal = []) {
    const text = normalizeText([
        ...nodes.map(node => `${node.type} ${node.name} ${node.file}`),
        ...traversal.map(item => `${item.edge?.type} ${item.node?.type} ${item.node?.name}`),
    ].join(' '));
    if (/auth|token|password|secret|encrypt|decrypt|external-service|facebook|anthropic|payment|delete|writes/.test(text)) {
        return 'high';
    }
    if (/api\/|endpoint|route|prisma|table|write|update|create|upsert/.test(text)) {
        return 'medium';
    }
    return nodes.length ? 'low' : 'unknown';
}

function analyzeChangeImpact(options = {}) {
    const context = createWorkspaceContext({
        workspaceRoot: options.workspaceRoot,
        dataRoot: options.dataRoot,
        layout: options.layout,
    });
    const { graph, lookup } = loadProjectArtifacts(context);
    const changedFiles = parseChangedFiles(options);
    const matchedNodes = uniqBy(
        (graph.nodes || []).filter(node => changedFiles.some(file => nodeMatchesChangedFile(node, file, context.workspaceRoot))),
        node => node.id
    );
    const traversal = traverse(lookup, matchedNodes.map(node => node.id), { depth: options.depth || 3, directions: ['downstream', 'upstream'] });
    const relatedNodes = uniqBy([...matchedNodes, ...nodesFromTraversal(traversal)], node => node.id);
    const featureCatalog = makeFeatureCatalog(context);
    const relatedFiles = relatedNodes.map(node => workspaceRelative(context.workspaceRoot, node.file || '')).filter(Boolean);
    const affectedFeatures = featureCatalog
        .map(feature => {
            const direct = changedFiles.some(file => featureMatchesChangedFile(feature, file));
            const directScore = scoreFeature(feature, [], changedFiles);
            const relatedScore = Math.min(scoreFeature(feature, [], relatedFiles), 20);
            const score = (direct ? 100 : 0) + directScore + (direct ? 0 : relatedScore);
            return { feature, direct, score };
        })
        .filter(item => item.score > 0)
        .sort((left, right) => right.score - left.score || left.feature.featureKey.localeCompare(right.feature.featureKey))
        .slice(0, 12)
        .map(item => ({
            featureKey: item.feature.featureKey,
            featureName: item.feature.featureName,
            summary: item.feature.summary || '',
            confidence: item.direct ? 'high' : 'medium',
        }));
    const dataAccess = collectDataAccess(traversal, lookup, context.workspaceRoot);
    const riskLevel = inferRiskLevel(relatedNodes, traversal);
    return {
        kind: 'agent-change-impact',
        workspaceRoot: context.workspaceRoot,
        dataRoot: context.dataRoot,
        changedFiles,
        affectedFeatures,
        affectedEntrypoints: {
            endpoints: collectByType(relatedNodes, 'endpoint', 12).map(node => compactNode(node, context.workspaceRoot)),
            requests: collectByType(relatedNodes, 'request', 12).map(node => compactNode(node, context.workspaceRoot)),
            methods: collectByType(relatedNodes, 'method', 16).map(node => compactNode(node, context.workspaceRoot)),
        },
        affectedData: {
            tables: dataAccess.tables.length ? dataAccess.tables : collectByType(relatedNodes, 'table', 12).map(node => compactNode(node, context.workspaceRoot)),
        },
        affectedExternalServices: uniqBy(
            collectByType(relatedNodes, 'external-service', 24).map(node => compactNode(node, context.workspaceRoot)),
            node => node.name
        ).slice(0, 12),
        risk: {
            level: riskLevel,
            reasons: buildImpactReasons({ changedFiles, relatedNodes, dataAccess }),
        },
        reviewFocus: traversal
            .filter(item => ['calls', 'requests', 'matches_endpoint', 'binds', 'reads', 'writes', 'depends_on'].includes(item.edge?.type))
            .slice(0, 16)
            .map(item => compactEdge(item.edge, lookup, context.workspaceRoot)),
        validation: {
            recommendedCommands: inferValidationCommands(context.workspaceRoot, context, { features: affectedFeatures }),
            rebuildFeatureKb: affectedFeatures.length > 0,
            rebuildProjectKb: changedFiles.length > 0,
        },
        evidence: [
            ...matchedNodes.slice(0, 16).map(node => evidenceFromNode(node, context.workspaceRoot, 'changed file matched graph node', 'high')),
            ...dataAccess.evidence.slice(0, 8),
        ],
    };
}

function buildImpactReasons({ changedFiles, relatedNodes, dataAccess }) {
    const reasons = [];
    if (changedFiles.some(file => /(?:^|\/)app\/api\//.test(toPosix(file)))) {
        reasons.push('改动包含 Next.js API route，可能影响 endpoint、前端 request 和服务层链路。');
    }
    if (changedFiles.some(file => /(?:^|\/)app\/.+\/page\.(tsx?|jsx?)$/.test(toPosix(file)))) {
        reasons.push('改动包含 Next.js page，可能影响前端入口和 API client 调用。');
    }
    if (dataAccess.tables.length) {
        reasons.push(`链路涉及数据模型：${dataAccess.tables.map(table => table.name).join(', ')}。`);
    }
    const services = collectByType(relatedNodes, 'external-service', 8).map(node => node.name);
    if (services.length) {
        reasons.push(`链路涉及外部服务：${services.join(', ')}。`);
    }
    if (!reasons.length) {
        reasons.push('影响范围主要来自同文件和邻接调用链，未发现 API/数据/外部服务强风险信号。');
    }
    return reasons;
}

module.exports = {
    analyzeChangeImpact,
    explainFeatureForAgent,
    parseChangedFiles,
    prepareTaskContext,
};
