#!/usr/bin/env node
/**
 * 生产环境清理脚本
 * 
 * 在技能正式安装到 AI 环境后，运行此脚本清理开发/维护类文件，
 * 减小体积并避免不必要的文件干扰。
 * 
 * 使用方式:
 *   node scripts/clean_for_production.js [--level=standard] [--dry-run]
 * 
 * 清理级别:
 *   minimal  - 仅清理最大的非必要文件（.git、tests）
 *   standard - 标准清理，保留 README 和示例（推荐）
 *   full     - 完整清理，仅保留 AI 运行必需的
 */

const fs = require('fs');
const path = require('path');

// 文件大小格式化
function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 计算目录大小
function getDirSize(dirPath) {
    let size = 0;
    try {
        const files = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const file of files) {
            const filePath = path.join(dirPath, file.name);
            if (file.isDirectory()) {
                size += getDirSize(filePath);
            } else {
                size += fs.statSync(filePath).size;
            }
        }
    } catch (e) {
        // 忽略无法访问的目录
    }
    return size;
}

// 清理规则定义
const CLEANUP_RULES = {
    minimal: {
        description: '最小清理 - 仅移除最大的非必要文件',
        files: [],
        dirs: ['.git', 'tests', '.runtime']
    },
    standard: {
        description: '标准清理 - 推荐，平衡体积和功能',
        files: [
            'LICENSE',
            'CHANGELOG.md',
            'CONTRIBUTING.md'
        ],
        dirs: ['.git', 'tests', '.runtime', 'node_modules/typescript/.github']
    },
    full: {
        description: '完整清理 - 仅保留 AI 运行必需的',
        files: [
            'LICENSE',
            'CHANGELOG.md',
            'CONTRIBUTING.md',
            'README.md'  // AI 不读 README，只读 SKILL.md
        ],
        dirs: [
            '.git',
            'tests',
            '.runtime',
            'examples',  // AI 通过 SKILL.md 学习，不需要示例
            'node_modules/typescript/.github',
            'node_modules/typescript/doc',
            'node_modules/typescript/lib/cs',
            'node_modules/typescript/lib/de',
            'node_modules/typescript/lib/es',
            'node_modules/typescript/lib/fr',
            'node_modules/typescript/lib/it',
            'node_modules/typescript/lib/ja',
            'node_modules/typescript/lib/ko',
            'node_modules/typescript/lib/pl',
            'node_modules/typescript/lib/pt-br',
            'node_modules/typescript/lib/ru',
            'node_modules/typescript/lib/tr',
            'node_modules/typescript/lib/zh-cn',
            'node_modules/typescript/lib/zh-tw'
        ]
    }
};

// AI 必需的核心文件清单（用于验证）
const CORE_FILES = [
    'SKILL.md',
    'skill-version.json',
    'package.json',
    'scripts/init_project_memory.js',
    'scripts/build_chain_kb.js',
    'scripts/query_kb.js',
    'scripts/query_project_kb.js',
    'scripts/build_project_kb.js',
    'references/core/kb-schema.md',
    'references/core/work-protocols.md',
    'agents/openai.yaml'
];

