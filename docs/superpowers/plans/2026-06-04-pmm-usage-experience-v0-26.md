# PMM Usage Experience v0.26 Implementation Plan

> **状态：已完成（2026-06-04，随 0.26.0 发布）。**
> 对应能力已登记在 `skill-version.json`，包括 `unresolved-call-explainability`、`inline-http-callback-handler-linking`、`grouped-query-recommendations` 和 `query-filter-disambiguation`。
> 执行期间没有逐项维护复选框，文中的 `- [x]` 是收口时依据能力清单统一回填的。
> 判断本计划剩余工作量时，以本节状态为准，不要按复选框数量推断。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Implement the next usage-experience fixes from the 2026-06-04 PMM report.

**Architecture:** Keep most behavior in the query layer and add only narrow graph facts for unresolved calls and inline route callbacks. Extend CLI/MCP parameter forwarding without changing the external data layout.

**Tech Stack:** Node.js CommonJS, TypeScript compiler API where already used, PMM graph/lookup JSON.

---

### Task 1: Regression Tests

**Files:**
- Modify: `tests/pinus-backend.test.js`
- Modify: `tests/fixtures/admin-fullstack-sample/cms-server/src/routes/authRoutes.ts`
- Modify: `tests/fixtures/admin-fullstack-sample/cms-server/src/services/captchaService.ts`
- Modify: `tests/fixtures/admin-fullstack-sample/cms-client/src/views/login/Login.vue`

- [x] Add failing assertions for `mode=fullstack`, `focus=fullstack`, grouped endpoint search, `includeUnresolved`, `detail=counts`, `prefab-script-usage`, and inline HTTP callback handler.
- [x] Run `npm test` and confirm these assertions fail for missing behavior.

### Task 2: Query Controls

**Files:**
- Modify: `src/query/query-chain.js`
- Modify: `src/commands/query/query-project.js`
- Modify: `src/mcp/server.js`

- [x] Parse and forward `mode`, `fullstack`, `focus`, `includeUnresolved`, `grouped`, `groupLimit`, `instanceLimit`, and `nodePathLimit`.
- [x] Implement fullstack traversal depth and focus filtering.
- [x] Implement broad search grouped recommendations.
- [x] Implement `detail=counts` and explicit limit metadata.
- [x] Implement `prefab-script-usage` batch summary.

### Task 3: Graph Facts

**Files:**
- Modify: `src/extraction/extract-feature-facts.js`
- Modify: `src/graph/build-chain-kb.js`

- [x] Extract unresolved member calls with owner, member, and reason.
- [x] Build opt-in `unresolved-call` nodes and edges.
- [x] Label inline HTTP endpoint callbacks and connect endpoint to synthetic callback method.

### Task 4: Docs, Version, Validation

**Files:**
- Modify: `skill-version.json`
- Modify: `CHANGELOG.md`
- Modify: `docs/reference/cli.md`
- Modify: `docs/reference/mcp-tools.md`
- Modify: `docs/user/query-guide.md`

- [x] Update PMM version and capability list.
- [x] Document new query controls and examples.
- [x] Run full PMM verification.
- [x] Rebuild qyProject KB and replay report checks.
- [x] Commit with a Chinese message and push `main`.
