---
name: project-memory-manager
description: External project memory manager for Codex. Use MCP first to initialize, build, discover, and query repository KBs stored outside the target project.
---

# 项目记忆管理器

## 什么时候使用

当 Codex 需要理解一个现有项目的结构、跨文件调用链、HTTP 请求、Pinus 消息、Vue/Express 全栈链路、后端数据表读写、Cocos prefab 绑定、状态读写或项目协议时，使用 PMM。PMM 的记忆文件必须放在外置 data root，不能写入目标业务项目。

## 默认工作流

1. 先通过 MCP `get_current_state` 查看目标项目是否已有 PMM data root。
2. 没有状态时，使用 MCP `init_workspace` 和 `detect_topology` 初始化外置记忆。
3. 需要全局理解时，使用 `build_project_index` 或 `start_build_project_index`。
4. 需要 feature 级链路时，先 `discover_features`，再 `build_feature_index`。
5. 查询时优先 MCP，只有 MCP 不可用时才使用 CLI。

## MCP 优先规则

MCP 可用时不要优先读生成的 JSON 文件。先调用：

- `query_project_chain`: 项目全局 summary、message、state、timing、phase、transition。
- `query_feature_chain`: 单 feature 的 method、event、request、endpoint、state、upstream、downstream。
- `get_current_state`: 检查 KB 是否存在、是否 stale。

## 查询顺序

1. 项目范围不清楚时，先用 `query_project_chain`。
2. 已知 feature 时，用 `query_feature_chain`。
3. 只知道关键词时，先查 `type/name/request/message/state`，再决定是否读源码。
4. 需要回答“这个接口/方法会动哪些表”时，用 `focus=data` 或 `mode=fullstack-data` 看 `dataAccessSummary`。
5. KB 结果不足时，读 `docs/` 和 `references/`。
6. 最后才用 `rg` 回源码确认细节。

## 构建和刷新 KB

MCP 不可用时使用 CLI：

```powershell
node src/bin/init-workspace.js --workspace-root <project-root> --data-root <pmm-data-root>
node src/bin/detect-topology.js --workspace-root <project-root> --data-root <pmm-data-root>
node src/bin/build-project.js --workspace-root <project-root> --data-root <pmm-data-root>
node src/bin/discover-features.js --workspace-root <project-root> --data-root <pmm-data-root>
node src/bin/build-feature.js --workspace-root <project-root> --data-root <pmm-data-root> --feature-key <key>
node src/bin/rebuild-kbs.js --workspace-root <project-root> --data-root <pmm-data-root>
```

## 升级后处理

PMM 升级后先重启 Codex，让 MCP 重新加载。之后对目标项目执行：

```powershell
node src/bin/rebuild-kbs.js --workspace-root <project-root> --data-root <pmm-data-root>
```

如果 MCP 配置仍指向旧路径，改成：

```text
E:/xile-workspace/codex-tools/project-memory-manager/src/bin/mcp.js
```

## 必读文档索引

- `docs/user/quick-start.md`
- `docs/user/mcp-first.md`
- `docs/user/external-data-layout.md`
- `docs/reference/cli.md`
- `docs/reference/mcp-tools.md`
- `docs/developer/source-layout.md`
- `docs/developer/testing.md`
- `docs/guides/troubleshooting.md`

## 核心规则

- 记忆文件是记忆文件，业务项目是业务项目，PMM 源码是 PMM 源码。
- 不创建或恢复 `scripts/` 旧入口。
- 不把 PMM runtime 文件写进目标项目，除非用户明确要求 legacy 布局。
- 查询优先 MCP，构建优先 MCP，CLI 是 fallback 和维护入口。
- 发现 stale KB 时先重建，再相信查询结果。
