#!/usr/bin/env node

const path = require('path');
const { hasOwn, readJson, readJsonSafe } = require('../shared/common');
const { loadFeatureLookupArtifacts, normalizeFeatureRecord } = require('../graph/feature-kb');
const { createWorkspaceContext, parseLayoutArgs } = require('../shared/workspace-layout');
const { loadSkillVersion } = require('../maintenance/show-version');
const { buildKbFreshnessStatus } = require('../shared/source-snapshot');

function parseArgs(argv) {
    const layoutArgs = parseLayoutArgs(argv);
    const args = {
        feature: '',
        event: '',
        endpoint: '',
        message: '',
        method: '',
        request: '',
        state: '',
        upstream: '',
        downstream: '',
        upstreamFlag: false,
        downstreamFlag: false,
        from: '',
        direction: '',
        type: '',
        name: '',
        tag: '',
        file: '',
        excludeFile: '',
        excludePrefab: '',
        area: '',
        module: '',
        excludeModule: '',
        protocol: '',
        path: '',
        detail: '',
        mode: '',
        fullstack: false,
        focus: '',
        includeUnresolved: false,
        grouped: false,
        groupLimit: null,
        instanceLimit: null,
        nodePathLimit: null,
        hasHandler: '',
        root: layoutArgs.workspaceRoot || '',
        dataRoot: layoutArgs.dataRoot || '',
        layout: layoutArgs.layout || '',
        depth: 2,
        limit: 20,
        limitExplicit: false,
        json: false,
        // 语义查询参数
        hasOperation: '',
        operationType: '',
        dataFlowFrom: '',
        dataFlowTo: '',
        minComplexity: '',
    };

    for (let index = 0; index < argv.length; index++) {
        const token = argv[index];
        const nextToken = argv[index + 1];
        const hasExplicitValue = Boolean(nextToken && !String(nextToken).startsWith('--'));
        if (token === '--feature') {
            args.feature = argv[++index];
            continue;
        }
        if (token === '--event') {
            args.event = argv[++index];
            continue;
        }
        if (token === '--endpoint') {
            args.endpoint = argv[++index];
            continue;
        }
        if (token === '--message') {
            args.message = argv[++index];
            continue;
        }
        if (token === '--method') {
            args.method = argv[++index];
            continue;
        }
        if (token === '--request') {
            args.request = argv[++index];
            continue;
        }
        if (token === '--state') {
            args.state = argv[++index];
            continue;
        }
        if (token === '--upstream') {
            if (hasExplicitValue) {
                args.upstream = argv[++index];
            } else {
                args.upstreamFlag = true;
            }
            continue;
        }
        if (token === '--downstream') {
            if (hasExplicitValue) {
                args.downstream = argv[++index];
            } else {
                args.downstreamFlag = true;
            }
            continue;
        }
        if (token === '--from') {
            args.from = argv[++index];
            continue;
        }
        if (token === '--direction') {
            args.direction = argv[++index];
            continue;
        }
        if (token === '--type') {
            args.type = argv[++index];
            continue;
        }
        if (token === '--name') {
            args.name = argv[++index];
            continue;
        }
        if (token === '--tag') {
            args.tag = argv[++index];
            continue;
        }
        if (token === '--file') {
            args.file = argv[++index];
            continue;
        }
        if (token === '--exclude-file') {
            args.excludeFile = argv[++index];
            continue;
        }
        if (token === '--exclude-prefab') {
            args.excludePrefab = argv[++index];
            continue;
        }
        if (token === '--area') {
            args.area = argv[++index];
            continue;
        }
        if (token === '--module') {
            args.module = argv[++index];
            continue;
        }
        if (token === '--exclude-module') {
            args.excludeModule = argv[++index];
            continue;
        }
        if (token === '--protocol') {
            args.protocol = argv[++index];
            continue;
        }
        if (token === '--path') {
            args.path = argv[++index];
            continue;
        }
        if (token === '--detail') {
            args.detail = argv[++index];
            continue;
        }
        if (token === '--mode') {
            args.mode = argv[++index];
            continue;
        }
        if (token === '--fullstack') {
            args.fullstack = true;
            continue;
        }
        if (token === '--focus') {
            args.focus = argv[++index];
            continue;
        }
        if (token === '--include-unresolved') {
            args.includeUnresolved = true;
            continue;
        }
        if (token === '--grouped') {
            args.grouped = true;
            continue;
        }
        if (token === '--group-limit') {
            args.groupLimit = Number.parseInt(argv[++index], 10);
            continue;
        }
        if (token === '--instance-limit') {
            args.instanceLimit = Number.parseInt(argv[++index], 10);
            continue;
        }
        if (token === '--node-path-limit') {
            args.nodePathLimit = Number.parseInt(argv[++index], 10);
            continue;
        }
        if (token === '--has-handler') {
            args.hasHandler = argv[++index];
            continue;
        }
        if (token === '--root') {
            args.root = argv[++index];
            continue;
        }
        if (token === '--workspace-root') {
            args.root = argv[++index];
            continue;
        }
        if (token === '--data-root') {
            args.dataRoot = argv[++index] || '';
            continue;
        }
        if (token === '--layout') {
            args.layout = argv[++index] || '';
            continue;
        }
        if (token === '--depth') {
            args.depth = Number.parseInt(argv[++index], 10) || 2;
            continue;
        }
        if (token === '--limit') {
            args.limit = Number.parseInt(argv[++index], 10) || 20;
            args.limitExplicit = true;
            continue;
        }
        if (token === '--json') {
            args.json = true;
            continue;
        }
        // 语义查询参数
        if (token === '--has-operation') {
            args.hasOperation = argv[++index];
            continue;
        }
        if (token === '--operation-type') {
            args.operationType = argv[++index];
            continue;
        }
        if (token === '--data-flow-from') {
            args.dataFlowFrom = argv[++index];
            continue;
        }
        if (token === '--data-flow-to') {
            args.dataFlowTo = argv[++index];
            continue;
        }
        if (token === '--min-complexity') {
            args.minComplexity = argv[++index];
            continue;
        }
    }

    if (!args.feature) {
        throw new Error(
            '用法: node src/bin/query-feature.js --feature <key> [查询选项] [--json]\n\n' +
            '基本查询:\n' +
            '  --method <name> [--upstream|--downstream]  查询方法上下游链路\n' +
            '  --event <name>                              查询事件订阅关系\n' +
            '  --request <name>                            查询请求处理链路\n' +
            '  --state <name>                              查询状态读写关系\n' +
            '  --from <node-id> --direction <upstream|downstream>  从指定节点遍历\n\n' +
            '语义查询（需启用结构化摘要）:\n' +
            '  --has-operation <type>                      查询包含特定操作的方法\n' +
            '       类型: filter, map, condition, loop, assignment, method_call\n' +
            '  --operation-type <type>                     按操作类型筛选结果\n' +
            '  --data-flow-from <var>                      查询从指定变量出发的数据流\n' +
            '  --data-flow-to <var>                        查询流向指定变量的数据流\n' +
            '  --min-complexity <low|medium|high>          按最小复杂度筛选\n\n' +
            '注意: <name> 使用原始驼峰命名即可（如 onOpenSmallSettlement），工具会自动匹配节点。'
        );
    }

    if (args.from && args.direction && !['upstream', 'downstream'].includes(args.direction)) {
        throw new Error('--direction 仅支持 upstream 或 downstream');
    }

    return args;
}

function collectTypedSelectors(args) {
    return [
        ['method', args.method],
        ['event', args.event],
        ['endpoint', args.endpoint],
        ['message', args.message],
        ['request', args.request],
        ['state', args.state],
    ].filter(([, value]) => Boolean(value));
}

function loadFeatureLookup(context, featureKey) {
    const registryPath = context.paths.featureRegistry;
    
    // 使用安全读取
    let registry;
    try {
        registry = readJsonSafe(registryPath, { required: true });
    } catch (err) {
        throw new Error(
            `[SKILL-DIAGNOSIS] 无法加载 Feature Registry\n` +
            `文件: ${registryPath}\n` +
            `错误: ${err.message}\n\n` +
            `可能原因:\n` +
            `  1. 项目记忆尚未初始化\n` +
            `  2. 当前目录不是项目根目录\n\n` +
            `修复命令:\n` +
            `  node src/bin/init-workspace.js --workspace-root <project-root>\n` +
            `  或切换到正确的项目目录`
        );
    }
    
    const normalizedFeatures = (registry.features || []).map(item => normalizeFeatureRecord(item));
    const feature = normalizedFeatures.find(item => item.featureKey === featureKey);
    
    if (!feature) {
        const availableFeatures = normalizedFeatures.map(f => f.featureKey).slice(0, 10);
        throw new Error(
            `[SKILL-DIAGNOSIS] 未找到 Feature: ${featureKey}\n\n` +
            `可能原因:\n` +
            `  1. Feature 名称拼写错误\n` +
            `  2. Feature 尚未注册（需要构建 KB）\n` +
            `  3. 使用了错误的项目根目录\n\n` +
            `可用的 Features (${Math.min(availableFeatures.length, 10)} 个):\n` +
            availableFeatures.map(f => `  • ${f}`).join('\n') +
            (normalizedFeatures.length > 10 ? `\n  ... 还有 ${normalizedFeatures.length - 10} 个` : '') +
            `\n\n修复命令:\n` +
            `  1. 检查 feature 名称是否正确\n` +
            `  2. 构建该 feature: node src/bin/build-feature.js --workspace-root <project-root> --feature-key <feature-key>\n` +
            `  3. 或重建全部: node src/bin/rebuild-kbs.js --workspace-root <project-root>`
        );
    }

    return loadFeatureLookupArtifacts(context.workspaceRoot, feature);
}

function currentSkillVersionInfo() {
    try {
        return loadSkillVersion(path.resolve(__dirname, '..', '..'));
    } catch {
        return null;
    }
}

function loadFreshnessConfig(root, feature = {}) {
    const configPath = String(feature.configPath || '').trim();
    if (!configPath) {
        return null;
    }
    const resolved = path.isAbsolute(configPath) ? configPath : path.resolve(root, configPath);
    return readJsonSafe(resolved, { required: false, defaultValue: null });
}

function buildKbVersionStatus(graph, options = {}) {
    const currentSkill = currentSkillVersionInfo();
    return buildKbFreshnessStatus({
        root: options.root || process.cwd(),
        graph,
        config: options.config || null,
        currentSkill: currentSkill
            ? {
                name: currentSkill.name || '',
                version: currentSkill.version || '',
                repo: currentSkill.repo || '',
            }
            : null,
        recommendedAction: options.recommendedAction || 'node src/bin/rebuild-kbs.js --workspace-root <project-root>',
    });
}

function buildQueryRecommendedAction(featureKey) {
    return featureKey === 'project-global'
        ? 'build_project_index'
        : 'node src/bin/rebuild-kbs.js --workspace-root <project-root>';
}

function warnIfKbStale(status) {
    if (!status?.stale) {
        return;
    }
    console.warn(
        `[stale-kb] 当前 KB 由 ${status.builtWithSkill?.name || 'unknown'}@${status.builtWithSkill?.version || 'unknown'} 构建，`
        + `当前技能版本是 ${status.currentSkill?.name || 'unknown'}@${status.currentSkill?.version || 'unknown'}。`
        + ` 请先运行 ${status.recommendedAction} 重建 KB。`
    );
}

