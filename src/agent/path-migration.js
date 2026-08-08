const fs = require('fs');
const path = require('path');
const { readJsonSafe } = require('../shared/common');
const { createWorkspaceContext } = require('../shared/workspace-layout');

const MIN_CANDIDATE_SCORE = 45;
const HIGH_CONFIDENCE_SCORE = 85;
const MEDIUM_CONFIDENCE_SCORE = 60;
const MIN_UNAMBIGUOUS_MARGIN = 15;
const MAX_ALTERNATIVES = 2;
const CONFIRMATION_STATUSES = new Set(['source-confirmed', 'equivalence-proven']);
const EQUIVALENCE_EVIDENCE_KINDS = new Set([
    'content-hash-match',
    'git-rename-content-match',
    'ast-equivalence',
]);
const catalogCache = new Map();

function toPosix(value = '') {
    return String(value || '').replace(/\\/g, '/');
}

function normalizeText(value = '') {
    return toPosix(value).toLowerCase();
}

function uniq(values = []) {
    return Array.from(new Set(values.filter(Boolean)));
}

function asArray(value) {
    if (Array.isArray(value)) {
        return value;
    }
    return value == null || value === '' ? [] : [value];
}

function isAbsolutePath(value = '') {
    return path.isAbsolute(value) || path.win32.isAbsolute(value);
}

function workspaceRelativePath(workspaceRoot, filePath = '') {
    const rootText = String(workspaceRoot || '').trim();
    const fileText = String(filePath || '').trim();
    if (!rootText || !fileText) {
        return '';
    }
    const root = path.resolve(rootText);
    const candidate = isAbsolutePath(fileText) ? path.resolve(fileText) : path.resolve(root, fileText);
    const relative = path.relative(root, candidate);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        return '';
    }
    return toPosix(relative);
}

function normalizeSegment(value = '') {
    return normalizeText(value).replace(/[^a-z0-9\u3400-\u9fff]/g, '');
}

function pathParts(filePath = '') {
    return toPosix(filePath).split('/').filter(Boolean);
}

function directoryParts(filePath = '') {
    return pathParts(filePath).slice(0, -1).map(normalizeSegment);
}

function basename(filePath = '') {
    const parts = pathParts(filePath);
    return normalizeText(parts[parts.length - 1] || '');
}

function extension(filePath = '') {
    return normalizeText(path.posix.extname(toPosix(filePath)));
}

function stem(filePath = '') {
    return normalizeSegment(path.posix.basename(toPosix(filePath), path.posix.extname(toPosix(filePath))));
}

function commonPrefixCount(left = [], right = []) {
    const limit = Math.min(left.length, right.length);
    let count = 0;
    while (count < limit && left[count] === right[count]) {
        count += 1;
    }
    return count;
}

function commonSuffixCount(left = [], right = []) {
    const limit = Math.min(left.length, right.length);
    let count = 0;
    while (count < limit && left[left.length - 1 - count] === right[right.length - 1 - count]) {
        count += 1;
    }
    return count;
}

function levenshteinDistance(left = '', right = '') {
    const a = String(left || '');
    const b = String(right || '');
    if (!a.length) {
        return b.length;
    }
    if (!b.length) {
        return a.length;
    }
    const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let leftIndex = 1; leftIndex <= a.length; leftIndex += 1) {
        const current = [leftIndex];
        for (let rightIndex = 1; rightIndex <= b.length; rightIndex += 1) {
            const substitutionCost = a[leftIndex - 1] === b[rightIndex - 1] ? 0 : 1;
            current[rightIndex] = Math.min(
                current[rightIndex - 1] + 1,
                previous[rightIndex] + 1,
                previous[rightIndex - 1] + substitutionCost
            );
        }
        previous.splice(0, previous.length, ...current);
    }
    return previous[b.length];
}

function sequenceDistance(left = [], right = []) {
    const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
        const current = [leftIndex];
        for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
            const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
            current[rightIndex] = Math.min(
                current[rightIndex - 1] + 1,
                previous[rightIndex] + 1,
                previous[rightIndex - 1] + substitutionCost
            );
        }
        previous.splice(0, previous.length, ...current);
    }
    return previous[right.length];
}

function stringSimilarity(left = '', right = '') {
    const longest = Math.max(left.length, right.length);
    return longest > 0 ? 1 - (levenshteinDistance(left, right) / longest) : 1;
}

