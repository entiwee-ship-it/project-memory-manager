#!/usr/bin/env node
/**
 * Cocos 创作配置查询 - AI 专用
 * 用法: node scripts/query_cocos_profile.js --root <path> [选项]
 * 
 * 示例:
 *   node scripts/query_cocos_profile.js --list-features
 *   node scripts/query_cocos_profile.js --list-prefabs --filter golden
 *   node scripts/query_cocos_profile.js --find-node EggsTitle
 *   node scripts/query_cocos_profile.js --prefab-detail goldenEgg
 */

const path = require('path');
const { readJson, resolveProjectRoot, normalize } = require('./lib/common');

function parseArgs(argv) {
    const args = {
        root: '',
        listFeatures: false,
        listPrefabs: false,
        findNode: '',
        prefabDetail: '',
        filter: '',
        feature: '',
        json: false,
    };

    for (let i = 0; i < argv.length; i++) {
        const token = argv[i];
        if (token === '--root') {
            args.root = argv[++i];
            continue;
        }
        if (token === '--list-features') {
            args.listFeatures = true;
            continue;
        }
        if (token === '--list-prefabs') {
            args.listPrefabs = true;
            continue;
        }
        if (token === '--find-node') {
            args.findNode = argv[++i];
            continue;
        }
        if (token === '--prefab-detail') {
            args.prefabDetail = argv[++i];
            continue;
        }
        if (token === '--filter') {
            args.filter = argv[++i];
            continue;
        }
        if (token === '--feature') {
            args.feature = argv[++i];
            continue;
        }
        if (token === '--json') {
            args.json = true;
            continue;
        }
    }

    return args;
}

function loadCocosProfile(root) {
    const profilePath = path.join(root, 'project-memory', 'state', 'cocos-authoring-profile.json');
    try {
        return readJson(profilePath);
    } catch (err) {
        throw new Error(`无法加载 cocos-authoring-profile.json: ${err.message}`);
    }
}

function listFeatures(data, filter) {
    const features = data.features || {};
    const keys = Object.keys(features).sort();
    const filtered = filter 
        ? keys.filter(k => k.toLowerCase().includes(filter.toLowerCase()))
        : keys;
    
    const result = filtered.map(key => {
        const feature = features[key];
        return {
            featureKey: key,
            prefabCount: (feature.prefabProfiles || []).length,
        };
    });

    return {
        kind: 'cocos-profile-feature-list',
        count: result.length,
        features: result,
    };
}

function listPrefabs(data, featureKey, filter) {
    const features = data.features || {};
    const result = [];

    for (const [fk, feature] of Object.entries(features)) {
        if (featureKey && fk !== featureKey) continue;
        if (filter && !fk.toLowerCase().includes(filter.toLowerCase())) continue;

        for (const prefab of feature.prefabProfiles || []) {
            result.push({
                featureKey: fk,
                prefabName: prefab.prefabName,
                prefabPath: prefab.prefabPath,
                nodeCount: (prefab.nodes || []).length,
            });
        }
    }

    return {
        kind: 'cocos-profile-prefab-list',
        count: result.length,
        prefabs: result,
    };
}

function findNodes(data, keyword, featureKey) {
    const features = data.features || {};
    const result = [];

    for (const [fk, feature] of Object.entries(features)) {
        if (featureKey && fk !== featureKey) continue;

        for (const prefab of feature.prefabProfiles || []) {
            const matchingNodes = [];
            for (const node of prefab.nodes || []) {
                const nodePath = node.path || '';
                if (nodePath.includes(keyword)) {
                    matchingNodes.push({
                        path: nodePath,
                        components: node.components || [],
                        active: node.active,
                    });
                }
            }

            if (matchingNodes.length > 0) {
                result.push({
                    featureKey: fk,
                    prefabName: prefab.prefabName,
                    prefabPath: prefab.prefabPath,
                    nodes: matchingNodes,
                });
            }
        }
    }

    return {
        kind: 'cocos-profile-node-search',
        keyword,
        count: result.length,
        matches: result,
    };
}

