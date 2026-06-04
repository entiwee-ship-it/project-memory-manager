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

Query selectors include `type`, `file`, `name`, `request`, `endpoint`, `method`, `upstream`, and `downstream`.
For Cocos prefab work, use:

- `type=prefab-component` with `file=<prefab path>` to get grouped component attachments.
- `type=script-usage` with `file=<script path>` to find prefab/nodePath usage.
- `excludeFile=<prefab path>` or `excludePrefab=<prefab path>` to remove the current prefab from script usage results.
- `area`, `module`, `excludeModule`, `protocol`, and `path` narrow broad results such as `login` to a specific subsystem.
- `detail=summary|grouped|full` controls Cocos summary verbosity.

All tools accept `workspaceRoot`; most accept `dataRoot` for external data layout.