function normalizeText(value) {
    return String(value || '').trim().toLowerCase();
}

function matchContains(value, needle) {
    if (!needle) {
        return true;
    }
    return normalizeText(value).includes(normalizeText(needle));
}

function normalizePathText(value) {
    return normalizeText(value).replace(/\\/g, '/').replace(/\/+/g, '/');
}

function matchPath(value, query) {
    if (!query) {
        return true;
    }
    const normalizedValue = normalizePathText(value);
    const normalizedQuery = normalizePathText(query);
    return normalizedValue === normalizedQuery || normalizedValue.includes(normalizedQuery);
}

function samePath(left, right) {
    return Boolean(left && right && normalizePathText(left) === normalizePathText(right));
}

function pathHasModule(filePath, moduleName) {
    const query = normalizePathText(moduleName);
    if (!query) {
        return true;
    }
    const value = normalizePathText(filePath);
    return value === query || value.includes(`/${query}/`) || value.includes(query);
}

function nodeMatchesQueryFilters(node, args = {}) {
    if (!node) {
        return false;
    }
    const meta = node.meta || {};
    const fileText = node.file || meta.scriptPath || meta.prefabPath || '';
    const inferredArea = matchContains(fileText, 'cms-client') || matchContains(fileText, 'xy-client') || matchContains(fileText, 'assets/script')
        ? 'frontend'
        : matchContains(fileText, 'cms-server') || matchContains(fileText, 'qy-server') || matchContains(fileText, 'app/http') || matchContains(fileText, 'app/servers')
          ? 'backend'
          : node.area || '';
    if (args.area && !matchContains(`${node.area || ''} ${inferredArea}`, args.area)) {
        return false;
    }
    if (args.module && !pathHasModule(fileText, args.module)) {
        return false;
    }
    if (args.excludeModule && pathHasModule(fileText, args.excludeModule)) {
        return false;
    }
    if (args.protocol) {
        const protocolText = [
            meta.protocol,
            meta.transport,
            meta.kind,
            node.type === 'endpoint' ? 'http' : '',
            node.type === 'request' && meta.httpMethod ? 'http' : '',
        ].filter(Boolean).join(' ');
        if (!matchContains(protocolText, args.protocol)) {
            return false;
        }
    }
    if (args.path) {
        const pathText = [
            node.name,
            meta.path,
            meta.route,
            meta.target,
            meta.prefabPath,
            meta.assetPath,
        ].filter(Boolean).join(' ');
        if (!matchContains(pathText, args.path)) {
            return false;
        }
    }
    return true;
}

function hasNodeFilters(args = {}) {
    return Boolean(args.area || args.module || args.excludeModule || args.protocol || args.path || args.file);
}

function getOwnEntry(bucket, key) {
    if (!bucket || !hasOwn(bucket, key)) {
        return undefined;
    }
    return bucket[key];
}

function resolveMethod(lookup, query) {
    const directMethod = getOwnEntry(lookup.methods, query);
    if (directMethod) {
        return directMethod;
    }
    const alias = getOwnEntry(lookup.methodAliases, query) || [];
    if (alias.length === 1) {
        return getOwnEntry(lookup.methods, alias[0]) || null;
    }
    if (alias.length > 1) {
        return { ambiguous: alias };
    }
    return null;
}

function resolveState(lookup, query) {
    const state = getOwnEntry(lookup.states, query);
    if (state) {
        return state;
    }
    return null;
}

// ==================== 语义查询函数 ====================

/**
 * 执行语义查询
 */
function performSemanticQuery(graph, lookup, args) {
    const results = [];
    const complexityOrder = { low: 1, medium: 2, high: 3 };
    const minComplexityLevel = args.minComplexity ? complexityOrder[args.minComplexity] : 0;

    for (const node of graph.nodes || []) {
        if (node.type !== 'method') continue;

        const bodySummary = node.meta?.bodySummary;
        if (!bodySummary) continue;

        let matches = true;
        const matchedOperations = [];

        // 检查操作类型
        if (args.hasOperation || args.operationType) {
            const targetType = args.hasOperation || args.operationType;
            const found = bodySummary.operations?.some(op => {
                const match = op.type === targetType || 
                    (targetType === 'filter' && op.type === 'filter') ||
                    (targetType === 'map' && op.type === 'map') ||
                    (targetType === 'condition' && op.type === 'condition') ||
                    (targetType === 'loop' && op.type === 'loop');
                if (match) matchedOperations.push(op);
                return match;
            });
            if (!found) matches = false;
        }

        // 检查数据流 - 支持多种匹配模式
        if (args.dataFlowFrom && matches) {
            const searchTerm = args.dataFlowFrom.toLowerCase();
            const found = bodySummary.data_flow?.some(df => {
                const from = (df.from || '').toLowerCase();
                // 支持: 完全匹配、包含匹配、路径后缀匹配
                return from === searchTerm || 
                       from.includes(searchTerm) ||
                       from.endsWith('.' + searchTerm);
            });
            if (!found) matches = false;
        }

        if (args.dataFlowTo && matches) {
            const searchTerm = args.dataFlowTo.toLowerCase();
            const found = bodySummary.data_flow?.some(df => {
                const to = (df.to || '').toLowerCase();
                return to === searchTerm || 
                       to.includes(searchTerm) ||
                       to.endsWith('.' + searchTerm);
            });
            if (!found) matches = false;
        }

        // 检查复杂度
        if (minComplexityLevel > 0 && matches) {
            const nodeComplexity = complexityOrder[bodySummary.complexity] || 1;
            if (nodeComplexity < minComplexityLevel) matches = false;
        }

        if (matches) {
            results.push({
                node,
                bodySummary,
                matchedOperations: matchedOperations.slice(0, 5),
            });
        }
    }

    // 按复杂度排序
    results.sort((a, b) => {
        return (complexityOrder[b.bodySummary.complexity] || 1) - 
               (complexityOrder[a.bodySummary.complexity] || 1);
    });

    return {
        query: {
            hasOperation: args.hasOperation,
            operationType: args.operationType,
            dataFlowFrom: args.dataFlowFrom,
            dataFlowTo: args.dataFlowTo,
            minComplexity: args.minComplexity,
        },
        total: results.length,
        results: results.slice(0, args.limit || 20),
    };
}

/**
 * 打印语义查询结果
 */
function printSemanticResults(results, args) {
    if (args.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
    }

    console.log(`=== 语义查询结果 (${results.total} 个匹配) ===\n`);
    
    if (results.results.length === 0) {
        console.log('未找到匹配的方法。');
        console.log('提示: 确保 KB 使用 --enable-structured-summary 构建。');
        return;
    }

    console.log(`查询条件:`);
    if (results.query.hasOperation) console.log(`  - 包含操作: ${results.query.hasOperation}`);
    if (results.query.operationType) console.log(`  - 操作类型: ${results.query.operationType}`);
    if (results.query.dataFlowFrom) console.log(`  - 数据流来源: ${results.query.dataFlowFrom}`);
    if (results.query.dataFlowTo) console.log(`  - 数据流去向: ${results.query.dataFlowTo}`);
    if (results.query.minComplexity) console.log(`  - 最小复杂度: ${results.query.minComplexity}`);
    console.log();

    results.results.forEach((item, index) => {
        const node = item.node;
        const summary = item.bodySummary;
        
        console.log(`${index + 1}. ${node.name}`);
        console.log(`   文件: ${node.file}:${node.line}`);
        console.log(`   复杂度: ${summary.complexity} | 操作数: ${summary.operations?.length || 0}`);
        
        if (item.matchedOperations.length > 0) {
            console.log(`   匹配操作:`);
            item.matchedOperations.forEach(op => {
                let detail = `     - ${op.type}`;
                if (op.method) detail += ` | ${op.method}`;
                if (op.target) detail += ` | target: ${op.target}`;
                if (op.condition) detail += ` | condition: ${op.condition.substring(0, 40)}`;
                console.log(detail);
            });
        }
        console.log();
    });

    if (results.total > results.results.length) {
        console.log(`... 还有 ${results.total - results.results.length} 个结果未显示 (使用 --limit 增加显示数量)`);
    }
    
    // 打印查询建议
    if (results.total === 0) {
        console.log('\n💡 查询建议:');
        console.log('  - 尝试更通用的操作类型: filter, map, condition, loop, assignment, method_call');
        console.log('  - 尝试不加 --min-complexity 查看所有复杂度');
        console.log('  - 使用 --data-flow-from/to 时尝试变量名的部分匹配');
    }
}

function findMatchingNodes(graph, query) {
    const exactMatches = graph.nodes.filter(node => node.name === query || node.id === query || node.meta?.statePath === query);
    if (exactMatches.length > 0) {
        return exactMatches;
    }

    const fuzzy = graph.nodes.filter(node => {
        return (
            matchContains(node.name, query) ||
            matchContains(node.file, query) ||
            matchContains(node.meta?.methodName, query) ||
            matchContains(node.meta?.statePath, query) ||
            matchContains(node.meta?.route, query) ||
            matchContains(node.meta?.path, query) ||
            matchContains(node.meta?.importPath, query) ||
            matchContains(node.meta?.kind, query) ||
            matchContains(node.meta?.protocol, query) ||
            (node.meta?.tags || []).some(tag => matchContains(tag, query))
        );
    });
    return fuzzy;
}

function resolveNodeId(graph, lookup, query) {
    if (getOwnEntry(lookup.nodesById, query)) {
        return query;
    }
    const exactNodeMatches = graph.nodes.filter(node => node.name === query || node.id === query || node.meta?.statePath === query);
    if (exactNodeMatches.length === 1) {
        return exactNodeMatches[0].id;
    }
    if (exactNodeMatches.length > 1) {
        return {
            ambiguous: exactNodeMatches.map(node => `${node.type}:${node.name}`),
        };
    }
    const method = resolveMethod(lookup, query);
    if (method?.id) {
        return method.id;
    }
    if (method?.ambiguous) {
        return { ambiguous: method.ambiguous };
    }
    const event = getOwnEntry(lookup.events, query);
    if (event?.id) {
        return event.id;
    }
    const message = getOwnEntry(lookup.messages, query);
    if (message?.id) {
        return message.id;
    }
    const request = getOwnEntry(lookup.requests, query);
    if (request?.id) {
        return request.id;
    }
    const route = getOwnEntry(lookup.routes, query);
    if (route?.id) {
        return route.id;
    }
    const endpoint = getOwnEntry(lookup.endpoints, query);
    if (endpoint?.id) {
        return endpoint.id;
    }
    const table = getOwnEntry(lookup.tables, query);
    if (table?.id) {
        return table.id;
    }
    const state = getOwnEntry(lookup.states, query);
    if (state?.id) {
        return state.id;
    }

    const matches = findMatchingNodes(graph, query);
    if (matches.length === 1) {
        return matches[0].id;
    }
    if (matches.length > 1) {
        return {
            ambiguous: matches.map(node => `${node.type}:${node.name}`),
        };
    }
    return null;
}

