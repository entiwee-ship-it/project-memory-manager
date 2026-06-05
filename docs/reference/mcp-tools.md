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

- `query_project_chain`
- `query_feature_chain`

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
- `source-files-changed`：扫描范围内文件 mtime 或 size 变化。
- `missing-source-snapshot`：旧 KB 没有源码快照。
- `missing-kb-config`：找不到构建配置，无法判断源码变化。

查询结果会附带 `kbFreshness`。如果状态不是 `fresh`，Codex 应先执行返回的 `recommendedAction`。

## 查询参数

查询 selector 包括 `type`、`file`、`name`、`request`、`endpoint`、`method`、`upstream` 和 `downstream`。

Cocos prefab 相关查询：

- `type=prefab-component` 配合 `file=<prefab path>`：按分组查看 prefab 组件挂载。
- `type=script-usage` 配合 `file=<script path>`：反查脚本在哪些 prefab/nodePath 使用。
- `type=prefab-script-usage` 配合 `file=<prefab path>`：批量检查某个 prefab 上所有自定义脚本还被哪里使用。
- `excludeFile=<prefab path>` 或 `excludePrefab=<prefab path>`：从脚本使用结果中排除当前 prefab。

通用查询参数：

- `area`、`module`、`excludeModule`、`protocol`、`path`：把 `login` 这类宽泛词收窄到具体子系统。
- `mode=fullstack` 或 `fullstack=true`：自动展开前端到后端 HTTP 链路。
- `focus=fullstack`：把同文件 helper 方法折叠到 `relatedHelpers`。
- `focus=data`：附加按表分组的 `dataAccessSummary`。
- `mode=fullstack-data`：全栈遍历深度加数据表读写摘要。
- `type=table` 配合 `name=<table>`：直接查表节点。
- `includeUnresolved=true`：显示安全跳过的动态/member call。
- `grouped=true`：宽泛搜索按子系统分组，并返回推荐收窄参数。
- `detail=counts|summary|grouped|full`：控制 Cocos 摘要详细程度。

所有工具都接受 `workspaceRoot`；外置数据布局下多数工具还接受 `dataRoot`。
