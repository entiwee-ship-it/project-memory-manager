const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { prepareTaskContext } = require('../src/agent/context-pack');
const { recallTaskMemory } = require('../src/agent/memory-recall');
const { projectAgentOutput } = require('../src/agent/output-projection');
const { recordTaskOutcome } = require('../src/agent/execution-loop');
const { buildLookup } = require('../src/graph/build-chain-kb');
const { handleMcpRequest } = require('../src/mcp/server');
const { ensureDir, writeJsonAtomic } = require('../src/shared/common');
const { createWorkspaceContext } = require('../src/shared/workspace-layout');

function makeNode(id, type, name, file, line = 1, meta = {}) {
    return {
        id,
        type,
        name,
        file,
        line,
        area: file.startsWith('cms-client') || file.startsWith('xy-client') ? 'frontend' : 'backend',
        stack: ['typescript'],
        meta,
    };
}

function makeEdge(from, to, type = 'calls') {
    return {
        from,
        to,
        type,
        sourceKind: 'static',
        meta: {},
    };
}

function writeSourceFile(workspaceRoot, relativePath) {
    const filePath = path.join(workspaceRoot, relativePath);
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, `// ${relativePath}\n`, 'utf8');
}

function createMixedDomainFixture() {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-token-roi-workspace-'));
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-token-roi-data-'));
    const context = createWorkspaceContext({ workspaceRoot, dataRoot, layout: 'external-data' });
    fs.writeFileSync(path.join(workspaceRoot, 'package.json'), '{"scripts":{"test":"node --test"}}\n', 'utf8');

    const captchaNodes = [
        makeNode('captcha-request', 'request', 'GET /api/auth/captcha', 'cms-client/src/utils/api/modules/authApi.js', 18, { protocol: 'http' }),
        makeNode('captcha-view', 'method', 'Login.initCaptcha', 'cms-client/src/views/login/Login.vue', 24),
        makeNode('captcha-endpoint', 'endpoint', 'GET /api/auth/captcha', 'cms-server/src/routes/authRoutes.ts', 7, { method: 'GET', path: '/api/auth/captcha' }),
        makeNode('captcha-controller', 'method', 'authController.getCaptcha', 'cms-server/src/controllers/authController.ts', 13),
        makeNode('captcha-service', 'method', 'generateCaptcha', 'cms-server/src/services/captchaService.ts', 3),
    ];
    const loginNodes = [
        makeNode('login-view', 'method', 'LoginViewComp.loginGameServer', 'xy-client/assets/script/login/LoginViewComp.ts', 88),
        makeNode('login-session', 'method', 'GameSessionMgr.ensureLoggedIn', 'xy-client/assets/script/session/GameSessionMgr.ts', 42, { tags: ['session'] }),
        makeNode('login-pkcon', 'method', 'pkcon.handler.doLogin', 'qy-server/game-server/app/servers/connector/handler/pkconHandler.ts', 31, { tags: ['pinus', 'session'] }),
    ];
    const mahjongNodes = [
        makeNode('mj-base', 'method', 'MaJiangBaseView.onMJHu', 'xy-client/assets/script/game/mahjong/MaJiangBaseView.ts', 210),
        makeNode('mj-handler', 'method', 'ZhuanZhuanMJHandler.onMJHu', 'xy-client/assets/script/game/zhuanzhuan/ZhuanZhuanMJHandler.ts', 74),
        makeNode('mj-effect', 'method', 'ZhuanZhuanMJEffect.showHuPaiFanXingEffect', 'xy-client/assets/script/game/zhuanzhuan/ZhuanZhuanMJEffect.ts', 55),
        makeNode('mj-view', 'method', 'ZhuanZhuanMJViewComp.showHuPaiEffect', 'xy-client/assets/script/game/zhuanzhuan/ZhuanZhuanMJViewComp.ts', 101),
        makeNode('mj-model', 'method', 'MaJiangResult.getHuPaiType', 'xy-client/assets/script/game/mahjong/MaJiangResult.ts', 36),
    ];
    const noiseNodes = Array.from({ length: 10 }, (_, index) => makeNode(
        `activity-endpoint-${index}`,
        'endpoint',
        `DELETE /api/activity/game-${String(index).padStart(2, '0')}`,
        `cms-server/src/routes/activity/game${index}Routes.ts`,
        index + 1,
        { method: 'DELETE', path: `/api/activity/game-${index}`, tags: ['http', 'handler'] }
    ));
    noiseNodes.push(makeNode(
        'poker-effect',
        'method',
        'PokerEffect.showWinAnimation',
        'xy-client/assets/script/game/poker/PokerEffect.ts',
        18,
        { tags: ['animation', 'effect'] }
    ));

    const nodes = [...noiseNodes, ...captchaNodes, ...loginNodes, ...mahjongNodes];
    const edges = [
        makeEdge('captcha-view', 'captcha-request', 'requests'),
        makeEdge('captcha-request', 'captcha-endpoint', 'matches_endpoint'),
        makeEdge('captcha-endpoint', 'captcha-controller'),
        makeEdge('captcha-controller', 'captcha-service'),
        makeEdge('login-view', 'login-session'),
        makeEdge('login-session', 'login-pkcon', 'requests'),
        makeEdge('mj-handler', 'mj-base'),
        makeEdge('mj-base', 'mj-effect'),
        makeEdge('mj-effect', 'mj-view'),
        makeEdge('mj-view', 'mj-model'),
    ];
    const graph = {
        kind: 'chain-graph',
        featureKey: 'project-global',
        nodes,
        edges,
    };

    for (const node of nodes) {
        writeSourceFile(workspaceRoot, node.file);
    }
    ensureDir(context.paths.projectGlobalDir);
    ensureDir(context.paths.configsDir);
    writeJsonAtomic(path.join(context.paths.projectGlobalDir, 'chain.graph.json'), graph);
    writeJsonAtomic(path.join(context.paths.projectGlobalDir, 'chain.lookup.json'), buildLookup(graph));
    writeJsonAtomic(path.join(context.paths.configsDir, 'project-global.json'), {
        featureKey: 'project-global',
        methodRoots: ['cms-client/src', 'cms-server/src', 'xy-client/assets/script', 'qy-server/game-server/app'],
    });
    return { workspaceRoot, dataRoot };
}