function collectScriptSymbols(script = {}) {
    return uniq([
        ...(script.exports || []).map(item => typeof item === 'string' ? item : item?.name),
        ...(script.methods || []).map(item => typeof item === 'string' ? item : item?.name),
    ].map(item => String(item || '').trim()).filter(item => item.length >= 4));
}

function buildCatalogFromScan(scan = {}, workspaceRoot = '') {
    const byFile = new Map();
    const add = (file, symbols = []) => {
        const relative = workspaceRelativePath(workspaceRoot, file);
        if (!relative) {
            return;
        }
        const key = normalizeText(relative);
        const current = byFile.get(key) || { file: relative, symbols: new Set() };
        for (const symbol of symbols) {
            current.symbols.add(symbol);
        }
        byFile.set(key, current);
    };
    for (const file of scan.trackedFiles || []) {
        add(file);
    }
    for (const script of scan.scripts || []) {
        add(script.scriptPath, collectScriptSymbols(script));
    }
    for (const prefab of scan.prefabs || []) {
        add(prefab.prefabPath);
    }
    return [...byFile.values()].map(item => ({
        file: item.file,
        symbols: [...item.symbols],
    }));
}

function addEvidence(target, kind, weight, detail) {
    target.score += weight;
    target.evidence.push({ kind, weight, detail });
}

function scoreCandidate(historicalFile, catalogItem, historicalText = '') {
    const currentFile = catalogItem.file;
    const historicalBase = basename(historicalFile);
    const currentBase = basename(currentFile);
    const historicalStem = stem(historicalFile);
    const currentStem = stem(currentFile);
    const historicalDirs = directoryParts(historicalFile);
    const currentDirs = directoryParts(currentFile);
    const prefixCount = commonPrefixCount(historicalDirs, currentDirs);
    const suffixCount = commonSuffixCount(historicalDirs, currentDirs);
    const directoryDistance = sequenceDistance(historicalDirs, currentDirs);
    const stemScore = stringSimilarity(historicalStem, currentStem);
    const exactBasename = historicalBase === currentBase;
    const normalizedBasename = normalizeSegment(historicalBase) === normalizeSegment(currentBase);
    const result = {
        currentFile,
        score: 0,
        evidence: [],
        exactBasename,
        normalizedBasename,
        stemScore,
        prefixCount,
        suffixCount,
        directoryDistance,
    };

    if (exactBasename) {
        addEvidence(result, 'basename-exact', 45, `文件名完全一致: ${historicalBase}`);
    } else if (normalizedBasename) {
        addEvidence(result, 'basename-normalized', 35, '文件名仅大小写或分隔符形式不同');
    } else if (stemScore >= 0.8) {
        addEvidence(result, 'filename-similarity', 25, `文件主名相似度 ${stemScore.toFixed(2)}`);
    } else if (stemScore >= 0.65) {
        addEvidence(result, 'filename-similarity', 15, `文件主名相似度 ${stemScore.toFixed(2)}`);
    } else if (stemScore >= 0.55) {
        addEvidence(result, 'filename-similarity', 8, `文件主名相似度 ${stemScore.toFixed(2)}`);
    } else {
        return null;
    }

    if (extension(historicalFile) === extension(currentFile)) {
        addEvidence(result, 'extension-match', 5, `扩展名一致: ${extension(currentFile)}`);
    }
    const historicalTop = pathParts(historicalFile)[0] || '';
    const currentTop = pathParts(currentFile)[0] || '';
    if (normalizeSegment(historicalTop) === normalizeSegment(currentTop)) {
        addEvidence(result, 'workspace-area-match', 8, `同一工作区顶层区域: ${currentTop}`);
    }
    if (prefixCount > 0) {
        addEvidence(result, 'directory-prefix-match', Math.min(16, prefixCount * 4), `共同目录前缀 ${prefixCount} 段`);
    }
    if (suffixCount > 0) {
        addEvidence(result, 'directory-suffix-match', Math.min(24, suffixCount * 8), `共同目录后缀 ${suffixCount} 段`);
    }
    if (historicalDirs.join('/') === currentDirs.join('/')) {
        addEvidence(result, 'directory-separator-normalized', 15, '目录仅分隔符或大小写形式变化');
    } else if (directoryDistance <= 1) {
        addEvidence(result, 'single-segment-directory-change', 15, '目录结构只插入、删除或替换了一个层级');
    } else if (directoryDistance === 2) {
        addEvidence(result, 'small-directory-change', 10, '目录结构相差两个层级');
    } else if (directoryDistance === 3) {
        addEvidence(result, 'small-directory-change', 5, '目录结构相差三个层级');
    }

    const normalizedHistory = normalizeText(historicalText);
    const symbolMatches = (catalogItem.symbols || [])
        .filter(symbol => symbol.length >= 6 && normalizedHistory.includes(normalizeText(symbol)))
        .slice(0, 3);
    if (symbolMatches.length > 0) {
        addEvidence(result, 'historical-symbol-match', Math.min(10, symbolMatches.length * 5), `历史 outcome 命中当前符号: ${symbolMatches.join(', ')}`);
    }
    if ((catalogItem.symbols || []).some(symbol => normalizeSegment(symbol) === historicalStem)) {
        addEvidence(result, 'filename-symbol-match', 10, '当前导出符号与历史文件主名一致');
    }
    addEvidence(result, 'fresh-kb-file', 5, '候选文件来自 fresh project-global scan artifact');
    return result;
}

