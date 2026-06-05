# MCP First

Codex should use PMM through MCP whenever possible.

Install the skill and configure MCP. The skill makes `project-memory-manager` appear in the skill list; MCP exposes callable tools.

```powershell
npx skills add https://github.com/entiwee-ship-it/project-memory-manager.git --skill project-memory-manager -g -a codex -y --full-depth
```

Preferred tool order:

1. `get_current_state`
2. `query_project_chain`
3. `query_feature_chain`
4. `discover_features`
5. `build_feature_index`
6. CLI fallback under `src/bin`

The MCP server entrypoint is:

```powershell
node src/bin/mcp.js
```

Codex config example:

```toml
[mcp_servers.project_memory_manager]
command = "node"
args = ["E:/xile-workspace/codex-tools/project-memory-manager/src/bin/mcp.js"]
startup_timeout_sec = 120

[mcp_servers.project_memory_manager.env]
PMM_DATA_ROOT = "E:/xile-workspace/codex-tools/project-memory-data"
```

After changing the MCP entrypoint or PMM source code, restart Codex so it reloads the server.