function assertIncludesTop(files, expectedFiles, limit = 8) {
    const top = files.slice(0, limit);
    for (const expected of expectedFiles) {
        assert.ok(top.includes(expected), `expected top ${limit} files ${JSON.stringify(top)} to include ${expected}`);
    }
}

function testChineseTaskRanking(fixture) {
    const captcha = prepareTaskContext({
        ...fixture,
        task: '后台验证码链路',
        limit: 8,
    });
    assertIncludesTop(captcha.criticalFiles, [
        'cms-client/src/utils/api/modules/authApi.js',
        'cms-client/src/views/login/Login.vue',
        'cms-server/src/routes/authRoutes.ts',
        'cms-server/src/controllers/authController.ts',
        'cms-server/src/services/captchaService.ts',
    ]);

    const mahjong = prepareTaskContext({
        ...fixture,
        task: '转转麻将胡牌特效',
        limit: 8,
    });
    assertIncludesTop(mahjong.criticalFiles, [
        'xy-client/assets/script/game/mahjong/MaJiangBaseView.ts',
        'xy-client/assets/script/game/zhuanzhuan/ZhuanZhuanMJHandler.ts',
        'xy-client/assets/script/game/zhuanzhuan/ZhuanZhuanMJEffect.ts',
    ]);
    assert.equal(mahjong.criticalFiles.slice(0, 5).some(file => /poker/i.test(file)), false);

    const login = prepareTaskContext({
        ...fixture,
        task: '游戏登录会话绑定',
        limit: 8,
    });
    assertIncludesTop(login.criticalFiles, [
        'xy-client/assets/script/login/LoginViewComp.ts',
        'xy-client/assets/script/session/GameSessionMgr.ts',
        'qy-server/game-server/app/servers/connector/handler/pkconHandler.ts',
    ]);
}