function getPrefabDetail(data, prefabNameKeyword) {
    const features = data.features || {};
    const result = [];

    for (const [fk, feature] of Object.entries(features)) {
        for (const prefab of feature.prefabProfiles || []) {
            if (!prefab.prefabName.toLowerCase().includes(prefabNameKeyword.toLowerCase())) {
                continue;
            }

            result.push({
                featureKey: fk,
                prefabName: prefab.prefabName,
                prefabPath: prefab.prefabPath,
                nodes: prefab.nodes || [],
                clickEventBindings: prefab.clickEventBindings || [],
                prefabBindings: prefab.prefabBindings || [],
            });
        }
    }

    return {
        kind: 'cocos-profile-prefab-detail',
        keyword: prefabNameKeyword,
        count: result.length,
        prefabs: result,
    };
}

function formatOutput(data, args) {
    if (args.json) {
        return JSON.stringify(data, null, 2);
    }

    // 文本格式输出
    let output = '';

    if (data.kind === 'cocos-profile-feature-list') {
        output += `\n共有 ${data.count} 个 feature:\n`;
        for (const f of data.features) {
            output += `\n  • ${f.featureKey}\n`;
            output += `    Prefabs: ${f.prefabCount}\n`;
        }
    }

    if (data.kind === 'cocos-profile-prefab-list') {
        output += `\n共有 ${data.count} 个 prefab:\n`;
        for (const p of data.prefabs) {
            output += `\n  • ${p.prefabName} (${p.featureKey})\n`;
            output += `    路径: ${p.prefabPath}\n`;
            output += `    节点数: ${p.nodeCount}\n`;
        }
    }

    if (data.kind === 'cocos-profile-node-search') {
        output += `\n找到 ${data.count} 个匹配 prefab:\n`;
        for (const match of data.matches) {
            output += `\n  📦 ${match.featureKey} / ${match.prefabName}\n`;
            for (const node of match.nodes) {
                output += `    └─ ${node.path}\n`;
                if (node.components.length > 0) {
                    output += `       组件: ${node.components.join(', ')}\n`;
                }
            }
        }
    }

    if (data.kind === 'cocos-profile-prefab-detail') {
        for (const prefab of data.prefabs) {
            output += `\n${'='.repeat(60)}\n`;
            output += `📦 ${prefab.featureKey} / ${prefab.prefabName}\n`;
            output += `📁 ${prefab.prefabPath}\n`;
            output += `${'='.repeat(60)}\n`;

            // 节点
            output += `\n🧩 节点 (${prefab.nodes.length} 个):\n`;
            for (const node of prefab.nodes) {
                const activeStr = node.active !== undefined ? ` [active=${node.active}]` : '';
                output += `  • ${node.path}${activeStr}\n`;
            }

            // 点击事件
            if (prefab.clickEventBindings.length > 0) {
                output += `\n🖱️  点击事件 (${prefab.clickEventBindings.length} 个):\n`;
                for (const evt of prefab.clickEventBindings) {
                    output += `  • ${evt.sourceNodePath}.${evt.sourceComponent}\n`;
                    output += `    → ${evt.targetScriptPath}::${evt.handler}\n`;
                }
            }

            // 字段绑定
            if (prefab.prefabBindings.length > 0) {
                output += `\n🔗 字段绑定 (${prefab.prefabBindings.length} 个):\n`;
                for (const binding of prefab.prefabBindings) {
                    output += `  • ${binding.fieldName} @ ${binding.nodePath}\n`;
                }
            }
        }
    }

    return output;
}

function run(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    const root = args.root ? path.resolve(args.root) : resolveProjectRoot();

    const data = loadCocosProfile(root);

    let result;
    if (args.listFeatures) {
        result = listFeatures(data, args.filter);
    } else if (args.listPrefabs) {
        result = listPrefabs(data, args.feature, args.filter);
    } else if (args.findNode) {
        result = findNodes(data, args.findNode, args.feature);
    } else if (args.prefabDetail) {
        result = getPrefabDetail(data, args.prefabDetail);
    } else {
        // 默认列出 features
        result = listFeatures(data, args.filter);
    }

    console.log(formatOutput(result, args));
}

module.exports = {
    parseArgs,
    loadCocosProfile,
    listFeatures,
    listPrefabs,
    findNodes,
    getPrefabDetail,
    run,
};

if (require.main === module) {
    try {
        run();
    } catch (err) {
        console.error(err.message);
        process.exit(1);
    }
}
