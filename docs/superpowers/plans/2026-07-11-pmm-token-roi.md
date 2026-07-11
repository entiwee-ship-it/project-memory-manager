# PMM Token ROI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PMM produce accurate Chinese task context and bounded compact MCP output so using PMM reduces, rather than increases, source-reading token cost.

**Architecture:** Add one deterministic shared task-term module used by context ranking and memory recall, then gate type/recency bonuses behind real semantic matches. Extend the existing output projection layer so MCP keeps full cached domain payloads but returns tool-specific compact structures by default, with `detail=full` preserving compatibility.

**Tech Stack:** Node.js, CommonJS, MCP JSON-RPC, Node built-in `assert`, PMM external-data layout

**Status:** Implementation and local verification complete. Final push remains pending until the closing commit is created.

---

## File Structure

- Create `src/agent/task-terms.js` for weighted ASCII/CJK term extraction, stop words, scope terms, aliases, and text match scoring.
- Create `tests/agent-token-efficiency.test.js` for deterministic Chinese ranking, memory isolation, confidence, compact budget, and full-detail compatibility tests.
- Modify `src/agent/context-pack.js` to consume weighted task terms and require a semantic match before node-type bonuses.
- Modify `src/agent/memory-recall.js` to consume the same terms, remove recency-only recall, enforce a minimum relevance threshold, and split outcome/relevance confidence.
- Modify `src/agent/output-projection.js` to add compact projections for task context, impact, execution loop, memory, and query payloads.
- Modify `src/mcp/server.js` to project all target MCP responses after attaching freshness/cache metadata while retaining full cached payloads.
- Modify `tests/mcp-server.test.js` for compact/full query behavior and bounded error output.
- Modify `package.json` to add `test:token-roi` and include it in the Agent regression group.
- Modify `CHANGELOG.md`, `README.md`, `SKILL.md`, `docs/reference/mcp-tools.md`, and `docs/user/mcp-first.md` after behavior is verified.

### Task 1: Lock The Token ROI Regression Contract

**Files:**
- Create: `tests/agent-token-efficiency.test.js`
- Modify: `package.json`
- Read: `tests/fixtures/admin-fullstack-sample/**`
- Read: `tests/agent-context-pack.test.js`
- Read: `tests/agent-memory-recall.test.js`

- [x] **Step 1: Build a temporary mixed-domain fixture**

Add test helpers that copy `tests/fixtures/admin-fullstack-sample` into a temporary workspace, write minimal login/Pinus and Mahjong files, add unrelated poker/activity endpoint files, initialize external PMM data, and build the project-global KB with the existing graph builder.

- [x] **Step 2: Write failing Chinese ranking tests**

Call `prepareTaskContext()` with these exact tasks and assert the ordered `recommendedFiles` contract:

```javascript
assertTopFiles(captcha.recommendedFiles, [
    'cms-client/src/utils/api/modules/authApi.js',
    'cms-client/src/views/login/Login.vue',
    'cms-server/src/routes/authRoutes.ts',
    'cms-server/src/controllers/authController.ts',
    'cms-server/src/services/captchaService.ts',
], 8);

assertTopFiles(mahjong.recommendedFiles, [
    'xy-client/assets/script/game/mahjong/MaJiangBaseView.ts',
    'xy-client/assets/script/game/zhuanzhuan/ZhuanZhuanMJHandler.ts',
    'xy-client/assets/script/game/zhuanzhuan/ZhuanZhuanMJEffect.ts',
], 8);
assert.equal(mahjong.recommendedFiles.some(file => /poker/i.test(file)), false);

assertTopFiles(login.recommendedFiles, [
    'xy-client/assets/script/login/LoginViewComp.ts',
    'xy-client/assets/script/session/GameSessionMgr.ts',
    'qy-server/game-server/app/servers/connector/handler/pkconHandler.ts',
], 8);
```

- [x] **Step 3: Write failing memory relevance tests**

Record one captcha outcome and one recent unrelated activity outcome. Assert only the captcha record is recalled, and assert the record exposes both fields:

```javascript
assert.equal(result.recalledTasks.length, 1);
assert.equal(result.recalledTasks[0].task, '修复后台验证码刷新链路');
assert.equal(result.recalledTasks[0].outcomeConfidence, 'high');
assert.ok(['high', 'medium'].includes(result.recalledTasks[0].relevanceConfidence));
assert.equal(Object.hasOwn(result.recalledTasks[0], 'confidence'), false);
```

- [x] **Step 4: Write failing compact budget tests**

Use `projectAgentOutput()` and `handleMcpRequest()` to assert every target compact response serializes below its documented budget, while `detail=full` preserves fields removed from compact output.

- [x] **Step 5: Register and run the new test**

Add:

```json
"test:token-roi": "node tests/agent-token-efficiency.test.js"
```

Append it to `test:agent`, then run:

```powershell
npm run test:token-roi
```

Expected: FAIL because Chinese semantic ranking, recency isolation, confidence split, and target compact projections do not exist yet.

- [x] **Step 6: Commit the red test contract**

```powershell
git add tests/agent-token-efficiency.test.js package.json
git commit -m "测试 PMM Token ROI 回归合同"
```

### Task 2: Add Shared Weighted Task Terms

**Files:**
- Create: `src/agent/task-terms.js`
- Modify: `src/agent/context-pack.js`
- Modify: `src/agent/memory-recall.js`
- Test: `tests/agent-token-efficiency.test.js`

- [x] **Step 1: Implement the shared term model**

Export these stable functions:

```javascript
module.exports = {
    normalizeTaskText,
    parseTaskTerms,
    scoreTextMatches,
    termValues,
};
```

`parseTaskTerms()` must return `{ raw, normalized, terms }`, where each term is `{ value, weight, source }`. Generate CJK 2-4 character n-grams, filter stop/scope words, deduplicate by normalized value using the highest weight, and apply deterministic aliases for captcha, Mahjong Hu/effects, Zhuanzhuan, Pinus/session/login, OAuth, chat, settings, and data access.

- [x] **Step 2: Replace context-pack local parsing**

Delete the local `parseTaskTerms()` implementation. Pass weighted term objects into `scoreNode()` and return a score detail object containing `score`, `matchScore`, and `matchedTerms`.

- [x] **Step 3: Gate node type bonuses**

Implement this invariant:

```javascript
if (matchScore <= 0) {
    return { score: 0, matchScore: 0, matchedTerms: [] };
}
```

Only then add endpoint/request/method/table type bonuses. Sort by final score, then match score, then matched-term count, then stable node name.

- [x] **Step 4: Replace memory extraction and scoring**

Use the shared weighted terms in `scoreRecord()`. Keep recency as a tie-break reason only after `matchScore > 0`; require a minimum score of 3 before recall.

- [x] **Step 5: Split confidence fields**

Change `compactRecord()` to emit:

```javascript
{
    outcomeConfidence: record.confidence || 'unknown',
    relevanceConfidence: confidenceFromScore(scoreInfo.score),
    relevanceScore: scoreInfo.score,
}
```

Update memory evidence to use `relevanceConfidence`. For project summaries, preserve outcome confidence and set relevance fields to `null` because no query was performed.

- [x] **Step 6: Run targeted tests**

```powershell
npm run test:token-roi
npm run test:agent
```

Expected: Chinese ranking and memory tests PASS; compact budget tests may still FAIL until Task 3.

- [x] **Step 7: Commit semantic recall fixes**

```powershell
git add src/agent/task-terms.js src/agent/context-pack.js src/agent/memory-recall.js tests/agent-token-efficiency.test.js
git commit -m "修复 PMM 中文任务召回与记忆相关性"
```

### Task 3: Add Tool-Specific Compact Projections

**Files:**
- Modify: `src/agent/output-projection.js`
- Test: `tests/agent-token-efficiency.test.js`

- [x] **Step 1: Add bounded projection helpers**

Implement `truncateText(value, maxLength)`, compact node/edge helpers, bounded array helpers, and a structural budget reducer. The reducer must shrink low-priority arrays rather than slicing serialized JSON.

