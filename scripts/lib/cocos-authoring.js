const fs = require('fs');
const path = require('path');
const { normalize, pathExists, readJson, resolveProjectRoot, timestamp, writeJson } = require('./common');
const { loadFeatureLookupArtifacts, normalizeFeatureRecord } = require('./feature-kb');
const { loadSkillVersion } = require('../show_skill_version');

function normalizeText(value) {
    return String(value || '').trim().toLowerCase();
}

function matchContains(value, query) {
    return normalizeText(value).includes(normalizeText(query));
}

function unique(values) {
    return Array.from(new Set((values || []).filter(Boolean)));
}

function ensureArray(value) {
    return Array.isArray(value) ? value : [];
}

function createAuthoringError(message, details = {}) {
    const error = new Error(message);
    error.isAuthoringError = true;
    Object.assign(error, details);
    return error;
}

function slugifyValue(value = '') {
    return String(value || '')
        .trim()
        .replace(/[^\w.-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase();
}

function loadCurrentSkillBuildInfo() {
    try {
        const versionInfo = loadSkillVersion(path.resolve(__dirname, '..', '..'));
        return {
            name: versionInfo.name || '',
            version: versionInfo.version || '',
            repo: versionInfo.repo || '',
            capabilities: Array.isArray(versionInfo.capabilities) ? versionInfo.capabilities : [],
        };
    } catch {
        return {
            name: 'project-memory-manager',
            version: '',
            repo: '',
            capabilities: [],
        };
    }
}

function isBuiltWithCurrentSkill(record = {}) {
    const current = loadCurrentSkillBuildInfo();
    return Boolean(current.version && record?.builtWithSkill?.version && current.version === record.builtWithSkill.version);
}

function loadFeatureArtifacts(root, featureKey) {
    const resolvedRoot = resolveProjectRoot(root || process.cwd());
    const registryPath = path.join(resolvedRoot, 'project-memory', 'state', 'feature-registry.json');
    const registry = readJson(registryPath);
    const featureRecord = (registry.features || [])
        .map(item => normalizeFeatureRecord(item))
        .find(item => item.featureKey === featureKey);
    if (!featureRecord) {
        throw new Error(`注册表中未找到功能: ${featureKey}`);
    }

    const { feature, graph, lookup } = loadFeatureLookupArtifacts(resolvedRoot, featureRecord);
    const scanPath = path.resolve(resolvedRoot, feature.outputs?.scan || path.join(feature.kbDir, 'scan.raw.json'));
    const reportPath = path.resolve(resolvedRoot, feature.outputs?.report || path.join(feature.kbDir, 'build.report.json'));
    return {
        root: resolvedRoot,
        feature,
        graph,
        lookup,
        scanPath,
        reportPath,
        scan: fs.existsSync(scanPath) ? readJson(scanPath) : { prefabs: [], scripts: [] },
        report: fs.existsSync(reportPath) ? readJson(reportPath) : null,
    };
}

function basenameNoExt(filePath = '') {
    return path.basename(String(filePath || ''), path.extname(String(filePath || '')));
}

function buildScriptCatalog(scan = {}) {
    const byComponentName = new Map();
    const byPath = new Map();

    for (const script of scan.scripts || []) {
        const componentNames = unique([
            basenameNoExt(script.scriptPath),
            ...(script.exports || [])
                .filter(item => item.kind === 'class')
                .map(item => item.name),
        ]);
        const record = {
            ...script,
            componentNames,
        };
        byPath.set(script.scriptPath, record);
        for (const componentName of componentNames) {
            byComponentName.set(componentName, record);
        }
    }

    return {
        byComponentName,
        byPath,
        scripts: Array.from(byPath.values()),
    };
}

function findPrefab(scan = {}, query = '') {
    const prefabs = scan.prefabs || [];
    if (!query) {
        return prefabs[0] || null;
    }

    const exact = prefabs.find(prefab => {
        const prefabName = basenameNoExt(prefab.prefabPath);
        return prefab.prefabPath === query || prefabName === query;
    });
    if (exact) {
        return exact;
    }

    return prefabs.find(prefab => matchContains(prefab.prefabPath, query) || matchContains(basenameNoExt(prefab.prefabPath), query)) || null;
}

function findPrefabCandidates(scan = {}, query = '', limit = 5) {
    const matched = (scan.prefabs || [])
        .filter(prefab => !query || matchContains(prefab.prefabPath, query) || matchContains(basenameNoExt(prefab.prefabPath), query));
    const source = matched.length > 0 ? matched : (scan.prefabs || []);
    return source.slice(0, limit).map(prefab => basenameNoExt(prefab.prefabPath));
}

function findNodeInfo(prefab, nodePath = '') {
    if (!prefab || !nodePath) {
        return null;
    }
    return (prefab.keyNodes || []).find(node => node.path === nodePath)
        || (prefab.bindingFacts?.fieldBindings || []).find(item => item.nodePath === nodePath)
        || null;
}

function findPrefabComponent(prefab, componentQuery = '', nodePath = '') {
    const components = prefab?.customComponents || [];
    const scoped = nodePath ? components.filter(item => item.nodePath === nodePath) : components;
    if (!componentQuery) {
        return scoped[0] || null;
    }

    const exact = scoped.find(item => item.componentName === componentQuery || item.scriptPath === componentQuery);
    if (exact) {
        return exact;
    }

    return scoped.find(item =>
        matchContains(item.componentName, componentQuery)
        || matchContains(item.scriptPath, componentQuery)
        || matchContains(basenameNoExt(item.scriptPath), componentQuery)
    ) || null;
}

function findScriptCandidate(scriptCatalog, componentQuery = '') {
    if (!componentQuery) {
        return null;
    }
    const exact = scriptCatalog.byComponentName.get(componentQuery) || scriptCatalog.byPath.get(componentQuery);
    if (exact) {
        return exact;
    }
    return scriptCatalog.scripts.find(script =>
        script.componentNames.some(name => matchContains(name, componentQuery))
        || matchContains(script.scriptPath, componentQuery)
    ) || null;
}

function findScriptCandidates(scriptCatalog, componentQuery = '', limit = 5) {
    const matched = (scriptCatalog.scripts || [])
        .filter(script =>
            !componentQuery
            || script.componentNames.some(name => matchContains(name, componentQuery))
            || matchContains(script.scriptPath, componentQuery)
        );
    const source = matched.length > 0 ? matched : (scriptCatalog.scripts || []);
    return source.slice(0, limit).map(script => script.componentNames[0] || basenameNoExt(script.scriptPath));
}

function findFieldDefinition(scriptRecord, fieldName = '') {
    if (!scriptRecord || !fieldName) {
        return null;
    }
    return (scriptRecord.fieldTypes || []).find(item => item.fieldName === fieldName)
        || (scriptRecord.fieldTypes || []).find(item => matchContains(item.fieldName, fieldName))
        || null;
}

function findFieldCandidates(scriptRecord, fieldName = '', limit = 8) {
    const matched = (scriptRecord?.fieldTypes || [])
        .filter(item => !fieldName || matchContains(item.fieldName, fieldName));
    const source = matched.length > 0 ? matched : (scriptRecord?.fieldTypes || []);
    return source.slice(0, limit).map(item => item.fieldName);
}

function inferBindableFieldKind(fieldDef) {
    const baseType = String(fieldDef?.baseType || '').trim();
    const primitiveTypes = new Set(['number', 'string', 'boolean']);
    const builtInComponentTypes = new Set([
        'Button',
        'Toggle',
        'Label',
        'Sprite',
        'Animation',
        'EditBox',
        'ScrollView',
        'UITransform',
        'RichText',
        'ProgressBar',
        'Slider',
    ]);
    if (!baseType) {
        return 'unknown';
    }
    if (primitiveTypes.has(baseType.toLowerCase())) {
        return 'primitive';
    }
    if (baseType === 'Node') {
        return 'node';
    }
    if (['Prefab', 'SpriteFrame', 'AudioClip', 'JsonAsset', 'Texture2D', 'SpriteAtlas', 'ImageAsset'].includes(baseType)) {
        return 'asset';
    }
    if (builtInComponentTypes.has(baseType)) {
        return 'component';
    }
    if (fieldDef?.sourcePath) {
        return 'component';
    }
    return 'unknown';
}

function inferEventConventions(prefab, authoringFeatureProfile = null) {
    const clickEvents = (prefab?.events || []).filter(item => item.sourceKind === 'clickEvents');
    const targetNodes = unique(clickEvents.map(item => item.targetNodePath));
    const targetComponents = unique(clickEvents.map(item => item.targetComponentName));
    const learnedPatterns = (authoringFeatureProfile?.eventPatterns || []).filter(item => item.sourceKind === 'clickEvents');
    const bestPattern = learnedPatterns[0] || null;
    return {
        existingClickEvents: clickEvents,
        recommendedTargetNodePath: targetNodes[0] || bestPattern?.targetNodePath || null,
        recommendedTargetComponentName: targetComponents[0] || bestPattern?.targetComponentName || null,
        learnedPatterns,
    };
}

function inferNodeRole(nodePath = '', nestedPrefabPath = '') {
    if (nestedPrefabPath) {
        return 'nested-root';
    }
    if (!String(nodePath || '').includes('/')) {
        return 'root';
    }
    return 'child';
}

function inferPreferredComponentNodePath(prefab, componentName, authoringFeatureProfile = null) {
    const existing = findPrefabComponent(prefab, componentName);
    if (existing?.nodePath) {
        return existing.nodePath;
    }

    const patterns = (authoringFeatureProfile?.componentPlacementPatterns || []).filter(item => item.componentName === componentName);
    const bestPattern = patterns[0] || null;
    if (!bestPattern) {
        return findRootNodePath(prefab);
    }
    if (bestPattern.preferredNodePath) {
        return bestPattern.preferredNodePath;
    }
    if (bestPattern.nodeRole === 'root') {
        return findRootNodePath(prefab);
    }
    const matchingNode = (prefab.keyNodes || []).find(node => inferNodeRole(node.path, node.nestedPrefabPath) === bestPattern.nodeRole);
    return matchingNode?.path || findRootNodePath(prefab);
}

function hasButtonLikeComponent(prefab, nodePath = '') {
    const keyNode = (prefab?.keyNodes || []).find(item => item.path === nodePath);
    return Boolean((keyNode?.components || []).some(component => component.name === 'cc.Button'));
}

function findAssetCandidate(graph, query = '') {
    if (!query) {
        return null;
    }
    const assets = (graph?.nodes || []).filter(node => node.type === 'asset');
    return assets.find(node => node.name === query || node.meta?.assetPath === query)
        || assets.find(node =>
            matchContains(node.name, query)
            || matchContains(node.meta?.assetPath, query)
            || matchContains(node.meta?.assetKind, query)
        )
        || null;
}

function findAssetCandidates(graph, query = '', limit = 8) {
    const matched = (graph?.nodes || [])
        .filter(node => node.type === 'asset')
        .filter(node =>
            !query
            || matchContains(node.name, query)
            || matchContains(node.meta?.assetPath, query)
            || matchContains(node.meta?.assetKind, query)
        );
    const source = matched.length > 0
        ? matched
        : (graph?.nodes || []).filter(node => node.type === 'asset');
    return source.slice(0, limit)
        .map(node => ({
            name: node.name,
            assetKind: node.meta?.assetKind || '',
            assetPath: node.meta?.assetPath || node.file || '',
        }));
}

function getRelevantFieldBindingPatterns(authoringFeatureProfile = null, componentName = '', fieldName = '') {
    return (authoringFeatureProfile?.fieldBindingPatterns || [])
        .filter(item => item.componentName === componentName && item.field === fieldName)
        .sort((left, right) => right.count - left.count || right.confidence - left.confidence);
}

function getRelevantAssetPatterns(authoringFeatureProfile = null, assetKind = '') {
    return (authoringFeatureProfile?.assetPatterns || [])
        .filter(item => !assetKind || item.assetKind === assetKind)
        .sort((left, right) => right.count - left.count || right.confidence - left.confidence);
}

function findAssetCandidatesForField(artifacts, query = '', fieldDef = null, authoringFeatureProfile = null, limit = 8) {
    const preferredAssetKind = String(fieldDef?.baseType || '');
    const preferredDirectories = getRelevantAssetPatterns(authoringFeatureProfile, preferredAssetKind)
        .map(item => normalize(item.directory))
        .filter(Boolean);
    const candidates = findAssetCandidates(artifacts.graph, query, Math.max(limit * 3, limit));

    return candidates
        .map(candidate => {
            let score = 0;
            const candidatePath = normalize(candidate.assetPath || '');
            if (preferredAssetKind && candidate.assetKind === preferredAssetKind) {
                score += 6;
            }
            if (preferredDirectories.some(directory => candidatePath.startsWith(directory))) {
                score += 4;
            }
            if (query && (matchContains(candidate.name, query) || matchContains(candidate.assetPath, query))) {
                score += 3;
            }
            return {
                ...candidate,
                _score: score,
            };
        })
        .sort((left, right) =>
            right._score - left._score
            || left.name.localeCompare(right.name)
            || left.assetPath.localeCompare(right.assetPath)
        )
        .slice(0, limit)
        .map(candidate => {
            const { _score, ...rest } = candidate;
            return rest;
        });
}

function summarizeFieldDef(fieldDef) {
    if (!fieldDef) {
        return null;
    }
    return {
        fieldName: fieldDef.fieldName,
        rawType: fieldDef.rawType,
        baseType: fieldDef.baseType,
        sourcePath: fieldDef.sourcePath || null,
        bindingKind: inferBindableFieldKind(fieldDef),
    };
}

function buildAttachComponentPlan({ prefab, nodePath, componentName, scriptRecord, existingComponent }) {
    return {
        kind: 'attach-component',
        status: existingComponent ? 'already-satisfied' : 'required',
        prefabPath: prefab.prefabPath,
        nodePath,
        componentName,
        scriptPath: scriptRecord?.scriptPath || existingComponent?.scriptPath || null,
        editTarget: 'prefab-component-list',
        applyVia: 'attach-script-to-node',
        why: existingComponent
            ? '目标节点上已经有这个脚本组件。'
            : '为了让节点拥有新的交互或字段绑定能力，必须先把脚本组件挂到目标节点上。',
    };
}

function buildAddMethodPlan({ scriptRecord, handlerName, exists }) {
    return {
        kind: 'add-method',
        status: exists ? 'already-satisfied' : 'required',
        scriptPath: scriptRecord?.scriptPath || null,
        handlerName,
        editTarget: 'script',
        applyVia: 'typescript-method',
        why: exists
            ? '脚本里已经存在这个 handler。'
            : '按钮事件最终要落到脚本方法上，所以需要先在目标脚本里声明 handler。',
    };
}

function buildEventBindingPlan({ prefab, sourceNodePath, targetNodePath, componentName, handlerName, sourceHasButton, existingEvent, conventions }) {
    return {
        kind: 'bind-event',
        status: existingEvent ? 'already-satisfied' : 'required',
        prefabPath: prefab.prefabPath,
        sourceNodePath,
        targetNodePath,
        targetComponentName: componentName,
        handlerName,
        sourceComponent: 'cc.Button',
        editTarget: 'prefab-event-binding',
        applyVia: 'clickEvents',
        requiresButton: !sourceHasButton,
        why: existingEvent
            ? '这个 clickEvents 绑定已经存在。'
            : '新增点击功能时，需要在 Button.clickEvents 里写入 target / component / handler。',
        learnedFromProject: conventions.existingClickEvents.length > 0
            ? `项目里现有 clickEvents 常见目标是 ${conventions.recommendedTargetComponentName || conventions.recommendedTargetNodePath || '已有处理组件'}。`
            : '当前 prefab 里没有现成 clickEvents 样本，采用通用 Cocos 绑定方式规划。',
    };
}

function buildFieldBindingPlan({ prefab, componentNodePath, componentName, fieldDef, targetNodePath, targetComponentName, targetAsset, existingBinding }) {
    const bindingKind = inferBindableFieldKind(fieldDef);
    return {
        kind: 'bind-field',
        status: existingBinding ? 'already-satisfied' : 'required',
        prefabPath: prefab.prefabPath,
        componentNodePath,
        componentName,
        field: fieldDef?.fieldName || '',
        fieldType: fieldDef?.rawType || '',
        bindingKind,
        editTarget: 'prefab-field',
        applyVia: 'serialized-field',
        targetNodePath: targetNodePath || null,
        targetComponentName: targetComponentName || null,
        targetAsset: targetAsset
            ? {
                name: targetAsset.name,
                assetPath: targetAsset.meta?.assetPath || targetAsset.file || '',
                assetKind: targetAsset.meta?.assetKind || '',
            }
            : null,
        why: existingBinding
            ? '这个字段已经绑定到了目标对象。'
            : '脚本字段的节点 / 组件 / 资源引用最终都要写入 prefab 的 serialized field。',
        learnedFromProject: null,
    };
}

function summarizeFieldBindingConvention(componentName, fieldName, fieldPatterns = [], assetPatterns = []) {
    const bestFieldPattern = fieldPatterns[0] || null;
    const bestAssetPattern = assetPatterns[0] || null;
    if (!bestFieldPattern && bestAssetPattern) {
        return `项目里同类 ${bestAssetPattern.assetKind} 资源通常来自 ${bestAssetPattern.directory}。`;
    }
    if (!bestFieldPattern) {
        return '';
    }
    if (bestFieldPattern.bindingKind === 'asset') {
        const directoryHint = bestAssetPattern?.directory ? `，资源通常来自 ${bestAssetPattern.directory}` : '';
        return `项目里 ${componentName}.${fieldName} 常见绑定是资源引用${directoryHint}。`;
    }
    const evidence = bestFieldPattern.evidence?.[0] || null;
    if (bestFieldPattern.bindingKind === 'node') {
        return `项目里 ${componentName}.${fieldName} 常见绑定到节点${evidence?.targetNodePath ? ` ${evidence.targetNodePath}` : ''}。`;
    }
    if (bestFieldPattern.bindingKind === 'component') {
        return `项目里 ${componentName}.${fieldName} 常见绑定到组件${evidence?.targetComponentName ? ` ${evidence.targetComponentName}` : ''}。`;
    }
    return `项目里 ${componentName}.${fieldName} 常见绑定方式是 ${bestFieldPattern.bindingKind}。`;
}

function findExistingEvent(prefab, sourceNodePath, componentName, handlerName) {
    return (prefab?.events || []).find(item =>
        item.sourceNodePath === sourceNodePath
        && item.targetComponentName === componentName
        && item.handler === handlerName
    ) || null;
}

function findExistingFieldBinding(prefab, componentName, nodePath, fieldName, targetQuery = '') {
    return (prefab?.bindingFacts?.fieldBindings || []).find(item => {
        const matchesOwner = item.componentName === componentName && item.nodePath === nodePath && item.field === fieldName;
        if (!matchesOwner) {
            return false;
        }
        if (!targetQuery) {
            return true;
        }
        return (
            matchContains(item.binding?.targetNodePath, targetQuery)
            || matchContains(item.binding?.targetComponentName, targetQuery)
            || matchContains(item.binding?.assetPath, targetQuery)
            || matchContains(item.value?.nodePath, targetQuery)
            || matchContains(item.value?.componentName, targetQuery)
            || matchContains(item.value?.assetPath, targetQuery)
        );
    }) || null;
}

function findRootNodePath(prefab) {
    const rootCandidate = (prefab?.keyNodes || []).find(item => !String(item.path || '').includes('/'));
    if (rootCandidate) {
        return rootCandidate.path;
    }
    const firstComponent = prefab?.customComponents?.[0];
    return firstComponent?.nodePath || prefab?.keyNodes?.[0]?.path || '';
}

function readScriptUuid(scriptPath = '') {
    const metaPath = `${scriptPath}.meta`;
    if (!scriptPath || !fs.existsSync(metaPath)) {
        return '';
    }
    try {
        return readJson(metaPath).uuid || '';
    } catch {
        return '';
    }
}

function buildPrefabScriptUuidCatalog(scan = {}) {
    const byUuid = new Map();
    for (const script of scan.scripts || []) {
        const uuid = readScriptUuid(script.scriptPath);
        if (!uuid) {
            continue;
        }
        byUuid.set(uuid, {
            scriptPath: script.scriptPath,
            componentNames: unique([
                basenameNoExt(script.scriptPath),
                ...(script.exports || []).filter(item => item.kind === 'class').map(item => item.name),
            ]),
        });
    }
    return { byUuid };
}

function classifyComponentKind(rawType = '', scriptRecord = null) {
    if (scriptRecord?.scriptPath) {
        return 'script';
    }
    if (String(rawType || '').startsWith('sp.')) {
        return 'spine';
    }
    if (String(rawType || '').startsWith('dragonBones.')) {
        return 'dragon-bones';
    }
    if (String(rawType || '').startsWith('cc.')) {
        return 'builtin';
    }
    return 'third-party';
}

function buildPrefabStructure(prefab, scan = {}) {
    const objects = readJson(prefab.prefabPath);
    const rootNodeId = objects?.[0]?.data?.__id__ ?? 1;
    const keyNodeByPath = new Map((prefab.keyNodes || []).map(node => [node.path, node]));
    const scriptCatalog = buildScriptCatalog(scan);
    const scriptUuidCatalog = buildPrefabScriptUuidCatalog(scan);
    const nodePathById = new Map();
    const nodeNameById = new Map();

    const visit = (nodeId, parentPath = '') => {
        const node = objects[nodeId];
        if (!node || node.__type__ !== 'cc.Node') {
            return;
        }
        const nodeName = String(node._name || `Node#${nodeId}`);
        const nodePath = parentPath ? `${parentPath}/${nodeName}` : nodeName;
        nodePathById.set(nodeId, nodePath);
        nodeNameById.set(nodeId, nodeName);
        for (const childRef of ensureArray(node._children)) {
            visit(childRef.__id__, nodePath);
        }
    };

    visit(rootNodeId, '');

    const components = [];
    const componentByOwnerKey = new Map();
    for (let index = 0; index < objects.length; index++) {
        const object = objects[index];
        if (!object || object.node?.__id__ == null) {
            continue;
        }
        const nodeIndex = object.node.__id__;
        const nodePath = nodePathById.get(nodeIndex) || '';
        if (!nodePath) {
            continue;
        }
        const rawType = String(object.__type__ || '');
        const scriptRecord = scriptUuidCatalog.byUuid.get(rawType) || findScriptCandidate(scriptCatalog, rawType) || null;
        const componentName = scriptRecord?.componentNames?.[0] || rawType;
        const componentKind = classifyComponentKind(rawType, scriptRecord);
        const componentInfo = {
            componentIndex: index,
            nodeIndex,
            nodePath,
            rawType,
            componentName,
            componentKind,
            isSpecialComponent: componentKind === 'spine' || componentKind === 'dragon-bones',
            scriptPath: scriptRecord?.scriptPath || null,
            fileId: objects[object.__prefab?.__id__]?.fileId || '',
        };
        components.push(componentInfo);
        const ownerKey = `${nodePath}::${componentName}`;
        if (!componentByOwnerKey.has(ownerKey)) {
            componentByOwnerKey.set(ownerKey, componentInfo);
        }
    }

    const nodes = Array.from(nodePathById.entries())
        .map(([nodeIndex, nodePath]) => {
            const node = objects[nodeIndex] || {};
            const nodeComponents = components
                .filter(component => component.nodeIndex === nodeIndex)
                .sort((left, right) => left.componentIndex - right.componentIndex);
            return {
                nodeIndex,
                path: nodePath,
                name: nodeNameById.get(nodeIndex) || '',
                active: typeof node._active === 'boolean' ? node._active : true,
                nestedPrefabPath: keyNodeByPath.get(nodePath)?.nestedPrefabPath || null,
                childNodeIndices: ensureArray(node._children).map(ref => ref.__id__).filter(id => nodePathById.has(id)),
                componentIndices: nodeComponents.map(component => component.componentIndex),
                components: nodeComponents,
            };
        })
        .sort((left, right) => left.nodeIndex - right.nodeIndex);

    return {
        objectCount: objects.length,
        nodes,
        components: components.sort((left, right) => left.componentIndex - right.componentIndex),
        nodeByPath: new Map(nodes.map(node => [node.path, node])),
        componentByOwnerKey,
    };
}

function summarizeExistingBindingEntry(entry, structure) {
    const targetNodePath = entry.binding?.targetNodePath || entry.value?.nodePath || entry.targetNodePath || '';
    const targetComponentName = entry.binding?.targetComponentName || entry.value?.componentName || entry.resolvedTarget?.componentName || '';
    const targetNodeIndex = targetNodePath ? (structure.nodeByPath.get(targetNodePath)?.nodeIndex ?? null) : null;
    const targetComponentIndex = targetNodePath && targetComponentName
        ? (structure.componentByOwnerKey.get(`${targetNodePath}::${targetComponentName}`)?.componentIndex ?? null)
        : null;
    return {
        field: entry.field,
        bindingKind: entry.binding?.kind || '',
        targetNodePath: targetNodePath || '',
        targetNodeIndex,
        targetComponentName: targetComponentName || '',
        targetComponentIndex,
        assetPath: entry.binding?.assetPath || entry.value?.assetPath || '',
        assetKind: entry.binding?.assetKind || entry.value?.assetKind || '',
        assetUuid: entry.value?.uuid || '',
        nestedPrefabPath: entry.nestedPrefabPath || '',
        override: Boolean(entry.override),
        targetLocalId: entry.resolvedTarget?.localId || '',
    };
}

function buildExistingBindingsForComponent(prefabComponent, structure) {
    const serialized = (prefabComponent.serializedFields || []).map(field => summarizeExistingBindingEntry(field, structure));
    const overrides = (prefabComponent.fieldOverrides || []).map(field => summarizeExistingBindingEntry({
        ...field,
        override: true,
    }, structure));
    return [...serialized, ...overrides];
}

function buildBindingAudit(prefab, structure, scriptCatalog) {
    const audit = [];

    for (const component of prefab.customComponents || []) {
        const scriptRecord = findScriptCandidate(scriptCatalog, component.componentName);
        if (!scriptRecord) {
            continue;
        }

        const ownerNode = structure.nodeByPath.get(component.nodePath) || null;
        const ownerComponent = structure.componentByOwnerKey.get(`${component.nodePath}::${component.componentName}`) || null;
        const serializedByField = new Map((component.serializedFields || []).map(item => [item.field, item]));
        const overrideByField = new Map((component.fieldOverrides || []).map(item => [item.field, item]));

        for (const fieldDef of scriptRecord.fieldTypes || []) {
            const field = summarizeFieldDef(fieldDef);
            const serialized = serializedByField.get(field.fieldName) || null;
            const override = overrideByField.get(field.fieldName) || null;
            const currentBinding = override
                ? summarizeExistingBindingEntry({ ...override, override: true }, structure)
                : (serialized ? summarizeExistingBindingEntry(serialized, structure) : null);

            let status = 'unsupported';
            if (override) {
                status = 'override-bound';
            } else if (serialized && field.bindingKind === 'primitive') {
                status = 'configured';
            } else if (serialized) {
                status = 'bound';
            } else if (field.bindingKind === 'primitive') {
                status = 'script-default';
            } else if (field.bindingKind === 'unknown') {
                status = 'unsupported';
            } else {
                status = 'missing';
            }

            audit.push({
                nodePath: component.nodePath,
                nodeIndex: ownerNode?.nodeIndex ?? null,
                componentName: component.componentName,
                componentIndex: ownerComponent?.componentIndex ?? null,
                scriptPath: component.scriptPath || null,
                fieldName: field.fieldName,
                rawType: field.rawType,
                bindingKind: field.bindingKind,
                status,
                needsBinding: ['node', 'component', 'asset'].includes(field.bindingKind),
                likelyMissing: status === 'missing',
                currentBinding,
            });
        }
    }

    return audit.sort((left, right) =>
        left.nodePath.localeCompare(right.nodePath)
        || left.componentName.localeCompare(right.componentName)
        || left.fieldName.localeCompare(right.fieldName)
    );
}

function buildProfileSummary(structure, bindingAudit) {
    const countsByStatus = bindingAudit.reduce((acc, item) => {
        acc[item.status] = (acc[item.status] || 0) + 1;
        return acc;
    }, {});
    return {
        objectCount: structure.objectCount,
        nodeCount: structure.nodes.length,
        componentCount: structure.components.length,
        scriptComponentCount: structure.components.filter(item => item.componentKind === 'script').length,
        specialComponentCount: structure.components.filter(item => item.isSpecialComponent).length,
        bindingAudit: {
            total: bindingAudit.length,
            bound: countsByStatus.bound || 0,
            overrideBound: countsByStatus['override-bound'] || 0,
            configured: countsByStatus.configured || 0,
            scriptDefault: countsByStatus['script-default'] || 0,
            missing: countsByStatus.missing || 0,
            unsupported: countsByStatus.unsupported || 0,
        },
    };
}

function matchesNodeFilter(nodePath = '', query = '') {
    if (!query) {
        return true;
    }
    const name = String(nodePath || '').split('/').pop() || '';
    return matchContains(nodePath, query) || matchContains(name, query);
}

function matchesComponentFilter(componentName = '', rawType = '', query = '') {
    if (!query) {
        return true;
    }
    return matchContains(componentName, query) || matchContains(rawType, query);
}

function matchesFieldFilter(fieldName = '', query = '') {
    if (!query) {
        return true;
    }
    return matchContains(fieldName, query);
}

function buildProfileBundle(artifacts, prefab) {
    const scriptCatalog = buildScriptCatalog(artifacts.scan);
    const structure = buildPrefabStructure(prefab, artifacts.scan);
    const customComponents = (prefab.customComponents || []).map(component => {
        const scriptRecord = findScriptCandidate(scriptCatalog, component.componentName);
        const ownerNode = structure.nodeByPath.get(component.nodePath) || null;
        const ownerComponent = structure.componentByOwnerKey.get(`${component.nodePath}::${component.componentName}`) || null;
        return {
            nodePath: component.nodePath,
            nodeIndex: ownerNode?.nodeIndex ?? null,
            componentName: component.componentName,
            componentIndex: ownerComponent?.componentIndex ?? null,
            componentKind: ownerComponent?.componentKind || 'script',
            rawType: ownerComponent?.rawType || component.rawType || component.componentName,
            scriptPath: component.scriptPath || null,
            bindableFields: (scriptRecord?.fieldTypes || []).map(fieldDef => summarizeFieldDef(fieldDef)),
            existingBindings: buildExistingBindingsForComponent(component, structure),
        };
    }).filter(component => component.componentKind === 'script' || Boolean(component.scriptPath));
    const eventBindings = (prefab.events || []).map(item => {
        const sourceNode = structure.nodeByPath.get(item.sourceNodePath) || null;
        const targetNode = structure.nodeByPath.get(item.targetNodePath) || null;
        const targetComponent = item.targetNodePath && item.targetComponentName
            ? structure.componentByOwnerKey.get(`${item.targetNodePath}::${item.targetComponentName}`) || null
            : null;
        return {
            sourceNodePath: item.sourceNodePath,
            sourceNodeIndex: sourceNode?.nodeIndex ?? null,
            sourceKind: item.sourceKind,
            targetNodePath: item.targetNodePath,
            targetNodeIndex: targetNode?.nodeIndex ?? null,
            targetComponentName: item.targetComponentName,
            targetComponentIndex: targetComponent?.componentIndex ?? null,
            handler: item.handler,
        };
    });
    const bindingAudit = buildBindingAudit(prefab, structure, scriptCatalog);
    return {
        structure,
        customComponents,
        eventBindings,
        bindingAudit,
        summary: buildProfileSummary(structure, bindingAudit),
    };
}

function applyProfileFilters(bundle, filters = {}) {
    const nodeQuery = filters.nodeQuery || '';
    const componentQuery = filters.componentQuery || '';
    const fieldQuery = filters.fieldQuery || '';
    const hasFilters = Boolean(nodeQuery || componentQuery || fieldQuery);

    if (!hasFilters) {
        return {
            filters: {
                node: nodeQuery,
                component: componentQuery,
                field: fieldQuery,
                applied: false,
            },
            nodes: bundle.structure.nodes,
            components: bundle.structure.components,
            specialComponents: bundle.structure.components.filter(item => item.isSpecialComponent),
            customComponents: bundle.customComponents,
            eventBindings: bundle.eventBindings,
            bindingAudit: bundle.bindingAudit,
            matches: {
                nodes: bundle.structure.nodes.length,
                components: bundle.structure.components.length,
                customComponents: bundle.customComponents.length,
                bindingAudit: bundle.bindingAudit.length,
            },
        };
    }

    const filteredComponents = bundle.structure.components.filter(item =>
        matchesNodeFilter(item.nodePath, nodeQuery) && matchesComponentFilter(item.componentName, item.rawType, componentQuery)
    );
    const filteredCustomComponents = bundle.customComponents.filter(item =>
        matchesNodeFilter(item.nodePath, nodeQuery) && matchesComponentFilter(item.componentName, item.rawType, componentQuery)
    );
    const filteredBindingAudit = bundle.bindingAudit.filter(item =>
        matchesNodeFilter(item.nodePath, nodeQuery)
        && matchesComponentFilter(item.componentName, '', componentQuery)
        && matchesFieldFilter(item.fieldName, fieldQuery)
    );
    const filteredEvents = bundle.eventBindings.filter(item => {
        const nodeMatched = !nodeQuery
            || matchesNodeFilter(item.sourceNodePath, nodeQuery)
            || matchesNodeFilter(item.targetNodePath, nodeQuery);
        const componentMatched = !componentQuery || matchesComponentFilter(item.targetComponentName, '', componentQuery);
        return nodeMatched && componentMatched;
    });

    const relevantNodePaths = new Set([
        ...filteredComponents.map(item => item.nodePath),
        ...filteredCustomComponents.map(item => item.nodePath),
        ...filteredBindingAudit.map(item => item.nodePath),
        ...filteredEvents.map(item => item.sourceNodePath),
        ...filteredEvents.map(item => item.targetNodePath),
    ].filter(Boolean));

    const filteredNodes = bundle.structure.nodes.filter(node =>
        (nodeQuery ? matchesNodeFilter(node.path, nodeQuery) : false) || relevantNodePaths.has(node.path)
    );

    return {
        filters: {
            node: nodeQuery,
            component: componentQuery,
            field: fieldQuery,
            applied: true,
        },
        nodes: filteredNodes,
        components: filteredComponents,
        specialComponents: filteredComponents.filter(item => item.isSpecialComponent),
        customComponents: filteredCustomComponents,
        eventBindings: filteredEvents,
        bindingAudit: filteredBindingAudit,
        matches: {
            nodes: filteredNodes.length,
            components: filteredComponents.length,
            customComponents: filteredCustomComponents.length,
            bindingAudit: filteredBindingAudit.length,
        },
    };
}

function planClickEvent(artifacts, options) {
    const prefab = findPrefab(artifacts.scan, options.prefab);
    if (!prefab) {
        throw createAuthoringError(`未找到 prefab: ${options.prefab || '(default)'}`, {
            code: 'prefab_not_found',
            suggestions: findPrefabCandidates(artifacts.scan, options.prefab),
        });
    }
    const scriptCatalog = buildScriptCatalog(artifacts.scan);
    const authoringFeatureProfile = options.authoringFeatureProfile || null;
    const conventions = inferEventConventions(prefab, authoringFeatureProfile);
    const existingComponentMatch = findPrefabComponent(prefab, options.component, options.targetNode || '');
    const scriptRecord = (existingComponentMatch && findScriptCandidate(scriptCatalog, existingComponentMatch.componentName))
        || findScriptCandidate(scriptCatalog, options.component);
    if (!scriptRecord) {
        throw createAuthoringError(`未找到目标组件/脚本: ${options.component}`, {
            code: 'component_not_found',
            suggestions: findScriptCandidates(scriptCatalog, options.component),
        });
    }

    const targetNodePath = options.targetNode
        || findPrefabComponent(prefab, options.component)?.nodePath
        || conventions.recommendedTargetNodePath
        || inferPreferredComponentNodePath(prefab, scriptRecord.componentNames?.[0] || options.component, authoringFeatureProfile)
        || findRootNodePath(prefab);
    const componentName = scriptRecord.componentNames?.[0] || options.component;
    const existingComponent = findPrefabComponent(prefab, componentName, targetNodePath);
    const handlerExists = Boolean((scriptRecord.methods || []).some(method => method.name === options.handler));
    const sourceHasButton = hasButtonLikeComponent(prefab, options.node);
    const existingEvent = findExistingEvent(prefab, options.node, componentName, options.handler);

    const changes = [
        buildAttachComponentPlan({
            prefab,
            nodePath: targetNodePath,
            componentName,
            scriptRecord,
            existingComponent,
        }),
        buildAddMethodPlan({
            scriptRecord,
            handlerName: options.handler,
            exists: handlerExists,
        }),
        buildEventBindingPlan({
            prefab,
            sourceNodePath: options.node,
            targetNodePath,
            componentName,
            handlerName: options.handler,
            sourceHasButton,
            existingEvent,
            conventions,
        }),
    ];

    if (!sourceHasButton) {
        changes.splice(2, 0, {
            kind: 'attach-built-in-component',
            status: 'required',
            prefabPath: prefab.prefabPath,
            nodePath: options.node,
            componentName: 'cc.Button',
            editTarget: 'prefab-component-list',
            applyVia: 'attach-built-in-component',
            why: 'clickEvents 只能挂在带 cc.Button 的节点上。',
        });
    }

    return {
        kind: 'cocos-authoring-plan',
        intent: 'click-event',
        feature: {
            featureKey: artifacts.feature.featureKey,
            featureName: artifacts.feature.featureName,
        },
        prefab: {
            prefabPath: prefab.prefabPath,
            prefabName: basenameNoExt(prefab.prefabPath),
        },
        sourceNodePath: options.node,
        targetNodePath,
        targetComponentName: componentName,
        handlerName: options.handler,
        learnedConventions: {
            recommendedTargetNodePath: conventions.recommendedTargetNodePath,
            recommendedTargetComponentName: conventions.recommendedTargetComponentName,
            existingClickExamples: conventions.existingClickEvents.slice(0, 5).map(item => ({
                sourceNodePath: item.sourceNodePath,
                targetNodePath: item.targetNodePath,
                targetComponentName: item.targetComponentName,
                handler: item.handler,
            })),
        },
        changes,
    };
}

function planFieldBinding(artifacts, options) {
    const prefab = findPrefab(artifacts.scan, options.prefab);
    if (!prefab) {
        throw createAuthoringError(`未找到 prefab: ${options.prefab || '(default)'}`, {
            code: 'prefab_not_found',
            suggestions: findPrefabCandidates(artifacts.scan, options.prefab),
        });
    }
    const scriptCatalog = buildScriptCatalog(artifacts.scan);
    const authoringFeatureProfile = options.authoringFeatureProfile || null;
    const existingComponent = findPrefabComponent(prefab, options.component, options.node);
    const scriptRecord = existingComponent
        ? findScriptCandidate(scriptCatalog, existingComponent.componentName) || { ...existingComponent, componentNames: [existingComponent.componentName], methods: [] }
        : findScriptCandidate(scriptCatalog, options.component);
    if (!scriptRecord) {
        throw createAuthoringError(`未找到目标组件/脚本: ${options.component}`, {
            code: 'component_not_found',
            suggestions: findScriptCandidates(scriptCatalog, options.component),
        });
    }

    const componentName = existingComponent?.componentName || scriptRecord.componentNames?.[0] || options.component;
    const componentNodePath = options.node
        || existingComponent?.nodePath
        || inferPreferredComponentNodePath(prefab, componentName, authoringFeatureProfile)
        || findRootNodePath(prefab);
    const fieldDef = findFieldDefinition(scriptRecord, options.field);
    if (!fieldDef) {
        throw createAuthoringError(`未找到可绑定字段: ${options.field}`, {
            code: 'field_not_found',
            suggestions: findFieldCandidates(scriptRecord, options.field),
        });
    }
    const fieldPatterns = getRelevantFieldBindingPatterns(authoringFeatureProfile, componentName, fieldDef.fieldName);
    const assetPatterns = inferBindableFieldKind(fieldDef) === 'asset'
        ? getRelevantAssetPatterns(authoringFeatureProfile, fieldDef.baseType)
        : [];

    const targetQuery = options.targetNode || options.targetComponent || options.targetAsset || '';
    const existingBinding = findExistingFieldBinding(prefab, componentName, componentNodePath, fieldDef.fieldName, targetQuery);
    const targetAsset = options.targetAsset ? findAssetCandidate(artifacts.graph, options.targetAsset) : null;
    if (options.targetAsset && !targetAsset) {
        throw createAuthoringError(`未找到 target asset: ${options.targetAsset}`, {
            code: 'asset_not_found',
            suggestions: findAssetCandidatesForField(artifacts, options.targetAsset, fieldDef, authoringFeatureProfile),
        });
    }

    const changes = [
        buildAttachComponentPlan({
            prefab,
            nodePath: componentNodePath,
            componentName,
            scriptRecord,
            existingComponent,
        }),
        buildFieldBindingPlan({
            prefab,
            componentNodePath,
            componentName,
            fieldDef,
            targetNodePath: options.targetNode,
            targetComponentName: options.targetComponent,
            targetAsset,
            existingBinding,
        }),
    ];
    const bindingChange = changes.find(item => item.kind === 'bind-field');
    if (bindingChange) {
        bindingChange.learnedFromProject = summarizeFieldBindingConvention(componentName, fieldDef.fieldName, fieldPatterns, assetPatterns);
    }

    return {
        kind: 'cocos-authoring-plan',
        intent: 'field-binding',
        feature: {
            featureKey: artifacts.feature.featureKey,
            featureName: artifacts.feature.featureName,
        },
        prefab: {
            prefabPath: prefab.prefabPath,
            prefabName: basenameNoExt(prefab.prefabPath),
        },
        componentName,
        componentNodePath,
        field: summarizeFieldDef(fieldDef),
        currentBinding: existingBinding
            ? {
                bindingKind: existingBinding.binding?.kind || '',
                targetNodePath: existingBinding.binding?.targetNodePath || existingBinding.value?.nodePath || '',
                targetComponentName: existingBinding.binding?.targetComponentName || existingBinding.value?.componentName || '',
                assetPath: existingBinding.binding?.assetPath || existingBinding.value?.assetPath || '',
            }
            : null,
        learnedConventions: {
            fieldBindingPatterns: fieldPatterns.slice(0, 5).map(item => ({
                bindingKind: item.bindingKind,
                assetKind: item.assetKind || null,
                confidence: item.confidence,
                sampleTargetNodePath: item.evidence?.[0]?.targetNodePath || '',
                sampleTargetComponentName: item.evidence?.[0]?.targetComponentName || '',
                sampleAssetPath: item.evidence?.[0]?.assetPath || '',
            })),
            assetPatterns: assetPatterns.slice(0, 5).map(item => ({
                assetKind: item.assetKind,
                directory: item.directory,
                confidence: item.confidence,
            })),
        },
        changes,
    };
}

function buildAuthoringProfile(artifacts, options = {}) {
    const prefab = findPrefab(artifacts.scan, options.prefab);
    if (!prefab) {
        throw createAuthoringError(`未找到 prefab: ${options.prefab || '(default)'}`, {
            code: 'prefab_not_found',
            suggestions: findPrefabCandidates(artifacts.scan, options.prefab),
        });
    }
    const bundle = buildProfileBundle(artifacts, prefab);
    const filtered = applyProfileFilters(bundle, {
        nodeQuery: options.nodeQuery,
        componentQuery: options.componentQuery,
        fieldQuery: options.fieldQuery,
    });

    return {
        kind: 'cocos-authoring-profile',
        feature: {
            featureKey: artifacts.feature.featureKey,
            featureName: artifacts.feature.featureName,
        },
        prefab: {
            prefabPath: prefab.prefabPath,
            prefabName: basenameNoExt(prefab.prefabPath),
        },
        summary: bundle.summary,
        filters: filtered.filters,
        matches: filtered.matches,
        nodes: filtered.nodes,
        components: filtered.components,
        specialComponents: filtered.specialComponents,
        customComponents: filtered.customComponents,
        eventBindings: filtered.eventBindings,
        bindingAudit: filtered.bindingAudit,
    };
}

function makeEvidence(prefabPath, details = {}) {
    return {
        prefabPath: normalize(prefabPath),
        ...details,
    };
}

function buildPrefabAuthoringProfile(artifacts, prefab) {
    const bundle = buildProfileBundle(artifacts, prefab);

    return {
        prefabPath: prefab.prefabPath,
        prefabName: basenameNoExt(prefab.prefabPath),
        summary: bundle.summary,
        nodes: bundle.structure.nodes.map(node => ({
            ...node,
            nodeRole: inferNodeRole(node.path, node.nestedPrefabPath),
        })),
        specialComponents: bundle.structure.components
            .filter(item => item.isSpecialComponent)
            .map(item => ({
                nodePath: item.nodePath,
                nodeIndex: item.nodeIndex,
                componentIndex: item.componentIndex,
                componentName: item.componentName,
                componentKind: item.componentKind,
                rawType: item.rawType,
            })),
        customComponents: bundle.customComponents,
        bindingAuditSummary: bundle.summary.bindingAudit,
        missingBindings: bundle.bindingAudit
            .filter(item => item.status === 'missing')
            .map(item => ({
                nodePath: item.nodePath,
                nodeIndex: item.nodeIndex,
                componentName: item.componentName,
                componentIndex: item.componentIndex,
                fieldName: item.fieldName,
                bindingKind: item.bindingKind,
                rawType: item.rawType,
            })),
        eventBindings: bundle.eventBindings,
    };
}

function confidenceFromCounts(count, total) {
    if (!total) {
        return 0;
    }
    return Number((count / total).toFixed(4));
}

function learnEventPatterns(prefabs = []) {
    const totalsByKind = new Map();
    const grouped = new Map();

    for (const prefab of prefabs) {
        for (const eventInfo of prefab.events || []) {
            const sourceKind = eventInfo.sourceKind || 'event';
            totalsByKind.set(sourceKind, (totalsByKind.get(sourceKind) || 0) + 1);
            const key = [
                sourceKind,
                eventInfo.targetNodePath || '',
                eventInfo.targetComponentName || '',
            ].join('::');
            if (!grouped.has(key)) {
                grouped.set(key, {
                    sourceKind,
                    targetNodePath: eventInfo.targetNodePath || null,
                    targetComponentName: eventInfo.targetComponentName || null,
                    handlers: new Set(),
                    count: 0,
                    evidence: [],
                });
            }
            const entry = grouped.get(key);
            entry.count += 1;
            entry.handlers.add(eventInfo.handler);
            entry.evidence.push(makeEvidence(prefab.prefabPath, {
                sourceNodePath: eventInfo.sourceNodePath,
                handler: eventInfo.handler,
            }));
        }
    }

    return Array.from(grouped.values())
        .map(item => ({
            sourceKind: item.sourceKind,
            targetNodePath: item.targetNodePath,
            targetComponentName: item.targetComponentName,
            handlers: Array.from(item.handlers).sort((left, right) => left.localeCompare(right)),
            count: item.count,
            confidence: confidenceFromCounts(item.count, totalsByKind.get(item.sourceKind) || 0),
            evidence: item.evidence.slice(0, 10),
        }))
        .sort((left, right) => right.count - left.count || left.sourceKind.localeCompare(right.sourceKind));
}

function learnComponentPlacementPatterns(prefabs = []) {
    const totalsByComponent = new Map();
    const grouped = new Map();

    for (const prefab of prefabs) {
        for (const component of prefab.customComponents || []) {
            const keyNode = (prefab.keyNodes || []).find(node => node.path === component.nodePath) || null;
            const nodeRole = inferNodeRole(component.nodePath, keyNode?.nestedPrefabPath || '');
            totalsByComponent.set(component.componentName, (totalsByComponent.get(component.componentName) || 0) + 1);
            const key = [component.componentName, nodeRole, component.nodePath || ''].join('::');
            if (!grouped.has(key)) {
                grouped.set(key, {
                    componentName: component.componentName,
                    nodeRole,
                    preferredNodePath: component.nodePath || null,
                    count: 0,
                    evidence: [],
                });
            }
            const entry = grouped.get(key);
            entry.count += 1;
            entry.evidence.push(makeEvidence(prefab.prefabPath, {
                nodePath: component.nodePath,
                scriptPath: component.scriptPath || '',
            }));
        }
    }

    return Array.from(grouped.values())
        .map(item => ({
            componentName: item.componentName,
            nodeRole: item.nodeRole,
            preferredNodePath: item.preferredNodePath,
            count: item.count,
            confidence: confidenceFromCounts(item.count, totalsByComponent.get(item.componentName) || 0),
            evidence: item.evidence.slice(0, 10),
        }))
        .sort((left, right) => right.count - left.count || left.componentName.localeCompare(right.componentName));
}

function learnFieldBindingPatterns(prefabs = []) {
    const totalsByField = new Map();
    const grouped = new Map();

    for (const prefab of prefabs) {
        for (const binding of prefab.bindingFacts?.fieldBindings || []) {
            const fieldKey = `${binding.componentName}::${binding.field}`;
            totalsByField.set(fieldKey, (totalsByField.get(fieldKey) || 0) + 1);
            const bindingKind = binding.binding?.kind || binding.value?.kind || 'unknown';
            const assetKind = binding.binding?.assetKind || binding.value?.assetKind || '';
            const key = [fieldKey, bindingKind, assetKind].join('::');
            if (!grouped.has(key)) {
                grouped.set(key, {
                    componentName: binding.componentName,
                    field: binding.field,
                    bindingKind,
                    assetKind: assetKind || null,
                    count: 0,
                    evidence: [],
                });
            }
            const entry = grouped.get(key);
            entry.count += 1;
            entry.evidence.push(makeEvidence(prefab.prefabPath, {
                nodePath: binding.nodePath,
                targetNodePath: binding.binding?.targetNodePath || binding.value?.nodePath || '',
                targetComponentName: binding.binding?.targetComponentName || binding.value?.componentName || '',
                assetPath: binding.binding?.assetPath || binding.value?.assetPath || '',
            }));
        }
    }

    return Array.from(grouped.values())
        .map(item => ({
            componentName: item.componentName,
            field: item.field,
            bindingKind: item.bindingKind,
            assetKind: item.assetKind,
            count: item.count,
            confidence: confidenceFromCounts(item.count, totalsByField.get(`${item.componentName}::${item.field}`) || 0),
            evidence: item.evidence.slice(0, 10),
        }))
        .sort((left, right) => right.count - left.count || left.componentName.localeCompare(right.componentName));
}

function learnAssetPatterns(prefabs = []) {
    const grouped = new Map();
    let totalAssets = 0;

    for (const prefab of prefabs) {
        for (const binding of prefab.bindingFacts?.fieldBindings || []) {
            const assetPath = binding.binding?.assetPath || binding.value?.assetPath || '';
            const assetKind = binding.binding?.assetKind || binding.value?.assetKind || '';
            if (!assetPath || !assetKind) {
                continue;
            }
            totalAssets += 1;
            const directory = normalize(path.dirname(assetPath));
            const key = [assetKind, directory].join('::');
            if (!grouped.has(key)) {
                grouped.set(key, {
                    assetKind,
                    directory,
                    count: 0,
                    evidence: [],
                });
            }
            const entry = grouped.get(key);
            entry.count += 1;
            entry.evidence.push(makeEvidence(prefab.prefabPath, {
                assetPath,
                field: binding.field,
                componentName: binding.componentName,
            }));
        }
    }

    return Array.from(grouped.values())
        .map(item => ({
            assetKind: item.assetKind,
            directory: item.directory,
            count: item.count,
            confidence: confidenceFromCounts(item.count, totalAssets),
            evidence: item.evidence.slice(0, 10),
        }))
        .sort((left, right) => right.count - left.count || left.assetKind.localeCompare(right.assetKind));
}

function buildFeatureAuthoringProfile(artifacts) {
    const prefabs = artifacts.scan.prefabs || [];
    return {
        featureName: artifacts.feature.featureName,
        sourceKbVersion: artifacts.graph?.builtWithSkill?.version || '',
        prefabProfiles: prefabs.map(prefab => buildPrefabAuthoringProfile(artifacts, prefab)),
        eventPatterns: learnEventPatterns(prefabs),
        componentPlacementPatterns: learnComponentPlacementPatterns(prefabs),
        fieldBindingPatterns: learnFieldBindingPatterns(prefabs),
        assetPatterns: learnAssetPatterns(prefabs),
    };
}

function loadFeatureRecords(root, featureKey = '') {
    const registryPath = path.join(root, 'project-memory', 'state', 'feature-registry.json');
    if (!pathExists(registryPath)) {
        return [];
    }
    const registry = readJson(registryPath);
    return (registry.features || [])
        .map(item => normalizeFeatureRecord(item))
        .filter(item => (!featureKey || item.featureKey === featureKey) && item.outputs?.scan);
}

function buildProjectAuthoringProfile(root, featureKey = '') {
    const resolvedRoot = resolveProjectRoot(root || process.cwd());
    const profile = {
        generatedAt: timestamp(),
        builtWithSkill: loadCurrentSkillBuildInfo(),
        projectRoot: normalize(resolvedRoot),
        features: {},
    };

    for (const featureRecord of loadFeatureRecords(resolvedRoot, featureKey)) {
        const artifacts = loadFeatureArtifacts(resolvedRoot, featureRecord.featureKey);
        if ((artifacts.scan.prefabs || []).length <= 0) {
            continue;
        }
        profile.features[featureRecord.featureKey] = buildFeatureAuthoringProfile(artifacts);
    }

    return profile;
}

function writeProjectAuthoringProfile(root, profile) {
    const resolvedRoot = resolveProjectRoot(root || process.cwd());
    const targetPath = path.join(resolvedRoot, 'project-memory', 'state', 'cocos-authoring-profile.json');
    writeJson(targetPath, profile);
    return targetPath;
}

function loadProjectAuthoringProfile(root) {
    const resolvedRoot = resolveProjectRoot(root || process.cwd());
    const targetPath = path.join(resolvedRoot, 'project-memory', 'state', 'cocos-authoring-profile.json');
    if (!pathExists(targetPath)) {
        return null;
    }
    return readJson(targetPath);
}

function loadFeatureAuthoringProfile(root, featureKey) {
    const profile = loadProjectAuthoringProfile(root);
    return profile?.features?.[featureKey] || null;
}

module.exports = {
    buildAuthoringProfile,
    buildFeatureAuthoringProfile,
    buildProjectAuthoringProfile,
    buildScriptCatalog,
    createAuthoringError,
    findFieldDefinition,
    findFieldCandidates,
    findPrefab,
    findPrefabCandidates,
    inferBindableFieldKind,
    isBuiltWithCurrentSkill,
    loadFeatureArtifacts,
    loadFeatureAuthoringProfile,
    loadProjectAuthoringProfile,
    planClickEvent,
    planFieldBinding,
    summarizeFieldDef,
    writeProjectAuthoringProfile,
    findAssetCandidates,
};
