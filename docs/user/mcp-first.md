# MCP First

Codex should use PMM through MCP whenever possible.

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

After changing the MCP entrypoint or PMM source code, restart Codex so it reloads the server.
