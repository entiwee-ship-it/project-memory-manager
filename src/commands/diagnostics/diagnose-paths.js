#!/usr/bin/env node
/**
 * 诊断路径问题
 * 
 * 使用方法:
 *   node src/bin/diagnose-paths.js [--workspace-root <path>]
 */

const fs = require('fs');
const path = require('path');
const { createWorkspaceContext, parseLayoutArgs } = require('../../shared/workspace-layout');

function parseArgs(argv) {
    const layoutArgs = parseLayoutArgs(argv);
    const args = {
        root: layoutArgs.workspaceRoot || '',
        dataRoot: layoutArgs.dataRoot || '',
        layout: layoutArgs.layout || '',
    };
    for (let i = 0; i < argv.length; i++) {
        if ((argv[i] === '--root' || argv[i] === '--workspace-root') && i + 1 < argv.length) {
            args.root = path.resolve(argv[++i]);
            continue;
        }
        if (argv[i] === '--data-root' && i + 1 < argv.length) {
            args.dataRoot = path.resolve(argv[++i]);
            continue;
        }
        if (argv[i] === '--layout' && i + 1 < argv.length) {
            args.layout = argv[++i] || '';
        }
    }
    return args;
}

function normalizePath(inputPath) {
    // 统一路径格式
    return inputPath
        .replace(/\\/g, '/')  // 反斜杠 -> 正斜杠
        .replace(/\/+/g, '/') // 多个斜杠 -> 单个
        .replace(/\/$/, '')    // 移除末尾斜杠
        .toLowerCase();       // 统一小写（Windows 不区分大小写）
}

function testPathResolution(testPath, description) {
    const results = {
        description,
        original: testPath,
        normalized: normalizePath(testPath),
        exists: false,
        resolved: null,
        issues: [],
    };
    
    try {
        results.resolved = path.resolve(testPath);
        results.exists = fs.existsSync(testPath);
        
        // 检查大小写问题
        if (results.exists) {
            const realPath = fs.realpathSync.native(testPath);
            if (realPath !== testPath) {
                results.issues.push(`大小写不一致: ${testPath} → ${realPath}`);
            }
        }
        
        // 检查混合斜杠
        if (testPath.includes('/') && testPath.includes('\\')) {
            results.issues.push('混合使用正斜杠和反斜杠');
        }
        
    } catch (err) {
        results.issues.push(`解析错误: ${err.message}`);
    }
    
    return results;
}

function formatLayoutCommandArgs(context) {
    return `--workspace-root "${context.workspaceRoot}" --data-root "${context.dataRoot}" --layout ${context.layout}`;
}

function findPathIssues(context) {
    const issues = [];
    const projectRoot = context.workspaceRoot;
    const legacyProjectMemory = path.join(projectRoot, 'project-memory');
    const layoutCommandArgs = formatLayoutCommandArgs(context);
    
    if (context.layout !== 'legacy-project-memory' && fs.existsSync(legacyProjectMemory)) {
        issues.push({
            severity: 'warning',
            message: `目标仓库存在 legacy project-memory 目录: ${legacyProjectMemory}`,
            fix: '确认是否需要迁移；默认 external-data 不再写入该目录',
        });
    }

    const requiredDirs = [
        { path: context.paths.stateDir, name: '状态目录' },
        { path: context.paths.kbDir, name: '知识库目录' },
        { path: context.paths.reportsDir, name: '报告目录' },
    ];
    
    for (const dir of requiredDirs) {
        if (!fs.existsSync(dir.path)) {
            issues.push({
                severity: 'warning',
                message: `${dir.name} 不存在: ${dir.path}`,
                fix: `node src/bin/init-workspace.js ${layoutCommandArgs}`,
            });
        }
    }

    if (!fs.existsSync(context.paths.projectProfile)) {
        issues.push({
            severity: 'warning',
            message: `项目画像不存在: ${context.paths.projectProfile}`,
            fix: `node src/bin/detect-topology.js ${layoutCommandArgs}`,
        });
    }
    
    // 检查配置文件中的路径问题
    const configsDir = context.paths.configsDir;
    if (fs.existsSync(configsDir)) {
        const configs = fs.readdirSync(configsDir).filter(f => f.endsWith('.json'));
        
        for (const configFile of configs) {
            try {
                const content = fs.readFileSync(path.join(configsDir, configFile), 'utf8');
                const config = JSON.parse(content);
                
                // 检查路径字段
                const pathFields = [
                    'componentRoots', 'assetRoots', 'methodRoots', 
                    'serverRoots', 'moduleRoots', 'dbRoots', 'prefabs'
                ];
                
                for (const field of pathFields) {
                    const values = config[field];
                    if (!values) continue;
                    
                    for (const val of (Array.isArray(values) ? values : [values])) {
                        if (!val) continue;
                        
                        // 检查 Windows 绝对路径在 Unix 配置中
                        if (/^[a-zA-Z]:[\\/]/.test(val) && process.platform !== 'win32') {
                            issues.push({
                                severity: 'error',
                                message: `配置文件 ${configFile} 包含 Windows 绝对路径: ${val}`,
                                fix: '使用相对路径或 POSIX 风格路径',
                            });
                        }
                        
                        // 检查路径是否存在
                        const fullPath = path.isAbsolute(val) ? val : path.join(projectRoot, val);
                        if (!fs.existsSync(fullPath)) {
                            issues.push({
                                severity: 'warning',
                                message: `配置文件 ${configFile} 指向不存在的路径: ${val}`,
                                fix: `检查 ${field} 配置`,
                            });
                        }
                    }
                }
            } catch (err) {
                issues.push({
                    severity: 'error',
                    message: `无法解析配置文件 ${configFile}: ${err.message}`,
                });
            }
        }
    }
    
    return issues;
}

