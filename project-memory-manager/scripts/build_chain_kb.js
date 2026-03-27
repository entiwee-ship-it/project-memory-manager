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

    const addNode = node => {
        if (nodeMap.has(node.id)) {
            return nodeMap.get(node.id);
        }
        const normalizedNode = {
            line: null,
            file: '',
            area: 'unknown',
            stack: [],
            meta: {},
            ...node,
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

    const ensureScriptNode = scriptPath => {
        const absolutePath = path.resolve(root, scriptPath);
        const area = inferArea(absolutePath, config, projectProfile, root);
        return addNode({
            id: makeNodeId('script', scriptPath),
            type: 'script',
            name: path.basename(scriptPath),
            file: normalize(absolutePath),
            area,
            stack: inferStacks(area, projectProfile),
        });
    };

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
        addEdge({ from: featureId, to: prefabNode.id, type: 'contains', sourceKind: 'prefab', area: 'frontend' });

        for (const component of prefab.customComponents || []) {
            const componentNode = addNode({
                id: makeNodeId('component', prefab.prefabPath, component.nodePath, component.componentName),
                type: 'component',
                name: `${component.componentName}@${component.nodePath}`,
                file: component.scriptPath || prefab.prefabPath,
                area: component.scriptPath ? inferArea(component.scriptPath, config, projectProfile, root) : 'frontend',
                stack: component.scriptPath
                    ? inferStacks(inferArea(component.scriptPath, config, projectProfile, root), projectProfile)
                    : inferStacks('frontend', projectProfile),
                meta: {
                    prefabPath: prefab.prefabPath,
                    nodePath: component.nodePath,
                    rawType: component.rawType,
                },
            });
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
            const targetId = makeNodeId('method', eventInfo.targetScriptPath, eventInfo.handler);
            ensureScriptNode(eventInfo.targetScriptPath);
            addEdge({
                from: prefabNode.id,
                to: targetId,
                type: 'binds',
                sourceKind: 'prefab',
                area: 'frontend',
                meta: {
                    sourceNodePath: eventInfo.sourceNodePath,
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
            const methodArea = inferArea(script.scriptPath, config, projectProfile, root);
            const currentMethodId = makeNodeId('method', script.scriptPath, method.name);
            addNode({
                id: currentMethodId,
                type: 'method',
                name: `${path.basename(script.scriptPath, path.extname(script.scriptPath))}.${method.name}`,
                file: script.scriptPath,
                line: method.line,
                area: methodArea,
                stack: inferStacks(methodArea, projectProfile),
                meta: {
                    methodName: method.name,
                    scriptPath: script.scriptPath,
                    summary: method.summary || '',
                },
            });
            addEdge({ from: scriptNode.id, to: currentMethodId, type: 'contains', sourceKind: 'script', area: methodArea });

            for (const localMethod of method.localCalls || []) {
                addEdge({ from: currentMethodId, to: makeNodeId('method', script.scriptPath, localMethod), type: 'calls', sourceKind: 'script', area: methodArea });
            }

            for (const fieldCall of method.fieldCalls || []) {
                if (!fieldCall.sourcePath) {
                    continue;
                }
                ensureScriptNode(fieldCall.sourcePath);
                addEdge({
                    from: currentMethodId,
                    to: makeNodeId('method', fieldCall.sourcePath, fieldCall.method),
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
                ensureScriptNode(importedCall.sourcePath);
                addEdge({
                    from: currentMethodId,
                    to: makeNodeId('method', importedCall.sourcePath, importedCall.method),
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
                    addEdge({
                        from: currentMethodId,
                        to: makeNodeId('method', script.scriptPath, callbackLocalCall),
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
                    addEdge({
                        from: currentMethodId,
                        to: makeNodeId('method', callbackFieldCall.sourcePath, callbackFieldCall.method),
                        type: 'callback_calls',
                        sourceKind: 'network',
                        area: methodArea,
                        meta: {
                            request: request.target || request.callee,
                            fieldName: callbackFieldCall.fieldName,
                        },
                    });
                }
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
