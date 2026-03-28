#!/usr/bin/env node

const path = require('path');
const { readJson, resolveProjectRoot } = require('./lib/common');

function parseArgs(argv) {
    const args = {
        feature: '',
        event: '',
        method: '',
        request: '',
        state: '',
        upstream: '',
        downstream: '',
        from: '',
        direction: '',
        type: '',
        name: '',
        tag: '',
        file: '',
        hasHandler: '',
        root: '',
        depth: 2,
        limit: 20,
        json: false,
    };

    for (let index = 0; index < argv.length; index++) {
        const token = argv[index];
        if (token === '--feature') {
            args.feature = argv[++index];
            continue;
        }
        if (token === '--event') {
            args.event = argv[++index];
            continue;
        }
        if (token === '--method') {
            args.method = argv[++index];
            continue;
        }
        if (token === '--request') {
            args.request = argv[++index];
            continue;
        }
        if (token === '--state') {
            args.state = argv[++index];
            continue;
        }
        if (token === '--upstream') {
            args.upstream = argv[++index];
            continue;
        }
        if (token === '--downstream') {
            args.downstream = argv[++index];
            continue;
        }
        if (token === '--from') {
            args.from = argv[++index];
            continue;
        }
        if (token === '--direction') {
            args.direction = argv[++index];
            continue;
        }
        if (token === '--type') {
            args.type = argv[++index];
            continue;
        }
        if (token === '--name') {
            args.name = argv[++index];
            continue;
        }
        if (token === '--tag') {
            args.tag = argv[++index];
            continue;
        }
        if (token === '--file') {
            args.file = argv[++index];
            continue;
        }
        if (token === '--has-handler') {
            args.hasHandler = argv[++index];
            continue;
        }
        if (token === '--root') {
            args.root = argv[++index];
            continue;
        }
        if (token === '--depth') {
            args.depth = Number.parseInt(argv[++index], 10) || 2;
            continue;
        }
        if (token === '--limit') {
            args.limit = Number.parseInt(argv[++index], 10) || 20;
            continue;
        }
        if (token === '--json') {
            args.json = true;
        }
    }

    if (!args.feature) {
        throw new Error('用法: node query_chain_kb.js --feature <key> [--event|--method|--request|--state|--type|--from|--upstream|--downstream] ... [--json]');
    }

    if (args.from && args.direction && !['upstream', 'downstream'].includes(args.direction)) {
        throw new Error('--direction 仅支持 upstream 或 downstream');
    }

    return args;
}

function loadFeatureLookup(root, featureKey) {
    const registryPath = path.join(root, 'project-memory', 'state', 'feature-registry.json');
    const registry = readJson(registryPath);
    const feature = (registry.features || []).find(item => item.featureKey === featureKey);
    if (!feature) {
        throw new Error(`注册表中未找到功能: ${featureKey}`);
    }

    const kbDir = path.resolve(root, feature.kbDir);
    return {
        feature,
        graph: readJson(path.join(kbDir, 'chain.graph.json')),
        lookup: readJson(path.join(kbDir, 'chain.lookup.json')),
    };
}

function normalizeText(value) {
    return String(value || '').trim().toLowerCase();
}

function matchContains(value, needle) {
    if (!needle) {
        return true;
    }
    return normalizeText(value).includes(normalizeText(needle));
}

function resolveMethod(lookup, query) {
    if (lookup.methods[query]) {
        return lookup.methods[query];
    }
    const alias = lookup.methodAliases?.[query] || [];
    if (alias.length === 1) {
        return lookup.methods[alias[0]];
    }
    if (alias.length > 1) {
        return { ambiguous: alias };
    }
    return null;
}

function resolveState(lookup, query) {
    if (lookup.states?.[query]) {
        return lookup.states[query];
    }
    return null;
}

function findMatchingNodes(graph, query) {
    const exactMatches = graph.nodes.filter(node => node.name === query || node.id === query || node.meta?.statePath === query);
    if (exactMatches.length > 0) {
        return exactMatches;
    }

    const fuzzy = graph.nodes.filter(node => {
        return (
            matchContains(node.name, query) ||
            matchContains(node.file, query) ||
            matchContains(node.meta?.methodName, query) ||
            matchContains(node.meta?.statePath, query) ||
            matchContains(node.meta?.route, query) ||
            matchContains(node.meta?.path, query) ||
            matchContains(node.meta?.importPath, query) ||
            matchContains(node.meta?.kind, query) ||
            matchContains(node.meta?.protocol, query) ||
            (node.meta?.tags || []).some(tag => matchContains(tag, query))
        );
    });
    return fuzzy;
}