function traverse(lookup, startId, direction, depth) {
    const bucket = direction === 'upstream' ? lookup.adjacency.incoming : lookup.adjacency.outgoing;
    const queue = [{ id: startId, depth: 0 }];
    const visited = new Set([startId]);
    const result = [];

    while (queue.length > 0) {
        const current = queue.shift();
        const edges = bucket[current.id] || [];
        for (const edge of edges) {
            const nextId = direction === 'upstream' ? edge.from : edge.to;
            result.push({
                depth: current.depth + 1,
                edge,
                node: getOwnEntry(lookup.nodesById, nextId) || null,
            });
            if (current.depth + 1 >= depth || visited.has(nextId)) {
                continue;
            }
            visited.add(nextId);
            queue.push({ id: nextId, depth: current.depth + 1 });
        }
    }

    return result;
}

function isFullstackMode(args = {}) {
    const mode = String(args.mode || '').trim().toLowerCase();
    return Boolean(args.fullstack || mode === 'fullstack' || mode === 'fullstack-data' || String(args.focus || '').trim().toLowerCase() === 'fullstack');
}

function isDataAccessSummaryMode(args = {}) {
    const mode = String(args.mode || '').trim().toLowerCase();
    const focus = String(args.focus || '').trim().toLowerCase();
    return mode === 'fullstack-data' || focus === 'data';
}

function effectiveMode(args = {}) {
    const mode = String(args.mode || '').trim();
    const normalizedMode = mode.toLowerCase();
    if (normalizedMode === 'fullstack-data') {
        return 'fullstack-data';
    }
    return isFullstackMode(args) ? 'fullstack' : mode;
}

function effectiveTraversalDepth(args = {}) {
    const requestedDepth = Number.isFinite(args.depth) && args.depth > 0 ? args.depth : 2;
    return isFullstackMode(args) ? Math.max(requestedDepth, 4) : requestedDepth;
}

function isUnresolvedTraversalItem(item) {
    return item?.node?.type === 'unresolved-call' || item?.edge?.type === 'unresolved_calls';
}

function isHttpMainlineNode(node, startNode) {
    if (!node) {
        return false;
    }
    if (['request', 'endpoint', 'route'].includes(node.type)) {
        return true;
    }
    if (node.type !== 'method') {
        return false;
    }
    if (!startNode?.file) {
        return true;
    }
    return !samePath(node.file, startNode.file);
}

function shapeTraversalResult(rawTraversal, lookup, startNode, args = {}) {
    let traversal = rawTraversal;
    if (!args.includeUnresolved) {
        traversal = traversal.filter(item => !isUnresolvedTraversalItem(item));
    }

    const focus = String(args.focus || '').trim().toLowerCase();
    const shaped = {
        traversal,
        relatedHelpers: [],
        dataTraversal: traversal,
    };
    if (focus !== 'fullstack') {
        return shaped;
    }

    const helperMap = new Map();
    const focusedTraversal = [];
    for (const item of traversal) {
        const node = item.node || null;
        if (isHttpMainlineNode(node, startNode)) {
            focusedTraversal.push(item);
            continue;
        }
        if (node?.type === 'method' && startNode?.file && samePath(node.file, startNode.file)) {
            helperMap.set(node.id, summarizeNode(node, lookup));
            continue;
        }
        focusedTraversal.push(item);
    }
    shaped.traversal = focusedTraversal;
    shaped.relatedHelpers = [...helperMap.values()].sort((left, right) => left.name.localeCompare(right.name));
    return shaped;
}

function summarizeDataAccessActor(node) {
    if (!node) {
        return {
            method: '',
            nodeType: '',
            file: '',
            line: null,
            area: '',
        };
    }
    return {
        method: node.name || '',
        nodeType: node.type || '',
        file: node.file || '',
        line: node.line ?? null,
        area: node.area || '',
    };
}

function makeDataAccessEntry(edge, actorNode, item) {
    return {
        ...summarizeDataAccessActor(actorNode),
        operation: edge.meta?.operation || '',
        edgeType: edge.type || '',
        depth: item.depth ?? null,
    };
}

function sortDataAccessEntries(entries) {
    return entries.sort((left, right) => {
        const methodCompare = String(left.method || '').localeCompare(String(right.method || ''));
        if (methodCompare !== 0) {
            return methodCompare;
        }
        const operationCompare = String(left.operation || '').localeCompare(String(right.operation || ''));
        if (operationCompare !== 0) {
            return operationCompare;
        }
        return Number(left.depth || 0) - Number(right.depth || 0);
    });
}

function buildDataAccessSummary(traversal, lookup) {
    const tables = new Map();
    const actorIds = new Set();
    let readCount = 0;
    let writeCount = 0;
    const seenEdges = new Set();

    for (const item of traversal || []) {
        const edge = item.edge || {};
        if (!['reads', 'writes'].includes(edge.type)) {
            continue;
        }
        const fromNode = getOwnEntry(lookup.nodesById, edge.from) || null;
        const toNode = getOwnEntry(lookup.nodesById, edge.to) || null;
        const tableNode = toNode?.type === 'table'
            ? toNode
            : (fromNode?.type === 'table' ? fromNode : null);
        if (!tableNode) {
            continue;
        }
        const actorNode = tableNode.id === edge.to ? fromNode : toNode;
        const dedupeKey = [
            edge.from || '',
            edge.to || '',
            edge.type || '',
            edge.meta?.operation || '',
        ].join('|');
        if (seenEdges.has(dedupeKey)) {
            continue;
        }
        seenEdges.add(dedupeKey);

        if (!tables.has(tableNode.id)) {
            tables.set(tableNode.id, {
                id: tableNode.id,
                name: edge.meta?.tableName || tableNode.name || '',
                file: tableNode.file || '',
                importPath: edge.meta?.importPath || tableNode.meta?.importPath || '',
                reads: [],
                writes: [],
            });
        }

        const access = makeDataAccessEntry(edge, actorNode, item);
        if (actorNode?.id) {
            actorIds.add(actorNode.id);
        }
        const tableSummary = tables.get(tableNode.id);
        if (edge.type === 'reads') {
            tableSummary.reads.push(access);
            readCount++;
        } else {
            tableSummary.writes.push(access);
            writeCount++;
        }
    }

    const tableSummaries = [...tables.values()]
        .map(table => ({
            ...table,
            reads: sortDataAccessEntries(table.reads),
            writes: sortDataAccessEntries(table.writes),
        }))
        .sort((left, right) => left.name.localeCompare(right.name));

    return {
        kind: 'data-access-summary',
        purpose: '当前链路遍历范围内的数据表读写摘要，用于从接口、方法或全栈链路快速判断涉及哪些后端表。',
        counts: {
            tables: tableSummaries.length,
            reads: readCount,
            writes: writeCount,
            accessEdges: readCount + writeCount,
            actors: actorIds.size,
        },
        tables: tableSummaries,
    };
}

function summarizeEdges(edges, lookup, limit = 8) {
    return (edges || []).slice(0, limit).map(edge => ({
        type: edge.type,
        sourceKind: edge.sourceKind,
        to: getOwnEntry(lookup.nodesById, edge.to)?.name || edge.to,
        from: getOwnEntry(lookup.nodesById, edge.from)?.name || edge.from,
        meta: edge.meta || {},
    }));
}

function summarizeNode(node, lookup) {
    const outgoing = lookup.adjacency.outgoing[node.id] || [];
    const incoming = lookup.adjacency.incoming[node.id] || [];
    const binds = outgoing.filter(edge => edge.type === 'binds');
    const summary = {
        id: node.id,
        type: node.type,
        name: node.name,
        file: node.file,
        line: node.line,
        area: node.area,
        stack: node.stack,
        meta: node.meta || {},
        outgoingCount: outgoing.length,
        incomingCount: incoming.length,
        bindings: summarizeEdges(binds, lookup),
    };

    if (node.type === 'endpoint') {
        summary.httpMethod = node.meta?.method || '';
        summary.httpPath = node.meta?.path || '';
    }
    if (node.type === 'route') {
        summary.routeKind = node.meta?.kind || '';
        summary.routeProtocol = node.meta?.protocol || '';
        summary.route = node.meta?.route || node.name;
    }
    if (node.type === 'message') {
        summary.messageProtocol = node.meta?.protocol || '';
        summary.messageConfidence = node.meta?.confidence ?? null;
    }
    if (node.type === 'request') {
        summary.callee = node.meta?.callee || '';
        summary.requestProtocol = node.meta?.protocol || '';
        summary.requestHttpMethod = node.meta?.httpMethod || '';
        summary.requestTransport = node.meta?.transport || '';
    }
    if (node.type === 'table') {
        summary.importPath = node.meta?.importPath || '';
    }
    if (node.type === 'ui-node') {
        summary.prefabPath = node.meta?.prefabPath || '';
        summary.nodePath = node.meta?.nodePath || node.name;
        summary.active = node.meta?.active ?? null;
        summary.nestedPrefabPath = node.meta?.nestedPrefabPath || '';
    }
    if (node.type === 'asset') {
        summary.assetPath = node.meta?.assetPath || node.file || '';
        summary.assetKind = node.meta?.assetKind || '';
        summary.importer = node.meta?.importer || '';
    }
    if (node.type === 'binding') {
        summary.prefabPath = node.meta?.prefabPath || '';
        summary.nodePath = node.meta?.nodePath || '';
        summary.componentName = node.meta?.componentName || '';
        summary.field = node.meta?.field || '';
        summary.bindingKind = node.meta?.bindingKind || node.meta?.kind || '';
        summary.editTarget = node.meta?.editTarget || '';
        summary.applyVia = node.meta?.applyVia || '';
        summary.valueKind = node.meta?.valueKind || '';
        summary.targetNodePath = node.meta?.targetNodePath || '';
        summary.targetComponentName = node.meta?.targetComponentName || '';
        summary.targetScriptPath = node.meta?.targetScriptPath || '';
        summary.assetPath = node.meta?.assetPath || '';
        summary.assetKind = node.meta?.assetKind || '';
    }

    return summary;
}

function isPrefabComponentAttachment(node) {
    if (!node || node.type !== 'component') {
        return false;
    }
    const meta = node.meta || {};
    return (
        meta.bindingKind === 'component-attachment' ||
        meta.editTarget === 'prefab-component-list' ||
        meta.category === 'prefab-component'
    );
}

function componentNameOf(node) {
    return String(node?.name || '').split('@')[0] || String(node?.meta?.rawType || '');
}

function isBuiltinCocosComponent(rawType) {
    const text = String(rawType || '');
    return (
        text.startsWith('cc.') ||
        text.startsWith('sp.') ||
        text.startsWith('dragonBones.') ||
        text.startsWith('jsb.') ||
        text.startsWith('ccui.')
    );
}

function isScriptPath(value) {
    return /\.(tsx?|jsx?|mjs|cjs)$/i.test(String(value || ''));
}

function classifyPrefabComponent(node) {
    const meta = node.meta || {};
    const prefabPath = meta.prefabPath || '';
    const scriptPath = node.file || meta.scriptPath || meta.targetScriptPath || '';
    const rawType = meta.rawType || componentNameOf(node);
    if (scriptPath && !samePath(scriptPath, prefabPath) && isScriptPath(scriptPath)) {
        return 'custom-script';
    }
    if (isBuiltinCocosComponent(rawType) || isBuiltinCocosComponent(componentNameOf(node))) {
        return 'builtin';
    }
    return 'unresolved';
}

