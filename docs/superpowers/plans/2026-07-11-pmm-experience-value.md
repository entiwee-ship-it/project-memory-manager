# PMM Experience Value Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PMM measurably improve real code-development understanding, safety, continuity, and review quality on 12 completed qyProject tasks, with explicit readiness gates instead of treating token reduction as the primary success signal.

**Architecture:** Add a test-only Experience Harness that scores current PMM output against source-verified qyProject fixtures, then add deterministic task-intent classification and evidence-based readiness calculation to the existing Agent pipeline. Keep current KB facts, historical experience, and project rules separated in every brief; production code must never import fixture answers or qyProject-specific expected paths.

**Tech Stack:** Node.js CommonJS, Node built-in `assert`/`node:test`, PMM project-global KB, external PMM data root, MCP JSON-RPC, JSON fixtures

**Execution Mode:** Inline execution in the current session. `E:/xile-workspace/AGENTS.md` prohibits automatically starting subagents, and the user has already approved starting implementation.

---

## File Structure

- Create `tests/experience/fixtures/*.json` for 12 source-verified qyProject task contracts. These files contain evaluation truth only and are never imported by production code.
- Create `tests/experience/fixture-manifest.js` to load and validate fixture schema, paths, intent values, risk values, and baseline-step definitions.
- Create `tests/experience/experience-metrics.js` for deterministic file recall, noise, evidence coverage, memory precision, resume completeness, workflow, and aggregate scoring.
- Create `tests/experience/pmm-experience-harness.test.js` to execute the PMM path, compare it with direct-source baselines, write reports to an ignored runtime directory, and enforce hard gates.
- Create `tests/experience/baselines/2026-07-11-current.json` to preserve the pre-fix result produced by the Harness before any production behavior changes.
- Create `src/agent/task-intent.js` for deterministic `understand|implement|debug|resume|review|simple` classification.
- Create `src/agent/brief-readiness.js` for intent-aware coverage, missing evidence, source-confirmation requirements, and `ready|needs_selector|needs_source_confirmation|blocked` decisions.
- Modify `src/agent/context-pack.js` to accept an intent profile and expose current-fact evidence without claiming unsupported dimensions.
- Modify `src/agent/memory-recall.js` to build mode-specific briefs and keep `currentFacts`, `historicalExperience`, and `projectRules` separate.
- Modify `src/agent/output-projection.js` to preserve intent/readiness quality fields in compact output.
- Modify `tests/agent-context-pack.test.js`, `tests/agent-memory-recall.test.js`, `tests/agent-execution-loop.test.js`, and `tests/mcp-server.test.js` for the new stable contracts.
- Modify `package.json` to add `test:experience` and include it in `test:all` without adding the expensive real-qyProject Harness to every narrow Agent test command.
- Modify `README.md`, `SKILL.md`, and `docs/reference/mcp-tools.md` after behavior passes.

## Locked Experience Corpus

Every fixture uses this required shape:

```json
{
  "id": "login-pinus-session",
  "task": "解释 HTTP 登录完成后如何建立 Pinus 游戏会话",
  "intent": "understand",
  "risk": "high",
  "knownFiles": [],
  "changedFiles": [],
  "requiredFiles": [],
  "acceptedFiles": [],
  "forbiddenDomains": [],
  "requiredEvidence": {
    "methods": [],
    "endpoints": [],
    "requests": [],
    "messages": [],
    "tables": []
  },
  "expectedValidation": [],
  "resumeExpectation": {
    "completed": [],
    "validation": [],
    "remainingRisks": [],
    "nextAction": ""
  },
  "directSourceBaseline": {
    "searchRounds": [],
    "readFiles": [],
    "correctionRounds": 0
  }
}
```

The 12 locked fixture files and their minimum source baselines are:

| Fixture | Intent | Required file baseline |
| --- | --- | --- |
| `01-login-pinus-session.json` | `understand` | `xy-client/assets/script/game/initialize/view/LoadingViewComp.ts`, `xy-client/assets/script/game/account/view/LoginViewComp.ts`, `xy-client/assets/script/game/account/UserApi.ts`, `xy-client/assets/script/network/session/GameSessionMgr.ts`, `qy-server/game-server/app/servers/pkcon/handler/handler.ts` |
| `02-cms-captcha-fullstack.json` | `debug` | `cms-client/src/views/login/Login.vue`, the actual captcha request module found under `cms-client/src/utils/api`, `cms-server/src/routes/system/authRoutes.ts`, `cms-server/src/controllers/system/authController.ts`, `cms-server/src/common/utils/captcha.ts` |
| `03-zhuanzhuan-hu-effect.json` | `understand` | `xy-client/assets/script/game/majiang/common/base/MaJiangBaseView.ts`, `xy-client/assets/script/game/majiang/common/component/EffectAniComp.ts`, `xy-client/assets/script/game/majiang/zhuanzhuan/ZhuanZhuanMJViewComp.ts` |
| `04-new-lobby-enter-animation.json` | `debug` | `xy-client/assets/script/game/common/ui/UINodeAnimation.ts`, `xy-client/assets/script/game/lobby/LobbyView.ts`, `xy-client/assets/script/game/lobby/newLobby/NewLobbyView.ts`, the registered new-lobby prefab resolved from `GameUIConfig.ts` |
| `05-new-lobby-head-frame.json` | `implement` | `xy-client/assets/script/game/common/HeadFrameComp.ts`, `xy-client/assets/script/game/lobby/newLobby/NewLobbyView.ts`, the actual new-lobby prefab, the nested head-frame prefab referenced by that prefab |
| `06-new-lobby-bottom-action.json` | `implement` | the actual new-lobby prefab, `E:/xile-workspace/codex-work/tests/xy-client/lobbyViewEntryPrefabContract.test.cjs` |
| `07-game-config-rule-defaults.json` | `implement` | `cms-client/src/views/gameManage/game/components/GameEdit.vue`, `cms-client/src/views/gameManage/game/components/GameSchemaEditor.vue`, `cms-client/src/views/gameManage/game/components/rule-designer/RuleCanvas.vue`, the backend schema/model files proven by source search |
| `08-cms-error-message-chinese.json` | `implement` | `cms-client/src/utils/ui/errorMessage.js`, `cms-server/src/utils/errorMessage.ts`, `cms-server/src/utils/requestErrorContext.ts` plus the actual caller files from changed scope |
| `09-mall-recharge-three-sides.json` | `understand` | `cms-client/src/views/mall/recharge/RechargeLadderList.vue`, `cms-server/src/models/mallManagement/rechargeLadderModel.ts`, `qy-server/game-server/app/modules/mallConfig/mallRuntimeConfig.ts`, `qy-server/game-server/schema.sql` |
| `10-mall-runtime-product-snapshot.json` | `review` | `qy-server/game-server/app/modules/commodity.ts`, `qy-server/game-server/app/modules/mallConfig/mallRuntimeConfig.ts`, `qy-server/game-server/app/modules/mallConfig/mallRechargeProductSnapshot.ts`, `qy-server/game-server/app/payment/services/orderService.ts`, `qy-server/game-server/schema.sql` |
| `11-resume-completed-task.json` | `resume` | no source answer may substitute for the recorded outcome; the fixture names the exact expected completed state, validations, residual risks, and first action |
| `12-review-changed-files-scope.json` | `review` | changed files from the recharge snapshot task plus expected callers/data boundary and explicit non-required frontend files |

For entries described as “actual ... found”, Task 1 must resolve and commit the exact path before the fixture test is allowed to pass. The committed fixture may not retain prose, glob patterns, or path alternatives in `requiredFiles`.

### Task 1: Build The Experience Harness And Preserve The Current Baseline

**Files:**
- Create: `tests/experience/fixtures/01-login-pinus-session.json`
- Create: `tests/experience/fixtures/02-cms-captcha-fullstack.json`
- Create: `tests/experience/fixtures/03-zhuanzhuan-hu-effect.json`
- Create: `tests/experience/fixtures/04-new-lobby-enter-animation.json`
- Create: `tests/experience/fixtures/05-new-lobby-head-frame.json`
- Create: `tests/experience/fixtures/06-new-lobby-bottom-action.json`
- Create: `tests/experience/fixtures/07-game-config-rule-defaults.json`
- Create: `tests/experience/fixtures/08-cms-error-message-chinese.json`
- Create: `tests/experience/fixtures/09-mall-recharge-three-sides.json`
- Create: `tests/experience/fixtures/10-mall-runtime-product-snapshot.json`
- Create: `tests/experience/fixtures/11-resume-completed-task.json`
- Create: `tests/experience/fixtures/12-review-changed-files-scope.json`
- Create: `tests/experience/fixture-manifest.js`
- Create: `tests/experience/experience-metrics.js`
- Create: `tests/experience/pmm-experience-harness.test.js`
- Create after baseline run: `tests/experience/baselines/2026-07-11-current.json`
- Modify: `package.json`