function resolveNodeId(graph, lookup, query) {
    if (lookup.nodesById[query]) {
        return query;
    }
    const exactNodeMatches = graph.nodes.filter(node => node.name === query || node.id === query || node.meta?.statePath === query);
    if (exactNodeMatches.length === 1) {
        return exactNodeMatches[0].id;
    }
    if (exactNodeMatches.length > 1) {
        return {
            ambiguous: exactNodeMatches.map(node => `${node.type}:${node.name}`),
        };
    }
    const method = resolveMethod(lookup, query);
    if (method?.id) {
        return method.id;
    }
    if (method?.ambiguous) {
        return { ambiguous: method.ambiguous };
    }
    if (lookup.events[query]?.id) {
        return lookup.events[query].id;
    }
    if (lookup.requests[query]?.id) {
        return lookup.requests[query].id;
    }
    if (lookup.routes?.[query]?.id) {
        return lookup.routes[query].id;
    }
    if (lookup.endpoints?.[query]?.id) {
        return lookup.endpoints[query].id;
    }
    if (lookup.tables?.[query]?.id) {
        return lookup.tables[query].id;
    }
    if (lookup.states?.[query]?.id) {
        return lookup.states[query].id;
    }

    const matches = findMatchingNodes(graph, query);
    if (matches.length === 1) {
        return matches[0].id;
    }
    if (matches.length > 1) {
        return {
            ambiguous: matches.map(node => `${node.type}:${node.name}`),
        };
    }
    return null;
}

function traverse(lookup, startId, direction, depth) {
    const bucket = direction === 'upstream' ? lookup.adjacency.incoming : lookup.adjacency.outgoing;
    const queue = [{ id: startId, depth: 0 }];
    const visited = new Set([startId]);
    const result = [];

    while (queue.length > 0) {
        const current = queue.shift();
        const edges = bucket[current.id] || [];
        for (const edge of edges) {
            const nextId = direction === 'upstream' ? edge.from : edge.to;
            result.push({
                depth: current.depth + 1,
                edge,
                node: lookup.nodesById[nextId] || null,
            });
            if (current.depth + 1 >= depth || visited.has(nextId)) {
                continue;
            }
            visited.add(nextId);
            queue.push({ id: nextId, depth: current.depth + 1 });
        }
    }

    return result;
}

function summarizeEdges(edges, lookup, limit = 8) {
    return (edges || []).slice(0, limit).map(edge => ({
        type: edge.type,
        sourceKind: edge.sourceKind,
        to: lookup.nodesById[edge.to]?.name || edge.to,
        from: lookup.nodesById[edge.from]?.name || edge.from,
        meta: edge.meta || {},
    }));
}

function summarizeNode(node, lookup) {
    const outgoing = lookup.adjacency.outgoing[node.id] || [];
    const incoming = lookup.adjacency.incoming[node.id] || [];
    const binds = outgoing.filter(edge => edge.type === 'binds');
    const summary = {
        id: node.id,
        type: node.type,
        name: node.name,
        file: node.file,
        line: node.line,
        area: node.area,
        stack: node.stack,
        meta: node.meta || {},
        outgoingCount: outgoing.length,
        incomingCount: incoming.length,
        bindings: summarizeEdges(binds, lookup),
    };

    if (node.type === 'endpoint') {
        summary.httpMethod = node.meta?.method || '';
        summary.httpPath = node.meta?.path || '';
    }
    if (node.type === 'route') {
        summary.routeKind = node.meta?.kind || '';
        summary.routeProtocol = node.meta?.protocol || '';
        summary.route = node.meta?.route || node.name;
    }
    if (node.type === 'table') {
        summary.importPath = node.meta?.importPath || '';
    }

    return summary;
}