function candidateConfidence(candidate, ambiguous) {
    const strongPathEvidence = candidate.exactBasename
        && (candidate.directoryDistance <= 1 || (candidate.prefixCount >= 3 && candidate.suffixCount >= 1));
    if (!ambiguous && candidate.score >= HIGH_CONFIDENCE_SCORE && strongPathEvidence) {
        return 'high';
    }
    if (!ambiguous && candidate.score >= MEDIUM_CONFIDENCE_SCORE) {
        return 'medium';
    }
    return 'low';
}

function candidateReason(confidence, ambiguous) {
    if (ambiguous) {
        return 'fresh KB 中存在多个接近候选，必须使用当前源码或 Git 证据消歧。';
    }
    if (confidence === 'high') {
        return 'fresh KB 中存在唯一强路径候选；该置信度只表示当前位置匹配，不证明内容等价。';
    }
    if (confidence === 'medium') {
        return 'fresh KB 中存在较强候选，但仍缺少内容或 Git rename 等价证据。';
    }
    return '只有弱路径或符号相似证据，不能据此恢复当前编辑目标。';
}

function normalizeConfirmationEvidence(evidence = []) {
    const seen = new Set();
    return asArray(evidence).map(item => {
        if (typeof item === 'string') {
            const value = item.trim();
            if (!value || seen.has(value)) {
                return null;
            }
            seen.add(value);
            return value;
        }
        if (!item || typeof item !== 'object') {
            return null;
        }
        const value = JSON.parse(JSON.stringify(item));
        const key = JSON.stringify(value);
        if (seen.has(key)) {
            return null;
        }
        seen.add(key);
        return value;
    }).filter(Boolean);
}

function confirmationKey(historicalFile, currentCandidate) {
    return `${normalizeText(historicalFile)}\u0000${normalizeText(currentCandidate)}`;
}

function confirmPathMigrationCandidate(candidate = {}, confirmation = {}, options = {}) {
    const base = {
        ...candidate,
        sourceConfirmed: false,
        confirmationStatus: 'unconfirmed',
        confirmation: null,
    };
    if (!confirmation || typeof confirmation !== 'object') {
        return base;
    }

    const historicalFile = String(confirmation.historicalFile || '').trim();
    const currentCandidate = String(confirmation.currentCandidate || '').trim();
    const submittedStatus = String(
        confirmation.confirmationStatus || confirmation.status || ''
    ).trim().toLowerCase();
    const evidence = normalizeConfirmationEvidence(confirmation.evidence);
    const candidateMatches = confirmationKey(candidate.historicalFile, candidate.currentCandidate)
        === confirmationKey(historicalFile, currentCandidate);
    const currentFileExists = typeof options.fileExists === 'function'
        ? options.fileExists(candidate.currentCandidate)
        : false;
    const evidenceObjects = asArray(confirmation.evidence).filter(item => item && typeof item === 'object');
    const sourceEvidenceVerified = typeof options.verifySourceEvidence === 'function'
        && evidenceObjects.some(item => options.verifySourceEvidence(item, candidate));
    const equivalenceEvidence = evidenceObjects.filter(item => EQUIVALENCE_EVIDENCE_KINDS.has(
        String(item.kind || '').trim().toLowerCase()
    ));
    const equivalenceVerified = typeof options.verifyEquivalenceEvidence === 'function'
        && equivalenceEvidence.some(item => options.verifyEquivalenceEvidence(item, candidate));
    let rejectionReason = '';
    if (confirmation.duplicate === true) {
        rejectionReason = '同一候选收到多个确认输入，已拒绝歧义确认。';
    } else if (!candidateMatches) {
        rejectionReason = '确认输入与候选的历史路径或当前路径不一致。';
    } else if (!CONFIRMATION_STATUSES.has(submittedStatus)) {
        rejectionReason = '确认状态必须是 source-confirmed 或 equivalence-proven。';
    } else if (!evidence.length) {
        rejectionReason = '显式确认必须携带至少一条证据。';
    } else if (!sourceEvidenceVerified) {
        rejectionReason = '确认证据未通过当前源码或人工确认验证。';
    } else if (!currentFileExists) {
        rejectionReason = '确认时当前候选文件已不存在或越出 workspace。';
    }
    if (rejectionReason) {
        return {
            ...base,
            confirmation: {
                kind: 'confirmation-rejected',
                submittedStatus,
                reason: rejectionReason,
            },
        };
    }

    const equivalenceProven = submittedStatus === 'equivalence-proven' && equivalenceVerified;
    return {
        ...base,
        sourceConfirmed: true,
        confirmationRequired: false,
        equivalenceProven,
        confirmationStatus: equivalenceProven ? 'equivalence-proven' : 'source-confirmed',
        confirmation: {
            kind: equivalenceProven ? 'equivalence-proven' : 'source-confirmed',
            submittedStatus,
            evidence,
            ...(submittedStatus === 'equivalence-proven' && !equivalenceProven
                ? { reason: '等价证据未通过内部内容验证，已降级为 source-confirmed。' }
                : {}),
        },
    };
}

