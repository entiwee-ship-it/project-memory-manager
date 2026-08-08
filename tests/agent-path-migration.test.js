const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
    currentFileExists,
    rankPathMigrationCandidates,
    resolvePathMigrationCandidates,
} = require('../src/agent/path-migration');

function findResult(results, historicalFile) {
    return results.find(item => item.historicalFile === historicalFile);
}

function testUniqueDirectoryMigration() {
    const historicalFile = 'app/modules/commodity.ts';
    const results = rankPathMigrationCandidates({
        historicalFiles: [historicalFile],
        currentFiles: ['app/application/modules/commodity.ts'],
    });
    const candidate = findResult(results, historicalFile);

    assert.equal(candidate.currentCandidate, 'app/application/modules/commodity.ts');
    assert.equal(candidate.confidence, 'high');
    assert.equal(candidate.status, 'candidate-found');
    assert.equal(candidate.confirmationRequired, true);
    assert.equal(candidate.equivalenceProven, false);
    assert.ok(candidate.evidence.some(item => item.kind === 'single-segment-directory-change'));
}

function testDirectorySeparatorMigration() {
    const historicalFile = 'xy-client/assets/script/game/lobby_view/LobbyViewComp.ts';
    const results = rankPathMigrationCandidates({
        historicalFiles: [historicalFile],
        currentFiles: ['xy-client/assets/script/game/lobby-view/LobbyViewComp.ts'],
    });
    const candidate = findResult(results, historicalFile);

    assert.equal(candidate.currentCandidate, 'xy-client/assets/script/game/lobby-view/LobbyViewComp.ts');
    assert.equal(candidate.confidence, 'high');
    assert.ok(candidate.evidence.some(item => item.kind === 'directory-separator-normalized'));
}

function testAmbiguousBasenameStaysUnconfirmed() {
    const historicalFile = 'src/legacy/LobbyViewComp.ts';
    const results = rankPathMigrationCandidates({
        historicalFiles: [historicalFile],
        currentFiles: [
            'src/new/LobbyViewComp.ts',
            'src/other/LobbyViewComp.ts',
        ],
    });
    const candidate = findResult(results, historicalFile);

    assert.equal(candidate.status, 'ambiguous');
    assert.equal(candidate.ambiguous, true);
    assert.equal(candidate.confidence, 'low');
    assert.equal(candidate.alternatives.length, 1);
}

function testRenameUsesHistoricalSymbolEvidence() {
    const historicalFile = 'src/legacy/NewLobbyViewComp.ts';
    const results = rankPathMigrationCandidates({
        historicalFiles: [historicalFile],
        currentFiles: [{
            file: 'src/new/LobbyViewComp.ts',
            symbols: ['LobbyViewComp', 'onLobbyShow'],
        }],
        historicalText: '新版大厅已迁移到 LobbyViewComp，并保留 onLobbyShow。',
    });
    const candidate = findResult(results, historicalFile);

    assert.equal(candidate.currentCandidate, 'src/new/LobbyViewComp.ts');
    assert.equal(candidate.confidence, 'medium');
    assert.ok(candidate.evidence.some(item => item.kind === 'historical-symbol-match'));
}

function testExtensionAndWorkspaceAreaChangesRemainCandidates() {
    const results = rankPathMigrationCandidates({
        historicalFiles: [
            'legacy/services/orderService.js',
            'src/modules/commodity.ts',
        ],
        currentFiles: [
            'legacy/services/orderService.ts',
            'app/modules/commodity.ts',
        ],
    });

    assert.equal(findResult(results, 'legacy/services/orderService.js').currentCandidate, 'legacy/services/orderService.ts');
    assert.equal(findResult(results, 'legacy/services/orderService.js').confidence, 'medium');
    assert.equal(findResult(results, 'src/modules/commodity.ts').currentCandidate, 'app/modules/commodity.ts');
    assert.equal(findResult(results, 'src/modules/commodity.ts').confidence, 'high');
}

function testDeletedAndOutsidePathsDoNotGuess() {
    const results = rankPathMigrationCandidates({
        historicalFiles: [
            'src/deleted/UnusedService.ts',
            '../codex-work/tests/external.test.cjs',
        ],
        currentFiles: ['src/current/ActiveService.ts'],
    });

    assert.equal(findResult(results, 'src/deleted/UnusedService.ts').status, 'not-found');
    assert.equal(findResult(results, 'src/deleted/UnusedService.ts').currentCandidate, '');
    assert.equal(findResult(results, '../codex-work/tests/external.test.cjs').status, 'outside-workspace');
    assert.equal(findResult(results, '../codex-work/tests/external.test.cjs').currentCandidate, '');
}

function testNonFreshKbCannotProduceCandidates() {
    const result = resolvePathMigrationCandidates({
        freshnessStatus: 'stale',
        historicalFiles: ['app/modules/commodity.ts'],
    });

    assert.deepEqual(result.candidates, []);
    assert.ok(result.warnings.some(item => item.includes('非 fresh')));
}

function testMissingScanArtifactReturnsWarning() {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-migration-workspace-'));
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-migration-data-'));
    const result = resolvePathMigrationCandidates({
        workspaceRoot,
        dataRoot,
        freshnessStatus: 'fresh',
        historicalFiles: ['src/legacy.ts'],
    });

    assert.deepEqual(result.candidates, []);
    assert.equal(result.warnings.length, 1);
    assert.ok(result.warnings[0].includes('scan artifact'));
}

function testSymlinkOutsideWorkspaceIsRejected() {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-migration-symlink-workspace-'));
    const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-migration-symlink-outside-'));
    fs.writeFileSync(path.join(outsideRoot, 'external.ts'), 'export const external = true;\n', 'utf8');
    const linkPath = path.join(workspaceRoot, 'linked');
    try {
        fs.symlinkSync(outsideRoot, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
        if (error?.code === 'EPERM' || error?.code === 'EACCES') {
            return;
        }
        throw error;
    }

    assert.equal(currentFileExists(workspaceRoot, 'linked/external.ts'), false);
}

testUniqueDirectoryMigration();
testDirectorySeparatorMigration();
testAmbiguousBasenameStaysUnconfirmed();
testRenameUsesHistoricalSymbolEvidence();
testExtensionAndWorkspaceAreaChangesRemainCandidates();
testDeletedAndOutsidePathsDoNotGuess();
testNonFreshKbCannotProduceCandidates();
testMissingScanArtifactReturnsWarning();
testSymlinkOutsideWorkspaceIsRejected();
console.log('agent path migration validation passed');
