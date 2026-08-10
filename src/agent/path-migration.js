const fs = require('fs');
const path = require('path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
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
const SAFE_GIT_REF_PATTERN = /^[0-9A-Za-z._/~^-]+$/;
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

function evaluateEquivalenceEvidence(evidenceItems = [], candidate = {}, options = {}) {
    if (typeof options.verifyEquivalenceEvidence !== 'function') {
        return { verified: false, reason: '未配置 PMM 内部等价验证器。' };
    }
    const failureReasons = [];
    for (const item of evidenceItems) {
        const result = options.verifyEquivalenceEvidence(item, candidate);
        if (result === true || result?.verified === true || result?.ok === true) {
            return { verified: true, reason: '' };
        }
        if (typeof result?.reason === 'string' && result.reason.trim()) {
            failureReasons.push(result.reason.trim());
        }
    }
    return {
        verified: false,
        reason: failureReasons[0] || '等价证据未通过 PMM 内部内容验证。',
    };
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
    const equivalenceResult = evaluateEquivalenceEvidence(equivalenceEvidence, candidate, options);
    const equivalenceVerified = equivalenceResult.verified;
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
                ? { reason: `${equivalenceResult.reason} 已降级为 source-confirmed。` }
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

function normalizeRelativeEvidencePath(filePath = '') {
    const value = toPosix(String(filePath || '').trim()).replace(/^\.\//, '');
    if (!value || isAbsolutePath(value) || pathParts(value).includes('..')) {
        return '';
    }
    return value;
}

function safeGitRef(value = '') {
    const ref = String(value || '').trim();
    if (!ref || ref.startsWith('-') || ref.includes(':') || ref.includes('..') || !SAFE_GIT_REF_PATTERN.test(ref)) {
        return '';
    }
    return ref;
}

function gitOutput(repoRoot, args = [], encoding = 'utf8') {
    return execFileSync('git', ['-C', repoRoot, ...args], {
        encoding,
        maxBuffer: 10 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}

function resolveGitContext(workspaceRoot) {
    const workspaceText = String(workspaceRoot || '').trim();
    if (!workspaceText) {
        return null;
    }
    try {
        const workspace = path.resolve(workspaceText);
        const resolveRealPath = fs.realpathSync.native || fs.realpathSync;
        const gitRoot = resolveRealPath(path.resolve(String(
            gitOutput(workspace, ['rev-parse', '--show-toplevel'])
        ).trim()));
        const realWorkspace = resolveRealPath(workspace);
        const relative = path.relative(gitRoot, realWorkspace);
        if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
            return null;
        }
        return { workspaceRoot: realWorkspace, gitRoot };
    } catch {
        return null;
    }
}

function repoRelativePath(gitRoot, workspaceRoot, relativeFile) {
    const safeRelative = normalizeRelativeEvidencePath(relativeFile);
    if (!safeRelative) {
        return '';
    }
    const absolutePath = path.resolve(workspaceRoot, safeRelative);
    const workspaceRelative = path.relative(path.resolve(workspaceRoot), absolutePath);
    if (!workspaceRelative || workspaceRelative === '..' || workspaceRelative.startsWith(`..${path.sep}`) || path.isAbsolute(workspaceRelative)) {
        return '';
    }
    const repoRelative = path.relative(path.resolve(gitRoot), absolutePath);
    if (!repoRelative || repoRelative === '..' || repoRelative.startsWith(`..${path.sep}`) || path.isAbsolute(repoRelative)) {
        return '';
    }
    return toPosix(repoRelative);
}

function readGitBlob(gitRoot, commit, repoRelativeFile) {
    const safeCommit = safeGitRef(commit);
    const safeFile = normalizeRelativeEvidencePath(repoRelativeFile);
    if (!safeCommit || !safeFile) {
        return null;
    }
    try {
        return gitOutput(gitRoot, ['show', `${safeCommit}:${safeFile}`], 'buffer');
    } catch {
        return null;
    }
}

function gitRefIsAncestor(gitRoot, ancestor, descendant = 'HEAD') {
    const safeAncestor = safeGitRef(ancestor);
    const safeDescendant = safeGitRef(descendant);
    if (!safeAncestor || !safeDescendant) {
        return false;
    }
    try {
        gitOutput(gitRoot, ['merge-base', '--is-ancestor', safeAncestor, safeDescendant]);
        return true;
    } catch {
        return false;
    }
}

function sha256(buffer) {
    return createHash('sha256').update(buffer).digest('hex');
}

function currentCandidatePath(workspaceRoot, candidate = {}, evidence = {}) {
    const candidateFile = normalizeRelativeEvidencePath(candidate.currentCandidate);
    if (!candidateFile || !currentFileExists(workspaceRoot, candidateFile)) {
        return '';
    }
    const providedFile = normalizeRelativeEvidencePath(
        evidence.currentCandidate || evidence.currentFile || evidence.file || ''
    );
    if (providedFile && normalizeText(providedFile) !== normalizeText(candidateFile)) {
        return '';
    }
    return path.resolve(workspaceRoot, candidateFile);
}

function historicalEvidenceFile(candidate = {}, evidence = {}) {
    const file = normalizeRelativeEvidencePath(
        evidence.historicalFile || evidence.oldPath || evidence.oldFile || candidate.historicalFile
    );
    if (!file) {
        return '';
    }
    if (candidate.historicalFile && normalizeText(file) !== normalizeText(candidate.historicalFile)) {
        return '';
    }
    return file;
}

function evidenceCommit(evidence = {}, names = []) {
    for (const name of names) {
        const value = safeGitRef(evidence[name]);
        if (value) {
            return value;
        }
    }
    return '';
}

function scriptLanguageForPath(filePath = '') {
    const ext = extension(filePath);
    if (ext === '.tsx') {
        return { family: 'tsx', scriptKind: ts.ScriptKind.TSX };
    }
    if (ext === '.jsx') {
        return { family: 'jsx', scriptKind: ts.ScriptKind.JSX };
    }
    if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
        return { family: 'js', scriptKind: ts.ScriptKind.JS };
    }
    if (ext === '.ts' || ext === '.mts' || ext === '.cts') {
        return { family: 'ts', scriptKind: ts.ScriptKind.TS };
    }
    return null;
}

function tokenSignature(sourceText, filePath) {
    const language = scriptLanguageForPath(filePath);
    if (!language) {
        return null;
    }
    const scriptKind = language.scriptKind;
    const source = ts.createSourceFile(filePath || 'migration.ts', sourceText, ts.ScriptTarget.Latest, true, scriptKind);
    if (source.parseDiagnostics.length > 0) {
        return null;
    }
    const languageVariant = scriptKind === ts.ScriptKind.TSX || scriptKind === ts.ScriptKind.JSX
        ? ts.LanguageVariant.JSX
        : ts.LanguageVariant.Standard;
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, languageVariant, sourceText);
    const tokens = [];
    for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
        tokens.push(`${token}:${scanner.getTokenText()}`);
    }
    return tokens.join('\n');
}

function verifyPathMigrationEquivalenceEvidence(workspaceRoot, candidate = {}, evidence = {}) {
    const kind = String(evidence.kind || '').trim().toLowerCase();
    if (!EQUIVALENCE_EVIDENCE_KINDS.has(kind)) {
        return { verified: false, reason: '不支持的等价证据类型。' };
    }
    const gitContext = resolveGitContext(workspaceRoot);
    if (!gitContext) {
        return { verified: false, reason: '当前 workspace 不在可验证的 Git 仓库内。' };
    }
    const currentPath = currentCandidatePath(gitContext.workspaceRoot, candidate, evidence);
    if (!currentPath) {
        return { verified: false, reason: '当前候选文件不存在、越界或与等价证据不匹配。' };
    }
    const historicalFile = historicalEvidenceFile(candidate, evidence);
    const historicalRepoFile = repoRelativePath(gitContext.gitRoot, gitContext.workspaceRoot, historicalFile);
    const currentRepoFile = repoRelativePath(gitContext.gitRoot, gitContext.workspaceRoot, candidate.currentCandidate);
    if (!historicalRepoFile || !currentRepoFile) {
        return { verified: false, reason: '历史路径或当前路径不能安全映射到 Git 仓库内。' };
    }
    let currentContent;
    try {
        currentContent = fs.readFileSync(currentPath);
    } catch {
        return { verified: false, reason: '无法读取当前候选文件。' };
    }
    const historicalCommit = evidenceCommit(evidence, ['historicalCommit', 'oldCommit', 'commit', 'commitish', 'ref']);
    if (kind === 'git-rename-content-match') {
        const fromCommit = evidenceCommit(evidence, ['fromCommit', 'oldCommit', 'historicalCommit', 'baseCommit']);
        const toCommit = evidenceCommit(evidence, ['toCommit', 'newCommit', 'currentCommit', 'targetCommit']);
        if (!fromCommit || !toCommit) {
            return { verified: false, reason: 'Git rename 等价证据缺少 fromCommit 或 toCommit。' };
        }
        if (!gitRefIsAncestor(gitContext.gitRoot, fromCommit, toCommit)
            || !gitRefIsAncestor(gitContext.gitRoot, toCommit, 'HEAD')) {
            return { verified: false, reason: 'Git rename 提交范围不在当前 HEAD 的可达历史中。' };
        }
        try {
            const diff = gitOutput(gitContext.gitRoot, [
                'diff',
                '--find-renames=100%',
                '--name-status',
                '-z',
                fromCommit,
                toCommit,
                '--',
                historicalRepoFile,
                currentRepoFile,
            ], 'buffer').toString('utf8');
            const diffParts = diff.split('\u0000').filter(Boolean);
            let renameFound = false;
            for (let index = 0; index < diffParts.length; index += 1) {
                if (diffParts[index] !== 'R100') {
                    continue;
                }
                renameFound = normalizeText(diffParts[index + 1]) === normalizeText(historicalRepoFile)
                    && normalizeText(diffParts[index + 2]) === normalizeText(currentRepoFile);
                if (renameFound) {
                    break;
                }
            }
            if (!renameFound) {
                return { verified: false, reason: 'Git diff 未证明 R100 路径重命名。' };
            }
            const committedCurrent = readGitBlob(gitContext.gitRoot, toCommit, currentRepoFile);
            if (!committedCurrent || sha256(committedCurrent) !== sha256(currentContent)) {
                return { verified: false, reason: '当前工作区内容与 Git 目标提交内容不一致。' };
            }
            return { verified: true };
        } catch {
            return { verified: false, reason: 'Git rename 等价验证执行失败。' };
        }
    }
    if (!historicalCommit) {
        return { verified: false, reason: '等价证据缺少 historicalCommit。' };
    }
    if (!gitRefIsAncestor(gitContext.gitRoot, historicalCommit, 'HEAD')) {
        return { verified: false, reason: 'historicalCommit 不在当前 HEAD 的可达历史中。' };
    }
    const historicalContent = readGitBlob(gitContext.gitRoot, historicalCommit, historicalRepoFile);
    if (!historicalContent) {
        return { verified: false, reason: '无法从 Git 历史提交读取历史文件。' };
    }
    if (kind === 'content-hash-match') {
        return sha256(historicalContent) === sha256(currentContent)
            ? { verified: true }
            : { verified: false, reason: '历史文件与当前候选文件 SHA-256 不一致。' };
    }
    const historicalLanguage = scriptLanguageForPath(historicalFile);
    const currentLanguage = scriptLanguageForPath(candidate.currentCandidate);
    if (!historicalLanguage || !currentLanguage || historicalLanguage.family !== currentLanguage.family) {
        return { verified: false, reason: 'AST 等价验证要求两端使用兼容的 TypeScript/JavaScript 语言种类。' };
    }
    const historicalSignature = tokenSignature(historicalContent.toString('utf8'), historicalFile);
    const currentSignature = tokenSignature(currentContent.toString('utf8'), candidate.currentCandidate);
    if (!historicalSignature || !currentSignature) {
        return { verified: false, reason: 'TypeScript/JavaScript 源码解析失败，无法证明 AST 等价。' };
    }
    return historicalSignature === currentSignature
        ? { verified: true }
        : { verified: false, reason: '历史文件与当前候选文件的 token signature 不一致。' };
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
    verifyPathMigrationEquivalenceEvidence,
    verifyPathMigrationSourceEvidence,
    workspaceRelativePath,
};
