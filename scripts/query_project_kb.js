#!/usr/bin/env node

const path = require('path');
const { readJson, resolveProjectRoot } = require('./lib/common');
const { run: runFeatureQuery } = require('./query_chain_kb');

function parseArgs(argv) {
    const args = {
        root: '',
        json: false,
        hasQuery: false,
    };

    const queryFlags = new Set([
        '--message',
        '--event',
        '--method',
        '--request',
        '--state',
        '--type',
        '--name',
        '--tag',
        '--file',
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
            args.root = argv[index + 1] || '';
        }
        if (token === '--json') {
            args.json = true;
        }
        if (queryFlags.has(token)) {
            args.hasQuery = true;
        }
    }

    return args;
}

function loadProjectSummary(root) {
    const graph = readJson(path.join(root, 'project-memory', 'kb', 'project-global', 'chain.graph.json'));
    const lookup = readJson(path.join(root, 'project-memory', 'kb', 'project-global', 'chain.lookup.json'));
    const protocols = readJson(path.join(root, 'project-memory', 'state', 'project-protocols.json'));

    return {
        kind: 'project-summary',
        project: {
            root,
            kbDir: 'project-memory/kb/project-global',
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
        },
        builtWithSkill: graph.builtWithSkill || null,
        protocolsSummary: protocols.summary || {},
        examples: [
            'node scripts/query_project_kb.js --root <project-root>',
            'node scripts/query_project_kb.js --root <project-root> --message <message> --downstream',
            'node scripts/query_project_kb.js --root <project-root> --message <message> --upstream',
            'node scripts/query_project_kb.js --root <project-root> --state <state> --upstream',
            'node scripts/query_project_kb.js --root <project-root> --type method --name <keyword>',
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
    console.log('- nodesByType:');
    Object.entries(summary.counts.nodesByType || {})
        .sort((left, right) => left[0].localeCompare(right[0]))
        .forEach(([type, count]) => console.log(`  - ${type}: ${count}`));
    console.log('- examples:');
    (summary.examples || []).forEach(example => console.log(`  - ${example}`));
}

function run(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    const root = resolveProjectRoot(args.root || process.cwd());

    if (!args.hasQuery) {
        printProjectSummary(loadProjectSummary(root), args.json);
        return;
    }

    const forwardedArgs = ['--feature', 'project-global', '--root', root, ...argv];
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
