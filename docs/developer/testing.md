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

Package validation:

```powershell
node src/bin/validate-package.js .
```

`test:source-layout` enforces that root `scripts/` and root runtime `project-memory/` do not exist.
