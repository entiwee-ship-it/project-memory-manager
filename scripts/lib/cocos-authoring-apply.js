const fs = require('fs');
const path = require('path');
const { normalize, readJson } = require('./common');

function detectEol(text) {
    return text.includes('\r\n') ? '\r\n' : '\n';
}

function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}

function readScriptUuid(scriptPath) {
    const metaPath = `${scriptPath}.meta`;
    if (!fs.existsSync(metaPath)) {
        return null;
    }
    return readJson(metaPath).uuid || null;
}

function buildScriptMetaCatalog(scan = {}) {
    const byComponentName = new Map();
    const byUuid = new Map();

    for (const script of scan.scripts || []) {
        const scriptPath = script.scriptPath;
        const uuid = readScriptUuid(scriptPath);
        const componentNames = [
            path.basename(scriptPath, path.extname(scriptPath)),
            ...(script.exports || []).filter(item => item.kind === 'class').map(item => item.name),
        ].filter(Boolean);
        const record = {
            scriptPath,
            uuid,
            componentNames: Array.from(new Set(componentNames)),
            methods: script.methods || [],
        };
        for (const componentName of record.componentNames) {
            byComponentName.set(componentName, record);
        }
        if (uuid) {
            byUuid.set(uuid, record);
        }
    }

    return {
        byComponentName,
        byUuid,
    };
}

function buildAssetCatalog(graph = { nodes: [] }) {
    const byName = new Map();
    const byPath = new Map();

    for (const node of graph.nodes || []) {
        if (node.type !== 'asset') {
            continue;
        }
        if (node.name) {
            byName.set(node.name, node);
        }
        if (node.meta?.assetPath) {
            byPath.set(node.meta.assetPath, node);
        }
    }

    return {
        byName,
        byPath,
    };
}

function loadPrefabDocument(prefabPath, scriptMetaCatalog) {
    const objects = readJson(prefabPath);
    const rootNodeId = objects?.[0]?.data?.__id__ ?? 1;
    const nodePathById = new Map();
    const nodeIdByPath = new Map();
    const componentRefsByNodeId = new Map();
    const componentById = new Map();
    const componentByNodeAndName = new Map();
    const componentPrefabInfoTemplate = findPrefabInfoTemplate(objects);
    const clickEventTemplate = findClickEventTemplate(objects);

    const visit = (nodeId, parentPath = '') => {
        const node = objects[nodeId];
        if (!node || node.__type__ !== 'cc.Node') {
            return;
        }
        const nodeName = node._name || `Node#${nodeId}`;
        const nodePath = parentPath ? `${parentPath}/${nodeName}` : nodeName;
        nodePathById.set(nodeId, nodePath);
        nodeIdByPath.set(nodePath, nodeId);
        componentRefsByNodeId.set(nodeId, Array.isArray(node._components) ? node._components : []);

        for (const childRef of node._children || []) {
            visit(childRef.__id__, nodePath);
        }
    };

    visit(rootNodeId, '');

    for (let index = 0; index < objects.length; index++) {
        const object = objects[index];
        if (!object || !object.node?.__id__) {
            continue;
        }
        const nodeId = object.node.__id__;
        const componentName = resolveComponentName(object.__type__, scriptMetaCatalog);
        const componentInfo = {
            id: index,
            object,
            nodeId,
            nodePath: nodePathById.get(nodeId) || '',
            typeName: object.__type__ || '',
            componentName,
            fileId: objects[object.__prefab?.__id__]?.fileId || '',
        };
        componentById.set(index, componentInfo);
        componentByNodeAndName.set(`${nodeId}::${componentName}`, componentInfo);
    }

    return {
        prefabPath,
        objects,
        rootNodeId,
        nodePathById,
        nodeIdByPath,
        componentById,
        componentByNodeAndName,
        componentPrefabInfoTemplate,
        clickEventTemplate,
    };
}

