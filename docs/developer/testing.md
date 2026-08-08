# Testing

完整本地回归：

```powershell
npm run test:all
node src/bin/validate-package.js .
git diff --check
```

`test:all` 包含 `test:experience:contracts`，用于在独立 PMM checkout 和 GitHub Actions 中校验 Experience fixture schema、评分合同和发布脚本边界，不依赖 qyProject 或外置 PMM 数据根。

真实 Experience Value 发布门禁需要目标项目和已构建 KB，单独运行：

```powershell
$env:PMM_EXPERIENCE_WORKSPACE = 'E:/xile-workspace/qyProject'
$env:PMM_EXPERIENCE_DATA_ROOT = 'E:/xile-workspace/codex-tools/project-memory-data'
npm run test:experience
```

不要把 `test:experience:contracts` 通过描述成真实 12 任务语料通过；发布结论必须引用完整 `test:experience` 输出。

`test:all` 会串行运行当前全部测试入口。GitHub Actions 在 `windows-latest` 和 Node.js 22 上执行同一组测试与包校验。

按改动范围运行的测试：

```powershell
npm test
npm run test:layout
npm run test:registry
npm run test:mcp
npm run test:agent
npm run test:token-roi
npm run test:experience:options
npm run test:experience:contracts
npm run test:experience
npm run test:benchmark:contract
npm run test:feature
npm run test:path
npm run test:summary
npm run test:source-layout
```

`test:agent` 会同时覆盖 Agent Context Pack、v0.60 Agent 执行闭环、v0.70 Agent Memory Recall 和 Token ROI 回归，包括 Usage Gate、执行计划、范围复核、patch review、任务结果记录、中文任务召回、历史记忆隔离、compact 字符预算、Agent brief、project playbook、CLI 兜底和 MCP 工具接入。

`test:token-roi` 可单独快速验证中文验证码、麻将胡牌、登录会话任务排序，最近但无关的历史 outcome 隔离，置信度拆分，以及 Agent/Query MCP 默认输出预算。

`test:experience:options` 锁定完整 Experience 运行和可移植合同使用同一套 fixture 路径选项，避免 `--skip-path-check` 只对合同检查生效、真实评分阶段又恢复默认路径校验。

## 大型 KB 只读基准

大型 KB 查询和 JSON 解析基准必须显式指定目标 workspace 与外置 data root；脚本不会初始化、登记或重建 workspace，只读取已有 artifact。MCP 样本默认使用 `freshnessPolicy=allow_stale`；CLI `query-project` 样本同样只读并报告 freshness，但不执行这项 MCP 策略。该基准用于测量现存 artifact 的冷/热查询和内存成本，不代表语义结果可作为当前源码事实。

```powershell
npm run benchmark:kb -- `
  --workspace-root E:/xile-workspace/qyProject `
  --data-root E:/xile-workspace/codex-tools/project-memory-data `
  --iterations 3 `
  --warmup 1 `
  --parse-iterations 1
```

输出包括：

- Node/V8/platform 版本；
- `query-project` 新 Node 进程冷查询；
- MCP 新进程冷查询与同进程缓存热查询；
- graph、lookup、protocols 在独立 Node 子进程中的读取、`JSON.parse`、含进程启动总耗时和前后内存快照；
- MCP 总调用、内部查询耗时与 cache hit 数，便于区分缓存命中后的固定开销；
- min/mean/p50/p95/max 汇总。

这里的 cold 表示“新 Node 进程”，不保证操作系统文件缓存也是冷的。需要对比 Node 22 与开发机运行时时，使用相同 artifact、参数和机器负载，并保留完整 JSON 输出。

真实 qy-server 集成分支默认跳过；需要发布前联调时设置目标仓库后运行 `npm test`：

```powershell
$env:PMM_QYSERVER_ROOT = 'E:/xile-workspace/qyProject/qy-server/game-server'
npm test
```

`test:source-layout` enforces that root `scripts/` and root runtime `project-memory/` do not exist.
