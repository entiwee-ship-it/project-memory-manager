# project-memory-manager

KB-first 的 AI 项目记忆与链路知识库技能。

这个仓库是一个单技能仓库，提供技能：

```text
project-memory-manager
```

它用来把一个普通代码仓库接管成可持续开发的 AI 工作空间。

## What This Skill Is For

这个技能解决的是“AI 进入复杂项目后如何稳定接管、定位、开发、沉淀”的问题。

它把项目记忆拆成两层：

- `docs`：长期结论层，保存项目概览、FAQ、定位文档、变更指南、协作规则
- `KB`：事实层，保存脚本可重建的调用链、事件绑定、request-callback、状态流转

它同时补齐项目开发需要的几个入口：

- 轻入口控制台：`AGENTS.md`
- 项目记忆根目录：`project-memory/`
- 工作状态：`active work`
- feature 级链路知识库
- 面向前后端协同的工作协议

## When This Skill Should Trigger

在这些场景下，AI 应该使用这个技能：

- 初始化新的项目记忆系统
- 迁移旧的 AI 记忆体系，例如 `.kimi`
- 识别项目拓扑和技术栈区域
- 构建或刷新 feature 级知识库
- 查询方法、事件、request、state 的上下游链路
- 为全栈仓库建立统一的 AI 工作协议

适用技术方向包括：

- Cocos
- Vue
- React
- Node.js
- Java Spring
- Go
- Python

## What This Skill Produces

当技能接管一个仓库后，通常会形成这些结构：

```text
AGENTS.md
project-memory/
├── SYSTEM/
├── docs/
├── kb/
├── state/
├── reports/
└── legacy/
```

其中最重要的是：

- `AGENTS.md`：仓库级轻入口
- `project-memory/docs/`：长期记忆和工作文档
- `project-memory/kb/`：feature 级可查询链路知识库
- `project-memory/state/`：项目画像、active work、feature registry

## How The Skill Thinks

这个技能遵循 KB-first 的定位协议：

1. 先读 `AGENTS.md`
2. 再读 active work
3. 再读相关 `docs`
4. 入口、事件绑定、调用链、状态流转优先查 `KB`
5. 只有 docs 和 KB 都不足时，才做大范围仓库搜索

也就是说：

- `docs` 负责解释
- `KB` 负责定位
- `grep/rg` 只负责兜底

这也是这个技能存在的核心原因：避免 AI 一上来就退回到全仓库搜索。

## Current Extraction Capabilities

这版技能已经支持：

- 方法上下游查询
- 组件与 handler 绑定查询
- 事件 subscribers / emitters 查询
- request callers / callback chain 查询
- state readers / writers 查询
- 语义标签检索，例如 `分页加载`

如果运行环境能提供 `typescript`，`extract_feature_facts.js` 会优先使用 AST 提取：

- 类方法
- 类属性箭头函数 handler
- 事件订阅 / 派发
- request-callback 链
- 方法调用链
- state readers / writers

若运行环境缺少 `typescript`，会自动回退到正则模式。

## Repository Layout

```text
agents/       技能 UI 与 agent 接口配置
assets/       模板文件
references/   协议、边界、schema、技术适配器说明
scripts/      初始化、检测、抽取、构建、查询、校验脚本
SKILL.md      技能主说明
README.md     仓库级技能说明
```

## Read These Files

- [SKILL.md](./SKILL.md)
- [references/core/onboarding-playbook.md](./references/core/onboarding-playbook.md)
- [references/core/work-protocols.md](./references/core/work-protocols.md)
- [references/core/kb-schema.md](./references/core/kb-schema.md)
- [references/core/document-boundaries.md](./references/core/document-boundaries.md)

## Notes

- 这个仓库是技能仓库，不是通用应用仓库
- `.runtime/`、`node_modules/`、`__pycache__/` 已被忽略，不应提交
- 如果要公开分发，建议补充 `LICENSE`