function compactComponentNode(node) {
    const meta = node.meta || {};
    return {
        id: node.id,
        name: node.name,
        componentName: componentNameOf(node),
        rawType: meta.rawType || componentNameOf(node),
        prefabPath: meta.prefabPath || '',
        nodePath: meta.nodePath || '',
        scriptPath: classifyPrefabComponent(node) === 'custom-script' ? node.file || '' : '',
        file: node.file || '',
        bindingKind: meta.bindingKind || '',
        editTarget: meta.editTarget || '',
    };
}

function pushGroupedComponent(groupMap, key, node) {
    const item = compactComponentNode(node);
    if (!groupMap.has(key)) {
        groupMap.set(key, {
            componentName: item.componentName,
            rawType: item.rawType,
            scriptPath: item.scriptPath,
            componentInstances: 0,
            nodePaths: [],
            instances: [],
        });
    }
    const group = groupMap.get(key);
    group.componentInstances += 1;
    if (item.nodePath && !group.nodePaths.includes(item.nodePath)) {
        group.nodePaths.push(item.nodePath);
    }
    group.instances.push(item);
}

function groupedComponentsToArray(groupMap) {
    return [...groupMap.values()].map(group => ({
        ...group,
        nodePaths: group.nodePaths.sort((left, right) => left.localeCompare(right)),
        instances: group.instances.sort((left, right) => String(left.nodePath).localeCompare(String(right.nodePath))),
    })).sort((left, right) => {
        const leftKey = left.scriptPath || left.rawType || left.componentName;
        const rightKey = right.scriptPath || right.rawType || right.componentName;
        return String(leftKey).localeCompare(String(rightKey));
    });
}

function normalizeDetail(args = {}) {
    const value = String(args.detail || '').trim().toLowerCase();
    return ['counts', 'summary', 'grouped', 'full'].includes(value) ? value : 'full';
}

function limitGroups(groups, args = {}) {
    const limit = Number.isFinite(args.groupLimit) && args.groupLimit > 0
        ? args.groupLimit
        : (args.limitExplicit && Number.isFinite(args.limit) && args.limit > 0 ? args.limit : groups.length);
    return groups.slice(0, limit);
}

function limitInstances(instances, args = {}) {
    const limit = Number.isFinite(args.instanceLimit) && args.instanceLimit > 0 ? args.instanceLimit : instances.length;
    return instances.slice(0, limit);
}

function limitNodePaths(nodePaths, args = {}) {
    const limit = Number.isFinite(args.nodePathLimit) && args.nodePathLimit > 0 ? args.nodePathLimit : nodePaths.length;
    return nodePaths.slice(0, limit);
}

function buildLimitMetadata(args = {}, source = {}) {
    return {
        groupLimit: Number.isFinite(args.groupLimit) && args.groupLimit > 0
            ? args.groupLimit
            : (args.limitExplicit && Number.isFinite(args.limit) && args.limit > 0 ? args.limit : null),
        instanceLimit: Number.isFinite(args.instanceLimit) && args.instanceLimit > 0 ? args.instanceLimit : null,
        nodePathLimit: Number.isFinite(args.nodePathLimit) && args.nodePathLimit > 0 ? args.nodePathLimit : null,
        groupsReturned: source.groupsReturned ?? null,
        groupsTotal: source.groupsTotal ?? null,
        instancesReturned: source.instancesReturned ?? null,
        instancesTotal: source.instancesTotal ?? null,
        truncated: Boolean(source.truncated),
    };
}

function componentGroupForDetail(group, detail, args = {}) {
    if (detail === 'summary') {
        return {
            componentName: group.componentName,
            rawType: group.rawType,
            scriptPath: group.scriptPath,
            componentInstances: group.componentInstances,
        };
    }
    if (detail === 'grouped') {
        return {
            componentName: group.componentName,
            rawType: group.rawType,
            scriptPath: group.scriptPath,
            componentInstances: group.componentInstances,
            nodePaths: limitNodePaths(group.nodePaths, args),
        };
    }
    return {
        ...group,
        nodePaths: limitNodePaths(group.nodePaths, args),
        instances: limitInstances(group.instances, args),
    };
}

function buildPrefabComponentSummary(graph, args) {
    const prefabPath = args.file || args.name || '';
    const detail = normalizeDetail(args);
    const componentNodes = (graph.nodes || []).filter(node => {
        if (!isPrefabComponentAttachment(node)) {
            return false;
        }
        return matchPath(node.meta?.prefabPath || node.file, prefabPath);
    });
    const customScripts = new Map();
    const builtinComponents = new Map();
    const unresolvedComponents = new Map();

    for (const node of componentNodes) {
        const kind = classifyPrefabComponent(node);
        const compact = compactComponentNode(node);
        if (kind === 'custom-script') {
            pushGroupedComponent(customScripts, compact.scriptPath || compact.rawType || compact.componentName, node);
        } else if (kind === 'builtin') {
            pushGroupedComponent(builtinComponents, compact.rawType || compact.componentName, node);
        } else {
            pushGroupedComponent(unresolvedComponents, compact.rawType || compact.componentName, node);
        }
    }

    const customScriptGroups = groupedComponentsToArray(customScripts);
    const builtinGroups = groupedComponentsToArray(builtinComponents);
    const unresolvedGroups = groupedComponentsToArray(unresolvedComponents);
    const counts = {
        componentInstances: componentNodes.length,
        customScripts: customScriptGroups.length,
        customScriptInstances: customScriptGroups.reduce((sum, item) => sum + item.componentInstances, 0),
        builtinComponents: builtinGroups.length,
        builtinInstances: builtinGroups.reduce((sum, item) => sum + item.componentInstances, 0),
        unresolvedComponents: unresolvedGroups.length,
        unresolvedInstances: unresolvedGroups.reduce((sum, item) => sum + item.componentInstances, 0),
    };
    const limitedCustomGroups = limitGroups(customScriptGroups, args);
    const limitedBuiltinGroups = limitGroups(builtinGroups, args);
    const limitedUnresolvedGroups = limitGroups(unresolvedGroups, args);
    const base = {
        kind: 'prefab-component-summary',
        detail,
        prefabPath,
        counts,
        limits: buildLimitMetadata(args, {
            groupsReturned: limitedCustomGroups.length + limitedBuiltinGroups.length + limitedUnresolvedGroups.length,
            groupsTotal: customScriptGroups.length + builtinGroups.length + unresolvedGroups.length,
            instancesReturned: componentNodes.length,
            instancesTotal: componentNodes.length,
            truncated:
                limitedCustomGroups.length < customScriptGroups.length ||
                limitedBuiltinGroups.length < builtinGroups.length ||
                limitedUnresolvedGroups.length < unresolvedGroups.length,
        }),
        limitAppliedToGroups: args.limit,
    };
    if (detail === 'counts') {
        return base;
    }
    return {
        ...base,
        customScripts: limitedCustomGroups.map(group => componentGroupForDetail(group, detail, args)),
        builtinComponents: limitedBuiltinGroups.map(group => componentGroupForDetail(group, detail, args)),
        unresolvedComponents: limitedUnresolvedGroups.map(group => componentGroupForDetail(group, detail, args)),
    };
}

function buildScriptUsageSummary(graph, args) {
    const scriptPath = args.file || args.name || '';
    const excludePath = args.excludePrefab || args.excludeFile || '';
    const detail = normalizeDetail(args);
    const componentNodes = (graph.nodes || []).filter(node => {
        if (!isPrefabComponentAttachment(node) || classifyPrefabComponent(node) !== 'custom-script') {
            return false;
        }
        if (!matchPath(node.file, scriptPath)) {
            return false;
        }
        if (excludePath && matchPath(node.meta?.prefabPath, excludePath)) {
            return false;
        }
        return true;
    });

    const prefabMap = new Map();
    for (const node of componentNodes) {
        const item = compactComponentNode(node);
        const prefabPath = item.prefabPath || '(unknown-prefab)';
        if (!prefabMap.has(prefabPath)) {
            prefabMap.set(prefabPath, {
                prefabPath,
                componentInstances: 0,
                componentNames: [],
                rawTypes: [],
                nodePaths: [],
                instances: [],
            });
        }
        const group = prefabMap.get(prefabPath);
        group.componentInstances += 1;
        if (item.componentName && !group.componentNames.includes(item.componentName)) {
            group.componentNames.push(item.componentName);
        }
        if (item.rawType && !group.rawTypes.includes(item.rawType)) {
            group.rawTypes.push(item.rawType);
        }
        if (item.nodePath && !group.nodePaths.includes(item.nodePath)) {
            group.nodePaths.push(item.nodePath);
        }
        group.instances.push(item);
    }

    const prefabs = [...prefabMap.values()].map(item => ({
        ...item,
        componentNames: item.componentNames.sort((left, right) => left.localeCompare(right)),
        rawTypes: item.rawTypes.sort((left, right) => left.localeCompare(right)),
        nodePaths: item.nodePaths.sort((left, right) => left.localeCompare(right)),
        instances: item.instances.sort((left, right) => String(left.nodePath).localeCompare(String(right.nodePath))),
    })).sort((left, right) => left.prefabPath.localeCompare(right.prefabPath));
    const limitedPrefabs = limitGroups(prefabs, args);
    const prefabsForDetail = limitedPrefabs.map(item => {
        if (detail === 'summary') {
            return {
                prefabPath: item.prefabPath,
                componentInstances: item.componentInstances,
            };
        }
        if (detail === 'grouped') {
            return {
                prefabPath: item.prefabPath,
                componentInstances: item.componentInstances,
                componentNames: item.componentNames,
                nodePaths: limitNodePaths(item.nodePaths, args),
            };
        }
        return {
            ...item,
            nodePaths: limitNodePaths(item.nodePaths, args),
            instances: limitInstances(item.instances, args),
        };
    });

    const base = {
        kind: 'script-usage-summary',
        detail,
        scriptPath,
        excludedPrefabPath: excludePath,
        counts: {
            uniquePrefabs: prefabs.length,
            componentInstances: componentNodes.length,
        },
        limits: buildLimitMetadata(args, {
            groupsReturned: limitedPrefabs.length,
            groupsTotal: prefabs.length,
            instancesReturned: componentNodes.length,
            instancesTotal: componentNodes.length,
            truncated: limitedPrefabs.length < prefabs.length,
        }),
        limitAppliedToGroups: args.limit,
    };
    if (detail === 'counts') {
        return base;
    }
    return {
        ...base,
        prefabs: prefabsForDetail,
    };
}