function searchNodes(graph, lookup, args) {
    let nodes = [...graph.nodes];

    if (args.type) {
        nodes = nodes.filter(node => node.type === args.type);
    }
    if (args.name) {
        nodes = nodes.filter(node => {
            return (
                matchContains(node.name, args.name) ||
                matchContains(node.meta?.methodName, args.name) ||
                matchContains(node.meta?.statePath, args.name) ||
                matchContains(node.meta?.route, args.name) ||
                matchContains(node.meta?.path, args.name) ||
                matchContains(node.meta?.importPath, args.name) ||
                (node.meta?.tags || []).some(tag => matchContains(tag, args.name))
            );
        });
    }
    if (args.tag) {
        nodes = nodes.filter(node => (node.meta?.tags || []).some(tag => matchContains(tag, args.tag)));
    }
    if (args.file) {
        nodes = nodes.filter(node => matchContains(node.file, args.file));
    }
    if (args.hasHandler) {
        nodes = nodes.filter(node => {
            const outgoing = lookup.adjacency.outgoing[node.id] || [];
            return outgoing.some(edge => {
                if (edge.type !== 'binds') {
                    return false;
                }
                return matchContains(edge.meta?.sourceEventKind, args.hasHandler) || matchContains(edge.meta?.handler, args.hasHandler);
            });
        });
    }

    return nodes.slice(0, args.limit).map(node => summarizeNode(node, lookup));
}

function formatNodeLabel(node) {
    if (!node) {
        return '(missing-node)';
    }
    return `${node.name} [${node.type}]`;
}

function printAmbiguous(result) {
    console.log('查询存在歧义:');
    result.ambiguous.forEach(item => console.log(`- ${item}`));
}

function printSummary(result, asJson) {
    if (asJson) {
        console.log(JSON.stringify(result, null, 2));
        return;
    }

    if (result?.ambiguous) {
        printAmbiguous(result);
        return;
    }

    console.log(`${result.name} [${result.type}]`);
    console.log(`- file: ${result.file || '(none)'}`);
    console.log(`- line: ${result.line ?? '(unknown)'}`);
    console.log(`- area: ${result.area || 'unknown'}`);
    console.log(`- outgoing: ${result.outgoingCount}`);
    console.log(`- incoming: ${result.incomingCount}`);
    if (result.type === 'endpoint') {
        console.log(`- httpMethod: ${result.httpMethod || '(none)'}`);
        console.log(`- httpPath: ${result.httpPath || '(none)'}`);
    }
    if (result.type === 'route') {
        console.log(`- route: ${result.route || '(none)'}`);
        console.log(`- kind: ${result.routeKind || '(none)'}`);
        console.log(`- protocol: ${result.routeProtocol || '(none)'}`);
    }
    if (result.type === 'table') {
        console.log(`- importPath: ${result.importPath || '(none)'}`);
    }
    if ((result.bindings || []).length > 0) {
        console.log('- bindings:');
        result.bindings.forEach(item => {
            console.log(`  - ${item.meta?.sourceEventKind || item.type} -> ${item.to}`);
        });
    }
}

function printDetailedResult(result, asJson) {
    if (asJson) {
        console.log(JSON.stringify(result, null, 2));
        return;
    }

    if (result?.ambiguous) {
        printAmbiguous(result);
        return;
    }

    console.log(`${result.name} [${result.type}]`);
    Object.entries(result)
        .filter(([key]) => !['name', 'type'].includes(key))
        .forEach(([key, value]) => {
            if (Array.isArray(value)) {
                console.log(`- ${key}: ${value.length ? value.join(', ') : '(none)'}`);
                return;
            }
            if (value && typeof value === 'object') {
                console.log(`- ${key}: ${JSON.stringify(value)}`);
                return;
            }
            console.log(`- ${key}: ${value == null || value === '' ? '(none)' : value}`);
        });
}

function printSearchResults(results, asJson) {
    if (asJson) {
        console.log(JSON.stringify(results, null, 2));
        return;
    }

    if (!results.length) {
        console.log('未找到匹配节点。');
        return;
    }

    console.log(`找到 ${results.length} 个节点:`);
    results.forEach(result => {
        console.log(`- ${result.name} [${result.type}] (${result.area || 'unknown'})`);
        console.log(`  file: ${result.file || '(none)'}`);
        if (result.type === 'endpoint') {
            console.log(`  http: ${result.httpMethod || '(none)'} ${result.httpPath || '(none)'}`);
        }
        if (result.type === 'route') {
            console.log(`  route: ${result.route || '(none)'} [${result.routeKind || 'unknown'}|${result.routeProtocol || 'unknown'}]`);
        }
        if (result.type === 'table') {
            console.log(`  importPath: ${result.importPath || '(none)'}`);
        }
        if ((result.bindings || []).length > 0) {
            result.bindings.forEach(item => {
                console.log(`  binds ${item.meta?.sourceEventKind || item.type} -> ${item.to}`);
            });
        }
    });
}

