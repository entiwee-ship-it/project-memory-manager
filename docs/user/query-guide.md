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

Use a concrete project root such as `E:/xile-workspace/qyProject`. Do not use the broad `E:/xile-workspace` root for normal project work.

When a KB is stale, rebuild it before relying on the answer.
