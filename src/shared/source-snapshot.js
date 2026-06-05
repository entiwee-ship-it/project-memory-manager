const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
    hasDefaultIgnoredPathSegment,
    listFilesRecursive,
    normalize,
    timestamp,
} = require('./common');

const SNAPSHOT_VERSION = 1;
const CHANGE_SAMPLE_LIMIT = 25;

function asArray(value) {
    if (Array.isArray(value)) {
        return value;
    }
    if (value == null || value === '') {
        return [];
    }
    return [value];
}

function hasGlobMagic(value = '') {
    return /[*?\[\]]/.test(String(value || ''));
}

function matchGlobSegment(name, pattern) {
    const escaped = pattern.replace(/[.+^${}()|\\]/g, '\\$&');
    const regex = new RegExp(`^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.').replace(/\[/g, '[').replace(/\]/g, ']')}$`);
    return regex.test(name);
}

function expandGlobSegments(basePath, segments, index = 0, results = []) {
    if (hasDefaultIgnoredPathSegment(basePath)) {
        return results;
    }
    if (index >= segments.length) {
        if (fs.existsSync(basePath)) {
            results.push(path.resolve(basePath));
        }
        return results;
    }

    const segment = segments[index];
    if (segment === '**') {
        expandGlobSegments(basePath, segments, index + 1, results);
        if (!fs.existsSync(basePath) || !fs.statSync(basePath).isDirectory()) {
            return results;
        }
        for (const entry of fs.readdirSync(basePath, { withFileTypes: true })) {
            if (!entry.isDirectory() || entry.isSymbolicLink()) {
                continue;
            }
            expandGlobSegments(path.join(basePath, entry.name), segments, index, results);
        }
        return results;
    }

    if (!hasGlobMagic(segment)) {
        expandGlobSegments(path.join(basePath, segment), segments, index + 1, results);
        return results;
    }

    if (!fs.existsSync(basePath) || !fs.statSync(basePath).isDirectory()) {
        return results;
    }
    for (const entry of fs.readdirSync(basePath, { withFileTypes: true })) {
        if (entry.isSymbolicLink() || !matchGlobSegment(entry.name, segment)) {
            continue;
        }
        expandGlobSegments(path.join(basePath, entry.name), segments, index + 1, results);
    }
    return results;
}

function expandConfiguredTarget(root, input) {
    const rawInput = String(input || '').trim();
    if (!rawInput) {
        return [];
    }
    const absoluteInput = path.isAbsolute(rawInput) ? rawInput : path.resolve(root, rawInput);
    if (!hasGlobMagic(absoluteInput)) {
        return fs.existsSync(absoluteInput) ? [path.resolve(absoluteInput)] : [];
    }

    const parsed = path.parse(absoluteInput);
    const rootBase = parsed.root || path.dirname(absoluteInput);
    const tail = absoluteInput.slice(rootBase.length);
    const segments = tail.split(/[\\/]+/).filter(Boolean);
    return Array.from(new Set(expandGlobSegments(rootBase, segments)));
}

function collectConfiguredSourceInputs(config = {}) {
    const scanTargets = config.scanTargets && typeof config.scanTargets === 'object' ? config.scanTargets : {};
    const inputs = [
        ...asArray(config.componentRoots),
        ...asArray(config.assetRoots),
        ...asArray(config.methodRoots),
        ...asArray(config.serverRoots),
        ...asArray(config.moduleRoots),
        ...asArray(config.dbRoots),
        ...asArray(config.prefabs),
    ];

    for (const value of Object.values(scanTargets)) {
        inputs.push(...asArray(value));
    }

    return Array.from(new Set(inputs.map(item => String(item || '').trim()).filter(Boolean)))
        .sort((left, right) => left.localeCompare(right));
}

function collectFilesFromTarget(targetPath, files) {
    if (!targetPath || hasDefaultIgnoredPathSegment(targetPath) || !fs.existsSync(targetPath)) {
        return;
    }
    const stat = fs.statSync(targetPath);
    if (stat.isFile()) {
        files.add(path.resolve(targetPath));
        return;
    }
    if (!stat.isDirectory()) {
        return;
    }
    for (const filePath of listFilesRecursive(targetPath, () => true)) {
        files.add(path.resolve(filePath));
    }
}