function resolveComponentName(typeName, scriptMetaCatalog) {
    if (!typeName) {
        return '';
    }
    if (typeName.startsWith('cc.')) {
        return typeName;
    }
    const record = scriptMetaCatalog.byUuid.get(typeName);
    return record?.componentNames?.[0] || typeName;
}

function findPrefabInfoTemplate(objects) {
    for (let index = 0; index < objects.length; index++) {
        const object = objects[index];
        if (object && typeof object === 'object' && Object.prototype.hasOwnProperty.call(object, 'fileId')) {
            return cloneJson(object);
        }
    }
    return { fileId: '' };
}

function findClickEventTemplate(objects) {
    for (const object of objects) {
        if (object?.__type__ === 'cc.ClickEvent') {
            return cloneJson(object);
        }
    }
    return {
        __type__: 'cc.ClickEvent',
        target: null,
        _componentId: '',
        handler: '',
        customEventData: '',
    };
}

function nextFileId(doc, seed) {
    const base = String(seed || 'component').replace(/[^\w-]+/g, '-').toLowerCase() || 'component';
    const existing = new Set(doc.objects.filter(Boolean).map(item => item?.fileId).filter(Boolean));
    let counter = 1;
    let candidate = `${base}-${counter}`;
    while (existing.has(candidate)) {
        counter += 1;
        candidate = `${base}-${counter}`;
    }
    return candidate;
}

function pushObject(doc, object) {
    doc.objects.push(object);
    return doc.objects.length - 1;
}

function ensureComponent(doc, nodePath, descriptor) {
    const nodeId = doc.nodeIdByPath.get(nodePath);
    if (nodeId == null) {
        throw new Error(`prefab 中未找到节点: ${nodePath}`);
    }

    const existing = doc.componentByNodeAndName.get(`${nodeId}::${descriptor.componentName}`);
    if (existing) {
        return {
            changed: false,
            component: existing,
        };
    }

    const prefabInfoObject = cloneJson(doc.componentPrefabInfoTemplate);
    prefabInfoObject.fileId = nextFileId(doc, descriptor.componentName || descriptor.typeName);
    const prefabInfoId = pushObject(doc, prefabInfoObject);

    const componentObject = {
        __type__: descriptor.typeName,
        node: { __id__: nodeId },
        _enabled: true,
        __prefab: { __id__: prefabInfoId },
        ...(descriptor.defaults || {}),
    };
    const componentId = pushObject(doc, componentObject);

    const node = doc.objects[nodeId];
    if (!Array.isArray(node._components)) {
        node._components = [];
    }
    node._components.push({ __id__: componentId });

    const componentInfo = {
        id: componentId,
        object: componentObject,
        nodeId,
        nodePath,
        typeName: descriptor.typeName,
        componentName: descriptor.componentName,
        fileId: prefabInfoObject.fileId,
    };
    doc.componentById.set(componentId, componentInfo);
    doc.componentByNodeAndName.set(`${nodeId}::${descriptor.componentName}`, componentInfo);

    return {
        changed: true,
        component: componentInfo,
    };
}

function ensureButtonComponent(doc, nodePath) {
    return ensureComponent(doc, nodePath, {
        typeName: 'cc.Button',
        componentName: 'cc.Button',
        defaults: {
            clickEvents: [],
        },
    });
}

function ensureClickEvent(doc, buttonComponent, targetNodePath, componentUuid, handlerName) {
    const targetNodeId = doc.nodeIdByPath.get(targetNodePath);
    if (targetNodeId == null) {
        throw new Error(`prefab 中未找到事件目标节点: ${targetNodePath}`);
    }
    if (!Array.isArray(buttonComponent.object.clickEvents)) {
        buttonComponent.object.clickEvents = [];
    }

    for (const ref of buttonComponent.object.clickEvents) {
        const eventObject = doc.objects[ref.__id__];
        if (!eventObject) {
            continue;
        }
        if (eventObject.target?.__id__ === targetNodeId && eventObject._componentId === componentUuid && eventObject.handler === handlerName) {
            return {
                changed: false,
                eventId: ref.__id__,
            };
        }
    }

    const eventObject = cloneJson(doc.clickEventTemplate);
    eventObject.__type__ = 'cc.ClickEvent';
    eventObject.target = { __id__: targetNodeId };
    eventObject._componentId = componentUuid;
    eventObject.handler = handlerName;
    eventObject.customEventData = eventObject.customEventData || '';
    const eventId = pushObject(doc, eventObject);
    buttonComponent.object.clickEvents.push({ __id__: eventId });
    return {
        changed: true,
        eventId,
    };
}

