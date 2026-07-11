const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { loadExperienceFixtures, validateExperienceFixture } = require('./fixture-manifest');
const {
    aggregateExperienceResults,
    categorizeExperienceFailures,
    scoreEvidenceCoverage,
    scoreFileRecommendations,
    scoreMemoryRecall,
    scoreResumeCompleteness,
    scoreWorkflow,
} = require('./experience-metrics');
const { prepareAgentBrief } = require('../../src/agent/memory-recall');
const { reviewPatchForAgent, validateEditScope } = require('../../src/agent/execution-loop');

const WORKSPACE_ROOT = process.env.PMM_EXPERIENCE_WORKSPACE || 'E:/xile-workspace/qyProject';
const DATA_ROOT = process.env.PMM_EXPERIENCE_DATA_ROOT || 'E:/xile-workspace/codex-tools/project-memory-data';
const REPOSITORIES = ['xy-client', 'qy-server', 'cms-client', 'cms-server'];

function gitSnapshots() {
    return Object.fromEntries(REPOSITORIES.map(repo => {
        const repoRoot = path.join(WORKSPACE_ROOT, repo);
        const status = execFileSync('git', ['-C', repoRoot, 'status', '--porcelain=v1', '-uall'], { encoding: 'utf8' });
        return [repo, status];
    }));
}

function runFixture(fixture) {
    const options = {
        workspaceRoot: WORKSPACE_ROOT,
        dataRoot: DATA_ROOT,
        task: fixture.task,
        knownFiles: fixture.knownFiles,
        changedFiles: fixture.changedFiles,
    };
    const startedAt = Date.now();
    const brief = prepareAgentBrief(options);
    const memory = brief.memory || { recalledTasks: [] };
    let review = null;
    let scope = null;
    if (fixture.intent === 'review') {
        review = reviewPatchForAgent(options);
        scope = validateEditScope(options);
    }
    const recommendedFiles = [
        ...(brief.recommendedFiles || []),
        ...(brief.executionPlan?.targetFiles || []),
        ...(review?.changedFiles || []),
        ...(scope?.changedFiles || []),
    ];
    const payload = { brief, memory, review, scope };
    const fileMetrics = scoreFileRecommendations(fixture, recommendedFiles);
    return {
        taskId: fixture.id,
        intent: fixture.intent,
        risk: fixture.risk,
        preflightStatus: brief.preflight?.status || 'unknown',
        fileMetrics,
        evidenceCoverage: scoreEvidenceCoverage(fixture, payload),
        workflowMetrics: scoreWorkflow(fixture, fileMetrics, brief),
        memoryMetrics: scoreMemoryRecall(fixture, memory.recalledTasks || []),
        resumeMetrics: scoreResumeCompleteness(fixture, payload),
        cost: {
            chars: JSON.stringify(payload).length,
            estimatedTokens: Math.ceil(JSON.stringify(payload).length / 4),
            elapsedMs: Date.now() - startedAt,
        },
    };
}

function writeJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function testFixtureContracts(options = {}) {
    const fixtures = loadExperienceFixtures(options);
    assert.equal(fixtures.length, 12);
    assert.deepEqual(new Set(fixtures.map(item => item.intent)), new Set([
        'understand',
        'implement',
        'debug',
        'resume',
        'review',
    ]));

    for (const fixture of fixtures) {
        assert.ok(fixture.requiredFiles.length > 0 || fixture.intent === 'resume');
        assert.equal(fixture.requiredFiles.some(file => /[*?]|actual |found/i.test(file)), false);
        assert.ok(Number.isInteger(fixture.directSourceBaseline.correctionRounds));
        assert.ok(Array.isArray(fixture.expectedMemory.taskFragments));
    }
}