function collectScriptUsageGroups(graph, scriptPath, args = {}) {
    const excludePath = args.excludePrefab || args.excludeFile || '';
    const componentNodes = (graph.nodes || []).filter(node => {
        if (!isPrefabComponentAttachment(node) || classifyPrefabComponent(node) !== 'custom-script') {
            return false;
        }
        if (!matchPath(node.file, scriptPath)) {
            return false;
        }
        if (excludePath && matchPath(node.meta?.prefabPath, excludePath)) {
            return false;
        }
        return true;
    });

    const prefabMap = new Map();
    for (const node of componentNodes) {
        const item = compactComponentNode(node);
        const prefabPath = item.prefabPath || '(unknown-prefab)';
        if (!prefabMap.has(prefabPath)) {
            prefabMap.set(prefabPath, {
                prefabPath,
                componentInstances: 0,
                nodePaths: [],
            });
        }
        const group = prefabMap.get(prefabPath);
        group.componentInstances += 1;
        if (item.nodePath && !group.nodePaths.includes(item.nodePath)) {
            group.nodePaths.push(item.nodePath);
        }
    }
    return [...prefabMap.values()]
        .map(group => ({
            ...group,
            nodePaths: group.nodePaths.sort((left, right) => left.localeCompare(right)),
        }))
        .sort((left, right) => left.prefabPath.localeCompare(right.prefabPath));
}

function buildPrefabScriptUsageSummary(graph, args) {
    const prefabPath = args.file || args.name || '';
    const detail = normalizeDetail(args);
    const componentSummary = buildPrefabComponentSummary(graph, {
        ...args,
        detail: 'full',
        limit: null,
        groupLimit: null,
        instanceLimit: null,
        nodePathLimit: null,
    });
    const scripts = componentSummary.customScripts || [];
    const scriptRows = scripts.map(script => {
        const allUsage = collectScriptUsageGroups(graph, script.scriptPath, {});
        const otherUsage = collectScriptUsageGroups(graph, script.scriptPath, {
            excludePrefab: args.excludePrefab || prefabPath,
        });
        const row = {
            componentName: script.componentName,
            rawType: script.rawType,
            scriptPath: script.scriptPath,
            componentInstancesInSourcePrefab: script.componentInstances,
            nodePathsInSourcePrefab: limitNodePaths(script.nodePaths || [], args),
            totalPrefabUsageCount: allUsage.length,
            otherPrefabUsageCount: otherUsage.length,
            otherPrefabPaths: otherUsage.map(item => item.prefabPath),
            usedOnlyInThisPrefab: otherUsage.length === 0,
        };
        if (detail === 'grouped' || detail === 'full') {
            row.prefabs = limitGroups(allUsage, args).map(item => ({
                prefabPath: item.prefabPath,
                componentInstances: item.componentInstances,
                nodePaths: limitNodePaths(item.nodePaths, args),
            }));
            row.otherPrefabs = limitGroups(otherUsage, args).map(item => ({
                prefabPath: item.prefabPath,
                componentInstances: item.componentInstances,
                nodePaths: limitNodePaths(item.nodePaths, args),
            }));
        }
        return row;
    });
    const limitedScripts = limitGroups(scriptRows, args);
    const base = {
        kind: 'prefab-script-usage-summary',
        detail,
        prefabPath,
        excludedPrefabPath: args.excludePrefab || prefabPath,
        counts: {
            customScripts: scripts.length,
            scriptsWithOtherPrefabUsage: scriptRows.filter(item => !item.usedOnlyInThisPrefab).length,
            scriptsUsedOnlyInThisPrefab: scriptRows.filter(item => item.usedOnlyInThisPrefab).length,
        },
        limits: buildLimitMetadata(args, {
            groupsReturned: limitedScripts.length,
            groupsTotal: scriptRows.length,
            truncated: limitedScripts.length < scriptRows.length,
        }),
    };
    if (detail === 'counts') {
        return base;
    }
    return {
        ...base,
        scripts: limitedScripts,
    };
}

function searchNodes(graph, lookup, args) {
    let nodes = [...graph.nodes];

    if (args.type) {
        nodes = nodes.filter(node => node.type === args.type);
    }
    nodes = nodes.filter(node => nodeMatchesQueryFilters(node, args));
    if (args.name) {
        nodes = nodes.filter(node => {
            return (
                matchContains(node.name, args.name) ||
                matchContains(node.meta?.methodName, args.name) ||
                matchContains(node.meta?.statePath, args.name) ||
                matchContains(node.meta?.route, args.name) ||
                matchContains(node.meta?.path, args.name) ||
                matchContains(node.meta?.importPath, args.name) ||
                matchContains(node.meta?.protocol, args.name) ||
                matchContains(node.meta?.httpMethod, args.name) ||
                matchContains(node.meta?.transport, args.name) ||
                matchContains(node.meta?.callee, args.name) ||
                matchContains(node.meta?.nodePath, args.name) ||
                matchContains(node.meta?.prefabPath, args.name) ||
                matchContains(node.meta?.field, args.name) ||
                matchContains(node.meta?.bindingKind, args.name) ||
                matchContains(node.meta?.editTarget, args.name) ||
                matchContains(node.meta?.assetPath, args.name) ||
                matchContains(node.meta?.assetKind, args.name) ||
                matchContains(node.meta?.targetNodePath, args.name) ||
                matchContains(node.meta?.targetComponentName, args.name) ||
                (node.meta?.tags || []).some(tag => matchContains(tag, args.name))
            );
        });
    }
    if (args.tag) {
        nodes = nodes.filter(node => (node.meta?.tags || []).some(tag => matchContains(tag, args.tag)));
    }
    if (args.file) {
        nodes = nodes.filter(node => matchContains(node.file, args.file));
    }
    if (args.hasHandler) {
        nodes = nodes.filter(node => {
            const outgoing = lookup.adjacency.outgoing[node.id] || [];
            return outgoing.some(edge => {
                if (edge.type !== 'binds') {
                    return false;
                }
                return matchContains(edge.meta?.sourceEventKind, args.hasHandler) || matchContains(edge.meta?.handler, args.hasHandler);
            });
        });
    }

    return nodes.slice(0, args.limit).map(node => summarizeNode(node, lookup));
}

function inferBusinessGroup(result) {
    const text = normalizePathText([result.file, result.meta?.path, result.name].filter(Boolean).join(' '));
    const isHttp = result.type === 'endpoint' || result.requestProtocol === 'http' || result.httpMethod || result.requestHttpMethod;
    if (text.includes('/cms-client/')) {
        return {
            key: isHttp ? 'cms-client-http' : 'cms-client',
            title: isHttp ? '后台前端 HTTP 请求' : '后台前端',
            priority: 1,
            recommendedArgs: { module: 'cms-client', protocol: isHttp ? 'http' : '' },
        };
    }
    if (text.includes('/cms-server/')) {
        return {
            key: isHttp ? 'cms-server-http' : 'cms-server',
            title: isHttp ? '后台后端 HTTP 接口' : '后台后端',
            priority: 2,
            recommendedArgs: { module: 'cms-server', protocol: isHttp ? 'http' : '' },
        };
    }
    if (text.includes('/xy-client/')) {
        return {
            key: 'xy-client',
            title: '游戏客户端',
            priority: 3,
            recommendedArgs: { module: 'xy-client' },
        };
    }
    if (text.includes('/qy-server/')) {
        return {
            key: isHttp ? 'qy-server-http' : 'qy-server',
            title: isHttp ? '游戏服 HTTP 接口' : '游戏服',
            priority: 4,
            recommendedArgs: { module: 'qy-server', protocol: isHttp ? 'http' : '' },
        };
    }
    const fallback = getRecommendationGroup(result);
    return {
        key: fallback.key,
        title: fallback.title,
        priority: fallback.priority + 10,
        recommendedArgs: {},
    };
}

function buildGroupedSearchResults(results, args = {}) {
    const groups = new Map();
    for (const result of results || []) {
        const groupInfo = inferBusinessGroup(result);
        if (!groups.has(groupInfo.key)) {
            groups.set(groupInfo.key, {
                key: groupInfo.key,
                title: groupInfo.title,
                priority: groupInfo.priority,
                recommendedArgs: groupInfo.recommendedArgs,
                results: [],
            });
        }
        groups.get(groupInfo.key).results.push(result);
    }
    const groupLimit = Number.isFinite(args.groupLimit) && args.groupLimit > 0 ? args.groupLimit : groups.size;
    return {
        kind: 'grouped-search-results',
        query: {
            type: args.type || '',
            name: args.name || '',
        },
        counts: {
            totalResults: results.length,
            groups: groups.size,
        },
        groups: [...groups.values()]
            .sort((left, right) => left.priority - right.priority)
            .slice(0, groupLimit)
            .map(group => ({
                ...group,
                results: group.results.slice(0, args.limit),
            })),
        limits: buildLimitMetadata(args, {
            groupsReturned: Math.min(groupLimit, groups.size),
            groupsTotal: groups.size,
            truncated: groupLimit < groups.size,
        }),
    };
}

function formatNodeLabel(node) {
    if (!node) {
        return '(missing-node)';
    }
    return `${node.name} [${node.type}]`;
}

function splitAmbiguousCandidate(candidate) {
    const text = String(candidate || '').trim();
    const separator = text.indexOf(':');
    if (separator <= 0) {
        return { raw: text, type: '', name: text };
    }
    return {
        raw: text,
        type: text.slice(0, separator),
        name: text.slice(separator + 1),
    };
}

function resolveAmbiguousCandidateNode(graph, lookup, candidate) {
    const parsed = splitAmbiguousCandidate(candidate);
    if (getOwnEntry(lookup.nodesById, parsed.raw)) {
        return getOwnEntry(lookup.nodesById, parsed.raw);
    }
    const directMatches = (graph.nodes || []).filter(node => {
        if (parsed.type && node.type !== parsed.type) {
            return false;
        }
        return (
            node.name === parsed.name ||
            node.id === parsed.raw ||
            node.meta?.route === parsed.name ||
            node.meta?.statePath === parsed.name ||
            `${node.type}:${node.name}` === parsed.raw
        );
    });
    if (directMatches.length > 0) {
        return directMatches[0];
    }

    const normalizedName = normalizeText(parsed.name);
    return (graph.nodes || []).find(node => {
        if (parsed.type && node.type !== parsed.type) {
            return false;
        }
        return (
            normalizeText(node.name) === normalizedName ||
            normalizeText(node.meta?.route) === normalizedName ||
            normalizeText(node.meta?.statePath) === normalizedName
        );
    }) || null;
}

function getRecommendationGroup(node) {
    if (node.type === 'endpoint') {
        return {
            key: 'http-endpoint',
            title: 'HTTP 接口入口',
            priority: 1,
            reason: '适合从外部 API 或后台接口入口继续追下游链路。',
        };
    }
    if (node.type === 'route') {
        const isPinus = matchContains(node.meta?.protocol, 'pinus') || matchContains(node.meta?.kind, 'pinus');
        return {
            key: isPinus ? 'pinus-route' : 'route',
            title: isPinus ? 'Pinus RPC/消息入口' : '路由入口',
            priority: isPinus ? 2 : 3,
            reason: '适合从服务端消息、remote 或 handler 路由继续追链路。',
        };
    }
    if (node.type === 'request') {
        const isFrontend = node.area === 'frontend' || matchContains(node.meta?.transport, 'http') || matchContains(node.meta?.httpMethod, 'GET') || matchContains(node.meta?.httpMethod, 'POST');
        return {
            key: isFrontend ? 'frontend-request' : 'network-request',
            title: isFrontend ? '前端请求入口' : '网络/RPC 调用入口',
            priority: isFrontend ? 4 : 5,
            reason: '适合从调用方请求继续追上游或下游。',
        };
    }
    if (node.type === 'method') {
        return {
            key: 'method',
            title: '方法入口',
            priority: 6,
            reason: '适合已经知道具体实现函数时直接追调用链。',
        };
    }
    if (['binding', 'ui-node', 'component', 'asset'].includes(node.type)) {
        return {
            key: 'ui-binding',
            title: 'UI/Prefab 入口',
            priority: 7,
            reason: '适合定位 Cocos 界面节点、组件、资源或事件绑定。',
        };
    }
    if (['event', 'message'].includes(node.type)) {
        return {
            key: 'event-message',
            title: '事件/消息入口',
            priority: 8,
            reason: '适合追事件派发、订阅、消息处理和协议流转。',
        };
    }
    if (['state', 'table'].includes(node.type)) {
        return {
            key: 'state-data',
            title: '状态/数据入口',
            priority: 9,
            reason: '适合追状态读写或数据表访问。',
        };
    }
    return {
        key: 'other',
        title: '其他入口',
        priority: 99,
        reason: '未归入常见入口类型，建议按节点类型继续精确查询。',
    };
}

