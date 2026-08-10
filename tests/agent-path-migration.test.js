const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
    applyPathMigrationConfirmations,
    currentFileExists,
    confirmPathMigrationCandidate,
    rankPathMigrationCandidates,
    resolvePathMigrationCandidates,
    verifyPathMigrationEquivalenceEvidence,
    verifyPathMigrationSourceEvidence,
} = require('../src/agent/path-migration');

function findResult(results, historicalFile) {
    return results.find(item => item.historicalFile === historicalFile);
}

function gitCommand(repoRoot, args) {
    const result = spawnSync('git', ['-C', repoRoot, ...args], {
        encoding: 'utf8',
        windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr || ('git ' + args.join(' ') + ' failed'));
    return String(result.stdout || '').trim();
}

function createGitMigrationFixture({ modifiedRename = false } = {}) {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-migration-git-'));
    const historicalFile = 'src/legacy/Service.ts';
    const currentCandidate = 'src/current/Service.ts';
    const historicalContent = [
        '// legacy implementation',
        'export function calculateTotal(value: number) {',
        '    return value + 1;',
        '}',
        '',
    ].join('\n');
    fs.mkdirSync(path.join(workspaceRoot, 'src', 'legacy'), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, historicalFile), historicalContent, 'utf8');
    gitCommand(workspaceRoot, ['init', '--quiet']);
    gitCommand(workspaceRoot, ['config', 'user.email', 'pmm-tests@example.invalid']);
    gitCommand(workspaceRoot, ['config', 'user.name', 'PMM Tests']);
    gitCommand(workspaceRoot, ['add', '--all']);
    gitCommand(workspaceRoot, ['commit', '--quiet', '-m', 'legacy service']);
    const historicalCommit = gitCommand(workspaceRoot, ['rev-parse', 'HEAD']);

    fs.mkdirSync(path.join(workspaceRoot, 'src', 'current'), { recursive: true });
    gitCommand(workspaceRoot, ['mv', historicalFile, currentCandidate]);
    if (modifiedRename) {
        fs.writeFileSync(path.join(workspaceRoot, currentCandidate), historicalContent.replace('value + 1', 'value + 2'), 'utf8');
    }
    gitCommand(workspaceRoot, ['commit', '--quiet', '-am', 'move service']);
    const currentCommit = gitCommand(workspaceRoot, ['rev-parse', 'HEAD']);
    return {
        workspaceRoot,
        historicalFile,
        currentCandidate,
        historicalContent,
        historicalCommit,
        currentCommit,
    };
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

function testSourceConfirmationPromotesOnlyExplicitCandidate() {
    const candidate = findResult(rankPathMigrationCandidates({
        historicalFiles: ['app/modules/commodity.ts'],
        currentFiles: ['app/application/modules/commodity.ts'],
    }), 'app/modules/commodity.ts');
    const confirmed = confirmPathMigrationCandidate(candidate, {
        historicalFile: candidate.historicalFile,
        currentCandidate: candidate.currentCandidate,
        confirmationStatus: 'source-confirmed',
        evidence: [{ kind: 'source-read', file: candidate.currentCandidate, line: 1 }],
    }, {
        fileExists: () => true,
        verifySourceEvidence: () => true,
    });

    assert.equal(confirmed.sourceConfirmed, true);
    assert.equal(confirmed.confirmationStatus, 'source-confirmed');
    assert.equal(confirmed.confirmationRequired, false);
    assert.equal(confirmed.equivalenceProven, false);
    assert.equal(confirmed.confirmation.kind, 'source-confirmed');
    assert.equal(confirmed.confirmation.evidence[0].file, candidate.currentCandidate);
}

function testEquivalenceRequiresDedicatedEvidence() {
    const candidate = findResult(rankPathMigrationCandidates({
        historicalFiles: ['app/modules/commodity.ts'],
        currentFiles: ['app/application/modules/commodity.ts'],
    }), 'app/modules/commodity.ts');
    const weak = confirmPathMigrationCandidate(candidate, {
        historicalFile: candidate.historicalFile,
        currentCandidate: candidate.currentCandidate,
        confirmationStatus: 'equivalence-proven',
        evidence: [{ kind: 'source-read', file: candidate.currentCandidate }],
    }, {
        fileExists: () => true,
        verifySourceEvidence: () => true,
    });
    const strong = confirmPathMigrationCandidate(candidate, {
        historicalFile: candidate.historicalFile,
        currentCandidate: candidate.currentCandidate,
        confirmationStatus: 'equivalence-proven',
        evidence: [{ kind: 'content-hash-match', file: candidate.currentCandidate }],
    }, {
        fileExists: () => true,
        verifySourceEvidence: () => true,
        verifyEquivalenceEvidence: evidence => evidence.kind === 'content-hash-match',
    });

    assert.equal(weak.confirmationStatus, 'source-confirmed');
    assert.equal(weak.equivalenceProven, false);
    assert.equal(strong.confirmationStatus, 'equivalence-proven');
    assert.equal(strong.equivalenceProven, true);
}

function testInvalidConfirmationCannotPromoteCandidate() {
    const candidate = findResult(rankPathMigrationCandidates({
        historicalFiles: ['app/modules/commodity.ts'],
        currentFiles: ['app/application/modules/commodity.ts'],
    }), 'app/modules/commodity.ts');
    const rejected = confirmPathMigrationCandidate(candidate, {
        historicalFile: candidate.historicalFile,
        currentCandidate: candidate.currentCandidate,
        confirmationStatus: 'source-confirmed',
        evidence: [{ kind: 'source-read' }],
    }, { fileExists: () => false });

    assert.equal(rejected.sourceConfirmed, false);
    assert.equal(rejected.confirmationStatus, 'unconfirmed');
    assert.equal(rejected.confirmationRequired, true);
    assert.equal(rejected.confirmation.kind, 'confirmation-rejected');
}

function testDuplicateConfirmationsAreRejected() {
    const candidate = findResult(rankPathMigrationCandidates({
        historicalFiles: ['app/modules/commodity.ts'],
        currentFiles: ['app/application/modules/commodity.ts'],
    }), 'app/modules/commodity.ts');
    const confirmations = [1, 2].map(line => ({
        historicalFile: candidate.historicalFile,
        currentCandidate: candidate.currentCandidate,
        confirmationStatus: 'source-confirmed',
        evidence: [{ kind: 'source-read', file: candidate.currentCandidate, line }],
    }));
    const [rejected] = applyPathMigrationConfirmations(
        [candidate],
        confirmations,
        { fileExists: () => true }
    );

    assert.equal(rejected.sourceConfirmed, false);
    assert.equal(rejected.confirmationStatus, 'unconfirmed');
    assert.ok(rejected.confirmation.reason.includes('多个确认输入'));
}

function testSourceEvidenceIsVerifiedAgainstCurrentFile() {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-migration-source-evidence-'));
    const relativeFile = 'src/current.ts';
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, relativeFile), 'export const currentSymbol = true;\n', 'utf8');
    const candidate = { currentCandidate: relativeFile };

    assert.equal(verifyPathMigrationSourceEvidence(workspaceRoot, candidate, {
        kind: 'source-read',
        file: relativeFile,
        line: 1,
        contains: 'currentSymbol',
    }), true);
    assert.equal(verifyPathMigrationSourceEvidence(workspaceRoot, candidate, {
        kind: 'current-symbol-match',
        file: relativeFile,
        symbol: 'currentSymbol',
    }), true);
    assert.equal(verifyPathMigrationSourceEvidence(workspaceRoot, candidate, {
        kind: 'source-read',
        file: relativeFile,
        line: 99,
    }), false);
    assert.equal(verifyPathMigrationSourceEvidence(workspaceRoot, candidate, {
        kind: 'manual-confirmation',
        reason: '人工核对当前文件职责与历史任务一致',
    }), true);
}

