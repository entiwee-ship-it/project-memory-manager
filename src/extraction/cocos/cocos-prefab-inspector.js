const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CREATOR_ASSET_EXTENSIONS = new Set(['.prefab', '.scene']);
const IGNORED_ASSET_DIRECTORIES = new Set(['.git', 'build', 'library', 'node_modules', 'profiles', 'temp']);

function toPosix(value = '') {
    return String(value || '').replace(/\\/g, '/');
}

function normalizePath(value = '') {
    return toPosix(path.resolve(value)).toLowerCase();
}

function referenceIndex(value) {
    return value && Number.isInteger(value.__id__) ? value.__id__ : null;
}

function isSerializedNode(value) {
    return value?.__type__ === 'cc.Node' || value?.__type__ === 'cc.Scene';
}

function isWithinWorkspace(workspaceRoot, filePath) {
    const relative = path.relative(path.resolve(workspaceRoot), path.resolve(filePath));
    return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function assertCreatorAssetPath(workspaceRoot, filePath) {
    const resolvedRoot = path.resolve(workspaceRoot);
    const resolvedAssetsRoot = path.join(resolvedRoot, 'assets');
    const resolved = path.resolve(filePath);
    if (!isWithinWorkspace(resolvedRoot, resolved)) {
        const error = new Error(`Cocos 资源不在 workspaceRoot 内: ${resolved}`);
        error.code = 'COCOS_ASSET_OUTSIDE_WORKSPACE';
        throw error;
    }
    if (!CREATOR_ASSET_EXTENSIONS.has(path.extname(resolved).toLowerCase())) {
        const error = new Error(`只支持读取 .prefab 或 .scene: ${resolved}`);
        error.code = 'COCOS_ASSET_EXTENSION_UNSUPPORTED';
        throw error;
    }
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
        const error = new Error(`找不到 Cocos 资源: ${resolved}`);
        error.code = 'COCOS_ASSET_NOT_FOUND';
        throw error;
    }
    if (!fs.existsSync(resolvedAssetsRoot) || !fs.statSync(resolvedAssetsRoot).isDirectory()) {
        const error = new Error(`Creator 工程缺少 assets 目录: ${resolvedAssetsRoot}`);
        error.code = 'COCOS_ASSETS_ROOT_NOT_FOUND';
        throw error;
    }
    if (!isWithinWorkspace(resolvedAssetsRoot, resolved)) {
        const error = new Error(`Cocos 资源不在 workspaceRoot/assets 内: ${resolved}`);
        error.code = 'COCOS_ASSET_OUTSIDE_ASSETS';
        throw error;
    }
    const realRoot = fs.realpathSync.native(resolvedRoot);
    const realAssetsRoot = fs.realpathSync.native(resolvedAssetsRoot);
    const realFile = fs.realpathSync.native(resolved);
    if (!isWithinWorkspace(realRoot, realFile) || !isWithinWorkspace(realAssetsRoot, realFile)) {
        const error = new Error(`Cocos 资源真实路径不在 workspaceRoot 内: ${realFile}`);
        error.code = 'COCOS_ASSET_OUTSIDE_ASSETS';
        throw error;
    }
    return resolved;
}

function collectCreatorAssets(directory, output = []) {
    if (!fs.existsSync(directory)) {
        return output;
    }
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!IGNORED_ASSET_DIRECTORIES.has(entry.name.toLowerCase())) {
                collectCreatorAssets(path.join(directory, entry.name), output);
            }
            continue;
        }
        const filePath = path.join(directory, entry.name);
        if (entry.isFile() && CREATOR_ASSET_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
            output.push(filePath);
        }
    }
    return output;
}