function quoteCommandArg(value) {
    return `"${String(value || '').replace(/"/g, '\\"')}"`;
}

function formatCommandArg(value) {
    const text = String(value || '');
    return /^[A-Za-z0-9_./:@-]+$/.test(text) ? text : quoteCommandArg(text);
}

function buildQueryCommandBase(featureKey, options = {}) {
    const parts = ['node src/bin/query-feature.js'];
    if (options.workspaceRoot) {
        parts.push('--workspace-root', quoteCommandArg(options.workspaceRoot));
    }
    if (options.dataRoot) {
        parts.push('--data-root', quoteCommandArg(options.dataRoot));
    }
    if (options.layout) {
        parts.push('--layout', quoteCommandArg(options.layout));
    }
    parts.push('--feature', quoteCommandArg(featureKey));
    return parts.join(' ');
}

function buildCandidateCommand(featureKey, node, direction = 'downstream', options = {}) {
    const dir = direction === 'upstream' ? 'upstream' : 'downstream';
    const base = buildQueryCommandBase(featureKey, options);
    if (node.type === 'method') {
        return `${base} --method ${quoteCommandArg(node.name)} --${dir}`;
    }
    if (['event', 'message', 'request', 'state'].includes(node.type)) {
        return `${base} --${node.type} ${quoteCommandArg(node.name)} --${dir}`;
    }
    if (node.type === 'endpoint') {
        return `${base} --${dir} ${quoteCommandArg(node.name)}`;
    }
    return `${base} --${dir} ${quoteCommandArg(node.id)}`;
}

function buildAmbiguousRecommendations(graph, lookup, ambiguous = [], options = {}) {
    const featureKey = options.featureKey || graph.featureKey || lookup.featureKey || '<feature-key>';
    const direction = options.direction || 'downstream';
    const seen = new Set();
    const nodes = [];
    for (const candidate of ambiguous) {
        const node = resolveAmbiguousCandidateNode(graph, lookup, candidate);
        if (!node || seen.has(node.id)) {
            continue;
        }
        seen.add(node.id);
        nodes.push(node);
    }
    if (nodes.length === 0) {
        return null;
    }

    const groupsByKey = new Map();
    for (const node of nodes) {
        const groupInfo = getRecommendationGroup(node);
        if (!groupsByKey.has(groupInfo.key)) {
            groupsByKey.set(groupInfo.key, {
                key: groupInfo.key,
                title: groupInfo.title,
                priority: groupInfo.priority,
                reason: groupInfo.reason,
                candidates: [],
            });
        }
        groupsByKey.get(groupInfo.key).candidates.push({
            id: node.id,
            type: node.type,
            name: node.name,
            file: node.file || '',
            line: node.line ?? null,
            area: node.area || 'unknown',
            command: buildCandidateCommand(featureKey, node, direction, options),
        });
    }

    const groups = [...groupsByKey.values()]
        .sort((left, right) => left.priority - right.priority)
        .map(group => ({
            ...group,
            candidates: group.candidates
                .sort((left, right) => left.name.localeCompare(right.name))
                .slice(0, 5),
        }));

    return {
        query: options.query || '',
        direction,
        totalCandidates: nodes.length,
        groups,
    };
}

function withAmbiguousRecommendations(result, graph, lookup, options = {}) {
    if (!result?.ambiguous || result.recommendations) {
        return result;
    }
    const recommendations = buildAmbiguousRecommendations(graph, lookup, result.ambiguous, options);
    if (!recommendations) {
        return result;
    }
    return {
        ...result,
        recommendations,
    };
}

function buildTypeAwareNotFoundResult(graph, featureKey, selectorType, query, options = {}) {
    const candidateTypes = selectorType === 'message'
        ? ['method', 'request', 'endpoint', 'route', 'script']
        : ['method', 'request', 'endpoint', 'route', 'script', 'message'];
    const base = buildQueryCommandBase(featureKey, options);
    const suggestions = [];

    for (const type of candidateTypes) {
        const matches = searchNodes(graph, { adjacency: { outgoing: {}, incoming: {} } }, {
            type,
            name: query,
            limit: 3,
        });
        const reason = type === 'method'
            ? `${query} may be a function or controller method`
            : type === 'request'
              ? `${query} may be a frontend HTTP request`
              : type === 'endpoint'
                ? `${query} may be a backend HTTP endpoint`
                : type === 'route'
                  ? `${query} may be a route or protocol entry`
                  : type === 'script'
                    ? `${query} may appear in a source file name`
                    : `${query} may be a protocol message`;
        suggestions.push({
            query: `${base} --type ${type} --name ${formatCommandArg(query)} --json`,
            reason,
            matches: matches.slice(0, 3).map(item => ({
                name: item.name,
                type: item.type,
                file: item.file || '',
                line: item.line ?? null,
            })),
        });
    }

    return {
        ok: false,
        error: `No nodes matched ${selectorType}=${query}`,
        selectorType,
        query,
        suggestions,
    };
}

function printNotFoundResult(result, asJson) {
    if (asJson) {
        console.log(JSON.stringify(result, null, 2));
        return;
    }
    console.log(result.error);
    if (Array.isArray(result.suggestions) && result.suggestions.length > 0) {
        console.log('可尝试的查询:');
        for (const suggestion of result.suggestions) {
            console.log(`- ${suggestion.query}`);
            console.log(`  reason: ${suggestion.reason}`);
        }
    }
}

function printAmbiguous(result) {
    console.log('查询存在歧义:');
    if (result.recommendations?.groups?.length) {
        console.log('推荐入口:');
        result.recommendations.groups.forEach(group => {
            console.log(`- ${group.title} (${group.key})`);
            group.candidates.forEach(candidate => {
                const location = candidate.file ? ` ${candidate.file}${candidate.line ? `:${candidate.line}` : ''}` : '';
                console.log(`  - ${candidate.name} [${candidate.type}]${location}`);
                console.log(`    ${candidate.command}`);
            });
        });
        console.log('原始候选:');
    }
    result.ambiguous.forEach(item => console.log(`- ${item}`));
}

function printSummary(result, asJson) {
    if (asJson) {
        console.log(JSON.stringify(result, null, 2));
        return;
    }

    if (result?.ambiguous) {
        printAmbiguous(result);
        return;
    }

    console.log(`${result.name} [${result.type}]`);
    console.log(`- file: ${result.file || '(none)'}`);
    console.log(`- line: ${result.line ?? '(unknown)'}`);
    console.log(`- area: ${result.area || 'unknown'}`);
    console.log(`- outgoing: ${result.outgoingCount}`);
    console.log(`- incoming: ${result.incomingCount}`);
    
    // 方法类型信息
    if (result.type === 'method') {
        const meta = result.meta || {};
        if (meta.params) {
            console.log(`- params: ${meta.params}`);
        }
        if (meta.returnType) {
            console.log(`- return: ${meta.returnType}`);
        }
        if (meta.access) {
            console.log(`- access: ${meta.access}${meta.async ? ' async' : ''}${meta.static ? ' static' : ''}`);
        }
        if (meta.summary) {
            console.log(`- summary: ${meta.summary}`);
        }
        if (meta.bodySnippet) {
            console.log(`- body: ${meta.bodySnippet.slice(0, 100)}${meta.bodySnippet.length > 100 ? '...' : ''}`);
        }
        // JSDoc 信息
        if (meta.jsdoc) {
            const jsdoc = meta.jsdoc;
            if (jsdoc.description && jsdoc.description !== meta.summary) {
                console.log(`- description: ${jsdoc.description.slice(0, 150)}${jsdoc.description.length > 150 ? '...' : ''}`);
            }
            if (Object.keys(jsdoc.params || {}).length > 0) {
                console.log('- params docs:');
                for (const [paramName, paramInfo] of Object.entries(jsdoc.params)) {
                    const typeStr = paramInfo.type ? `{${paramInfo.type}} ` : '';
                    console.log(`    - ${paramName}: ${typeStr}${paramInfo.description}`);
                }
            }
            if (jsdoc.returns) {
                console.log(`- returns: ${jsdoc.returns}`);
            }
            if (jsdoc.deprecated) {
                console.log('- ⚠️ deprecated');
            }
            if (jsdoc.examples && jsdoc.examples.length > 0) {
                console.log(`- example: ${jsdoc.examples[0].slice(0, 100)}${jsdoc.examples[0].length > 100 ? '...' : ''}`);
            }
        }
    }
    
    if (result.type === 'endpoint') {
        console.log(`- httpMethod: ${result.httpMethod || '(none)'}`);
        console.log(`- httpPath: ${result.httpPath || '(none)'}`);
    }
    if (result.type === 'route') {
        console.log(`- route: ${result.route || '(none)'}`);
        console.log(`- kind: ${result.routeKind || '(none)'}`);
        console.log(`- protocol: ${result.routeProtocol || '(none)'}`);
    }
    if (result.type === 'message') {
        console.log(`- protocol: ${result.messageProtocol || '(none)'}`);
        console.log(`- confidence: ${result.messageConfidence ?? '(none)'}`);
    }
    if (result.type === 'request') {
        console.log(`- callee: ${result.callee || '(none)'}`);
        console.log(`- protocol: ${result.requestProtocol || '(none)'}`);
        console.log(`- httpMethod: ${result.requestHttpMethod || '(none)'}`);
        console.log(`- transport: ${result.requestTransport || '(none)'}`);
    }
    if (result.type === 'table') {
        console.log(`- importPath: ${result.importPath || '(none)'}`);
    }
    if ((result.bindings || []).length > 0) {
        console.log('- bindings:');
        result.bindings.forEach(item => {
            console.log(`  - ${item.meta?.sourceEventKind || item.type} -> ${item.to}`);
        });
    }
}

function printDetailedResult(result, asJson) {
    if (asJson) {
        console.log(JSON.stringify(result, null, 2));
        return;
    }

    if (result?.ambiguous) {
        printAmbiguous(result);
        return;
    }

    console.log(`${result.name} [${result.type}]`);
    Object.entries(result)
        .filter(([key]) => !['name', 'type'].includes(key))
        .forEach(([key, value]) => {
            if (Array.isArray(value)) {
                console.log(`- ${key}: ${value.length ? value.join(', ') : '(none)'}`);
                return;
            }
            if (value && typeof value === 'object') {
                console.log(`- ${key}: ${JSON.stringify(value)}`);
                return;
            }
            console.log(`- ${key}: ${value == null || value === '' ? '(none)' : value}`);
        });
}