function testInternalContentHashVerifier() {
    const fixture = createGitMigrationFixture();
    const candidate = {
        historicalFile: fixture.historicalFile,
        currentCandidate: fixture.currentCandidate,
    };
    const evidence = {
        kind: 'content-hash-match',
        historicalCommit: fixture.historicalCommit,
        historicalFile: fixture.historicalFile,
        historicalHash: 'caller-supplied-value-must-not-be-trusted',
    };
    const verified = verifyPathMigrationEquivalenceEvidence(fixture.workspaceRoot, candidate, evidence);
    assert.equal(verified.verified, true);

    fs.writeFileSync(
        path.join(fixture.workspaceRoot, fixture.currentCandidate),
        fixture.historicalContent.replace('value + 1', 'value + 2'),
        'utf8'
    );
    const changed = verifyPathMigrationEquivalenceEvidence(fixture.workspaceRoot, candidate, evidence);
    assert.equal(changed.verified, false);
    assert.ok(changed.reason.includes('SHA-256'));
}

function testGitRenameVerifierRequiresR100() {
    const exact = createGitMigrationFixture();
    const candidate = {
        historicalFile: exact.historicalFile,
        currentCandidate: exact.currentCandidate,
    };
    const evidence = {
        kind: 'git-rename-content-match',
        fromCommit: exact.historicalCommit,
        toCommit: exact.currentCommit,
        historicalFile: exact.historicalFile,
        currentFile: exact.currentCandidate,
    };
    assert.equal(verifyPathMigrationEquivalenceEvidence(exact.workspaceRoot, candidate, evidence).verified, true);

    const changed = createGitMigrationFixture({ modifiedRename: true });
    const changedCandidate = {
        historicalFile: changed.historicalFile,
        currentCandidate: changed.currentCandidate,
    };
    const changedEvidence = {
        ...evidence,
        fromCommit: changed.historicalCommit,
        toCommit: changed.currentCommit,
    };
    const result = verifyPathMigrationEquivalenceEvidence(changed.workspaceRoot, changedCandidate, changedEvidence);
    assert.equal(result.verified, false);
    assert.ok(result.reason.includes('R100'));
}

