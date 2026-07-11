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
npm run test:all
node src/bin/validate-package.js .
git diff --check
```

推送后确认 Windows GitHub Actions `CI` workflow 通过。涉及 Pinus 抽取或 qy-server 兼容性时，还要按 `docs/developer/testing.md` 设置 `PMM_QYSERVER_ROOT` 执行真实仓库集成测试。
