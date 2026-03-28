#!/usr/bin/env node

const path = require('path');
const { resolveProjectRoot, readJson } = require('./lib/common');
const { normalizeFeatureRecord } = require('./lib/feature-kb');
const {
    buildAuthoringProfile,
    isBuiltWithCurrentSkill,
    loadFeatureArtifacts,
    loadFeatureAuthoringProfile,
    loadProjectAuthoringProfile,
    planClickEvent,
    planFieldBinding,
} = require('./lib/cocos-authoring');
const { applyClickEventChange, applyFieldBindingChange } = require('./lib/cocos-authoring-apply');
const { run: buildChainKb } = require('./build_chain_kb');
const { run: buildCocosAuthoringProfile } = require('./build_cocos_authoring_profile');

function parseArgs(argv) {
    const args = {
        root: '',
        feature: '',
        prefab: '',
        intent: '',
        sourceNode: '',
        targetNode: '',
        targetComponent: '',
        componentNode: '',
        component: '',
        handler: '',
        field: '',
        targetAsset: '',
        apply: false,
        json: false,
    };

    for (let index = 0; index < argv.length; index++) {
        const token = argv[index];
        if (token === '--root') {
            args.root = argv[++index] || '';
            continue;
        }
        if (token === '--feature') {
            args.feature = argv[++index] || '';
            continue;
        }
        if (token === '--prefab') {
            args.prefab = argv[++index] || '';
            continue;
        }
        if (token === '--intent') {
            args.intent = argv[++index] || '';
            continue;
        }
        if (token === '--source-node') {
            args.sourceNode = argv[++index] || '';
            continue;
        }
        if (token === '--target-node') {
            args.targetNode = argv[++index] || '';
            continue;
        }
        if (token === '--target-component') {
            args.targetComponent = argv[++index] || '';
            continue;
        }
        if (token === '--component-node') {
            args.componentNode = argv[++index] || '';
            continue;
        }
        if (token === '--component') {
            args.component = argv[++index] || '';
            continue;
        }
        if (token === '--handler') {
            args.handler = argv[++index] || '';
            continue;
        }
        if (token === '--field') {
            args.field = argv[++index] || '';
            continue;
        }
        if (token === '--target-asset') {
            args.targetAsset = argv[++index] || '';
            continue;
        }
        if (token === '--apply') {
            args.apply = true;
            continue;
        }
        if (token === '--json') {
            args.json = true;
        }
    }

    if (!args.feature) {
        throw new Error('用法: node cocos_authoring.js --feature <key> --prefab <prefab> --intent <profile|click-event|field-binding> ... [--apply] [--json]');
    }
    if (!args.intent) {
        throw new Error('--intent 必填，支持 profile / click-event / field-binding');
    }
    if (!['profile', 'click-event', 'field-binding'].includes(args.intent)) {
        throw new Error(`不支持的 intent: ${args.intent}`);
    }

    return args;
}

function getFeatureRecord(root, featureKey) {
    const registryPath = path.join(root, 'project-memory', 'state', 'feature-registry.json');
    const registry = readJson(registryPath);
    const featureRecord = (registry.features || [])
        .map(item => normalizeFeatureRecord(item))
        .find(item => item.featureKey === featureKey);
    if (!featureRecord) {
        throw new Error(`注册表中未找到功能: ${featureKey}`);
    }
    return featureRecord;
}

function buildFeatureRebuildCommand(featureRecord) {
    if (!featureRecord?.configPath) {
        return '';
    }
    return `node scripts/build_chain_kb.js --root <project-root> --config ${featureRecord.configPath}`;
}

function runQuietly(fn, argv) {
    const originalLog = console.log;
    const originalWarn = console.warn;
    try {
        console.log = () => {};
        console.warn = () => {};
        return fn(argv);
    } finally {
        console.log = originalLog;
        console.warn = originalWarn;
    }
}

