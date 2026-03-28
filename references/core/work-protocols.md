# 工作协议

## 会话开始

- 先读 `AGENTS.md`
- 再读 active work
- 再读相关 docs，优先看 `FAQ.md`、`LOCATE.md`、`CHANGE_GUIDE.md`
- 当任务是定位入口、调用链、事件绑定、状态流转时，先运行 `query_project_kb.js --root <repo-root>`
- 当任务是业务时序、阶段切换、动画结束后推进、延迟进入下一步时，先运行 `query_project_kb.js --timing/--phase/--transition`
- 当范围已经缩小到单一 feature，再运行 `query_kb.js --feature <feature-key>`
- 只有 docs 与 KB 都不足时，才做大范围仓库搜索

## 任务接入

将任务归类为：

- `frontend-only`
- `backend-only`
- `contract-first`
- `full-stack`
- `data-affecting`
- `ops-affecting`

## 修改前定位

- 先从 docs 定位
- 高频问题先看 `FAQ.md`
- 入口和改动点先看 `LOCATE.md`
- 调用链、事件绑定、request、state 流转先运行 `query_project_kb.js --root <repo-root>`
- message / dispatcher / state machine 先查 project-global KB
- timing / phase / transition 先查 project-protocols 学习结果
- 若只知道 feature、不知道具体 query，先运行 `query_kb.js --feature <feature-key>` 看摘要
- 若还不知道属于哪个 feature，先运行 `query_project_kb.js --root <repo-root>` 看 project summary
- 当只知道业务语义词时，优先试 `query_kb.js --type method --name <keyword>` 或 `--tag`
- 最后才做大范围仓库搜索
- 不要把 `grep` / `rg` 当作第一轮定位动作

## 会话收口

- 更新 active work
- 结构变化时刷新 KB
- 长期认知变化时更新 docs
- 若这次修复对后续排障有复用价值，补 `FAQ.md` 或 `CHANGE_GUIDE.md`