- [ ] **Step 1: Verify every source answer without writing qyProject**

Run these exact read-only searches from `E:/xile-workspace/qyProject` and copy only confirmed paths/methods into fixtures:

```powershell
rg -n "doLogin|ensureLoggedIn|authToken|pkcon" xy-client/assets/script qy-server/game-server/app
rg -n "captcha|验证码" cms-client/src cms-server/src
rg -n "onMJHu|showHuPaiFanXingEffect|getSpecialHuEffectType" xy-client/assets/script/game/majiang
rg -n "playEnterAnimations|pendingEnter|NewLobbyView|HeadFrame|BottomActionModule" xy-client/assets/script xy-client/assets/bundle
rg -n "default|默认值|ruleSchema|ruleConfig" cms-client/src/views/gameManage cms-server/src qy-server/game-server/app
rg -n "errorMessage|requestErrorContext" cms-client/src cms-server/src
rg -n "recharge_ladder|mallRuntimeConfig|mallRechargeProductSnapshot|typeOfExpenditure" cms-client/src cms-server/src qy-server/game-server
```

Expected: each fixture has non-empty exact `requiredFiles`; every listed path exists; no source file is modified.

- [ ] **Step 2: Write fixture schema tests first**

Implement `loadExperienceFixtures()` and `validateExperienceFixture()` in `fixture-manifest.js`, then assert:

```javascript
const fixtures = loadExperienceFixtures();
assert.equal(fixtures.length, 12);
assert.deepEqual(new Set(fixtures.map(item => item.intent)), new Set([
    'understand', 'implement', 'debug', 'resume', 'review',
]));
for (const fixture of fixtures) {
    assert.ok(fixture.requiredFiles.length > 0 || fixture.intent === 'resume');
    assert.equal(fixture.requiredFiles.some(file => /[*?]|actual |found/i.test(file)), false);
    assert.ok(Number.isInteger(fixture.directSourceBaseline.correctionRounds));
}
```

- [ ] **Step 3: Run the fixture test and verify RED**

Run:

```powershell
node tests/experience/pmm-experience-harness.test.js --fixtures-only
```

Expected: FAIL because the Harness and fixture files do not exist yet, then FAIL on each unresolved/invalid fixture until all source answers are exact.

- [ ] **Step 4: Implement deterministic scoring helpers**

Export exactly:

```javascript
module.exports = {
    aggregateExperienceResults,
    scoreEvidenceCoverage,
    scoreFileRecommendations,
    scoreMemoryRecall,
    scoreResumeCompleteness,
    scoreWorkflow,
};
```

Use these formulas:

```javascript
top5Recall = requiredFilesInTop5 / requiredFiles.length;
top10Recall = requiredFilesInTop10 / requiredFiles.length;
noiseRatio = unrelatedRecommendedFiles / recommendedFiles.length;
memoryPrecision = recalledExpectedRecords / Math.max(recalledRecords, 1);
workflowImproved = pmmSearchRounds + selectorRounds + correctionRounds
    < directSearchRounds + directCorrectionRounds;
```

Files in `acceptedFiles` are relevant but do not increase required-file recall. Files matching `forbiddenDomains` are always noise. Empty recommendations have `noiseRatio=0` but cannot pass recall.

- [ ] **Step 5: Implement Harness execution boundaries**

The Harness must call production exports (`prepareAgentBrief`, `prepareTaskContext`, `validateEditScope`, `reviewPatchForAgent`, `recallTaskMemory`) with:

```javascript
const QY_ROOT = process.env.PMM_EXPERIENCE_WORKSPACE || 'E:/xile-workspace/qyProject';
const DATA_ROOT = process.env.PMM_EXPERIENCE_DATA_ROOT || 'E:/xile-workspace/codex-tools/project-memory-data';
```

Write reports only under:

```javascript
const reportRoot = path.join(os.tmpdir(), 'pmm-experience-value');
```

