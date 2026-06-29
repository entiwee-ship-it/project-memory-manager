# MCP 工具

工作区生命周期：

- `inspect_workspace`
- `get_current_state`
- `init_workspace`
- `detect_topology`
- `diagnose_workspace`
- `check_kb_freshness`

构建：

- `build_project_index`
- `start_build_project_index`
- `get_job_status`
- `get_job_result`
- `discover_features`
- `build_feature_index`

查询：

- `prepare_task_context`
- `explain_feature_for_agent`
- `analyze_change_impact`
- `query_project_chain`
- `query_feature_chain`

## Agent Context Pack

AI 接到开发任务时，优先使用 Agent Context Pack 工具获取短、准、可行动的上下文，再决定是否继续用 selector 追链路。

### `prepare_task_context`

输入自然语言任务，自动匹配相关 feature、endpoint、request、method、Prisma model 和 external-service。

```json
{
  "workspaceRoot": "E:/xile-workspace/next-app",
  "dataRoot": "E:/xile-workspace/codex-tools/project-memory-data",
  "task": "修改 settings 页 AI 配置保存逻辑"
}
```

返回内容包括任务理解、相关 feature、关键入口、关键文件、调用链摘要、数据表影响、外部服务、建议编辑边界、推荐验证命令、不确定点和 `evidence`。

### `explain_feature_for_agent`

输入 feature key，返回面向 AI 的功能记忆卡片。

```json
{
  "workspaceRoot": "E:/xile-workspace/next-app",
  "dataRoot": "E:/xile-workspace/codex-tools/project-memory-data",
  "featureKey": "facebook-oauth"
}
```

返回内容包括功能职责、页面入口、API endpoints、核心方法、Prisma models、external services、主要数据流、修改风险点和推荐测试方式。

### `analyze_change_impact`

输入 changed files 或 git diff，返回影响范围、风险等级、重点复核链路、推荐测试命令，以及是否需要重建 project / feature KB。

```json
{
  "workspaceRoot": "E:/xile-workspace/next-app",
  "dataRoot": "E:/xile-workspace/codex-tools/project-memory-data",
  "changedFiles": [
    "app/settings/page.tsx",
    "app/api/chat/route.ts"
  ]
}
```

三个工具都会返回 `_mcpFreshness`，并遵守 `freshnessPolicy=auto_rebuild|require_fresh|allow_stale`。证据字段会尽量提供 `file`、`method`、`endpoint`、`nodeId` / `edgeType` 和 `confidence`，用于 AI 计划、编辑边界和 review 依据。

## 新鲜度判断

`get_current_state` 会返回 `projectGlobalFreshness`，用于判断 project-global KB 是否可直接信任。

`check_kb_freshness` 用于显式检查 KB 状态：

- `status=fresh`：KB 与当前 PMM 版本、当前扫描源码一致，可以查询。
- `status=stale`：PMM 版本或目标源码发生变化，需要先重建再信任结果。
- `status=missing`：KB 尚未构建。
- `status=unknown`：旧 KB 没有源码快照或配置缺失，需要重建一次生成快照。

常见 `reasonCodes`：

- `pmm-version-changed`：PMM 版本变化。
- `source-files-added`：扫描范围内新增源码文件。
- `source-files-deleted`：扫描范围内删除源码文件。
- `source-files-changed`：扫描范围内文件内容、size 或普通文件 mtime 变化。
- `missing-source-snapshot`：旧 KB 没有源码快照。
- `missing-kb-config`：找不到构建配置，无法判断源码变化。

freshness 结果会包含门禁字段：

- `querySafe`：是否可以直接使用当前 KB 查询。
- `sourceFallbackAllowed`：是否允许在 PMM 之后回源码精确确认。
- `mustRefreshBeforeQuery`：查询前是否必须刷新。
- `mustRefreshBeforeSourceFallback`：读源码兜底前是否必须刷新。
- `usageGate.instruction`：给 Codex 的执行指令。

当 `sourceFallbackAllowed=false` 时，不能把“旧 KB 不可信”当成跳过 PMM 的理由；应先自动重建或 `start_build_project_index(wait:true)` 等到 fresh。

`changeCounts.mtimeOnly` 表示文件 size 不变但 mtime 变化。对 `generatedFiles`，PMM 会优先比较内容哈希；内容不变时 KB 仍是 `fresh`，同时返回 `mtimeOnlyFiles` 作为诊断信息。

查询结果会附带 `kbFreshness` 和 `_mcpFreshness`。默认情况下，`query_project_chain` 和 `query_feature_chain` 使用 `freshnessPolicy=auto_rebuild`：

