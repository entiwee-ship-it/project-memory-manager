#!/usr/bin/env node

const path = require('path');
const { readJson } = require('./lib/common');

function parseArgs(argv) {
    const args = {
        feature: '',
        event: '',
        method: '',
        request: '',
        upstream: '',
        downstream: '',
        depth: 2,
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
        if (token === '--upstream') {
            args.upstream = argv[++index];
            continue;
        }
        if (token === '--downstream') {
            args.downstream = argv[++index];
            continue;
        }
        if (token === '--depth') {
            args.depth = Number.parseInt(argv[++index], 10) || 2;
            continue;
        }
        if (token === '--json') {
            args.json = true;
        }
    }

    if (!args.feature) {
        throw new Error('用法: node query_chain_kb.js --feature <key> [--event|--method|--request|--upstream|--downstream] ... [--json]');
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

function resolveNodeId(lookup, query) {
    if (lookup.nodesById[query]) {
        return query;
    }
    const method = resolveMethod(lookup, query);
    if (method?.id) {
        return method.id;
    }
    if (lookup.events[query]?.id) {
        return lookup.events[query].id;
    }
    if (lookup.requests[query]?.id) {
        return lookup.requests[query].id;
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

function printResult(result, asJson) {
    if (asJson) {
        console.log(JSON.stringify(result, null, 2));
        return;
    }

    if (result?.ambiguous) {
        console.log('方法查询存在歧义:');
        result.ambiguous.forEach(item => console.log(`- ${item}`));
        return;
    }

    console.log(JSON.stringify(result, null, 2));
}

function run(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    const { lookup } = loadFeatureLookup(process.cwd(), args.feature);

    if (args.event) {
        printResult(lookup.events[args.event] || null, args.json);
        return;
    }
    if (args.method) {
        printResult(resolveMethod(lookup, args.method), args.json);
        return;
    }
    if (args.request) {
        printResult(lookup.requests[args.request] || null, args.json);
        return;
    }
    if (args.upstream || args.downstream) {
        const direction = args.upstream ? 'upstream' : 'downstream';
        const nodeId = resolveNodeId(lookup, args.upstream || args.downstream);
        if (!nodeId) {
            throw new Error(`未找到节点: ${args.upstream || args.downstream}`);
        }
        printResult({
            node: lookup.nodesById[nodeId],
            direction,
            depth: args.depth,
            traversal: traverse(lookup, nodeId, direction, args.depth),
        }, args.json);
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
