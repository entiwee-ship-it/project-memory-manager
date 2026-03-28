---
name: project-memory-manager
description: 为包含 frontend、backend、shared、contract、data、ops 等区域的仓库建立和维护 KB-first 的 AI 项目记忆、feature 链路知识库与开发工作流。当 Codex 需要初始化或刷新项目接管记忆系统、迁移旧记忆体系（如 `.kimi`）、识别仓库拓扑与技术栈区域、创建或刷新 active work、构建或刷新 feature 级 method/event/request/state 链路知识库、查询调用链与状态流转，或为 Cocos、Vue、React、Java Spring、Node.js、Go、Python 等仓库建立统一协作协议时使用。
---

# 项目记忆管理器

## 先判断任务类型

- 初始化新仓库时，先读 `references/core/onboarding-playbook.md` 与 `references/core/work-protocols.md`，再运行 `scripts/init_project_memory.js` 和 `scripts/detect_project_topology.js`
- 迁移旧体系时，先读 `references/core/document-boundaries.md`，再运行 `scripts/migrate_legacy_memory.js`，把长期结论迁入 docs，把可重建事实迁入 KB 配置和产物
- 需要全盘扫描整个仓库、学习项目自己的消息/状态协议时，先运行 `scripts/build_project_kb.js --root <repo-root>`，再读 `references/core/project-protocol-learning.md`
- 构建或刷新链路 KB 时，先读 `references/core/kb-schema.md`，再按技术栈读取对应 `references/adapters/*.md`，准备配置后运行 `scripts/build_chain_kb.js --config ...`
- 查询调用链、事件、request、state 时，优先运行 `scripts/query_project_kb.js --root <repo-root>`；当范围已经缩到 feature 再用 `scripts/query_kb.js --feature ...`
- 校验技能包或在新环境自举依赖时，先读 `references/core/validation.md`，再在技能根目录运行 `python scripts/validate_skill_runtime.py . --mode auto`
- 需要扩展新技术栈、补拓扑规则或制定前后端协同时，先读 `references/core/adapter-protocol.md` 与 `references/core/fullstack-coordination.md`
- 当任务是“升级这个技能本身”时，永远以 GitHub 源仓库为准，不要直接修改已安装副本目录

## 默认工作流

### 会话开始

- 先读目标仓库根的 `AGENTS.md`
- 再读 `project-memory/state/active-work.json` 与 `project-memory/state/project-profile.json`
- 再读任务相关 docs，优先看 `FAQ.md`、`LOCATE.md`、`CHANGE_GUIDE.md` 和对应 feature 文档
- 当任务是定位入口、事件绑定、request-callback、状态流转或上下游调用时，先查 `project-global KB`，再决定是否做 feature 级或局部源码搜索
- 若目标仓库还没有 `project-memory/`，立即切到“初始化或刷新项目记忆”流程

### 初始化新仓库

- 运行 `node scripts/init_project_memory.js --root <repo-root> --name <project-name>`
- 运行 `node scripts/detect_project_topology.js --root <repo-root>`
- 按 `references/core/onboarding-playbook.md` 的默认顺序补齐 `AGENTS.md`、project overview、active work 与工作协议
- 只在识别出技术栈后读取对应适配器，避免一次性加载全部技术说明

### 迁移旧体系

- 运行 `node scripts/migrate_legacy_memory.js --root <repo-root> --source .kimi`
- 先保留旧体系快照，再迁移长期结论
- 用 `references/core/document-boundaries.md` 判断哪些内容进入 docs，哪些内容应沉淀为 KB 配置或可重建产物
- 迁移后刷新 `project-profile.json`、`active-work.json` 与 feature registry

### 构建或刷新功能 KB

- 先准备 KB 配置 JSON，明确 `featureKey`、入口文件、关注目录与语义标签
- 运行 `node scripts/build_chain_kb.js --config <config-path>`
- 构建后会自动同步 `feature-registry.json` 与 `kb/indexes/features.json`
- 用 `references/core/kb-schema.md` 校验节点类型、边类型与查询面是否覆盖任务需求
- 若拓扑或抽取结果不稳定，只补适配器规则，不要手改 KB 产物
- 后端仓库可直接使用 `serverRoots`、`moduleRoots`、`dbRoots` 或 `scanTargets.handlers/remotes/modules/routes/schemas`
- Pinus 后端优先参考 `assets/templates/KB_CONFIG_PINUS_BACKEND_EXAMPLE.json`
- 类似 `qyserver` 的仓库优先用绝对 `scanTargets` + `extractorAdapter: "pinus"`，不要在目标仓库里手工同步索引
- 旧字段 `key` / `name` / `outputDir` 与旧输出文件名仍兼容，但会打印弃用告警

### 构建 project-global KB

