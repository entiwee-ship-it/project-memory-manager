const path = require('path');
const { pathExists, readJson, readJsonSafe, slugify } = require('./common');

function toPosixPath(value = '') {
    return String(value || '').replace(/\\/g, '/');
}

function titleizeSlug(value = '') {
    return String(value || '')
        .split(/[-_/]+/)
        .filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ') || 'Unnamed Feature';
}

function deriveFeatureKey(config = {}) {
    return String(config.featureKey || config.key || slugify(config.name || '')).trim();
}

function deriveFeatureName(config = {}, featureKey = '') {
    if (String(config.featureName || '').trim()) {
        return String(config.featureName).trim();
    }
    if (String(config.name || '').trim()) {
        return String(config.name).trim();
    }
    return titleizeSlug(featureKey);
}

function deriveKbDir(config = {}, featureKey = '') {
    if (String(config.kbDir || '').trim()) {
        return toPosixPath(config.kbDir);
    }
    const fromGraph = config.graphPath || config.lookupPath || config.outputs?.graph || config.outputs?.lookup || '';
    if (String(fromGraph || '').trim()) {
        return toPosixPath(path.dirname(String(fromGraph)));
    }
    return `project-memory/kb/features/${featureKey}`;
}

function buildOutputsFromDir(baseDir = '') {
    const normalizedDir = toPosixPath(baseDir).replace(/\/+$/, '');
    return {
        scan: `${normalizedDir}/scan.raw.json`,
        graph: `${normalizedDir}/chain.graph.json`,
        lookup: `${normalizedDir}/chain.lookup.json`,
        report: `${normalizedDir}/build.report.json`,
    };
}

function buildNormalizedOutputs(config = {}, featureKey = '', options = {}) {
    const warnings = Array.isArray(options.warnings) ? options.warnings : [];
    const explicitOutputs = config.outputs && typeof config.outputs === 'object' ? config.outputs : null;
    if (explicitOutputs) {
        const normalized = {};
        const mapping = [
            ['scan', ['scan', 'scanPath']],
            ['graph', ['graph', 'graphPath']],
            ['lookup', ['lookup', 'lookupPath']],
            ['report', ['report', 'reportPath']],
        ];

        for (const [key, aliases] of mapping) {
            const resolvedValue = aliases.find(alias => String(explicitOutputs[alias] || '').trim()) || '';
            if (resolvedValue) {
                normalized[key] = toPosixPath(explicitOutputs[resolvedValue]);
            }
        }

        if (normalized.graph && /(?:^|\/)graph\.json$/i.test(normalized.graph)) {
            warnings.push(`outputs.graph 使用旧文件名 ${normalized.graph}，建议改为 chain.graph.json`);
        }
        if (normalized.lookup && /(?:^|\/)lookup\.json$/i.test(normalized.lookup)) {
            warnings.push(`outputs.lookup 使用旧文件名 ${normalized.lookup}，建议改为 chain.lookup.json`);
        }
        if (normalized.scan && /(?:^|\/)scan\.json$/i.test(normalized.scan)) {
            warnings.push(`outputs.scan 使用旧文件名 ${normalized.scan}，建议改为 scan.raw.json`);
        }
        if (normalized.report && /(?:^|\/)report\.json$/i.test(normalized.report)) {
            warnings.push(`outputs.report 使用旧文件名 ${normalized.report}，建议改为 build.report.json`);
        }

        return normalized;
    }

    if (String(config.outputDir || '').trim()) {
        warnings.push(`outputDir 已弃用，将自动映射为 outputs.*: ${config.outputDir}`);
        return {
            scan: `${toPosixPath(config.outputDir).replace(/\/+$/, '')}/scan.json`,
            graph: `${toPosixPath(config.outputDir).replace(/\/+$/, '')}/graph.json`,
            lookup: `${toPosixPath(config.outputDir).replace(/\/+$/, '')}/lookup.json`,
            report: `${toPosixPath(config.outputDir).replace(/\/+$/, '')}/report.json`,
        };
    }

    return buildOutputsFromDir(`project-memory/kb/features/${featureKey}`);
}

function normalizeConfig(config = {}, options = {}) {
    const warnings = [];
    const featureKey = deriveFeatureKey(config);
    const featureName = deriveFeatureName(config, featureKey);
    const outputs = buildNormalizedOutputs(config, featureKey, { warnings });
    const kbDir = deriveKbDir({ ...config, outputs }, featureKey);
    const normalized = {
        ...config,
        featureKey,
        featureName,
        outputs,
        kbDir,
    };

    const missing = [];
    if (!featureKey) {
        missing.push('featureKey');
    }
    if (!featureName) {
        missing.push('featureName');
    }
    for (const outputKey of ['scan', 'graph', 'lookup', 'report']) {
        if (!String(outputs[outputKey] || '').trim()) {
            missing.push(`outputs.${outputKey}`);
        }
    }

    return {
        config: normalized,
        missing,
        warnings,
    };
}