function setFieldNodeReference(component, fieldName, targetNodeId) {
    component.object[fieldName] = { __id__: targetNodeId };
}

function setFieldComponentReference(component, fieldName, targetComponentId) {
    component.object[fieldName] = { __id__: targetComponentId };
}

function setFieldAssetReference(component, fieldName, assetUuid) {
    component.object[fieldName] = { __uuid__: assetUuid };
}

function findComponentCandidates(doc, componentName) {
    const matches = [];
    for (const component of doc.componentById.values()) {
        if (component.componentName === componentName) {
            matches.push(component);
        }
    }
    return matches;
}

function findNestedPrefabTargets(parentPrefab, scriptMetaCatalog, componentName) {
    const results = [];
    for (const [nodePath, nodeId] of parentPrefab.nodeIdByPath.entries()) {
        const node = parentPrefab.objects[nodeId];
        const prefabInfo = parentPrefab.objects[node?._prefab?.__id__];
        const nestedAssetUuid = prefabInfo?.asset?.__uuid__;
        if (!nestedAssetUuid) {
            continue;
        }
        const nestedPrefabPath = parentPrefab.assetUuidToPath?.get(nestedAssetUuid);
        if (!nestedPrefabPath || !fs.existsSync(nestedPrefabPath)) {
            continue;
        }
        const nestedDoc = loadPrefabDocument(nestedPrefabPath, scriptMetaCatalog);
        for (const candidate of findComponentCandidates(nestedDoc, componentName)) {
            results.push({
                parentNodeId: nodeId,
                parentNodePath: nodePath,
                nestedPrefabPath,
                nestedComponent: candidate,
            });
        }
    }
    return results;
}

function ensureTargetOverride(doc, ownerComponent, fieldName, parentNodeId, localId) {
    for (let index = 0; index < doc.objects.length; index++) {
        const object = doc.objects[index];
        if (object?.__type__ !== 'cc.TargetOverrideInfo' || object.source?.__id__ !== ownerComponent.id) {
            continue;
        }
        const propertyPath = Array.isArray(object.propertyPath) ? object.propertyPath.join('.') : '';
        if (propertyPath !== fieldName) {
            continue;
        }
        object.target = { __id__: parentNodeId };
        const targetInfoId = object.targetInfo?.__id__;
        if (targetInfoId != null && doc.objects[targetInfoId]) {
            doc.objects[targetInfoId].localID = [localId];
        }
        return {
            changed: true,
            overrideId: index,
        };
    }

    const targetInfoId = pushObject(doc, {
        localID: [localId],
    });
    const overrideId = pushObject(doc, {
        __type__: 'cc.TargetOverrideInfo',
        source: { __id__: ownerComponent.id },
        propertyPath: [fieldName],
        target: { __id__: parentNodeId },
        targetInfo: { __id__: targetInfoId },
    });

    return {
        changed: true,
        overrideId,
    };
}

function writePrefabDocument(doc) {
    fs.writeFileSync(doc.prefabPath, `${JSON.stringify(doc.objects, null, 2)}\n`, 'utf8');
}