function ensureFeatureFresh(root, featureKey, autoActions = []) {
    const featureRecord = getFeatureRecord(root, featureKey);
    const outputs = featureRecord.outputs || {};
    const scanPath = path.resolve(root, outputs.scan || '');
    const graphPath = path.resolve(root, outputs.graph || '');
    const lookupPath = path.resolve(root, outputs.lookup || '');
    const missing = [scanPath, graphPath, lookupPath].some(filePath => !filePath || !require('fs').existsSync(filePath));
    let stale = false;

    if (!missing) {
        try {
            const graph = readJson(graphPath);
            stale = !isBuiltWithCurrentSkill(graph);
        } catch {
            stale = true;
        }
    }

    if (!missing && !stale) {
        return featureRecord;
    }

    if (!featureRecord.configPath) {
        throw new Error(
            `功能 KB 缺失或过期，但 registry 中没有 configPath: ${featureKey}\n`
            + `请先手动执行 ${buildFeatureRebuildCommand(featureRecord) || 'node scripts/build_chain_kb.js --root <project-root> --config <config-path>'}`
        );
    }

    runQuietly(buildChainKb, ['--root', root, '--config', path.resolve(root, featureRecord.configPath)]);
    autoActions.push(`auto-rebuilt feature KB: ${featureKey}`);
    return getFeatureRecord(root, featureKey);
}

function ensureAuthoringProfileFresh(root, featureKey, autoActions = []) {
    const profile = loadProjectAuthoringProfile(root);
    const featureProfile = profile?.features?.[featureKey] || null;
    const stale = !profile || !featureProfile || !isBuiltWithCurrentSkill(profile);
    if (!stale) {
        return profile;
    }

    runQuietly(buildCocosAuthoringProfile, ['--root', root, '--feature', featureKey]);
    autoActions.push(`auto-rebuilt cocos authoring profile: ${featureKey}`);
    return loadProjectAuthoringProfile(root);
}

function summarizeProfile(profile, featureProfile) {
    return {
        intent: 'profile',
        ...profile,
        learnedPatterns: {
            eventPatterns: featureProfile?.eventPatterns || [],
            componentPlacementPatterns: featureProfile?.componentPlacementPatterns || [],
            fieldBindingPatterns: featureProfile?.fieldBindingPatterns || [],
            assetPatterns: featureProfile?.assetPatterns || [],
        },
    };
}

function printAutoActions(autoActions) {
    if (!autoActions.length) {
        return;
    }
    console.log('- autoRefresh:');
    autoActions.forEach(item => console.log(`  - ${item}`));
}

function printProfile(result) {
    console.log(`intent: ${result.intent}`);
    console.log(`feature: ${result.feature.featureKey} (${result.feature.featureName})`);
    console.log(`prefab: ${result.prefab.prefabName}`);
    printAutoActions(result.autoActions || []);
    console.log('- nodes:');
    (result.nodes || []).forEach(node => {
        const suffix = (node.components || []).length > 0 ? ` [${node.components.join(', ')}]` : '';
        console.log(`  - ${node.path}${suffix}`);
    });
    console.log('- customComponents:');
    (result.customComponents || []).forEach(component => {
        console.log(`  - ${component.componentName}@${component.nodePath}`);
        (component.bindableFields || []).forEach(field => {
            console.log(`    field: ${field.fieldName} (${field.bindingKind}:${field.rawType})`);
        });
    });
    console.log('- learnedPatterns:');
    console.log(`  - eventPatterns: ${(result.learnedPatterns?.eventPatterns || []).length}`);
    console.log(`  - componentPlacementPatterns: ${(result.learnedPatterns?.componentPlacementPatterns || []).length}`);
    console.log(`  - fieldBindingPatterns: ${(result.learnedPatterns?.fieldBindingPatterns || []).length}`);
    console.log(`  - assetPatterns: ${(result.learnedPatterns?.assetPatterns || []).length}`);
}