function collectSourceFiles(root, config = {}) {
    const files = new Set();
    const inputs = collectConfiguredSourceInputs(config);
    for (const input of inputs) {
        for (const targetPath of expandConfiguredTarget(root, input)) {
            collectFilesFromTarget(targetPath, files);
        }
    }
    return Array.from(files).sort((left, right) => left.localeCompare(right));
}

function fileSignature(root, filePath) {
    const stat = fs.statSync(filePath);
    return {
        path: normalize(path.relative(root, path.resolve(filePath))),
        size: stat.size,
        mtimeMs: Math.round(stat.mtimeMs),
    };
}

function fingerprintFiles(files) {
    return crypto
        .createHash('sha256')
        .update(JSON.stringify(files.map(item => [item.path, item.size, item.mtimeMs])))
        .digest('hex');
}

function buildSourceSnapshot(root, config = {}) {
    const normalizedRoot = path.resolve(root);
    const inputs = collectConfiguredSourceInputs(config);
    const files = collectSourceFiles(normalizedRoot, config)
        .map(filePath => fileSignature(normalizedRoot, filePath));
    return {
        kind: 'source-snapshot',
        staleCheckVersion: SNAPSHOT_VERSION,
        strategy: 'mtime-size',
        generatedAt: timestamp(),
        workspaceRoot: normalize(normalizedRoot),
        inputs,
        fileCount: files.length,
        fingerprint: fingerprintFiles(files),
        files,
    };
}

function buildFreshnessResult({
    status,
    reasonCodes = [],
    reasons = [],
    recommendedAction = '',
    sourceSnapshot = null,
    currentSnapshot = null,
    addedFiles = [],
    deletedFiles = [],
    changedFiles = [],
}) {
    const stale = status === 'stale' || status === 'unknown' || status === 'missing';
    return {
        kind: 'kb-freshness',
        status,
        stale,
        reasonCodes,
        reasons,
        recommendedAction: stale ? recommendedAction : '',
        sourceSnapshot: sourceSnapshot
            ? {
                generatedAt: sourceSnapshot.generatedAt || null,
                fileCount: sourceSnapshot.fileCount ?? null,
                fingerprint: sourceSnapshot.fingerprint || '',
                strategy: sourceSnapshot.strategy || '',
            }
            : null,
        currentSnapshot: currentSnapshot
            ? {
                fileCount: currentSnapshot.fileCount ?? null,
                fingerprint: currentSnapshot.fingerprint || '',
            }
            : null,
        addedFiles: addedFiles.slice(0, CHANGE_SAMPLE_LIMIT),
        deletedFiles: deletedFiles.slice(0, CHANGE_SAMPLE_LIMIT),
        changedFiles: changedFiles.slice(0, CHANGE_SAMPLE_LIMIT),
        changeCounts: {
            added: addedFiles.length,
            deleted: deletedFiles.length,
            changed: changedFiles.length,
        },
    };
}