function printTraversal(result, asJson) {
    if (asJson) {
        console.log(JSON.stringify(result, null, 2));
        return;
    }

    if (result?.ambiguous) {
        printAmbiguous(result);
        return;
    }

    console.log(`起点: ${formatNodeLabel(result.node)}`);
    console.log(`方向: ${result.direction}, 深度: ${result.depth}`);

    if (!result.traversal.length) {
        console.log('未找到链路。');
        return;
    }

    result.traversal
        .sort((left, right) => left.depth - right.depth)
        .forEach(item => {
            const indent = '  '.repeat(Math.max(0, item.depth - 1));
            const targetLabel = formatNodeLabel(item.node || { name: item.edge.to, type: 'unknown' });
            const metaSuffix = item.edge.meta?.sourceEventKind
                ? ` (${item.edge.meta.sourceEventKind})`
                : item.edge.meta?.statePath
                  ? ` (${item.edge.meta.statePath})`
                  : '';
            console.log(`${indent}- ${item.edge.type} -> ${targetLabel}${metaSuffix}`);
        });
}

function run(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    const root = resolveProjectRoot(args.root || process.cwd());
    const { graph, lookup } = loadFeatureLookup(root, args.feature);

    if (args.event) {
        const event = lookup.events[args.event];
        if (!event) {
            throw new Error(`未找到事件: ${args.event}`);
        }
        printDetailedResult(
            {
                type: 'event',
                name: args.event,
                bus: event.bus || '',
                subscribers: event.subscribers || [],
                emitters: event.emitters || [],
                node: summarizeNode(lookup.nodesById[event.id], lookup),
            },
            args.json
        );
        return;
    }
    if (args.method) {
        const method = resolveMethod(lookup, args.method);
        if (!method) {
            throw new Error(`未找到方法: ${args.method}`);
        }
        if (method.ambiguous) {
            printSummary(method, args.json);
            return;
        }
        printSummary(summarizeNode(lookup.nodesById[method.id], lookup), args.json);
        return;
    }
    if (args.request) {
        const request = lookup.requests[args.request];
        if (!request) {
            throw new Error(`未找到 request: ${args.request}`);
        }
        printDetailedResult(
            {
                type: 'request',
                name: args.request,
                callee: request.callee || '',
                callers: request.callers || [],
                node: summarizeNode(lookup.nodesById[request.id], lookup),
            },
            args.json
        );
        return;
    }
    if (args.state) {
        const state = resolveState(lookup, args.state);
        if (!state) {
            throw new Error(`未找到 state: ${args.state}`);
        }
        printDetailedResult(
            {
                type: 'state',
                name: args.state,
                readers: state.readers || [],
                writers: state.writers || [],
                node: summarizeNode(lookup.nodesById[state.id], lookup),
            },
            args.json
        );
        return;
    }
    if (args.type || args.name || args.tag || args.file || args.hasHandler) {
        const results = searchNodes(graph, lookup, args);
        printSearchResults(results, args.json);
        return;
    }

    const direction = args.upstream
        ? 'upstream'
        : args.downstream
          ? 'downstream'
          : args.from && args.direction
            ? args.direction
            : '';
    const startQuery = args.upstream || args.downstream || args.from;

    if (direction && startQuery) {
        const resolved = resolveNodeId(graph, lookup, startQuery);
        if (!resolved) {
            throw new Error(`未找到节点: ${startQuery}`);
        }
        if (typeof resolved === 'object' && resolved.ambiguous) {
            printTraversal(resolved, args.json);
            return;
        }

        printTraversal(
            {
                node: lookup.nodesById[resolved],
                direction,
                depth: args.depth,
                traversal: traverse(lookup, resolved, direction, args.depth),
            },
            args.json
        );
        return;
    }

    throw new Error('未提供查询条件。');
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
