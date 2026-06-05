# 查询指南

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
