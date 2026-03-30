#!/usr/bin/env node
/**
 * 查询前后端数据流
 * 
 * 使用方法:
 *   node scripts/query_dataflow.js --feature <key> [--field <field-name>] [--method <method-name>]
 * 
 * 示例:
 *   node scripts/query_dataflow.js --feature game-feature --field historyData
 *   node scripts/query_dataflow.js --feature game-feature --method onOpenSmallSettlement
 */

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
    const args = { feature: '', field: '', method: '' };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--feature' && i + 1 < argv.length) {
            args.feature = argv[++i];
        } else if (argv[i] === '--field' && i + 1 < argv.length) {
            args.field = argv[++i];
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

function findDataFlowForField(data, fieldName) {
    const results = {
        frontendReads: [],
        frontendWrites: [],
        backendReads: [],
        backendWrites: [],
        networkTransfers: [],
    };

    // 查找字段读写
    if (data.scan?.scripts) {
        for (const script of data.scan.scripts) {
            const area = script.scriptPath.includes('server') || script.scriptPath.includes('/app/') 
                ? 'backend' 
                : 'frontend';
            
            for (const method of script.methods || []) {
                // 检查 state reads
                for (const read of method.stateReads || []) {
                    if (read.statePath?.includes(fieldName) || read.property === fieldName) {
                        results[area === 'frontend' ? 'frontendReads' : 'backendReads'].push({
                            script: script.scriptPath,
                            method: method.name,
                            line: method.line,
                            statePath: read.statePath,
                        });
                    }
                }
                
                // 检查 state writes
                for (const write of method.stateWrites || []) {
                    if (write.statePath?.includes(fieldName) || write.property === fieldName) {
                        results[area === 'frontend' ? 'frontendWrites' : 'backendWrites'].push({
                            script: script.scriptPath,
                            method: method.name,
                            line: method.line,
                            statePath: write.statePath,
                        });
                    }
                }
                
                // 检查网络请求
                for (const request of method.networkRequests || []) {
                    if (request.callbackInvocations?.some(inv => inv.includes(fieldName)) ||
                        request.callbackLocalCalls?.some(call => call.includes(fieldName))) {
                        results.networkTransfers.push({
                            script: script.scriptPath,
                            method: method.name,
                            request: request.target || request.callee,
                            protocol: request.protocol,
                            dataField: fieldName,
                        });
                    }
                }
            }
        }
    }

    return results;
}

function findMethodDataFlow(data, methodName) {
    const results = {
        method: null,
        upstream: [],
        downstream: [],
        dataSources: [],
        dataSinks: [],
    };

    // 查找方法
    if (data.scan?.scripts) {
        for (const script of data.scan.scripts) {
            const method = script.methods?.find(m => m.name === methodName);
            if (method) {
                results.method = {
                    script: script.scriptPath,
                    ...method,
                };
                break;
            }
        }
    }

    // 在 graph 中查找上下游
    if (data.graph && results.method) {
        const methodNode = data.graph.nodes.find(n => 
            n.type === 'method' && n.meta?.methodName === methodName
        );
        
        if (methodNode) {
            // 查找入边（upstream）
            const incomingEdges = data.graph.edges.filter(e => e.to === methodNode.id);
            results.upstream = incomingEdges.map(e => {
                const sourceNode = data.graph.nodes.find(n => n.id === e.from);
                return {
                    type: e.type,
                    sourceName: sourceNode?.name || e.from,
                    sourceType: sourceNode?.type,
                };
            });

            // 查找出边（downstream）
            const outgoingEdges = data.graph.edges.filter(e => e.from === methodNode.id);
            results.downstream = outgoingEdges.map(e => {
                const targetNode = data.graph.nodes.find(n => n.id === e.to);
                return {
                    type: e.type,
                    targetName: targetNode?.name || e.to,
                    targetType: targetNode?.type,
                };
            });
        }
    }

    return results;
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    
    if (!args.feature) {
        console.log('Usage: node query_dataflow.js --feature <key> [--field <name>] [--method <name>]');
        process.exit(1);
    }

    console.log(`=== Data Flow Analysis for ${args.feature} ===\n`);
    
    const data = loadFeatureData(args.feature);
    
    if (args.field) {
        console.log(`Analyzing data flow for field: ${args.field}\n`);
        const flow = findDataFlowForField(data, args.field);
        
        console.log('Frontend Reads:');
        flow.frontendReads.forEach(r => console.log(`  - ${r.script}::${r.method} (line ${r.line})`));
        
        console.log('\nFrontend Writes:');
        flow.frontendWrites.forEach(w => console.log(`  - ${w.script}::${w.method} (line ${w.line})`));
        
        console.log('\nBackend Reads:');
        flow.backendReads.forEach(r => console.log(`  - ${r.script}::${r.method} (line ${r.line})`));
        
        console.log('\nBackend Writes:');
        flow.backendWrites.forEach(w => console.log(`  - ${w.script}::${w.method} (line ${w.line})`));
        
        console.log('\nNetwork Transfers:');
        flow.networkTransfers.forEach(t => {
            console.log(`  - ${t.script}::${t.method}`);
            console.log(`    request: ${t.request} (${t.protocol})`);
        });
    }
    
    if (args.method) {
        console.log(`Analyzing data flow for method: ${args.method}\n`);
        const flow = findMethodDataFlow(data, args.method);
        
        if (flow.method) {
            console.log('Method found:');
            console.log(`  - ${flow.method.script}::${flow.method.name}`);
            console.log(`  - line: ${flow.method.line}`);
            if (flow.method.summary) {
                console.log(`  - summary: ${flow.method.summary}`);
            }
            
            console.log('\nUpstream (callers):');
            flow.upstream.forEach(u => {
                console.log(`  - [${u.type}] ${u.sourceName} (${u.sourceType})`);
            });
            
            console.log('\nDownstream (callees):');
            flow.downstream.forEach(d => {
                console.log(`  - [${d.type}] ${d.targetName} (${d.targetType})`);
            });
        } else {
            console.log('Method not found in scan data.');
        }
    }
    
    console.log('\n=== Analysis Complete ===');
}

main();
