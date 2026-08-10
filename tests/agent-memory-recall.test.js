const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const {
    prepareAgentBrief,
    recallTaskMemory,
    summarizeProjectMemory,
    updateProjectPlaybook,
} = require('../src/agent/memory-recall');
const { projectAgentOutput } = require('../src/agent/output-projection');
const { requiredMcpToolsForVersion } = require('../src/agent/environment-health');
const { recordTaskOutcome } = require('../src/agent/execution-loop');
const { run: buildChainKb } = require('../src/graph/build-chain-kb');
const { createWorkspaceContext } = require('../src/shared/workspace-layout');
const { writeJsonAtomic } = require('../src/shared/common');
const { handleMcpRequest } = require('../src/mcp/server');

const repoRoot = path.resolve(__dirname, '..');

function createMemoryFixture() {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-memory-workspace-'));
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-memory-data-'));
    fs.mkdirSync(path.join(workspaceRoot, 'app', 'api', 'facebook', 'oauth', 'callback'), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, 'app', 'api', 'facebook', 'oauth', 'status'), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, 'app', 'api', 'chat'), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, 'app', 'chat'), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, 'app', 'application', 'modules', 'mallConfig'), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, 'app', 'application', 'payment', 'services'), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, 'package.json'), '{"scripts":{"test":"node --test"}}\n');
    fs.writeFileSync(path.join(workspaceRoot, 'app', 'api', 'facebook', 'oauth', 'callback', 'route.ts'), [
        "import { saveFacebookToken } from '../../../../../lib/facebook-client';",
        'export async function GET() { return saveFacebookToken(); }',
    ].join('\n'));
    fs.writeFileSync(path.join(workspaceRoot, 'app', 'api', 'facebook', 'oauth', 'status', 'route.ts'), 'export async function GET() { return { connected: true }; }\n');
    fs.writeFileSync(path.join(workspaceRoot, 'app', 'api', 'chat', 'route.ts'), 'export async function POST() { return { ok: true }; }\n');
    fs.writeFileSync(path.join(workspaceRoot, 'app', 'chat', 'page.tsx'), 'export default function ChatPage() { return null; }\n');
    fs.writeFileSync(path.join(workspaceRoot, 'app', 'application', 'modules', 'commodity.ts'), 'export function purchaseGoldenBeans() { return true; }\n');
    fs.writeFileSync(path.join(workspaceRoot, 'app', 'application', 'modules', 'mallConfig', 'mallRuntimeConfig.ts'), 'export class MallRuntimeConfig {}\n');
    fs.writeFileSync(path.join(workspaceRoot, 'app', 'application', 'modules', 'mallConfig', 'mallRechargeProductSnapshot.ts'), 'export function getRechargeProductSnapshot() { return {}; }\n');
    fs.writeFileSync(path.join(workspaceRoot, 'app', 'application', 'payment', 'services', 'orderService.ts'), 'export class OrderService {}\n');
    fs.writeFileSync(path.join(workspaceRoot, 'lib', 'facebook-client.ts'), 'export function saveFacebookToken() { return { ok: true }; }\n');

    const context = createWorkspaceContext({ workspaceRoot, dataRoot, layout: 'external-data' });
    const projectConfigPath = path.join(context.paths.configsDir, 'project-global.json');
    writeJsonAtomic(projectConfigPath, {
        featureKey: 'project-global',
        featureName: 'Project Global KB',
        type: 'project-global',
        registerFeature: false,
        methodRoots: ['app', 'lib'],
        outputs: {
            scan: path.join(context.paths.projectGlobalDir, 'scan.raw.json'),
            graph: path.join(context.paths.projectGlobalDir, 'chain.graph.json'),
            lookup: path.join(context.paths.projectGlobalDir, 'chain.lookup.json'),
            report: path.join(context.paths.projectGlobalDir, 'build.report.json'),
        },
    });
    buildChainKb([
        '--workspace-root', workspaceRoot,
        '--data-root', dataRoot,
        '--layout', 'external-data',
        '--config', projectConfigPath,
    ]);

    recordTaskOutcome({
        workspaceRoot,
        dataRoot,
        task: '修复 Facebook OAuth token 保存逻辑',
        outcome: '修复 callback 中 token 加密保存，并验证 status route',
        changedFiles: [
            'app/api/facebook/oauth/callback/route.ts',
            'app/api/facebook/oauth/status/route.ts',
            'lib/facebook-client.ts',
        ],
        validation: ['npm run test:oauth', 'npm run build'],
        observations: ['Facebook OAuth 修改必须复核 authorize/callback/status 三条 route'],
    });
    recordTaskOutcome({
        workspaceRoot,
        dataRoot,
        task: '修复 chat 流式回复错误处理',
        outcome: '补充 Anthropic stream 错误提示',
        changedFiles: ['app/api/chat/route.ts', 'app/chat/page.tsx'],
        validation: ['npm run test:chat'],
        observations: ['chat route 变更要复核 EventSource 客户端显示'],
    });
    recordTaskOutcome({
        workspaceRoot,
        dataRoot,
        task: '统一钻石充值交易商品快照来源',
        outcome: '完成商品快照统一并提交 e61e81d6',
        changedFiles: [
            'app/modules/commodity.ts',
            'app/modules/mallConfig/mallRuntimeConfig.ts',
            'app/modules/mallConfig/mallRechargeProductSnapshot.ts',
            'app/payment/services/orderService.ts',
        ],
        validation: ['mall-recharge-product-snapshot-contract.test.cjs 通过', 'npm run build:dev 通过'],
        observations: ['月卡 productId=17 仍使用数据库 fallback'],
        status: 'completed',
        remainingRisks: ['ProductInfo.typeOfExpenditure 与 schema.sql 历史类型不一致'],
        nextAction: '确认 e61e81d6 后决定是否清理 typeOfExpenditure 类型债',
    });
    updateProjectPlaybook({
        workspaceRoot,
        dataRoot,
        rule: '涉及 Facebook OAuth 时必须同时复核 authorize、callback、status route 和 token 加密边界。',
        category: 'oauth',
        source: 'test',
        changedFiles: ['app/api/facebook/oauth/callback/route.ts'],
    });
    return { workspaceRoot, dataRoot, projectConfigPath };
}