function testPortableFixtureValidationDoesNotRequireQyProject() {
    const fixture = {
        id: 'portable-contract',
        task: '验证可移植 Experience fixture 合同',
        intent: 'understand',
        risk: 'low',
        knownFiles: [],
        changedFiles: [],
        requiredFiles: ['src/example.ts'],
        acceptedFiles: [],
        forbiddenDomains: [],
        requiredEvidence: { methods: [], endpoints: [], requests: [], messages: [], tables: [] },
        expectedValidation: [],
        expectedMemory: { taskFragments: [] },
        resumeExpectation: { completed: [], validation: [], remainingRisks: [], nextAction: '' },
        directSourceBaseline: { searchRounds: [], readFiles: [], correctionRounds: 0 },
    };

    assert.doesNotThrow(() => validateExperienceFixture(fixture, 'portable-contract.json', {
        checkPaths: false,
        workspaceRoot: 'Z:/missing-qy-project',
    }));
}

function testMemoryScoringContract() {
    const relevant = scoreMemoryRecall({
        intent: 'implement',
        expectedMemory: { taskFragments: ['新版大厅'] },
    }, [
        { task: '提交新版大厅当前 prefab 和素材位置调整' },
        { task: '整改新版大厅 BottomActionModule 按钮节点结构' },
    ]);
    assert.equal(relevant.expected, 1);
    assert.equal(relevant.matching, 2);
    assert.equal(relevant.precision, 1);

    const mixed = scoreMemoryRecall({
        intent: 'review',
        expectedMemory: { taskFragments: ['商品快照'] },
    }, [
        { task: '统一钻石充值交易商品快照来源' },
        { task: '修复后台验证码刷新链路' },
    ]);
    assert.equal(mixed.matching, 1);
    assert.equal(mixed.precision, 0.5);
}

function main() {
    const fixturesOnly = process.argv.includes('--fixtures-only');
    const skipPathCheck = process.argv.includes('--skip-path-check');
    testPortableFixtureValidationDoesNotRequireQyProject();
    testFixtureContracts({
        checkPaths: !skipPathCheck,
        workspaceRoot: WORKSPACE_ROOT,
    });
    testMemoryScoringContract();
    if (fixturesOnly) {
        console.log('PMM experience fixture contracts passed');
        return;
    }

    const before = gitSnapshots();
    const fixtures = loadExperienceFixtures({ workspaceRoot: WORKSPACE_ROOT });
    const results = fixtures.map(runFixture);
    const summary = aggregateExperienceResults(results);
    const failures = categorizeExperienceFailures(results);
    const report = { generatedAt: new Date().toISOString(), workspaceRoot: WORKSPACE_ROOT, results, summary, failures };
    const writeBaselineIndex = process.argv.indexOf('--write-baseline');
    if (writeBaselineIndex >= 0) {
        const target = process.argv[writeBaselineIndex + 1];
        assert.ok(target, '--write-baseline requires a target file');
        writeJson(path.resolve(target), report);
    }
    assert.deepEqual(gitSnapshots(), before, 'Experience Harness modified qyProject worktrees');

    console.log(JSON.stringify(summary, null, 2));
    const activeFailures = Object.fromEntries(Object.entries(failures).filter(([, items]) => items.length > 0));
    if (Object.keys(activeFailures).length > 0) {
        console.log(JSON.stringify({ failures: activeFailures }, null, 2));
    }
    if (writeBaselineIndex >= 0) {
        console.log(`PMM experience baseline written: ${path.resolve(process.argv[writeBaselineIndex + 1])}`);
        return;
    }

    assert.ok(summary.top5Recall >= 0.85, `Top-5 recall below gate: ${summary.top5Recall}`);
    assert.ok(summary.maxNoiseRatio <= 0.20, `noise ratio above gate: ${summary.maxNoiseRatio}`);
    assert.ok(summary.planAdoptableRate >= 0.80, `plan adoptable rate below gate: ${summary.planAdoptableRate}`);
    assert.ok(summary.memoryPrecision >= 0.90, `memory precision below gate: ${summary.memoryPrecision}`);
    assert.ok(summary.workflowImprovementRate >= 0.75, `workflow improvement below gate: ${summary.workflowImprovementRate}`);
    assert.equal(summary.highRiskCoreEvidenceMisses, 0, 'high-risk tasks missed core files');
    assert.equal(summary.resumeFailures, 0, 'resume result is incomplete');
    console.log('PMM experience value validation passed');
}

main();