The Harness must assert `git -C QY_ROOT status --porcelain` is byte-for-byte unchanged before and after execution.

- [ ] **Step 6: Add scripts and verify current behavior fails hard gates**

Add:

```json
"test:experience": "node tests/experience/pmm-experience-harness.test.js",
"test:experience:baseline": "node tests/experience/pmm-experience-harness.test.js --write-baseline tests/experience/baselines/2026-07-11-current.json"
```

Append `npm run test:experience` to `test:all`.

Run:

```powershell
npm run test:experience:baseline
npm run test:experience
```

Expected: baseline command exits 0 after writing factual metrics; gate command FAILS because current PMM does not yet satisfy all Experience Value thresholds. The failure output must name each failed task and metric.

- [ ] **Step 7: Confirm production isolation**

Run:

```powershell
rg -n "tests/experience|01-login-pinus-session|mall-runtime-product-snapshot" src
```

Expected: no matches.

- [ ] **Step 8: Commit the red baseline contract**

```powershell
git add tests/experience package.json
git commit -m "测试 PMM 真实开发体验基线"
```

### Task 2: Add Deterministic Task Intent Classification

**Files:**
- Create: `src/agent/task-intent.js`
- Create: `tests/agent-task-intent.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write classification tests**

Assert these exact contracts:

```javascript
assert.equal(classifyTaskIntent({ task: '解释 HTTP 登录到 Pinus 会话链路' }).intent, 'understand');
assert.equal(classifyTaskIntent({ task: '修复后台验证码偶尔不刷新' }).intent, 'debug');
assert.equal(classifyTaskIntent({ task: '实现商城充值商品快照统一来源' }).intent, 'implement');
assert.equal(classifyTaskIntent({ task: '继续上次大厅 prefab 调整' }).intent, 'resume');
assert.equal(classifyTaskIntent({ task: '审查这些改动有没有漏改', changedFiles: ['a.ts'] }).intent, 'review');
assert.equal(classifyTaskIntent({ task: '把按钮文案改成确定', knownFiles: ['View.vue'] }).intent, 'simple');
```

Also assert low-confidence ambiguous work defaults to `implement` and includes `reasons` plus `missingInputs`.

- [ ] **Step 2: Run the intent test and verify RED**

Run:

```powershell
node tests/agent-task-intent.test.js
```

Expected: FAIL with `Cannot find module '../src/agent/task-intent'`.

- [ ] **Step 3: Implement the classifier**

Export:

```javascript
module.exports = {
    INTENTS,
    classifyTaskIntent,
};
```

Return:

```javascript
{
    intent: 'implement',
    confidence: 'high',
    score: 8,
    reasons: ['matched:实现', 'changed-files:0', 'known-files:0'],
    missingInputs: [],
}
```

Use deterministic weighted cues. Explicit `intent` wins after validation. `changedFiles` plus review words wins `review`; resume words plus a task/history identifier wins `resume`; symptom/failure words win `debug`; explanation/trace words win `understand`; edit/build words win `implement`; only a low-risk request with one or two `knownFiles` and no API/data/auth/transaction cue may return `simple`.

- [ ] **Step 4: Run GREEN and Agent regression**

```powershell
node tests/agent-task-intent.test.js
npm run test:agent
```

Expected: PASS.

- [ ] **Step 5: Register test and commit**

Append `node tests/agent-task-intent.test.js` to `test:agent`, then:

```powershell
git add src/agent/task-intent.js tests/agent-task-intent.test.js package.json
git commit -m "增加 PMM 任务意图分类"
```

### Task 3: Add Intent-Aware Readiness And Evidence Coverage

**Files:**
- Create: `src/agent/brief-readiness.js`
- Create: `tests/agent-brief-readiness.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write readiness RED tests**

Cover these exact outcomes:

```javascript
assert.equal(evaluateBriefReadiness({ intent: 'implement', freshness: 'stale' }).readiness, 'blocked');
assert.equal(evaluateBriefReadiness({ intent: 'understand', ambiguityCount: 2 }).readiness, 'needs_selector');
assert.equal(evaluateBriefReadiness({
    intent: 'implement', risk: 'high', freshness: 'fresh', files: ['ui.vue'], callers: [], backend: [], tables: [],
}).readiness, 'needs_source_confirmation');
assert.equal(evaluateBriefReadiness({
    intent: 'simple', freshness: 'fresh', files: ['View.vue'], validationCommands: ['npm test'],
}).readiness, 'ready');
```