function insertMethodStub(scriptPath, componentName, handlerName) {
    const source = fs.readFileSync(scriptPath, 'utf8');
    if (new RegExp(`\\b${handlerName}\\s*\\(`).test(source)) {
        return { changed: false };
    }

    const classPattern = new RegExp(`class\\s+${componentName}\\b[^{]*\\{`, 'm');
    const classMatch = classPattern.exec(source);
    if (!classMatch) {
        throw new Error(`无法在脚本中定位 class ${componentName}: ${scriptPath}`);
    }

    const classOpenIndex = source.indexOf('{', classMatch.index);
    let depth = 0;
    let classCloseIndex = -1;
    for (let index = classOpenIndex; index < source.length; index++) {
        const char = source[index];
        if (char === '{') {
            depth += 1;
        } else if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                classCloseIndex = index;
                break;
            }
        }
    }
    if (classCloseIndex === -1) {
        throw new Error(`无法确定 class ${componentName} 的结束位置: ${scriptPath}`);
    }

    const eol = detectEol(source);
    const methodText = `${eol}    public ${handlerName}() {${eol}    }${eol}`;
    const updated = `${source.slice(0, classCloseIndex)}${methodText}${source.slice(classCloseIndex)}`;
    fs.writeFileSync(scriptPath, updated, 'utf8');
    return { changed: true };
}

function applyClickEventChange({ artifacts, plan, sourceNodePath, targetNodePath, componentName, handlerName }) {
    const scriptMetaCatalog = buildScriptMetaCatalog(artifacts.scan);
    const assetUuidToPath = buildAssetUuidPathMap(artifacts.graph);
    const scriptRecord = scriptMetaCatalog.byComponentName.get(componentName);
    if (!scriptRecord?.uuid || !scriptRecord.scriptPath) {
        throw new Error(`无法解析目标组件脚本 UUID: ${componentName}`);
    }

    const doc = loadPrefabDocument(plan.prefab.prefabPath, scriptMetaCatalog);
    doc.assetUuidToPath = assetUuidToPath;
    const changes = [];

    const buttonResult = ensureButtonComponent(doc, sourceNodePath);
    if (buttonResult.changed) {
        changes.push({ file: normalize(plan.prefab.prefabPath), kind: 'prefab', action: 'attach-built-in-component' });
    }

    const targetComponentResult = ensureComponent(doc, targetNodePath, {
        typeName: scriptRecord.uuid,
        componentName,
        defaults: {},
    });
    if (targetComponentResult.changed) {
        changes.push({ file: normalize(plan.prefab.prefabPath), kind: 'prefab', action: 'attach-component' });
    }

    const methodResult = insertMethodStub(scriptRecord.scriptPath, componentName, handlerName);
    if (methodResult.changed) {
        changes.push({ file: normalize(scriptRecord.scriptPath), kind: 'script', action: 'add-method' });
    }

    const clickEventResult = ensureClickEvent(doc, buttonResult.component, targetNodePath, scriptRecord.uuid, handlerName);
    if (clickEventResult.changed) {
        changes.push({ file: normalize(plan.prefab.prefabPath), kind: 'prefab', action: 'bind-event' });
    }

    if (changes.some(item => item.kind === 'prefab')) {
        writePrefabDocument(doc);
    }

    return {
        changed: changes.length > 0,
        changes,
    };
}

function buildAssetUuidPathMap(graph = { nodes: [] }) {
    const map = new Map();
    for (const node of graph.nodes || []) {
        if (node.type !== 'asset' || !node.meta?.uuid) {
            continue;
        }
        map.set(node.meta.uuid, node.meta.assetPath || node.file || '');
    }
    return map;
}

function resolveTargetComponent(doc, componentName, query = '') {
    const scopedQuery = String(query || '').trim();
    const [namePart, nodePathPart] = scopedQuery.includes('@') ? scopedQuery.split('@') : [scopedQuery, ''];
    const targetName = namePart || componentName;
    const matches = findComponentCandidates(doc, targetName)
        .filter(item => !nodePathPart || item.nodePath === nodePathPart);

    if (matches.length === 1) {
        return { kind: 'same-prefab', component: matches[0] };
    }
    if (matches.length > 1) {
        throw new Error(`目标组件不唯一，请使用 Component@NodePath 形式指定: ${targetName}`);
    }
    return null;
}

