# PMM 仓库源码与文档重构设计

## 背景

`project-memory-manager` 已经从早期单技能脚本演进为包含 MCP、CLI、KB 构建、feature discovery、Vue/Express 全栈抽取、Cocos 辅助、验证和维护工具的完整工具项目。当前仓库仍以 `scripts/` 扁平目录承载大部分实现，`README.md` 和 `SKILL.md` 同时承担安装说明、运行手册、架构说明和维护说明，导致后续改造成本持续升高。

这次重构按用户确认的方向执行：不做旧入口兼容，不保留 `scripts/*.js` 包装层，直接迁移到最优的新目录结构。项目只有单人维护，优先降低长期复杂度，而不是兼容旧命令。

## 目标

1. 将源码从扁平 `scripts/` 迁移到职责清晰的 `src/` 结构。
2. 删除旧 `scripts/` 入口，统一使用 `src/bin/*.js`。
3. 重组文档，让 `README.md`、`SKILL.md`、`docs/`、`references/` 各自只有一个清晰职责。
4. 移除仓库根目录残留的 `project-memory/`，保持插件源码、业务项目、PMM data root 三者分离。
5. 保持当前 0.22 行为不回退，特别是 MCP 查询、external-data、`qyproject-admin`、Vue/Express 全栈链路。

## 非目标

1. 不保持 `node scripts/*.js` 旧命令可用。
2. 不保留旧 MCP 配置路径。
3. 不在本轮改写核心算法行为。
4. 不把测试 fixture 中用于 legacy 场景的 `project-memory/` 删除。
5. 不把文档迁到外部仓库或 `codex-work`。

## 新源码结构

```text
src/
  bin/
    mcp.js
    init-workspace.js
    detect-topology.js
    build-project.js
    discover-features.js
    build-feature.js
    query-project.js
    query-feature.js
    query-chain.js
    rebuild-kbs.js
    cocos-authoring.js
    query-cocos-profile.js
    diagnose-paths.js
    diagnose-imports.js
    check-version.js
    show-version.js
    validate-package.js
    clean-production.js
    clean-temp.js
    install-kimi.js
  commands/
    lifecycle/
    build/
    query/
    cocos/
    diagnostics/
    maintenance/
  mcp/
  lifecycle/
  extraction/
    ast/
    http/
    vue/
    cocos/
    summary/
  graph/
  query/
  discovery/
  adapters/
    extract/
    topology/
  maintenance/
  shared/
```

### 入口规则

所有人工 CLI 入口放在 `src/bin/`，文件名使用 kebab-case。入口只做三件事：

1. 加载对应 command。
2. 传入 `process.argv.slice(2)`。
3. 捕获异常并用稳定错误码退出。

示例：

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

### 业务模块规则

- `commands/` 负责参数解析、输入输出格式和调用业务模块。
- `lifecycle/` 负责 workspace 初始化、拓扑检测、外置 data root、KB 重建编排。
- `extraction/` 负责从源码、Vue SFC、HTTP、Cocos prefab、结构化摘要中抽取事实。
- `graph/` 负责 graph node、edge、lookup、report 和 registry 输出。
- `query/` 负责 project、feature、chain、semantic 查询。
- `discovery/` 负责 feature candidate 和 feature config。
- `mcp/` 负责 MCP server、tool schema、tool handler、query cache。
- `shared/` 只放无业务方向的路径、JSON、锁、版本、时间、文件工具。

## 文件迁移映射

| 当前文件 | 新位置 |
| --- | --- |
| `scripts/mcp_server.js` | `src/mcp/server.js` + `src/bin/mcp.js` |
| `scripts/init_project_memory.js` | `src/commands/lifecycle/init-workspace.js` + `src/bin/init-workspace.js` |
| `scripts/detect_project_topology.js` | `src/commands/lifecycle/detect-topology.js` + `src/bin/detect-topology.js` |
| `scripts/build_project_kb.js` | `src/commands/build/build-project.js` + `src/bin/build-project.js` |
| `scripts/build_feature_index.js` | `src/commands/build/build-feature.js` + `src/bin/build-feature.js` |
| `scripts/discover_features.js` | `src/commands/build/discover-features.js` + `src/bin/discover-features.js` |
| `scripts/build_chain_kb.js` | `src/graph/build-chain-kb.js` + `src/bin/build-chain.js` |
| `scripts/query_project_kb.js` | `src/commands/query/query-project.js` + `src/bin/query-project.js` |
| `scripts/query_kb.js` | `src/commands/query/query-feature.js` + `src/bin/query-feature.js` |
| `scripts/query_chain_kb.js` | `src/query/query-chain.js` + `src/bin/query-chain.js` |
| `scripts/extract_feature_facts.js` | `src/extraction/extract-feature-facts.js` + focused helper modules |
| `scripts/extract_structured_summary.js` | `src/extraction/summary/extract-structured-summary.js` |
| `scripts/adapters/*` | `src/adapters/*` |
| `scripts/lib/common.js` | `src/shared/common.js` |
| `scripts/lib/workspace-layout.js` | `src/shared/workspace-layout.js` |
| `scripts/lib/feature-discovery.js` | `src/discovery/feature-discovery.js` |
| `scripts/lib/vue_sfc.js` | `src/extraction/vue/vue-sfc.js` |
| `scripts/lib/feature-kb.js` | `src/graph/feature-kb.js` |
| `scripts/lib/lock.js` | `src/shared/lock.js` |
| `scripts/cocos_authoring.js` | `src/commands/cocos/cocos-authoring.js` + `src/bin/cocos-authoring.js` |
| `scripts/query_cocos_profile.js` | `src/commands/cocos/query-cocos-profile.js` + `src/bin/query-cocos-profile.js` |
| `scripts/clean_*` | `src/maintenance/*` + `src/bin/*` |
| `scripts/check_skill_version.js` | `src/maintenance/check-version.js` + `src/bin/check-version.js` |
| `scripts/show_skill_version.js` | `src/maintenance/show-version.js` + `src/bin/show-version.js` |
| `scripts/validate_*` | `src/maintenance/validate-*` + `src/bin/*` |

