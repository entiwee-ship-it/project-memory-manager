#!/usr/bin/env node

const path = require('path');
const { readJson, resolveProjectRoot } = require('./lib/common');
const { loadFeatureLookupArtifacts, normalizeFeatureRecord } = require('./lib/feature-kb');
const { loadSkillVersion } = require('./show_skill_version');

function parseArgs(argv) {
    const args = {
        feature: '',
        event: '',
        method: '',
        request: '',
        state: '',
        upstream: '',
        downstream: '',
        upstreamFlag: false,
        downstreamFlag: false,
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
        const nextToken = argv[index + 1];
        const hasExplicitValue = Boolean(nextToken && !String(nextToken).startsWith('--'));
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
            if (hasExplicitValue) {
                args.upstream = argv[++index];
            } else {
                args.upstreamFlag = true;
            }
            continue;
        }
        if (token === '--downstream') {
            if (hasExplicitValue) {
                args.downstream = argv[++index];
            } else {
                args.downstreamFlag = true;
            }
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
        throw new Error('用法: node query_kb.js --feature <key> [--event|--method|--request|--state|--type|--from --direction <upstream|downstream>|--upstream [query]|--downstream [query]] ... [--json]');
    }

    if (args.from && args.direction && !['upstream', 'downstream'].includes(args.direction)) {
        throw new Error('--direction 仅支持 upstream 或 downstream');
    }

    return args;
}

function collectTypedSelectors(args) {
    return [
        ['method', args.method],
        ['event', args.event],
        ['request', args.request],
        ['state', args.state],
    ].filter(([, value]) => Boolean(value));
}

function loadFeatureLookup(root, featureKey) {
    const registryPath = path.join(root, 'project-memory', 'state', 'feature-registry.json');
    const registry = readJson(registryPath);
    const normalizedFeatures = (registry.features || []).map(item => normalizeFeatureRecord(item));
    const feature = normalizedFeatures.find(item => item.featureKey === featureKey);
    if (!feature) {
        throw new Error(`注册表中未找到功能: ${featureKey}`);
    }

    return loadFeatureLookupArtifacts(root, feature);
}

function currentSkillVersionInfo() {
    try {
        return loadSkillVersion(path.resolve(__dirname, '..'));
    } catch {
        return null;
    }
}

function buildKbVersionStatus(graph) {
    const currentSkill = currentSkillVersionInfo();
    const builtWithSkill = graph?.builtWithSkill || null;
    const stale = Boolean(
        currentSkill
        && builtWithSkill?.version
        && currentSkill.version
        && builtWithSkill.version !== currentSkill.version
    );

    return {
        builtWithSkill: builtWithSkill || null,
        currentSkill: currentSkill
            ? {
                name: currentSkill.name || '',
                version: currentSkill.version || '',
                repo: currentSkill.repo || '',
            }
            : null,
        stale,
        recommendedAction: stale
            ? 'node scripts/rebuild_kbs.js --root <project-root>'
            : '',
    };
}

