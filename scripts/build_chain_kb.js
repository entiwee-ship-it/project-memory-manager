#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { runExtract } = require('./extract_feature_facts');
const { hasOwn, inferArea, inferStacks, loadProjectProfile, normalize, pathExists, readJson, repoRelative, resolveProjectRoot, slugify, timestamp, writeJson } = require('./lib/common');

function parseArgs(argv) {
    const args = { config: '', root: '' };
    for (let index = 0; index < argv.length; index++) {
        if (argv[index] === '--config') {
            args.config = argv[++index];
            continue;
        }
        if (argv[index] === '--root') {
            args.root = argv[++index];
        }
    }
    if (!args.config) {
        throw new Error('用法: node build_chain_kb.js --config <path> [--root <repo-root>]');
    }
    return args;
}

function methodKey(scriptPath, methodName) {
    return `${scriptPath}::${methodName}`;
}

function makeNodeId(type, ...parts) {
    return `${type}:${parts.map(part => slugify(part)).join(':')}`;
}

function unique(values) {
    return Array.from(new Set((values || []).filter(Boolean)));
}

const TAG_SYNONYMS = {
    loadmore: ['loadmore', 'load-more', 'load_more', '分页', '分页加载', '加载更多', '滚动加载'],
    page: ['page', 'pages', 'pagination', '分页'],
    record: ['record', 'records', '记录'],
    list: ['list', '列表'],
    scroll: ['scroll', '滚动'],
    refresh: ['refresh', '刷新'],
    click: ['click', '点击'],
    request: ['request', '请求'],
    loading: ['loading', '加载中'],
    state: ['state', '状态'],
};

function tokenizeText(value) {
    return String(value || '')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[_./:@-]+/g, ' ')
        .split(/\s+/)
        .map(token => token.trim().toLowerCase())
        .filter(Boolean);
}

function buildSearchTags(...values) {
    const tags = new Set();
    for (const value of values) {
        const normalized = String(value || '').trim();
        if (!normalized) {
            continue;
        }

        const compact = normalized.toLowerCase();
        tags.add(compact);
        for (const [keyword, aliases] of Object.entries(TAG_SYNONYMS)) {
            if (compact.includes(keyword)) {
                tags.add(keyword);
                aliases.forEach(alias => tags.add(alias.toLowerCase()));
            }
        }
        for (const token of tokenizeText(normalized)) {
            tags.add(token);
            if (hasOwn(TAG_SYNONYMS, token)) {
                TAG_SYNONYMS[token].forEach(alias => tags.add(alias.toLowerCase()));
            }
        }
    }
    return Array.from(tags).sort((left, right) => left.localeCompare(right));
}

function asArray(value) {
    if (Array.isArray(value)) {
        return value.filter(Boolean);
    }
    return value ? [value] : [];
}

function hasGlobMagic(segment) {
    return /[*?[\]]/.test(segment);
}

function matchGlobSegment(name, pattern) {
    const escaped = pattern.replace(/[.+^${}()|\\]/g, '\\$&');
    const regex = new RegExp(`^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.').replace(/\[/g, '[').replace(/\]/g, ']')}$`);
    return regex.test(name);
}

function expandGlobSegments(basePath, segments, index = 0, results = []) {
    if (index >= segments.length) {
        if (pathExists(basePath)) {
            results.push(path.resolve(basePath));
        }
        return results;
    }

    const segment = segments[index];
    if (segment === '**') {
        expandGlobSegments(basePath, segments, index + 1, results);
        if (!pathExists(basePath) || !fs.statSync(basePath).isDirectory()) {
            return results;
        }
        for (const entry of fs.readdirSync(basePath, { withFileTypes: true })) {
            if (!entry.isDirectory()) {
                continue;
            }
            expandGlobSegments(path.join(basePath, entry.name), segments, index, results);
        }
        return results;
    }

    if (!hasGlobMagic(segment)) {
        expandGlobSegments(path.join(basePath, segment), segments, index + 1, results);
        return results;
    }

    if (!pathExists(basePath) || !fs.statSync(basePath).isDirectory()) {
        return results;
    }

    for (const entry of fs.readdirSync(basePath, { withFileTypes: true })) {
        if (!matchGlobSegment(entry.name, segment)) {
            continue;
        }
        expandGlobSegments(path.join(basePath, entry.name), segments, index + 1, results);
    }
    return results;
}

function expandConfiguredTarget(root, input) {
    const rawInput = String(input || '').trim();
    if (!rawInput) {
        return [];
    }

    const absoluteInput = path.isAbsolute(rawInput) ? rawInput : path.resolve(root, rawInput);
    if (!hasGlobMagic(absoluteInput)) {
        return pathExists(absoluteInput) ? [path.resolve(absoluteInput)] : [];
    }

    const parsed = path.parse(absoluteInput);
    const rootBase = parsed.root || path.dirname(absoluteInput);
    const tail = absoluteInput.slice(rootBase.length);
    const segments = tail.split(/[\\/]+/).filter(Boolean);
    return Array.from(new Set(expandGlobSegments(rootBase, segments)));
}

function expandConfiguredTargets(root, inputs = []) {
    return Array.from(
        new Set(
            inputs.flatMap(input => expandConfiguredTarget(root, input))
        )
    ).sort((left, right) => left.localeCompare(right));
}