// 主函数
function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    
    // 解析清理级别
    let level = 'standard';
    const levelArg = args.find(arg => arg.startsWith('--level='));
    if (levelArg) {
        level = levelArg.split('=')[1];
    }
    
    if (!CLEANUP_RULES[level]) {
        console.error(`错误: 未知的清理级别 "${level}"`);
        console.error('可用级别: minimal, standard, full');
        process.exit(1);
    }
    
    const skillRoot = path.resolve(__dirname, '..');
    const rules = CLEANUP_RULES[level];
    
    console.log('='.repeat(60));
    console.log('生产环境清理脚本');
    console.log('='.repeat(60));
    console.log(`\n清理级别: ${level}`);
    console.log(`说明: ${rules.description}`);
    console.log(`模式: ${dryRun ? '预览 (dry-run)' : '实际执行'}`);
    console.log(`\n工作目录: ${skillRoot}\n`);
    
    let totalFreed = 0;
    let deletedFiles = 0;
    let deletedDirs = 0;
    let errors = [];
    
    // 处理文件
    if (rules.files.length > 0) {
        console.log('-'.repeat(60));
        console.log('清理文件:\n');
        
        for (const file of rules.files) {
            const filePath = path.join(skillRoot, file);
            try {
                const stats = fs.statSync(filePath);
                if (stats.isFile()) {
                    const size = stats.size;
                    console.log(`  [文件] ${file} (${formatSize(size)})`);
                    
                    if (!dryRun) {
                        fs.unlinkSync(filePath);
                    }
                    
                    totalFreed += size;
                    deletedFiles++;
                }
            } catch (e) {
                if (e.code !== 'ENOENT') {
                    errors.push(`删除文件失败: ${file} - ${e.message}`);
                }
            }
        }
    }
    
    // 处理目录
    if (rules.dirs.length > 0) {
        console.log('\n' + '-'.repeat(60));
        console.log('清理目录:\n');
        
        for (const dir of rules.dirs) {
            const dirPath = path.join(skillRoot, dir);
            try {
                const stats = fs.statSync(dirPath);
                if (stats.isDirectory()) {
                    const size = getDirSize(dirPath);
                    console.log(`  [目录] ${dir} (${formatSize(size)})`);
                    
                    if (!dryRun) {
                        fs.rmSync(dirPath, { recursive: true, force: true });
                    }
                    
                    totalFreed += size;
                    deletedDirs++;
                }
            } catch (e) {
                if (e.code !== 'ENOENT') {
                    errors.push(`删除目录失败: ${dir} - ${e.message}`);
                }
            }
        }
    }
    
    // 摘要
    console.log('\n' + '='.repeat(60));
    console.log('清理摘要');
    console.log('='.repeat(60));
    console.log(`删除文件数: ${deletedFiles}`);
    console.log(`删除目录数: ${deletedDirs}`);
    console.log(`释放空间: ${formatSize(totalFreed)}`);
    
    if (dryRun) {
        console.log('\n[预览模式] 未实际删除任何文件');
        console.log('要实际执行清理，请去掉 --dry-run 参数');
    }
    
    // 验证核心文件
    if (!dryRun) {
        console.log('\n' + '-'.repeat(60));
        console.log('验证核心文件...\n');
        
        let missingCore = [];
        for (const file of CORE_FILES) {
            const filePath = path.join(skillRoot, file);
            try {
                fs.accessSync(filePath, fs.constants.F_OK);
                console.log(`  ✓ ${file}`);
            } catch (e) {
                console.log(`  ✗ ${file} (缺失)`);
                missingCore.push(file);
            }
        }
        
        if (missingCore.length > 0) {
            console.log(`\n警告: ${missingCore.length} 个核心文件缺失!`);
            console.log('请重新安装技能包');
        } else {
            console.log('\n✓ 所有核心文件完好');
        }
    }
    
    // 错误报告
    if (errors.length > 0) {
        console.log('\n' + '-'.repeat(60));
        console.log('错误报告:\n');
        errors.forEach(e => console.log(`  ! ${e}`));
    }
    
    // 使用提示
    console.log('\n' + '='.repeat(60));
    console.log('提示');
    console.log('='.repeat(60));
    console.log('清理后的技能包仍可正常使用，');
    console.log('AI 将通过 SKILL.md 和 references/ 目录获取使用说明。');
    
    if (level === 'full') {
        console.log('\n注意: 您使用了 full 级别，README.md 已被删除。');
        console.log('      如需查看人类可读的项目说明，请访问 GitHub 仓库。');
    }
    
    console.log('');
}

// 导出供其他脚本使用
module.exports = {
    CLEANUP_RULES,
    CORE_FILES,
    formatSize,
    getDirSize
};

// 直接运行
if (require.main === module) {
    main();
}
