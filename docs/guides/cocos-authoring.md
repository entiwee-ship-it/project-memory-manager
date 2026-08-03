# Cocos Authoring

PMM 负责实时只读解析、历史召回和安全门禁；Cocos Creator Bridge/MCP 是 `.prefab`、`.scene`、`.meta` 的唯一写入权威。任何 PMM 命令或脚本都不得直接修改 Creator 序列化 JSON。

## 推荐流程

1. 以包含目标 `assets/` 的 Creator 工程根作为 `workspaceRoot`，调用 `prepare_cocos_edit_brief`。不要传多项目上级目录。
2. 检查 `readiness`、`queryViewStatus` 和 `baseKb.mappingReadiness`：
   - `blocked`、`base_untrusted` 或 `overlay_unsafe`：先重建 project-global KB。
   - `creator_resolution_required`：目标包含未知/变化中的脚本映射或未展开的嵌套 Prefab，必须在 Creator 现场解析节点与组件身份。
3. 按 brief 中的 `creatorWorkflow.steps` 使用 Cocos MCP 打开 Prefab、读取 hierarchy/node 当前值，再执行写入。
4. 每项写入都检查 `verification.items`。出现 `DIRECT_WRITE_VERIFY_FAILED` 时立即停止，不能把它当成已完成。
5. 使用 Preview scenario/capture 做结构与视觉辅助验证；`stop(always:true)` 负责清理 Preview。真机验收由用户执行。

示例参数：

```json
{
  "workspaceRoot": "E:/xile-workspace/qyProject/xy-client",
  "dataRoot": "E:/xile-workspace/codex-tools/project-memory-data",
  "task": "调整新版亲友房左侧列表",
  "prefab": "FriendsRoomView",
  "nodeQueries": ["GameScrollView", "Content"],
  "knownFiles": ["assets/script/game/game_entry/friends_room/FriendsRoomViewComp.ts"]
}
```

## KB 查询与 legacy 规划

需要查看 Prefab 上的脚本或脚本使用点时，可继续使用只读查询：

```powershell
node src/bin/query-project.js --workspace-root <creator-project-root> --data-root <data-root> --type prefab-component --file <prefab-path> --json
node src/bin/query-project.js --workspace-root <creator-project-root> --data-root <data-root> --type script-usage --file <script-path> --json
```

旧 `cocos-authoring --apply` 只为兼容验证保留，默认拒绝。不要在真实项目中启用 `PMM_ENABLE_LEGACY_DIRECT_COCOS_APPLY=1`；真实资源修改始终交给 Creator Bridge/MCP。
