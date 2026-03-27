---
name: project-memory-manager
description: 为包含 frontend、backend、shared、contract、data、ops 等区域的仓库建立和维护可复用的 AI 项目接管、开发记忆与链路知识库系统。当 AI 编码代理需要：(1) 初始化新的项目记忆系统，(2) 识别项目拓扑和技术栈区域，(3) 迁移旧的记忆体系（例如 `.kimi`），(4) 创建或刷新 active work 工作计划，(5) 构建或查询 feature 级链路知识库，或 (6) 在 Cocos、Vue、React、Java、Node.js、Go、Python 等技术栈上建立前后端协同开发协议时使用。
---

# 项目记忆管理器

## 概览

使用这个技能，把一个仓库接管成 AI 可持续开发的工作空间，形成：

- 轻入口仓库控制台
- 面向人阅读的长期记忆文档
- 可脚本重建的链路知识库
- 面向编码与前后端协同的执行协议

## 工作流决策树

### 初始化新仓库
- 运行 `scripts/init_project_memory.js`
- 运行 `scripts/detect_project_topology.js`
- 创建或刷新仓库根的 `AGENTS.md`
- 阅读 `references/core/onboarding-playbook.md`

### 迁移旧体系
- 运行 `scripts/migrate_legacy_memory.js`
- 阅读 `references/core/document-boundaries.md`
- 把长期结论迁入 docs
- 把可重建事实迁入 KB 配置与 KB 产物

### 构建或刷新功能 KB
- 准备 KB 配置 JSON
- 运行 `scripts/build_chain_kb.js --config ...`
- 运行 `scripts/refresh_memory_indexes.js`
- `extract_feature_facts.js` 在检测到 `typescript` 运行时时会优先使用 AST 提取类方法、箭头函数 handler、事件订阅/派发、request-callback 链与调用链；缺失时自动回退到正则模式
- 阅读 `references/core/kb-schema.md`

### 校验技能包
- 运行 `scripts/validate_skill_runtime.py <skill-path> --mode auto`
- 当环境已经具备 PyYAML 或已自举完成时，可使用 `--mode strict`
- 当环境必须避免依赖 PyYAML 与 Node 时，可使用 `--mode portable`
- 阅读 `references/core/validation.md`

### 查询链路
- 运行 `scripts/query_chain_kb.js --feature ...`
- 优先用 `method / event / request / state / --from --direction / --type --has-handler / --tag` 查询
- 当只知道业务语义词时，先试 `--name` 或 `--tag`，例如“分页加载”
- 当任务是在定位入口、事件绑定、调用链、状态流转时，不要先全仓库搜索，先读 docs，再查 KB
- 只有 docs 与 KB 都不足以回答问题时，才退回到大范围仓库搜索

### 开始开发工作
- 阅读 `references/core/work-protocols.md`
- 先判断任务影响区域
- 当前后端同时变化时，遵循 `references/core/fullstack-coordination.md`

## 核心规则

- docs 是给人和 AI 读的长期结论层
- KB 是给脚本重建和查询的事实层
- 不要把全仓库 `grep` / `rg` 当作第一次定位手段
- 不要把穷举方法表直接灌进长期 docs
- 不要手改 KB 产物
- 结构变化后刷新 KB
- 长期认知变化后更新 docs
- 修完高频问题后，优先补 `FAQ.md`、`LOCATE.md`、`CHANGE_GUIDE.md`

## 参考资料

- 接管与系统建立：`references/core/onboarding-playbook.md`
- 工作习惯与执行协议：`references/core/work-protocols.md`
- 前后端协同规则：`references/core/fullstack-coordination.md`
- docs 与 KB 边界：`references/core/document-boundaries.md`
- KB 节点与边 schema：`references/core/kb-schema.md`
- 校验与环境自举：`references/core/validation.md`
- 适配器接口与约束：`references/core/adapter-protocol.md`

## 技术适配器

- Cocos 客户端项目：`references/adapters/cocos.md`
- Pinus / Node 游戏服务端：`references/adapters/pinus.md`
- Vue 项目：`references/adapters/vue.md`
- React 项目：`references/adapters/react.md`
- Java Spring 服务：`references/adapters/java-spring.md`
- Node 服务：`references/adapters/node.md`
- Go 服务：`references/adapters/go.md`
- Python 服务：`references/adapters/python.md`

## 资源

### scripts/
- `init_project_memory.js`
- `detect_project_topology.js`
- `extract_feature_facts.js`
- `build_chain_kb.js`
- `query_chain_kb.js`
- `refresh_memory_indexes.js`
- `migrate_legacy_memory.js`
- `validate_skill_runtime.py`

### references/
- 协议、边界、schema 与技术适配说明

### assets/
- `AGENTS.md`、项目概览、功能文档、工作项、KB 配置模板
