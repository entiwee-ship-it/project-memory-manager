# Release Process

1. Update source and tests.
2. Run the full validation set.
3. Update `skill-version.json`.
4. Add a `CHANGELOG.md` entry.
5. Rebuild a real target workspace KB.
6. Update local MCP config if the entrypoint changed.
7. Commit with a Chinese commit message and push `main`.

Required validation:

```powershell
npm test
npm run test:layout
npm run test:mcp
npm run test:feature
npm run test:path
npm run test:summary
npm run test:source-layout
node src/bin/validate-package.js .
git diff --check
```