Assert that non-applicable dimensions are `null`, not `false`.

- [ ] **Step 2: Run RED**

```powershell
node tests/agent-brief-readiness.test.js
```

Expected: FAIL because `brief-readiness.js` does not exist.

- [ ] **Step 3: Implement readiness profiles**

Export:

```javascript
module.exports = {
    READINESS_VALUES,
    buildCoverage,
    evaluateBriefReadiness,
};
```

Use per-intent required dimensions:

```javascript
const REQUIRED_COVERAGE = {
    understand: ['entrypoint', 'implementation'],
    implement: ['entrypoint', 'implementation', 'callers', 'validation'],
    debug: ['entrypoint', 'implementation', 'validation'],
    resume: ['validation'],
    review: ['implementation', 'callers', 'validation'],
    simple: ['implementation', 'validation'],
};
```

For high-risk `implement|debug|review`, set `backend` and `data` applicable when task terms, evidence node types, changed paths, or gate reasons indicate API/auth/database/payment/config effects. Missing applicable dimensions must appear as structured objects:

```javascript
{ dimension: 'backend', reason: 'high-risk task has no endpoint or backend implementation evidence', recommendedSelector: { type: 'endpoint' } }
```

- [ ] **Step 4: Run GREEN and commit**

```powershell
node tests/agent-brief-readiness.test.js
npm run test:agent
git add src/agent/brief-readiness.js tests/agent-brief-readiness.test.js package.json
git commit -m "增加 PMM Brief 证据就绪门禁"
```

### Task 4: Make Task Context Intent-Aware Without Mixing Historical Facts

**Files:**
- Modify: `src/agent/context-pack.js`
- Modify: `tests/agent-context-pack.test.js`
- Test: `tests/experience/pmm-experience-harness.test.js`

- [ ] **Step 1: Write failing context contracts**

Add assertions that `prepareTaskContext()` returns:

```javascript
{
    intent: { intent: 'debug', confidence: 'high', reasons: [] },
    currentFacts: {
        relevantFeatures: [],
        keyEntrypoints: { endpoints: [], requests: [], methods: [] },
        criticalFiles: [],
        callChains: [],
        dataAccess: {},
        externalServices: [],
    },
    coverage: {},
    sourceConfirmation: [],
}
```

Keep existing top-level fields during this phase for compatibility, but assert `currentFacts` is built from the same arrays and contains no `outcome`, `observations`, or playbook rule text.

- [ ] **Step 2: Verify RED**

```powershell
node tests/agent-context-pack.test.js
```

Expected: FAIL because `intent`, `currentFacts`, `coverage`, and `sourceConfirmation` do not exist.

- [ ] **Step 3: Integrate classification and coverage**

At the beginning of `prepareTaskContext(options)`, call:

```javascript
const intent = classifyTaskIntent(options);
```

After evidence collection, call `buildCoverage()` with actual endpoint/request/method/table/external-service/caller/validation arrays. Do not manufacture evidence from task terms. Add selector recommendations only when multiple high-scoring nodes share the same normalized name or when the top two score difference is below the ambiguity threshold.

- [ ] **Step 4: Use mode-specific fact limits**

Apply these deterministic defaults unless `options.limit` is explicit:

```javascript
const INTENT_LIMITS = {
    understand: 8,
    implement: 10,
    debug: 10,
    resume: 4,
    review: 12,
    simple: 3,
};
```

For `simple`, skip graph traversal when all `knownFiles` exist and Usage Gate allows skip; still return validation and scope-review guidance. For `review`, seed ranking with `changedFiles`. For `resume`, do not claim completed state in current facts.

- [ ] **Step 5: Run targeted GREEN and Experience delta**

```powershell
node tests/agent-context-pack.test.js
npm run test:experience
```

Expected: context tests PASS. Experience may still FAIL, but file/evidence failures must not regress from the saved baseline.

- [ ] **Step 6: Commit**

```powershell
git add src/agent/context-pack.js tests/agent-context-pack.test.js
git commit -m "按任务意图组织 PMM 当前事实"
```

### Task 5: Build Mode-Specific Agent Briefs And Safe Memory Recall