- [x] **Step 2: Add Agent projections**

Implement compact functions for task context, change impact, execution plan, edit scope validation, and patch review. Preserve task, status/verdict, target/changed files, concise risks, required follow-up, validation commands, and compact evidence.

- [x] **Step 3: Add memory projections**

Implement compact recall and project-memory summary functions. Limit recalled tasks, observations, validation commands, frequent files, and playbook rules while preserving split confidence fields.

- [x] **Step 4: Add query projection**

Implement `compactProjectQuery()` for project and feature queries. For traversal results preserve:

```json
{
  "inputQuery": "MaJiangBaseView.onMJHu",
  "resolvedStart": { "id": "...", "type": "method", "name": "...", "file": "...", "line": 1 },
  "direction": "downstream",
  "depth": 2,
  "traversal": [
    { "direction": "downstream", "depth": 1, "type": "calls", "from": { "name": "...", "file": "..." }, "to": { "name": "...", "file": "..." } }
  ]
}
```

Do not include full node meta, tags, bindings, full snapshots, or duplicate `node` objects in compact mode.

- [x] **Step 5: Route all target tool names**

Extend `projectAgentOutput()` dispatch for all tools listed in the design. Keep the existing `detail=full` branch unchanged except for `_output.detail`.

- [x] **Step 6: Run projection tests**

```powershell
npm run test:token-roi
npm run test:agent
```

Expected: direct projection budget tests PASS. MCP query tests remain pending until Task 4.

- [x] **Step 7: Commit compact projection core**

```powershell
git add src/agent/output-projection.js tests/agent-token-efficiency.test.js
git commit -m "压缩 PMM Agent 与链路查询输出"
```

### Task 4: Apply Projection At Every MCP Boundary

**Files:**
- Modify: `src/mcp/server.js`
- Modify: `tests/mcp-server.test.js`
- Test: `tests/agent-token-efficiency.test.js`

- [x] **Step 1: Project Agent project tools**

Change `runAgentProjectTool()` to attach metadata, then call:

```javascript
return textResult(projectAgentOutput(enriched, args, toolName));
```

- [x] **Step 2: Project recall and summary tools**

Route `recall_task_memory` and `summarize_project_memory` through `projectAgentOutput()` after `_mcpQuery` metadata is attached.

- [x] **Step 3: Project cached project queries**

Keep `projectQueryCache` entries as full payloads. On cache hit and miss, attach MCP metadata to the full payload, then call `projectAgentOutput(..., args, 'query_project_chain')` before `textResult()`.

- [x] **Step 4: Project feature queries and errors**

Apply the same boundary to `query_feature_chain`. Route failures through compact error projection so stdout/stderr are truncated and artifact snapshots are omitted by default.

- [x] **Step 5: Add MCP compatibility assertions**

In `tests/mcp-server.test.js`, assert default compact query output omits `resolvedStart.meta` and duplicate `node`, while `detail=full` includes the existing full structure. Assert cache hit preserves the requested detail mode.

- [x] **Step 6: Run MCP and Agent tests**

```powershell
npm run test:mcp
npm run test:agent
```

Expected: PASS with compact default and full compatibility.

- [x] **Step 7: Commit MCP integration**

```powershell
git add src/mcp/server.js tests/mcp-server.test.js tests/agent-token-efficiency.test.js
git commit -m "接入 PMM MCP 默认紧凑投影"
```

### Task 5: Document The New Contract

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `README.md`
- Modify: `SKILL.md`
- Modify: `docs/reference/mcp-tools.md`
- Modify: `docs/user/mcp-first.md`
- Modify: `docs/developer/testing.md`

- [x] **Step 1: Document compact/full behavior**

State that Agent and query MCP tools default to compact output, `detail=full` is diagnostic-only, compact output is structurally bounded, and CLI domain JSON remains complete.

- [x] **Step 2: Document Chinese task behavior**

Explain that natural-language Agent tools now support deterministic CJK terms and aliases, while exact chain queries should still use selectors when a method/endpoint is known.