function printSearchResults(results, asJson) {
    if (asJson) {
        console.log(JSON.stringify(results, null, 2));
        return;
    }

    if (!results.length) {
        console.log('未找到匹配节点。');
        return;
    }

    console.log(`找到 ${results.length} 个节点:`);
    results.forEach(result => {
        console.log(`- ${result.name} [${result.type}] (${result.area || 'unknown'})`);
        console.log(`  file: ${result.file || '(none)'}`);
        if (result.type === 'endpoint') {
            console.log(`  http: ${result.httpMethod || '(none)'} ${result.httpPath || '(none)'}`);
        }
        if (result.type === 'route') {
            console.log(`  route: ${result.route || '(none)'} [${result.routeKind || 'unknown'}|${result.routeProtocol || 'unknown'}]`);
        }
        if (result.type === 'message') {
            console.log(`  message: [${result.messageProtocol || 'unknown'}] confidence=${result.messageConfidence ?? '(none)'}`);
        }
        if (result.type === 'request') {
            console.log(`  request: ${result.requestHttpMethod || '(none)'} [${result.requestProtocol || 'unknown'}|${result.requestTransport || 'unknown'}] via ${result.callee || '(none)'}`);
        }
        if (result.type === 'table') {
            console.log(`  importPath: ${result.importPath || '(none)'}`);
        }
        if ((result.bindings || []).length > 0) {
            result.bindings.forEach(item => {
                console.log(`  binds ${item.meta?.sourceEventKind || item.type} -> ${item.to}`);
            });
        }
    });
}

function printTraversal(result, asJson) {
    if (asJson) {
        console.log(JSON.stringify(result, null, 2));
        return;
    }

    if (result?.ambiguous) {
        printAmbiguous(result);
        return;
    }

    console.log(`起点: ${formatNodeLabel(result.node)}`);
    console.log(`方向: ${result.direction}, 深度: ${result.depth}`);
    if (result.dataAccessSummary) {
        const summary = result.dataAccessSummary;
        console.log(`数据表读写: ${summary.counts.tables} 表, ${summary.counts.reads} 读, ${summary.counts.writes} 写`);
        for (const table of summary.tables || []) {
            const operations = [
                table.reads.length ? `读:${table.reads.map(item => item.operation || item.method).filter(Boolean).join(', ')}` : '',
                table.writes.length ? `写:${table.writes.map(item => item.operation || item.method).filter(Boolean).join(', ')}` : '',
            ].filter(Boolean).join('; ');
            console.log(`  - ${table.name}${operations ? ` (${operations})` : ''}`);
        }
    }

    if (!result.traversal.length) {
        console.log('未找到链路。');
        return;
    }

    result.traversal
        .sort((left, right) => left.depth - right.depth)
        .forEach(item => {
            const indent = '  '.repeat(Math.max(0, item.depth - 1));
            const targetLabel = formatNodeLabel(item.node || { name: item.edge.to, type: 'unknown' });
            const metaSuffix = item.edge.meta?.sourceEventKind
                ? ` (${item.edge.meta.sourceEventKind})`
                : item.edge.meta?.statePath
                  ? ` (${item.edge.meta.statePath})`
                  : '';
            console.log(`${indent}- ${item.edge.type} -> ${targetLabel}${metaSuffix}`);
        });
}

function buildRecommendedCommands(featureKey, lookup = {}) {
    const commands = [
        `node src/bin/query-feature.js --feature ${featureKey}`,
        `node src/bin/query-feature.js --feature ${featureKey} --downstream <query>`,
        `node src/bin/query-feature.js --feature ${featureKey} --method <name> --downstream`,
        `node src/bin/query-feature.js --feature ${featureKey} --type method --name <keyword>`,
        `node src/bin/query-chain.js --feature ${featureKey} --downstream <query>`,
    ];

    if (Array.isArray(lookup.nodesByType?.binding) && lookup.nodesByType.binding.length > 0) {
        commands.push(`node src/bin/query-feature.js --feature ${featureKey} --type binding --name <field|handler>`);
        commands.push(`node src/bin/cocos-authoring.js --feature ${featureKey} --prefab <prefab-name> --intent profile`);
    }
    if (Array.isArray(lookup.nodesByType?.['ui-node']) && lookup.nodesByType['ui-node'].length > 0) {
        commands.push(`node src/bin/query-feature.js --feature ${featureKey} --type ui-node --name <node-path>`);
    }
    return commands;
}

function buildArtifactGuide(feature) {
    const outputs = feature.outputs || {};
    return [
        {
            key: 'entrypoint',
            file: 'src/bin/query-feature.js',
            purpose: '统一查询入口，优先用于 feature 摘要、链路遍历和节点检索。',
            useWhen: '遇到入口、关闭窗口链路、prefab 事件绑定、节点/资源引用、request、state 流转时先运行它。',
            priority: 1,
        },
        {
            key: 'report',
            file: outputs.report || '',
            purpose: '构建汇总和使用说明，给人快速理解当前 feature 的范围、推荐查询方式和产物位置。',
            useWhen: '先想知道这个 feature 有什么、应该怎么查时优先看。',
            priority: 2,
        },
        {
            key: 'lookup',
            file: outputs.lookup || '',
            purpose: '查询索引，供查询脚本读取 method / event / request / state / route 的映射。',
            useWhen: '通常不要手读；只有调试查询脚本或排查索引异常时才直接打开。',
            priority: 3,
        },
        {
            key: 'graph',
            file: outputs.graph || '',
            purpose: '图节点与边的底层事实数据。',
            useWhen: '通常不要手读；只有确认具体边类型、节点 meta 或导出图时才打开。',
            priority: 4,
        },
        {
            key: 'scan',
            file: outputs.scan || '',
            purpose: '原始抽取事实，接近 extractor 输出。',
            useWhen: '通常不要手读；只有怀疑抽取阶段漏抓时才回看它。',
            priority: 5,
        },
    ];
}

function buildFeatureSummary(feature, graph, lookup, context = null) {
    const nodeCount = Array.isArray(graph.nodes) ? graph.nodes.length : 0;
    const edgeCount = Array.isArray(graph.edges) ? graph.edges.length : 0;
    const nodesByType = Object.fromEntries(
        Object.entries(lookup.nodesByType || {}).map(([type, ids]) => [type, Array.isArray(ids) ? ids.length : 0])
    );
    const examples = buildRecommendedCommands(feature.featureKey, lookup);
    const artifacts = buildArtifactGuide(feature);
    const kbVersionStatus = buildKbVersionStatus(graph, {
        root: context?.workspaceRoot || process.cwd(),
        config: context ? loadFreshnessConfig(context.workspaceRoot, feature) : null,
        recommendedAction: buildQueryRecommendedAction(feature.featureKey),
    });

    return {
        kind: 'feature-summary',
        purpose: '功能知识库摘要与默认查询入口。先用它确认当前 feature 的范围、常见节点类型和推荐命令，再决定是否继续看 docs 或源码。',
        useWhen: '当你还不确定该查哪个 KB 文件，或刚准备开始定位一个 feature 的入口、调用链、request、event、state、prefab 绑定时。',
        feature: {
            featureKey: feature.featureKey,
            featureName: feature.featureName,
            kbDir: feature.kbDir,
        },
        counts: {
            nodes: nodeCount,
            edges: edgeCount,
            nodesByType,
        },
        defaultWorkflow: [
            '先运行 feature 摘要，确认这个 KB 里有哪些节点类型和推荐命令。',
            '再用 --downstream / --upstream 或 --method / --event / --request / --state / --type binding 精确查询。',
            '只有 KB 结果不足以回答问题时，再读相关 docs；最后才用 rg/grep 回源码确认。'
        ],
        kbVersionStatus,
        kbFreshness: kbVersionStatus,
        artifacts,
        examples,
    };
}

function printFeatureSummary(summary, asJson) {
    if (asJson) {
        console.log(JSON.stringify(summary, null, 2));
        return;
    }

    console.log(`${summary.feature.featureName} (${summary.feature.featureKey})`);
    console.log(`- kbDir: ${summary.feature.kbDir}`);
    console.log(`- purpose: ${summary.purpose}`);
    console.log(`- useWhen: ${summary.useWhen}`);
    console.log(`- nodes: ${summary.counts.nodes}`);
    console.log(`- edges: ${summary.counts.edges}`);
    console.log('- nodesByType:');
    Object.entries(summary.counts.nodesByType)
        .sort((left, right) => left[0].localeCompare(right[0]))
        .forEach(([type, count]) => console.log(`  - ${type}: ${count}`));
    console.log('- defaultWorkflow:');
    (summary.defaultWorkflow || []).forEach(item => console.log(`  - ${item}`));
    if (summary.kbVersionStatus?.builtWithSkill) {
        console.log(`- builtWithSkill: ${summary.kbVersionStatus.builtWithSkill.name}@${summary.kbVersionStatus.builtWithSkill.version}`);
    }
    if (summary.kbVersionStatus?.stale) {
        console.log(`- staleKb: yes`);
        console.log(`- rebuild: ${summary.kbVersionStatus.recommendedAction}`);
    }
    console.log('- artifacts:');
    (summary.artifacts || [])
        .sort((left, right) => (left.priority || 99) - (right.priority || 99))
        .forEach(item => {
            console.log(`  - ${item.key}: ${item.file || '(none)'}`);
            console.log(`    purpose: ${item.purpose}`);
            console.log(`    useWhen: ${item.useWhen}`);
        });
    console.log('- examples:');
    summary.examples.forEach(example => console.log(`  - ${example}`));
}

function filterResolvedStart(resolved, graph, lookup, args = {}) {
    if (!hasNodeFilters(args)) {
        return resolved;
    }
    if (resolved?.ambiguous) {
        const nodes = resolved.ambiguous
            .map(candidate => resolveAmbiguousCandidateNode(graph, lookup, candidate))
            .filter(node => nodeMatchesQueryFilters(node, args));
        if (nodes.length === 1) {
            return { id: nodes[0].id };
        }
        if (nodes.length > 1) {
            return { ambiguous: nodes.map(node => `${node.type}:${node.name}`) };
        }
        return resolved;
    }
    if (resolved?.id) {
        const node = getOwnEntry(lookup.nodesById, resolved.id);
        if (node && !nodeMatchesQueryFilters(node, args)) {
            return { ambiguous: [] };
        }
    }
    return resolved;
}