function run(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    const context = createWorkspaceContext({
        workspaceRoot: args.root || process.cwd(),
        dataRoot: args.dataRoot,
        layout: args.layout,
    });
    
    console.log('=== Path Diagnostics ===\n');
    
    // 系统信息
    console.log('系统信息:');
    console.log(`  平台: ${process.platform}`);
    console.log(`  Node 版本: ${process.version}`);
    console.log(`  路径分隔符: ${path.sep}`);
    console.log(`  当前工作目录: ${process.cwd()}`);
    console.log();
    
    // 测试路径解析
    console.log('路径解析测试:');
    const testPaths = [
        'src/bin/build-feature.js',
        './src/bin/build-feature.js',
        'src\\bin\\build-feature.js',
        context.paths.configsDir,
    ];
    
    for (const testPath of testPaths) {
        const result = testPathResolution(testPath, '相对路径测试');
        console.log(`  ${testPath}`);
        console.log(`    标准化: ${result.normalized}`);
        console.log(`    存在: ${result.exists ? '✅' : '❌'}`);
        if (result.issues.length > 0) {
            console.log(`    问题: ${result.issues.join(', ')}`);
        }
    }
    console.log();
    
    // 项目路径检查
    const layoutDiagnostics = {
        workspaceRoot: context.workspaceRoot,
        dataRoot: context.dataRoot,
        layout: context.layout,
        memoryRoot: context.memoryRoot,
        legacyProjectMemoryExists: fs.existsSync(path.join(context.workspaceRoot, 'project-memory')),
        externalStateExists: fs.existsSync(context.paths.projectProfile),
    };
    console.log('PMM 布局:');
    console.log(JSON.stringify(layoutDiagnostics, null, 2));
    console.log();

    console.log(`项目路径检查 (${context.workspaceRoot}):`);
    
    const issues = findPathIssues(context);
    
    if (issues.length === 0) {
        console.log('  ✅ 未发现路径问题');
    } else {
        const errors = issues.filter(i => i.severity === 'error');
        const warnings = issues.filter(i => i.severity === 'warning');
        
        if (errors.length > 0) {
            console.log(`\n  错误 (${errors.length}):`);
            for (const issue of errors) {
                console.log(`    ❌ ${issue.message}`);
                console.log(`       修复: ${issue.fix}`);
            }
        }
        
        if (warnings.length > 0) {
            console.log(`\n  警告 (${warnings.length}):`);
            for (const issue of warnings) {
                console.log(`    ⚠️  ${issue.message}`);
                console.log(`       建议: ${issue.fix}`);
            }
        }
    }
    
    console.log('\n=== 路径使用建议 ===');
    console.log('1. 统一使用正斜杠 (/) 或 path.join()');
    console.log('2. 避免混合使用 C:\ 和 / 风格路径');
    console.log('3. 配置文件中尽量使用相对路径');
    console.log('4. 比较路径时使用 normalizePath() 函数');
    console.log('5. Windows 上注意大小写不敏感问题');
}

module.exports = {
    findPathIssues,
    parseArgs,
    run,
    testPathResolution,
};

if (require.main === module) {
    run();
}

