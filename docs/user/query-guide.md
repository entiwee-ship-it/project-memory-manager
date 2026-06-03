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

When a KB is stale, rebuild it before relying on the answer.
