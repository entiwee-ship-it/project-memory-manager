# Testing

完整本地回归：

```powershell
npm run test:all
node src/bin/validate-package.js .
git diff --check
```

`test:all` 会串行运行当前全部测试入口。GitHub Actions 在 `windows-latest` 和 Node.js 22 上执行同一组测试与包校验。

按改动范围运行的测试：

```powershell
npm test
npm run test:layout
npm run test:registry
npm run test:mcp
npm run test:agent
npm run test:feature
npm run test:path
npm run test:summary
npm run test:source-layout
```

`test:agent` 会同时覆盖 Agent Context Pack、v0.60 Agent 执行闭环和 v0.70 Agent Memory Recall，包括 Usage Gate、执行计划、范围复核、patch review、任务结果记录、历史任务召回、Agent brief、project playbook、CLI 兜底和 MCP 工具接入。

真实 qy-server 集成分支默认跳过；需要发布前联调时设置目标仓库后运行 `npm test`：

```powershell
$env:PMM_QYSERVER_ROOT = 'E:/xile-workspace/qyProject/qy-server/game-server'
npm test
```

`test:source-layout` enforces that root `scripts/` and root runtime `project-memory/` do not exist.