function applyFieldBindingChange({ artifacts, plan, componentNodePath, componentName, fieldName, targetNode, targetComponent, targetAsset }) {
    const scriptMetaCatalog = buildScriptMetaCatalog(artifacts.scan);
    const assetCatalog = buildAssetCatalog(artifacts.graph);
    const assetUuidToPath = buildAssetUuidPathMap(artifacts.graph);
    const scriptRecord = scriptMetaCatalog.byComponentName.get(componentName);
    if (!scriptRecord?.uuid || !scriptRecord.scriptPath) {
        throw new Error(`无法解析 owner 组件脚本 UUID: ${componentName}`);
    }

    const doc = loadPrefabDocument(plan.prefab.prefabPath, scriptMetaCatalog);
    doc.assetUuidToPath = assetUuidToPath;
    const ownerResult = ensureComponent(doc, componentNodePath, {
        typeName: scriptRecord.uuid,
        componentName,
        defaults: {},
    });
    const ownerComponent = ownerResult.component;
    const changes = [];

    if (ownerResult.changed) {
        changes.push({ file: normalize(plan.prefab.prefabPath), kind: 'prefab', action: 'attach-component' });
    }

    const bindingKind = plan.field.bindingKind;
    if (bindingKind === 'node') {
        const targetNodeId = doc.nodeIdByPath.get(targetNode);
        if (targetNodeId == null) {
            throw new Error(`prefab 中未找到 target node: ${targetNode}`);
        }
        setFieldNodeReference(ownerComponent, fieldName, targetNodeId);
        changes.push({ file: normalize(plan.prefab.prefabPath), kind: 'prefab', action: 'bind-field' });
    } else if (bindingKind === 'asset') {
        const assetNode = assetCatalog.byName.get(targetAsset) || assetCatalog.byPath.get(targetAsset);
        const assetUuid = assetNode?.meta?.uuid || '';
        if (!assetUuid) {
            throw new Error(`未找到 target asset: ${targetAsset}`);
        }
        setFieldAssetReference(ownerComponent, fieldName, assetUuid);
        changes.push({ file: normalize(plan.prefab.prefabPath), kind: 'prefab', action: 'bind-field' });
    } else if (bindingKind === 'component') {
        const samePrefabTarget = resolveTargetComponent(doc, targetComponent, targetComponent);
        if (samePrefabTarget?.component) {
            setFieldComponentReference(ownerComponent, fieldName, samePrefabTarget.component.id);
            changes.push({ file: normalize(plan.prefab.prefabPath), kind: 'prefab', action: 'bind-field' });
        } else {
            const nestedTargets = findNestedPrefabTargets(doc, scriptMetaCatalog, targetComponent);
            if (nestedTargets.length !== 1) {
                throw new Error(nestedTargets.length > 1
                    ? `nested prefab 中的目标组件不唯一: ${targetComponent}`
                    : `未找到 target component: ${targetComponent}`);
            }
            const nestedTarget = nestedTargets[0];
            ensureTargetOverride(doc, ownerComponent, fieldName, nestedTarget.parentNodeId, nestedTarget.nestedComponent.fileId);
            changes.push({ file: normalize(plan.prefab.prefabPath), kind: 'prefab', action: 'bind-field-override' });
        }
    } else {
        throw new Error(`当前字段类型不支持自动绑定: ${bindingKind}`);
    }

    if (changes.some(item => item.kind === 'prefab')) {
        writePrefabDocument(doc);
    }

    return {
        changed: changes.length > 0,
        changes,
    };
}

module.exports = {
    applyClickEventChange,
    applyFieldBindingChange,
    buildAssetCatalog,
    buildScriptMetaCatalog,
    loadPrefabDocument,
};