function resolveTypedStart(graph, lookup, selectorType, query, args = {}) {
    const resolveNodeByType = (type, label) => {
        const exact = graph.nodes.filter(node => node.type === type && (node.name === query || node.id === query) && nodeMatchesQueryFilters(node, args));
        if (exact.length === 1) {
            return { id: exact[0].id };
        }
        if (exact.length > 1) {
            return { ambiguous: exact.map(node => `${node.type}:${node.name}`) };
        }
        const matches = findMatchingNodes(graph, query).filter(node => node.type === type && nodeMatchesQueryFilters(node, args));
        if (matches.length === 1) {
            return { id: matches[0].id };
        }
        if (matches.length > 1) {
            return { ambiguous: matches.map(node => `${node.type}:${node.name}`) };
        }
        throw new Error(`未找到 ${label}: ${query}`);
    };

    if (selectorType === 'method') {
        const method = resolveMethod(lookup, query);
        if (!method) {
            throw new Error(`未找到方法: ${query}`);
        }
        return filterResolvedStart(method, graph, lookup, args);
    }
    if (selectorType === 'event') {
        const event = getOwnEntry(lookup.events, query);
        if (!event) {
            throw new Error(`未找到事件: ${query}`);
        }
        return filterResolvedStart(event, graph, lookup, args);
    }
    if (selectorType === 'message') {
        const message = getOwnEntry(lookup.messages, query);
        if (!message) {
            throw new Error(`未找到消息: ${query}`);
        }
        return filterResolvedStart(message, graph, lookup, args);
    }
    if (selectorType === 'request') {
        const request = getOwnEntry(lookup.requests, query);
        if (!request) {
            return resolveNodeByType('request', 'request');
        }
        return filterResolvedStart(request, graph, lookup, args);
    }
    if (selectorType === 'endpoint') {
        const endpoint = getOwnEntry(lookup.endpoints, query);
        if (!endpoint) {
            return resolveNodeByType('endpoint', 'endpoint');
        }
        return filterResolvedStart(endpoint, graph, lookup, args);
    }
    if (selectorType === 'state') {
        const state = resolveState(lookup, query);
        if (!state) {
            throw new Error(`未找到 state: ${query}`);
        }
        return filterResolvedStart(state, graph, lookup, args);
    }

    const resolved = resolveNodeId(graph, lookup, query);
    if (!resolved) {
        throw new Error(`未找到节点: ${query}`);
    }
    return filterResolvedStart(typeof resolved === 'string' ? { id: resolved } : resolved, graph, lookup, args);
}

function resolveTraversalSpec(args, graph, lookup) {
    if (args.upstream) {
        return { direction: 'upstream', inputQuery: args.upstream, selectorType: 'node' };
    }
    if (args.downstream) {
        return { direction: 'downstream', inputQuery: args.downstream, selectorType: 'node' };
    }

    const typedSelectors = collectTypedSelectors(args);
    if (args.upstreamFlag || args.downstreamFlag) {
        if (typedSelectors.length > 1) {
            throw new Error('链路遍历模式下只支持一个 typed selector');
        }
        if (typedSelectors.length === 1) {
            const [selectorType, inputQuery] = typedSelectors[0];
            return {
                direction: args.upstreamFlag ? 'upstream' : 'downstream',
                inputQuery,
                selectorType,
            };
        }
        if (args.from) {
            return {
                direction: args.upstreamFlag ? 'upstream' : 'downstream',
                inputQuery: args.from,
                selectorType: 'node',
            };
        }
        throw new Error('未提供链路遍历起点。请传入 --upstream <query> / --downstream <query>，或结合 --method/--event/--request/--state 使用。');
    }

    if (args.from && args.direction) {
        return {
            direction: args.direction,
            inputQuery: args.from,
            selectorType: 'node',
        };
    }

    return null;
}

function run(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    const context = createWorkspaceContext({
        workspaceRoot: args.root || process.cwd(),
        dataRoot: args.dataRoot,
        layout: args.layout,
    });
    const { feature, graph, lookup } = loadFeatureLookup(context, args.feature);
    const kbVersionStatus = buildKbVersionStatus(graph, {
        root: context.workspaceRoot,
        config: loadFreshnessConfig(context.workspaceRoot, feature),
        recommendedAction: buildQueryRecommendedAction(feature.featureKey),
    });
    if (!args.json) {
        warnIfKbStale(kbVersionStatus);
    }

    const traversalSpec = resolveTraversalSpec(args, graph, lookup);
    if (traversalSpec) {
        const resolved = resolveTypedStart(graph, lookup, traversalSpec.selectorType, traversalSpec.inputQuery, args);
        if (resolved?.ambiguous) {
            printTraversal(
                withAmbiguousRecommendations(resolved, graph, lookup, {
                    featureKey: feature.featureKey,
                    query: traversalSpec.inputQuery,
                    direction: traversalSpec.direction,
                    workspaceRoot: context.workspaceRoot,
                    dataRoot: context.dataRoot,
                    layout: context.layout,
                }),
                args.json
            );
            return;
        }

        const startId = typeof resolved === 'string' ? resolved : resolved.id;
        const startNode = getOwnEntry(lookup.nodesById, startId);
        const depth = effectiveTraversalDepth(args);
        const shapedTraversal = shapeTraversalResult(
            traverse(lookup, startId, traversalSpec.direction, depth),
            lookup,
            startNode,
            args
        );
        const result = {
            inputQuery: traversalSpec.inputQuery,
            resolvedStart: startNode ? summarizeNode(startNode, lookup) : null,
            kbVersionStatus,
            kbFreshness: kbVersionStatus,
            node: startNode,
            direction: traversalSpec.direction,
            depth,
            mode: effectiveMode(args),
            focus: args.focus || '',
            traversal: shapedTraversal.traversal,
            relatedHelpers: shapedTraversal.relatedHelpers,
        };
        if (isDataAccessSummaryMode(args)) {
            result.dataAccessSummary = buildDataAccessSummary(shapedTraversal.dataTraversal, lookup);
        }
        printTraversal(result, args.json);
        return;
    }

    // 语义查询处理
    if (args.hasOperation || args.operationType || args.dataFlowFrom || args.dataFlowTo || args.minComplexity) {
        const results = performSemanticQuery(graph, lookup, args);
        printSemanticResults(results, args);
        return;
    }

    if (args.event) {
        const event = getOwnEntry(lookup.events, args.event);
        if (!event) {
            throw new Error(`未找到事件: ${args.event}`);
        }
        printDetailedResult(
            {
                type: 'event',
                name: args.event,
                bus: event.bus || '',
                kbVersionStatus,
                kbFreshness: kbVersionStatus,
                subscribers: event.subscribers || [],
                emitters: event.emitters || [],
                node: summarizeNode(getOwnEntry(lookup.nodesById, event.id), lookup),
            },
            args.json
        );
        return;
    }
    if (args.message) {
        const message = getOwnEntry(lookup.messages, args.message);
        if (!message) {
            printNotFoundResult(
                buildTypeAwareNotFoundResult(graph, feature.featureKey, 'message', args.message, {
                    workspaceRoot: context.workspaceRoot,
                    dataRoot: context.dataRoot,
                    layout: context.layout,
                }),
                args.json
            );
            return;
        }
        printDetailedResult(
            {
                type: 'message',
                name: args.message,
                protocol: message.protocol || '',
                confidence: message.confidence ?? null,
                kbVersionStatus,
                kbFreshness: kbVersionStatus,
                dispatchers: message.dispatchers || [],
                emitters: message.emitters || [],
                handlers: message.handlers || [],
                node: summarizeNode(getOwnEntry(lookup.nodesById, message.id), lookup),
            },
            args.json
        );
        return;
    }
    if (args.method) {
        const method = resolveMethod(lookup, args.method);
        if (!method) {
            throw new Error(`未找到方法: ${args.method}`);
        }
        if (method.ambiguous) {
            printSummary(
                withAmbiguousRecommendations(method, graph, lookup, {
                    featureKey: feature.featureKey,
                    query: args.method,
                    direction: 'downstream',
                    workspaceRoot: context.workspaceRoot,
                    dataRoot: context.dataRoot,
                    layout: context.layout,
                }),
                args.json
            );
            return;
        }
        printSummary(summarizeNode(getOwnEntry(lookup.nodesById, method.id), lookup), args.json);
        return;
    }
    if (args.request) {
        const request = resolveTypedStart(graph, lookup, 'request', args.request, args);
        if (request?.ambiguous) {
            printSummary(
                withAmbiguousRecommendations(request, graph, lookup, {
                    featureKey: feature.featureKey,
                    query: args.request,
                    direction: 'downstream',
                    workspaceRoot: context.workspaceRoot,
                    dataRoot: context.dataRoot,
                    layout: context.layout,
                }),
                args.json
            );
            return;
        }
        const requestNode = getOwnEntry(lookup.nodesById, request.id);
        const requestInfo = getOwnEntry(lookup.requests, requestNode?.name) || request;
        printDetailedResult(
            {
                type: 'request',
                name: requestNode?.name || args.request,
                callee: requestInfo.callee || '',
                kbVersionStatus,
                kbFreshness: kbVersionStatus,
                callers: requestInfo.callers || [],
                protocol: requestInfo.protocol || '',
                httpMethod: requestInfo.httpMethod || '',
                transport: requestInfo.transport || '',
                node: summarizeNode(requestNode, lookup),
            },
            args.json
        );
        return;
    }
    if (args.endpoint) {
        const endpoint = resolveTypedStart(graph, lookup, 'endpoint', args.endpoint, args);
        if (endpoint?.ambiguous) {
            printSummary(
                withAmbiguousRecommendations(endpoint, graph, lookup, {
                    featureKey: feature.featureKey,
                    query: args.endpoint,
                    direction: 'downstream',
                    workspaceRoot: context.workspaceRoot,
                    dataRoot: context.dataRoot,
                    layout: context.layout,
                }),
                args.json
            );
            return;
        }
        const endpointNode = getOwnEntry(lookup.nodesById, endpoint.id);
        const endpointInfo = getOwnEntry(lookup.endpoints, endpointNode?.name) || endpoint;
        printDetailedResult(
            {
                type: 'endpoint',
                name: endpointNode?.name || args.endpoint,
                httpMethod: endpointInfo.method || endpointNode?.meta?.method || '',
                httpPath: endpointInfo.path || endpointNode?.meta?.path || '',
                handlers: endpointInfo.handlers || [],
                kbVersionStatus,
                kbFreshness: kbVersionStatus,
                node: summarizeNode(endpointNode, lookup),
            },
            args.json
        );
        return;
    }
    if (args.state) {
        const state = resolveState(lookup, args.state);
        if (!state) {
            throw new Error(`未找到 state: ${args.state}`);
        }
        printDetailedResult(
            {
                type: 'state',
                name: args.state,
                kbVersionStatus,
                kbFreshness: kbVersionStatus,
                readers: state.readers || [],
                writers: state.writers || [],
                node: summarizeNode(getOwnEntry(lookup.nodesById, state.id), lookup),
            },
            args.json
        );
        return;
    }
    if (args.type === 'prefab-component') {
        printDetailedResult(buildPrefabComponentSummary(graph, args), args.json);
        return;
    }
    if (args.type === 'script-usage') {
        printDetailedResult(buildScriptUsageSummary(graph, args), args.json);
        return;
    }
    if (args.type === 'prefab-script-usage') {
        printDetailedResult(buildPrefabScriptUsageSummary(graph, args), args.json);
        return;
    }
    if (args.type || args.name || args.tag || args.file || args.hasHandler) {
        const results = searchNodes(graph, lookup, args);
        if (args.grouped) {
            printDetailedResult(buildGroupedSearchResults(results, args), args.json);
            return;
        }
        printSearchResults(results, args.json);
        return;
    }

    printFeatureSummary(buildFeatureSummary(feature, graph, lookup, context), args.json);
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