## 大文件拆分策略

第一轮重构只做可控拆分，不在同一轮重写算法。

### `extract_feature_facts`

迁移后拆成：

```text
src/extraction/extract-feature-facts.js
src/extraction/ast/methods.js
src/extraction/http/endpoints.js
src/extraction/http/requests.js
src/extraction/vue/vue-sfc.js
src/extraction/cocos/prefab-facts.js
src/extraction/summary/structured-summary.js
src/extraction/state/state-access.js
src/extraction/db/db-access.js
```

`extract-feature-facts.js` 保留编排职责：解析输入、收集文件、调用各 extractor、合并结果、写 `scan.raw.json`。

### `build_chain_kb`

迁移后拆成：

```text
src/graph/build-chain-kb.js
src/graph/nodes.js
src/graph/edges.js
src/graph/http-linking.js
src/graph/lookup.js
src/graph/report.js
src/graph/registry.js
```

`build-chain-kb.js` 只负责读取 config、调用抽取、组装 graph、写输出。

## 文档结构

```text
docs/
  user/
    quick-start.md
    mcp-first.md
    external-data-layout.md
    query-guide.md
    feature-kb-workflow.md
  developer/
    architecture.md
    source-layout.md
    release-process.md
    testing.md
  reference/
    cli.md
    mcp-tools.md
    kb-schema.md
    adapters.md
  guides/
    fullstack-admin-kb.md
    cocos-authoring.md
    troubleshooting.md
```

### `README.md`

保留：

- 项目定位。
- 最短安装方式。
- MCP-first 快速路径。
- 新 CLI 入口摘要。
- 文档导航。

移出：

- 完整命令手册。
- KB schema 细节。
- Cocos 深度说明。
- Kimi 长安装说明。
- 故障排查。

### `SKILL.md`

保留：

- 什么时候使用 PMM。
- Codex 优先 MCP 的工作流。
- 外置 data root 原则。
- 查询优先级。
- 升级后重建 KB 的规则。

移出：

- 大段 CLI 示例。
- 生产清理教程。
- Cocos profile 细节。
- 长故障排查。

### `references/`

`references/` 保留为协议和适配器参考，但用户和维护文档迁入 `docs/`。`references/api-reference.md` 的 CLI 命令全部改为 `src/bin/*.js`。

## 包和入口更新

`package.json` 改为：

```json
{
  "scripts": {
    "test": "node tests/pinus-backend.test.js",
    "test:layout": "node tests/workspace-layout.test.js",
    "test:mcp": "node tests/mcp-server.test.js",
    "test:feature": "node tests/feature-discovery.test.js",
    "test:path": "node tests/path-resolution.test.js",
    "test:summary": "node tests/structured-summary.test.js",
    "mcp": "node src/bin/mcp.js"
  }
}
```

`skill-version.json` 改为：

```json
{
  "rebuildCommand": "node src/bin/rebuild-kbs.js --workspace-root <project-root>"
}
```

Codex MCP 配置改为：

```toml
[mcp_servers.project_memory_manager]
command = "node"
args = ["E:/xile-workspace/codex-tools/project-memory-manager/src/bin/mcp.js"]
```

## 测试策略

1. 迁移前增加入口测试，锁定新 `src/bin` 命令存在且可加载。
2. 每迁移一组模块，立即跑对应测试。
3. 全部迁移后跑完整矩阵：
   - `npm test`
   - `npm run test:layout`
   - `npm run test:mcp`
   - `npm run test:feature`
   - `npm run test:path`
   - `npm run test:summary`
   - `node src/bin/validate-package.js .`
4. 用真实 `E:/xile-workspace/qyProject` 重建：
   - `node src/bin/build-project.js --workspace-root E:/xile-workspace/qyProject --data-root E:/xile-workspace/codex-tools/project-memory-data --layout external-data --json`
   - `node src/bin/discover-features.js --workspace-root E:/xile-workspace/qyProject --data-root E:/xile-workspace/codex-tools/project-memory-data --layout external-data --limit 300 --min-confidence low --json`
   - `node src/bin/build-feature.js --workspace-root E:/xile-workspace/qyProject --data-root E:/xile-workspace/codex-tools/project-memory-data --layout external-data --feature-key qyproject-admin --json`
5. 真实查询验证：
   - `node src/bin/query-feature.js --workspace-root E:/xile-workspace/qyProject --data-root E:/xile-workspace/codex-tools/project-memory-data --layout external-data --feature qyproject-admin --request captcha --downstream --depth 5 --json`

## 发布和重启要求

这次是破坏性重构。完成后必须：

1. 更新本机 MCP 配置路径。
2. 重启 Codex。
3. 重新验证 `project_memory_manager.get_current_state` 和 `query_feature_chain`。
4. 推送 `main`。

## 成功标准

1. 仓库根不再有运行态 `project-memory/`。
2. 根目录 `scripts/` 不再存在。
3. 所有可执行入口集中在 `src/bin/`。
4. README 和 SKILL 都显著变短，并指向 `docs/`。
5. 现有测试全部通过。
6. 真实 `qyProject` 的 `qyproject-admin` captcha 链路仍能查询到 controller 和 service。
