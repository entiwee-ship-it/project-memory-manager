# project-memory-manager

## What It Does

Project Memory Manager (PMM) builds an external knowledge base for a target repository so Codex can query project structure, feature chains, HTTP routes, Pinus handlers, Vue/Express flows, backend table access summaries, Cocos prefab bindings, states, events, and learned project protocols without writing memory files into the target repository.

The source repository, target development project, and generated PMM data root are separate:

- PMM source: this repository.
- Target project: the repository being developed.
- PMM data root: external runtime data, usually `E:/xile-workspace/codex-tools/project-memory-data`.

## Quick Start

On a new computer, start here:

- Clone this GitHub repo.
- Install npm dependencies.
- Install the Codex skill so `project-memory-manager` appears in the skill list.
- Configure Codex MCP to run `src/bin/mcp.js`.
- Keep generated PMM data outside the target project.

The full setup path is documented in `docs/user/install-from-github.md`.

Use MCP first when Codex has the PMM server loaded. CLI commands are mainly for setup, verification, and fallback.

```powershell
npx skills add https://github.com/entiwee-ship-it/project-memory-manager.git --skill project-memory-manager -g -a codex -y
node src/bin/init-workspace.js --workspace-root E:/xile-workspace/qyProject --data-root E:/xile-workspace/codex-tools/project-memory-data
node src/bin/detect-topology.js --workspace-root E:/xile-workspace/qyProject --data-root E:/xile-workspace/codex-tools/project-memory-data
node src/bin/build-project.js --workspace-root E:/xile-workspace/qyProject --data-root E:/xile-workspace/codex-tools/project-memory-data --json
node src/bin/discover-features.js --workspace-root E:/xile-workspace/qyProject --data-root E:/xile-workspace/codex-tools/project-memory-data --json
node src/bin/build-feature.js --workspace-root E:/xile-workspace/qyProject --data-root E:/xile-workspace/codex-tools/project-memory-data --feature-key qyproject-admin --json
```

## MCP First

Run the MCP server with:

```powershell
node src/bin/mcp.js
```

Codex MCP config should point to:

```toml
args = ["E:/xile-workspace/codex-tools/project-memory-manager/src/bin/mcp.js"]
```

Primary MCP tools:

- `get_current_state`: inspect PMM state for a workspace.
- `build_project_index`: build project-global KB synchronously.
- `start_build_project_index`: start async project-global build.
- `discover_features`: create feature candidates.
- `build_feature_index`: generate and build one feature KB.
- `query_project_chain`: query project-global KB.
- `query_feature_chain`: query one feature KB.

## New CLI Entrypoints

All supported CLI commands live under `src/bin`.

```powershell
node src/bin/mcp.js
node src/bin/init-workspace.js
node src/bin/detect-topology.js
node src/bin/build-project.js
node src/bin/discover-features.js
node src/bin/build-feature.js
node src/bin/query-project.js
node src/bin/query-feature.js
node src/bin/query-chain.js
node src/bin/rebuild-kbs.js
node src/bin/validate-package.js
```

More commands are documented in `docs/reference/cli.md`.

For backend data impact checks, query with `focus=data` or `mode=fullstack-data` and read the returned `dataAccessSummary`.

## Data Separation

Use external-data layout for active development:

```powershell
node src/bin/build-project.js --workspace-root <project-root> --data-root <pmm-data-root> --layout external-data
```

PMM writes runtime files under:

```text
<pmm-data-root>/workspaces/<workspace-id>/
```

The target project stays clean. Removing PMM from Codex does not require deleting generated files from the target repository.

## Documentation Map

- `docs/user/quick-start.md`: user setup and common workflow.
- `docs/user/install-from-github.md`: new-computer setup from GitHub clone to Codex MCP verification.
- `docs/user/mcp-first.md`: MCP-first operating model.
- `docs/user/external-data-layout.md`: source/project/data-root separation.
- `docs/reference/cli.md`: CLI command reference.
- `docs/reference/mcp-tools.md`: MCP tool reference.
- `docs/developer/source-layout.md`: source tree ownership.
- `docs/developer/testing.md`: local validation commands.
- `docs/guides/fullstack-admin-kb.md`: Vue/Express admin KB workflow.
- `docs/guides/cocos-authoring.md`: Cocos authoring workflow.
- `docs/guides/troubleshooting.md`: common diagnostics.

## Development

Run focused tests while editing:

```powershell
npm test
npm run test:layout
npm run test:mcp
npm run test:feature
npm run test:path
npm run test:summary
npm run test:source-layout
node src/bin/validate-package.js .
```

The `scripts/` directory is intentionally removed. Do not add compatibility wrappers there.

## License

MIT
