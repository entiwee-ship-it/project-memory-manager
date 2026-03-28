#!/usr/bin/env node

const path = require('path');
const { buildLookup, run: buildChainKb } = require('./build_chain_kb');
const { ensureDir, loadProjectProfile, normalize, pathExists, readJson, repoRelative, resolveProjectRoot, slugify, writeJson } = require('./lib/common');
const { learnProjectProtocols } = require('./learn_project_protocols');

function parseArgs(argv) {
    const args = {
        root: '',
        json: false,
    };

    for (let index = 0; index < argv.length; index++) {
        const token = argv[index];
        if (token === '--root') {
            args.root = argv[++index] || '';
            continue;
        }
        if (token === '--json') {
            args.json = true;
        }
    }

    return args;
}

function unique(values) {
    return Array.from(new Set((values || []).filter(Boolean)));
}

function toConfigPath(root, targetPath) {
    const absoluteTarget = path.resolve(targetPath);
    const relative = path.relative(root, absoluteTarget);
    if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
        return normalize(relative);
    }
    return normalize(absoluteTarget);
}

function collectProjectScanRoots(projectProfile, root) {
    const componentRoots = [];
    const assetRoots = [];
    const methodRoots = [];
    const prefabs = [];

    const pushIfExists = (bucket, targetPath) => {
        if (pathExists(targetPath)) {
            bucket.push(toConfigPath(root, targetPath));
            return true;
        }
        return false;
    };

    for (const roots of Object.values(projectProfile?.areas || {})) {
        for (const configuredRoot of Array.isArray(roots) ? roots : []) {
            const absoluteRoot = path.resolve(root, configuredRoot);
            let foundKnownRoot = false;
            foundKnownRoot = pushIfExists(componentRoots, path.join(absoluteRoot, 'assets')) || foundKnownRoot;
            foundKnownRoot = pushIfExists(assetRoots, path.join(absoluteRoot, 'assets')) || foundKnownRoot;
            if (pathExists(path.join(absoluteRoot, 'assets'))) {
                prefabs.push(`${toConfigPath(root, path.join(absoluteRoot, 'assets'))}/**/*.prefab`);
                foundKnownRoot = true;
            }
            foundKnownRoot = pushIfExists(methodRoots, path.join(absoluteRoot, 'assets')) || foundKnownRoot;
            foundKnownRoot = pushIfExists(methodRoots, path.join(absoluteRoot, 'app')) || foundKnownRoot;
            foundKnownRoot = pushIfExists(methodRoots, path.join(absoluteRoot, 'src')) || foundKnownRoot;
            foundKnownRoot = pushIfExists(methodRoots, path.join(absoluteRoot, 'lib')) || foundKnownRoot;
            foundKnownRoot = pushIfExists(methodRoots, path.join(absoluteRoot, 'server')) || foundKnownRoot;

            if (!foundKnownRoot && pathExists(absoluteRoot)) {
                methodRoots.push(toConfigPath(root, absoluteRoot));
            }
        }
    }

    return {
        componentRoots: unique(componentRoots).sort((left, right) => left.localeCompare(right)),
        assetRoots: unique(assetRoots).sort((left, right) => left.localeCompare(right)),
        methodRoots: unique(methodRoots).sort((left, right) => left.localeCompare(right)),
        prefabs: unique(prefabs).sort((left, right) => left.localeCompare(right)),
    };
}

function buildProjectGlobalConfig(root, projectProfile) {
    const scanRoots = collectProjectScanRoots(projectProfile, root);
    if (scanRoots.methodRoots.length <= 0) {
        throw new Error('无法从 project-profile.json 推导全局扫描根；请先运行 detect_project_topology.js 或手工补全 project-profile.json');
    }

    return {
        featureKey: 'project-global',
        featureName: 'Project Global KB',
        summary: 'Full-project global knowledge graph',
        type: 'project-global',
        kbDir: 'project-memory/kb/project-global',
        areas: Object.keys(projectProfile?.areas || {}),
        componentRoots: scanRoots.componentRoots,
        assetRoots: scanRoots.assetRoots,
        methodRoots: scanRoots.methodRoots,
        prefabs: scanRoots.prefabs,
        outputs: {
            scan: 'project-memory/kb/project-global/scan.raw.json',
            graph: 'project-memory/kb/project-global/chain.graph.json',
            lookup: 'project-memory/kb/project-global/chain.lookup.json',
            report: 'project-memory/kb/project-global/build.report.json',
        },
        docs: {
            featureDir: 'project-memory/docs/project',
            featureIndex: 'project-memory/docs/project/PROJECT_Overview.md',
        },
    };
}

