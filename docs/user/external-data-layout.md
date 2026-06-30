# 外置数据布局

PMM 固定拆分为三类目录：

- 源码仓库：`project-memory-manager`
- 目标项目：Codex 正在开发的业务项目
- 数据根目录：PMM 生成的运行数据

外置数据布局会写入：

```text
<data-root>/workspaces/<workspace-id>/
```

从 v0.71 起，一个 `<data-root>` 可以明确承载多个项目。PMM 会额外维护：

```text
<data-root>/workspace-registry.json
<data-root>/workspaces/<workspace-id>/workspace-manifest.json
```

`workspaceId` 继续保持旧版本路径映射，保证已有记忆目录不搬迁；`workspaceHash` 用项目绝对路径生成短哈希，用于登记、解析和碰撞诊断。AI 或维护人员需要确认数据根状态时，优先使用：

```powershell
node src/bin/register-workspace.js --workspace-root <project-root> --data-root <data-root> --json
node src/bin/list-workspaces.js --data-root <data-root> --json
node src/bin/resolve-workspace.js --data-root <data-root> --workspace-root <project-root> --json
node src/bin/diagnose-data-root.js --data-root <data-root> --json
```

如果省略 `--data-root`，PMM 会读取 `PMM_DATA_ROOT`。如果也没有配置 `PMM_DATA_ROOT`，PMM 会使用源码仓库同级的 `project-memory-data` 目录。

命令示例：

```powershell
node src/bin/build-project.js --workspace-root <project-root> --data-root <data-root> --layout external-data
```

推荐的 Codex MCP 环境变量：

```toml
[mcp_servers.project_memory_manager.env]
PMM_DATA_ROOT = "E:/xile-workspace/codex-tools/project-memory-data"
```

不要把 `<data-root>` 设置到 `<project-root>` 里面。不要把 PMM 运行 KB 文件加入目标项目。测试 fixture 目录里可能仍有 `project-memory`，那只是为了覆盖旧布局兼容场景。