**Files:**
- Modify: `src/agent/memory-recall.js`
- Modify: `tests/agent-memory-recall.test.js`
- Modify: `tests/agent-execution-loop.test.js`
- Test: `tests/experience/pmm-experience-harness.test.js`

- [ ] **Step 1: Write failing brief separation tests**

Assert every non-blocked brief has exactly these three sections:

```javascript
assert.deepEqual(Object.keys(brief).filter(key => [
    'currentFacts', 'historicalExperience', 'projectRules',
].includes(key)).sort(), [
    'currentFacts', 'historicalExperience', 'projectRules',
]);
assert.equal(JSON.stringify(brief.currentFacts).includes('历史任务'), false);
assert.equal(JSON.stringify(brief.historicalExperience).includes('kbFreshness'), false);
```

Assert `brief.intent`, `brief.readiness`, `brief.confidence`, `brief.coverage`, `brief.missingEvidence`, and `brief.sourceConfirmation` always exist.

- [ ] **Step 2: Write mode-specific RED tests**

Assert:

```javascript
assert.ok(understand.currentFacts.callChains.length > 0);
assert.ok(implement.executionPlan.editBoundary.primaryFiles.length > 0);
assert.ok(debug.nextActions.some(item => /验证|日志|配置|复现/.test(item)));
assert.deepEqual(simple.historicalExperience.recalledTasks, []);
assert.ok(review.currentFacts.changedFiles.length > 0);
```

For resume, record an outcome containing completed state, validation, observations, and next action, then assert all four are returned from the same record and no unrelated recent record appears.

- [ ] **Step 3: Verify RED**

```powershell
node tests/agent-memory-recall.test.js
node tests/agent-execution-loop.test.js
```

Expected: FAIL on missing separated sections and mode-specific fields.

- [ ] **Step 4: Refactor `prepareAgentBrief()` minimally**

Use this assembly order:

```javascript
const intent = classifyTaskIntent(options);
const context = intent.intent === 'resume'
    ? null
    : prepareTaskContext({ ...options, intent: intent.intent });
const memory = recallTaskMemory({ ...options, task, intent: intent.intent });
const readiness = evaluateBriefReadiness(buildReadinessInput(...));
```

Map data as:

```javascript
currentFacts = context ? context.currentFacts : { changedFiles: options.changedFiles || [] };
historicalExperience = {
    recalledTasks: memory.recalledTasks,
    relatedFiles: memory.relatedFiles,
    validationCommands: memory.validationCommands,
    observations: memory.observations,
};
projectRules = { relevantRules: memory.relevantRules };
```

Do not let `memory.recalledTasks` raise source confidence or satisfy current-fact coverage.

- [ ] **Step 5: Tighten recall by intent**

Implement these rules:

- `simple`: no history recall unless `options.includeHistory === true`.
- `resume`: require exact task id, exact normalized task match, or at least one changed-file overlap plus strong semantic match.
- `review`: prioritize changed-file overlap before task text score.
- `understand|implement|debug`: preserve current semantic threshold and cap results at three.
- no positive match: return an empty array, even when recent records exist.

- [ ] **Step 6: Run GREEN and Experience delta**

```powershell
npm run test:agent
npm run test:experience
```

Expected: Agent tests PASS. Historical precision and resume completeness pass; remaining failures are file coverage, noise, workflow, or plan adoption only.

- [ ] **Step 7: Commit**

```powershell
git add src/agent/memory-recall.js tests/agent-memory-recall.test.js tests/agent-execution-loop.test.js
git commit -m "按任务模式生成 PMM Agent Brief"
```

### Task 6: Preserve Quality Gates Through Compact Projection And MCP

**Files:**
- Modify: `src/agent/output-projection.js`
- Modify: `tests/agent-token-efficiency.test.js`
- Modify: `tests/mcp-server.test.js`

- [ ] **Step 1: Write compact projection RED tests**

For `prepare_agent_brief`, assert compact output preserves:

```javascript
for (const field of [
    'intent', 'readiness', 'confidence', 'coverage', 'missingEvidence', 'sourceConfirmation',
]) {
    assert.ok(Object.hasOwn(compactBrief, field), `missing ${field}`);
}
assert.ok(Object.hasOwn(compactBrief, 'currentFacts'));
assert.ok(Object.hasOwn(compactBrief, 'historicalExperience'));
assert.ok(Object.hasOwn(compactBrief, 'projectRules'));
```