function deriveExtractInputs(config, root) {
    const scanTargets = config.scanTargets && typeof config.scanTargets === 'object' ? config.scanTargets : {};
    const componentInputs = [...asArray(config.componentRoots)];
    const assetInputs = [...asArray(config.assetRoots)];
    const methodInputs = [
        ...asArray(config.methodRoots),
        ...asArray(config.serverRoots),
        ...asArray(config.moduleRoots),
        ...asArray(config.dbRoots),
    ];

    for (const [key, value] of Object.entries(scanTargets)) {
        if (/^components?$/i.test(key)) {
            componentInputs.push(...asArray(value));
            continue;
        }
        if (/^assets?$/i.test(key)) {
            assetInputs.push(...asArray(value));
            continue;
        }
        methodInputs.push(...asArray(value));
    }

    return {
        componentRoots: expandConfiguredTargets(root, componentInputs),
        assetRoots: expandConfiguredTargets(root, assetInputs),
        methodRoots: expandConfiguredTargets(root, methodInputs),
        prefabs: expandConfiguredTargets(root, asArray(config.prefabs)),
    };
}

function mapCallbackInvocation(invocationName, argMap) {
    const mappedArg = String(argMap.get(invocationName) || '').trim();
    if (!mappedArg) {
        return { localCalls: [], callbackInvocations: [invocationName] };
    }

    const thisMatch = mappedArg.match(/^this\.([A-Za-z_$][\w$]*)$/);
    if (thisMatch) {
        return { localCalls: [thisMatch[1]], callbackInvocations: [] };
    }

    return { localCalls: [], callbackInvocations: [mappedArg] };
}

function collectEffectiveNetworkRequests(methodInfo, methodMap, stack = new Set()) {
    const currentKey = methodKey(methodInfo.scriptPath, methodInfo.name);
    if (stack.has(currentKey)) {
        return [];
    }

    const nextStack = new Set(stack);
    nextStack.add(currentKey);
    const effective = [];

    for (const request of methodInfo.networkRequests || []) {
        effective.push({
            ...request,
            viaMethod: '',
            callbackLocalCalls: request.callbackLocalCalls || [],
            callbackFieldCalls: request.callbackFieldCalls || [],
            callbackImportedCalls: request.callbackImportedCalls || [],
            callbackEventDispatches: request.callbackEventDispatches || [],
            callbackInvocations: request.callbackInvocations || [],
        });
    }

    for (const callSite of methodInfo.localCallSites || []) {
        const callee = methodMap.get(methodKey(methodInfo.scriptPath, callSite.method));
        if (!callee) {
            continue;
        }

        const argMap = new Map();
        (callee.paramNames || []).forEach((paramName, index) => {
            argMap.set(paramName, (callSite.args || [])[index] || '');
        });

        for (const nested of collectEffectiveNetworkRequests(callee, methodMap, nextStack)) {
            const callbackLocalCalls = [...(nested.callbackLocalCalls || [])];
            const callbackInvocations = [];

            for (const invocationName of nested.callbackInvocations || []) {
                const mapped = mapCallbackInvocation(invocationName, argMap);
                callbackLocalCalls.push(...mapped.localCalls);
                callbackInvocations.push(...mapped.callbackInvocations);
            }

            effective.push({
                ...nested,
                viaMethod: nested.viaMethod || callSite.method,
                callbackLocalCalls: unique(callbackLocalCalls),
                callbackInvocations: unique(callbackInvocations),
            });
        }
    }

    const deduped = new Map();
    for (const request of effective) {
        const key = [
            request.callee,
            request.target,
            request.viaMethod || '',
            (request.callbackLocalCalls || []).join(','),
            (request.callbackInvocations || []).join(','),
        ].join('::');
        if (!deduped.has(key)) {
            deduped.set(key, request);
        }
    }

    return Array.from(deduped.values());
}

function buildMethodMap(raw) {
    const map = new Map();
    for (const script of raw.scripts || []) {
        for (const method of script.methods || []) {
            map.set(methodKey(script.scriptPath, method.name), {
                ...method,
                scriptPath: script.scriptPath,
                scriptSummary: script.summary || '',
            });
        }
    }
    return map;
}

function inferPinusMethodRoutes(scriptPath, methodName) {
    const normalizedPath = normalize(scriptPath);
    const pinusMatch = normalizedPath.match(/(?:^|\/)app\/servers\/([^/]+)\/(handler|remote)\/([^/]+)\.[^.]+$/);
    if (!pinusMatch) {
        return [];
    }

    const [, serverType, layer, serviceName] = pinusMatch;
    return unique([
        `${serverType}.${serviceName}.${methodName}`,
        `app.rpc.${serverType}.${serviceName}.${methodName}`,
        `${layer}.${serverType}.${serviceName}.${methodName}`,
    ]);
}

function inferPinusRouteMeta(scriptPath) {
    const normalizedPath = normalize(scriptPath);
    const pinusMatch = normalizedPath.match(/(?:^|\/)app\/servers\/([^/]+)\/(handler|remote)\/([^/]+)\.[^.]+$/);
    if (!pinusMatch) {
        return null;
    }

    const [, serverType, layer] = pinusMatch;
    return {
        serverType,
        layer,
        kind: layer === 'handler' ? 'pinus-handler' : 'pinus-remote',
        protocol: layer === 'handler' ? 'pinus' : 'pinus-rpc',
    };
}

function buildMethodRouteMap(methodMap) {
    const routeMap = new Map();

    for (const methodInfo of methodMap.values()) {
        for (const route of inferPinusMethodRoutes(methodInfo.scriptPath, methodInfo.name)) {
            routeMap.set(String(route || '').trim().toLowerCase(), {
                scriptPath: methodInfo.scriptPath,
                methodName: methodInfo.name,
            });
        }
    }

    return routeMap;
}

