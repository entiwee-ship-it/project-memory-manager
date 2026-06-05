# 快速开始

新电脑或新的 Codex 环境，先完整执行：

```text
docs/user/install-from-github.md
```

PMM 默认应使用外置数据根目录。目标项目不应该出现 PMM 运行文件。

先安装 Codex skill，让技能列表里能看到 `project-memory-manager`：

```powershell
npx skills add https://github.com/entiwee-ship-it/project-memory-manager.git --skill project-memory-manager -g -a codex -y --full-depth
```

```powershell
$project = "E:/xile-workspace/qyProject"
$data = "E:/xile-workspace/codex-tools/project-memory-data"

node src/bin/init-workspace.js --workspace-root $project --data-root $data
node src/bin/detect-topology.js --workspace-root $project --data-root $data
node src/bin/build-project.js --workspace-root $project --data-root $data --json
node src/bin/discover-features.js --workspace-root $project --data-root $data --json
```

选择功能候选后，再构建对应功能 KB：

```powershell
node src/bin/build-feature.js --workspace-root $project --data-root $data --feature-key qyproject-admin --json
```

查询时优先使用 MCP。只有 MCP 服务不可用时才使用 CLI。