function printPlan(result) {
    console.log(`intent: ${result.intent}`);
    console.log(`feature: ${result.feature.featureKey} (${result.feature.featureName})`);
    console.log(`prefab: ${result.prefab.prefabName}`);
    printAutoActions(result.autoActions || []);
    if (result.sourceNodePath) {
        console.log(`sourceNode: ${result.sourceNodePath}`);
    }
    if (result.targetNodePath) {
        console.log(`targetNode: ${result.targetNodePath}`);
    }
    if (result.targetComponentName) {
        console.log(`targetComponent: ${result.targetComponentName}`);
    }
    if (result.handlerName) {
        console.log(`handler: ${result.handlerName}`);
    }
    if (result.field) {
        console.log(`field: ${result.field.fieldName} (${result.field.bindingKind}:${result.field.rawType})`);
    }
    if (result.applyResult?.changes?.length) {
        console.log('- appliedChanges:');
        result.applyResult.changes.forEach(change => {
            console.log(`  - ${change.action}: ${change.file}`);
        });
    }
    console.log('- steps:');
    (result.changes || []).forEach((change, index) => {
        const target = [
            change.nodePath || '',
            change.componentName || '',
            change.handlerName || '',
            change.field || '',
            change.targetNodePath || '',
            change.targetComponentName || '',
            change.targetAsset?.name || '',
        ].filter(Boolean).join(' | ');
        console.log(`  ${index + 1}. [${change.status}] ${change.kind}${target ? `: ${target}` : ''}`);
        console.log(`     改动位置: ${change.editTarget} via ${change.applyVia}`);
        console.log(`     原因: ${change.why}`);
    });
}

function runIntent(args, artifacts, featureProfile) {
    const commonOptions = {
        prefab: args.prefab,
        authoringFeatureProfile: featureProfile,
    };

    if (args.intent === 'profile') {
        return summarizeProfile(buildAuthoringProfile(artifacts, commonOptions), featureProfile);
    }
    if (args.intent === 'click-event') {
        if (!args.sourceNode || !args.targetComponent || !args.handler) {
            throw new Error('click-event 至少需要 --source-node --target-component --handler');
        }
        return planClickEvent(artifacts, {
            ...commonOptions,
            node: args.sourceNode,
            targetNode: args.targetNode,
            component: args.targetComponent,
            handler: args.handler,
        });
    }
    if (!args.componentNode || !args.component || !args.field) {
        throw new Error('field-binding 至少需要 --component-node --component --field');
    }
    if (!args.targetNode && !args.targetComponent && !args.targetAsset) {
        throw new Error('field-binding 需要 --target-node / --target-component / --target-asset 其中之一');
    }
    return planFieldBinding(artifacts, {
        ...commonOptions,
        node: args.componentNode,
        component: args.component,
        field: args.field,
        targetNode: args.targetNode,
        targetComponent: args.targetComponent,
        targetAsset: args.targetAsset,
    });
}

function applyIntent(args, root, artifacts, result) {
    if (args.intent === 'click-event') {
        return applyClickEventChange({
            artifacts,
            plan: result,
            sourceNodePath: args.sourceNode,
            targetNodePath: result.targetNodePath,
            componentName: result.targetComponentName,
            handlerName: result.handlerName,
        });
    }
    if (args.intent === 'field-binding') {
        return applyFieldBindingChange({
            artifacts,
            plan: result,
            componentNodePath: result.componentNodePath,
            componentName: result.componentName,
            fieldName: result.field.fieldName,
            targetNode: args.targetNode,
            targetComponent: args.targetComponent,
            targetAsset: args.targetAsset,
        });
    }
    throw new Error('profile 模式不支持 --apply');
}

function run(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    const root = resolveProjectRoot(args.root || process.cwd());
    const autoActions = [];

    ensureFeatureFresh(root, args.feature, autoActions);
    ensureAuthoringProfileFresh(root, args.feature, autoActions);

    let artifacts = loadFeatureArtifacts(root, args.feature);
    let featureProfile = loadFeatureAuthoringProfile(root, args.feature);
    let result = runIntent(args, artifacts, featureProfile);
    result.autoActions = autoActions;

    if (args.apply) {
        const applyResult = applyIntent(args, root, artifacts, result);
        if (applyResult.changed) {
            ensureFeatureFresh(root, args.feature, []);
            runQuietly(buildChainKb, ['--root', root, '--config', path.resolve(root, getFeatureRecord(root, args.feature).configPath)]);
            runQuietly(buildCocosAuthoringProfile, ['--root', root, '--feature', args.feature]);
            artifacts = loadFeatureArtifacts(root, args.feature);
            featureProfile = loadFeatureAuthoringProfile(root, args.feature);
            result = runIntent(args, artifacts, featureProfile);
            result.autoActions = autoActions;
        }
        result.applyResult = applyResult;
    }

    if (args.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
    }

    if (result.kind === 'cocos-authoring-profile') {
        printProfile(result);
        return;
    }
    printPlan(result);
}

module.exports = {
    parseArgs,
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
