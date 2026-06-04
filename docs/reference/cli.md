# CLI Reference

Primary commands:

```text
node src/bin/mcp.js
node src/bin/init-workspace.js
node src/bin/detect-topology.js
node src/bin/build-project.js
node src/bin/discover-features.js
node src/bin/build-feature.js
node src/bin/query-project.js
node src/bin/query-feature.js
node src/bin/query-chain.js
node src/bin/rebuild-kbs.js
node src/bin/validate-package.js
```

Cocos prefab query examples:

```powershell
node src/bin/query-project.js --workspace-root E:/xile-workspace/qyProject --data-root E:/xile-workspace/codex-tools/project-memory-data --type prefab-component --file E:/xile-workspace/qyProject/xy-client/assets/bundle/gui/lobby/lobby.prefab --json
node src/bin/query-project.js --workspace-root E:/xile-workspace/qyProject --data-root E:/xile-workspace/codex-tools/project-memory-data --type script-usage --file E:/xile-workspace/qyProject/xy-client/assets/script/game/redDot/view/RedDotView.ts --json
node src/bin/query-project.js --workspace-root E:/xile-workspace/qyProject --data-root E:/xile-workspace/codex-tools/project-memory-data --type script-usage --file E:/xile-workspace/qyProject/xy-client/assets/script/game/redDot/view/RedDotView.ts --exclude-file E:/xile-workspace/qyProject/xy-client/assets/bundle/gui/lobby/lobby.prefab --json
```

## 查询收窄

宽泛词建议用过滤参数先限定场景：

```powershell
node src/bin/query-project.js --workspace-root E:/xile-workspace/qyProject --data-root E:/xile-workspace/codex-tools/project-memory-data --type endpoint --name login --module cms-server --protocol http --path /auth/login --json
node src/bin/query-project.js --workspace-root E:/xile-workspace/qyProject --data-root E:/xile-workspace/codex-tools/project-memory-data --method getCaptcha --area backend --downstream --json
```

Cocos summary 可控制输出体积：

```powershell
node src/bin/query-project.js --workspace-root E:/xile-workspace/qyProject --data-root E:/xile-workspace/codex-tools/project-memory-data --type prefab-component --file <prefab-path> --detail summary --limit 5 --json
node src/bin/query-project.js --workspace-root E:/xile-workspace/qyProject --data-root E:/xile-workspace/codex-tools/project-memory-data --type script-usage --file <script-path> --detail grouped --json
```

Additional commands:

```text
node src/bin/cocos-authoring.js
node src/bin/query-cocos-profile.js
node src/bin/build-cocos-authoring-profile.js
node src/bin/plan-cocos-binding.js
node src/bin/diagnose-paths.js
node src/bin/diagnose-imports.js
node src/bin/debug-call-chain.js
node src/bin/check-version.js
node src/bin/show-version.js
node src/bin/clean-production.js
node src/bin/clean-temp.js
node src/bin/install-kimi.js
```
