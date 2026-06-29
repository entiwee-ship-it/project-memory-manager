---
name: project-memory-manager
description: 当 Codex 需要项目记忆、仓库理解、模块或功能发现、调用链追踪、前后端 HTTP 链路、MCP/CLI KB 查询、事件/消息/状态分析、数据库表影响、Cocos prefab/script 使用关系或跨会话上下文时，先使用 PMM。优先调用 MCP 工具，PMM 运行数据必须放在目标项目外部。只有简单命令、已知文件小改动或上下文已经足够时才跳过。
---

# 项目记忆管理器

## 使用判断

PMM 用来让 Codex 在动源码前先理解项目。只要任务需要项目结构、模块边界、功能入口、跨文件调用链、HTTP 前后端链路、Next.js App Router endpoint、Prisma 数据访问、外部服务依赖、消息/事件/状态流、数据库表影响、Cocos prefab/script 绑定或跨会话上下文，就先用 PMM。

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
5. `query_project_chain` / `query_feature_chain`：日常查询默认使用 `freshnessPolicy=auto_rebuild`，工具会在 KB 过期、缺失或未知时同步重建并等待 `fresh` 后再返回结果。
6. `build_project_index` / `build_feature_index`：只在需要手动维护、预热或排查构建问题时直接调用。手动预热 project-global 时优先用 `start_build_project_index` 并传 `wait:true`。
7. `discover_features` + `build_feature_index`：需要功能级链路、入口拆分或多模块边界时生成功能 KB。

CLI 只作为兜底或维护入口。MCP 不可用时再使用 `src/bin/*.js` 命令。

如果使用 `start_build_project_index`，推荐传 `wait:true` 和合适的 `timeoutMs`，让工具一次完成启动、等待和 freshness 返回。不等待时必须轮询 `get_job_status` 到 `succeeded`，再查询。不能启动异步构建后直接用旧 KB 或直接回源码大范围搜索。

## stale 门禁

`stale`、`missing`、`unknown` 都不是“PMM 结果不足”，而是查询门禁未通过。遇到这些状态时，禁止直接改用源码追链路，必须先执行以下动作之一：

- 直接调用 `query_project_chain` / `query_feature_chain`，保持默认 `freshnessPolicy=auto_rebuild`，让 MCP 自动重建并等待 fresh。
- 手动预热时调用 `start_build_project_index` 并传 `wait:true`，等返回 `projectGlobalFreshness.status=fresh` 后再查询。
- feature KB 缺失时先 `discover_features`，再 `build_feature_index`，或退回 project-global 查询并等待 fresh。

只有出现 MCP 工具不可用、重建失败、等待超时且用户明确要求继续排查时，才允许临时回源码确认；这种情况下必须先说明 PMM 没有通过门禁。

## 常用查询配方

- 看项目整体：`query_project_chain`，不带 selector 或只带 `detail=summary`。
- 找入口或消歧义：用 `type`、`name`、`module`、`area`、`path`、`grouped` 收窄。
- 追方法/接口链路：`method`、`request`、`endpoint` 搭配 `upstream` / `downstream`。
- 查协议/事件消息：`message` 只表示项目里的协议消息名或事件消息名，不是自然语言问题入口。
- 处理中文业务问题：先从问题里提取 `endpoint`、`request`、`method` 或关键词，再用对应 selector；不要把整句自然语言传给 `message`。
- 看前后端完整链路：`mode=fullstack` 或 `focus=fullstack`。
- 看数据库表影响：`focus=data` 或 `mode=fullstack-data`，重点读 `dataAccessSummary`。
- 查 Next.js API route：`endpoint="GET /api/chat"` 搭配 `downstream` / `mode=fullstack-data`。
- 查 Prisma model/table：`type=table --name <model>`。
- 查外部服务：`type=external-service --name facebook`、`type=external-service --name anthropic`。
- 查 Cocos prefab 组件：`type=prefab-component --file <prefab>`。
- 查 Cocos 脚本使用方：`type=script-usage --file <script>`。
- 查 prefab 上所有脚本绑定：`type=prefab-script-usage --file <prefab>`。

## 结果使用规则

- 先向用户说明 PMM 查到的证据范围，例如 KB 是否存在、`kbFreshness.status`、命中了哪些入口。
- 默认查询应让 MCP 自动等待 fresh。返回 `_mcpFreshness.rebuilt=true` 表示本次查询已经重建并等待完成。
- 如果 freshness 返回 `sourceFallbackAllowed=false` 或 `mustRefreshBeforeSourceFallback=true`，不能直接读源码替代 PMM。
- `check_kb_freshness` 返回 `changeCounts.mtimeOnly` 时，说明存在只改 mtime 的文件；若 KB 仍是 `fresh`，通常是生成文件内容哈希未变，不需要重建。
- `kbFreshness.status` 不是 `fresh` 且没有使用 `freshnessPolicy=allow_stale` 时，不要相信结果，也不要绕回源码做大范围搜索。
- 只有排查 PMM 自身问题、对比旧 KB 或用户明确要求时，才允许传 `freshnessPolicy=allow_stale`。
- PMM 返回歧义候选时，优先用推荐的 selector 再查一次，不要直接猜。
- PMM 结果不足时，必须先确认 `kbFreshness.status=fresh`，再读项目文档和源码，用 `rg` 精确确认。
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

## 生成文件规则

目标项目的外置 `project-profile.json` 可以声明：

```json
{
  "snapshotIgnore": ["**/.vite/**", "cms-server/src/generated/**"],
  "generatedFiles": ["cms-server/src/config/built-env.ts"]
}
```

`snapshotIgnore` 不参与 freshness 指纹；`generatedFiles` 参与扫描，但用内容哈希判断，内容未变时只记录 mtime-only，不触发 stale。

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
- 发现过期 KB 时让 MCP 查询工具自动重建并等待 fresh，再相信查询结果。