function testAstVerifierIgnoresCommentsAndFormatting() {
    const fixture = createGitMigrationFixture();
    const candidate = {
        historicalFile: fixture.historicalFile,
        currentCandidate: fixture.currentCandidate,
    };
    const evidence = {
        kind: 'ast-equivalence',
        historicalCommit: fixture.historicalCommit,
        historicalFile: fixture.historicalFile,
    };
    fs.writeFileSync(path.join(fixture.workspaceRoot, fixture.currentCandidate), [
        '/* current comment */',
        'export function calculateTotal( value : number ) { return value + 1; }',
        '',
    ].join('\n'), 'utf8');
    assert.equal(verifyPathMigrationEquivalenceEvidence(fixture.workspaceRoot, candidate, evidence).verified, true);

    fs.writeFileSync(path.join(fixture.workspaceRoot, fixture.currentCandidate), [
        'export function calculateTotal(value: number) {',
        '    return value + 2;',
        '}',
        '',
    ].join('\n'), 'utf8');
    const changed = verifyPathMigrationEquivalenceEvidence(fixture.workspaceRoot, candidate, evidence);
    assert.equal(changed.verified, false);
    assert.ok(changed.reason.includes('token signature'));

    const javascriptCandidate = 'src/current/Service.js';
    fs.writeFileSync(
        path.join(fixture.workspaceRoot, javascriptCandidate),
        fixture.historicalContent,
        'utf8'
    );
    const crossLanguage = verifyPathMigrationEquivalenceEvidence(fixture.workspaceRoot, {
        ...candidate,
        currentCandidate: javascriptCandidate,
    }, evidence);
    assert.equal(crossLanguage.verified, false);
    assert.ok(crossLanguage.reason.includes('语言种类'));
}

