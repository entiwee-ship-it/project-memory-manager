---
name: project-memory-manager
description: 当 Codex 需要项目记忆、仓库理解、模块或功能发现、调用链追踪、前后端 HTTP 链路、MCP/CLI KB 查询、事件/消息/状态分析、数据库表影响、Cocos prefab/script 使用关系或跨会话上下文时，先使用 PMM。优先调用 MCP 工具，PMM 运行数据必须放在目标项目外部。只有简单命令、已知文件小改动或上下文已经足够时才跳过。
---

# 项目记忆管理器

## 使用判断

PMM 用来让 Codex 在动源码前先理解项目。只要任务需要项目结构、模块边界、功能入口、跨文件调用链、HTTP 前后端链路、消息/事件/状态流、数据库表影响、Cocos prefab/script 绑定或跨会话上下文，就先用 PMM。

可以跳过 PMM 的情况只有三类：

- 用户已经给出精确文件和很小的改动范围。
- 只是运行简单命令、看 git 状态、查时间、改纯格式。
- 当前上下文已经足够，不需要跨文件或跨模块理解。

## MCP 优先流程

MCP 可用时，不要先读生成的 JSON 文件，也不要直接大范围 `rg`。按这个顺序走：

1. `get_current_state`：确认目标项目是否已有外置 PMM 数据根目录、project-global KB、功能注册表和 `projectGlobalFreshness`。
2. `check_kb_freshness`：查询前确认 KB 是 `fresh`、`stale`、`missing` 还是 `unknown`。
3. `diagnose_workspace`：状态缺失、路径不确定或 KB 疑似过期时先诊断。
4. `init_workspace` + `detect_topology`：新项目或新电脑首次接入时初始化外置记忆。
5. `build_project_index` 或 `start_build_project_index`：需要全局理解、项目刚更新或 KB 过期时重建 project-global。
6. `discover_features` + `build_feature_index`：需要功能级链路、入口拆分或多模块边界时生成功能 KB。
7. `query_project_chain` / `query_feature_chain`：只在 KB 状态为 `fresh` 后查询证据，再决定是否回源码精读。

CLI 只作为兜底或维护入口。MCP 不可用时再使用 `src/bin/*.js` 命令。

## 常用查询配方

- 看项目整体：`query_project_chain`，不带 selector 或只带 `detail=summary`。
- 找入口或消歧义：用 `type`、`name`、`module`、`area`、`path`、`grouped` 收窄。
- 追方法/接口链路：`method`、`request`、`endpoint` 搭配 `upstream` / `downstream`。
- 看前后端完整链路：`mode=fullstack` 或 `focus=fullstack`。
- 看数据库表影响：`focus=data` 或 `mode=fullstack-data`，重点读 `dataAccessSummary`。
- 查 Cocos prefab 组件：`type=prefab-component --file <prefab>`。
- 查 Cocos 脚本使用方：`type=script-usage --file <script>`。
- 查 prefab 上所有脚本绑定：`type=prefab-script-usage --file <prefab>`。

## 结果使用规则

- 先向用户说明 PMM 查到的证据范围，例如 KB 是否存在、`kbFreshness.status`、命中了哪些入口。
- `kbFreshness.status` 不是 `fresh` 时，先按 `recommendedAction` 重建再相信结果。
- PMM 返回歧义候选时，优先用推荐的 selector 再查一次，不要直接猜。
- PMM 结果不足时，再读项目文档和源码，用 `rg` 精确确认。
- 回答链路问题时，把 PMM 证据和源码确认结果分开说清楚。

## CLI 兜底

```powershell
node src/bin/init-workspace.js --workspace-root <project-root> --data-root <pmm-data-root>
node src/bin/detect-topology.js --workspace-root <project-root> --data-root <pmm-data-root>
node src/bin/build-project.js --workspace-root <project-root> --data-root <pmm-data-root>
node src/bin/discover-features.js --workspace-root <project-root> --data-root <pmm-data-root>
node src/bin/build-feature.js --workspace-root <project-root> --data-root <pmm-data-root> --feature-key <key>
node src/bin/rebuild-kbs.js --workspace-root <project-root> --data-root <pmm-data-root>
```

## 升级与安装

新电脑或新 Codex 环境部署时，先读 `docs/user/install-from-github.md`。PMM 升级后先重启 Codex，让 MCP 和技能列表重新加载。之后对目标项目执行：

```powershell
node src/bin/rebuild-kbs.js --workspace-root <project-root> --data-root <pmm-data-root>
```

如果 MCP 配置仍指向旧路径，改成：

```text
E:/xile-workspace/codex-tools/project-memory-manager/src/bin/mcp.js
```

## 必读文档索引

- `docs/user/quick-start.md`
- `docs/user/install-from-github.md`
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
- 不把 PMM 运行文件写进目标项目，除非用户明确要求旧布局。
- 查询优先 MCP，构建优先 MCP，CLI 是兜底和维护入口。
- 发现过期 KB 时先重建，再相信查询结果。
