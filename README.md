# project-memory-manager

## 工具定位

Project Memory Manager（PMM）为目标项目构建外置知识库，让 Codex 可以查询项目结构、功能链路、HTTP 路由、Pinus handler、Vue/Express 全栈链路、后端数据表读写摘要、Cocos prefab 绑定、状态、事件和项目协议。

PMM 的核心边界是三套目录分离：

- PMM 源码：当前仓库。
- 目标项目：Codex 实际要开发的业务仓库。
- PMM 数据根目录：PMM 生成的外置运行数据，通常是 `E:/xile-workspace/codex-tools/project-memory-data`。

不要把 PMM 运行数据写进目标项目。

## 快速开始

新电脑或新 Codex 环境按这个顺序处理：

- clone 当前 GitHub 仓库。
- 安装 npm 依赖。
- 安装 Codex skill，让技能列表里出现 `project-memory-manager`。
- 配置 Codex MCP，让它启动 `src/bin/mcp.js`。
- 把生成的 PMM 数据放在外置数据根目录。

完整流程见 `docs/user/install-from-github.md`。

Codex 已加载 PMM MCP 后，日常查询优先使用 MCP。CLI 主要用于部署、验证和 MCP 不可用时兜底。

```powershell
npx skills add https://github.com/entiwee-ship-it/project-memory-manager.git --skill project-memory-manager -g -a codex -y --full-depth
node src/bin/init-workspace.js --workspace-root E:/xile-workspace/qyProject --data-root E:/xile-workspace/codex-tools/project-memory-data
node src/bin/detect-topology.js --workspace-root E:/xile-workspace/qyProject --data-root E:/xile-workspace/codex-tools/project-memory-data
node src/bin/build-project.js --workspace-root E:/xile-workspace/qyProject --data-root E:/xile-workspace/codex-tools/project-memory-data --json
node src/bin/discover-features.js --workspace-root E:/xile-workspace/qyProject --data-root E:/xile-workspace/codex-tools/project-memory-data --json
node src/bin/build-feature.js --workspace-root E:/xile-workspace/qyProject --data-root E:/xile-workspace/codex-tools/project-memory-data --feature-key qyproject-admin --json
```

## MCP 优先

MCP 服务入口：

```powershell
node src/bin/mcp.js
```

Codex MCP 配置应指向：

```toml
args = ["E:/xile-workspace/codex-tools/project-memory-manager/src/bin/mcp.js"]
```

常用 MCP 工具：

- `get_current_state`：查看目标项目的 PMM 状态。
- `check_kb_freshness`：判断 KB 是否仍与当前源码和 PMM 版本一致。
- `build_project_index`：同步构建 project-global KB。
- `start_build_project_index`：异步构建 project-global KB；传 `wait:true` 时会等待完成并返回最终 freshness。
- `discover_features`：发现功能候选。
- `build_feature_index`：生成并构建单个功能 KB。
- `query_project_chain`：查询 project-global KB；默认会先确保 KB 为 `fresh`，必要时同步重建并等待完成。
- `query_feature_chain`：查询单个功能 KB；默认会先确保 feature KB 为 `fresh`，必要时同步重建并等待完成。

## CLI 入口

所有受支持的 CLI 命令都在 `src/bin` 下。

```powershell
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

更多命令见 `docs/reference/cli.md`。

需要看后端数据表影响时，用 `focus=data` 或 `mode=fullstack-data` 查询，并读取返回的 `dataAccessSummary`。

查询结果会返回 `kbFreshness` 和 `_mcpFreshness`。MCP 查询默认 `freshnessPolicy=auto_rebuild`：状态为 `stale`、`missing`、`unknown` 时会先重建并等待 `fresh`，再返回查询结果。只有调试旧 KB 时才显式传 `freshnessPolicy=allow_stale`；想阻止自动重建时传 `freshnessPolicy=require_fresh`。

如果目标项目有构建生成文件或缓存产物，在外置 `project-profile.json` 配置 `generatedFiles` / `snapshotIgnore`。生成文件会用内容哈希判断，内容未变但 mtime 变化时不会触发 stale。

## 数据分离

日常开发使用 `external-data` 布局：

```powershell
node src/bin/build-project.js --workspace-root <project-root> --data-root <pmm-data-root> --layout external-data
```

PMM 运行文件会写到：

```text
<pmm-data-root>/workspaces/<workspace-id>/
```

目标项目保持干净。以后从 Codex 移除 PMM 时，不需要到业务仓库里清理一堆生成文件。

## 文档索引

- `docs/user/quick-start.md`：快速启动和常用流程。
- `docs/user/install-from-github.md`：新电脑从 GitHub clone 到 Codex MCP 验证的完整流程。
- `docs/user/mcp-first.md`：MCP 优先使用方式。
- `docs/user/external-data-layout.md`：PMM 源码、目标项目、数据根目录三者分离规则。
- `docs/reference/cli.md`：CLI 命令参考。
- `docs/reference/mcp-tools.md`：MCP 工具参考。
- `docs/developer/source-layout.md`：源码目录职责。
- `docs/developer/testing.md`：本地验证命令。
- `docs/guides/fullstack-admin-kb.md`：Vue/Express 后台 KB 流程。
- `docs/guides/cocos-authoring.md`：Cocos 创作辅助流程。
- `docs/guides/troubleshooting.md`：常见诊断。

## 开发验证

改动后运行匹配的验证命令：

```powershell
npm test
npm run test:layout
npm run test:mcp
npm run test:feature
npm run test:path
npm run test:summary
npm run test:source-layout
node src/bin/validate-package.js .
```

`scripts/` 目录已经有意删除，不要再新增兼容包装入口。

## 许可证

MIT
