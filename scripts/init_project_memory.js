#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { ensureDir, pathExists, writeJsonAtomic, writeTextAtomic } = require('./lib/common');

function parseArgs(argv) {
    const args = {
        root: process.cwd(),
        name: path.basename(process.cwd()),
        force: false,
    };

    for (let index = 0; index < argv.length; index++) {
        const token = argv[index];
        if (token === '--root') {
            args.root = path.resolve(argv[++index]);
            continue;
        }
        if (token === '--name') {
            args.name = argv[++index];
            continue;
        }
        if (token === '--force') {
            args.force = true;
        }
    }

    return args;
}

function run(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    const memoryRoot = path.join(args.root, 'project-memory');
    
    // 检查是否已存在
    if (pathExists(memoryRoot) && !args.force) {
        // 检查是否已有内容
        const stateDir = path.join(memoryRoot, 'state');
        const profilePath = path.join(stateDir, 'project-profile.json');
        
        if (pathExists(profilePath)) {
            console.log(`[SKILL-INFO] 项目记忆已存在: ${memoryRoot}`);
            console.log(`[SKILL-INFO] 如需重新初始化，使用 --force 参数`);
            console.log(`[SKILL-INFO] 或运行重建: node scripts/rebuild_kbs.js --root ${args.root}`);
            return;
        }
        
        console.log(`[SKILL-INFO] 检测到部分初始化的目录，将继续完成初始化`);
    }
    
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

    try {
        for (const relativeDir of dirs) {
            ensureDir(path.join(memoryRoot, relativeDir));
        }
    } catch (err) {
        throw new Error(
            `[SKILL-DIAGNOSIS] 创建目录失败\n` +
            `路径: ${memoryRoot}\n` +
            `错误: ${err.message}\n\n` +
            `可能原因:\n` +
            `  1. 无写入权限\n` +
            `  2. 磁盘空间不足\n` +
            `  3. 路径是只读文件系统\n\n` +
            `修复建议:\n` +
            `  1. 检查目录权限\n` +
            `  2. 使用 --root 指定其他目录`
        );
    }

    try {
        writeTextAtomic(path.join(memoryRoot, 'README.md'), `# ${args.name} 项目记忆\n`);
        writeJsonAtomic(path.join(memoryRoot, 'state', 'project-profile.json'), {
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
        writeJsonAtomic(path.join(memoryRoot, 'state', 'active-work.json'), { generatedAt: null, activeWorks: [] });
        writeJsonAtomic(path.join(memoryRoot, 'state', 'feature-registry.json'), { generatedAt: null, features: [] });
    } catch (err) {
        throw new Error(
            `[SKILL-DIAGNOSIS] 写入初始文件失败\n` +
            `错误: ${err.message}\n\n` +
            `可能原因:\n` +
            `  1. 磁盘空间不足\n` +
            `  2. 文件系统只读\n\n` +
            `修复建议:\n` +
            `  1. 检查磁盘空间\n` +
            `  2. 检查文件系统权限`
        );
    }

    console.log(`[SKILL-INFO] 项目记忆已初始化: ${memoryRoot}`);
    console.log(`[SKILL-INFO] 下一步: node scripts/detect_project_topology.js --root ${args.root}`);
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