function buildMessageNodeId(pattern) {
    return `message:${slugify(pattern.protocol || 'message')}:${slugify(pattern.name)}`;
}

function augmentGraphWithProtocols(graph, protocols) {
    const nodeMap = new Map((graph.nodes || []).map(node => [node.id, node]));
    const edgeKeys = new Set((graph.edges || []).map(edge => `${edge.from}::${edge.to}::${edge.type}::${JSON.stringify(edge.meta || {})}`));
    const methodByName = new Map((graph.nodes || []).filter(node => node.type === 'method').map(node => [node.name, node]));
    const nodes = [...(graph.nodes || [])];
    const edges = [...(graph.edges || [])];

    const addNode = node => {
        if (nodeMap.has(node.id)) {
            return nodeMap.get(node.id);
        }
        nodeMap.set(node.id, node);
        nodes.push(node);
        return node;
    };

    const addEdge = edge => {
        const key = `${edge.from}::${edge.to}::${edge.type}::${JSON.stringify(edge.meta || {})}`;
        if (edgeKeys.has(key)) {
            return;
        }
        edgeKeys.add(key);
        edges.push(edge);
    };

    for (const pattern of protocols.messagePatterns || []) {
        const area = pattern.handlers[0]?.area || pattern.senders[0]?.area || pattern.dispatchers[0]?.area || 'unknown';
        const file = pattern.evidenceFiles?.[0] || '';
        const messageNode = addNode({
            id: buildMessageNodeId(pattern),
            type: 'message',
            name: pattern.name,
            file,
            line: null,
            area,
            stack: [],
            meta: {
                protocol: pattern.protocol || '',
                confidence: pattern.confidence ?? null,
                learned: true,
                evidenceFiles: pattern.evidenceFiles || [],
                tags: unique([pattern.name, pattern.protocol || '', 'message']),
            },
        });

        for (const sender of pattern.senders || []) {
            const sourceMethod = sender.id ? nodeMap.get(sender.id) : methodByName.get(sender.name);
            if (!sourceMethod) {
                continue;
            }
            addEdge({
                from: sourceMethod.id,
                to: messageNode.id,
                type: 'emits',
                sourceKind: 'message',
                area: sourceMethod.area || messageNode.area,
                meta: {
                    protocol: pattern.protocol || '',
                    message: pattern.name,
                    via: 'protocol-learning',
                    callee: sender.callee || '',
                },
            });
        }

        for (const dispatcher of pattern.dispatchers || []) {
            const dispatcherMethod = dispatcher.id ? nodeMap.get(dispatcher.id) : methodByName.get(dispatcher.name);
            if (!dispatcherMethod) {
                continue;
            }
            addEdge({
                from: dispatcherMethod.id,
                to: messageNode.id,
                type: 'binds',
                sourceKind: 'message',
                area: dispatcherMethod.area || messageNode.area,
                meta: {
                    protocol: pattern.protocol || '',
                    message: pattern.name,
                    role: 'dispatcher',
                    via: 'protocol-learning',
                },
            });
        }

        for (const handler of pattern.handlers || []) {
            const targetMethod = handler.id ? nodeMap.get(handler.id) : methodByName.get(handler.name);
            if (!targetMethod) {
                continue;
            }
            addEdge({
                from: messageNode.id,
                to: targetMethod.id,
                type: 'binds',
                sourceKind: 'message',
                area: targetMethod.area || messageNode.area,
                meta: {
                    protocol: pattern.protocol || '',
                    message: pattern.name,
                    role: 'handler',
                    via: 'protocol-learning',
                },
            });
        }
    }

    return {
        ...graph,
        nodes,
        edges,
        projectProtocolsSummary: protocols.summary || null,
    };
}

