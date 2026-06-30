# project-memory-manager

## 工具定位

Project Memory Manager（PMM）为目标项目构建外置知识库，让 Codex 可以查询项目结构、功能链路、HTTP 路由、Next.js App Router endpoint、Pinus handler、Vue/Express 全栈链路、Prisma/后端数据表读写摘要、外部服务依赖、Cocos prefab 绑定、状态、事件和项目协议，并在 AI 开发任务中提供 PMM 使用门禁、执行计划、历史任务召回、项目 playbook、改动范围复核和结果记忆。

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
- `decide_pmm_usage`：任务开始时判断必须深度使用 PMM、建议使用 PMM，还是只允许小范围 UI 门禁通过。
- `plan_task_execution`：结合门禁和 PMM 上下文生成 AI 执行计划。
- `recall_task_memory`：按任务召回历史 outcome、相关文件、验证命令、观察和 playbook 规则。
- `prepare_agent_brief`：任务开始前聚合 usage gate、执行计划、历史记忆、playbook、推荐文件和验证命令。
- `summarize_project_memory`：汇总当前项目已沉淀的任务记录和规则。
- `update_project_playbook`：把稳定项目规则写入外置 PMM playbook，或从任务结果中确定性推断规则。
- `prepare_task_context`：输入自然语言任务，返回 AI 可直接使用的上下文包。
- `explain_feature_for_agent`：按 feature key 返回面向 AI 的功能记忆卡片。
- `analyze_change_impact`：按 changed files 或 git diff 分析影响范围和验证建议。
- `validate_edit_scope`：提交前按 changed files / diff 复核是否越过 PMM 建议边界。
- `review_patch_for_agent`：按 PMM 证据给 AI patch 生成复核结论和检查清单。
- `record_task_outcome`：把任务结果、改动文件和验证命令写入外置 PMM 数据，供后续会话参考。
- `query_project_chain`：查询 project-global KB；默认会先确保 KB 为 `fresh`，必要时同步重建并等待完成。
- `query_feature_chain`：查询单个功能 KB；默认会先确保 feature KB 为 `fresh`，必要时同步重建并等待完成。

## Agent 执行闭环

PMM v0.70 起，AI 接到开发任务时优先使用 `prepare_agent_brief`，一次拿到 Usage Gate、执行计划、历史任务记忆、项目 playbook、推荐文件和验证命令。v0.60 的执行闭环仍然存在：先过 Usage Gate，再按风险选择上下文、实现、复核和结果记录。

- `prepare_agent_brief` / `prepare-agent-brief.js`：适合任务开始前使用，是 v0.70 的首选高层入口。
- `recall_task_memory` / `recall-task-memory.js`：适合只想查历史任务时使用，例如“之前 OAuth token 怎么验证过”。
- `summarize_project_memory` / `summarize-project-memory.js`：适合跨会话接力或阶段复盘时查看 PMM 已记住什么。
- `update_project_playbook` / `update-project-playbook.js`：适合把稳定项目规则沉淀成可召回 playbook。
- `decide_pmm_usage` / `decide-pmm-usage.js`：适合任务开始时使用。少量明确 UI 源文件可以得到 `optional_skip_allowed`，但必须保留门禁证据并在提交前复核；涉及 API、数据、鉴权、外部服务、交易/活动或跨模块时会要求深度 PMM。
- `plan_task_execution` / `plan-task-execution.js`：适合动手前使用。它会把门禁、PMM 上下文、目标文件、编辑边界和验证命令组合成 AI 可执行计划。
- `prepare_task_context` / `prepare-task-context.js`：适合任务开始前使用，例如“修改 settings 页 AI 配置保存逻辑”。输出会给出任务理解、相关 feature、关键入口、关键文件、调用链、数据表影响、外部服务、建议编辑边界和验证命令。
- `explain_feature_for_agent` / `explain-feature-for-agent.js`：适合进入某个功能前使用，例如 `featureKey=chat`、`settings`、`facebook-oauth`。输出是功能记忆卡片。
- `analyze_change_impact` / `analyze-change-impact.js`：适合提交前或 review 前使用，输入 changed files 或 git diff，输出影响范围、风险等级、重点复核链路、推荐测试和是否需要重建 feature KB。
- `validate_edit_scope` / `validate-edit-scope.js`：适合提交前使用。它会检查 changed files 是否落在 PMM 建议边界内，并指出越界文件、高风险文件或疑似漏改文件。
- `review_patch_for_agent` / `review-patch-for-agent.js`：适合 AI 自检和 code review 前使用，返回 review verdict、findings 和检查清单。
- `record_task_outcome` / `record-task-outcome.js`：适合完成任务后使用，把结果摘要、改动文件、验证命令和观察写进外置数据根目录。

这些输出都会带 AI 证据字段，例如 `file`、`method`、`endpoint`、`nodeId`、`edgeType` 和 `confidence`，便于把 PMM 结果注入计划或 review prompt。

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
node src/bin/prepare-task-context.js
node src/bin/explain-feature-for-agent.js
node src/bin/analyze-change-impact.js
node src/bin/decide-pmm-usage.js
node src/bin/plan-task-execution.js
node src/bin/validate-edit-scope.js
node src/bin/review-patch-for-agent.js
node src/bin/record-task-outcome.js
node src/bin/recall-task-memory.js
node src/bin/prepare-agent-brief.js
node src/bin/summarize-project-memory.js
node src/bin/update-project-playbook.js
node src/bin/rebuild-kbs.js
node src/bin/validate-package.js
```

更多命令见 `docs/reference/cli.md`。

需要看后端数据表影响时，用 `focus=data` 或 `mode=fullstack-data` 查询，并读取返回的 `dataAccessSummary`。

Next.js App Router 项目可以直接查 `app/api/**/route.ts` 生成的 endpoint，例如 `--endpoint "GET /api/chat" --downstream --mode fullstack-data`；前端 `fetchJSON` / `EventSource` 调用会尽量匹配到对应 `/api/**` route。Prisma 读写会生成 table/model 节点，可用 `--type table --name <model>` 查询。外部依赖可用 `--type external-service --name facebook`、`--type external-service --name anthropic` 等方式查询。

查询时不要把整句自然语言问题传给 `message`。`message` 只表示项目里的协议消息名或事件消息名；中文业务问题要先抽取 `endpoint`、`request`、`method` 或关键词，再用对应 selector 查询。

查询结果会返回 `kbFreshness` 和 `_mcpFreshness`。MCP 查询默认 `freshnessPolicy=auto_rebuild`：状态为 `stale`、`missing`、`unknown` 时会先重建并等待 `fresh`，再返回查询结果。只有调试旧 KB 时才显式传 `freshnessPolicy=allow_stale`；想阻止自动重建时传 `freshnessPolicy=require_fresh`。

如果 freshness 返回 `sourceFallbackAllowed=false`，不要直接回源码追链路；先让 MCP 自动重建，或用 `start_build_project_index` 传 `wait:true` 等到 fresh。

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
npm run test:agent
npm run test:feature
npm run test:path
npm run test:summary
npm run test:source-layout
node src/bin/validate-package.js .
```

`scripts/` 目录已经有意删除，不要再新增兼容包装入口。

## 许可证

MIT