function assertIncludes(values, expected, message = '') {
    assert.ok(values.includes(expected), message || `expected ${JSON.stringify(values)} to include ${expected}`);
}

function gitCommand(repoRoot, args) {
    const result = spawnSync('git', ['-C', repoRoot, ...args], {
        encoding: 'utf8',
        windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr || ('git ' + args.join(' ') + ' failed'));
    return String(result.stdout || '').trim();
}

function createPathMigrationGitHistory(fixture) {
    const migrations = [
        ['app/modules/commodity.ts', 'app/application/modules/commodity.ts'],
        ['app/modules/mallConfig/mallRuntimeConfig.ts', 'app/application/modules/mallConfig/mallRuntimeConfig.ts'],
        ['app/modules/mallConfig/mallRechargeProductSnapshot.ts', 'app/application/modules/mallConfig/mallRechargeProductSnapshot.ts'],
        ['app/payment/services/orderService.ts', 'app/application/payment/services/orderService.ts'],
    ];
    gitCommand(fixture.workspaceRoot, ['init', '--quiet']);
    gitCommand(fixture.workspaceRoot, ['config', 'user.email', 'pmm-tests@example.invalid']);
    gitCommand(fixture.workspaceRoot, ['config', 'user.name', 'PMM Tests']);
    for (const [historicalFile, currentFile] of migrations) {
        fs.mkdirSync(path.dirname(path.join(fixture.workspaceRoot, historicalFile)), { recursive: true });
        fs.renameSync(
            path.join(fixture.workspaceRoot, currentFile),
            path.join(fixture.workspaceRoot, historicalFile)
        );
    }
    gitCommand(fixture.workspaceRoot, ['add', '--all']);
    gitCommand(fixture.workspaceRoot, ['commit', '--quiet', '-m', 'legacy paths']);
    const historicalCommit = gitCommand(fixture.workspaceRoot, ['rev-parse', 'HEAD']);

    for (const [historicalFile, currentFile] of migrations) {
        fs.mkdirSync(path.dirname(path.join(fixture.workspaceRoot, currentFile)), { recursive: true });
        fs.renameSync(
            path.join(fixture.workspaceRoot, historicalFile),
            path.join(fixture.workspaceRoot, currentFile)
        );
    }
    gitCommand(fixture.workspaceRoot, ['add', '--all']);
    gitCommand(fixture.workspaceRoot, ['commit', '--quiet', '-m', 'current paths']);
    const currentCommit = gitCommand(fixture.workspaceRoot, ['rev-parse', 'HEAD']);
    buildChainKb([
        '--workspace-root', fixture.workspaceRoot,
        '--data-root', fixture.dataRoot,
        '--layout', 'external-data',
        '--config', fixture.projectConfigPath,
    ]);
    return { historicalCommit, currentCommit };
}

function parseToolResult(response) {
    assert.equal(response.jsonrpc, '2.0');
    assert.ok(response.result);
    assert.equal(response.result.content[0].type, 'text');
    return JSON.parse(response.result.content[0].text);
}

async function callTool(name, args) {
    return handleMcpRequest({
        jsonrpc: '2.0',
        id: Math.floor(Math.random() * 100000),
        method: 'tools/call',
        params: { name, arguments: args },
    });
}

function testRecallTaskMemory(fixture) {
    const result = recallTaskMemory({
        workspaceRoot: fixture.workspaceRoot,
        dataRoot: fixture.dataRoot,
        task: '继续修复 Facebook OAuth token 保存',
    });
    assert.equal(result.kind, 'agent-memory-recall');
    assert.equal(result.totalOutcomeRecords, 3);
    assert.ok(result.recalledTasks.length >= 1);
    assert.equal(result.recalledTasks[0].task, '修复 Facebook OAuth token 保存逻辑');
    assertIncludes(result.relatedFiles.map(item => item.value), 'app/api/facebook/oauth/callback/route.ts');
    assertIncludes(result.validationCommands.map(item => item.value), 'npm run test:oauth');
    assert.ok(result.relevantRules.some(rule => rule.category === 'oauth'));
}

function testPrepareAgentBrief(fixture) {
    const result = prepareAgentBrief({
        workspaceRoot: fixture.workspaceRoot,
        dataRoot: fixture.dataRoot,
        task: '继续修复 Facebook OAuth token 保存',
    });
    assert.equal(result.kind, 'agent-brief');
    assert.equal(result.intent.intent, 'resume');
    assert.ok(['ready', 'needs_source_confirmation'].includes(result.readiness));
    assert.ok(Object.hasOwn(result, 'coverage'));
    assert.ok(Array.isArray(result.missingEvidence));
    assert.ok(Array.isArray(result.sourceConfirmation));
    assert.ok(Object.hasOwn(result, 'currentFacts'));
    assert.ok(Object.hasOwn(result, 'historicalExperience'));
    assert.ok(Object.hasOwn(result, 'projectRules'));
    assert.equal(JSON.stringify(result.currentFacts).includes('Facebook OAuth 修改必须'), false);
    assert.equal(JSON.stringify(result.historicalExperience).includes('kbFreshness'), false);
    assert.equal(result.pmmGate.decision, 'required');
    assert.ok(result.memory.recalledTasks.length >= 1);
    assertIncludes(result.recommendedFiles, 'app/api/facebook/oauth/callback/route.ts');
    assertIncludes(result.validation.recommendedCommands, 'npm run test:oauth');
    assert.ok(result.risksAndNotes.some(note => note.includes('Facebook OAuth')));
}

function testSimpleBriefSkipsHistory(fixture) {
    const result = prepareAgentBrief({
        workspaceRoot: fixture.workspaceRoot,
        dataRoot: fixture.dataRoot,
        task: '把按钮文案改成确定',
        knownFiles: ['app/chat/page.tsx'],
    });
    assert.equal(result.intent.intent, 'simple');
    assert.deepEqual(result.historicalExperience.recalledTasks, []);
}

function testResumeBriefCompleteness(fixture) {
    const result = prepareAgentBrief({
        workspaceRoot: fixture.workspaceRoot,
        dataRoot: fixture.dataRoot,
        task: '继续统一钻石充值交易商品快照来源',
    });
    const serialized = JSON.stringify(result.historicalExperience);
    assert.equal(result.intent.intent, 'resume');
    assert.ok(serialized.includes('e61e81d6'));
    assert.ok(serialized.includes('mall-recharge-product-snapshot-contract.test.cjs'));
    assert.ok(serialized.includes('typeOfExpenditure'));
    assert.ok(serialized.includes('确认 e61e81d6'));
    assert.equal(result.historicalExperience.recalledTasks.length, 1);
    assert.ok(result.historicalExperience.relatedFiles.some(item => item.value === 'app/modules/commodity.ts'));
    assert.deepEqual(result.executionPlan.targetFiles, []);
    assert.deepEqual(result.recommendedFiles, []);
    assert.ok(result.risksAndNotes.some(note => note.includes('app/modules/commodity.ts')));
    const expectedMigrations = new Map([
        ['app/modules/commodity.ts', 'app/application/modules/commodity.ts'],
        ['app/modules/mallConfig/mallRuntimeConfig.ts', 'app/application/modules/mallConfig/mallRuntimeConfig.ts'],
        ['app/modules/mallConfig/mallRechargeProductSnapshot.ts', 'app/application/modules/mallConfig/mallRechargeProductSnapshot.ts'],
        ['app/payment/services/orderService.ts', 'app/application/payment/services/orderService.ts'],
    ]);
    assert.equal(result.pathMigrationCandidates.length, expectedMigrations.size);
    for (const migration of result.pathMigrationCandidates) {
        assert.equal(migration.currentCandidate, expectedMigrations.get(migration.historicalFile));
        assert.equal(migration.confidence, 'high');
        assert.equal(migration.confirmationRequired, true);
        assert.equal(migration.equivalenceProven, false);
        assert.equal(JSON.stringify(result.currentFacts).includes(migration.currentCandidate), false);
    }
    const compact = projectAgentOutput(result, {}, 'prepare_agent_brief');
    assert.equal(compact.pathMigrationCandidates.length, expectedMigrations.size);
    for (const migration of compact.pathMigrationCandidates) {
        assert.equal(migration.currentCandidate, expectedMigrations.get(migration.historicalFile));
        assert.equal(migration.confirmationRequired, true);
        assert.equal(migration.equivalenceProven, false);
    }
    assert.deepEqual(compact.executionPlan.targetFiles, []);
    assert.deepEqual(compact.recommendedFiles, []);
    const compactLength = JSON.stringify(compact, null, 2).length;
    const compactBreakdown = Object.fromEntries(Object.entries(compact).map(([key, value]) => [key, JSON.stringify(value).length]));
    assert.ok(compactLength <= 4000, `compact agent brief exceeded budget: ${compactLength} ${JSON.stringify(compactBreakdown)}`);
    const full = projectAgentOutput(result, { detail: 'full' }, 'prepare_agent_brief');
    assert.equal(full.pathMigrationCandidates.length, expectedMigrations.size);
    assert.deepEqual(full.historicalExperience, result.historicalExperience);
}

function testResumeBriefAppliesExplicitPathConfirmation(fixture) {
    const result = prepareAgentBrief({
        workspaceRoot: fixture.workspaceRoot,
        dataRoot: fixture.dataRoot,
        task: '继续统一钻石充值交易商品快照来源',
        pathMigrationConfirmations: [{
            historicalFile: 'app/modules/commodity.ts',
            currentCandidate: 'app/application/modules/commodity.ts',
            confirmationStatus: 'source-confirmed',
            evidence: [{ kind: 'source-read', file: 'app/application/modules/commodity.ts', line: 1 }],
        }],
    });
    const confirmed = result.pathMigrationCandidates.find(item => item.historicalFile === 'app/modules/commodity.ts');

    assert.equal(confirmed.sourceConfirmed, true);
    assert.equal(confirmed.confirmationStatus, 'source-confirmed');
    assert.equal(confirmed.confirmationRequired, false);
    assert.equal(confirmed.equivalenceProven, false);
    assert.deepEqual(result.executionPlan.targetFiles, ['app/application/modules/commodity.ts']);
    assert.deepEqual(result.executionPlan.editBoundary.primaryFiles, ['app/application/modules/commodity.ts']);
    assert.deepEqual(result.recommendedFiles, ['app/application/modules/commodity.ts']);
    assert.deepEqual(result.currentFacts.criticalFiles, []);

    const compact = projectAgentOutput(result, {}, 'prepare_agent_brief');
    const compactConfirmed = compact.pathMigrationCandidates.find(item => item.historicalFile === 'app/modules/commodity.ts');
    assert.equal(compactConfirmed.sourceConfirmed, true);
    assert.equal(compactConfirmed.confirmationStatus, 'source-confirmed');
    assert.equal(compactConfirmed.equivalenceProven, false);
    assert.equal(compactConfirmed.confirmation.evidence[0].file, 'app/application/modules/commodity.ts');
    assert.deepEqual(compact.executionPlan.targetFiles, ['app/application/modules/commodity.ts']);
    assert.deepEqual(compact.recommendedFiles, ['app/application/modules/commodity.ts']);
    assert.ok(JSON.stringify(compact.sourceConfirmation).includes('source-confirmed'));
}

function testResumeBriefUsesInternalEquivalenceVerifier(fixture) {
    const history = createPathMigrationGitHistory(fixture);
    const confirmation = {
        historicalFile: 'app/modules/commodity.ts',
        currentCandidate: 'app/application/modules/commodity.ts',
        confirmationStatus: 'equivalence-proven',
        evidence: [
            {
                kind: 'source-read',
                file: 'app/application/modules/commodity.ts',
                line: 1,
                contains: 'purchaseGoldenBeans',
            },
            {
                kind: 'content-hash-match',
                historicalCommit: history.historicalCommit,
                historicalFile: 'app/modules/commodity.ts',
            },
        ],
    };
    const result = prepareAgentBrief({
        workspaceRoot: fixture.workspaceRoot,
        dataRoot: fixture.dataRoot,
        task: '继续统一钻石充值交易商品快照来源',
        pathMigrationConfirmations: [confirmation],
    });
    const proven = result.pathMigrationCandidates.find(item => item.historicalFile === confirmation.historicalFile);
    assert.equal(proven.sourceConfirmed, true);
    assert.equal(proven.confirmationStatus, 'equivalence-proven');
    assert.equal(proven.equivalenceProven, true);
    assert.deepEqual(result.executionPlan.targetFiles, [confirmation.currentCandidate]);
    assert.deepEqual(result.recommendedFiles, [confirmation.currentCandidate]);
    assert.deepEqual(result.currentFacts.criticalFiles, []);

    const rejectedResult = prepareAgentBrief({
        workspaceRoot: fixture.workspaceRoot,
        dataRoot: fixture.dataRoot,
        task: '继续统一钻石充值交易商品快照来源',
        pathMigrationConfirmations: [{
            ...confirmation,
            evidence: [
                confirmation.evidence[0],
                {
                    ...confirmation.evidence[1],
                    historicalCommit: 'invalid commit value',
                },
            ],
        }],
    });
    const downgraded = rejectedResult.pathMigrationCandidates.find(item => (
        item.historicalFile === confirmation.historicalFile
    ));
    assert.equal(downgraded.sourceConfirmed, true);
    assert.equal(downgraded.confirmationStatus, 'source-confirmed');
    assert.equal(downgraded.equivalenceProven, false);
    assert.ok(downgraded.confirmation.reason.includes('historicalCommit'));
    assert.deepEqual(rejectedResult.executionPlan.targetFiles, [confirmation.currentCandidate]);

    const compact = projectAgentOutput(rejectedResult, {}, 'prepare_agent_brief');
    const compactDowngraded = compact.pathMigrationCandidates.find(item => (
        item.historicalFile === confirmation.historicalFile
    ));
    assert.ok(compactDowngraded.confirmation.reason.includes('historicalCommit'));
}

function testResumeBriefIgnoresGenericTaskSuffix(fixture) {
    recordTaskOutcome({
        workspaceRoot: fixture.workspaceRoot,
        dataRoot: fixture.dataRoot,
        task: '统一会员礼包运行态商品快照来源，减少交易链路直接查询数据库。',
        outcome: '完成会员礼包商品快照统一并提交 abc12345',
        validation: ['member-gift-snapshot-contract.test.cjs 通过'],
        observations: ['月卡礼包仍使用数据库 fallback'],
        remainingRisks: ['礼包历史类型仍需单独清理'],
        status: 'completed',
    });
    const result = prepareAgentBrief({
        workspaceRoot: fixture.workspaceRoot,
        dataRoot: fixture.dataRoot,
        task: '继续统一会员礼包运行态商品快照来源任务',
    });
    const resume = result.historicalExperience.resume;

    assert.equal(result.intent.intent, 'resume');
    assert.equal(result.historicalExperience.recalledTasks.length, 1);
    assert.ok(resume.completed.some(item => item.includes('abc12345')));
    assert.ok(resume.validation.some(item => item.includes('member-gift-snapshot-contract.test.cjs')));
    assert.ok(resume.remainingRisks.some(item => item.includes('历史类型')));
    assert.ok(resume.nextAction.includes('确认 abc12345 和当前源码状态'));
}

function testReviewRecallPrioritizesChangedFiles(fixture) {
    const result = recallTaskMemory({
        workspaceRoot: fixture.workspaceRoot,
        dataRoot: fixture.dataRoot,
        task: '审查这些改动有没有漏改',
        changedFiles: ['app/payment/services/orderService.ts'],
        intent: 'review',
    });
    assert.equal(result.recalledTasks[0].task, '统一钻石充值交易商品快照来源');
}

function testRecallRejectsFileAliasOnlyMatches(fixture) {
    const unrelatedTask = 'cms-client 游戏运营工作区主题重构切片';
    recordTaskOutcome({
        workspaceRoot: fixture.workspaceRoot,
        dataRoot: fixture.dataRoot,
        task: unrelatedTask,
        outcome: '完成后台页面主题整理并复核登录页样式',
        changedFiles: [
            'cms-client/src/views/login/Login.vue',
            'cms-server/src/routes/system/authRoutes.ts',
        ],
        validation: ['npm run build'],
    });

    const result = recallTaskMemory({
        workspaceRoot: fixture.workspaceRoot,
        dataRoot: fixture.dataRoot,
        task: '排查后台登录验证码刷新链路',
    });

    assert.equal(result.recalledTasks.some(item => item.task === unrelatedTask), false);
}

function testPrepareAgentBriefPreflightBlocked() {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-memory-blocked-workspace-'));
    const dataRoot = path.join(os.tmpdir(), `pmm-memory-blocked-data-${Date.now()}`);
    const result = prepareAgentBrief({
        workspaceRoot,
        dataRoot,
        installedSkillRoot: repoRoot,
        runtimeTools: requiredMcpToolsForVersion(),
        task: '修复 API 鉴权写路径',
    });
    assert.equal(result.kind, 'agent-brief');
    assert.equal(result.preflight.status, 'blocked');
    assert.equal(result.executionPlan.contextStatus, 'preflight-blocked');
    assert.deepEqual(result.recommendedFiles, []);
    assert.deepEqual(result.pathMigrationCandidates, []);
    assert.equal(result.nextActions[0].type, result.preflight.nextAction.type);
    assert.equal(result.nextActions[0].action, result.preflight.nextAction.action);
}

function testResumeBriefStaleKbStaysCompact(fixture) {
    fs.writeFileSync(path.join(fixture.workspaceRoot, 'app', 'stale-marker.ts'), 'export const staleMarker = true;\n', 'utf8');
    const result = prepareAgentBrief({
        workspaceRoot: fixture.workspaceRoot,
        dataRoot: fixture.dataRoot,
        task: '继续统一钻石充值交易商品快照来源',
    });
    const compact = projectAgentOutput(result, {}, 'prepare_agent_brief');

    assert.equal(result.readiness, 'blocked');
    assert.deepEqual(result.pathMigrationCandidates, []);
    assert.deepEqual(compact.pathMigrationCandidates, []);
    assert.deepEqual(compact.executionPlan.targetFiles, []);
    assert.deepEqual(compact.recommendedFiles, []);
    assert.ok(JSON.stringify(compact, null, 2).length <= 4000);
}

function testAgentBriefCompactFiltersExternalDataRootFiles(fixture) {
    const externalFile = path.join(
        fixture.dataRoot,
        'workspaces',
        'sample',
        'docs',
        'project',
        'PROJECT_Overview.md'
    );
    const installedSkillDir = path.join(os.homedir(), '.agents', 'skills', 'project-memory-manager');
    const projected = projectAgentOutput({
        kind: 'agent-brief',
        workspaceRoot: fixture.workspaceRoot,
        dataRoot: fixture.dataRoot,
        task: '评估 PMM 输出噪声',
        preflight: {
            kind: 'agent-preflight',
            status: 'ready',
            health: { score: 100, checks: [] },
            findings: [],
            repairPlan: [],
            nextAction: null,
        },
        pmmGate: { decision: 'required', pmmRequired: true, deepPmmRequired: true },
        executionPlan: {
            contextStatus: 'context-ready',
            targetFiles: ['src/index.js', externalFile, installedSkillDir],
            editBoundary: {
                primaryFiles: ['src/index.js', externalFile, installedSkillDir],
                relatedRoots: [],
                guidance: [],
            },
            steps: [
                {
                    step: '复核目标文件',
                    action: 'inspect',
                    evidence: [{ kind: 'file', file: externalFile }],
                },
            ],
            validation: { recommendedCommands: ['npm test'] },
            uncertainties: [],
        },
        memory: {
            recalledTasks: [
                {
                    task: '升级已安装 skill 副本',
                    outcome: '误把安装副本当作源码目标',
                    changedFiles: [installedSkillDir, 'src/index.js'],
                    validation: [
                        'npm test',
                        `node ${path.join(installedSkillDir, 'src/bin/validate-package.js')} ${installedSkillDir}`,
                    ],
                },
            ],
            relatedFiles: [{ value: installedSkillDir }, { value: 'src/index.js' }],
            validationCommands: [
                { value: 'npm test' },
                { value: `node ${path.join(installedSkillDir, 'src/bin/agent-preflight.js')} --json` },
            ],
        },
        recommendedFiles: ['src/index.js', externalFile, installedSkillDir],
        validation: {
            recommendedCommands: [
                'npm test',
                `node ${path.join(installedSkillDir, 'src/bin/validate-package.js')} ${installedSkillDir}`,
            ],
        },
        risksAndNotes: [],
        nextActions: [],
        evidence: [{ kind: 'file', file: externalFile }],
    }, {}, 'prepare_agent_brief');
    const serialized = JSON.stringify(projected);

    assert.deepEqual(projected.recommendedFiles, ['src/index.js']);
    assert.deepEqual(projected.executionPlan.targetFiles, ['src/index.js']);
    assert.deepEqual(projected.executionPlan.editBoundary.primaryFiles, ['src/index.js']);
    assert.equal(serialized.includes('PROJECT_Overview.md'), false);
    assert.equal(serialized.includes('.agents'), false);
    assert.equal(projected.dataRoot, fixture.dataRoot);
}

function testAgentBriefCompactOmitsLongMigrationCandidatesAtomically(fixture) {
    const candidates = Array.from({ length: 8 }, (_, index) => ({
        historicalFile: `qy-server/game-server/app/${'legacy-segment/'.repeat(6)}module-${index}.ts`,
        currentCandidate: `qy-server/game-server/app/${'application-segment/'.repeat(6)}module-${index}.ts`,
        confidence: 'high',
        score: 95,
        status: 'candidate-found',
        ambiguous: false,
        confirmationRequired: true,
        equivalenceProven: false,
    }));
    const compact = projectAgentOutput({
        kind: 'agent-brief',
        workspaceRoot: fixture.workspaceRoot,
        dataRoot: fixture.dataRoot,
        task: '继续一个包含大量历史路径迁移候选的任务',
        intent: { intent: 'resume', confidence: 'high' },
        readiness: 'needs_source_confirmation',
        confidence: 'medium',
        coverage: {},
        missingEvidence: [],
        sourceConfirmation: [{ reason: '所有候选均需要确认当前源码和 Git 状态。' }],
        currentFacts: { criticalFiles: [] },
        historicalExperience: {
            resume: {
                status: 'completed',
                completed: ['历史任务已完成'],
                validation: ['历史测试已通过'],
                remainingRisks: ['候选路径尚未确认'],
                nextAction: '确认当前源码和 Git 状态',
            },
        },
        projectRules: { relevantRules: [] },
        preflight: { kind: 'agent-preflight', status: 'ready', health: { score: 100, checks: [] } },
        pmmGate: { decision: 'required', pmmRequired: true, deepPmmRequired: true },
        executionPlan: {
            contextStatus: 'resume-memory-ready',
            targetFiles: [],
            editBoundary: { primaryFiles: [], relatedRoots: [], guidance: [] },
            steps: [],
            validation: { recommendedCommands: [] },
            uncertainties: ['候选路径尚未确认'],
        },
        pathMigrationCandidates: candidates,
        recommendedFiles: [],
    }, {}, 'prepare_agent_brief');

    assert.ok(JSON.stringify(compact, null, 2).length <= 4000);
    assert.ok(compact.pathMigrationCandidates.length < candidates.length);
    assert.equal(compact._output.omittedPathMigrationCandidates, candidates.length - compact.pathMigrationCandidates.length);
    for (const candidate of compact.pathMigrationCandidates) {
        const original = candidates.find(item => item.historicalFile === candidate.historicalFile);
        assert.ok(original);
        assert.equal(candidate.currentCandidate, original.currentCandidate);
        assert.equal(candidate.historicalFile.includes('...'), false);
        assert.equal(candidate.currentCandidate.includes('...'), false);
    }
}

function testSummarizeProjectMemory(fixture) {
    const result = summarizeProjectMemory({
        workspaceRoot: fixture.workspaceRoot,
        dataRoot: fixture.dataRoot,
    });
    assert.equal(result.kind, 'agent-project-memory-summary');
    assert.equal(result.outcomeCount, 3);
    assert.equal(result.playbook.ruleCount, 1);
    assertIncludes(result.frequentFiles.map(item => item.value), 'app/api/chat/route.ts');
}

function testUpdateProjectPlaybookInference(fixture) {
    const result = updateProjectPlaybook({
        workspaceRoot: fixture.workspaceRoot,
        dataRoot: fixture.dataRoot,
        task: '修改 auth token session 逻辑',
        changedFiles: ['app/api/auth/login/route.ts'],
        outcome: '调整 JWT session 过期处理',
    });
    assert.equal(result.kind, 'agent-project-playbook-update');
    assert.ok(result.ruleCount >= 2);
    assert.ok(result.addedOrUpdated.some(rule => rule.category === 'security'));
}

function testCliFallback(fixture) {
    const child = spawnSync(process.execPath, [
        path.join(repoRoot, 'src/bin/recall-task-memory.js'),
        '--workspace-root', fixture.workspaceRoot,
        '--data-root', fixture.dataRoot,
        '--task', 'Facebook OAuth token 保存',
        '--json',
    ], {
        cwd: repoRoot,
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 20 * 1024 * 1024,
    });
    assert.equal(child.status, 0, child.stderr || child.stdout);
    const result = JSON.parse(child.stdout);
    assert.equal(result.kind, 'agent-memory-recall');
    assert.equal(result.recalledTasks[0].task, '修复 Facebook OAuth token 保存逻辑');
}

async function testMcpTools(fixture) {
    const listResponse = await handleMcpRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
    });
    const toolNames = listResponse.result.tools.map(tool => tool.name);
    for (const expected of [
        'recall_task_memory',
        'prepare_agent_brief',
        'summarize_project_memory',
        'update_project_playbook',
    ]) {
        assertIncludes(toolNames, expected);
    }
    const briefTool = listResponse.result.tools.find(tool => tool.name === 'prepare_agent_brief');
    assert.ok(briefTool.inputSchema.properties.pathMigrationConfirmations);

    const recall = parseToolResult(await callTool('recall_task_memory', {
        workspaceRoot: fixture.workspaceRoot,
        dataRoot: fixture.dataRoot,
        task: 'Facebook OAuth token 保存',
    }));
    assert.equal(recall.kind, 'agent-memory-recall');
    assert.equal(recall._mcpQuery.tool, 'recall_task_memory');
    assert.equal(recall.recalledTasks[0].task, '修复 Facebook OAuth token 保存逻辑');

    const brief = parseToolResult(await callTool('prepare_agent_brief', {
        workspaceRoot: fixture.workspaceRoot,
        dataRoot: fixture.dataRoot,
        task: '赠送活动 UI 小改',
        knownFiles: ['cms-client/src/views/mall/gift-activity/components/ProductStep.vue'],
    }));
    assert.equal(brief.kind, 'agent-brief');
    assert.equal(brief._mcpFreshness.policy, 'gate-only');

    const confirmedResume = parseToolResult(await callTool('prepare_agent_brief', {
        workspaceRoot: fixture.workspaceRoot,
        dataRoot: fixture.dataRoot,
        task: '继续统一钻石充值交易商品快照来源',
        detail: 'full',
        pathMigrationConfirmations: [{
            historicalFile: 'app/modules/commodity.ts',
            currentCandidate: 'app/application/modules/commodity.ts',
            confirmationStatus: 'source-confirmed',
            evidence: [{ kind: 'source-read', file: 'app/application/modules/commodity.ts', line: 1 }],
        }],
    }));
    assert.deepEqual(confirmedResume.executionPlan.targetFiles, ['app/application/modules/commodity.ts']);
    assert.deepEqual(confirmedResume.recommendedFiles, ['app/application/modules/commodity.ts']);
    assert.equal(confirmedResume.pathMigrationCandidates.find(item => (
        item.historicalFile === 'app/modules/commodity.ts'
    )).sourceConfirmed, true);
}

(async () => {
    const fixture = createMemoryFixture();
    testRecallTaskMemory(fixture);
    testPrepareAgentBrief(fixture);
    testSimpleBriefSkipsHistory(fixture);
    testResumeBriefCompleteness(fixture);
    testResumeBriefAppliesExplicitPathConfirmation(fixture);
    testResumeBriefUsesInternalEquivalenceVerifier(fixture);
    testReviewRecallPrioritizesChangedFiles(fixture);
    testPrepareAgentBriefPreflightBlocked();
    testAgentBriefCompactFiltersExternalDataRootFiles(fixture);
    testAgentBriefCompactOmitsLongMigrationCandidatesAtomically(fixture);
    testSummarizeProjectMemory(fixture);
    testUpdateProjectPlaybookInference(fixture);
    testCliFallback(fixture);
    await testMcpTools(fixture);
    testResumeBriefIgnoresGenericTaskSuffix(fixture);
    testRecallRejectsFileAliasOnlyMatches(fixture);
    testResumeBriefStaleKbStaysCompact(fixture);
    console.log('agent-memory-recall validation passed');
})().catch(error => {
    console.error(error.stack || error.message);
    process.exit(1);
});
