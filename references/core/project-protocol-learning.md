# Project Protocol Learning

## 目标

让技能学习“这个项目自己的协议”，而不是为某个项目把消息名和链路规则硬编码进技能仓库。

## 产物

- `project-memory/kb/project-global/chain.graph.json`
- `project-memory/kb/project-global/chain.lookup.json`
- `project-memory/kb/project-global/build.report.json`
- `project-memory/state/project-protocols.json`

## 默认命令

```bash
node scripts/build_project_kb.js --root <repo-root>
node scripts/query_project_kb.js --root <repo-root>
node scripts/query_project_kb.js --root <repo-root> --message <message> --downstream
```

## 当前学习范围

- message route / dispatcher
- `cmd:*` 风格消息发送
- handler / remote / table-msg 注册
- state read / write 模式
- message -> handler -> method 调用链基座

## 不做的事

- 不把项目特有消息名写死到技能仓库
- 不执行项目运行时代码
- 不假设所有项目都遵循同一个 dispatcher 结构

## 覆盖策略

- `project-protocols.json` 是自动学习产物
- 当学习结果不够稳定时，优先补协议学习规则或人工 override，而不是把项目特例写进通用技能代码