function resolveNetworkRequestRoute(request = {}) {
    if (request.route) {
        return String(request.route).trim();
    }
    if (request.protocol === 'pinus-rpc' && request.target) {
        return String(request.target).trim();
    }
    return '';
}

function buildFeatureRecord(config, configPath) {
    return {
        featureKey: config.featureKey,
        featureName: config.featureName,
        summary: config.summary || '',
        areas: Array.isArray(config.areas) ? config.areas : [],
        configPath,
        docsDir: config.docs?.featureDir || '',
        kbDir: `project-memory/kb/features/${config.featureKey}`,
        outputs: config.outputs || {},
    };
}

function upsertFeatureRegistry(root, featureRecord) {
    const registryPath = path.join(root, 'project-memory', 'state', 'feature-registry.json');
    const indexPath = path.join(root, 'project-memory', 'kb', 'indexes', 'features.json');
    const generatedAt = timestamp();
    const registry = pathExists(registryPath)
        ? readJson(registryPath)
        : { generatedAt: null, features: [] };
    const features = Array.isArray(registry.features) ? [...registry.features] : [];
    const existingIndex = features.findIndex(item => item.featureKey === featureRecord.featureKey);

    if (existingIndex >= 0) {
        features[existingIndex] = {
            ...features[existingIndex],
            ...featureRecord,
        };
    } else {
        features.push(featureRecord);
    }

    features.sort((left, right) => String(left.featureKey || '').localeCompare(String(right.featureKey || '')));

    writeJson(registryPath, {
        generatedAt,
        features,
    });
    writeJson(indexPath, {
        generatedAt,
        features,
    });
}

