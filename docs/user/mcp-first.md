# MCP 优先

Codex 使用 PMM 时，应优先通过 MCP 调用工具。

先安装 skill，再配置 MCP。skill 让 `project-memory-manager` 出现在技能列表里；MCP 把可调用工具暴露给 Codex。

```powershell
npx skills add https://github.com/entiwee-ship-it/project-memory-manager.git --skill project-memory-manager -g -a codex -y --full-depth
```

推荐工具顺序：

1. `get_current_state`
2. `check_kb_freshness`
3. `query_project_chain`
4. `query_feature_chain`
5. 如果需要手动维护，再调用 `build_project_index` / `build_feature_index`
6. `discover_features`
7. MCP 不可用时，再使用 `src/bin` 下的 CLI 命令兜底

`get_current_state` 会返回 `projectGlobalFreshness`。Codex 查询前应先看这个状态：

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
