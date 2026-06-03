# Quick Start

PMM should run with external data by default. The target project does not receive PMM runtime files.

```powershell
$project = "E:/xile-workspace/qyProject"
$data = "E:/xile-workspace/codex-tools/project-memory-data"

node src/bin/init-workspace.js --workspace-root $project --data-root $data
node src/bin/detect-topology.js --workspace-root $project --data-root $data
node src/bin/build-project.js --workspace-root $project --data-root $data --json
node src/bin/discover-features.js --workspace-root $project --data-root $data --json
```

Build a feature KB after choosing a candidate:

```powershell
node src/bin/build-feature.js --workspace-root $project --data-root $data --feature-key qyproject-admin --json
```

Query with MCP first. Use CLI only when the MCP server is unavailable.