function buildGraph(raw, config, projectProfile, root) {
    const nodes = [];
    const edges = [];
    const nodeMap = new Map();
    const edgeSet = new Set();
    const featureId = makeNodeId('module', config.featureKey);
    const methodMap = buildMethodMap(raw);
    const methodRouteMap = buildMethodRouteMap(methodMap);
    const componentNodeMap = new Map();

    const addNode = node => {
        if (nodeMap.has(node.id)) {
            const existingNode = nodeMap.get(node.id);
            existingNode.name = node.name || existingNode.name;
            existingNode.file = node.file || existingNode.file;
            existingNode.line = node.line != null ? node.line : existingNode.line;
            existingNode.area = node.area && node.area !== 'unknown' ? node.area : existingNode.area;
            existingNode.stack = (node.stack || []).length > 0 ? node.stack : existingNode.stack;
            const mergedMeta = {
                ...(existingNode.meta || {}),
                ...(node.meta || {}),
            };
            mergedMeta.tags = unique([...(existingNode.meta?.tags || []), ...(node.meta?.tags || [])]);
            existingNode.meta = {
                ...mergedMeta,
            };
            return existingNode;
        }
        const normalizedNode = {
            line: null,
            file: '',
            area: 'unknown',
            stack: [],
            meta: { tags: [] },
            ...node,
        };
        normalizedNode.meta = {
            tags: [],
            ...(normalizedNode.meta || {}),
        };
        nodes.push(normalizedNode);
        nodeMap.set(node.id, normalizedNode);
        return normalizedNode;
    };

    const addEdge = edge => {
        const normalizedEdge = {
            area: 'unknown',
            meta: {},
            ...edge,
        };
        const key = [
            normalizedEdge.from,
            normalizedEdge.to,
            normalizedEdge.type,
            normalizedEdge.sourceKind,
            JSON.stringify(normalizedEdge.meta),
        ].join('::');
        if (edgeSet.has(key)) {
            return;
        }
        edgeSet.add(key);
        edges.push(normalizedEdge);
    };

    const inferNodeArea = filePath => inferArea(path.resolve(root, filePath), config, projectProfile, root);

    const appendNodeTags = (node, ...values) => {
        if (!node) {
            return;
        }
        node.meta = {
            ...(node.meta || {}),
            tags: unique([...(node.meta?.tags || []), ...buildSearchTags(...values)]),
        };
    };

    const ensureScriptNode = scriptPath => {
        const absolutePath = path.resolve(root, scriptPath);
        const area = inferNodeArea(scriptPath);
        const scriptNode = addNode({
            id: makeNodeId('script', scriptPath),
            type: 'script',
            name: path.basename(scriptPath),
            file: normalize(absolutePath),
            area,
            stack: inferStacks(area, projectProfile),
        });
        appendNodeTags(scriptNode, scriptPath, path.basename(scriptPath));
        return scriptNode;
    };

    const ensureMethodNode = (scriptPath, methodName, options = {}) => {
        const scriptNode = ensureScriptNode(scriptPath);
        const methodInfo = methodMap.get(methodKey(scriptPath, methodName)) || null;
        const area = options.area || methodInfo?.area || scriptNode.area || inferNodeArea(scriptPath);
        const routeTags = inferPinusMethodRoutes(scriptPath, methodName);
        const methodNode = addNode({
            id: makeNodeId('method', scriptPath, methodName),
            type: 'method',
            name: `${path.basename(scriptPath, path.extname(scriptPath))}.${methodName}`,
            file: scriptNode.file || normalize(path.resolve(root, scriptPath)),
            line: options.line != null ? options.line : (methodInfo?.line ?? null),
            area,
            stack: inferStacks(area, projectProfile),
            meta: {
                methodName,
                scriptPath,
                summary: options.summary || methodInfo?.summary || methodInfo?.scriptSummary || '',
                synthetic: !methodInfo,
            },
        });
        appendNodeTags(methodNode, methodName, methodNode.name, scriptPath, options.summary || methodInfo?.summary || '');
        appendNodeTags(methodNode, ...routeTags);
        addEdge({ from: scriptNode.id, to: methodNode.id, type: 'contains', sourceKind: 'script', area });
        return methodNode;
    };

    const ensureStateNode = (scriptPath, statePath) => {
        const scriptNode = ensureScriptNode(scriptPath);
        const area = scriptNode.area || inferNodeArea(scriptPath);
        const stateNode = addNode({
            id: makeNodeId('state', scriptPath, statePath),
            type: 'state',
            name: `${path.basename(scriptPath, path.extname(scriptPath))}.${statePath}`,
            file: scriptNode.file || normalize(path.resolve(root, scriptPath)),
            area,
            stack: inferStacks(area, projectProfile),
            meta: {
                statePath,
                scriptPath,
            },
        });
        appendNodeTags(stateNode, statePath, stateNode.name, scriptPath, 'state');
        addEdge({ from: scriptNode.id, to: stateNode.id, type: 'contains', sourceKind: 'script', area });
        return stateNode;
    };

    const ensureEndpointNode = (scriptPath, endpointInfo, line = null, area = inferNodeArea(scriptPath)) => {
        const scriptNode = ensureScriptNode(scriptPath);
        const endpointNode = addNode({
            id: makeNodeId('endpoint', endpointInfo.method, endpointInfo.path),
            type: 'endpoint',
            name: `${endpointInfo.method} ${endpointInfo.path}`,
            file: scriptNode.file || normalize(path.resolve(root, scriptPath)),
            line,
            area,
            stack: inferStacks(area, projectProfile),
            meta: {
                method: endpointInfo.method,
                path: endpointInfo.path,
                handlerName: endpointInfo.handlerName || '',
            },
        });
        appendNodeTags(endpointNode, endpointInfo.method, endpointInfo.path, endpointInfo.handlerName || '', 'endpoint');
        addEdge({ from: scriptNode.id, to: endpointNode.id, type: 'contains', sourceKind: 'endpoint', area });
        return endpointNode;
    };

    const ensureRouteNode = (scriptPath, routeInfo, line = null, area = inferNodeArea(scriptPath)) => {
        const routeKey = routeInfo.kind || routeInfo.protocol || 'route';
        const routeNode = addNode({
            id: makeNodeId('route', routeKey, routeInfo.route),
            type: 'route',
            name: routeInfo.route,
            file: scriptPath ? normalize(path.resolve(root, scriptPath)) : '',
            line,
            area,
            stack: inferStacks(area, projectProfile),
            meta: {
                kind: routeInfo.kind || '',
                protocol: routeInfo.protocol || '',
                route: routeInfo.route,
                handler: routeInfo.handler || '',
            },
        });
        appendNodeTags(routeNode, routeInfo.route, routeInfo.kind || '', routeInfo.protocol || '', routeInfo.handler || '', 'route');
        if (scriptPath) {
            const scriptNode = ensureScriptNode(scriptPath);
            addEdge({ from: scriptNode.id, to: routeNode.id, type: 'contains', sourceKind: 'route', area });
        }
        return routeNode;
    };

    const ensureTableNode = tableAccess => {
        const tableArea = 'data';
        const tableNode = addNode({
            id: makeNodeId('table', tableAccess.importPath || 'table', tableAccess.tableName),
            type: 'table',
            name: tableAccess.tableName,
            file: tableAccess.importPath || '',
            area: tableArea,
            stack: inferStacks(tableArea, projectProfile),
            meta: {
                importPath: tableAccess.importPath || '',
            },
        });
        appendNodeTags(tableNode, tableAccess.tableName, tableAccess.importPath || '', 'table');
        return tableNode;
    };

    const makeComponentKey = (prefabPath, nodePath, componentName) => [prefabPath, nodePath || '', componentName || ''].join('::');

    addNode({
        id: featureId,
        type: 'module',
        name: config.featureName,
        file: config.docs?.featureIndex || '',
        area: (config.areas || [])[0] || 'unknown',
        meta: {
            featureKey: config.featureKey,
            uiEntry: config.uiEntry || '',
            summary: config.summary || '',
        },
    });
    appendNodeTags(nodeMap.get(featureId), config.featureKey, config.featureName, config.summary || '');

    for (const prefab of raw.prefabs || []) {
        const prefabNode = addNode({
            id: makeNodeId('component', 'prefab', prefab.prefabPath),
            type: 'component',
            name: path.basename(prefab.prefabPath, path.extname(prefab.prefabPath)),
            file: prefab.prefabPath,
            area: 'frontend',
            stack: inferStacks('frontend', projectProfile),
            meta: { category: 'prefab' },
        });
        appendNodeTags(prefabNode, prefab.prefabPath, prefabNode.name, 'prefab');
        addEdge({ from: featureId, to: prefabNode.id, type: 'contains', sourceKind: 'prefab', area: 'frontend' });

        for (const component of prefab.customComponents || []) {
            const componentNode = addNode({
                id: makeNodeId('component', prefab.prefabPath, component.nodePath, component.componentName),
                type: 'component',
                name: `${component.componentName}@${component.nodePath}`,
                file: component.scriptPath || prefab.prefabPath,
                area: component.scriptPath ? inferNodeArea(component.scriptPath) : 'frontend',
                stack: component.scriptPath
                    ? inferStacks(inferNodeArea(component.scriptPath), projectProfile)
                    : inferStacks('frontend', projectProfile),
                meta: {
                    prefabPath: prefab.prefabPath,
                    nodePath: component.nodePath,
                    rawType: component.rawType,
                },
            });
            appendNodeTags(componentNode, component.componentName, component.nodePath, component.rawType || '', component.scriptPath || '');
            componentNodeMap.set(makeComponentKey(prefab.prefabPath, component.nodePath, component.componentName), componentNode.id);
            addEdge({ from: prefabNode.id, to: componentNode.id, type: 'contains', sourceKind: 'prefab', area: componentNode.area });
            if (component.scriptPath) {
                const scriptNode = ensureScriptNode(component.scriptPath);
                addEdge({ from: componentNode.id, to: scriptNode.id, type: 'binds', sourceKind: 'prefab', area: componentNode.area });
            }
        }

        for (const eventInfo of prefab.events || []) {
            if (!eventInfo.targetScriptPath || !eventInfo.handler) {
                continue;
            }
            const sourceComponentId =
                componentNodeMap.get(makeComponentKey(prefab.prefabPath, eventInfo.sourceNodePath, eventInfo.sourceComponent)) || prefabNode.id;
            const sourceArea = nodeMap.get(sourceComponentId)?.area || 'frontend';
            const targetMethodNode = ensureMethodNode(eventInfo.targetScriptPath, eventInfo.handler, { area: sourceArea });
            appendNodeTags(nodeMap.get(sourceComponentId), eventInfo.sourceKind, eventInfo.handler, eventInfo.sourceNodePath, eventInfo.targetComponentName || '');
            appendNodeTags(targetMethodNode, eventInfo.sourceKind, eventInfo.handler, eventInfo.targetComponentName || '');
            addEdge({
                from: sourceComponentId,
                to: targetMethodNode.id,
                type: 'binds',
                sourceKind: 'prefab',
                area: sourceArea,
                meta: {
                    sourceNodePath: eventInfo.sourceNodePath,
                    sourceComponent: eventInfo.sourceComponent || '',
                    sourceEventKind: eventInfo.sourceKind,
                    handler: eventInfo.handler,
                },
            });
        }
    }

    for (const script of raw.scripts || []) {
        const scriptNode = ensureScriptNode(script.scriptPath);
        addEdge({ from: featureId, to: scriptNode.id, type: 'contains', sourceKind: 'script', area: scriptNode.area });

        for (const importInfo of script.imports || []) {
            if (!importInfo.resolvedPath) {
                continue;
            }
            const dependencyNode = ensureScriptNode(importInfo.resolvedPath);
            addEdge({
                from: scriptNode.id,
                to: dependencyNode.id,
                type: 'depends_on',
                sourceKind: 'script',
                area: scriptNode.area,
                meta: { importSpecifier: importInfo.specifier },
            });
        }

        for (const method of script.methods || []) {
            const methodArea = inferNodeArea(script.scriptPath);
            const currentMethodNode = ensureMethodNode(script.scriptPath, method.name, {
                area: methodArea,
                line: method.line,
                summary: method.summary || '',
            });
            const currentMethodId = currentMethodNode.id;
            addEdge({ from: scriptNode.id, to: currentMethodId, type: 'contains', sourceKind: 'script', area: methodArea });

            for (const endpointInfo of method.httpEndpoints || []) {
                const endpointNode = ensureEndpointNode(script.scriptPath, endpointInfo, method.line, methodArea);
                addEdge({
                    from: endpointNode.id,
                    to: currentMethodId,
                    type: 'binds',
                    sourceKind: 'endpoint',
                    area: methodArea,
                    meta: {
                        method: endpointInfo.method,
                        path: endpointInfo.path,
                        handlerName: endpointInfo.handlerName || '',
                    },
                });
            }

            for (const routeInfo of method.messageRoutes || []) {
                if (!routeInfo.route) {
                    continue;
                }
                const routeNode = ensureRouteNode(script.scriptPath, routeInfo, method.line, methodArea);
                addEdge({
                    from: routeInfo.role === 'dispatcher' ? currentMethodId : routeNode.id,
                    to: routeInfo.role === 'dispatcher' ? routeNode.id : currentMethodId,
                    type: 'binds',
                    sourceKind: 'route',
                    area: methodArea,
                    meta: {
                        kind: routeInfo.kind || '',
                        protocol: routeInfo.protocol || '',
                        route: routeInfo.route,
                        handler: routeInfo.handler || '',
                        role: routeInfo.role || 'handler',
                    },
                });
            }

            for (const localMethod of method.localCalls || []) {
                const targetMethodNode = ensureMethodNode(script.scriptPath, localMethod, { area: methodArea });
                addEdge({ from: currentMethodId, to: targetMethodNode.id, type: 'calls', sourceKind: 'script', area: methodArea });
            }

            for (const fieldCall of method.fieldCalls || []) {
                if (!fieldCall.sourcePath) {
                    continue;
                }
                const targetMethodNode = ensureMethodNode(fieldCall.sourcePath, fieldCall.method);
                addEdge({
                    from: currentMethodId,
                    to: targetMethodNode.id,
                    type: 'field_calls',
                    sourceKind: 'script',
                    area: methodArea,
                    meta: {
                        fieldName: fieldCall.fieldName,
                        fieldType: fieldCall.fieldType,
                    },
                });
            }

            for (const importedCall of method.importedCalls || []) {
                if (!importedCall.sourcePath) {
                    continue;
                }
                const targetMethodNode = ensureMethodNode(importedCall.sourcePath, importedCall.method);
                addEdge({
                    from: currentMethodId,
                    to: targetMethodNode.id,
                    type: 'calls',
                    sourceKind: importedCall.isApi ? 'network' : 'script',
                    area: methodArea,
                    meta: {
                        identifier: importedCall.identifier,
                        isApi: importedCall.isApi,
                    },
                });
            }

            for (const subscription of method.eventSubscriptions || []) {
                const eventId = makeNodeId('event', subscription.bus, subscription.event);
                addNode({
                    id: eventId,
                    type: 'event',
                    name: subscription.event,
                    file: script.scriptPath,
                    line: method.line,
                    area: methodArea,
                    stack: inferStacks(methodArea, projectProfile),
                    meta: { bus: subscription.bus },
                });
                appendNodeTags(nodeMap.get(eventId), subscription.event, subscription.bus, subscription.mode);
                addEdge({
                    from: currentMethodId,
                    to: eventId,
                    type: 'subscribes',
                    sourceKind: 'event',
                    area: methodArea,
                    meta: {
                        mode: subscription.mode,
                        via: subscription.via || '',
                        inlineActions: subscription.inlineActions || null,
                    },
                });
            }

            for (const dispatch of method.eventDispatches || []) {
                const eventId = makeNodeId('event', dispatch.bus, dispatch.event);
                addNode({
                    id: eventId,
                    type: 'event',
                    name: dispatch.event,
                    file: script.scriptPath,
                    line: method.line,
                    area: methodArea,
                    stack: inferStacks(methodArea, projectProfile),
                    meta: { bus: dispatch.bus },
                });
                appendNodeTags(nodeMap.get(eventId), dispatch.event, dispatch.bus, dispatch.mode);
                addEdge({
                    from: currentMethodId,
                    to: eventId,
                    type: 'emits',
                    sourceKind: 'event',
                    area: methodArea,
                    meta: { mode: dispatch.mode },
                });
            }

            for (const notifyRoute of method.notifyRoutes || []) {
                if (!notifyRoute.route) {
                    continue;
                }
                const routeNode = ensureRouteNode(
                    script.scriptPath,
                    {
                        kind: notifyRoute.kind || 'notify',
                        protocol: notifyRoute.protocol || 'socket',
                        route: notifyRoute.route,
                        handler: '',
                    },
                    method.line,
                    methodArea
                );
                addEdge({
                    from: currentMethodId,
                    to: routeNode.id,
                    type: 'emits',
                    sourceKind: 'route',
                    area: methodArea,
                    meta: {
                        kind: notifyRoute.kind || '',
                        protocol: notifyRoute.protocol || '',
                        route: notifyRoute.route,
                        callee: notifyRoute.callee || '',
                    },
                });
            }

            const methodInfo = methodMap.get(methodKey(script.scriptPath, method.name));
            const effectiveRequests = collectEffectiveNetworkRequests(methodInfo, methodMap);
            for (const request of effectiveRequests) {
                const requestId = makeNodeId('request', request.callee, request.target || request.callee);
                const requestRoute = resolveNetworkRequestRoute(request);
                addNode({
                    id: requestId,
                    type: 'request',
                    name: request.target || request.callee,
                    file: script.scriptPath,
                    line: method.line,
                    area: methodArea,
                    stack: inferStacks(methodArea, projectProfile),
                    meta: {
                        callee: request.callee,
                        callbackKind: request.callbackKind,
                        route: requestRoute,
                    },
                });
                appendNodeTags(nodeMap.get(requestId), request.target || request.callee, request.callee, requestRoute, 'request');
                addEdge({
                    from: currentMethodId,
                    to: requestId,
                    type: 'requests',
                    sourceKind: 'network',
                    area: methodArea,
                    meta: {
                        callee: request.callee,
                        target: request.target,
                        viaMethod: request.viaMethod || '',
                    },
                });

                if (requestRoute) {
                    const targetMethodRef = methodRouteMap.get(requestRoute.toLowerCase());
                    const routeMeta = targetMethodRef ? inferPinusRouteMeta(targetMethodRef.scriptPath) : null;
                    const routeNode = ensureRouteNode(
                        targetMethodRef?.scriptPath || script.scriptPath,
                        {
                            kind: routeMeta?.kind || 'network-route',
                            protocol: routeMeta?.protocol || request.protocol || '',
                            route: requestRoute,
                            handler: targetMethodRef?.methodName || '',
                        },
                        method.line,
                        targetMethodRef ? inferNodeArea(targetMethodRef.scriptPath) : methodArea
                    );
                    addEdge({
                        from: requestId,
                        to: routeNode.id,
                        type: 'depends_on',
                        sourceKind: 'network',
                        area: methodArea,
                        meta: {
                            protocol: request.protocol || '',
                            route: requestRoute,
                        },
                    });
                    if (targetMethodRef) {
                        const targetMethodNode = ensureMethodNode(targetMethodRef.scriptPath, targetMethodRef.methodName);
                        addEdge({
                            from: routeNode.id,
                            to: targetMethodNode.id,
                            type: 'binds',
                            sourceKind: 'route',
                            area: targetMethodNode.area,
                            meta: {
                                kind: routeMeta?.kind || '',
                                protocol: routeMeta?.protocol || request.protocol || '',
                                route: requestRoute,
                                handler: targetMethodRef.methodName,
                            },
                        });
                    }
                }

                for (const callbackLocalCall of request.callbackLocalCalls || []) {
                    const callbackMethodNode = ensureMethodNode(script.scriptPath, callbackLocalCall, { area: methodArea });
                    addEdge({
                        from: currentMethodId,
                        to: callbackMethodNode.id,
                        type: 'callback_calls',
                        sourceKind: 'network',
                        area: methodArea,
                        meta: { request: request.target || request.callee },
                    });
                }

                for (const callbackFieldCall of request.callbackFieldCalls || []) {
                    if (!callbackFieldCall.sourcePath) {
                        continue;
                    }
                    const callbackMethodNode = ensureMethodNode(callbackFieldCall.sourcePath, callbackFieldCall.method);
                    addEdge({
                        from: currentMethodId,
                        to: callbackMethodNode.id,
                        type: 'callback_calls',
                        sourceKind: 'network',
                        area: methodArea,
                        meta: {
                            request: request.target || request.callee,
                            fieldName: callbackFieldCall.fieldName,
                        },
                    });
                }

                for (const callbackImportedCall of request.callbackImportedCalls || []) {
                    if (!callbackImportedCall.sourcePath) {
                        continue;
                    }
                    const callbackMethodNode = ensureMethodNode(callbackImportedCall.sourcePath, callbackImportedCall.method);
                    addEdge({
                        from: currentMethodId,
                        to: callbackMethodNode.id,
                        type: 'callback_calls',
                        sourceKind: callbackImportedCall.isApi ? 'network' : 'script',
                        area: methodArea,
                        meta: {
                            request: request.target || request.callee,
                            identifier: callbackImportedCall.identifier,
                            isApi: Boolean(callbackImportedCall.isApi),
                        },
                    });
                }

                for (const callbackDispatch of request.callbackEventDispatches || []) {
                    const eventId = makeNodeId('event', callbackDispatch.bus, callbackDispatch.event);
                    addNode({
                        id: eventId,
                        type: 'event',
                        name: callbackDispatch.event,
                        file: script.scriptPath,
                        line: method.line,
                        area: methodArea,
                        stack: inferStacks(methodArea, projectProfile),
                        meta: { bus: callbackDispatch.bus },
                    });
                    addEdge({
                        from: currentMethodId,
                        to: eventId,
                        type: 'emits',
                        sourceKind: 'network',
                        area: methodArea,
                        meta: {
                            request: request.target || request.callee,
                            mode: callbackDispatch.mode,
                            phase: 'callback',
                        },
                    });
                }
            }

            for (const tableRead of method.dbReads || []) {
                const tableNode = ensureTableNode(tableRead);
                addEdge({
                    from: currentMethodId,
                    to: tableNode.id,
                    type: 'reads',
                    sourceKind: 'table',
                    area: methodArea,
                    meta: {
                        tableName: tableRead.tableName,
                        importPath: tableRead.importPath || '',
                        operation: tableRead.operation || '',
                    },
                });
            }

            for (const tableWrite of method.dbWrites || []) {
                const tableNode = ensureTableNode(tableWrite);
                addEdge({
                    from: currentMethodId,
                    to: tableNode.id,
                    type: 'writes',
                    sourceKind: 'table',
                    area: methodArea,
                    meta: {
                        tableName: tableWrite.tableName,
                        importPath: tableWrite.importPath || '',
                        operation: tableWrite.operation || '',
                    },
                });
            }

            for (const statePath of method.stateReads || []) {
                const stateNode = ensureStateNode(script.scriptPath, statePath);
                addEdge({
                    from: currentMethodId,
                    to: stateNode.id,
                    type: 'reads',
                    sourceKind: 'state',
                    area: methodArea,
                    meta: { statePath },
                });
            }

            for (const statePath of method.stateWrites || []) {
                const stateNode = ensureStateNode(script.scriptPath, statePath);
                addEdge({
                    from: currentMethodId,
                    to: stateNode.id,
                    type: 'writes',
                    sourceKind: 'state',
                    area: methodArea,
                    meta: { statePath },
                });
            }
        }
    }

    return {
        generatedAt: timestamp(),
        featureKey: config.featureKey,
        featureName: config.featureName,
        nodes,
        edges,
    };
}

