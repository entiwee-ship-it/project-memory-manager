#!/usr/bin/env node

const path = require('path');
const { readJson, resolveProjectRoot } = require('../../shared/common');
const { createWorkspaceContext, parseLayoutArgs } = require('../../shared/workspace-layout');
const { run: runFeatureQuery } = require('../../query/query-chain');

function parseArgs(argv) {
    const layoutArgs = parseLayoutArgs(argv);
    const args = {
        root: layoutArgs.workspaceRoot || '',
        dataRoot: layoutArgs.dataRoot || '',
        layout: layoutArgs.layout || '',
        message: '',
        timing: '',
        phase: '',
        transition: '',
        json: false,
        hasQuery: false,
    };

    const queryFlags = new Set([
        '--message',
        '--timing',
        '--phase',
        '--transition',
        '--event',
        '--method',
        '--request',
        '--endpoint',
        '--state',
        '--type',
        '--name',
        '--tag',
        '--file',
        '--exclude-file',
        '--exclude-prefab',
        '--area',
        '--module',
        '--exclude-module',
        '--protocol',
        '--path',
        '--detail',
        '--mode',
        '--fullstack',
        '--focus',
        '--include-unresolved',
        '--grouped',
        '--group-limit',
        '--instance-limit',
        '--node-path-limit',
        '--from',
        '--direction',
        '--upstream',
        '--downstream',
        '--has-handler',
        '--limit',
        '--depth',
    ]);

    for (let index = 0; index < argv.length; index++) {
        const token = argv[index];
        if (token === '--root') {
            args.root = argv[++index] || '';
            continue;
        }
        if (token === '--workspace-root') {
            args.root = argv[++index] || '';
            continue;
        }
        if (token === '--data-root') {
            args.dataRoot = argv[++index] || '';
            continue;
        }
        if (token === '--layout') {
            args.layout = argv[++index] || '';
            continue;
        }
        if (token === '--message') {
            args.message = argv[++index] || '';
            args.hasQuery = true;
            continue;
        }
        if (token === '--timing') {
            args.timing = argv[++index] || '';
            args.hasQuery = true;
            continue;
        }
        if (token === '--phase') {
            args.phase = argv[++index] || '';
            args.hasQuery = true;
            continue;
        }
        if (token === '--transition') {
            args.transition = argv[++index] || '';
            args.hasQuery = true;
            continue;
        }
        if (token === '--json') {
            args.json = true;
            continue;
        }
        if (queryFlags.has(token)) {
            args.hasQuery = true;
        }
    }

    return args;
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

function loadProjectArtifacts(context) {
    const graph = readJson(path.join(context.paths.projectGlobalDir, 'chain.graph.json'));
    const lookup = readJson(path.join(context.paths.projectGlobalDir, 'chain.lookup.json'));
    const protocols = readJson(context.paths.projectProtocols);
    return { graph, lookup, protocols };
}

function loadProjectSummary(context) {
    const { graph, lookup, protocols } = loadProjectArtifacts(context);

    return {
        kind: 'project-summary',
        project: {
            root: context.workspaceRoot,
            kbDir: context.paths.projectGlobalDir,
            dataRoot: context.dataRoot,
            layout: context.layout,
        },
        counts: {
            nodes: Array.isArray(graph.nodes) ? graph.nodes.length : 0,
            edges: Array.isArray(graph.edges) ? graph.edges.length : 0,
            nodesByType: Object.fromEntries(
                Object.entries(lookup.nodesByType || {}).map(([type, ids]) => [type, Array.isArray(ids) ? ids.length : 0])
            ),
            messages: protocols.summary?.messages || 0,
            dispatchers: protocols.summary?.dispatchers || 0,
            statePatterns: protocols.summary?.statePatterns || 0,
            timingPatterns: protocols.summary?.timingPatterns || 0,
            phasePatterns: protocols.summary?.phasePatterns || 0,
            transitionPatterns: protocols.summary?.transitionPatterns || 0,
        },
        builtWithSkill: graph.builtWithSkill || null,
        protocolsSummary: protocols.summary || {},
        examples: [
            'node src/bin/query-project.js --workspace-root <project-root>',
            'node src/bin/query-project.js --workspace-root <project-root> --message <message> --downstream',
            'node src/bin/query-project.js --workspace-root <project-root> --timing <query>',
            'node src/bin/query-project.js --workspace-root <project-root> --phase <query>',
            'node src/bin/query-project.js --workspace-root <project-root> --transition <query>',
            'node src/bin/query-project.js --workspace-root <project-root> --state <state> --upstream',
        ],
    };
}

function printProjectSummary(summary, asJson) {
    if (asJson) {
        console.log(JSON.stringify(summary, null, 2));
        return;
    }

    console.log(`Project Global KB (${summary.project.root})`);
    console.log(`- kbDir: ${summary.project.kbDir}`);
    if (summary.builtWithSkill) {
        console.log(`- builtWithSkill: ${summary.builtWithSkill.name}@${summary.builtWithSkill.version}`);
    }
    console.log(`- nodes: ${summary.counts.nodes}`);
    console.log(`- edges: ${summary.counts.edges}`);
    console.log(`- messages: ${summary.counts.messages}`);
    console.log(`- dispatchers: ${summary.counts.dispatchers}`);
    console.log(`- statePatterns: ${summary.counts.statePatterns}`);
    console.log(`- timingPatterns: ${summary.counts.timingPatterns}`);
    console.log(`- phasePatterns: ${summary.counts.phasePatterns}`);
    console.log(`- transitionPatterns: ${summary.counts.transitionPatterns}`);
    console.log('- nodesByType:');
    Object.entries(summary.counts.nodesByType || {})
        .sort((left, right) => left[0].localeCompare(right[0]))
        .forEach(([type, count]) => console.log(`  - ${type}: ${count}`));
    console.log('- examples:');
    (summary.examples || []).forEach(example => console.log(`  - ${example}`));
}

function searchProtocolEntries(entries, query, fields = []) {
    const matches = (entries || []).filter(entry => fields.some(field => {
        const value = typeof field === 'function' ? field(entry) : entry[field];
        if (Array.isArray(value)) {
            return value.some(item => matchContains(item, query));
        }
        if (value && typeof value === 'object') {
            return Object.values(value).some(item => matchContains(item, query));
        }
        return matchContains(value, query);
    }));
    return matches;
}

function printProtocolResults(kind, results, asJson) {
    if (asJson) {
        console.log(JSON.stringify(results, null, 2));
        return;
    }
    if (!results.length) {
        console.log(`未找到 ${kind} 模式。`);
        return;
    }
    console.log(`找到 ${results.length} 个 ${kind} 模式:`);
    for (const item of results) {
        console.log(`- ${item.name || item.ownerMethod || item.driverMethod || '(unnamed)'} [${item.kind || kind}]`);
        Object.entries(item).forEach(([key, value]) => {
            if (['name', 'kind'].includes(key)) {
                return;
            }
            if (Array.isArray(value)) {
                console.log(`  ${key}: ${value.length ? value.join(', ') : '(none)'}`);
                return;
            }
            if (value && typeof value === 'object') {
                console.log(`  ${key}: ${JSON.stringify(value)}`);
                return;
            }
            console.log(`  ${key}: ${value == null || value === '' ? '(none)' : value}`);
        });
    }
}

function run(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    const context = createWorkspaceContext({
        workspaceRoot: args.root || process.cwd(),
        dataRoot: args.dataRoot,
        layout: args.layout,
    });
    const root = context.workspaceRoot;

    if (!args.hasQuery) {
        printProjectSummary(loadProjectSummary(context), args.json);
        return;
    }

    const { protocols } = loadProjectArtifacts(context);

    if (args.timing) {
        const results = searchProtocolEntries(
            protocols.timingPatterns || [],
            args.timing,
            ['ownerMethod', 'kind', 'trigger', 'callee', 'event', 'nextMethods', 'stateWrites']
        );
        printProtocolResults('timing', results, args.json);
        return;
    }

    if (args.phase) {
        const results = searchProtocolEntries(
            protocols.phasePatterns || [],
            args.phase,
            ['name', 'entryMethod', 'handledMessages', 'emittedMessages', 'stateWrites', 'nextMethods', 'timingKinds']
        );
        printProtocolResults('phase', results, args.json);
        return;
    }

    if (args.transition) {
        const results = searchProtocolEntries(
            protocols.transitionPatterns || [],
            args.transition,
            ['name', 'state', 'driverMethod', 'handledMessages', 'nextMethods', 'transitionKind', 'timingKinds']
        );
        printProtocolResults('transition', results, args.json);
        return;
    }

    const forwardedArgs = ['--feature', 'project-global', '--workspace-root', root, '--data-root', context.dataRoot, '--layout', context.layout, ...argv];
    runFeatureQuery(forwardedArgs);
}

module.exports = {
    loadProjectSummary,
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
