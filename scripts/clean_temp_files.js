#!/usr/bin/env node
/**
 * 清理技能生成的临时文件和残留配置
 * 
 * 使用方法:
 *   node scripts/clean_temp_files.js [--dry-run]
 * 
 * 选项:
 *   --dry-run  只显示要删除的文件，不实际删除
 */

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
    const args = { dryRun: false, root: '' };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--dry-run') {
            args.dryRun = true;
        } else if (argv[i] === '--root' && i + 1 < argv.length) {
            args.root = path.resolve(argv[++i]);
        }
    }
    return args;
}

function findProjectRoot(startDir = process.cwd()) {
    let current = startDir;
    while (true) {
        if (fs.existsSync(path.join(current, 'project-memory'))) {
            return current;
        }
        const parent = path.dirname(current);
        if (parent === current) {
            return startDir;
        }
        current = parent;
    }
}

function findFilesToClean(projectRoot) {
    const filesToClean = [];
    
    // 1. 查找残留的 KB 配置文件
    const kbConfigsDir = path.join(projectRoot, 'project-memory', 'kb', 'configs');
    if (fs.existsSync(kbConfigsDir)) {
        const files = fs.readdirSync(kbConfigsDir);
        for (const file of files) {
            if (file.endsWith('.json')) {
                const filePath = path.join(kbConfigsDir, file);
                try {
                    const content = fs.readFileSync(filePath, 'utf8');
                    const config = JSON.parse(content);
                    
                    // 检查是否为测试配置（没有对应 feature 目录或标记为测试）
                    const featureKey = config.featureKey;
                    
                    // 排除 project-global（项目级 KB，不需要 feature 目录）
                    if (featureKey === 'project-global') {
                        continue;
                    }
                    
                    const featureDir = path.join(projectRoot, 'project-memory', 'docs', 'features', featureKey);
                    const isTestConfig = file.includes('test') || file.includes('temp') || !fs.existsSync(featureDir);
                    
                    if (isTestConfig) {
                        filesToClean.push({
                            path: filePath,
                            type: '残留 KB 配置',
                            reason: `featureKey "${featureKey}" 没有对应目录`,
                        });
                    }
                } catch (err) {
                    // 无法解析的 JSON 也清理
                    filesToClean.push({
                        path: filePath,
                        type: '损坏的配置',
                        reason: 'JSON 解析失败',
                    });
                }
            }
        }
    }
    
    // 2. 查找残留的 KB 产物目录（没有对应配置）
    const kbFeaturesDir = path.join(projectRoot, 'project-memory', 'kb', 'features');
    if (fs.existsSync(kbFeaturesDir)) {
        const dirs = fs.readdirSync(kbFeaturesDir, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(d => d.name);
        
        for (const dir of dirs) {
            const configPath = path.join(kbConfigsDir, `${dir}.json`);
            if (!fs.existsSync(configPath)) {
                filesToClean.push({
                    path: path.join(kbFeaturesDir, dir),
                    type: '残留 KB 产物',
                    reason: `没有对应配置文件 ${dir}.json`,
                });
            }
        }
    }
    
    // 3. 查找临时文件
    const tempPatterns = [
        path.join(projectRoot, '**', '*.tmp'),
        path.join(projectRoot, '**', '.tmp-*'),
        path.join(projectRoot, '**', '*~'),
        path.join(projectRoot, '**', '*.bak'),
    ];
    
    // 4. 查找空的 feature 目录
    const featuresDir = path.join(projectRoot, 'project-memory', 'docs', 'features');
    if (fs.existsSync(featuresDir)) {
        const dirs = fs.readdirSync(featuresDir, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(d => d.name);
        
        for (const dir of dirs) {
            const featureDir = path.join(featuresDir, dir);
            const files = fs.readdirSync(featureDir);
            // 只保留 FEATURE.md 的空目录
            const hasRealContent = files.some(f => !f.startsWith('.') && f !== 'FEATURE.md');
            
            if (!hasRealContent && files.length <= 1) {
                // 检查是否有对应的 KB
                const kbExists = fs.existsSync(path.join(kbFeaturesDir, dir));
                if (!kbExists) {
                    filesToClean.push({
                        path: featureDir,
                        type: '空 feature 目录',
                        reason: '没有内容且没有 KB',
                    });
                }
            }
        }
    }
    
    return filesToClean;
}

function deletePath(targetPath, dryRun = false) {
    try {
        const stat = fs.statSync(targetPath);
        if (stat.isDirectory()) {
            if (!dryRun) {
                fs.rmSync(targetPath, { recursive: true, force: true });
            }
            return '目录';
        } else {
            if (!dryRun) {
                fs.unlinkSync(targetPath);
            }
            return '文件';
        }
    } catch (err) {
        return `错误: ${err.message}`;
    }
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    
    console.log('=== Project Memory Manager 清理工具 ===\n');
    
    if (args.dryRun) {
        console.log('⚠️  干运行模式 - 不会实际删除文件\n');
    }
    
    const projectRoot = args.root || findProjectRoot();
    console.log(`项目根目录: ${projectRoot}\n`);
    
    const filesToClean = findFilesToClean(projectRoot);
    
    if (filesToClean.length === 0) {
        console.log('✅ 没有发现需要清理的文件');
        return;
    }
    
    console.log(`发现 ${filesToClean.length} 个可清理项目:\n`);
    
    // 按类型分组
    const byType = {};
    for (const item of filesToClean) {
        if (!byType[item.type]) {
            byType[item.type] = [];
        }
        byType[item.type].push(item);
    }
    
    // 显示分组结果
    for (const [type, items] of Object.entries(byType)) {
        console.log(`${type} (${items.length}):`);
        for (const item of items) {
            const relativePath = path.relative(projectRoot, item.path);
            console.log(`  - ${relativePath}`);
            console.log(`    原因: ${item.reason}`);
        }
        console.log();
    }
    
    // 执行清理
    if (!args.dryRun) {
        console.log('正在清理...\n');
        let success = 0;
        let failed = 0;
        
        for (const item of filesToClean) {
            const result = deletePath(item.path, args.dryRun);
            if (result.startsWith('错误')) {
                console.log(`❌ ${result}: ${item.path}`);
                failed++;
            } else {
                console.log(`✅ 已删除 ${result}: ${path.relative(projectRoot, item.path)}`);
                success++;
            }
        }
        
        console.log(`\n清理完成: ${success} 成功, ${failed} 失败`);
    } else {
        console.log('干运行完成。实际清理请去掉 --dry-run 参数。');
    }
    
    console.log('\n=== 清理建议 ===');
    console.log('1. 定期运行此脚本清理残留文件');
    console.log('2. 测试配置建议命名: xxx-test.json，方便识别');
    console.log('3. 删除 feature 时同时删除对应 KB 配置');
}

main();
