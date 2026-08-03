const fs = require('fs');
const path = require('path');

const { recallTaskMemory } = require('./memory-recall');
const {
    buildBaseComponentMappings,
    inspectCocosPrefab,
} = require('../extraction/cocos/cocos-prefab-inspector');
const { loadSkillVersion } = require('../maintenance/show-version');
const { readJsonSafe } = require('../shared/common');
const { buildKbFreshnessStatus } = require('../shared/source-snapshot');
const { createWorkspaceContext } = require('../shared/workspace-layout');

const MAX_OVERLAY_CHANGED_FILES = 8;
const OVERLAY_ALLOWED_EXTENSIONS = new Set(['.prefab', '.scene', '.ts', '.tsx', '.js', '.jsx']);

function toPosix(value = '') {
    return String(value || '').replace(/\\/g, '/');
}

function workspaceRelativePath(workspaceRoot, filePath) {
    if (!String(filePath || '').trim()) {
        return '';
    }
    const relative = path.isAbsolute(filePath)
        ? path.relative(path.resolve(workspaceRoot), path.resolve(filePath))
        : filePath;
    return toPosix(relative).replace(/^\.\//, '').toLowerCase();
}

function graphForLiveInspection(graph, overlay, workspaceRoot) {
    if (!overlay.safe || !graph) {
        return null;
    }
    const changedPaths = new Set(
        overlay.changedFiles.map(file => workspaceRelativePath(workspaceRoot, file))
    );
    if (!changedPaths.size) {
        return graph;
    }
    return {
        ...graph,
        nodes: (graph.nodes || []).filter(node => !(
            node.type === 'component'
            && changedPaths.has(workspaceRelativePath(workspaceRoot, node.file))
        )),
    };
}

function currentSkillSummary() {
    try {
        const version = loadSkillVersion(path.resolve(__dirname, '..', '..'));
        return {
            name: version.name || '',
            version: version.version || '',
            repo: version.repo || '',
        };
    } catch {
        return null;
    }
}

function loadBaseCocosKb(options = {}) {
    const context = createWorkspaceContext({
        workspaceRoot: options.workspaceRoot,
        dataRoot: options.dataRoot,
        layout: options.layout || 'external-data',
    });
    const graphPath = path.join(context.paths.projectGlobalDir, 'chain.graph.json');
    const lookupPath = path.join(context.paths.projectGlobalDir, 'chain.lookup.json');
    const configPath = path.join(context.paths.configsDir, 'project-global.json');
    const graph = readJsonSafe(graphPath, { required: false, defaultValue: null });
    const hasLookup = fs.existsSync(lookupPath);
    const freshness = buildKbFreshnessStatus({
        root: context.workspaceRoot,
        graph: graph && hasLookup ? graph : null,
        config: readJsonSafe(configPath, { required: false, defaultValue: null }),
        currentSkill: currentSkillSummary(),
        recommendedAction: 'build_project_index',
    });
    return {
        context,
        graph,
        graphPath,
        lookupPath,
        configPath,
        freshness,
    };
}

function freshnessFilePaths(freshness, key) {
    return (Array.isArray(freshness?.[key]) ? freshness[key] : [])
        .map(item => typeof item === 'string' ? item : item?.path)
        .filter(Boolean)
        .map(toPosix);
}

function evaluateCocosOverlaySafety(freshness = {}) {
    const builtVersion = String(freshness.builtWithSkill?.version || '');
    const currentVersion = String(freshness.currentSkill?.version || '');
    const versionMatches = Boolean(builtVersion && currentVersion && builtVersion === currentVersion)
        && !(freshness.reasonCodes || []).includes('pmm-version-changed');
    if (freshness.status === 'fresh' && !freshness.stale) {
        if (!versionMatches) {
            return {
                safe: false,
                queryViewStatus: 'base_untrusted',
                reasons: ['源码快照虽未报告变化，但无法证明 KB 构建版本与当前 PMM 版本一致。'],
                changedFiles: [],
            };
        }
        return {
            safe: true,
            queryViewStatus: 'base_fresh_target_live',
            reasons: ['project-global KB fresh，目标 Cocos 资源仍使用实时只读解析结果。'],
            changedFiles: [],
        };
    }

    const counts = freshness.changeCounts || {};
    const addedFiles = freshnessFilePaths(freshness, 'addedFiles');
    const deletedFiles = freshnessFilePaths(freshness, 'deletedFiles');
    const changedFiles = freshnessFilePaths(freshness, 'changedFiles');
    const expectedCounts = {
        added: Number.isInteger(counts.added) ? counts.added : -1,
        deleted: Number.isInteger(counts.deleted) ? counts.deleted : -1,
        changed: Number.isInteger(counts.changed) ? counts.changed : -1,
    };
    const sampleComplete = expectedCounts.added === addedFiles.length
        && expectedCounts.deleted === deletedFiles.length
        && expectedCounts.changed === changedFiles.length;
    const onlyChangedExistingFiles = expectedCounts.added === 0 && expectedCounts.deleted === 0;
    const boundedChanges = expectedCounts.changed > 0 && expectedCounts.changed <= MAX_OVERLAY_CHANGED_FILES;
    const allowedFiles = changedFiles.every(file => OVERLAY_ALLOWED_EXTENSIONS.has(path.extname(file).toLowerCase()));
    const containsMeta = changedFiles.some(file => path.extname(file).toLowerCase() === '.meta');
    const reasons = [];
    if (!versionMatches) {
        reasons.push('无法证明 KB 构建版本与当前 PMM 版本一致。');
    }
    if (!sampleComplete) {
        reasons.push('freshness 变化样本被截断或计数不完整，不能安全判断 overlay 边界。');
    }
    if (!onlyChangedExistingFiles) {
        reasons.push('检测到新增或删除文件，必须重建 KB 后再依赖脚本映射。');
    }
    if (!boundedChanges) {
        reasons.push(`变化文件必须为 1-${MAX_OVERLAY_CHANGED_FILES} 个，当前为 ${expectedCounts.changed} 个。`);
    }
    if (!allowedFiles || containsMeta) {
        reasons.push('变化范围包含 overlay 白名单外文件或 .meta 文件。');
    }
    const safe = versionMatches
        && sampleComplete
        && onlyChangedExistingFiles
        && boundedChanges
        && allowedFiles
        && !containsMeta;
    return {
        safe,
        queryViewStatus: safe ? 'overlay_current' : 'overlay_unsafe',
        reasons: safe
            ? ['base KB 保留 stale 状态；目标 Cocos 资源由实时只读解析覆盖，脚本映射明确标记为 base KB 来源。']
            : reasons,
        changedFiles,
    };
}

function compactFreshness(freshness = {}, detail = 'compact') {
    if (detail === 'full') {
        return freshness;
    }
    return {
        status: freshness.status || 'unknown',
        stale: Boolean(freshness.stale),
        reasonCodes: freshness.reasonCodes || [],
        reasons: freshness.reasons || [],
        recommendedAction: freshness.recommendedAction || '',
        changeCounts: freshness.changeCounts || null,
        changedFiles: freshnessFilePaths(freshness, 'changedFiles'),
        addedFiles: freshnessFilePaths(freshness, 'addedFiles'),
        deletedFiles: freshnessFilePaths(freshness, 'deletedFiles'),
        builtWithSkill: freshness.builtWithSkill || null,
        currentSkill: freshness.currentSkill || null,
    };
}

function mappingMetadata(rawType, mappingByRawType) {
    if (/^(?:cc|sp|dragonBones)\./.test(String(rawType || ''))) {
        return {
            mappingSource: 'creator_serialized_type',
            requiresCreatorResolution: false,
        };
    }
    const mapping = mappingByRawType.get(String(rawType || ''));
    return {
        mappingSource: mapping?.source || 'live_prefab_unresolved',
        requiresCreatorResolution: Boolean(mapping?.requiresCreatorResolution ?? true),
    };
}

function projectEvent(event, mappingByRawType) {
    const metadata = mappingMetadata(event.targetComponentRawType, mappingByRawType);
    return {
        ...event,
        targetMappingSource: metadata.mappingSource,
        targetRequiresCreatorResolution: metadata.requiresCreatorResolution,
    };
}

function projectComponent(component, mappingByRawType) {
    return {
        ...component,
        ...mappingMetadata(component.rawType, mappingByRawType),
        events: (component.events || []).map(event => projectEvent(event, mappingByRawType)),
    };
}

function projectNode(node, mappingByRawType) {
    return {
        ...node,
        components: (node.components || []).map(component => projectComponent(component, mappingByRawType)),
    };
}

function compactNode(node) {
    return {
        path: node.path,
        active: node.active,
        components: (node.components || []).map(component => ({
            componentName: component.componentName,
            rawType: component.rawType,
            componentKind: component.componentKind,
            scriptPath: component.scriptPath,
            mappingSource: component.mappingSource,
            requiresCreatorResolution: component.requiresCreatorResolution,
            events: component.events,
        })),
    };
}

function projectLiveInspection(inspection, detail = 'compact', componentMappings = []) {
    const mappingByRawType = new Map(componentMappings.map(mapping => [mapping.rawType, mapping]));
    const projectedNodes = inspection.nodes.map(node => projectNode(node, mappingByRawType));
    const projectedComponents = inspection.components.map(component => projectComponent(component, mappingByRawType));
    const projectedEvents = inspection.events.map(event => projectEvent(event, mappingByRawType));
    const summary = {
        objectCount: inspection.objectCount,
        nodeCount: inspection.nodeCount,
        componentCount: inspection.componentCount,
        eventCount: inspection.eventCount,
        partial: Boolean(inspection.partial),
        unresolvedNestedPrefabCount: inspection.unresolvedNestedPrefabs?.length || 0,
    };
    if (detail === 'full') {
        return {
            summary,
            limitations: inspection.limitations || [],
            unresolvedNestedPrefabs: inspection.unresolvedNestedPrefabs || [],
            rootNodes: inspection.rootNodes,
            nodes: projectedNodes,
            components: projectedComponents,
            events: projectedEvents,
            nodeQueries: inspection.queryResults.map(result => ({
                ...result,
                matches: result.matches.map(node => projectNode(node, mappingByRawType)),
            })),
        };
    }
    const matchedPaths = new Set(
        inspection.queryResults.flatMap(result => result.matches || []).map(node => node.path)
    );
    const focusedComponents = projectedComponents.filter(component => (
        component.componentKind === 'custom-script'
        || component.events.length > 0
        || matchedPaths.has(component.nodePath)
    ));
    const rootPathSet = new Set(inspection.rootNodes || []);
    const focusedNodes = projectedNodes.filter(node => (
        rootPathSet.has(node.path)
        || matchedPaths.has(node.path)
        || node.components.some(component => component.componentKind === 'custom-script' || component.events.length > 0)
    ));
    return {
        summary,
        limitations: inspection.limitations || [],
        unresolvedNestedPrefabs: (inspection.unresolvedNestedPrefabs || []).slice(0, 20),
        rootNodes: inspection.rootNodes,
        focusedNodes: focusedNodes.slice(0, 40).map(compactNode),
        focusedComponents: focusedComponents.slice(0, 60).map(component => ({
            nodePath: component.nodePath,
            componentName: component.componentName,
            rawType: component.rawType,
            componentKind: component.componentKind,
            scriptPath: component.scriptPath,
            mappingSource: component.mappingSource,
            requiresCreatorResolution: component.requiresCreatorResolution,
            events: component.events,
        })),
        events: projectedEvents.slice(0, 40),
        nodeQueries: inspection.queryResults.map(result => ({
            query: result.query,
            status: result.status,
            scope: result.scope,
            requiresCreatorResolution: Boolean(result.requiresCreatorResolution),
            matches: result.matches.slice(0, 20).map(node => compactNode(projectNode(node, mappingByRawType))),
        })),
    };
}

function recallCocosHistory(options, recallFn) {
    try {
        const memory = recallFn({
            ...options,
            layout: options.layout || 'external-data',
            includeHistory: true,
            knownFiles: [
                ...(Array.isArray(options.knownFiles) ? options.knownFiles : []),
                options.prefab,
            ].filter(Boolean),
        });
        return {
            available: true,
            outcomes: memory.recalledTasks || [],
            observations: memory.observations || [],
            validationCommands: memory.validationCommands || [],
            playbookRules: memory.relevantRules || [],
        };
    } catch (error) {
        return {
            available: false,
            error: error instanceof Error ? error.message : String(error),
            outcomes: [],
            observations: [],
            validationCommands: [],
            playbookRules: [],
        };
    }
}

function prepareCocosEditBrief(options = {}, dependencies = {}) {
    if (!String(options.workspaceRoot || '').trim()) {
        throw new Error('prepare_cocos_edit_brief 需要 workspaceRoot');
    }
    if (!String(options.task || options.query || '').trim()) {
        throw new Error('prepare_cocos_edit_brief 需要 task 或 query');
    }
    if (!String(options.prefab || '').trim()) {
        throw new Error('prepare_cocos_edit_brief 需要 prefab');
    }
    const detail = options.detail === 'full' ? 'full' : 'compact';
    const loadBaseKb = dependencies.loadBaseKb || loadBaseCocosKb;
    const inspectPrefab = dependencies.inspectPrefab || inspectCocosPrefab;
    const recallMemory = dependencies.recallTaskMemory || recallTaskMemory;
    const base = loadBaseKb({
        ...options,
        layout: options.layout || 'external-data',
    });
    const nodeQueries = Array.isArray(options.nodeQueries)
        ? options.nodeQueries
        : (options.nodeQueries ? [options.nodeQueries] : []);
    const overlay = evaluateCocosOverlaySafety(base.freshness);
    const inspection = inspectPrefab({
        workspaceRoot: options.workspaceRoot,
        prefab: options.prefab,
        graph: graphForLiveInspection(base.graph, overlay, options.workspaceRoot),
        nodeQueries,
    });
    const mappingSource = base.freshness.status === 'fresh' && overlay.safe
        ? 'base_kb_fresh'
        : (overlay.safe ? 'base_kb_stale_overlay_target_live' : 'base_kb_untrusted');
    const overlayChangedPaths = new Set(
        overlay.changedFiles.map(file => workspaceRelativePath(options.workspaceRoot, file))
    );
    const baseComponentMappings = buildBaseComponentMappings(base.graph, inspection.filePath);
    const rawComponentMappings = inspection.componentMappings.map(mapping => {
        const baseMapping = baseComponentMappings.get(mapping.rawType);
        return {
            rawType: mapping.rawType,
            componentName: baseMapping?.componentName || mapping.componentName || mapping.rawType,
            scriptPath: baseMapping?.scriptPath || '',
            mapped: Boolean(baseMapping),
            fromTargetPrefab: Boolean(baseMapping?.exactPrefab),
        };
    });
    const componentMappings = rawComponentMappings.map(mapping => {
        const scriptPath = workspaceRelativePath(options.workspaceRoot, mapping.scriptPath);
        const changedMapping = Boolean(
            overlay.safe
            && base.freshness.status !== 'fresh'
            && scriptPath
            && overlayChangedPaths.has(scriptPath)
        );
        const requiresCreatorResolution = Boolean(
            !overlay.safe
            || !mapping.mapped
            || changedMapping
        );
        return {
            ...mapping,
            source: !mapping.mapped
                ? 'live_prefab_unresolved'
                : (!overlay.safe
                    ? 'base_kb_untrusted'
                    : (changedMapping
                        ? 'base_kb_stale_mapping_requires_creator_resolution'
                        : mappingSource)),
            requiresCreatorResolution,
        };
    });
    const mappingReadiness = !overlay.safe
        ? 'untrusted'
        : (inspection.partial || componentMappings.some(mapping => mapping.requiresCreatorResolution)
            ? 'creator_resolution_required'
            : 'usable_with_live_target');
    const history = recallCocosHistory({
        ...options,
        knownFiles: [
            ...(Array.isArray(options.knownFiles) ? options.knownFiles : []),
            inspection.relativePath,
        ],
    }, recallMemory);
    const readiness = overlay.safe ? 'ready' : 'blocked';

    return {
        kind: 'cocos-edit-brief',
        task: String(options.task || options.query || '').trim(),
        feature: String(options.feature || options.featureKey || 'project-global'),
        readiness,
        queryViewStatus: overlay.queryViewStatus,
        target: {
            prefabPath: inspection.filePath,
            relativePath: inspection.relativePath,
            assetUrl: inspection.assetUrl,
            sha256: inspection.sha256,
        },
        baseKb: {
            graphPath: toPosix(base.graphPath || ''),
            freshness: compactFreshness(base.freshness, detail),
            mappingSource,
            mappingReadiness,
            overlayReasons: overlay.reasons,
            overlayChangedFiles: overlay.changedFiles,
            componentMappings,
        },
        livePrefab: projectLiveInspection(inspection, detail, componentMappings),
        history,
        creatorWorkflow: {
            directFileWriteAllowed: false,
            writeAuthority: 'Cocos Creator Bridge/MCP only',
            steps: [
                'cocos_editor_list：按 workspaceRoot/projectPath 选择在线 Creator。',
                `cocos_asset_search + cocos_prefab_open：定位并打开 ${inspection.assetUrl || inspection.relativePath}。`,
                'cocos_hierarchy(rootPath/query/fields/summary) 与 cocos_node_read(fields/propertyPaths/summary)：现场确认节点、组件和现值。',
                '使用 cocos_node_set_transform、cocos_component_set_property 或 cocos_batch_write；batch 只接受 node.* / component.*，没有事务和回滚，失败后立即停。',
                '逐项检查 verification；任何 DIRECT_WRITE_VERIFY_FAILED 都不能视为已写入。',
            ],
        },
        previewValidation: {
            realDeviceOwner: 'user',
            steps: [
                'cocos_preview_launch 启动预览。',
                'cocos_runtime_run_scenario 使用 instantiate-prefab/wait/assert/capture，并用 stop(always:true) 清理 Preview。',
                'cocos_runtime_capture 按目标分辨率截图，视觉结果作为辅助证据。',
            ],
        },
        nextActions: readiness === 'ready'
            ? [
                '按 Creator MCP 主流程读取目标节点后再写入，禁止直接编辑 .prefab/.scene/.meta。',
                ...(mappingReadiness === 'creator_resolution_required'
                    ? ['目标包含 stale/未知组件映射或未展开的嵌套 Prefab；必须用 Creator 现场解析节点与组件身份，不能仅依赖离线序列化结果。']
                    : []),
                '完成后重读 hierarchy/node 属性并执行 Preview 验证。',
            ]
            : [
                '当前 overlay 安全门禁未通过；先按 baseKb.freshness.recommendedAction 重建 project-global KB。',
                '即使 livePrefab 可读，也不要把不可信的 base KB 脚本映射当成当前事实。',
            ],
        _output: {
            detail,
            directFileWriteAllowed: false,
        },
    };
}

module.exports = {
    evaluateCocosOverlaySafety,
    loadBaseCocosKb,
    prepareCocosEditBrief,
};
