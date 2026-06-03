# MCP Tools

Workspace lifecycle:

- `inspect_workspace`
- `get_current_state`
- `init_workspace`
- `detect_topology`
- `diagnose_workspace`

Build:

- `build_project_index`
- `start_build_project_index`
- `get_job_status`
- `get_job_result`
- `discover_features`
- `build_feature_index`

Query:

- `query_project_chain`
- `query_feature_chain`

All tools accept `workspaceRoot`; most accept `dataRoot` for external data layout.
