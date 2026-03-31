#!/usr/bin/env node
/**
 * 查看方法完整代码
 * 
 * 使用方法:
 *   node scripts/view_method_body.js --feature <key> --method <name> [--root <path>] [--file <script.ts>]
 * 
 * 示例:
 *   node scripts/view_method_body.js --feature game --method onOpenSmallSettlement --root E:\xile
 *   node scripts/view_method_body.js --feature game --method onRoundEnd --file xy-client/assets/script/game/Controller.ts
 */

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
    const args = { feature: '', method: '', file: '', root: process.cwd() };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--feature' && i + 1 < argv.length) {
            args.feature = argv[++i];
        } else if (argv[i] === '--method' && i + 1 < argv.length) {
            args.method = argv[++i];
        } else if (argv[i] === '--root' && i + 1 < argv.length) {
            args.root = argv[++i];
        } else if (argv[i] === '--file' && i + 1 < argv.length) {
            args.file = argv[++i];
        }
    }
    return args;
}

function loadScanData(root, featureKey) {
    // Load config to get correct paths
    const configPath = path.join(root, 'project-memory', 'kb', 'configs', `${featureKey}-config.json`);
    if (!fs.existsSync(configPath)) {
        return { config: null, scan: null };
    }
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    
    // Resolve scan path from config
    let scanPath = config.outputs?.scan || `project-memory/kb/features/${featureKey}/scan.raw.json`;
    scanPath = scanPath.replace('<feature-key>', featureKey);
    if (!path.isAbsolute(scanPath)) {
        scanPath = path.join(root, scanPath);
    }
    
    if (!fs.existsSync(scanPath)) {
        return { config, scan: null };
    }
    return { config, scan: JSON.parse(fs.readFileSync(scanPath, 'utf8')) };
}

