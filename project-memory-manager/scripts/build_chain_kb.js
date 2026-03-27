#!/usr/bin/env node

const path = require('path');
const { runExtract } = require('./extract_feature_facts');
const { inferArea, inferStacks, loadProjectProfile, normalize, readJson, slugify, timestamp, writeJson } = require('./lib/common');

function parseArgs(argv) {
    const args = { config: '' };
    for (let index = 0; index < argv.length; index++) {
        if (argv[index] === '--config') {
            args.config = argv[++index];
        }
    }
    if (!args.config) {
        throw new Error('用法: node build_chain_kb.js --config <path>');
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
            (TAG_SYNONYMS[token] || []).forEach(alias => tags.add(alias.toLowerCase()));
        }
    }
    return Array.from(tags).sort((left, right) => left.localeCompare(right));
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

function buildGraph(raw, config, projectProfile, root) {
    const nodes = [];
    const edges = [];
    const nodeMap = new Map();
    const edgeSet = new Set();
    const featureId = makeNodeId('module', config.featureKey);
    const methodMap = buildMethodMap(raw);
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

            const methodInfo = methodMap.get(methodKey(script.scriptPath, method.name));
            const effectiveRequests = collectEffectiveNetworkRequests(methodInfo, methodMap);
            for (const request of effectiveRequests) {
                const requestId = makeNodeId('request', request.callee, request.target || request.callee);
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
                    },
                });
                appendNodeTags(nodeMap.get(requestId), request.target || request.callee, request.callee, 'request');
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
    const states = {};
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
        states,
        nodesByType,
    };
}

function run(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    const root = process.cwd();
    const configPath = path.resolve(root, args.config);
    const config = readJson(configPath);
    const profile = loadProjectProfile(root);
    const outputs = config.outputs || {};

    const scanPath = path.resolve(root, outputs.scan);
    const graphPath = path.resolve(root, outputs.graph);
    const lookupPath = path.resolve(root, outputs.lookup);
    const reportPath = path.resolve(root, outputs.report);

    const extractArgs = [];
    if (config.extractorAdapter) {
        extractArgs.push('--adapter', config.extractorAdapter);
    }
    for (const item of config.componentRoots || []) {
        extractArgs.push('--component-root', item);
    }
    for (const item of config.assetRoots || []) {
        extractArgs.push('--asset-root', item);
    }
    for (const item of config.methodRoots || []) {
        extractArgs.push('--method-root', item);
    }
    extractArgs.push('--output', scanPath);
    for (const prefabPath of config.prefabs || []) {
        extractArgs.push(prefabPath);
    }

    runExtract(extractArgs);
    const raw = readJson(scanPath);
    const graph = buildGraph(raw, config, profile, root);
    const lookup = buildLookup(graph);
    const report = {
        generatedAt: timestamp(),
        featureKey: config.featureKey,
        featureName: config.featureName,
        configPath: normalize(configPath),
        outputs: {
            scan: normalize(scanPath),
            graph: normalize(graphPath),
            lookup: normalize(lookupPath),
            report: normalize(reportPath),
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
