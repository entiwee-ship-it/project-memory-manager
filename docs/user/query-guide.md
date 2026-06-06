# 查询指南

## 查询前先看 KB 新鲜度

通过 MCP 使用 PMM 时，先调用 `get_current_state` 或 `check_kb_freshness`。返回的 `projectGlobalFreshness` / `kbFreshness` 有四种状态：

- `fresh`：KB 与当前源码一致，可以直接查询。
- `stale`：扫描范围内源码文件新增、删除、修改，或 PMM 版本变化。
- `missing`：KB 尚未构建。
- `unknown`：旧 KB 没有源码快照或缺少构建配置。

MCP 查询默认 `freshnessPolicy=auto_rebuild`。`query_project_chain` / `query_feature_chain` 发现状态不是 `fresh` 时，会同步重建并等待完成；只有最终 `fresh` 才返回查询结果。返回的 `_mcpFreshness` 可用于确认是否发生了自动重建。

如果返回 `changeCounts.mtimeOnly > 0` 且状态仍是 `fresh`，通常表示配置过的生成文件只更新了 mtime、内容哈希未变，不需要重建。需要把生成文件写入外置 `project-profile.json` 的 `generatedFiles`，把纯缓存或临时产物写入 `snapshotIgnore`。

CLI 查询不会自动等待重建。使用 CLI 时，如果 `kbFreshness.status != fresh`，不要直接信任链路结论，先执行返回的 `recommendedAction` 或运行 `rebuild-kbs.js`。

项目全局查询：

```powershell
node src/bin/query-project.js --workspace-root <project-root> --data-root <data-root> --message login --downstream --json
```

Feature 查询：

```powershell
node src/bin/query-feature.js --workspace-root <project-root> --data-root <data-root> --feature <key> --request captcha --downstream --depth 5 --json
```

直接链路查询：

```powershell
node src/bin/query-chain.js --workspace-root <project-root> --data-root <data-root> --feature <key> --method <name> --downstream --json
```

Cocos prefab 组件摘要：

```powershell
node src/bin/query-project.js --workspace-root <project-root> --data-root <data-root> --type prefab-component --file <prefab-path> --json
```

Cocos 脚本使用摘要：

```powershell
node src/bin/query-project.js --workspace-root <project-root> --data-root <data-root> --type script-usage --file <script-path> --json
node src/bin/query-project.js --workspace-root <project-root> --data-root <data-root> --type script-usage --file <script-path> --exclude-file <current-prefab-path> --json
node src/bin/query-project.js --workspace-root <project-root> --data-root <data-root> --type prefab-script-usage --file <prefab-path> --exclude-prefab <prefab-path> --detail grouped --json
```

## 后台页面到接口链路

后台 Vue 页面如果通过 `api.auth.login()`、`api.auth.getCaptcha()` 调用统一 API 入口，可从页面方法直接下钻：

```powershell
node src/bin/query-project.js --workspace-root E:/xile-workspace/qyProject --data-root E:/xile-workspace/codex-tools/project-memory-data --method Login.generateCaptcha --downstream --mode fullstack --json
node src/bin/query-project.js --workspace-root E:/xile-workspace/qyProject --data-root E:/xile-workspace/codex-tools/project-memory-data --method Login.handleLogin --downstream --mode fullstack --focus fullstack --json
```

宽泛词先限定模块和协议：

```powershell
node src/bin/query-project.js --workspace-root E:/xile-workspace/qyProject --data-root E:/xile-workspace/codex-tools/project-memory-data --type endpoint --name login --module cms-server --protocol http --path /auth/login --json
node src/bin/query-project.js --workspace-root E:/xile-workspace/qyProject --data-root E:/xile-workspace/codex-tools/project-memory-data --type endpoint --name login --grouped --json
```

需要解释安全跳过的动态调用时使用：

```powershell
node src/bin/query-project.js --workspace-root E:/xile-workspace/qyProject --data-root E:/xile-workspace/codex-tools/project-memory-data --method Login.resetAuthState --downstream --include-unresolved --json
```

## 后端链路到数据表

想知道某个后端方法、接口或全栈链路会读写哪些表时，优先看 `dataAccessSummary`：

```powershell
node src/bin/query-project.js --workspace-root E:/xile-workspace/qyProject --data-root E:/xile-workspace/codex-tools/project-memory-data --method LoginExecuteService.loginExecute --downstream --focus data --json
node src/bin/query-project.js --workspace-root E:/xile-workspace/qyProject --data-root E:/xile-workspace/codex-tools/project-memory-data --endpoint "GET /activity/goldenEgg/getGoldenEggReward" --downstream --mode fullstack-data --json
```

`focus=data` 不改变遍历深度，只在当前链路范围内汇总表读写。`mode=fullstack-data` 会像 `mode=fullstack` 一样自动展开到更深的 HTTP/fullstack 链路，并附加同样的数据表摘要。

日常项目查询必须使用具体项目根目录，例如 `E:/xile-workspace/qyProject`。不要把宽泛的 `E:/xile-workspace` 当成普通项目根使用。

KB 过期时，先重建再相信查询结果。