function testMemoryRequiresSemanticMatch(fixture) {
    recordTaskOutcome({
        ...fixture,
        task: '修复后台验证码刷新链路',
        outcome: '验证码接口和登录页刷新已对齐',
        changedFiles: ['cms-server/src/services/captchaService.ts'],
        validation: ['npm run test:captcha'],
        observations: ['验证码任务需要复核前后端 auth 链路'],
        confidence: 'high',
    });
    recordTaskOutcome({
        ...fixture,
        task: '修复赠送活动大厅动画',
        outcome: '调整活动弹窗动画并同步登录页错误提示',
        changedFiles: ['cms-client/src/views/activity/GiftAnimation.vue'],
        validation: ['npm run test:activity.mjs', 'Playwright: no login redirect'],
        observations: ['验证动画调用和会话绑定行为，赠送活动只影响大厅 UI'],
        confidence: 'medium',
    });

    const result = recallTaskMemory({
        ...fixture,
        task: '后台验证码链路',
    });
    assert.equal(result.recalledTasks.length, 1);
    assert.equal(result.recalledTasks[0].task, '修复后台验证码刷新链路');
    assert.equal(result.recalledTasks[0].outcomeConfidence, 'high');
    assert.ok(['high', 'medium'].includes(result.recalledTasks[0].relevanceConfidence));
    assert.equal(Object.hasOwn(result.recalledTasks[0], 'confidence'), false);
}

function repeatedItems(count, prefix) {
    return Array.from({ length: count }, (_, index) => ({
        id: `${prefix}-${index}`,
        type: 'method',
        name: `${prefix}.method${index}`,
        file: `src/${prefix}/file-${index}.ts`,
        line: index + 1,
        area: 'backend',
        stack: ['typescript', 'nodejs'],
        meta: {
            tags: Array.from({ length: 20 }, (__, tagIndex) => `${prefix}-tag-${tagIndex}`),
            source: 'x'.repeat(500),
        },
    }));
}

function testCompactProjectionBudgets(fixture) {
    const nodes = repeatedItems(80, 'context');
    const contextPayload = {
        kind: 'agent-task-context',
        workspaceRoot: fixture.workspaceRoot,
        dataRoot: fixture.dataRoot,
        task: '后台验证码链路',
        taskUnderstanding: { extractedTerms: nodes.map(node => node.name) },
        relevantFeatures: nodes,
        keyEntrypoints: { endpoints: nodes, requests: nodes, methods: nodes },
        criticalFiles: nodes.map(node => node.file),
        callChains: nodes.map(node => ({ start: node, traversal: nodes })),
        dataAccess: { tables: nodes },
        externalServices: nodes,
        editBoundary: { primaryFiles: nodes.map(node => node.file), relatedRoots: nodes.map(node => node.file), guidance: nodes.map(node => node.name) },
        validation: { recommendedCommands: nodes.map(node => `node test-${node.id}.js`) },
        uncertainties: nodes.map(node => `${node.name}:${'u'.repeat(300)}`),
        evidence: nodes,
    };
    const compactContext = projectAgentOutput(contextPayload, {}, 'prepare_task_context');
    assert.ok(JSON.stringify(compactContext, null, 2).length <= 6000, `task context compact output exceeded budget: ${JSON.stringify(compactContext, null, 2).length}`);
    assert.equal(compactContext._output.detail, 'compact');

    const briefPayload = {
        kind: 'agent-brief',
        workspaceRoot: fixture.workspaceRoot,
        dataRoot: fixture.dataRoot,
        task: '后台验证码链路',
        preflight: { kind: 'agent-preflight', status: 'ready', health: { score: 100, checks: [] }, findings: [], repairPlan: [] },
        pmmGate: { decision: 'required', pmmRequired: true, deepPmmRequired: true, reasons: nodes.map(node => node.name) },
        executionPlan: {
            contextStatus: 'context-ready',
            targetFiles: nodes.map(node => node.file),
            editBoundary: { primaryFiles: nodes.map(node => node.file), relatedRoots: nodes.map(node => node.file), guidance: nodes.map(node => node.name) },
            steps: nodes.map(node => ({ step: node.name, action: node.meta.source, evidence: nodes })),
            validation: { recommendedCommands: nodes.map(node => `node test-${node.id}.js`) },
            uncertainties: nodes.map(node => node.meta.source),
        },
        memory: {
            queryTerms: nodes.map(node => node.name),
            recalledTasks: nodes.map(node => ({ task: node.name, outcome: node.meta.source, changedFiles: [node.file], observations: [node.meta.source] })),
            relatedFiles: nodes.map(node => ({ value: node.file })),
            validationCommands: nodes.map(node => ({ value: `node test-${node.id}.js` })),
            observations: nodes.map(node => node.meta.source),
            relevantRules: nodes,
        },
        recommendedFiles: nodes.map(node => node.file),
        validation: { recommendedCommands: nodes.map(node => `node test-${node.id}.js`) },
        risksAndNotes: nodes.map(node => node.meta.source),
        nextActions: nodes.map(node => node.name),
        evidence: nodes,
    };
    const compactBrief = projectAgentOutput(briefPayload, {}, 'prepare_agent_brief');
    assert.ok(JSON.stringify(compactBrief, null, 2).length <= 4000, `agent brief compact output exceeded budget: ${JSON.stringify(compactBrief, null, 2).length}`);

    const traversal = nodes.map((node, index) => ({
        direction: 'downstream',
        depth: (index % 4) + 1,
        edge: {
            type: 'calls',
            sourceKind: 'static',
            from: nodes[0].id,
            to: node.id,
            meta: { source: 'e'.repeat(400) },
        },
        node,
    }));
    const queryPayload = {
        inputQuery: 'context.method0',
        resolvedStart: nodes[0],
        node: nodes[0],
        direction: 'downstream',
        depth: 4,
        mode: 'fullstack',
        focus: 'fullstack',
        traversal,
        relatedHelpers: nodes,
        kbVersionStatus: { status: 'fresh', sourceSnapshot: { files: nodes } },
    };
    const compactQuery = projectAgentOutput(queryPayload, {}, 'query_project_chain');
    assert.ok(JSON.stringify(compactQuery, null, 2).length <= 6000, `query compact output exceeded budget: ${JSON.stringify(compactQuery, null, 2).length}`);
    assert.equal(Object.hasOwn(compactQuery, 'node'), false);
    assert.equal(Object.hasOwn(compactQuery.resolvedStart, 'meta'), false);
    assert.equal(compactQuery.resolvedStart.file, nodes[0].file);

    const compactExactNode = projectAgentOutput(nodes[0], {}, 'query_project_chain');
    assert.equal(compactExactNode.resolvedStart.name, nodes[0].name);
    assert.equal(compactExactNode.resolvedStart.file, nodes[0].file);

    const compactTraversal = projectAgentOutput({
        ...queryPayload,
        direction: 'upstream',
        traversal: traversal.map(item => ({ ...item, direction: '' })),
    }, {}, 'query_project_chain');
    assert.ok(compactTraversal.traversal.every(item => item.direction === 'upstream'));
    assert.equal(compactQuery.resolvedStart.line, nodes[0].line);

    const fullQuery = projectAgentOutput(queryPayload, { detail: 'full' }, 'query_project_chain');
    assert.equal(fullQuery.node.meta.source.length, 500);
    assert.equal(fullQuery.resolvedStart.meta.tags.length, 20);
    assert.equal(fullQuery._output.detail, 'full');
}

