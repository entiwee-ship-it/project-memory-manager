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
- `type=prefab-script-usage` with `file=<prefab path>` to batch-check every custom script mounted on a prefab and where else it is used.
- `excludeFile=<prefab path>` or `excludePrefab=<prefab path>` to remove the current prefab from script usage results.
- `area`, `module`, `excludeModule`, `protocol`, and `path` narrow broad results such as `login` to a specific subsystem.
- `mode=fullstack` or `fullstack=true` expands frontend-to-backend HTTP traces without manually setting deep traversal.
- `focus=fullstack` folds same-file helper methods into `relatedHelpers`.
- `includeUnresolved=true` shows safe skipped dynamic/member calls as unresolved call nodes.
- `grouped=true` returns broad search results grouped by subsystem with recommended narrowing args.
- `detail=counts|summary|grouped|full` controls Cocos summary verbosity.

All tools accept `workspaceRoot`; most accept `dataRoot` for external data layout.
