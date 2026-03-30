#!/usr/bin/env node
/**
 * KB 重建脚本 - 支持部分失败容忍
 * 
 * 特性：
 * - 批量重建时单个 feature 失败不会中断整体流程
 * - 提供详细的失败报告和修复建议
 * - 支持事务性更新（可选）
 */

const fs = require('fs');
const path = require('path');
const { resolveProjectRoot, readJsonSafe, writeJsonAtomic } = require('./lib/common');
const { normalizeFeatureRecord } = require('./lib/feature-kb');
const { run: buildChainKb } = require('./build_chain_kb');
const { withLock, getProjectLockPath } = require('./lib/lock');
const { run: buildProjectKb } = require('./build_project_kb');
const { run: buildCocosAuthoringProfile } = require('./build_cocos_authoring_profile');
const { run: refreshMemoryIndexes } = require('./refresh_memory_indexes');

function parseArgs(argv) {
    const args = {
        root: '',
        feature: '',
        continueOnError: true, // 默认继续执行
    };

    for (let index = 0; index < argv.length; index++) {
        if (argv[index] === '--root') {
            args.root = argv[++index] || '';
            continue;
        }
        if (argv[index] === '--feature') {
            args.feature = argv[++index] || '';
            continue;
        }
        if (argv[index] === '--stop-on-error') {
            args.continueOnError = false;
            continue;
        }
    }

    return args;
}

function collectConfigPaths(root) {
    const registryPath = path.join(root, 'project-memory', 'state', 'feature-registry.json');
    const results = [];
    const seen = new Set();

    // 从 registry 读取
    const registry = readJsonSafe(registryPath, { 
        required: false, 
        defaultValue: { features: [] } 
    });
    
    for (const item of registry.features || []) {
        const feature = normalizeFeatureRecord(item);
        if (!feature.configPath) {
            continue;
        }
        const absoluteConfigPath = path.resolve(root, feature.configPath);
        if (!fs.existsSync(absoluteConfigPath)) {
            console.warn(`[SKILL-WARN] 配置文件不存在: ${absoluteConfigPath}`);
            continue;
        }
        if (seen.has(absoluteConfigPath)) {
            continue;
        }
        seen.add(absoluteConfigPath);
        results.push({
            featureKey: feature.featureKey,
            configPath: absoluteConfigPath,
        });
    }

    // 从 configs 目录读取（补充 registry 中可能缺失的）
    const configDir = path.join(root, 'project-memory', 'kb', 'configs');
    if (fs.existsSync(configDir)) {
        for (const entry of fs.readdirSync(configDir, { withFileTypes: true })) {
            if (!entry.isFile() || !entry.name.endsWith('.json')) {
                continue;
            }
            const absoluteConfigPath = path.join(configDir, entry.name);
            if (seen.has(absoluteConfigPath)) {
                continue;
            }
            seen.add(absoluteConfigPath);
            results.push({
                featureKey: '',
                configPath: absoluteConfigPath,
            });
        }
    }

    return results;
}

function resolveTargets(root, featureKey) {
    const allTargets = collectConfigPaths(root);
    if (!featureKey) {
        return allTargets;
    }

    const matches = allTargets.filter(item => {
        if (item.featureKey === featureKey) {
            return true;
        }
        const baseName = path.basename(item.configPath, path.extname(item.configPath));
        return baseName === featureKey;
    });
    return matches;
}

/**
 * 重建单个 feature
 * @returns {Object} { success: boolean, error?: Error, featureKey?: string }
 */
function rebuildFeature(root, target) {
    try {
        console.log(`\n[REBUILD] ${path.relative(root, target.configPath).replace(/\\/g, '/')}`);
        buildChainKb(['--root', root, '--config', target.configPath]);
        return { 
            success: true, 
            featureKey: target.featureKey || path.basename(target.configPath, '.json') 
        };
    } catch (error) {
        console.error(`[REBUILD-FAILED] ${target.featureKey || target.configPath}`);
        console.error(`  错误: ${error.message}`);
        
        return { 
            success: false, 
            featureKey: target.featureKey || path.basename(target.configPath, '.json'),
            error,
            configPath: target.configPath,
        };
    }
}

/**
 * 打印重建报告
 */