- 查询前发现 KB 不是 `fresh` 时，MCP 会同步重建。
- 重建完成后再次检查新鲜度。
- 只有最终状态为 `fresh` 时才返回查询结果。
- 重建失败或最终仍不是 `fresh` 时，MCP 返回 `ok=false`，不会返回旧 KB 结果。

`_mcpFreshness` 会记录 `initialStatus`、`finalStatus`、`rebuilt` 和 `rebuildOutput`，用于确认 Codex 是否真的等待了重建完成。

`freshnessPolicy` 可选值：

- `auto_rebuild`：默认值，自动重建并等待 fresh。
- `require_fresh`：KB 不是 fresh 时直接阻止查询，不自动重建。
- `allow_stale`：允许查询旧 KB，只用于调试或对比，不应作为日常开发默认。

## 查询参数

查询 selector 包括 `type`、`file`、`name`、`request`、`endpoint`、`method`、`message`、`upstream` 和 `downstream`。

Next.js App Router 项目可直接用 `endpoint="GET /api/chat"` 查询 `app/api/**/route.ts` 生成的 endpoint；搭配 `downstream=true` 和 `mode=fullstack-data` 时，会继续展开到前端 API client、route handler、Prisma model 和外部服务依赖。

`message` 是协议/事件消息名 selector，不是自然语言问题入口。遇到“购买成功后到底触发了哪条刷新”这类中文业务问题时，先提取 `endpoint`、`request`、`method` 或关键词，再改用对应 selector 查询；不要把整句问题传给 `message`。

Cocos prefab 相关查询：

- `type=prefab-component` 配合 `file=<prefab path>`：按分组查看 prefab 组件挂载。
- `type=script-usage` 配合 `file=<script path>`：反查脚本在哪些 prefab/nodePath 使用。
- `type=prefab-script-usage` 配合 `file=<prefab path>`：批量检查某个 prefab 上所有自定义脚本还被哪里使用。
- `excludeFile=<prefab path>` 或 `excludePrefab=<prefab path>`：从脚本使用结果中排除当前 prefab。

通用查询参数：

- `area`、`module`、`excludeModule`、`protocol`、`path`：把 `login` 这类宽泛词收窄到具体子系统。
- `freshnessPolicy=auto_rebuild|require_fresh|allow_stale`：控制查询前是否自动等待 KB 变为 fresh。
- `mode=fullstack` 或 `fullstack=true`：自动展开前端到后端 HTTP 链路。
- `focus=fullstack`：把同文件 helper 方法折叠到 `relatedHelpers`。
- `focus=data`：附加按表分组的 `dataAccessSummary`。
- `mode=fullstack-data`：全栈遍历深度加数据表读写摘要。
- `type=table` 配合 `name=<table>`：直接查表节点。
- `type=external-service` 配合 `name=<service>`：直接查 Anthropic Claude、Facebook Graph API、Prisma ORM、Next.js Runtime 等外部依赖节点。
- `includeUnresolved=true`：显示安全跳过的动态/member call。
- `grouped=true`：宽泛搜索按子系统分组，并返回推荐收窄参数。
- `detail=counts|summary|grouped|full`：控制 Cocos 摘要详细程度。

所有工具都接受 `workspaceRoot`；外置数据布局下多数工具还接受 `dataRoot`。

## 构建参数

`start_build_project_index` 支持两种用法：

- 不传 `wait`：立即返回 queued job，需要继续调用 `get_job_status`，直到 `status=succeeded` 或 `status=failed`。
- 传 `wait=true`：MCP 内部等待构建完成，并在返回值中附带 `projectGlobalFreshness`。

示例：

```json
{
  "workspaceRoot": "E:/xile-workspace/qyProject",
  "dataRoot": "E:/xile-workspace/codex-tools/project-memory-data",
  "wait": true,
  "timeoutMs": 120000
}
```

`timeoutMs` 默认 120000，最大 600000。等待超时时返回 `timedOut=true`，job 会继续在后台运行，可以继续用 `get_job_status` 查询。

`queued` / `running` 阶段的 `exitCode` 为 `null`；只有 `succeeded`、`failed` 或 `cancelled` 这类终态才返回最终 exit code。

## 快照规则

project-global 构建配置支持：

- `snapshotIgnore`：这些文件不参与 freshness 快照。
- `generatedFiles`：这些文件参与扫描，但用内容哈希判断是否变化。

配置通常写在外置 `project-profile.json`，`build_project_index` 会透传到 `configs/project-global.json`：

```json
{
  "snapshotIgnore": [
    "cms-server/src/generated/**",
    "**/.vite/**"
  ],
  "generatedFiles": [
    "cms-server/src/config/built-env.ts"
  ]
}
```
