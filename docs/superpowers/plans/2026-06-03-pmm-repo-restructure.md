# PMM Repo Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure PMM from a flat `scripts/` skill layout into a clean `src/` application layout with new `src/bin/*.js` entrypoints, updated docs, and no old CLI compatibility layer.

**Architecture:** The refactor creates a strict split between executable entrypoints, command parsing, domain modules, adapters, MCP handlers, maintenance tools, and shared helpers. Existing behavior is preserved by moving code first, then splitting the largest modules behind tests.

**Tech Stack:** Node.js CommonJS, TypeScript compiler API, MCP stdio server, PowerShell on Windows, npm test scripts.

---

## File Structure

Create:

- `src/bin/*.js`: executable entrypoints.
- `src/commands/lifecycle/*.js`: init, detect, migrate, rebuild commands.
- `src/commands/build/*.js`: project build, feature discovery, feature build.
- `src/commands/query/*.js`: project, feature, chain query commands.
- `src/commands/cocos/*.js`: Cocos authoring and profile commands.
- `src/commands/diagnostics/*.js`: path/import/call-chain diagnostics.
- `src/commands/maintenance/*.js`: version, validation, cleanup, Kimi install.
- `src/mcp/server.js`: MCP server implementation.
- `src/extraction/**`: source fact extraction.
- `src/graph/**`: KB graph build, lookup, report, registry.
- `src/discovery/feature-discovery.js`: feature candidate discovery.
- `src/adapters/**`: topology and extraction adapters.
- `src/shared/**`: common utilities.
- `docs/user/*.md`, `docs/developer/*.md`, `docs/reference/*.md`, `docs/guides/*.md`: reorganized docs.
- `tests/source-layout.test.js`: new layout and entrypoint regression test.

Modify:

- `package.json`
- `skill-version.json`
- `README.md`
- `SKILL.md`
- `CHANGELOG.md`
- `CONTRIBUTING.md`
- `references/api-reference.md`
- `references/core/*.md`
- `references/adapters/*.md`
- `examples/*.md`
- `assets/templates/*.md`
- all tests importing old `scripts/*` modules

Delete:

- `scripts/`
- root `project-memory/`

---

### Task 1: Add New Layout Regression Test

**Files:**
- Create: `tests/source-layout.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write the failing source layout test**

Create `tests/source-layout.test.js`:

```js
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');

function exists(relativePath) {
    return fs.existsSync(path.join(root, relativePath));
}

