# Project Memory Manager

`project-memory-manager` 是一个面向 AI 编码代理的项目记忆管理技能包，用来把普通仓库接管成可持续开发的工作空间。

它的目标不是只生成几篇文档，而是同时建立三层能力：

- 轻入口控制台：让 AI 和人都能快速找到项目入口与当前工作
- 长期记忆文档：沉淀架构理解、职责边界、FAQ、变更指南
- 可重建链路知识库：支持调用链、事件绑定、request-callback、状态流转查询

## 适用场景

适合这些任务：

- 初始化新的项目记忆系统
- 迁移旧的 AI 记忆体系，例如 `.kimi`
- 识别项目拓扑和技术栈区域
- 构建或刷新 feature 级知识库
- 在前后端协同开发时建立统一工作协议

支持的常见技术方向包括：

- Cocos
- Vue
- React
- Node.js
- Java Spring
- Go
- Python

## 核心理念

- `docs` 保存长期结论，给人和 AI 阅读
- `KB` 保存可脚本重建事实，给查询和链路定位使用
- 定位问题时优先 `docs -> KB -> 仓库搜索`
- 不把全仓库 `grep/rg` 当作第一轮定位动作

## 仓库结构

```text
agents/       OpenAI / Codex skill 接口配置
assets/       模板文件
references/   协议、边界、schema、适配器文档
scripts/      初始化、检测、抽取、构建、查询、校验脚本
SKILL.md      技能主说明
```

## 快速开始

### 1. 初始化项目记忆

```bash
node scripts/init_project_memory.js --root <repo-root> --name <project-name>
node scripts/detect_project_topology.js --root <repo-root>
```

### 2. 构建功能 KB

```bash
node scripts/build_chain_kb.js --config <config.json>
node scripts/refresh_memory_indexes.js
```

### 3. 查询链路

```bash
node scripts/query_chain_kb.js --feature <feature-key> --from <method> --direction downstream
node scripts/query_chain_kb.js --feature <feature-key> --event <event-name>
node scripts/query_chain_kb.js --feature <feature-key> --name "分页加载"
```

### 4. 校验技能包

```bash
python scripts/validate_skill_runtime.py . --mode auto
```

## TypeScript AST 支持

仓库根的 `package.json` 声明了 `typescript` 运行时依赖。安装后，`extract_feature_facts.js` 会优先使用 AST 提取：

- 类方法
- 类属性箭头函数 handler
- 事件订阅 / 派发
- request-callback 链
- 方法调用链

安装方式：

```bash
npm install
```

若没有 `typescript`，脚本会自动回退到正则模式。

## 这版已经支持的 KB 能力

- 方法上下游查询
- 组件与 handler 绑定查询
- 事件 subscribers / emitters 查询
- request callers / callback chain 查询
- state readers / writers 查询
- 语义标签检索，例如 `分页加载`

## 参考入口

- [SKILL.md](./SKILL.md)
- [references/core/onboarding-playbook.md](./references/core/onboarding-playbook.md)
- [references/core/work-protocols.md](./references/core/work-protocols.md)
- [references/core/kb-schema.md](./references/core/kb-schema.md)

## License

当前仓库未单独声明开源许可证；如需公开分发，建议补充 `LICENSE` 文件。