function applyPathMigrationConfirmations(candidates = [], confirmations = [], options = {}) {
    const confirmationMap = new Map();
    for (const item of asArray(confirmations).filter(value => value && typeof value === 'object')) {
        const key = confirmationKey(item.historicalFile, item.currentCandidate);
        confirmationMap.set(key, confirmationMap.has(key) ? { ...item, duplicate: true } : item);
    }
    return asArray(candidates).map(candidate => confirmPathMigrationCandidate(
        candidate,
        confirmationMap.get(confirmationKey(candidate.historicalFile, candidate.currentCandidate)),
        options
    ));
}

function normalizeCatalogItems(currentFiles = []) {
    const byFile = new Map();
    for (const item of currentFiles) {
        const value = typeof item === 'string' ? { file: item, symbols: [] } : item;
        const file = toPosix(value?.file || '').replace(/^\.\//, '');
        if (!file || isAbsolutePath(file) || pathParts(file).includes('..')) {
            continue;
        }
        const key = normalizeText(file);
        const previous = byFile.get(key) || { file, symbols: [] };
        previous.symbols = uniq([...(previous.symbols || []), ...(value.symbols || [])]);
        byFile.set(key, previous);
    }
    return [...byFile.values()];
}

function rankPathMigrationCandidates({ historicalFiles = [], currentFiles = [], historicalText = '', fileExists = () => true } = {}) {
    const catalog = normalizeCatalogItems(currentFiles);
    return uniq(historicalFiles.map(file => toPosix(file).trim()).filter(Boolean)).map(historicalFile => {
        if (isAbsolutePath(historicalFile) || pathParts(historicalFile).includes('..')) {
            return {
                historicalFile,
                currentCandidate: '',
                confidence: 'low',
                score: 0,
                status: 'outside-workspace',
                ambiguous: false,
                confirmationRequired: true,
                equivalenceProven: false,
                reason: '历史路径位于当前 workspace 外部，不进行迁移推断。',
                evidence: [],
                alternatives: [],
            };
        }
        const scored = catalog
            .map(item => scoreCandidate(historicalFile, item, historicalText))
            .filter(Boolean)
            .filter(item => item.score >= MIN_CANDIDATE_SCORE)
            .filter(item => fileExists(item.currentFile));
        const exactMatches = scored.filter(item => item.exactBasename);
        if (exactMatches.length === 1) {
            addEvidence(exactMatches[0], 'unique-basename', 10, 'fresh KB 中只有一个同名文件');
        }
        scored.sort((left, right) => right.score - left.score || left.currentFile.localeCompare(right.currentFile));
        if (scored.length === 0) {
            return {
                historicalFile,
                currentCandidate: '',
                confidence: 'low',
                score: 0,
                status: 'not-found',
                ambiguous: false,
                confirmationRequired: true,
                equivalenceProven: false,
                reason: 'fresh KB 中没有达到最低证据阈值的当前文件候选。',
                evidence: [],
                alternatives: [],
            };
        }
        const best = scored[0];
        const margin = scored[1] ? best.score - scored[1].score : best.score;
        const ambiguous = scored.length > 1 && margin < MIN_UNAMBIGUOUS_MARGIN;
        const confidence = candidateConfidence(best, ambiguous);
        return {
            historicalFile,
            currentCandidate: best.currentFile,
            confidence,
            score: Math.min(100, best.score),
            status: ambiguous ? 'ambiguous' : (confidence === 'low' ? 'low-confidence' : 'candidate-found'),
            ambiguous,
            confirmationRequired: true,
            equivalenceProven: false,
            reason: candidateReason(confidence, ambiguous),
            evidence: best.evidence,
            alternatives: scored.slice(1, MAX_ALTERNATIVES + 1).map(item => ({
                currentCandidate: item.currentFile,
                score: Math.min(100, item.score),
            })),
        };
    });
}

function loadCurrentCatalog(context) {
    const scanPath = path.join(context.paths.projectGlobalDir, 'scan.raw.json');
    const stat = fs.statSync(scanPath);
    const signature = `${stat.mtimeMs}:${stat.size}`;
    const cached = catalogCache.get(scanPath);
    if (cached?.signature === signature) {
        return cached.catalog;
    }
    const scan = readJsonSafe(scanPath);
    const catalog = buildCatalogFromScan(scan, context.workspaceRoot);
    catalogCache.set(scanPath, { signature, catalog });
    if (catalogCache.size > 4) {
        catalogCache.delete(catalogCache.keys().next().value);
    }
    return catalog;
}

function currentFileExists(workspaceRoot, relativeFile) {
    try {
        const resolveRealPath = fs.realpathSync.native || fs.realpathSync;
        const realRoot = resolveRealPath(workspaceRoot);
        const realCandidate = resolveRealPath(path.resolve(workspaceRoot, relativeFile));
        const relative = path.relative(realRoot, realCandidate);
        if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
            return false;
        }
        return fs.statSync(realCandidate).isFile();
    } catch {
        return false;
    }
}

