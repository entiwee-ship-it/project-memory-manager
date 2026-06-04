# Query Guide

Project-wide query:

```powershell
node src/bin/query-project.js --workspace-root <project-root> --data-root <data-root> --message login --downstream --json
```

Feature query:

```powershell
node src/bin/query-feature.js --workspace-root <project-root> --data-root <data-root> --feature <key> --request captcha --downstream --depth 5 --json
```

Direct chain query:

```powershell
node src/bin/query-chain.js --workspace-root <project-root> --data-root <data-root> --feature <key> --method <name> --downstream --json
```

Cocos prefab component summary:

```powershell
node src/bin/query-project.js --workspace-root <project-root> --data-root <data-root> --type prefab-component --file <prefab-path> --json
```

Cocos script usage summary:

```powershell
node src/bin/query-project.js --workspace-root <project-root> --data-root <data-root> --type script-usage --file <script-path> --json
node src/bin/query-project.js --workspace-root <project-root> --data-root <data-root> --type script-usage --file <script-path> --exclude-file <current-prefab-path> --json
```

## 后台页面到接口链路

后台 Vue 页面如果通过 `api.auth.login()`、`api.auth.getCaptcha()` 调用统一 API 入口，可从页面方法直接下钻：

```powershell
node src/bin/query-project.js --workspace-root E:/xile-workspace/qyProject --data-root E:/xile-workspace/codex-tools/project-memory-data --method Login.generateCaptcha --downstream --json
node src/bin/query-project.js --workspace-root E:/xile-workspace/qyProject --data-root E:/xile-workspace/codex-tools/project-memory-data --method Login.handleLogin --downstream --json
```

宽泛词先限定模块和协议：

```powershell
node src/bin/query-project.js --workspace-root E:/xile-workspace/qyProject --data-root E:/xile-workspace/codex-tools/project-memory-data --type endpoint --name login --module cms-server --protocol http --path /auth/login --json
```

Use a concrete project root such as `E:/xile-workspace/qyProject`. Do not use the broad `E:/xile-workspace` root for normal project work.

When a KB is stale, rebuild it before relying on the answer.