function warnIfKbStale(status) {
    if (!status?.stale) {
        return;
    }
    console.warn(
        `[stale-kb] 当前 KB 由 ${status.builtWithSkill?.name || 'unknown'}@${status.builtWithSkill?.version || 'unknown'} 构建，`
        + `当前技能版本是 ${status.currentSkill?.name || 'unknown'}@${status.currentSkill?.version || 'unknown'}。`
        + ` 请先运行 ${status.recommendedAction} 重建 KB。`
    );
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
    if (node.type === 'request') {
        summary.callee = node.meta?.callee || '';
        summary.requestProtocol = node.meta?.protocol || '';
        summary.requestHttpMethod = node.meta?.httpMethod || '';
        summary.requestTransport = node.meta?.transport || '';
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
                matchContains(node.meta?.protocol, args.name) ||
                matchContains(node.meta?.httpMethod, args.name) ||
                matchContains(node.meta?.transport, args.name) ||
                matchContains(node.meta?.callee, args.name) ||
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
    if (result.type === 'request') {
        console.log(`- callee: ${result.callee || '(none)'}`);
        console.log(`- protocol: ${result.requestProtocol || '(none)'}`);
        console.log(`- httpMethod: ${result.requestHttpMethod || '(none)'}`);
        console.log(`- transport: ${result.requestTransport || '(none)'}`);
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
        if (result.type === 'request') {
            console.log(`  request: ${result.requestHttpMethod || '(none)'} [${result.requestProtocol || 'unknown'}|${result.requestTransport || 'unknown'}] via ${result.callee || '(none)'}`);
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

function buildRecommendedCommands(featureKey) {
    return [
        `node scripts/query_kb.js --feature ${featureKey}`,
        `node scripts/query_kb.js --feature ${featureKey} --downstream <query>`,
        `node scripts/query_kb.js --feature ${featureKey} --method <name> --downstream`,
        `node scripts/query_kb.js --feature ${featureKey} --type method --name <keyword>`,
        `node scripts/query_chain_kb.js --feature ${featureKey} --downstream <query>`,
    ];
}

function buildArtifactGuide(feature) {
    const outputs = feature.outputs || {};
    return [
        {
            key: 'entrypoint',
            file: 'scripts/query_kb.js',
            purpose: '统一查询入口，优先用于 feature 摘要、链路遍历和节点检索。',
            useWhen: '遇到入口、关闭窗口链路、事件绑定、request、state 流转时先运行它。',
            priority: 1,
        },
        {
            key: 'report',
            file: outputs.report || '',
            purpose: '构建汇总和使用说明，给人快速理解当前 feature 的范围、推荐查询方式和产物位置。',
            useWhen: '先想知道这个 feature 有什么、应该怎么查时优先看。',
            priority: 2,
        },
        {
            key: 'lookup',
            file: outputs.lookup || '',
            purpose: '查询索引，供查询脚本读取 method / event / request / state / route 的映射。',
            useWhen: '通常不要手读；只有调试查询脚本或排查索引异常时才直接打开。',
            priority: 3,
        },
        {
            key: 'graph',
            file: outputs.graph || '',
            purpose: '图节点与边的底层事实数据。',
            useWhen: '通常不要手读；只有确认具体边类型、节点 meta 或导出图时才打开。',
            priority: 4,
        },
        {
            key: 'scan',
            file: outputs.scan || '',
            purpose: '原始抽取事实，接近 extractor 输出。',
            useWhen: '通常不要手读；只有怀疑抽取阶段漏抓时才回看它。',
            priority: 5,
        },
    ];
}

function buildFeatureSummary(feature, graph, lookup) {
    const nodeCount = Array.isArray(graph.nodes) ? graph.nodes.length : 0;
    const edgeCount = Array.isArray(graph.edges) ? graph.edges.length : 0;
    const nodesByType = Object.fromEntries(
        Object.entries(lookup.nodesByType || {}).map(([type, ids]) => [type, Array.isArray(ids) ? ids.length : 0])
    );
    const examples = buildRecommendedCommands(feature.featureKey);
    const artifacts = buildArtifactGuide(feature);
    const kbVersionStatus = buildKbVersionStatus(graph);

    return {
        kind: 'feature-summary',
        purpose: '功能知识库摘要与默认查询入口。先用它确认当前 feature 的范围、常见节点类型和推荐命令，再决定是否继续看 docs 或源码。',
        useWhen: '当你还不确定该查哪个 KB 文件，或刚准备开始定位一个 feature 的入口、调用链、request、event、state 时。',
        feature: {
            featureKey: feature.featureKey,
            featureName: feature.featureName,
            kbDir: feature.kbDir,
        },
        counts: {
            nodes: nodeCount,
            edges: edgeCount,
            nodesByType,
        },
        defaultWorkflow: [
            '先运行 feature 摘要，确认这个 KB 里有哪些节点类型和推荐命令。',
            '再用 --downstream / --upstream 或 --method / --event / --request / --state 精确查询。',
            '只有 KB 结果不足以回答问题时，再读相关 docs；最后才用 rg/grep 回源码确认。'
        ],
        kbVersionStatus,
        artifacts,
        examples,
    };
}

function printFeatureSummary(summary, asJson) {
    if (asJson) {
        console.log(JSON.stringify(summary, null, 2));
        return;
    }

    console.log(`${summary.feature.featureName} (${summary.feature.featureKey})`);
    console.log(`- kbDir: ${summary.feature.kbDir}`);
    console.log(`- purpose: ${summary.purpose}`);
    console.log(`- useWhen: ${summary.useWhen}`);
    console.log(`- nodes: ${summary.counts.nodes}`);
    console.log(`- edges: ${summary.counts.edges}`);
    console.log('- nodesByType:');
    Object.entries(summary.counts.nodesByType)
        .sort((left, right) => left[0].localeCompare(right[0]))
        .forEach(([type, count]) => console.log(`  - ${type}: ${count}`));
    console.log('- defaultWorkflow:');
    (summary.defaultWorkflow || []).forEach(item => console.log(`  - ${item}`));
    if (summary.kbVersionStatus?.builtWithSkill) {
        console.log(`- builtWithSkill: ${summary.kbVersionStatus.builtWithSkill.name}@${summary.kbVersionStatus.builtWithSkill.version}`);
    }
    if (summary.kbVersionStatus?.stale) {
        console.log(`- staleKb: yes`);
        console.log(`- rebuild: ${summary.kbVersionStatus.recommendedAction}`);
    }
    console.log('- artifacts:');
    (summary.artifacts || [])
        .sort((left, right) => (left.priority || 99) - (right.priority || 99))
        .forEach(item => {
            console.log(`  - ${item.key}: ${item.file || '(none)'}`);
            console.log(`    purpose: ${item.purpose}`);
            console.log(`    useWhen: ${item.useWhen}`);
        });
    console.log('- examples:');
    summary.examples.forEach(example => console.log(`  - ${example}`));
}

function resolveTypedStart(graph, lookup, selectorType, query) {
    if (selectorType === 'method') {
        const method = resolveMethod(lookup, query);
        if (!method) {
            throw new Error(`未找到方法: ${query}`);
        }
        return method;
    }
    if (selectorType === 'event') {
        const event = lookup.events[query];
        if (!event) {
            throw new Error(`未找到事件: ${query}`);
        }
        return event;
    }
    if (selectorType === 'request') {
        const request = lookup.requests[query];
        if (!request) {
            throw new Error(`未找到 request: ${query}`);
        }
        return request;
    }
    if (selectorType === 'state') {
        const state = resolveState(lookup, query);
        if (!state) {
            throw new Error(`未找到 state: ${query}`);
        }
        return state;
    }

    const resolved = resolveNodeId(graph, lookup, query);
    if (!resolved) {
        throw new Error(`未找到节点: ${query}`);
    }
    return typeof resolved === 'string' ? { id: resolved } : resolved;
}

function resolveTraversalSpec(args, graph, lookup) {
    if (args.upstream) {
        return { direction: 'upstream', inputQuery: args.upstream, selectorType: 'node' };
    }
    if (args.downstream) {
        return { direction: 'downstream', inputQuery: args.downstream, selectorType: 'node' };
    }

    const typedSelectors = collectTypedSelectors(args);
    if (args.upstreamFlag || args.downstreamFlag) {
        if (typedSelectors.length > 1) {
            throw new Error('链路遍历模式下只支持一个 typed selector');
        }
        if (typedSelectors.length === 1) {
            const [selectorType, inputQuery] = typedSelectors[0];
            return {
                direction: args.upstreamFlag ? 'upstream' : 'downstream',
                inputQuery,
                selectorType,
            };
        }
        if (args.from) {
            return {
                direction: args.upstreamFlag ? 'upstream' : 'downstream',
                inputQuery: args.from,
                selectorType: 'node',
            };
        }
        throw new Error('未提供链路遍历起点。请传入 --upstream <query> / --downstream <query>，或结合 --method/--event/--request/--state 使用。');
    }

    if (args.from && args.direction) {
        return {
            direction: args.direction,
            inputQuery: args.from,
            selectorType: 'node',
        };
    }

    return null;
}

function run(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    const root = resolveProjectRoot(args.root || process.cwd());
    const { feature, graph, lookup } = loadFeatureLookup(root, args.feature);
    const kbVersionStatus = buildKbVersionStatus(graph);
    if (!args.json) {
        warnIfKbStale(kbVersionStatus);
    }

    const traversalSpec = resolveTraversalSpec(args, graph, lookup);
    if (traversalSpec) {
        const resolved = resolveTypedStart(graph, lookup, traversalSpec.selectorType, traversalSpec.inputQuery);
        if (resolved?.ambiguous) {
            printTraversal(resolved, args.json);
            return;
        }

        const startId = typeof resolved === 'string' ? resolved : resolved.id;
        const startNode = lookup.nodesById[startId];
        printTraversal(
            {
                inputQuery: traversalSpec.inputQuery,
                resolvedStart: startNode ? summarizeNode(startNode, lookup) : null,
                kbVersionStatus,
                node: startNode,
                direction: traversalSpec.direction,
                depth: args.depth,
                traversal: traverse(lookup, startId, traversalSpec.direction, args.depth),
            },
            args.json
        );
        return;
    }

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
                kbVersionStatus,
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
                kbVersionStatus,
                callers: request.callers || [],
                protocol: request.protocol || '',
                httpMethod: request.httpMethod || '',
                transport: request.transport || '',
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
                kbVersionStatus,
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

    printFeatureSummary(buildFeatureSummary(feature, graph, lookup), args.json);
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