function buildLookup(graph) {
    const nodesById = Object.fromEntries(graph.nodes.map(node => [node.id, node]));
    const outgoing = {};
    const incoming = {};
    const events = {};
    const methods = {};
    const methodAliases = {};
    const requests = {};
    const routes = {};
    const endpoints = {};
    const states = {};
    const tables = {};
    const nodesByType = {};

    const pushEdge = (bucket, nodeId, edge) => {
        if (!bucket[nodeId]) {
            bucket[nodeId] = [];
        }
        bucket[nodeId].push(edge);
    };

    for (const edge of graph.edges) {
        pushEdge(outgoing, edge.from, edge);
        pushEdge(incoming, edge.to, edge);
    }

    for (const node of graph.nodes) {
        if (!nodesByType[node.type]) {
            nodesByType[node.type] = [];
        }
        nodesByType[node.type].push(node.id);

        if (node.type === 'method') {
            const label = node.name;
            methods[label] = {
                id: node.id,
                file: node.file,
                line: node.line,
                area: node.area,
                stack: node.stack,
                outgoing: outgoing[node.id] || [],
                incoming: incoming[node.id] || [],
            };
            const methodName = node.meta?.methodName || label.split('.').slice(-1)[0];
            if (!methodAliases[methodName]) {
                methodAliases[methodName] = [];
            }
            methodAliases[methodName].push(label);
        }

        if (node.type === 'event') {
            events[node.name] = {
                id: node.id,
                bus: node.meta?.bus || '',
                subscribers: (incoming[node.id] || []).filter(edge => edge.type === 'subscribes').map(edge => nodesById[edge.from]?.name || edge.from),
                emitters: (incoming[node.id] || []).filter(edge => edge.type === 'emits').map(edge => nodesById[edge.from]?.name || edge.from),
            };
        }

        if (node.type === 'request') {
            requests[node.name] = {
                id: node.id,
                callee: node.meta?.callee || '',
                callers: (incoming[node.id] || []).filter(edge => edge.type === 'requests').map(edge => nodesById[edge.from]?.name || edge.from),
            };
        }

        if (node.type === 'route') {
            routes[node.meta?.route || node.name] = {
                id: node.id,
                kind: node.meta?.kind || '',
                protocol: node.meta?.protocol || '',
                binders: (incoming[node.id] || []).filter(edge => edge.type === 'binds').map(edge => nodesById[edge.from]?.name || edge.from),
                handlers: (outgoing[node.id] || []).filter(edge => edge.type === 'binds').map(edge => nodesById[edge.to]?.name || edge.to),
            };
        }

        if (node.type === 'endpoint') {
            endpoints[node.name] = {
                id: node.id,
                method: node.meta?.method || '',
                path: node.meta?.path || '',
                handlers: (outgoing[node.id] || []).filter(edge => edge.type === 'binds').map(edge => nodesById[edge.to]?.name || edge.to),
            };
        }

        if (node.type === 'state') {
            const stateKey = node.meta?.statePath || node.name;
            states[stateKey] = {
                id: node.id,
                file: node.file,
                area: node.area,
                readers: (incoming[node.id] || []).filter(edge => edge.type === 'reads').map(edge => nodesById[edge.from]?.name || edge.from),
                writers: (incoming[node.id] || []).filter(edge => edge.type === 'writes').map(edge => nodesById[edge.from]?.name || edge.from),
            };
        }

        if (node.type === 'table') {
            tables[node.name] = {
                id: node.id,
                importPath: node.meta?.importPath || '',
                readers: (incoming[node.id] || []).filter(edge => edge.type === 'reads').map(edge => nodesById[edge.from]?.name || edge.from),
                writers: (incoming[node.id] || []).filter(edge => edge.type === 'writes').map(edge => nodesById[edge.from]?.name || edge.from),
            };
        }
    }

    return {
        generatedAt: timestamp(),
        featureKey: graph.featureKey,
        featureName: graph.featureName,
        nodesById,
        adjacency: {
            outgoing,
            incoming,
        },
        methods,
        methodAliases,
        events,
        requests,
        routes,
        endpoints,
        states,
        tables,
        nodesByType,
    };
}

