# External Data Layout

PMM has three separate locations:

- Source repo: `project-memory-manager`
- Target repo: the project Codex is developing
- Data root: generated PMM runtime data

External data layout writes to:

```text
<data-root>/workspaces/<workspace-id>/
```

If `--data-root` is omitted, PMM uses `PMM_DATA_ROOT`. If that is also omitted, it uses a sibling `project-memory-data` directory next to the PMM source repo.

Use:

```powershell
node src/bin/build-project.js --workspace-root <project-root> --data-root <data-root> --layout external-data
```

Recommended Codex MCP env:

```toml
[mcp_servers.project_memory_manager.env]
PMM_DATA_ROOT = "E:/xile-workspace/codex-tools/project-memory-data"
```

Do not set `<data-root>` to a directory inside `<project-root>`. Do not add runtime KB files to the target project. Fixture directories in tests may still contain `project-memory` because they model old project layouts.