Assert the serialized compact brief remains at or below 4,000 characters.

- [ ] **Step 2: Write MCP compatibility RED tests**

Call `prepare_agent_brief` through `handleMcpRequest()` and assert compact/full responses carry identical intent/readiness values. Assert blocked preflight always projects `readiness: 'blocked'` and does not include executable target files.

- [ ] **Step 3: Run RED**

```powershell
npm run test:token-roi
npm run test:mcp
```

Expected: FAIL because the compact projection does not yet preserve the new quality fields/sections.

- [ ] **Step 4: Update projection structurally**

Modify `compactAgentBrief()` to preserve the six quality fields before budget reduction. Bound arrays in this priority order:

1. Never remove `readiness`, `missingEvidence`, or `sourceConfirmation`.
2. Keep all required critical files up to the compact file limit.
3. Reduce historical observations and project rules before current facts.
4. Remove duplicate legacy top-level fields only after full compatibility tests confirm `detail=full` is unchanged.

- [ ] **Step 5: Run GREEN and commit**

```powershell
npm run test:token-roi
npm run test:mcp
git add src/agent/output-projection.js tests/agent-token-efficiency.test.js tests/mcp-server.test.js
git commit -m "保留 PMM 紧凑输出质量门禁"
```

### Task 7: Drive Remaining Experience Failures To The Hard Gates

**Files:**
- Modify only when a failing fixture proves the need: `src/agent/task-terms.js`
- Modify only when a failing fixture proves the need: `src/agent/context-pack.js`
- Modify only when a failing fixture proves the need: `src/agent/brief-readiness.js`
- Modify only when a failing fixture proves the need: `src/agent/memory-recall.js`
- Modify: `tests/experience/pmm-experience-harness.test.js`
- Modify: relevant `tests/experience/fixtures/*.json` only to correct source truth, never to lower expectations

- [ ] **Step 1: Produce a categorized failing report**

Run:

```powershell
npm run test:experience
```

The report must group failures into exactly:

```text
missing_required_file
high_risk_evidence_gap
cross_domain_noise
plan_not_adoptable
memory_false_positive
resume_incomplete
workflow_not_improved
```

- [ ] **Step 2: Fix one category at a time under TDD**

For each category, add one minimal failing assertion to the fixture/Harness or Agent test before production edits. Run the narrow test to observe the expected failure, make the smallest generic production change, rerun the narrow test, then rerun `npm run test:experience`.

Allowed generic fixes are limited to:

- add deterministic task aliases in `task-terms.js` when a business synonym is absent;
- increase caller/endpoint/table traversal only for intents that require that evidence;
- seed review ranking with changed files and their graph neighbors;
- lower readiness when required evidence is missing instead of inventing a plan;
- remove cross-domain results when they have no matched term, graph edge, changed-file relation, or accepted feature root;
- add selector guidance when same-name/near-score ambiguity exists.

Forbidden fixes:

- matching fixture ids or fixture filenames in `src`;
- hard-coding qyProject expected file paths in production;
- importing anything under `tests/experience` from `src`;
- deleting evidence to pass token budgets;
- changing fixture truth merely because PMM failed to find it.

- [ ] **Step 3: Enforce final aggregate gates**

The final Harness must assert:

```javascript
assert.ok(summary.top5Recall >= 0.85);
assert.ok(summary.maxNoiseRatio <= 0.20);
assert.ok(summary.planAdoptableRate >= 0.80);
assert.ok(summary.memoryPrecision >= 0.90);
assert.ok(summary.workflowImprovementRate >= 0.75);
assert.equal(summary.highRiskCoreEvidenceMisses, 0);
assert.equal(summary.resumeFailures, 0);
```

It must also print the worst task for each metric, not only averages.

- [ ] **Step 4: Run full Agent/MCP regression after every generic fix batch**

```powershell
npm run test:agent
npm run test:mcp
npm run test:experience
```

Expected: all PASS before documentation starts.

- [ ] **Step 5: Commit the experience-driven fixes**

Stage only files actually changed by failing categories:

```powershell
git add src/agent tests/experience tests/agent-*.test.js
git commit -m "修复 PMM 真实开发体验缺口"
```

