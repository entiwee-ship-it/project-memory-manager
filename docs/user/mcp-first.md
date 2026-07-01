# MCP 优先

Codex 使用 PMM 时，应优先通过 MCP 调用工具。

先安装 skill，再配置 MCP。skill 让 `project-memory-manager` 出现在技能列表里；MCP 把可调用工具暴露给 Codex。

```powershell
npx skills add https://github.com/entiwee-ship-it/project-memory-manager.git --skill project-memory-manager -g -a codex -y --full-depth
```

推荐工具顺序：

1. `agent_preflight`
2. `get_current_state`
3. 路径或数据根不确定时，先用 `list_workspaces` / `resolve_workspace` / `diagnose_data_root`
4. `check_kb_freshness`
5. `prepare_agent_brief`
6. `decide_pmm_usage` / `plan_task_execution` / `prepare_task_context`
7. `recall_task_memory` / `summarize_project_memory`
8. `explain_feature_for_agent` / `analyze_change_impact`
9. `validate_edit_scope` / `review_patch_for_agent`
10. `record_task_outcome` / `update_project_playbook`
11. `query_project_chain`
12. `query_feature_chain`
13. 如果需要手动维护，再调用 `build_project_index` / `build_feature_index`
14. `discover_features`
15. MCP 不可用时，再使用 `src/bin` 下的 CLI 命令兜底

`agent_preflight` 是 v0.80 的任务级自检入口：它会先判断 MCP tool、数据根、KB freshness 和 skill 版本是否 ready，并返回 `health.checks`、`findings`、`repairPlan` 和 `nextAction`。只有 `status=ready` 后才继续调用 `prepare_agent_brief`；如果返回 `blocked` 或 `needs_action`，先按 `nextAction` 修复环境，不要把旧 PMM 上下文当成可用结果。

`prepare_agent_brief` 会聚合 Usage Gate、执行计划、历史任务记忆、项目 playbook、推荐文件和验证命令。`decide_pmm_usage` 仍是底层门禁：少量明确 UI 源文件可以只走轻量 PMM 证据；涉及 API、数据、鉴权、外部服务、交易/活动或跨模块时，应继续使用深度 PMM 上下文。`prepare_agent_brief`、`plan_task_execution`、`validate_edit_scope` 和 `review_patch_for_agent` 在需要深度上下文时会继续遵守 freshness gate。

`get_current_state` 会返回 `projectGlobalFreshness`。Codex 查询前应先看这个状态：

从 v0.71 起，`get_current_state` 还会返回 `workspaceHash`、`registryPath` 和 `workspaceIdentity`。同一个 `PMM_DATA_ROOT` 可以服务多个项目；如果项目移动过、当前路径不确定、或者需要跨会话接力，应先用 `resolve_workspace` 明确目标项目对应的 `memoryRoot`，必要时用 `diagnose_data_root` 检查缺失 manifest、失效路径或 `workspaceId` 碰撞。

- `fresh`：可以直接查询。
- `stale`：目标源码或 PMM 版本已经变化。
- `missing`：KB 尚未构建。
- `unknown`：旧 KB 没有源码快照或缺少配置。

日常查询不用手动等待重建。`query_project_chain` 和 `query_feature_chain` 默认 `freshnessPolicy=auto_rebuild`，发现 KB 不是 `fresh` 时会同步重建、等待完成、再次检查，然后只在最终 `fresh` 后返回查询结果。

查询结果里的 `_mcpFreshness` 是等待证据：

- `initialStatus`：查询前状态。
- `rebuilt`：本次查询是否触发了自动重建。
- `finalStatus`：重建后状态。

只有调试旧 KB 时才传 `freshnessPolicy=allow_stale`。如果只想阻止旧 KB 查询但不希望自动重建，传 `freshnessPolicy=require_fresh`。

`stale`、`missing`、`unknown` 不是“可以绕开 PMM”的理由，而是必须先刷新 KB 的门禁状态。看到 `sourceFallbackAllowed=false` 或 `mustRefreshBeforeSourceFallback=true` 时，Codex 不能直接回源码追链路；应先让查询工具自动重建，或调用 `start_build_project_index(wait:true)` 等到 fresh。

手动预热 project-global 时，可以调用 `start_build_project_index` 并传：

```json
{
  "wait": true,
  "timeoutMs": 120000
}
```

这样返回值会直接包含最终 `projectGlobalFreshness`。如果不传 `wait:true`，必须轮询 `get_job_status` 直到 `status=succeeded`，再调用查询工具；不能启动任务后直接回源码大范围搜索。`queued` / `running` 阶段的 `exitCode` 应为 `null`，只有最终成功或失败后才看 `exitCode`。

如果某些构建生成文件只改 mtime、不改内容，可以在外置 `project-profile.json` 中配置：

```json
{
  "snapshotIgnore": ["**/.vite/**"],
  "generatedFiles": ["cms-server/src/config/built-env.ts"]
}
```

`generatedFiles` 会用内容哈希判断，内容不变时不会让 KB stale。

MCP 服务入口：

```powershell
node src/bin/mcp.js
```

Codex 配置示例：

```toml
[mcp_servers.project_memory_manager]
command = "node"
args = ["E:/xile-workspace/codex-tools/project-memory-manager/src/bin/mcp.js"]
startup_timeout_sec = 120

[mcp_servers.project_memory_manager.env]
PMM_DATA_ROOT = "E:/xile-workspace/codex-tools/project-memory-data"
```

修改 MCP 入口或 PMM 源码后，需要重启 Codex，让 MCP 服务重新加载。
