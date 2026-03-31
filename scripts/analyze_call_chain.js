#!/usr/bin/env node
/**
 * 分析调用链断裂原因
 * 
 * 使用方法:
 *   node scripts/analyze_call_chain.js --feature <key> --caller <method> --callee <method>
 */

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
    const args = { feature: '', caller: '', callee: '', root: '' };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--feature' && i + 1 < argv.length) {
            args.feature = argv[++i];
        } else if (argv[i] === '--caller' && i + 1 < argv.length) {
            args.caller = argv[++i];
        } else if (argv[i] === '--callee' && i + 1 < argv.length) {
            args.callee = argv[++i];
        } else if (argv[i] === '--root' && i + 1 < argv.length) {
            args.root = argv[++i];
        }
    }
    return args;
}

function loadFeatureData(featureKey, root) {
    const basePath = root || process.cwd();
    
    // 尝试多个可能的路径
    const possiblePaths = [
        path.join(basePath, 'project-memory', 'kb', 'features', featureKey),
        path.join(basePath, 'project-memory', 'kb', 'games', featureKey),
        path.join(basePath, 'project-memory', 'kb', 'domains', featureKey),
    ];
    
    const result = {};
    
    for (const baseDir of possiblePaths) {
        const scanPath = path.join(baseDir, 'scan.raw.json');
        const graphPath = path.join(baseDir, 'chain.graph.json');
        
        if (fs.existsSync(scanPath)) {
            result.scan = JSON.parse(fs.readFileSync(scanPath, 'utf8'));
            result.baseDir = baseDir;
        }
        if (fs.existsSync(graphPath)) {
            result.graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
        }
        
        if (result.scan) break;
    }
    
    return result;
}

function slugify(input) {
    return String(input || '')
        .trim()
        .replace(/[^\w.-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase();
}

function analyzeMethodCalls(data, callerName, calleeName) {
    const analysis = {
        callerName,
        calleeName,
        callerFound: false,
        calleeFound: false,
        callerScript: null,
        calleeScript: null,
        directCall: false,
        importResolved: false,
        callVia: null,
        graphEdgeFound: false,
        issues: [],
    };
    
    // 在 scan 中查找方法
    for (const script of data.scan?.scripts || []) {
        for (const method of script.methods || []) {
            if (method.name === callerName) {
                analysis.callerFound = true;
                analysis.callerScript = script.scriptPath;
                
                // 检查是否直接调用 callee
                const allCalls = [
                    ...(method.localCalls || []),
                    ...(method.importedCalls || []).map(c => c.method),
                    ...(method.fieldCalls || []).map(c => c.method),
                ];
                
                if (allCalls.includes(calleeName)) {
                    analysis.directCall = true;
                }
                
                // 检查 importedCalls
                const importedCall = (method.importedCalls || []).find(c => c.method === calleeName);
                if (importedCall) {
                    analysis.callVia = 'imported';
                    analysis.importResolved = !!importedCall.sourcePath;
                    if (!importedCall.sourcePath) {
                        analysis.issues.push(`Import not resolved: ${importedCall.identifier}.${calleeName}`);
                    }
                }
                
                // 检查 fieldCalls
                const fieldCall = (method.fieldCalls || []).find(c => c.method === calleeName);
                if (fieldCall) {
                    analysis.callVia = 'field';
                    analysis.importResolved = !!fieldCall.sourcePath;
                    if (!fieldCall.sourcePath) {
                        analysis.issues.push(`Field type not resolved: ${fieldCall.fieldName}.${calleeName}`);
                    }
                }
                
                // 检查 localCalls
                if ((method.localCalls || []).includes(calleeName)) {
                    analysis.callVia = 'local';
                }
            }
            
            if (method.name === calleeName) {
                analysis.calleeFound = true;
                analysis.calleeScript = script.scriptPath;
            }
        }
    }
    
    return analysis;
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    
    if (!args.feature || !args.caller || !args.callee) {
        console.log('用法: node analyze_call_chain.js --feature <key> --caller <method> --callee <method> [--root <path>]');
        console.log('');
        console.log('示例:');
        console.log('  node analyze_call_chain.js --feature liu-yang-san-shi-er-zhang --caller onRoundEnd --callee onOpenSmallSettlement');
        console.log('');
        console.log('注意: 方法名使用原始驼峰命名（如 onOpenSmallSettlement），不要手动转换为小写。');
        process.exit(1);
    }
    
    console.log(`=== Call Chain Analysis: ${args.caller} -> ${args.callee} ===\n`);
    
    const data = loadFeatureData(args.feature, args.root);
    
    if (!data.scan) {
        console.log(`Feature "${args.feature}" scan data not found.`);
        process.exit(1);
    }
    
    const analysis = analyzeMethodCalls(data, args.caller, args.callee);
    
    console.log('Caller Method:');
    console.log(`  Found: ${analysis.callerFound ? '✅' : '❌'}`);
    if (analysis.callerScript) {
        console.log(`  Script: ${analysis.callerScript}`);
    }
    
    console.log('\nCallee Method:');
    console.log(`  Found: ${analysis.calleeFound ? '✅' : '❌'}`);
    if (analysis.calleeScript) {
        console.log(`  Script: ${analysis.calleeScript}`);
    }
    
    // 检查 graph 中的边
    if (data.graph && analysis.callerScript && analysis.calleeScript) {
        const callerSlug = slugify(analysis.callerScript);
        const calleeSlug = slugify(analysis.calleeScript);
        const callerId = `method:${callerSlug}:${analysis.callerName.toLowerCase()}`;
        const calleeId = `method:${calleeSlug}:${analysis.calleeName.toLowerCase()}`;
        
        const edge = data.graph.edges?.find(e => 
            e.from === callerId && e.to === calleeId
        );
        analysis.graphEdgeFound = !!edge;
        if (edge) {
            analysis.graphEdgeType = edge.type || edge.rel;
        }
    }
    
    console.log('\nCall Relationship:');
    console.log(`  Direct Call: ${analysis.directCall ? '✅' : '❌'}`);
    if (analysis.callVia) {
        console.log(`  Call Type: ${analysis.callVia}`);
        console.log(`  Import Resolved: ${analysis.importResolved ? '✅' : '❌'}`);
    }
    if (data.graph) {
        console.log(`  Graph Edge: ${analysis.graphEdgeFound ? '✅' : '❌'}`);
        if (analysis.graphEdgeType) {
            console.log(`  Edge Type: ${analysis.graphEdgeType}`);
        }
    }
    
    if (analysis.issues.length > 0) {
        console.log('\nIssues:');
        analysis.issues.forEach(issue => console.log(`  ⚠️  ${issue}`));
    }
    
    // 建议
    console.log('\nRecommendations:');
    if (!analysis.callerFound) {
        console.log('  - Caller method not found in scan. Check if script is included in methodRoots.');
    }
    if (!analysis.calleeFound) {
        console.log('  - Callee method not found in scan. Check if script is included in methodRoots.');
    }
    if (analysis.callVia === 'imported' && !analysis.importResolved) {
        console.log('  - Import path not resolved. Run diagnose_import_resolution.js to debug.');
    }
    if (analysis.callVia === 'field' && !analysis.importResolved) {
        console.log('  - Field type not resolved. Check field type annotations.');
    }
    if (!analysis.directCall) {
        console.log('  - No direct call found. May be called via event, callback, or dynamic invocation.');
    }
    if (analysis.directCall && !analysis.graphEdgeFound) {
        console.log('  - Call found in scan but edge missing in graph. Rebuild KB.');
    }
    
    console.log('\n=== End ===');
}

main();

