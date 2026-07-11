const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { loadExperienceFixtures } = require('./fixture-manifest');
const {
    aggregateExperienceResults,
    categorizeExperienceFailures,
    scoreEvidenceCoverage,
    scoreFileRecommendations,
    scoreMemoryRecall,
    scoreResumeCompleteness,
    scoreWorkflow,
} = require('./experience-metrics');
const { prepareAgentBrief, recallTaskMemory } = require('../../src/agent/memory-recall');
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
    const memory = recallTaskMemory(options);
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

function testFixtureContracts() {
    const fixtures = loadExperienceFixtures();
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
    }
}

function main() {
    testFixtureContracts();
    if (process.argv.includes('--fixtures-only')) {
        console.log('PMM experience fixture contracts passed');
        return;
    }

    const before = gitSnapshots();
    const fixtures = loadExperienceFixtures();
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