async function callTool(name, args) {
    const response = await handleMcpRequest({
        jsonrpc: '2.0',
        id: Math.floor(Math.random() * 100000),
        method: 'tools/call',
        params: { name, arguments: args },
    });
    assert.equal(response.result.content[0].type, 'text');
    return response.result.content[0].text;
}

async function testMcpAgentProjection(fixture) {
    const contextText = await callTool('prepare_task_context', {
        ...fixture,
        task: '后台验证码链路',
        freshnessPolicy: 'allow_stale',
    });
    const context = JSON.parse(contextText);
    assert.ok(contextText.length <= 6000, `MCP task context exceeded budget: ${contextText.length}`);
    assert.equal(context._output.detail, 'compact');
    assert.ok(context.criticalFiles.includes('cms-server/src/services/captchaService.ts'));

    const memoryText = await callTool('recall_task_memory', {
        ...fixture,
        task: '后台验证码链路',
    });
    const memory = JSON.parse(memoryText);
    assert.ok(memoryText.length <= 6000, `MCP memory recall exceeded budget: ${memoryText.length}`);
    assert.equal(memory._output.detail, 'compact');
    assert.equal(memory.recalledTasks[0].outcomeConfidence, 'high');
}

(async () => {
    const fixture = createMixedDomainFixture();
    testChineseTaskRanking(fixture);
    testMemoryRequiresSemanticMatch(fixture);
    testCompactProjectionBudgets(fixture);
    await testMcpAgentProjection(fixture);
    console.log('agent token efficiency validation passed');
})().catch(error => {
    console.error(error.stack || error.message);
    process.exit(1);
});
