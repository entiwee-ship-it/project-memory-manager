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
$pmmSource = "E:/xile-workspace/codex-tools/project-memory-manager"
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
args = ["E:/xile-workspace/codex-tools/project-memory-manager/src/bin/mcp.js"]
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

## 9. 故障排查

如果技能列表里看不到 `project-memory-manager`：

- 执行 `npx skills ls -g -a codex`。
- 重新执行 `npx skills add ... --skill project-memory-manager ... --full-depth`。
- 重启 Codex。

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