function extractMethodFromSource(filePath, methodName) {
    if (!fs.existsSync(filePath)) {
        return null;
    }
    
    const source = fs.readFileSync(filePath, 'utf8');
    
    // 查找方法定义
    const methodPattern = new RegExp(
        `((?:public|private|protected|async|static|\\s)*)\\s*` +
        `(?:function\\s+)?${methodName}\\s*\\([^)]*\\)\\s*(?::\\s*[^{]+)?\\s*{`,
        'g'
    );
    
    let match;
    while ((match = methodPattern.exec(source)) !== null) {
        const startIndex = match.index;
        const openBraceIndex = source.indexOf('{', startIndex + match[0].length - 1);
        
        // 提取方法体
        let depth = 0;
        let endIndex = openBraceIndex;
        for (let i = openBraceIndex; i < source.length; i++) {
            if (source[i] === '{') depth++;
            else if (source[i] === '}') {
                depth--;
                if (depth === 0) {
                    endIndex = i;
                    break;
                }
            }
        }
        
        const fullMethod = source.slice(startIndex, endIndex + 1);
        const bodyOnly = source.slice(openBraceIndex + 1, endIndex).trim();
        
        return {
            signature: match[0],
            fullMethod,
            body: bodyOnly,
            line: source.slice(0, startIndex).split('\n').length,
        };
    }
    
    return null;
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    
    if (!args.feature || !args.method) {
        console.log('Usage: node view_method_body.js --feature <key> --method <name> [--root <path>] [--file <script.ts>]');
        process.exit(1);
    }
    
    console.log(`=== Method Body: ${args.method} ===\n`);
    
    // 从 scan 数据查找
    const { config, scan: scanData } = loadScanData(args.root, args.feature);
    
    if (!config) {
        console.log(`Feature config "${args.feature}" not found in ${args.root}.`);
        process.exit(1);
    }
    
    if (!scanData) {
        console.log(`Scan data for "${args.feature}" not found.`);
        process.exit(1);
    }
    
    // 查找方法
    let foundMethod = null;
    let foundScript = null;
    
    for (const script of scanData.scripts || []) {
        for (const method of script.methods || []) {
            if (method.name === args.method) {
                foundMethod = method;
                foundScript = script;
                break;
            }
        }
        if (foundMethod) break;
    }
    
    if (!foundMethod) {
        console.log(`Method "${args.method}" not found in feature "${args.feature}".`);
        process.exit(1);
    }
    
    console.log(`Found in: ${foundScript.scriptPath}`);
    console.log(`Line: ${foundMethod.line}`);
    console.log(`Access: ${foundMethod.access || 'public'}${foundMethod.async ? ' async' : ''}${foundMethod.static ? ' static' : ''}`);
    if (foundMethod.params) {
        console.log(`Params: ${foundMethod.params}`);
    }
    if (foundMethod.returnType) {
        console.log(`Returns: ${foundMethod.returnType}`);
    }
    console.log();
    
    // 显示调用信息
    if (foundMethod.localCalls?.length) {
        console.log('Local calls:', foundMethod.localCalls.join(', '));
    }
    if (foundMethod.fieldCalls?.length) {
        console.log('Field calls:', foundMethod.fieldCalls.map(c => c.method).join(', '));
    }
    if (foundMethod.importedCalls?.length) {
        console.log('Imported calls:', foundMethod.importedCalls.map(c => `${c.module}.${c.method}`).join(', '));
    }
    console.log();
    
    // 显示 bodySnippet（如果存在）
    if (foundMethod.bodySnippet) {
        console.log('--- Extracted Snippet ---');
        console.log(foundMethod.bodySnippet);
        console.log();
    }
    
    // 提取完整方法体
    const scriptFile = args.file ? path.join(args.root, args.file) : 
                      path.isAbsolute(foundScript.scriptPath) ? foundScript.scriptPath : 
                      path.join(args.root, foundScript.scriptPath);
    const fullMethod = extractMethodFromSource(scriptFile, args.method);
    
    if (fullMethod) {
        console.log('--- Full Method Body ---');
        console.log(`Line ${fullMethod.line}:`);
        console.log(fullMethod.signature);
        console.log(fullMethod.body);
        console.log('}');
        console.log();
        
        // 分析关键逻辑
        console.log('--- Key Logic Analysis ---');
        const body = fullMethod.body;
        
        // 查找 filter/map/reduce
        const arrayOps = body.match(/\.(filter|map|reduce|find|some|every)\s*\(/g);
        if (arrayOps) {
            console.log('Array operations:');
            [...new Set(arrayOps)].forEach(op => console.log(`  ${op}`));
        }
        
        // 查找条件语句
        const conditions = body.match(/\b(if|else if|switch)\s*\(/g);
        if (conditions) {
            console.log('Conditional logic:');
            [...new Set(conditions)].forEach(c => console.log(`  ${c}`));
        }
        
        // 查找循环
        const loops = body.match(/\b(for|while)\s*\(/g);
        if (loops) {
            console.log('Loops:');
            [...new Set(loops)].forEach(l => console.log(`  ${l}`));
        }
        
        // 查找状态修改
        const stateMods = body.match(/this\.\w+\s*[=\+\-]=?\s*[^;]+/g);
        if (stateMods) {
            console.log('State modifications:');
            stateMods.slice(0, 5).forEach(m => console.log(`  ${m}`));
        }
        
        // 查找函数调用
        const calls = body.match(/\b(\w+)\s*\([^)]*\)/g);
        if (calls) {
            const uniqueCalls = [...new Set(calls)].filter(c => !c.match(/^(if|for|while|switch|return)\s*\(/));
            console.log('Function calls:');
            uniqueCalls.slice(0, 10).forEach(c => console.log(`  ${c}`));
        }
    } else {
        console.log('Could not extract full method body from source file.');
        console.log('Tried path:', scriptFile);
        console.log('Try specifying --file <path> explicitly.');
    }
    
    console.log('\n=== End ===');
}

main();
