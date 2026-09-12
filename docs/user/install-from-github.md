# 从 GitHub 安装 PMM

新电脑或新的 Codex 环境接入 PMM 时，按这份流程执行。

PMM 固定使用三套目录：

- PMM 源码仓库：从 GitHub clone 下来的工具源码。
- PMM 数据根目录：PMM 生成的 KB 和运行数据。
- 目标项目：Codex 要开发的业务仓库。

不要把 PMM 数据根目录放进目标项目。

## 1. 准备环境

先确认这些工具已经安装：

- Git
- Node.js 18 或更新版本
- npm
- 支持 MCP 的 Codex

检查命令：

```powershell
git --version
node --version
npm --version
```

## 2. 选择目录

统一使用绝对路径。Windows 上建议在配置里使用 `/`，Node 能识别，也能减少 TOML 转义问题。

```powershell
$pmmSource = "E:/xile-workspace/GitHub/project-memory-manager"
$pmmData = "E:/xile-workspace/codex-tools/project-memory-data"
$project = "E:/xile-workspace/qyProject"
```

换到其它电脑时，把这三个变量改成本机路径即可。`$pmmSource`、`$pmmData`、`$project` 必须是三个不同目录。

## 3. 拉取源码并安装依赖

```powershell
New-Item -ItemType Directory -Force -Path (Split-Path $pmmSource), $pmmData
git clone https://github.com/entiwee-ship-it/project-memory-manager.git $pmmSource
Set-Location $pmmSource
npm install
node src/bin/validate-package.js .
```

如果仓库已经存在：

```powershell
git -C $pmmSource pull --ff-only
Set-Location $pmmSource
npm install
node src/bin/validate-package.js .
```

## 4. 安装 Codex skill

安装 PMM skill 后，Codex 技能列表里才会出现 `project-memory-manager`，并加载 PMM 的使用规则。

```powershell
npx skills add https://github.com/entiwee-ship-it/project-memory-manager.git --skill project-memory-manager -g -a codex -y --full-depth
```

验证 skill 是否安装成功：

```powershell
npx skills ls -g -a codex
```

skill 和 MCP 服务是两件事：

- 安装 skill：让 Codex 看到 `SKILL.md` 里的使用规则。
- 配置 MCP：把 `get_current_state`、`build_project_index`、`query_project_chain` 等 PMM 工具暴露给 Codex。

安装或更新 skill 后要重启 Codex。当前会话不会热加载技能列表。

## 5. 配置 Codex MCP

编辑 Codex 配置文件：

```text
~/.codex/config.toml
```

Windows 上通常是：

```text
C:/Users/<User>/.codex/config.toml
```

新增或更新这段配置：

```toml
[mcp_servers.project_memory_manager]
command = "node"
args = ["E:/xile-workspace/GitHub/project-memory-manager/src/bin/mcp.js"]
startup_timeout_sec = 120

[mcp_servers.project_memory_manager.env]
PMM_DATA_ROOT = "E:/xile-workspace/codex-tools/project-memory-data"
```

如果 Codex 启动 MCP 时找不到 `node`，改用 Node 的绝对路径：

```powershell
where.exe node
```

然后把 `command` 改成这个路径，例如：

```toml
command = "D:/nodejs/node.exe"
```

修改 MCP 配置后要重启 Codex。MCP 工具只在 Codex 启动时加载。

## 6. 首次构建

Codex 重启后优先使用 MCP：

1. `get_current_state`
2. `init_workspace`
3. `detect_topology`
4. `build_project_index` with `dryRun=false`, or `start_build_project_index`
5. `query_project_chain`

CLI 兜底命令：

```powershell
Set-Location $pmmSource
node src/bin/init-workspace.js --workspace-root $project --data-root $pmmData
node src/bin/detect-topology.js --workspace-root $project --data-root $pmmData
node src/bin/build-project.js --workspace-root $project --data-root $pmmData --json
node src/bin/query-project.js --workspace-root $project --data-root $pmmData --type method --name login --limit 5 --json
```

确认目标项目没有被写入 PMM 运行目录：

```powershell
Test-Path "$project/project-memory"
```

期望结果：

```text
False
```

## 7. 日常使用

先用 MCP 工具，不要优先读取生成的 JSON 文件：

- `query_project_chain`：查询 project-global。
- `discover_features`：功能边界不清楚时发现候选。
- `build_feature_index`：为某个功能候选构建 KB。
- `query_feature_chain`：查询 method、event、request、endpoint 等聚焦链路。

常用查询参数：

- `mode=fullstack`：查询前端到后端的 HTTP 链路。
- `focus=fullstack`：把同文件 helper 方法折叠到 `relatedHelpers`。
- `focus=data`：附加 `dataAccessSummary`。
- `mode=fullstack-data`：全栈链路加数据表读写摘要。
- `grouped=true`：宽泛关键词查询时分组展示候选。

## 8. 升级

GitHub 仓库更新后：

```powershell
git -C $pmmSource pull --ff-only
Set-Location $pmmSource
npm install
node src/bin/validate-package.js .
```

同时更新已安装的 skill：

```powershell
npx skills remove project-memory-manager -g -a codex -y
npx skills add https://github.com/entiwee-ship-it/project-memory-manager.git --skill project-memory-manager -g -a codex -y --full-depth
```

不要依赖 `skills update` 更新这个 GitHub root skill，它可能命中缓存元数据。用 remove + add 可以强制重新 clone。然后重启 Codex，让 skill 和 MCP 源码都重新加载。之后重建目标项目 KB：

```powershell
node src/bin/rebuild-kbs.js --workspace-root $project --data-root $pmmData
```