- [x] **Step 3: Document the regression command**

Add `npm run test:token-roi` to testing documentation and include it in the Agent test description.

- [x] **Step 4: Update changelog**

Under `[未发布]`, record Chinese ranking, memory relevance isolation, confidence split, compact projection coverage, and token budget tests. Do not bump the version until all release checks pass.

- [x] **Step 5: Run documentation checks**

```powershell
rg -n "T[B]D|TO[D]O|implement la[t]er|fill in detai[l]s" docs/superpowers/specs/2026-07-11-pmm-token-roi-design.md docs/superpowers/plans/2026-07-11-pmm-token-roi.md
git diff --check
```

Expected: no placeholder matches and no whitespace errors.

- [x] **Step 6: Commit documentation**

```powershell
git add CHANGELOG.md README.md SKILL.md docs/reference/mcp-tools.md docs/user/mcp-first.md docs/developer/testing.md docs/superpowers/specs/2026-07-11-pmm-token-roi-design.md docs/superpowers/plans/2026-07-11-pmm-token-roi.md
git commit -m "记录 PMM Token ROI 使用合同"
```

### Task 6: Full Verification And Real qyProject Benchmark

**Files:**
- Modify if measurements require factual correction: `docs/superpowers/specs/2026-07-11-pmm-token-roi-design.md`
- Modify: `docs/superpowers/plans/2026-07-11-pmm-token-roi.md`

- [x] **Step 1: Run complete local verification**

```powershell
npm run test:agent
npm run test:mcp
npm run test:all
node src/bin/validate-package.js .
git diff --check
```

Expected: all commands exit 0.

- [x] **Step 2: Rebuild qyProject KB**

Use PMM MCP `start_build_project_index` with `wait:true` for `E:/xile-workspace/qyProject` and external data root `E:/xile-workspace/codex-tools/project-memory-data`. Confirm freshness is `fresh` before measuring.

- [x] **Step 3: Rerun the three benchmark tasks**

Measure serialized character count, estimated token count (`ceil(chars / 4)`), Top-N files, and source-correction requirement for login/Pinus, Zhuanzhuan Hu effect, and CMS captcha.

- [x] **Step 4: Compare against the baseline**

Use the design baseline of 11,122 direct-source tokens and 28,038 current PMM-plus-source tokens. Do not mark Token ROI solved if PMM plus necessary source confirmation exceeds 1.2 times the direct-source baseline.

- [x] **Step 5: Rebuild PMM's own KB and self-review**

Rebuild `E:/xile-workspace/codex-tools/project-memory-manager`, then run `validate_edit_scope` and `review_patch_for_agent` with the actual changed files.

- [x] **Step 6: Mark this plan complete with measured results**

Replace unchecked boxes with checked boxes only for commands and behavior actually verified. Add a short completion note containing measured compact character/token counts and any residual risk.

- [ ] **Step 7: Final commit and push**

```powershell
git status --short --branch
git push origin main
```

Wait for GitHub Actions to complete successfully. Then record the task outcome in PMM with changed files, validation commands, benchmark results, and residual observations.

## Completion Report

- qyProject KB rebuilt to `fresh`: 1,624 scripts, 18,033 methods, 6,308/8,307 imports resolved.
- Compact budgets verified: brief <= 4,000 chars; task context and exact project query <= 6,000 chars.
- Login/Pinus, Zhuanzhuan Hu effect, and CMS captcha all retained their key implementation files; unrelated recalled tasks were reduced to zero.
- Three-task estimate: 12,916 token for brief + exact query + fixed-window source confirmation, 1.16x the 11,122 direct-source baseline and about 54% below the previous 28,038 PMM path.
- Residual risk: PMM is now near parity and materially improves project understanding, but it has not yet proven absolute token savings. The next phase should reduce duplicate selector/source confirmation cost.
- Full local regression, package validation, `git diff --check`, qyProject KB rebuild, PMM self-KB rebuild, `validate_edit_scope`, and `review_patch_for_agent` were executed. Scope review only flagged planned release/support files outside the code graph; no code-level review finding remained.
