#!/usr/bin/env node
/**
 * 调试调用链问题
 * 
 * 使用方法:
 *   node scripts/debug_call_chain.js --feature <feature-key> --method <method-name>
 */

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
    const args = { feature: '', method: '' };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--feature' && i + 1 < argv.length) {
            args.feature = argv[++i];
        } else if (argv[i] === '--method' && i + 1 < argv.length) {
            args.method = argv[++i];
        }
    }
    return args;
}

function loadFeatureData(featureKey) {
    const scanPath = path.join('project-memory', 'kb', 'features', featureKey, 'scan.raw.json');
    const graphPath = path.join('project-memory', 'kb', 'features', featureKey, 'chain.graph.json');
    const lookupPath = path.join('project-memory', 'kb', 'features', featureKey, 'chain.lookup.json');
    
    const result = {};
    
    if (fs.existsSync(scanPath)) {
        result.scan = JSON.parse(fs.readFileSync(scanPath, 'utf8'));
    }
    if (fs.existsSync(graphPath)) {
        result.graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
    }
    if (fs.existsSync(lookupPath)) {
        result.lookup = JSON.parse(fs.readFileSync(lookupPath, 'utf8'));
    }
    
    return result;
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    
    if (!args.feature || !args.method) {
        console.log('Usage: node debug_call_chain.js --feature <key> --method <name>');
        process.exit(1);
    }
    
    console.log(`=== Debugging Call Chain for ${args.method} ===\n`);
    
    const data = loadFeatureData(args.feature);
    
    // 1. 检查 scan.raw.json 中的方法调用
    console.log('1. Checking scan.raw.json for imported calls...');
    if (data.scan?.scripts) {
        for (const script of data.scan.scripts) {
            for (const method of script.methods || []) {
                const importedCalls = method.importedCalls || [];
                const callsToTarget = importedCalls.filter(call => call.method === args.method);
                if (callsToTarget.length > 0) {
                    console.log(`   Found in ${script.scriptPath}::${method.name}:`);
                    callsToTarget.forEach(call => {
                        console.log(`     - calls ${call.method} (resolved: ${call.sourcePath || 'null'})`);
                    });
                }
            }
        }
    }
    
    // 2. 检查 graph 中的方法节点
    console.log('\n2. Checking chain.graph.json for method nodes...');
    if (data.graph?.nodes) {
        const methodNodes = data.graph.nodes.filter(n => n.type === 'method' && (n.name.includes(args.method) || n.meta?.methodName === args.method));
        console.log(`   Found ${methodNodes.length} method node(s):`);
        methodNodes.forEach(node => {
            console.log(`   - ${node.name} (id: ${node.id})`);
        });
    }
    
    // 3. 检查 graph 中的调用边
    console.log('\n3. Checking chain.graph.json for call edges...');
    if (data.graph?.edges) {
        const callEdges = data.graph.edges.filter(e => e.type === 'calls' || e.type === 'field_calls');
        const incomingCalls = callEdges.filter(e => {
            const targetNode = data.graph.nodes.find(n => n.id === e.to);
            return targetNode?.name?.includes(args.method);
        });
        const outgoingCalls = callEdges.filter(e => {
            const sourceNode = data.graph.nodes.find(n => n.id === e.from);
            return sourceNode?.name?.includes(args.method);
        });
        
        console.log(`   Incoming calls: ${incomingCalls.length}`);
        incomingCalls.forEach(edge => {
            const sourceNode = data.graph.nodes.find(n => n.id === e.from);
            console.log(`     - from: ${sourceNode?.name || edge.from}`);
        });
        
        console.log(`   Outgoing calls: ${outgoingCalls.length}`);
        outgoingCalls.forEach(edge => {
            const targetNode = data.graph.nodes.find(n => n.id === edge.to);
            console.log(`     - to: ${targetNode?.name || edge.to}`);
        });
    }
    
    // 4. 检查 lookup 中的方法
    console.log('\n4. Checking chain.lookup.json...');
    if (data.lookup?.methods) {
        const methods = Object.entries(data.lookup.methods).filter(([key, val]) => key.includes(args.method));
        console.log(`   Found ${methods.length} method(s) in lookup:`);
        methods.forEach(([key, val]) => {
            console.log(`   - ${key}:`);
            console.log(`     incoming: ${val.incoming?.length || 0} edges`);
            console.log(`     outgoing: ${val.outgoing?.length || 0} edges`);
        });
    }
    
    console.log('\n=== Debug Complete ===');
}

main();