function directAssetCandidates(workspaceRoot, query) {
    const normalized = toPosix(query).replace(/^db:\/\/assets\//i, 'assets/').replace(/^\/+/, '');
    const candidates = [];
    const add = value => {
        const resolved = path.resolve(workspaceRoot, value);
        if (!candidates.includes(resolved)) {
            candidates.push(resolved);
        }
    };
    if (CREATOR_ASSET_EXTENSIONS.has(path.extname(normalized).toLowerCase())) {
        add(normalized);
        if (!normalized.toLowerCase().startsWith('assets/')) {
            add(path.join('assets', normalized));
        }
    } else {
        for (const extension of CREATOR_ASSET_EXTENSIONS) {
            add(`${normalized}${extension}`);
            add(path.join('assets', `${normalized}${extension}`));
        }
    }
    return candidates;
}

function scoreAssetCandidate(filePath, query) {
    const normalizedQuery = toPosix(query)
        .replace(/^db:\/\/assets\//i, '')
        .replace(/\.(prefab|scene)$/i, '')
        .replace(/^assets\//i, '')
        .toLowerCase();
    const relative = toPosix(filePath).toLowerCase();
    const basename = path.basename(filePath, path.extname(filePath)).toLowerCase();
    if (basename === normalizedQuery) {
        return 100;
    }
    if (relative.endsWith(`/${normalizedQuery}.prefab`) || relative.endsWith(`/${normalizedQuery}.scene`)) {
        return 90;
    }
    if (relative.includes(normalizedQuery)) {
        return 50;
    }
    return 0;
}

function resolveCocosAssetPath(workspaceRoot, assetQuery) {
    const root = path.resolve(workspaceRoot || '');
    const query = String(assetQuery || '').trim();
    if (!query) {
        const error = new Error('prepare_cocos_edit_brief 需要 prefab');
        error.code = 'COCOS_ASSET_QUERY_REQUIRED';
        throw error;
    }

    if (path.isAbsolute(query)) {
        return assertCreatorAssetPath(root, query);
    }
    for (const candidate of directAssetCandidates(root, query)) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return assertCreatorAssetPath(root, candidate);
        }
    }

    const candidates = collectCreatorAssets(path.join(root, 'assets'))
        .map(filePath => ({ filePath, score: scoreAssetCandidate(filePath, query) }))
        .filter(item => item.score > 0)
        .sort((left, right) => right.score - left.score || left.filePath.localeCompare(right.filePath));
    if (!candidates.length) {
        const error = new Error(`在 assets 下找不到 Cocos 资源: ${query}`);
        error.code = 'COCOS_ASSET_NOT_FOUND';
        throw error;
    }
    const topScore = candidates[0].score;
    const top = candidates.filter(item => item.score === topScore);
    if (top.length > 1) {
        const error = new Error(`Cocos 资源名称不唯一: ${query}`);
        error.code = 'COCOS_ASSET_AMBIGUOUS';
        error.candidates = top.slice(0, 12).map(item => toPosix(path.relative(root, item.filePath)));
        throw error;
    }
    return assertCreatorAssetPath(root, top[0].filePath);
}

function assetDbUrl(workspaceRoot, filePath) {
    const relative = toPosix(path.relative(path.resolve(workspaceRoot), path.resolve(filePath)));
    if (!relative.toLowerCase().startsWith('assets/')) {
        return '';
    }
    return `db://${relative}`;
}

function componentNameFromNode(node) {
    const name = String(node?.name || '');
    const at = name.indexOf('@');
    return at >= 0 ? name.slice(0, at) : name.replace(/\.ts$/i, '');
}

function buildBaseComponentMappings(graph, prefabPath = '') {
    const normalizedPrefab = normalizePath(prefabPath);
    const candidates = (graph?.nodes || [])
        .filter(node => node.type === 'component' && node.meta?.rawType)
        .map(node => ({
            rawType: String(node.meta.rawType),
            componentName: componentNameFromNode(node),
            scriptPath: /\.[cm]?[jt]sx?$/i.test(node.file || '') ? toPosix(node.file) : '',
            nodePath: node.meta.nodePath || '',
            prefabPath: node.meta.prefabPath || '',
            exactPrefab: normalizedPrefab && normalizePath(node.meta.prefabPath || '') === normalizedPrefab,
        }))
        .sort((left, right) => Number(right.exactPrefab) - Number(left.exactPrefab));
    const mappings = new Map();
    for (const candidate of candidates) {
        if (!mappings.has(candidate.rawType)) {
            mappings.set(candidate.rawType, candidate);
        }
    }
    return mappings;
}

function isKnownEngineComponent(rawType = '') {
    return /^(?:cc|sp|dragonBones)\./.test(rawType);
}

function resolveNodePathFromReference(value, nodePathByIndex) {
    const index = referenceIndex(value);
    return index == null ? '' : (nodePathByIndex.get(index) || '');
}

function extractHandler(value) {
    const handler = value?.handler ?? value?._handler;
    return typeof handler === 'string' ? handler.trim() : '';
}

function collectComponentEvents({
    documents,
    component,
    componentIndex,
    ownerNodePath,
    componentName,
    nodePathByIndex,
    componentIndexes,
    componentMappings,
}) {
    const events = [];
    const visitedReferences = new Set();
    const seen = new Set();

    const visit = (value, propertyPath, depth) => {
        if (depth > 6 || value == null) {
            return;
        }
        if (Array.isArray(value)) {
            value.forEach((item, index) => visit(item, `${propertyPath}[${index}]`, depth + 1));
            return;
        }
        if (typeof value !== 'object') {
            return;
        }

        const referencedIndex = referenceIndex(value);
        if (referencedIndex != null) {
            if (visitedReferences.has(referencedIndex)) {
                return;
            }
            visitedReferences.add(referencedIndex);
            const referenced = documents[referencedIndex];
            if (!referenced || isSerializedNode(referenced)) {
                return;
            }
            if (componentIndexes.has(referencedIndex) && referencedIndex !== componentIndex && !extractHandler(referenced)) {
                return;
            }
            visit(referenced, propertyPath, depth + 1);
            return;
        }

        const handler = extractHandler(value);
        if (handler) {
            const componentRawType = String(value._componentId || value.component || value._component || '');
            const targetNodePath = resolveNodePathFromReference(value.target || value._target, nodePathByIndex);
            const mapping = componentMappings.get(componentRawType);
            const event = {
                ownerNodePath,
                ownerComponent: componentName,
                sourceField: propertyPath,
                eventType: String(value.__type__ || ''),
                handler,
                targetNodePath,
                targetComponent: mapping?.componentName || componentRawType,
                targetComponentRawType: componentRawType,
                customEventData: value.customEventData ?? value._customEventData ?? '',
            };
            const key = JSON.stringify(event);
            if (!seen.has(key)) {
                seen.add(key);
                events.push(event);
            }
        }

        for (const [key, nested] of Object.entries(value)) {
            if (['__type__', 'node', '_node', '__prefab', '_prefab', 'target', '_target'].includes(key)) {
                continue;
            }
            visit(nested, propertyPath ? `${propertyPath}.${key}` : key, depth + 1);
        }
    };

    for (const [key, value] of Object.entries(component || {})) {
        if (['__type__', 'node', '_node', '__prefab', '_prefab'].includes(key)) {
            continue;
        }
        visit(value, key, 0);
    }
    return events;
}

function explicitRootIndexes(documents) {
    const roots = [];
    for (const object of documents) {
        if (object?.__type__ === 'cc.Prefab') {
            const index = referenceIndex(object.data);
            if (index != null) {
                roots.push(index);
            }
        }
        if (object?.__type__ === 'cc.SceneAsset') {
            const index = referenceIndex(object.scene);
            if (index != null) {
                roots.push(index);
            }
        }
    }
    return Array.from(new Set(roots));
}

function buildNodeIndex(documents) {
    const nodeIndexes = documents
        .map((value, index) => isSerializedNode(value) ? index : -1)
        .filter(index => index >= 0);
    const parentByChild = new Map();
    const componentIndexes = new Set();
    for (const nodeIndex of nodeIndexes) {
        const node = documents[nodeIndex];
        for (const child of node._children || []) {
            const childIndex = referenceIndex(child);
            if (childIndex != null) {
                parentByChild.set(childIndex, nodeIndex);
            }
        }
        for (const component of node._components || []) {
            const componentIndex = referenceIndex(component);
            if (componentIndex != null) {
                componentIndexes.add(componentIndex);
            }
        }
    }
    const explicitRoots = explicitRootIndexes(documents).filter(index => nodeIndexes.includes(index));
    const rootIndexes = Array.from(new Set([
        ...explicitRoots,
        ...nodeIndexes.filter(index => !parentByChild.has(index)),
    ]));
    return { nodeIndexes, parentByChild, componentIndexes, rootIndexes };
}

function inspectNestedPrefabs(documents, nodePathByIndex) {
    const nested = [];
    for (let prefabInfoIndex = 0; prefabInfoIndex < documents.length; prefabInfoIndex += 1) {
        const prefabInfo = documents[prefabInfoIndex];
        if (prefabInfo?.__type__ !== 'cc.PrefabInfo') {
            continue;
        }
        const instanceIndex = referenceIndex(prefabInfo.instance);
        const rootNodeIndex = referenceIndex(prefabInfo.root);
        if (
            instanceIndex == null
            || rootNodeIndex == null
            || !isSerializedNode(documents[rootNodeIndex])
            || documents[instanceIndex]?.__type__ !== 'cc.PrefabInstance'
        ) {
            continue;
        }
        const instance = documents[instanceIndex];
        nested.push({
            prefabInfoIndex,
            instanceIndex,
            rootNodeIndex,
            nodePath: rootNodeIndex == null ? '' : (nodePathByIndex.get(rootNodeIndex) || ''),
            prefabAssetUuid: String(prefabInfo.asset?.__uuid__ || ''),
            fileId: String(instance.fileId || prefabInfo.fileId || ''),
            propertyOverrideCount: Array.isArray(instance.propertyOverrides) ? instance.propertyOverrides.length : 0,
            mountedChildCount: Array.isArray(instance.mountedChildren) ? instance.mountedChildren.length : 0,
            mountedComponentCount: Array.isArray(instance.mountedComponents) ? instance.mountedComponents.length : 0,
            requiresCreatorResolution: true,
        });
    }
    return nested;
}

function inspectCocosDocuments(documents, options = {}) {
    if (!Array.isArray(documents)) {
        const error = new Error('Cocos 序列化资源必须是 JSON 数组。');
        error.code = 'COCOS_ASSET_FORMAT_UNSUPPORTED';
        throw error;
    }
    const componentMappings = options.componentMappings instanceof Map
        ? options.componentMappings
        : new Map();
    const { nodeIndexes, componentIndexes, rootIndexes } = buildNodeIndex(documents);
    const nodePathByIndex = new Map();
    const orderedNodeIndexes = [];
    const visiting = new Set();

    const visitNode = (nodeIndex, parentPath = '') => {
        if (visiting.has(nodeIndex) || nodePathByIndex.has(nodeIndex)) {
            return;
        }
        const node = documents[nodeIndex];
        if (!isSerializedNode(node)) {
            return;
        }
        visiting.add(nodeIndex);
        const name = String(node._name || (node.__type__ === 'cc.Scene' ? 'Scene' : `Node#${nodeIndex}`));
        const nodePath = parentPath ? `${parentPath}/${name}` : name;
        nodePathByIndex.set(nodeIndex, nodePath);
        orderedNodeIndexes.push(nodeIndex);
        for (const child of node._children || []) {
            const childIndex = referenceIndex(child);
            if (childIndex != null) {
                visitNode(childIndex, nodePath);
            }
        }
        visiting.delete(nodeIndex);
    };
    rootIndexes.forEach(index => visitNode(index));
    nodeIndexes.forEach(index => visitNode(index));
    const unresolvedNestedPrefabs = inspectNestedPrefabs(documents, nodePathByIndex);
    const partial = unresolvedNestedPrefabs.length > 0;

    const components = [];
    const events = [];
    const nodes = orderedNodeIndexes.map(nodeIndex => {
        const node = documents[nodeIndex];
        const nodePath = nodePathByIndex.get(nodeIndex);
        const nodeComponents = [];
        for (const componentReference of node._components || []) {
            const componentIndex = referenceIndex(componentReference);
            const component = componentIndex == null ? null : documents[componentIndex];
            if (!component || typeof component !== 'object') {
                continue;
            }
            const rawType = String(component.__type__ || '');
            const mapping = componentMappings.get(rawType);
            const componentName = mapping?.componentName || rawType || `Component#${componentIndex}`;
            const componentEvents = collectComponentEvents({
                documents,
                component,
                componentIndex,
                ownerNodePath: nodePath,
                componentName,
                nodePathByIndex,
                componentIndexes,
                componentMappings,
            });
            const summary = {
                index: componentIndex,
                nodePath,
                rawType,
                componentName,
                componentKind: isKnownEngineComponent(rawType) ? 'engine' : 'custom-script',
                scriptPath: mapping?.scriptPath || '',
                events: componentEvents,
            };
            nodeComponents.push(summary);
            components.push(summary);
            events.push(...componentEvents);
        }
        return {
            index: nodeIndex,
            name: String(node._name || ''),
            path: nodePath,
            active: node._active !== false,
            components: nodeComponents,
        };
    });

    const queries = Array.isArray(options.nodeQueries) ? options.nodeQueries : [];
    const queryResults = queries.map(query => {
        const normalizedQuery = String(query || '').trim().toLowerCase();
        const exactMatches = normalizedQuery
            ? nodes.filter(node => node.path.toLowerCase() === normalizedQuery || node.name.toLowerCase() === normalizedQuery)
            : [];
        const matches = exactMatches.length
            ? exactMatches
            : (normalizedQuery
                ? nodes.filter(node => node.path.toLowerCase().includes(normalizedQuery))
                : []);
        return {
            query: String(query || ''),
            status: matches.length ? 'matched' : (partial ? 'creator_resolution_required' : 'not_found'),
            scope: 'local-serialized-document',
            requiresCreatorResolution: !matches.length && partial,
            matches,
        };
    });

    const mappings = Array.from(new Set(components.map(component => component.rawType)))
        .filter(rawType => rawType && !isKnownEngineComponent(rawType))
        .map(rawType => {
            const mapping = componentMappings.get(rawType);
            return {
                rawType,
                componentName: mapping?.componentName || rawType,
                scriptPath: mapping?.scriptPath || '',
                mapped: Boolean(mapping),
                fromTargetPrefab: Boolean(mapping?.exactPrefab),
            };
        });

    return {
        objectCount: documents.length,
        nodeCount: nodes.length,
        componentCount: components.length,
        eventCount: events.length,
        partial,
        limitations: partial
            ? ['检测到嵌套 Prefab 实例；离线解析仅覆盖当前文件中序列化的本地节点、挂载项与 override，实例内部层级必须由 Creator 现场解析。']
            : [],
        unresolvedNestedPrefabs,
        rootNodes: rootIndexes.map(index => nodePathByIndex.get(index)).filter(Boolean),
        nodes,
        components,
        events,
        queryResults,
        componentMappings: mappings,
    };
}

function inspectCocosPrefab(options = {}) {
    const workspaceRoot = path.resolve(options.workspaceRoot || '');
    const filePath = options.filePath
        ? assertCreatorAssetPath(workspaceRoot, options.filePath)
        : resolveCocosAssetPath(workspaceRoot, options.prefab || options.asset);
    const bytes = fs.readFileSync(filePath);
    let documents;
    try {
        documents = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
    } catch (error) {
        const diagnostic = new Error(`解析 Cocos 资源失败: ${filePath}: ${error.message}`);
        diagnostic.code = 'COCOS_ASSET_PARSE_FAILED';
        throw diagnostic;
    }
    const componentMappings = buildBaseComponentMappings(options.graph, filePath);
    const inspection = inspectCocosDocuments(documents, {
        componentMappings,
        nodeQueries: options.nodeQueries,
    });
    return {
        kind: 'cocos-prefab-live-inspection',
        workspaceRoot: toPosix(workspaceRoot),
        filePath: toPosix(filePath),
        relativePath: toPosix(path.relative(workspaceRoot, filePath)),
        assetUrl: assetDbUrl(workspaceRoot, filePath),
        sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
        ...inspection,
    };
}

module.exports = {
    assetDbUrl,
    buildBaseComponentMappings,
    inspectCocosDocuments,
    inspectCocosPrefab,
    resolveCocosAssetPath,
};