function updateProjectGlobalReport(report, graph, lookup, protocols) {
    const nodesByType = Object.fromEntries(
        Object.entries(lookup.nodesByType || {}).map(([type, ids]) => [type, Array.isArray(ids) ? ids.length : 0])
    );

    return {
        ...report,
        counts: {
            ...(report.counts || {}),
            nodes: Array.isArray(graph.nodes) ? graph.nodes.length : 0,
            edges: Array.isArray(graph.edges) ? graph.edges.length : 0,
            nodesByType,
        },
        protocolLearning: {
            messages: protocols.summary?.messages || 0,
            dispatchers: protocols.summary?.dispatchers || 0,
            statePatterns: protocols.summary?.statePatterns || 0,
            timingPatterns: protocols.summary?.timingPatterns || 0,
            phasePatterns: protocols.summary?.phasePatterns || 0,
            transitionPatterns: protocols.summary?.transitionPatterns || 0,
            routeKinds: protocols.summary?.routeKinds || 0,
            requestProtocols: protocols.summary?.requestProtocols || 0,
        },
        queryExamples: unique([
            ...(report.queryExamples || []),
            'node scripts/query_project_kb.js --root <project-root>',
            'node scripts/query_project_kb.js --root <project-root> --message <message> --downstream',
            'node scripts/query_project_kb.js --root <project-root> --state <state> --upstream',
            'node scripts/query_project_kb.js --root <project-root> --timing <query>',
            'node scripts/query_project_kb.js --root <project-root> --phase <query>',
            'node scripts/query_project_kb.js --root <project-root> --transition <query>',
        ]),
    };
}

function run(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    const root = resolveProjectRoot(args.root || process.cwd());
    const projectProfile = loadProjectProfile(root);
    if (!projectProfile) {
        throw new Error('未找到 project-profile.json；请先初始化项目记忆并运行 detect_project_topology.js');
    }

    const config = buildProjectGlobalConfig(root, projectProfile);
    const configPath = path.join(root, 'project-memory', 'kb', 'configs', 'project-global.json');
    ensureDir(path.dirname(configPath));
    writeJson(configPath, config);

    buildChainKb(['--root', root, '--config', configPath]);

    const scanPath = path.join(root, config.outputs.scan);
    const graphPath = path.join(root, config.outputs.graph);
    const lookupPath = path.join(root, config.outputs.lookup);
    const reportPath = path.join(root, config.outputs.report);
    const protocolsPath = path.join(root, 'project-memory', 'state', 'project-protocols.json');

    const raw = readJson(scanPath);
    const graph = readJson(graphPath);
    const lookup = readJson(lookupPath);
    const report = readJson(reportPath);
    const protocols = learnProjectProtocols(raw, graph, lookup, root);
    writeJson(protocolsPath, protocols);

    const augmentedGraph = augmentGraphWithProtocols(graph, protocols);
    const augmentedLookup = buildLookup(augmentedGraph);
    const augmentedReport = updateProjectGlobalReport(report, augmentedGraph, augmentedLookup, protocols);

    writeJson(graphPath, augmentedGraph);
    writeJson(lookupPath, augmentedLookup);
    writeJson(reportPath, augmentedReport);

    const result = {
        kind: 'project-global-build',
        root: normalize(root),
        graphPath: repoRelative(graphPath, root),
        lookupPath: repoRelative(lookupPath, root),
        protocolsPath: repoRelative(protocolsPath, root),
        counts: {
            nodes: augmentedGraph.nodes.length,
            edges: augmentedGraph.edges.length,
            messages: protocols.summary?.messages || 0,
            dispatchers: protocols.summary?.dispatchers || 0,
            statePatterns: protocols.summary?.statePatterns || 0,
            timingPatterns: protocols.summary?.timingPatterns || 0,
            phasePatterns: protocols.summary?.phasePatterns || 0,
            transitionPatterns: protocols.summary?.transitionPatterns || 0,
        },
    };

    if (args.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
    }

    console.log(`项目全局 KB 已构建: ${result.root}`);
    console.log(`- graph: ${result.graphPath}`);
    console.log(`- lookup: ${result.lookupPath}`);
    console.log(`- protocols: ${result.protocolsPath}`);
    console.log(`- messages: ${result.counts.messages}`);
    console.log(`- dispatchers: ${result.counts.dispatchers}`);
    console.log(`- statePatterns: ${result.counts.statePatterns}`);
    console.log(`- timingPatterns: ${result.counts.timingPatterns}`);
    console.log(`- phasePatterns: ${result.counts.phasePatterns}`);
    console.log(`- transitionPatterns: ${result.counts.transitionPatterns}`);
}

module.exports = {
    augmentGraphWithProtocols,
    buildProjectGlobalConfig,
    collectProjectScanRoots,
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