function normalizeFeatureRecord(entry = {}) {
    const featureKey = String(entry.featureKey || entry.key || '').trim();
    const featureName = String(entry.featureName || entry.name || titleizeSlug(featureKey)).trim();
    const kbDir = deriveKbDir(entry, featureKey);
    const outputs = entry.outputs && typeof entry.outputs === 'object'
        ? {
            ...buildOutputsFromDir(kbDir),
            ...Object.fromEntries(Object.entries(entry.outputs).map(([key, value]) => [key, toPosixPath(value)])),
        }
        : buildOutputsFromDir(kbDir);

    return {
        featureKey,
        featureName,
        summary: entry.summary || '',
        areas: Array.isArray(entry.areas) ? entry.areas : [],
        configPath: entry.configPath || '',
        docsDir: entry.docsDir || entry.docs?.featureDir || '',
        kbDir,
        outputs,
        type: entry.type || '',
    };
}

function resolveExistingKbArtifacts(root, record = {}) {
    const kbDir = path.resolve(root, record.kbDir || '');
    const candidates = {
        graph: [
            path.join(kbDir, 'chain.graph.json'),
            path.join(kbDir, 'graph.json'),
        ],
        lookup: [
            path.join(kbDir, 'chain.lookup.json'),
            path.join(kbDir, 'lookup.json'),
        ],
    };

    return {
        graphPath: candidates.graph.find(pathExists) || candidates.graph[0],
        lookupPath: candidates.lookup.find(pathExists) || candidates.lookup[0],
    };
}

/**
 * 加载 Feature KB 产物，提供诊断信息
 * @param {string} root - 项目根目录
 * @param {Object} record - Feature 记录
 * @param {Object} options - 选项
 * @returns {Object} 加载的 artifacts
 * @throws {Error} 带有诊断信息的错误
 */
function loadFeatureLookupArtifacts(root, record = {}, options = {}) {
    const normalized = normalizeFeatureRecord(record);
    const { graphPath, lookupPath } = resolveExistingKbArtifacts(root, normalized);
    
    // 检查文件是否存在，提供诊断
    if (!pathExists(graphPath)) {
        const error = new Error(
            `[SKILL-DIAGNOSIS] KB graph 文件不存在\n` +
            `文件: ${graphPath}\n` +
            `Feature: ${normalized.featureKey}\n\n` +
            `可能原因:\n` +
            `  1. 该 feature 尚未构建\n` +
            `  2. 构建后文件被移动或删除\n\n` +
            `修复命令:\n` +
            `  node scripts/build_chain_kb.js --config ${normalized.configPath || `project-memory/kb/configs/${normalized.featureKey}.json`}\n` +
            `  或重建全部:\n` +
            `  node scripts/rebuild_kbs.js --root ${root}`
        );
        error.code = 'KB_NOT_FOUND';
        error.featureKey = normalized.featureKey;
        throw error;
    }
    
    if (!pathExists(lookupPath)) {
        const error = new Error(
            `[SKILL-DIAGNOSIS] KB lookup 文件不存在\n` +
            `文件: ${lookupPath}\n` +
            `Feature: ${normalized.featureKey}\n\n` +
            `可能原因:\n` +
            `  1. 该 feature 尚未构建\n` +
            `  2. 构建后文件被移动或删除\n\n` +
            `修复命令:\n` +
            `  node scripts/build_chain_kb.js --config ${normalized.configPath || `project-memory/kb/configs/${normalized.featureKey}.json`}\n` +
            `  或重建全部:\n` +
            `  node scripts/rebuild_kbs.js --root ${root}`
        );
        error.code = 'KB_NOT_FOUND';
        error.featureKey = normalized.featureKey;
        throw error;
    }
    
    // 使用安全读取
    const graph = readJsonSafe(graphPath, { 
        suggestRebuild: true, 
        featureKey: normalized.featureKey 
    });
    
    const lookup = readJsonSafe(lookupPath, { 
        suggestRebuild: true, 
        featureKey: normalized.featureKey 
    });
    
    return {
        feature: normalized,
        graphPath,
        lookupPath,
        graph,
        lookup,
    };
}

module.exports = {
    buildOutputsFromDir,
    deriveFeatureKey,
    deriveFeatureName,
    deriveKbDir,
    loadFeatureLookupArtifacts,
    normalizeConfig,
    normalizeFeatureRecord,
    resolveExistingKbArtifacts,
    titleizeSlug,
    toPosixPath,
};