如果只是重建 KB 导致 PMM 数据根目录内容变化，通常不需要重启 Codex。如果 PMM 源码、已安装 skill 内容或 MCP 配置变化，就需要重启 Codex。

## 8.1 多 Agent 副本拓扑

使用多个 AI 编码助手（Codex、Claude、Kimi 等）时，PMM skill 需要安装到每个助手的 skill 目录。安装形态分两种：

**完整安装**（含 `src/`、`tests/`、`SKILL.md`、`skill-version.json` 等，约 320 个文件）：

| 位置 | 说明 |
| --- | --- |
| `~/.agents/skills/project-memory-manager` | `skills` CLI 的**权威源**，`sourceType: github` |
| `~/.codex/skills/project-memory-manager` | 由权威源分发 |
| `~/.cc-switch/skills/project-memory-manager` | 由权威源分发；`~/.claude/skills/project-memory-manager` 是指向它的**符号链接** |

**精简安装**（仅 `SKILL.md` + `skill-version.json`，2 个文件）：

| 位置 | 说明 |
| --- | --- |
| `~/.kimi/skills/project-memory-manager` | Kimi 客户端 |
| `~/.kimi-code/skills/project-memory-manager` | Kimi Code 客户端 |

更新精简副本时只复制 `SKILL.md` 和 `skill-version.json` 两个文件，**不要**用整仓克隆覆盖，否则会改变其安装形态。

### 手工同步全部副本

当 PMM 源码仓库更新后，用以下脚本把改动分发到全部副本（在源码仓库根目录执行）：

```bash
SRC="$HOME/.agents/skills/project-memory-manager"

# 1. 更新权威源（完整形态）
cp src/shared/lock.js "$SRC/src/shared/lock.js"
cp tests/lock-diagnostics.test.js "$SRC/tests/lock-diagnostics.test.js"
cp tests/rebuild-lock.test.js "$SRC/tests/rebuild-lock.test.js"
cp CHANGELOG.md "$SRC/CHANGELOG.md"
cp skill-version.json "$SRC/skill-version.json"

# 2. 同步完整副本
for dir in "$HOME/.codex/skills/project-memory-manager" "$HOME/.cc-switch/skills/project-memory-manager"; do
  for f in src/shared/lock.js tests/lock-diagnostics.test.js tests/rebuild-lock.test.js CHANGELOG.md skill-version.json; do
    cp "$f" "$dir/$f"
  done
done

# 3. 同步精简副本（仅两个文件）
for dir in "$HOME/.kimi/skills/project-memory-manager" "$HOME/.kimi-code/skills/project-memory-manager"; do
  cp SKILL.md "$dir/SKILL.md"
  cp skill-version.json "$dir/skill-version.json"
done
```

上面的文件列表是示例——按实际改动的文件调整 `for f in ...` 里的路径。如果只改了 `SKILL.md`，完整副本和精简副本都只需要复制它。

## 8.2 `skills` CLI 已知行为

`npx skills update` 有三个已知行为，可能导致副本静默漂移：

**1. 报失败但部分成功**

`npx skills update project-memory-manager -g -y` 耗时约 5 分钟后可能报 `Failed to update`，但实际部分副本已更新——权威源（`~/.agents`）和 `.codex` 通常会成功，`.cc-switch` 可能没跟上，`~/.agents/.skill-lock.json` 的 `skillFolderHash` 和 `updatedAt` 也不会刷新。

> 判断是否更新成功**必须逐个核对 `skill-version.json` 的版本号**，不能只看 CLI 的退出信息。

**2. 合并式更新**

CLI 执行的是合并式更新——**不会删除上游已移除的文件**。如果旧版本曾携带过临时目录（如 `.tmp-review-pinus/`），更新后这些目录会残留在所有副本中，需要手工清理。

**3. 子集安装**

安装副本是 git 仓库的子集（约 339 个文件 vs 仓库 1228 个），CLI 会刻意排除 `.git/`、`node_modules/` 等目录。**不要用整仓 `git clone` 覆盖安装目录**，否则会装进 CLI 刻意排除的文件。

基于以上三个行为，升级时推荐用 **8.1 节的手工同步** 而非 `skills update`，或至少在 `skills update` 后按 8.1 节的方法逐个核对版本号并补齐遗漏的副本。

## 9. 故障排查

如果技能列表里看不到 `project-memory-manager`：

- 执行 `npx skills ls -g -a codex`。
- 重新执行 `npx skills add ... --skill project-memory-manager ... --full-depth`。
- 重启 Codex。

如果 `skills update` 后副本版本不一致（参见 8.2 节）：

- 逐个检查 `~/.agents`、`~/.codex`、`~/.cc-switch`、`~/.kimi`、`~/.kimi-code` 下的 `skill-version.json`。
- 用 8.1 节的手工同步补齐遗漏的副本。
- 检查是否有上游已删除的残留目录（如 `.tmp-review-pinus/`），手工清理。

如果 MCP 工具没有出现：

- 检查配置块名是否是 `[mcp_servers.project_memory_manager]`。
- 检查 `args` 是否指向 `src/bin/mcp.js`。
- 重启 Codex。

如果 MCP 启动失败：

- 在 `command` 里使用 Node 绝对路径。
- 在 `$pmmSource` 下执行 `node src/bin/mcp.js`，看语法或运行时错误。
- 执行 `node src/bin/validate-package.js .`。

如果查询结果看起来过期：

- 先执行 `get_current_state`。
- 使用 `build_project_index` 或 `node src/bin/rebuild-kbs.js` 重建。

如果目标项目里出现了 `project-memory/`：

- 停止使用旧布局。
- 使用 `--data-root <pmm-data-root>` 或 `PMM_DATA_ROOT`。
- 运行数据只放 PMM 数据根目录，不放目标项目。
