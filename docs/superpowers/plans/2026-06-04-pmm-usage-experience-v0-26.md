# PMM Usage Experience v0.26 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

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

- [ ] Add failing assertions for `mode=fullstack`, `focus=fullstack`, grouped endpoint search, `includeUnresolved`, `detail=counts`, `prefab-script-usage`, and inline HTTP callback handler.
- [ ] Run `npm test` and confirm these assertions fail for missing behavior.

### Task 2: Query Controls

**Files:**
- Modify: `src/query/query-chain.js`
- Modify: `src/commands/query/query-project.js`
- Modify: `src/mcp/server.js`

- [ ] Parse and forward `mode`, `fullstack`, `focus`, `includeUnresolved`, `grouped`, `groupLimit`, `instanceLimit`, and `nodePathLimit`.
- [ ] Implement fullstack traversal depth and focus filtering.
- [ ] Implement broad search grouped recommendations.
- [ ] Implement `detail=counts` and explicit limit metadata.
- [ ] Implement `prefab-script-usage` batch summary.

### Task 3: Graph Facts

**Files:**
- Modify: `src/extraction/extract-feature-facts.js`
- Modify: `src/graph/build-chain-kb.js`

- [ ] Extract unresolved member calls with owner, member, and reason.
- [ ] Build opt-in `unresolved-call` nodes and edges.
- [ ] Label inline HTTP endpoint callbacks and connect endpoint to synthetic callback method.

### Task 4: Docs, Version, Validation

**Files:**
- Modify: `skill-version.json`
- Modify: `CHANGELOG.md`
- Modify: `docs/reference/cli.md`
- Modify: `docs/reference/mcp-tools.md`
- Modify: `docs/user/query-guide.md`

- [ ] Update PMM version and capability list.
- [ ] Document new query controls and examples.
- [ ] Run full PMM verification.
- [ ] Rebuild qyProject KB and replay report checks.
- [ ] Commit with a Chinese message and push `main`.
