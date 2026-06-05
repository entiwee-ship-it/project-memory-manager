# MCP 优先

Codex 使用 PMM 时，应优先通过 MCP 调用工具。

先安装 skill，再配置 MCP。skill 让 `project-memory-manager` 出现在技能列表里；MCP 把可调用工具暴露给 Codex。

```powershell
npx skills add https://github.com/entiwee-ship-it/project-memory-manager.git --skill project-memory-manager -g -a codex -y --full-depth
```

推荐工具顺序：

1. `get_current_state`
2. `check_kb_freshness`
3. 如果 `status` 不是 `fresh`，先按 `recommendedAction` 重建
4. `query_project_chain`
5. `query_feature_chain`
6. `discover_features`
7. `build_feature_index`
8. MCP 不可用时，再使用 `src/bin` 下的 CLI 命令兜底

`get_current_state` 会返回 `projectGlobalFreshness`。Codex 查询前应先看这个状态：

- `fresh`：可以直接查询。
- `stale`：目标源码或 PMM 版本已经变化，先重建。
- `missing`：KB 尚未构建。
- `unknown`：旧 KB 没有源码快照或缺少配置，先重建一次。

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
