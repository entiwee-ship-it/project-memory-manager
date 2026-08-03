const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    evaluateCocosOverlaySafety,
    prepareCocosEditBrief,
} = require('../src/agent/cocos-edit-brief');
const {
    inspectCocosPrefab,
    resolveCocosAssetPath,
} = require('../src/extraction/cocos/cocos-prefab-inspector');
const { handleMcpRequest } = require('../src/mcp/server');
const skillVersion = require('../skill-version.json');

const workspaceRoot = path.join(__dirname, 'fixtures', 'cocos-prefab-sample');
const sampleGraph = {
    nodes: [
        {
            type: 'component',
            name: 'SampleView@RootPanel',
            file: path.join(workspaceRoot, 'assets', 'script', 'ui', 'SampleView.ts'),
            meta: {
                rawType: '11111111-1111-1111-1111-111111111111',
                prefabPath: path.join(workspaceRoot, 'assets', 'ui', 'prefabs', 'SamplePanel.prefab'),
                nodePath: 'RootPanel',
            },
        },
    ],
};

function freshState() {
    return {
        status: 'fresh',
        stale: false,
        reasonCodes: [],
        changeCounts: { added: 0, deleted: 0, changed: 0, mtimeOnly: 0 },
        addedFiles: [],
        deletedFiles: [],
        changedFiles: [],
        builtWithSkill: { name: 'project-memory-manager', version: skillVersion.version },
        currentSkill: { name: 'project-memory-manager', version: skillVersion.version },
    };
}

function staleOverlayState() {
    return {
        ...freshState(),
        status: 'stale',
        stale: true,
        reasonCodes: ['source-files-changed'],
        changeCounts: { added: 0, deleted: 0, changed: 2, mtimeOnly: 1 },
        changedFiles: [
            { path: 'assets/ui/prefabs/SamplePanel.prefab' },
            { path: 'assets/script/ui/SampleView.ts' },
        ],
    };
}

function testLivePrefabInspection() {
    const result = inspectCocosPrefab({
        workspaceRoot,
        prefab: 'SamplePanel',
        graph: sampleGraph,
        nodeQueries: ['StartButton', 'RootPanel', 'MissingNode'],
    });
    assert.equal(result.kind, 'cocos-prefab-live-inspection');
    assert.equal(result.assetUrl, 'db://assets/ui/prefabs/SamplePanel.prefab');
    assert.equal(result.nodeCount, 4);
    assert.ok(result.rootNodes.includes('RootPanel'));
    assert.ok(result.componentMappings.some(mapping => mapping.componentName === 'SampleView' && mapping.mapped));
    assert.ok(result.events.some(event => event.handler === 'onClickStart'));
    assert.equal(result.queryResults.find(item => item.query === 'StartButton').status, 'matched');
    assert.equal(result.queryResults.find(item => item.query === 'RootPanel').matches.length, 1);
    assert.equal(result.queryResults.find(item => item.query === 'MissingNode').status, 'not_found');
}

