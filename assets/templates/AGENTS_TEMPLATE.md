# AI 项目控制台

> Project root: `<repo-root>`
> Active memory system root: `project-memory/`

## 项目
- Type: `<single-stack|full-stack|multi-service>`
- Frontend area: `<path>`
- Backend area: `<path>`
- Ops area: `<path>`
- Primary integration: `<integration>`

## 从这里开始
- `project-memory/SYSTEM/GOVERNANCE.md`
- `project-memory/SYSTEM/WORKFLOW.md`
- `project-memory/docs/project/PROJECT_Overview.md`

## KB 快速入口
- 先运行：`node <skill-path>/scripts/query_kb.js --feature <feature-key>`
- 查上下游：`node <skill-path>/scripts/query_kb.js --feature <feature-key> --downstream <query>`
- 查具体方法：`node <skill-path>/scripts/query_kb.js --feature <feature-key> --method <name> --downstream`
- 当只知道语义词时：`node <skill-path>/scripts/query_kb.js --feature <feature-key> --type method --name <keyword>`
- 只有 KB 不足时，才回 docs 或 `rg`

## 当前工作
- `project-memory/docs/work/active/...`

## 规则摘要
- 默认先读 docs
- `FAQ.md` / `LOCATE.md` / `CHANGE_GUIDE.md` 优先于大范围搜索
- 倒推调用链、事件绑定、request、state 流转时先运行 `query_kb.js`
- 只有 docs 与 KB 都不足时，才允许全仓库 `grep` / `rg`
- 结构变化后刷新 KB
- 长期认知变化后更新 docs