function printReport(results, root) {
    const successes = results.filter(r => r.success);
    const failures = results.filter(r => !r.success);
    
    console.log('\n' + '='.repeat(60));
    console.log('KB 重建报告');
    console.log('='.repeat(60));
    console.log(`成功: ${successes.length} 个`);
    console.log(`失败: ${failures.length} 个`);
    
    if (successes.length > 0) {
        console.log('\n✅ 成功列表:');
        successes.forEach(r => {
            console.log(`  • ${r.featureKey}`);
        });
    }
    
    if (failures.length > 0) {
        console.log('\n❌ 失败列表:');
        failures.forEach(r => {
            console.log(`\n  • ${r.featureKey}`);
            console.log(`    配置: ${r.configPath}`);
            console.log(`    错误: ${r.error?.message?.split('\n')[0] || 'Unknown'}`);
            console.log(`    修复建议: 检查配置格式，运行:`);
            console.log(`      node scripts/build_chain_kb.js --config ${path.relative(root, r.configPath)}`);
        });
    }
    
    // 写入报告文件
    const reportPath = path.join(root, 'project-memory', 'reports', 'rebuild-report.json');
    try {
        writeJsonAtomic(reportPath, {
            generatedAt: new Date().toISOString(),
            summary: {
                total: results.length,
                success: successes.length,
                failed: failures.length,
            },
            successes: successes.map(r => ({ featureKey: r.featureKey })),
            failures: failures.map(r => ({
                featureKey: r.featureKey,
                configPath: r.configPath,
                error: r.error?.message || 'Unknown error',
            })),
        });
        console.log(`\n📄 详细报告已保存: ${path.relative(root, reportPath)}`);
    } catch (err) {
        console.warn(`[SKILL-WARN] 无法写入报告文件: ${err.message}`);
    }
    
    console.log('='.repeat(60));
}

function run(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    const root = resolveProjectRoot(args.root || process.cwd());
    
    // 使用锁防止并发重建
    const lockPath = getProjectLockPath(root, 'rebuild');
    
    return withLock(lockPath, () => {
        return doRebuild(args, root);
    }, { wait: false });
}

function doRebuild(args, root) {
    // 结果收集
    const results = [];
    
    // 重建 project-global
    console.log('[REBUILD] project-global');
    try {
        buildProjectKb(['--root', root]);
    } catch (error) {
        console.error('[REBUILD-FAILED] project-global');
        console.error(`  错误: ${error.message}`);
        results.push({
            success: false,
            featureKey: 'project-global',
            error,
        });
        // project-global 失败是致命的，直接退出
        throw new Error(
            `[SKILL-DIAGNOSIS] project-global KB 重建失败\n` +
            `这是致命错误，因为其他 feature 依赖它。\n` +
            `错误: ${error.message}\n\n` +
            `修复建议:\n` +
            `  1. 检查项目结构是否正确\n` +
            `  2. 确认有源代码可供扫描\n` +
            `  3. 重新初始化项目记忆: node scripts/init_project_memory.js --root ${root}`
        );
    }
    
    // 如果只重建 project-global
    if (args.feature === 'project-global') {
        try {
            buildCocosAuthoringProfile(['--root', root]);
            refreshMemoryIndexes(['--root', root]);
            console.log('[REBUILD] ✅ project-global + cocos-authoring-profile 完成');
        } catch (error) {
            console.error('[SKILL-WARN] cocos-authoring-profile 或索引刷新失败:', error.message);
            console.log('[REBUILD] ⚠️ project-global 完成，但辅助产物失败');
        }
        return;
    }
    
    // 收集 targets（排除 project-global）
    const targets = resolveTargets(root, args.feature)
        .filter(target => {
            const baseName = path.basename(target.configPath, path.extname(target.configPath));
            return target.featureKey !== 'project-global' && baseName !== 'project-global';
        });

    if (targets.length <= 0) {
        console.warn('[SKILL-WARN] 未找到可重建的 KB 配置');
        console.log('[SKILL-INFO] 如需初始化，运行: node scripts/init_project_memory.js --root ' + root);
        return;
    }

    console.log(`\n[REBUILD] 共 ${targets.length} 个 feature 待重建\n`);

    // 批量重建
    for (const target of targets) {
        const result = rebuildFeature(root, target);
        results.push(result);
        
        // 如果设置了 --stop-on-error 且失败，立即退出
        if (!args.continueOnError && !result.success) {
            throw new Error(
                `[SKILL-DIAGNOSIS] 重建中断\n` +
                `Feature ${result.featureKey} 重建失败，且设置了 --stop-on-error\n` +
                `错误: ${result.error?.message}`
            );
        }
    }

    // 重建 cocos-authoring-profile（即使部分 feature 失败也继续）
    try {
        buildCocosAuthoringProfile(['--root', root, ...(args.feature ? ['--feature', args.feature] : [])]);
    } catch (error) {
        console.error('[SKILL-WARN] cocos-authoring-profile 重建失败:', error.message);
    }
    
    // 刷新索引（即使部分失败也继续）
    try {
        refreshMemoryIndexes(['--root', root]);
    } catch (error) {
        console.error('[SKILL-WARN] 索引刷新失败:', error.message);
    }

    // 打印报告
    printReport(results, root);
    
    // 如果有失败，以非零退出码结束，但报告已生成
    const hasFailures = results.some(r => !r.success);
    if (hasFailures) {
        console.error(`\n[SKILL-ERROR] 有 ${results.filter(r => !r.success).length} 个 feature 重建失败`);
        console.log('[SKILL-INFO] 查看上方报告获取详细信息和修复建议');
        process.exitCode = 1; // 设置退出码但不抛出异常，确保报告已打印
    } else {
        console.log('\n[REBUILD] ✅ 全部重建完成');
    }
} // end of doRebuild

module.exports = {
    collectConfigPaths,
    rebuildFeature,
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