function verifyPathMigrationSourceEvidence(workspaceRoot, candidate = {}, evidence = {}) {
    const kind = String(evidence.kind || '').trim().toLowerCase();
    if (kind === 'manual-confirmation') {
        return Boolean(String(evidence.reason || '').trim());
    }
    if (!['source-read', 'current-symbol-match'].includes(kind)
        || normalizeText(evidence.file) !== normalizeText(candidate.currentCandidate)
        || !currentFileExists(workspaceRoot, candidate.currentCandidate)) {
        return false;
    }
    try {
        const source = fs.readFileSync(path.resolve(workspaceRoot, candidate.currentCandidate), 'utf8');
        if (kind === 'current-symbol-match') {
            return Boolean(String(evidence.symbol || '').trim())
                && source.includes(String(evidence.symbol).trim());
        }
        const line = Number(evidence.line);
        if (!Number.isInteger(line) || line < 1 || line > source.split(/\r?\n/).length) {
            return false;
        }
        const expectedText = String(evidence.contains || '').trim();
        return !expectedText || source.split(/\r?\n/)[line - 1].includes(expectedText);
    } catch {
        return false;
    }
}

function resolvePathMigrationCandidates(options = {}) {
    if (options.freshnessStatus !== 'fresh') {
        return {
            candidates: [],
            warnings: ['project-global KB 非 fresh，已禁止历史路径迁移推断。'],
        };
    }
    const context = createWorkspaceContext({
        workspaceRoot: options.workspaceRoot,
        dataRoot: options.dataRoot,
        layout: options.layout,
    });
    try {
        const catalog = loadCurrentCatalog(context);
        return {
            candidates: rankPathMigrationCandidates({
                historicalFiles: options.historicalFiles,
                currentFiles: catalog,
                historicalText: options.historicalText,
                fileExists: file => currentFileExists(context.workspaceRoot, file),
            }),
            warnings: [],
        };
    } catch (error) {
        return {
            candidates: [],
            warnings: [`无法读取 fresh project-global scan artifact：${error instanceof Error ? error.message : String(error)}`],
        };
    }
}

module.exports = {
    applyPathMigrationConfirmations,
    buildCatalogFromScan,
    confirmPathMigrationCandidate,
    currentFileExists,
    rankPathMigrationCandidates,
    resolvePathMigrationCandidates,
    verifyPathMigrationSourceEvidence,
    workspaceRelativePath,
};
