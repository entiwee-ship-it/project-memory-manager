# External Data Layout

PMM has three separate locations:

- Source repo: `project-memory-manager`
- Target repo: the project Codex is developing
- Data root: generated PMM runtime data

External data layout writes to:

```text
<data-root>/workspaces/<workspace-id>/
```

Use:

```powershell
node src/bin/build-project.js --workspace-root <project-root> --data-root <data-root> --layout external-data
```

Do not add runtime KB files to the target project. Fixture directories in tests may still contain `project-memory` because they model old project layouts.