function readJson(relativePath) {
    return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function testNoLegacyRuntimeRoots() {
    assert.equal(exists('scripts'), false, 'legacy scripts directory must be removed');
    assert.equal(exists('project-memory'), false, 'root project-memory runtime data must not live in source repo');
}

function testRequiredSourceDirectories() {
    for (const dir of [
        'src/bin',
        'src/commands',
        'src/mcp',
        'src/lifecycle',
        'src/extraction',
        'src/graph',
        'src/query',
        'src/discovery',
        'src/adapters',
        'src/maintenance',
        'src/shared',
    ]) {
        assert.equal(exists(dir), true, `missing source directory: ${dir}`);
    }
}

function testRequiredBins() {
    for (const file of [
        'src/bin/mcp.js',
        'src/bin/init-workspace.js',
        'src/bin/detect-topology.js',
        'src/bin/build-project.js',
        'src/bin/discover-features.js',
        'src/bin/build-feature.js',
        'src/bin/query-project.js',
        'src/bin/query-feature.js',
        'src/bin/query-chain.js',
        'src/bin/rebuild-kbs.js',
        'src/bin/validate-package.js',
    ]) {
        assert.equal(exists(file), true, `missing bin: ${file}`);
        const mod = require(path.join(root, file));
        assert.equal(typeof mod.run, 'function', `bin must export run(): ${file}`);
    }
}

function testPackageAndVersionUseNewEntrypoints() {
    const pkg = readJson('package.json');
    assert.equal(pkg.scripts.mcp, 'node src/bin/mcp.js');
    assert.equal(pkg.scripts['test:source-layout'], 'node tests/source-layout.test.js');

    const version = readJson('skill-version.json');
    assert.equal(version.rebuildCommand, 'node src/bin/rebuild-kbs.js --workspace-root <project-root>');
}

testNoLegacyRuntimeRoots();
testRequiredSourceDirectories();
testRequiredBins();
testPackageAndVersionUseNewEntrypoints();
console.log('source-layout validation passed');
```

- [ ] **Step 2: Add the package script**

Modify `package.json` scripts:

```json
"test:source-layout": "node tests/source-layout.test.js"
```

- [ ] **Step 3: Run test to verify it fails**

Run:

```powershell
npm run test:source-layout
```

Expected: FAIL because `scripts/` exists and `src/bin/*.js` does not exist.

- [ ] **Step 4: Commit the failing test**

```powershell
git add package.json tests/source-layout.test.js
git commit -m "添加源码布局重构回归测试"
```

---

### Task 2: Move Shared Modules and Adapters

**Files:**
- Move: `scripts/lib/common.js` -> `src/shared/common.js`
- Move: `scripts/lib/workspace-layout.js` -> `src/shared/workspace-layout.js`
- Move: `scripts/lib/lock.js` -> `src/shared/lock.js`
- Move: `scripts/lib/feature-kb.js` -> `src/graph/feature-kb.js`
- Move: `scripts/lib/feature-discovery.js` -> `src/discovery/feature-discovery.js`
- Move: `scripts/lib/vue_sfc.js` -> `src/extraction/vue/vue-sfc.js`
- Move: `scripts/adapters/extract/*` -> `src/adapters/extract/*`
- Move: `scripts/adapters/topology/*` -> `src/adapters/topology/*`

- [ ] **Step 1: Create directories**

Run:

```powershell
New-Item -ItemType Directory -Force -Path `
  src/shared,src/graph,src/discovery,src/extraction/vue,src/adapters/extract,src/adapters/topology | Out-Null
```

- [ ] **Step 2: Move files with git**

Run:

```powershell
git mv scripts/lib/common.js src/shared/common.js
git mv scripts/lib/workspace-layout.js src/shared/workspace-layout.js
git mv scripts/lib/lock.js src/shared/lock.js
git mv scripts/lib/feature-kb.js src/graph/feature-kb.js
git mv scripts/lib/feature-discovery.js src/discovery/feature-discovery.js
git mv scripts/lib/vue_sfc.js src/extraction/vue/vue-sfc.js
git mv scripts/adapters/extract/cocos.js src/adapters/extract/cocos.js
git mv scripts/adapters/extract/generic.js src/adapters/extract/generic.js
git mv scripts/adapters/extract/index.js src/adapters/extract/index.js
git mv scripts/adapters/extract/pinus.js src/adapters/extract/pinus.js
git mv scripts/adapters/topology/generic.js src/adapters/topology/generic.js
git mv scripts/adapters/topology/index.js src/adapters/topology/index.js
```

- [ ] **Step 3: Update require paths in moved adapter files**

Required replacements:

```text
src/adapters/extract/*.js:
  ../../lib/common -> ../../shared/common

src/adapters/topology/*.js:
  ../../lib/common -> ../../shared/common

src/discovery/feature-discovery.js:
  ./common -> ../shared/common
```

Use `rg "lib/common|./common|../lib" src/adapters src/discovery src/graph src/shared` and edit every hit.

- [ ] **Step 4: Run focused require checks**

Run:

```powershell
node -e "require('./src/shared/common'); require('./src/shared/workspace-layout'); require('./src/discovery/feature-discovery'); require('./src/adapters/extract'); require('./src/adapters/topology'); console.log('shared modules load')"
```

Expected: `shared modules load`

- [ ] **Step 5: Commit**

```powershell
git add src scripts
git commit -m "迁移共享模块和适配器目录"
```

---

### Task 3: Move Extraction and Graph Build Modules

**Files:**
- Move: `scripts/extract_feature_facts.js` -> `src/extraction/extract-feature-facts.js`
- Move: `scripts/extract_structured_summary.js` -> `src/extraction/summary/extract-structured-summary.js`
- Move: `scripts/build_chain_kb.js` -> `src/graph/build-chain-kb.js`
- Modify: all moved require paths
- Modify: tests importing `../scripts/build_chain_kb` or `../scripts/extract_*`

- [ ] **Step 1: Create directories**

```powershell
New-Item -ItemType Directory -Force -Path src/extraction,src/extraction/summary,src/graph | Out-Null
```

- [ ] **Step 2: Move files**

```powershell
git mv scripts/extract_feature_facts.js src/extraction/extract-feature-facts.js
git mv scripts/extract_structured_summary.js src/extraction/summary/extract-structured-summary.js
git mv scripts/build_chain_kb.js src/graph/build-chain-kb.js
```

- [ ] **Step 3: Update internal require paths**

Apply these mappings:

```text
src/extraction/extract-feature-facts.js:
  ./lib/common -> ../shared/common
  ./lib/vue_sfc -> ./vue/vue-sfc
  ./adapters/extract -> ../adapters/extract
  ./extract_structured_summary -> ./summary/extract-structured-summary

src/graph/build-chain-kb.js:
  ./extract_feature_facts -> ../extraction/extract-feature-facts
  ./learn_project_protocols -> ../lifecycle/learn-project-protocols
  ./refresh_memory_indexes -> ../lifecycle/refresh-memory-indexes
  ./lib/common -> ../shared/common
  ./lib/feature-kb -> ./feature-kb
  ./show_skill_version -> ../maintenance/show-version
```

If `learn_project_protocols`, `refresh_memory_indexes`, or `show_skill_version` are not moved yet, leave a temporary relative path to the old file only until the task that moves that file. Remove the temporary path in the same implementation session before deleting `scripts/`.

- [ ] **Step 4: Update tests**

Required import replacements:

```text
tests/pinus-backend.test.js:
  ../scripts/build_chain_kb -> ../src/graph/build-chain-kb
  ../scripts/query_chain_kb -> ../src/query/query-chain

tests/mcp-server.test.js:
  ../scripts/build_chain_kb -> ../src/graph/build-chain-kb
  ../scripts/lib/workspace-layout -> ../src/shared/workspace-layout

tests/workspace-layout.test.js:
  ../scripts/build_chain_kb -> ../src/graph/build-chain-kb
  ../scripts/lib/workspace-layout -> ../src/shared/workspace-layout

tests/structured-summary.test.js:
  ../scripts/extract_structured_summary -> ../src/extraction/summary/extract-structured-summary
```

- [ ] **Step 5: Run focused tests**

```powershell
npm test
npm run test:summary
```

Expected:

```text
pinus-backend validation passed
structured summary tests: 19 passed, 0 failed
```

- [ ] **Step 6: Commit**

```powershell
git add src tests scripts
git commit -m "迁移抽取和图构建模块"
```

---

### Task 4: Move Lifecycle, Build, Discovery, and Query Commands

**Files:**
- Move lifecycle scripts into `src/commands/lifecycle/`
- Move build/discovery scripts into `src/commands/build/`
- Move query scripts into `src/commands/query/` and `src/query/`
- Create matching `src/bin/*.js`

- [ ] **Step 1: Create command and bin directories**

```powershell
New-Item -ItemType Directory -Force -Path src/bin,src/commands/lifecycle,src/commands/build,src/commands/query,src/query,src/lifecycle | Out-Null
```

- [ ] **Step 2: Move lifecycle files**

```powershell
git mv scripts/init_project_memory.js src/commands/lifecycle/init-workspace.js
git mv scripts/detect_project_topology.js src/commands/lifecycle/detect-topology.js
git mv scripts/migrate_legacy_memory.js src/commands/lifecycle/migrate-legacy-memory.js
git mv scripts/rebuild_kbs.js src/commands/lifecycle/rebuild-kbs.js
git mv scripts/refresh_memory_indexes.js src/lifecycle/refresh-memory-indexes.js
git mv scripts/learn_project_protocols.js src/lifecycle/learn-project-protocols.js
```

- [ ] **Step 3: Move build and discovery files**

```powershell
git mv scripts/build_project_kb.js src/commands/build/build-project.js
git mv scripts/build_feature_index.js src/commands/build/build-feature.js
git mv scripts/discover_features.js src/commands/build/discover-features.js
```

- [ ] **Step 4: Move query files**

```powershell
git mv scripts/query_project_kb.js src/commands/query/query-project.js
git mv scripts/query_kb.js src/commands/query/query-feature.js
git mv scripts/query_chain_kb.js src/query/query-chain.js
git mv scripts/query_dataflow.js src/commands/query/query-dataflow.js
git mv scripts/view_method_body.js src/commands/query/view-method-body.js
git mv scripts/analyze_call_chain.js src/commands/query/analyze-call-chain.js
```

- [ ] **Step 5: Create bin entrypoints**

Create each file with this pattern:

```js
#!/usr/bin/env node

const { run } = require('../commands/build/build-project');

if (require.main === module) {
    try {
        run(process.argv.slice(2));
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    }
}

module.exports = { run };
```

Required entrypoint to command mapping:

```text
src/bin/init-workspace.js -> ../commands/lifecycle/init-workspace
src/bin/detect-topology.js -> ../commands/lifecycle/detect-topology
src/bin/migrate-legacy-memory.js -> ../commands/lifecycle/migrate-legacy-memory
src/bin/rebuild-kbs.js -> ../commands/lifecycle/rebuild-kbs
src/bin/build-project.js -> ../commands/build/build-project
src/bin/build-feature.js -> ../commands/build/build-feature
src/bin/discover-features.js -> ../commands/build/discover-features
src/bin/query-project.js -> ../commands/query/query-project
src/bin/query-feature.js -> ../commands/query/query-feature
src/bin/query-chain.js -> ../query/query-chain
src/bin/query-dataflow.js -> ../commands/query/query-dataflow
src/bin/view-method-body.js -> ../commands/query/view-method-body
src/bin/analyze-call-chain.js -> ../commands/query/analyze-call-chain
```

- [ ] **Step 6: Update require paths**

Use these mappings:

```text
./lib/common -> ../../shared/common
./lib/workspace-layout -> ../../shared/workspace-layout
./lib/feature-discovery -> ../../discovery/feature-discovery
./build_chain_kb -> ../../graph/build-chain-kb
./query_chain_kb -> ../../query/query-chain
./query_project_kb -> ./query-project
./query_kb -> ./query-feature
./detect_project_topology -> ./detect-topology
./init_project_memory -> ./init-workspace
./learn_project_protocols -> ../../lifecycle/learn-project-protocols
./refresh_memory_indexes -> ../../lifecycle/refresh-memory-indexes
./show_skill_version -> ../../maintenance/show-version
```

- [ ] **Step 7: Run focused CLI checks**

```powershell
node src/bin/build-project.js --help
node src/bin/query-feature.js --help
node src/bin/discover-features.js --help
```

Expected: Commands either print usage/help or fail with a usage message, not `MODULE_NOT_FOUND`.

- [ ] **Step 8: Run tests**

```powershell
npm test
npm run test:feature
npm run test:path
```

Expected: all pass.

- [ ] **Step 9: Commit**

```powershell
git add src tests scripts
git commit -m "迁移生命周期构建和查询命令"
```

---

### Task 5: Move MCP, Cocos, Diagnostics, and Maintenance Tools

**Files:**
- Move `scripts/mcp_server.js` -> `src/mcp/server.js`
- Move Cocos commands to `src/commands/cocos/`
- Move diagnostics to `src/commands/diagnostics/`
- Move maintenance scripts to `src/maintenance/` and `src/commands/maintenance/`
- Create remaining `src/bin/*.js`

- [ ] **Step 1: Create directories**

```powershell
New-Item -ItemType Directory -Force -Path src/mcp,src/commands/cocos,src/commands/diagnostics,src/commands/maintenance,src/maintenance | Out-Null
```

- [ ] **Step 2: Move files**

```powershell
git mv scripts/mcp_server.js src/mcp/server.js
git mv scripts/cocos_authoring.js src/commands/cocos/cocos-authoring.js
git mv scripts/query_cocos_profile.js src/commands/cocos/query-cocos-profile.js
git mv scripts/build_cocos_authoring_profile.js src/commands/cocos/build-cocos-authoring-profile.js
git mv scripts/plan_cocos_binding.js src/commands/cocos/plan-cocos-binding.js
git mv scripts/diagnose_paths.js src/commands/diagnostics/diagnose-paths.js
git mv scripts/diagnose_import_resolution.js src/commands/diagnostics/diagnose-imports.js
git mv scripts/debug_call_chain.js src/commands/diagnostics/debug-call-chain.js
git mv scripts/check_skill_version.js src/maintenance/check-version.js
git mv scripts/show_skill_version.js src/maintenance/show-version.js
git mv scripts/validate_skill_format.js src/maintenance/validate-skill-format.js
git mv scripts/validate_skill_package.js src/maintenance/validate-package.js
git mv scripts/validate_skill_runtime.py src/maintenance/validate-skill-runtime.py
git mv scripts/clean_for_production.js src/maintenance/clean-production.js
git mv scripts/clean_temp_files.js src/maintenance/clean-temp.js
git mv scripts/install_to_kimi_cli.js src/maintenance/install-kimi.js
git mv scripts/requirements-validation.txt src/maintenance/requirements-validation.txt
```

- [ ] **Step 3: Create bin entrypoints**

Required mapping:

```text
src/bin/mcp.js -> ../mcp/server
src/bin/cocos-authoring.js -> ../commands/cocos/cocos-authoring
src/bin/query-cocos-profile.js -> ../commands/cocos/query-cocos-profile
src/bin/build-cocos-authoring-profile.js -> ../commands/cocos/build-cocos-authoring-profile
src/bin/plan-cocos-binding.js -> ../commands/cocos/plan-cocos-binding
src/bin/diagnose-paths.js -> ../commands/diagnostics/diagnose-paths
src/bin/diagnose-imports.js -> ../commands/diagnostics/diagnose-imports
src/bin/debug-call-chain.js -> ../commands/diagnostics/debug-call-chain
src/bin/check-version.js -> ../maintenance/check-version
src/bin/show-version.js -> ../maintenance/show-version
src/bin/validate-skill-format.js -> ../maintenance/validate-skill-format
src/bin/validate-package.js -> ../maintenance/validate-package
src/bin/clean-production.js -> ../maintenance/clean-production
src/bin/clean-temp.js -> ../maintenance/clean-temp
src/bin/install-kimi.js -> ../maintenance/install-kimi
```

- [ ] **Step 4: Update MCP imports**

`src/mcp/server.js` must import:

```text
../shared/workspace-layout
../commands/lifecycle/init-workspace
../commands/lifecycle/detect-topology
../commands/build/build-project
../commands/build/discover-features
../commands/build/build-feature
../commands/query/query-project
../commands/query/query-feature
../maintenance/show-version
```

- [ ] **Step 5: Update tests**

Required replacements:

```text
tests/mcp-server.test.js:
  ../scripts/mcp_server -> ../src/mcp/server

tests/path-resolution.test.js:
  ../scripts/detect_project_topology -> ../src/commands/lifecycle/detect-topology
  ../scripts/lib/common -> ../src/shared/common

tests/workspace-layout.test.js:
  ../scripts/init_project_memory -> ../src/commands/lifecycle/init-workspace
  ../scripts/detect_project_topology -> ../src/commands/lifecycle/detect-topology
  ../scripts/build_project_kb -> ../src/commands/build/build-project
```

- [ ] **Step 6: Run focused tests**

```powershell
npm run test:mcp
npm run test:layout
npm run test:path
```

Expected: all pass.

- [ ] **Step 7: Commit**

```powershell
git add src tests scripts
git commit -m "迁移MCP和维护工具入口"
```

---

### Task 6: Remove Legacy `scripts/` and Root Runtime Memory

**Files:**
- Delete: `scripts/`
- Delete: `project-memory/`
- Modify: `package.json`
- Modify: `skill-version.json`
- Modify: tests that still mention `scripts/`

- [ ] **Step 1: Confirm no tracked files remain under scripts except the directory itself**

```powershell
git ls-files scripts
```

Expected: no output after Tasks 2-5.

- [ ] **Step 2: Remove root runtime memory**

```powershell
git rm -r project-memory
```

Expected: removes `project-memory/state/project-profile.json`.

- [ ] **Step 3: Update package scripts**

`package.json` scripts must be:

```json
{
  "test": "node tests/pinus-backend.test.js",
  "test:layout": "node tests/workspace-layout.test.js",
  "test:mcp": "node tests/mcp-server.test.js",
  "test:feature": "node tests/feature-discovery.test.js",
  "test:path": "node tests/path-resolution.test.js",
  "test:summary": "node tests/structured-summary.test.js",
  "test:source-layout": "node tests/source-layout.test.js",
  "mcp": "node src/bin/mcp.js"
}
```

- [ ] **Step 4: Update `skill-version.json`**

Set:

```json
"rebuildCommand": "node src/bin/rebuild-kbs.js --workspace-root <project-root>"
```

Keep `version` unchanged until the docs and tests pass; bump version in Task 8.

- [ ] **Step 5: Update generated examples in tests**

Replace assertions expecting `scripts/query_kb.js` with `src/bin/query-feature.js`.

Known file:

```text
tests/pinus-backend.test.js
```

- [ ] **Step 6: Run layout test**

```powershell
npm run test:source-layout
```

Expected: `source-layout validation passed`.

- [ ] **Step 7: Commit**

```powershell
git add package.json skill-version.json tests project-memory
git commit -m "移除旧脚本入口和根记忆目录"
```

---

### Task 7: Rewrite Documentation Around New Structure

**Files:**
- Create: `docs/user/quick-start.md`
- Create: `docs/user/mcp-first.md`
- Create: `docs/user/external-data-layout.md`
- Create: `docs/user/query-guide.md`
- Create: `docs/user/feature-kb-workflow.md`
- Create: `docs/developer/architecture.md`
- Create: `docs/developer/source-layout.md`
- Create: `docs/developer/release-process.md`
- Create: `docs/developer/testing.md`
- Create: `docs/reference/cli.md`
- Create: `docs/reference/mcp-tools.md`
- Create: `docs/reference/kb-schema.md`
- Create: `docs/reference/adapters.md`
- Create: `docs/guides/fullstack-admin-kb.md`
- Create: `docs/guides/cocos-authoring.md`
- Create: `docs/guides/troubleshooting.md`
- Modify: `README.md`
- Modify: `SKILL.md`
- Modify: `references/api-reference.md`
- Modify: `references/core/*.md`
- Modify: `references/adapters/*.md`
- Modify: `examples/*.md`
- Modify: `assets/templates/*.md`

- [ ] **Step 1: Create documentation directories**

```powershell
New-Item -ItemType Directory -Force -Path docs/user,docs/developer,docs/reference,docs/guides | Out-Null
```

- [ ] **Step 2: Rewrite README scope**

`README.md` must contain these top-level sections only:

```markdown
# project-memory-manager

## What It Does
## Quick Start
## MCP First
## New CLI Entrypoints
## Data Separation
## Documentation Map
## Development
## License
```

All commands in README must use `src/bin/*.js`.

- [ ] **Step 3: Rewrite SKILL scope**

`SKILL.md` must focus on Codex runtime behavior:

```markdown
# 项目记忆管理器

## 什么时候使用
## 默认工作流
## MCP 优先规则
## 查询顺序
## 构建和刷新 KB
## 升级后处理
## 必读文档索引
## 核心规则
```

Remove long production cleanup, Kimi installation, and Cocos command blocks from `SKILL.md`; replace them with links to `docs/`.

- [ ] **Step 4: Create `docs/reference/cli.md`**

Document the new commands exactly:

```text
node src/bin/mcp.js
node src/bin/init-workspace.js
node src/bin/detect-topology.js
node src/bin/build-project.js
node src/bin/discover-features.js
node src/bin/build-feature.js
node src/bin/query-project.js
node src/bin/query-feature.js
node src/bin/query-chain.js
node src/bin/rebuild-kbs.js
node src/bin/validate-package.js
```

- [ ] **Step 5: Replace old script paths**

Run:

```powershell
rg "scripts/[A-Za-z0-9_./-]+\\.js" README.md SKILL.md docs references examples assets tests package.json skill-version.json
```

Expected after edits: no old command paths remain except historical changelog entries in `CHANGELOG.md`.

- [ ] **Step 6: Commit**

```powershell
git add README.md SKILL.md docs references examples assets tests
git commit -m "重写源码结构相关文档"
```

---

### Task 8: Version, Validation, and Real qyProject Rebuild

**Files:**
- Modify: `skill-version.json`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Bump version**

Set in `skill-version.json`:

```json
"version": "0.23.0"
```

Add capability:

```json
"src-layout-restructure"
```

- [ ] **Step 2: Add changelog entry**

Add under `[未发布]`:

```markdown
## [0.23.0] - 2026-06-03

### 破坏性变更
- 删除旧 `scripts/*.js` 入口，统一切换到 `src/bin/*.js`。
- 根目录不再保留运行态 `project-memory/`。

### 改进
- 将源码按 bin、commands、mcp、extraction、graph、query、discovery、adapters、maintenance、shared 分层。
- 重写 README、SKILL 和 docs 导航，明确 MCP-first 与 external-data 边界。
```

- [ ] **Step 3: Run complete local validation**

```powershell
npm test
npm run test:layout
npm run test:mcp
npm run test:feature
npm run test:path
npm run test:summary
npm run test:source-layout
node src/bin/validate-package.js .
git diff --check
```

Expected:

```text
pinus-backend validation passed
workspace-layout validation passed
mcp-server validation passed
feature-discovery validation passed
source-layout validation passed
validate-package passes for project-memory-manager@0.23.0
git diff --check exits 0
```

- [ ] **Step 4: Rebuild real qyProject KB**

```powershell
node src/bin/build-project.js --workspace-root E:/xile-workspace/qyProject --data-root E:/xile-workspace/codex-tools/project-memory-data --layout external-data --json
node src/bin/discover-features.js --workspace-root E:/xile-workspace/qyProject --data-root E:/xile-workspace/codex-tools/project-memory-data --layout external-data --limit 300 --min-confidence low --json
node src/bin/build-feature.js --workspace-root E:/xile-workspace/qyProject --data-root E:/xile-workspace/codex-tools/project-memory-data --layout external-data --feature-key qyproject-admin --json
```

Expected:

```text
project-global build exits 0
discover-features includes qyproject-admin
build-feature exits 0 for qyproject-admin
```

- [ ] **Step 5: Verify real captcha chain**

```powershell
node src/bin/query-feature.js --workspace-root E:/xile-workspace/qyProject --data-root E:/xile-workspace/codex-tools/project-memory-data --layout external-data --feature qyproject-admin --request captcha --downstream --depth 5 --json
```

Expected JSON includes:

```text
GET /auth/captcha
AuthController.getCaptcha
captcha.generateCaptcha
captcha.saveCaptcha
```

- [ ] **Step 6: Commit**

```powershell
git add .
git commit -m "发布源码结构重构版本"
```

---

### Task 9: Update Local MCP Configuration and Push

**Files:**
- Modify local Codex MCP config if it references `scripts/mcp_server.js`

- [ ] **Step 1: Locate MCP config**

Run:

```powershell
Select-String -Path C:\Users\Administrator\.codex\config.toml -Pattern "project-memory-manager|mcp_server|src/bin/mcp" -Context 2,2
```

Expected: current PMM MCP server entry is visible.

- [ ] **Step 2: Update MCP path**

Replace:

```toml
args = ["E:/xile-workspace/codex-tools/project-memory-manager/scripts/mcp_server.js"]
```

with:

```toml
args = ["E:/xile-workspace/codex-tools/project-memory-manager/src/bin/mcp.js"]
```

If the config uses backslashes, keep the local style but point to `src/bin/mcp.js`.

- [ ] **Step 3: Push main**

```powershell
git push origin main
```

Expected: `main -> main`.

- [ ] **Step 4: Final status**

```powershell
git status --short --branch
git log -1 --oneline --decorate
```

Expected:

```text
## main...origin/main
<commit> (HEAD -> main, origin/main, origin/HEAD) 发布源码结构重构版本
```

- [ ] **Step 5: Tell user restart requirement**

Final message must state:

```text
这次删除了旧 scripts 入口并更新了 MCP 路径，需要重启 Codex 后才能加载新 MCP 服务。重启后我会用 get_current_state 和 query_feature_chain 验证。
```

---

## Self-Review Checklist

- [ ] Spec requirement "no old compatibility" is covered by Task 6.
- [ ] Spec requirement "new src/bin entrypoints" is covered by Tasks 1, 4, 5, and 6.
- [ ] Spec requirement "docs restructure" is covered by Task 7.
- [ ] Spec requirement "root project-memory removed" is covered by Task 6.
- [ ] Spec requirement "real qyProject verification" is covered by Task 8.
- [ ] Spec requirement "MCP config migration" is covered by Task 9.
- [ ] No implementation task leaves a temporary `scripts/` dependency after Task 6.
