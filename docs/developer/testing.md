# Testing

Focused tests:

```powershell
npm test
npm run test:layout
npm run test:mcp
npm run test:agent
npm run test:feature
npm run test:path
npm run test:summary
npm run test:source-layout
```

`test:agent` 会同时覆盖 Agent Context Pack 和 v0.60 Agent 执行闭环，包括 Usage Gate、执行计划、范围复核、patch review、任务结果记录、CLI 兜底和 MCP 工具接入。

Package validation:

```powershell
node src/bin/validate-package.js .
```

`test:source-layout` enforces that root `scripts/` and root runtime `project-memory/` do not exist.
