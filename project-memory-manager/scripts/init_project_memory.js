#!/usr/bin/env node

const path = require('path');
const { ensureDir, writeJson, writeText } = require('./lib/common');

function parseArgs(argv) {
    const args = {
        root: process.cwd(),
        name: path.basename(process.cwd()),
    };

    for (let index = 0; index < argv.length; index++) {
        const token = argv[index];
        if (token === '--root') {
            args.root = path.resolve(argv[++index]);
            continue;
        }
        if (token === '--name') {
            args.name = argv[++index];
        }
    }

    return args;
}

function run(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    const memoryRoot = path.join(args.root, 'project-memory');
    const dirs = [
        'SYSTEM',
        'docs/project',
        'docs/standards',
        'docs/domains',
        'docs/features',
        'docs/work/active',
        'docs/work/archive',
        'kb/configs',
        'kb/features',
        'kb/indexes',
        'reports',
        'state',
        'legacy',
    ];

    for (const relativeDir of dirs) {
        ensureDir(path.join(memoryRoot, relativeDir));
    }

    writeText(path.join(memoryRoot, 'README.md'), `# ${args.name} 项目记忆\n`);
    writeJson(path.join(memoryRoot, 'state', 'project-profile.json'), {
        projectName: args.name,
        projectType: 'single-stack',
        areas: {
            frontend: [],
            backend: [],
            shared: [],
            contract: [],
            data: [],
            ops: [],
        },
        stacks: {
            frontend: [],
            backend: [],
            shared: [],
            contract: [],
            data: [],
            ops: [],
        },
        integration: {
            primary: [],
            secondary: [],
        },
    });
    writeJson(path.join(memoryRoot, 'state', 'active-work.json'), { generatedAt: null, activeWorks: [] });
    writeJson(path.join(memoryRoot, 'state', 'feature-registry.json'), { generatedAt: null, features: [] });

    console.log(`项目记忆根目录已初始化: ${memoryRoot}`);
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