function compareSourceSnapshot(root, storedSnapshot, config = {}, options = {}) {
    const recommendedAction = options.recommendedAction || 'rebuild_kbs';
    if (!storedSnapshot || storedSnapshot.kind !== 'source-snapshot') {
        return buildFreshnessResult({
            status: 'unknown',
            reasonCodes: ['missing-source-snapshot'],
            reasons: ['当前 KB 没有源码快照，需要重建一次后才能判断新鲜度。'],
            recommendedAction,
            sourceSnapshot: storedSnapshot || null,
        });
    }
    if (storedSnapshot.staleCheckVersion !== SNAPSHOT_VERSION) {
        return buildFreshnessResult({
            status: 'unknown',
            reasonCodes: ['source-snapshot-version-unsupported'],
            reasons: ['当前 KB 的源码快照版本无法判断，需要重建。'],
            recommendedAction,
            sourceSnapshot: storedSnapshot,
        });
    }

    const currentSnapshot = buildSourceSnapshot(root, config);
    if (currentSnapshot.fingerprint === storedSnapshot.fingerprint) {
        return buildFreshnessResult({
            status: 'fresh',
            sourceSnapshot: storedSnapshot,
            currentSnapshot,
        });
    }

    const storedByPath = new Map((storedSnapshot.files || []).map(item => [item.path, item]));
    const currentByPath = new Map((currentSnapshot.files || []).map(item => [item.path, item]));
    const addedFiles = [];
    const deletedFiles = [];
    const changedFiles = [];

    for (const [filePath, current] of currentByPath.entries()) {
        const previous = storedByPath.get(filePath);
        if (!previous) {
            addedFiles.push({ path: filePath, size: current.size, mtimeMs: current.mtimeMs });
            continue;
        }
        if (previous.size !== current.size || previous.mtimeMs !== current.mtimeMs) {
            changedFiles.push({
                path: filePath,
                previous: { size: previous.size, mtimeMs: previous.mtimeMs },
                current: { size: current.size, mtimeMs: current.mtimeMs },
            });
        }
    }
    for (const [filePath, previous] of storedByPath.entries()) {
        if (!currentByPath.has(filePath)) {
            deletedFiles.push({ path: filePath, size: previous.size, mtimeMs: previous.mtimeMs });
        }
    }

    const reasonCodes = [];
    const reasons = [];
    if (addedFiles.length > 0) {
        reasonCodes.push('source-files-added');
        reasons.push(`新增源码文件 ${addedFiles.length} 个。`);
    }
    if (deletedFiles.length > 0) {
        reasonCodes.push('source-files-deleted');
        reasons.push(`删除源码文件 ${deletedFiles.length} 个。`);
    }
    if (changedFiles.length > 0) {
        reasonCodes.push('source-files-changed');
        reasons.push(`修改源码文件 ${changedFiles.length} 个。`);
    }

    return buildFreshnessResult({
        status: 'stale',
        reasonCodes,
        reasons,
        recommendedAction,
        sourceSnapshot: storedSnapshot,
        currentSnapshot,
        addedFiles,
        deletedFiles,
        changedFiles,
    });
}

function buildKbFreshnessStatus({ root, graph = null, config = null, currentSkill = null, recommendedAction = 'rebuild_kbs' }) {
    if (!graph) {
        return buildFreshnessResult({
            status: 'missing',
            reasonCodes: ['missing-kb'],
            reasons: ['KB 尚未构建。'],
            recommendedAction,
        });
    }

    const sourceFreshness = config
        ? compareSourceSnapshot(root, graph.sourceSnapshot, config, { recommendedAction })
        : buildFreshnessResult({
            status: 'unknown',
            reasonCodes: ['missing-kb-config'],
            reasons: ['找不到 KB 构建配置，无法判断源码是否变化。'],
            recommendedAction,
            sourceSnapshot: graph.sourceSnapshot || null,
        });
    const builtWithSkill = graph.builtWithSkill || null;
    const skillStale = Boolean(
        currentSkill
        && builtWithSkill?.version
        && currentSkill.version
        && builtWithSkill.version !== currentSkill.version
    );

    if (!skillStale && sourceFreshness.status === 'fresh') {
        return {
            ...sourceFreshness,
            builtWithSkill,
            currentSkill: currentSkill || null,
        };
    }

    const reasonCodes = [...sourceFreshness.reasonCodes];
    const reasons = [...sourceFreshness.reasons];
    if (skillStale) {
        reasonCodes.push('pmm-version-changed');
        reasons.push(`KB 由 ${builtWithSkill.name || 'unknown'}@${builtWithSkill.version || 'unknown'} 构建，当前 PMM 是 ${currentSkill.name || 'unknown'}@${currentSkill.version || 'unknown'}。`);
    }

    const status = skillStale ? 'stale' : sourceFreshness.status;
    return {
        ...sourceFreshness,
        status,
        stale: status !== 'fresh',
        reasonCodes,
        reasons,
        recommendedAction: status === 'fresh' ? '' : recommendedAction,
        builtWithSkill,
        currentSkill: currentSkill || null,
    };
}

module.exports = {
    SNAPSHOT_VERSION,
    buildKbFreshnessStatus,
    buildSourceSnapshot,
    collectConfiguredSourceInputs,
    collectSourceFiles,
    compareSourceSnapshot,
};
