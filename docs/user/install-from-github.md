# Install From GitHub

Use this guide when setting up PMM on a new computer or a fresh Codex install.

PMM uses three separate locations:

- PMM source repo: the code cloned from GitHub.
- PMM data root: generated KB/runtime data owned by PMM.
- Target project: the repository Codex will develop.

Do not put the PMM data root inside the target project.

## 1. Prerequisites

Install these first:

- Git
- Node.js 18 or newer
- npm
- Codex with MCP support

Check the local tools:

```powershell
git --version
node --version
npm --version
```

## 2. Choose Paths

Use absolute paths. On Windows, forward slashes are accepted by Node and avoid TOML escaping issues.

```powershell
$pmmSource = "E:/xile-workspace/codex-tools/project-memory-manager"
$pmmData = "E:/xile-workspace/codex-tools/project-memory-data"
$project = "E:/xile-workspace/qyProject"
```

For another computer, change these to local paths. Keep `$pmmSource`, `$pmmData`, and `$project` as three different directories.

## 3. Clone And Install

```powershell
New-Item -ItemType Directory -Force -Path (Split-Path $pmmSource), $pmmData
git clone https://github.com/entiwee-ship-it/project-memory-manager.git $pmmSource
Set-Location $pmmSource
npm install
node src/bin/validate-package.js .
```

If the repo already exists:

```powershell
git -C $pmmSource pull --ff-only
Set-Location $pmmSource
npm install
node src/bin/validate-package.js .
```

## 4. Install The Codex Skill

Install the PMM skill so Codex can see `project-memory-manager` in its skill list and load the PMM operating rules.

```powershell
npx skills add https://github.com/entiwee-ship-it/project-memory-manager.git --skill project-memory-manager -g -a codex -y
```

Verify the skill is installed:

```powershell
npx skills ls -g -a codex
```

The skill and the MCP server are related but separate:

- Skill install gives Codex the `SKILL.md` guidance.
- MCP config exposes PMM tools such as `get_current_state`, `build_project_index`, and `query_project_chain`.

Restart Codex after installing or updating a skill. The current session does not hot-reload the skill list.

## 5. Configure Codex MCP

Edit the Codex config file:

```text
~/.codex/config.toml
```

On Windows this is usually:

```text
C:/Users/<User>/.codex/config.toml
```

Add or update this block:

```toml
[mcp_servers.project_memory_manager]
command = "node"
args = ["E:/xile-workspace/codex-tools/project-memory-manager/src/bin/mcp.js"]
startup_timeout_sec = 120

[mcp_servers.project_memory_manager.env]
PMM_DATA_ROOT = "E:/xile-workspace/codex-tools/project-memory-data"
```

If `node` is not available to Codex, use the absolute Node path:

```powershell
where.exe node
```

Then set `command` to that path, for example:

```toml
command = "D:/nodejs/node.exe"
```

Restart Codex after changing the MCP config. MCP tools are loaded at Codex startup.

## 6. First Build

After Codex restarts, use MCP first:

1. `get_current_state`
2. `init_workspace`
3. `detect_topology`
4. `build_project_index` with `dryRun=false`, or `start_build_project_index`
5. `query_project_chain`

CLI fallback:

```powershell
Set-Location $pmmSource
node src/bin/init-workspace.js --workspace-root $project --data-root $pmmData
node src/bin/detect-topology.js --workspace-root $project --data-root $pmmData
node src/bin/build-project.js --workspace-root $project --data-root $pmmData --json
node src/bin/query-project.js --workspace-root $project --data-root $pmmData --type method --name login --limit 5 --json
```

Confirm the target project stayed clean:

```powershell
Test-Path "$project/project-memory"
```

Expected result:

```text
False
```

## 7. Daily Use

Use MCP tools before reading generated JSON files:

- `query_project_chain` for project-global queries.
- `discover_features` when feature boundaries are unclear.
- `build_feature_index` for one feature candidate.
- `query_feature_chain` for focused method/event/request/endpoint chains.

Useful query options:

- `mode=fullstack` for frontend-to-backend HTTP chains.
- `focus=fullstack` to fold same-file helper methods into `relatedHelpers`.
- `focus=data` to add `dataAccessSummary`.
- `mode=fullstack-data` for fullstack traversal plus table read/write summary.
- `grouped=true` for broad keyword searches.

## 8. Upgrade

When this GitHub repo changes:

```powershell
git -C $pmmSource pull --ff-only
Set-Location $pmmSource
npm install
node src/bin/validate-package.js .
```

Update the installed skill too:

```powershell
npx skills update project-memory-manager -g -a codex -y
```

Restart Codex so it reloads both the skill and MCP source. Then rebuild project KBs:

```powershell
node src/bin/rebuild-kbs.js --workspace-root $project --data-root $pmmData
```

If only PMM data changed because a KB was rebuilt, Codex usually does not need a restart. If PMM source code, installed skill content, or MCP config changed, restart Codex.

## 9. Troubleshooting

If `project-memory-manager` does not appear in the skill list:

- Run `npx skills ls -g -a codex`.
- Re-run the `npx skills add ... --skill project-memory-manager ...` command.
- Restart Codex.

If MCP tools do not appear:

- Check the config block name is `[mcp_servers.project_memory_manager]`.
- Check `args` points to `src/bin/mcp.js`.
- Restart Codex.

If MCP fails to start:

- Use an absolute Node path in `command`.
- Run `node src/bin/mcp.js` from `$pmmSource` to catch syntax/runtime errors.
- Run `node src/bin/validate-package.js .`.

If query results look stale:

- Run `get_current_state`.
- Rebuild with `build_project_index` or `node src/bin/rebuild-kbs.js`.

If the target project contains `project-memory/`:

- Stop using legacy layout.
- Use `--data-root <pmm-data-root>` or `PMM_DATA_ROOT`.
- Keep runtime data under the PMM data root, not inside the target project.