### Task 8: Document, Rebuild, Self-Review, Push, And Wait For CI

**Files:**
- Modify: `README.md`
- Modify: `SKILL.md`
- Modify: `docs/reference/mcp-tools.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/plans/2026-07-11-pmm-experience-value.md`

- [ ] **Step 1: Document the usage decision contract**

Document:

- deep PMM is the default for cross-module understanding, debug, high-risk implementation, resume, and review;
- `simple` uses only Usage Gate plus known files and final scope validation;
- `readiness !== ready` forbids presenting the brief as an executable plan;
- `currentFacts`, `historicalExperience`, and `projectRules` have different authority;
- token/latency remain secondary metrics;
- `npm run test:experience` is the release gate for Experience Value.

- [ ] **Step 2: Run documentation and isolation checks**

```powershell
rg -n "T[B]D|TO[D]O|implement la[t]er|fill in detai[l]s" docs/superpowers/specs/2026-07-11-pmm-experience-value-design.md docs/superpowers/plans/2026-07-11-pmm-experience-value.md
rg -n "tests/experience|01-login-pinus-session|mall-runtime-product-snapshot" src
git diff --check
```

Expected: no placeholder matches, no production fixture references, no whitespace errors.

- [ ] **Step 3: Run complete local verification**

```powershell
npm run test:experience
npm run test:agent
npm run test:mcp
npm run test:all
node src/bin/validate-package.js .
git diff --check
```

Expected: all exit 0.

- [ ] **Step 4: Rebuild qyProject KB and rerun the real corpus**

```powershell
node src/bin/rebuild-kbs.js --workspace-root E:/xile-workspace/qyProject --data-root E:/xile-workspace/codex-tools/project-memory-data
npm run test:experience
```

Expected: qyProject project-global freshness is `fresh`; all Experience gates still pass using the rebuilt KB.

- [ ] **Step 5: Rebuild PMM's own KB and run self-review**

```powershell
node src/bin/rebuild-kbs.js --workspace-root E:/xile-workspace/codex-tools/project-memory-manager --data-root E:/xile-workspace/codex-tools/project-memory-data
node src/bin/validate-edit-scope.js --workspace-root E:/xile-workspace/codex-tools/project-memory-manager --data-root E:/xile-workspace/codex-tools/project-memory-data --task "提升 PMM 真实开发体验价值" --changed-file src/agent/task-intent.js --changed-file src/agent/brief-readiness.js --changed-file src/agent/context-pack.js --changed-file src/agent/memory-recall.js --changed-file src/agent/output-projection.js
node src/bin/review-patch-for-agent.js --workspace-root E:/xile-workspace/codex-tools/project-memory-manager --data-root E:/xile-workspace/codex-tools/project-memory-data --task "提升 PMM 真实开发体验价值" --changed-file src/agent/task-intent.js --changed-file src/agent/brief-readiness.js --changed-file src/agent/context-pack.js --changed-file src/agent/memory-recall.js --changed-file src/agent/output-projection.js
```

Expected: no unresolved high/medium code finding. Scope warnings caused only by tests/docs must be manually reconciled and recorded.

- [ ] **Step 6: Record the final decision in this plan**

Add a completion report with:

- all aggregate metrics and worst tasks;
- tasks where PMM should be default;
- tasks where only Usage Gate is justified;
- tasks where direct source remains more reliable;
- current baseline versus final search/correction rounds;
- any metric not met. If any hard gate is not met, leave the plan incomplete and state that PMM is not yet proven as the default entry.

- [ ] **Step 7: Commit documentation and final report**

```powershell
git add README.md SKILL.md CHANGELOG.md docs/reference/mcp-tools.md docs/superpowers/plans/2026-07-11-pmm-experience-value.md
git commit -m "记录 PMM 真实开发体验合同"
```

- [ ] **Step 8: Push all local commits and wait for CI**

```powershell
git status --short --branch
git push origin main
```

Wait for GitHub Actions to finish successfully. If CI fails, reproduce the failing command locally, add a RED regression when applicable, fix minimally, rerun complete verification, commit, and push again.

- [ ] **Step 9: Record the PMM task outcome**

Use `record_task_outcome` or the CLI fallback with actual changed files, verification commands, final Experience metrics, default-use recommendation, and residual risks. Do not record the task as complete before CI is green.