function testEquivalenceVerifierRejectsInvalidGitInputs() {
    const fixture = createGitMigrationFixture();
    const candidate = {
        historicalFile: fixture.historicalFile,
        currentCandidate: fixture.currentCandidate,
    };
    const invalidCommit = verifyPathMigrationEquivalenceEvidence(fixture.workspaceRoot, candidate, {
        kind: 'content-hash-match',
        historicalCommit: 'not a git ref',
        historicalFile: fixture.historicalFile,
    });
    assert.equal(invalidCommit.verified, false);
    const invalidPath = verifyPathMigrationEquivalenceEvidence(fixture.workspaceRoot, candidate, {
        kind: 'content-hash-match',
        historicalCommit: fixture.historicalCommit,
        historicalFile: '../outside.ts',
    });
    assert.equal(invalidPath.verified, false);
    const optionLikeRef = verifyPathMigrationEquivalenceEvidence(fixture.workspaceRoot, candidate, {
        kind: 'content-hash-match',
        historicalCommit: '--stat',
        historicalFile: fixture.historicalFile,
    });
    assert.equal(optionLikeRef.verified, false);

    const tree = gitCommand(fixture.workspaceRoot, ['rev-parse', fixture.historicalCommit + '^{tree}']);
    const unreachableCommit = gitCommand(fixture.workspaceRoot, [
        'commit-tree',
        tree,
        '-m',
        'unreachable evidence',
    ]);
    const unreachable = verifyPathMigrationEquivalenceEvidence(fixture.workspaceRoot, candidate, {
        kind: 'content-hash-match',
        historicalCommit: unreachableCommit,
        historicalFile: fixture.historicalFile,
    });
    assert.equal(unreachable.verified, false);
    assert.ok(unreachable.reason.includes('HEAD'));
}

function testInternalFailureKeepsSourceConfirmation() {
    const fixture = createGitMigrationFixture();
    const candidate = {
        historicalFile: fixture.historicalFile,
        currentCandidate: fixture.currentCandidate,
    };
    const confirmation = {
        historicalFile: fixture.historicalFile,
        currentCandidate: fixture.currentCandidate,
        confirmationStatus: 'equivalence-proven',
        evidence: [
            {
                kind: 'source-read',
                file: fixture.currentCandidate,
                line: 2,
                contains: 'calculateTotal',
            },
            {
                kind: 'content-hash-match',
                historicalCommit: fixture.historicalCommit,
                historicalFile: fixture.historicalFile,
            },
        ],
    };
    const options = {
        fileExists: file => currentFileExists(fixture.workspaceRoot, file),
        verifySourceEvidence: (evidence, migrationCandidate) => verifyPathMigrationSourceEvidence(
            fixture.workspaceRoot,
            migrationCandidate,
            evidence
        ),
        verifyEquivalenceEvidence: (evidence, migrationCandidate) => verifyPathMigrationEquivalenceEvidence(
            fixture.workspaceRoot,
            migrationCandidate,
            evidence
        ),
    };
    const proven = confirmPathMigrationCandidate(candidate, confirmation, options);
    assert.equal(proven.confirmationStatus, 'equivalence-proven');
    assert.equal(proven.equivalenceProven, true);

    fs.writeFileSync(
        path.join(fixture.workspaceRoot, fixture.currentCandidate),
        fixture.historicalContent.replace('value + 1', 'value + 2'),
        'utf8'
    );
    const downgraded = confirmPathMigrationCandidate(candidate, confirmation, options);
    assert.equal(downgraded.sourceConfirmed, true);
    assert.equal(downgraded.confirmationStatus, 'source-confirmed');
    assert.equal(downgraded.equivalenceProven, false);
    assert.ok(downgraded.confirmation.reason.includes('SHA-256'));
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
testSourceConfirmationPromotesOnlyExplicitCandidate();
testEquivalenceRequiresDedicatedEvidence();
testInvalidConfirmationCannotPromoteCandidate();
testDuplicateConfirmationsAreRejected();
testSourceEvidenceIsVerifiedAgainstCurrentFile();
testInternalContentHashVerifier();
testGitRenameVerifierRequiresR100();
testAstVerifierIgnoresCommentsAndFormatting();
testEquivalenceVerifierRejectsInvalidGitInputs();
testInternalFailureKeepsSourceConfirmation();
console.log('agent path migration validation passed');