function run(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    const configPath = path.resolve(args.root || process.cwd(), args.config);
    const root = resolveProjectRoot(args.root || path.dirname(configPath));
    const config = readJson(configPath);
    const profile = loadProjectProfile(root);
    const outputs = config.outputs || {};
    const extractInputs = deriveExtractInputs(config, root);

    const scanPath = path.resolve(root, outputs.scan);
    const graphPath = path.resolve(root, outputs.graph);
    const lookupPath = path.resolve(root, outputs.lookup);
    const reportPath = path.resolve(root, outputs.report);

    const extractArgs = [];
    if (config.extractorAdapter) {
        extractArgs.push('--adapter', config.extractorAdapter);
    }
    for (const item of extractInputs.componentRoots) {
        extractArgs.push('--component-root', item);
    }
    for (const item of extractInputs.assetRoots) {
        extractArgs.push('--asset-root', item);
    }
    for (const item of extractInputs.methodRoots) {
        extractArgs.push('--method-root', item);
    }
    extractArgs.push('--output', scanPath);
    for (const prefabPath of extractInputs.prefabs) {
        extractArgs.push(prefabPath);
    }

    const originalCwd = process.cwd();
    try {
        process.chdir(root);
        runExtract(extractArgs);
    } finally {
        process.chdir(originalCwd);
    }
    const raw = readJson(scanPath);
    const graph = buildGraph(raw, config, profile, root);
    const lookup = buildLookup(graph);
    const report = {
        generatedAt: timestamp(),
        featureKey: config.featureKey,
        featureName: config.featureName,
        configPath: repoRelative(configPath, root),
        outputs: {
            scan: repoRelative(scanPath, root),
            graph: repoRelative(graphPath, root),
            lookup: repoRelative(lookupPath, root),
            report: repoRelative(reportPath, root),
        },
        counts: {
            nodes: graph.nodes.length,
            edges: graph.edges.length,
            scripts: (raw.scripts || []).length,
            prefabs: (raw.prefabs || []).length,
        },
    };

    writeJson(graphPath, graph);
    writeJson(lookupPath, lookup);
    writeJson(reportPath, report);
    upsertFeatureRegistry(root, buildFeatureRecord(config, repoRelative(configPath, root)));
    console.log(`链路知识库已构建: ${config.featureKey}`);
}

module.exports = {
    run,
};

if (require.main === module) {
    try {
        run();
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    }
}
