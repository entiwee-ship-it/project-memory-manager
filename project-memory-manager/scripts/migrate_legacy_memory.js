#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { ensureDir } = require('./lib/common');

function parseArgs(argv) {
    const args = {
        root: process.cwd(),
        source: '.kimi',
        dest: path.join('project-memory', 'legacy', 'kimi_snapshot'),
    };

    for (let index = 0; index < argv.length; index++) {
        const token = argv[index];
        if (token === '--root') {
            args.root = path.resolve(argv[++index]);
            continue;
        }
        if (token === '--source') {
            args.source = argv[++index];
            continue;
        }
        if (token === '--dest') {
            args.dest = argv[++index];
        }
    }

    return args;
}

function run(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    const sourcePath = path.resolve(args.root, args.source);
    const destPath = path.resolve(args.root, args.dest);

    if (!fs.existsSync(sourcePath)) {
        throw new Error(`未找到旧体系来源目录: ${sourcePath}`);
    }

    ensureDir(path.dirname(destPath));
    fs.cpSync(sourcePath, destPath, { recursive: true, force: true });
    console.log(`旧体系快照已迁移: ${destPath}`);
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