- 运行 `node scripts/build_project_kb.js --root <repo-root>`
- 这一步会全盘扫描仓库，产出：
  - `project-memory/kb/project-global/chain.graph.json`
  - `project-memory/kb/project-global/chain.lookup.json`
  - `project-memory/kb/project-global/build.report.json`
  - `project-memory/state/project-protocols.json`
- 这一步不是替代 feature KB，而是提供全局入口、消息协议学习和跨区域链路基座
- 当升级技能版本后，优先重建 `project-global KB`，再重建 feature KB

### 查询链路

- 全局入口优先：`node scripts/query_project_kb.js --root <repo-root>`
- 全局消息查询：`node scripts/query_project_kb.js --root <repo-root> --message <message> --downstream`
- 当范围已经缩小到单一 feature，再运行 `node scripts/query_kb.js --feature <feature-key> ...`
- 若已经在技能根目录，可直接运行 `node scripts/query_kb.js --feature <feature-key> ...`
- 若不在技能根目录，再使用 `node <skill-path>/scripts/query_kb.js --feature <feature-key> ...`
- 若只执行 `--feature <key>`，脚本会先返回 feature 摘要、默认排查顺序、推荐命令和各 KB 文件用途
- 优先用 `--downstream <query>`、`--upstream <query>`，或 `--method/--event/--request/--state <query> --downstream|--upstream`
- `scripts/query_chain_kb.js` 仍保留兼容，但默认推荐入口改为 `scripts/query_kb.js`
- 兼容旧写法 `--from <query> --direction <upstream|downstream>`
- `build.report.json` 是给人看的说明文件；`chain.lookup.json` / `chain.graph.json` / `scan.raw.json` 默认都不建议直接手读
- 当只知道业务语义词时，先试 `--name` 或 `--tag`
- 只有 KB 无法回答时，才做补充性的 `rg` / `grep`

### 会话收口

- 更新 active work 或对应工作文档
- 结构变化时刷新 KB 与索引
- 长期认知变化时更新 docs
- 高频修复优先补 `FAQ.md`、`LOCATE.md`、`CHANGE_GUIDE.md`

### 升级这个技能本身

- 永远不要把 `<installed-skill-path>` 或其它已安装副本当作最终修改目标
- 正确流程是：修改 GitHub 源仓库 -> 校验 -> commit/push -> `npx skills update`
- 技能升级完成后，必须在技能根目录执行 `node scripts/rebuild_kbs.js --root <project-root>` 重建现有 KB
- 如果当前查询脚本提示 `[stale-kb]`，说明 KB 还是旧技能版本构建的，先重建再继续分析

## 按需读取这些 references

- 接管与首次落地：`references/core/onboarding-playbook.md`
- 日常协作顺序：`references/core/work-protocols.md`
- docs 与 KB 边界：`references/core/document-boundaries.md`
- KB schema 与查询面：`references/core/kb-schema.md`
- 项目协议学习：`references/core/project-protocol-learning.md`
- 全栈协同：`references/core/fullstack-coordination.md`
- 适配器扩展规则：`references/core/adapter-protocol.md`
- 校验与环境自举：`references/core/validation.md`

## 核心规则

- `docs` 是长期结论层
- `KB` 是可脚本重建事实层
- 不要把全仓库搜索当作第一轮定位动作
- 不要把穷举方法表直接灌进长期 docs
- 不要手改 KB 产物
- 结构变化后刷新 KB
- 长期认知变化后更新 docs
- 优先补脚本、配置或适配器，不要把一次性推理结果写成长期协议
- 依赖 `process.cwd()` 的脚本要先切到目标仓库根；带 `--root` 的脚本可以从任意目录运行

## 运行时说明

- `extract_feature_facts.js` 在检测到 `typescript` 运行时时会优先使用 AST 提取类方法、箭头函数 handler、事件订阅/派发、request-callback 链与调用链
- 若运行环境缺少 `typescript`，会自动回退到正则模式
- 可用 `node scripts/show_skill_version.js --text` 查看已安装技能版本与能力指纹
- 可用 `python scripts/validate_skill_runtime.py . --mode auto` 校验技能包
- `show_skill_version.js` 与 `validate_skill_runtime.py` 会在已安装副本路径下明确提示“不要直接改安装副本”
- 公开安装推荐使用 `npx skills add https://github.com/entiwee-ship-it/project-memory-manager.git --skill project-memory-manager -g -a codex -y`

## 技术适配器

- Cocos：`references/adapters/cocos.md`
- Pinus / Node 游戏服务端：`references/adapters/pinus.md`
- Vue：`references/adapters/vue.md`
- React：`references/adapters/react.md`
- Java Spring：`references/adapters/java-spring.md`
- Node 服务：`references/adapters/node.md`
- Go 服务：`references/adapters/go.md`
- Python 服务：`references/adapters/python.md`
