---
name: project-memory-manager
description: 为包含 frontend、backend、shared、contract、data、ops 等区域的仓库建立和维护 KB-first 的 AI 项目记忆、feature 链路知识库与开发工作流。当任务涉及项目接管、旧记忆迁移、拓扑识别、KB 构建或链路查询时使用。
---

# 项目记忆管理器

## 在这些场景使用

- 初始化新的项目记忆系统
- 迁移旧的 AI 记忆体系，例如 `.kimi`
- 识别项目拓扑和技术栈区域
- 创建或刷新 active work
- 构建或刷新 feature 级链路知识库
- 查询方法、事件、request、state 的上下游链路
- 为前后端协同开发建立统一工作协议

## 默认工作流

### 会话开始

- 先读 `AGENTS.md`
- 再读 active work
- 再读相关 docs，优先看 `FAQ.md`、`LOCATE.md`、`CHANGE_GUIDE.md`
- 当任务是定位入口、调用链、事件绑定、状态流转时，再查 KB
- 只有 docs 与 KB 都不足时，才做大范围仓库搜索

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
- 阅读 `references/core/kb-schema.md`

### 查询链路

- 运行 `scripts/query_chain_kb.js --feature ...`
- 优先用 `method / event / request / state / --from --direction / --type --has-handler / --tag`
- 当只知道业务语义词时，先试 `--name` 或 `--tag`
- 不要先全仓库 `grep` / `rg`

### 会话收口

- 更新 active work
- 结构变化时刷新 KB
- 长期认知变化时更新 docs
- 高频修复优先补 `FAQ.md`、`LOCATE.md`、`CHANGE_GUIDE.md`

## 核心规则

- `docs` 是长期结论层
- `KB` 是可脚本重建事实层
- 不要把全仓库搜索当作第一轮定位动作
- 不要把穷举方法表直接灌进长期 docs
- 不要手改 KB 产物
- 结构变化后刷新 KB
- 长期认知变化后更新 docs

## 运行时说明

- `extract_feature_facts.js` 在检测到 `typescript` 运行时时会优先使用 AST 提取类方法、箭头函数 handler、事件订阅/派发、request-callback 链与调用链
- 若运行环境缺少 `typescript`，会自动回退到正则模式
- 可用 `python scripts/validate_skill_runtime.py . --mode auto` 校验技能包

## 参考入口

- 接管与系统建立：`references/core/onboarding-playbook.md`
- 工作协议：`references/core/work-protocols.md`
- docs 与 KB 边界：`references/core/document-boundaries.md`
- KB schema：`references/core/kb-schema.md`
- 前后端协同：`references/core/fullstack-coordination.md`
- 适配器协议：`references/core/adapter-protocol.md`

## 技术适配器

- Cocos：`references/adapters/cocos.md`
- Pinus / Node 游戏服务端：`references/adapters/pinus.md`
- Vue：`references/adapters/vue.md`
- React：`references/adapters/react.md`
- Java Spring：`references/adapters/java-spring.md`
- Node 服务：`references/adapters/node.md`
- Go 服务：`references/adapters/go.md`
- Python 服务：`references/adapters/python.md`