function testAssetNameLookupBeyondFirstTwoHundredAssets() {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-cocos-assets-'));
    try {
        const assetsRoot = path.join(tempRoot, 'assets', 'prefabs');
        fs.mkdirSync(assetsRoot, { recursive: true });
        for (let index = 0; index < 220; index += 1) {
            fs.writeFileSync(path.join(assetsRoot, `Asset${String(index).padStart(3, '0')}.prefab`), '[]');
        }
        const targetPath = path.join(assetsRoot, 'ZTargetPanel.prefab');
        fs.writeFileSync(targetPath, '[]');
        assert.equal(resolveCocosAssetPath(tempRoot, 'ZTargetPanel'), targetPath);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}

function testCreatorAssetMustStayUnderAssetsRoot() {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-cocos-boundary-'));
    try {
        fs.mkdirSync(path.join(tempRoot, 'assets'), { recursive: true });
        const outside = path.join(tempRoot, 'Outside.prefab');
        fs.writeFileSync(outside, '[]');
        for (const query of [outside, 'assets/../Outside.prefab']) {
            assert.throws(
                () => resolveCocosAssetPath(tempRoot, query),
                error => error?.code === 'COCOS_ASSET_OUTSIDE_ASSETS'
            );
        }
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}

function testOverlaySafety() {
    assert.equal(evaluateCocosOverlaySafety(freshState()).queryViewStatus, 'base_fresh_target_live');

    const safe = evaluateCocosOverlaySafety(staleOverlayState());
    assert.equal(safe.safe, true);
    assert.equal(safe.queryViewStatus, 'overlay_current');

    const truncated = staleOverlayState();
    truncated.changeCounts.changed = 3;
    assert.equal(evaluateCocosOverlaySafety(truncated).queryViewStatus, 'overlay_unsafe');

    const metaChanged = staleOverlayState();
    metaChanged.changeCounts.changed = 1;
    metaChanged.changedFiles = [{ path: 'assets/ui/prefabs/SamplePanel.prefab.meta' }];
    assert.equal(evaluateCocosOverlaySafety(metaChanged).queryViewStatus, 'overlay_unsafe');

    const versionChanged = staleOverlayState();
    versionChanged.currentSkill = { name: 'project-memory-manager', version: '0.85.0' };
    versionChanged.reasonCodes.push('pmm-version-changed');
    assert.equal(evaluateCocosOverlaySafety(versionChanged).queryViewStatus, 'overlay_unsafe');

    const missingBuiltVersion = freshState();
    delete missingBuiltVersion.builtWithSkill;
    const untrustedFresh = evaluateCocosOverlaySafety(missingBuiltVersion);
    assert.equal(untrustedFresh.safe, false);
    assert.equal(untrustedFresh.queryViewStatus, 'base_untrusted');

    const missingCurrentVersion = freshState();
    delete missingCurrentVersion.currentSkill;
    assert.equal(evaluateCocosOverlaySafety(missingCurrentVersion).queryViewStatus, 'base_untrusted');
}

function testNestedPrefabRequiresCreatorResolution() {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-cocos-nested-'));
    try {
        const prefabPath = path.join(tempRoot, 'assets', 'ui', 'NestedHost.prefab');
        fs.mkdirSync(path.dirname(prefabPath), { recursive: true });
        fs.writeFileSync(prefabPath, JSON.stringify([
            { __type__: 'cc.Prefab', data: { __id__: 1 } },
            { __type__: 'cc.Node', _name: 'Root', _children: [{ __id__: 2 }], _components: [] },
            { __type__: 'cc.Node', _parent: { __id__: 1 }, _prefab: { __id__: 3 } },
            {
                __type__: 'cc.PrefabInfo',
                root: { __id__: 2 },
                asset: { __uuid__: 'nested-prefab-uuid', __expectedType__: 'cc.Prefab' },
                fileId: 'nested-root-file-id',
                instance: { __id__: 4 },
                targetOverrides: null,
            },
            {
                __type__: 'cc.PrefabInstance',
                fileId: 'nested-instance-file-id',
                prefabRootNode: { __id__: 1 },
                mountedChildren: [],
                mountedComponents: [],
                propertyOverrides: [{ __id__: 5 }],
                removedComponents: [],
                removedNodes: [],
            },
            { __type__: 'cc.TargetOverrideInfo', source: null, sourceInfo: null, propertyPath: ['_active'], target: null },
        ]));

        const inspection = inspectCocosPrefab({
            workspaceRoot: tempRoot,
            prefab: 'NestedHost',
            graph: { nodes: [] },
            nodeQueries: ['DeepButton'],
        });
        assert.equal(inspection.partial, true);
        assert.equal(inspection.unresolvedNestedPrefabs.length, 1);
        assert.equal(inspection.unresolvedNestedPrefabs[0].prefabAssetUuid, 'nested-prefab-uuid');
        assert.equal(inspection.queryResults[0].status, 'creator_resolution_required');
        assert.equal(inspection.queryResults[0].requiresCreatorResolution, true);

        const brief = prepareCocosEditBrief({
            workspaceRoot: tempRoot,
            task: '检查嵌套 Prefab 内节点',
            prefab: 'NestedHost',
            nodeQueries: ['DeepButton'],
        }, {
            loadBaseKb: () => ({
                graph: { nodes: [] },
                graphPath: 'memory/chain.graph.json',
                freshness: freshState(),
            }),
            recallTaskMemory: () => ({}),
        });
        assert.equal(brief.readiness, 'ready');
        assert.equal(brief.baseKb.mappingReadiness, 'creator_resolution_required');
        assert.equal(brief.livePrefab.summary.partial, true);
        assert.ok(brief.nextActions.some(action => action.includes('未展开的嵌套 Prefab')));
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}

function testPreparedBrief() {
    let recalledWith = null;
    const brief = prepareCocosEditBrief({
        workspaceRoot,
        dataRoot: path.join(os.tmpdir(), 'pmm-cocos-edit-brief-unused'),
        task: '调整 SamplePanel 的按钮事件',
        prefab: 'SamplePanel',
        nodeQueries: ['StartButton'],
        knownFiles: ['assets/script/ui/SampleView.ts'],
        detail: 'compact',
    }, {
        loadBaseKb: () => ({
            graph: sampleGraph,
            graphPath: 'memory/chain.graph.json',
            freshness: staleOverlayState(),
        }),
        recallTaskMemory: (options) => {
            recalledWith = options;
            return {
            recalledTasks: [{ task: '历史按钮调整' }],
            observations: ['只允许 Creator 写资源'],
            validationCommands: ['preview'],
            relevantRules: [{ title: 'Creator only' }],
            };
        },
    });
    assert.equal(brief.kind, 'cocos-edit-brief');
    assert.equal(brief.readiness, 'ready');
    assert.equal(brief.queryViewStatus, 'overlay_current');
    assert.equal(brief.target.assetUrl, 'db://assets/ui/prefabs/SamplePanel.prefab');
    assert.equal(brief.creatorWorkflow.directFileWriteAllowed, false);
    assert.equal(brief._output.directFileWriteAllowed, false);
    assert.equal(brief.history.outcomes[0].task, '历史按钮调整');
    assert.equal(brief.baseKb.mappingReadiness, 'creator_resolution_required');
    assert.ok(brief.baseKb.componentMappings.some(mapping => (
        mapping.source === 'base_kb_stale_mapping_requires_creator_resolution'
        && mapping.requiresCreatorResolution
    )));
    assert.ok(brief.nextActions.some(action => action.includes('Creator 现场解析节点与组件身份')));
    const liveCustomComponent = brief.livePrefab.focusedComponents.find(component => (
        component.rawType === '11111111-1111-1111-1111-111111111111'
    ));
    assert.equal(liveCustomComponent.componentName, '11111111-1111-1111-1111-111111111111');
    assert.equal(liveCustomComponent.scriptPath, '');
    assert.equal(liveCustomComponent.mappingSource, 'base_kb_stale_mapping_requires_creator_resolution');
    assert.equal(liveCustomComponent.requiresCreatorResolution, true);
    assert.ok(recalledWith.knownFiles.includes('assets/script/ui/SampleView.ts'));
    assert.ok(recalledWith.knownFiles.includes('assets/ui/prefabs/SamplePanel.prefab'));

    const prefabOnlyFreshness = staleOverlayState();
    prefabOnlyFreshness.changeCounts.changed = 1;
    prefabOnlyFreshness.changedFiles = [{ path: 'assets/ui/prefabs/SamplePanel.prefab' }];
    const unresolved = prepareCocosEditBrief({
        workspaceRoot,
        task: '检查未知自定义组件',
        prefab: 'SamplePanel',
    }, {
        loadBaseKb: () => ({
            graph: { nodes: [] },
            graphPath: 'memory/chain.graph.json',
            freshness: prefabOnlyFreshness,
        }),
        recallTaskMemory: () => ({}),
    });
    assert.equal(unresolved.baseKb.mappingReadiness, 'creator_resolution_required');
    assert.ok(unresolved.baseKb.componentMappings.some(mapping => (
        !mapping.mapped
        && mapping.source === 'live_prefab_unresolved'
        && mapping.requiresCreatorResolution
    )));

    const wrongGraph = {
        nodes: [{
            type: 'component',
            name: 'InjectedOldName@RootPanel',
            file: path.join(workspaceRoot, 'assets', 'script', 'ui', 'OldWrong.ts'),
            meta: {
                rawType: '11111111-1111-1111-1111-111111111111',
                prefabPath: path.join(workspaceRoot, 'assets', 'ui', 'prefabs', 'SamplePanel.prefab'),
            },
        }],
    };
    const blocked = prepareCocosEditBrief({
        workspaceRoot,
        task: '验证不可信映射隔离',
        prefab: 'SamplePanel',
    }, {
        loadBaseKb: () => ({
            graph: wrongGraph,
            graphPath: 'memory/chain.graph.json',
            freshness: {
                ...freshState(),
                status: 'missing',
                stale: true,
                changeCounts: { added: 0, deleted: 0, changed: 0 },
            },
        }),
        recallTaskMemory: () => ({}),
    });
    assert.equal(blocked.readiness, 'blocked');
    assert.equal(blocked.baseKb.mappingReadiness, 'untrusted');
    assert.ok(blocked.baseKb.componentMappings.some(mapping => (
        mapping.componentName === 'InjectedOldName'
        && mapping.source === 'base_kb_untrusted'
        && mapping.requiresCreatorResolution
    )));
    assert.equal(JSON.stringify(blocked.livePrefab).includes('InjectedOldName'), false);
    assert.equal(JSON.stringify(blocked.livePrefab).includes('OldWrong.ts'), false);
}

function testPublishedCocosBriefDocs() {
    for (const relativePath of ['SKILL.md', 'README.md', 'docs/reference/mcp-tools.md']) {
        const content = fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
        assert.ok(content.includes('prepare_cocos_edit_brief'), `${relativePath} 应公开 Cocos live brief`);
    }
}

function parseTextResult(response) {
    assert.ok(response.result);
    assert.equal(response.result.content[0].type, 'text');
    return JSON.parse(response.result.content[0].text);
}

async function testMcpTool() {
    const list = await handleMcpRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
    });
    const tool = list.result.tools.find(item => item.name === 'prepare_cocos_edit_brief');
    assert.ok(tool);
    assert.deepEqual(tool.inputSchema.required, ['workspaceRoot', 'prefab']);
    assert.deepEqual(tool.inputSchema.anyOf, [
        { required: ['task'] },
        { required: ['query'] },
    ]);

    const response = await handleMcpRequest({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
            name: 'prepare_cocos_edit_brief',
            arguments: {
                workspaceRoot,
                dataRoot: path.join(os.tmpdir(), `pmm-cocos-edit-brief-missing-${process.pid}`),
                query: '检查 SamplePanel 当前结构',
                prefab: 'SamplePanel',
                nodeQueries: ['StartButton'],
            },
        },
    });
    const brief = parseTextResult(response);
    assert.equal(brief.kind, 'cocos-edit-brief');
    assert.equal(brief.queryViewStatus, 'overlay_unsafe');
    assert.equal(brief.target.assetUrl, 'db://assets/ui/prefabs/SamplePanel.prefab');
    assert.equal(brief.creatorWorkflow.directFileWriteAllowed, false);
}

(async () => {
    testLivePrefabInspection();
    testAssetNameLookupBeyondFirstTwoHundredAssets();
    testCreatorAssetMustStayUnderAssetsRoot();
    testOverlaySafety();
    testNestedPrefabRequiresCreatorResolution();
    testPreparedBrief();
    testPublishedCocosBriefDocs();
    await testMcpTool();
    console.log('cocos-edit-brief validation passed');
})().catch(error => {
    console.error(error.stack || error.message);
    process.exit(1);
});
