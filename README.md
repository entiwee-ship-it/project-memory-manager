# project-memory-manager

KB-first 的 AI 项目记忆与链路知识库技能。

这个仓库是一个单技能仓库，提供技能：

```text
project-memory-manager
```

它用来把一个普通代码仓库接管成可持续开发的 AI 工作空间。

## 安装与升级

本技能支持两种 AI 客户端：

### 方式一：OpenAI Codex CLI（推荐）

使用 `skills` CLI 安装：

```powershell
npx skills add https://github.com/entiwee-ship-it/project-memory-manager.git --skill project-memory-manager -g -a codex -y
```

安装后校验：

```powershell
cd "<installed-skill-path>"
node scripts/show_skill_version.js --text
python scripts/validate_skill_runtime.py . --mode auto
```

### 方式二：Kimi Code CLI

使用本仓库提供的安装脚本：

```powershell
# 1. 克隆本仓库
git clone https://github.com/entiwee-ship-it/project-memory-manager.git
cd project-memory-manager

# 2. 安装到 Kimi CLI（预览）
node scripts/install_to_kimi_cli.js --dry-run

# 3. 正式安装
node scripts/install_to_kimi_cli.js
```

后续更新：

```powershell
cd project-memory-manager
node scripts/install_to_kimi_cli.js --update
```

### 生产环境优化（可选）

安装后如果仅供 AI 使用，可清理开发/维护类文件减小体积：

```powershell
# 预览清理内容
node scripts/clean_for_production.js --dry-run

# 执行清理（保留 README 和示例）
node scripts/clean_for_production.js
```

这不会影响技能功能，AI 仍通过 `SKILL.md` 获取使用说明。

### 升级说明

**Codex CLI:**

```powershell
npx skills check
npx skills update
cd "<installed-skill-path>"
node scripts/show_skill_version.js --text
python scripts/validate_skill_runtime.py . --mode auto
```

**Kimi CLI:**

```powershell
cd project-memory-manager
node scripts/install_to_kimi_cli.js --update
```

技能升级完成后，建议立刻在目标项目重建现有 KB：

```powershell
cd "<installed-skill-path>"
node scripts/rebuild_kbs.js --root "<project-root>"
```

升级这个技能本身时，请遵循这条规则：

- 不要直接修改已安装副本目录
- 先执行 `npx skills update`
- 最后执行 `rebuild_kbs.js`

## 这个技能解决什么问题

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

## 在什么场景触发

在这些场景下，AI 应该使用这个技能：

- 初始化新的项目记忆系统
- 迁移旧的 AI 记忆体系，例如 `.kimi`
- 识别项目拓扑和技术栈区域
- 构建或刷新 feature 级知识库
- 查询方法、事件、request、state 的上下游链路
- 为 Cocos prefab / 点击事件 / 字段绑定生成开发规划与自动应用
- 为全栈仓库建立统一的 AI 工作协议

适用技术方向包括：

- Cocos
  - 包含 prefab / `.meta` / serialized field / nested prefab override 绑定分析
- Vue
- React
- Node.js
- Java Spring
- Go
- Python

## 这个技能会产出什么

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

新版本里，`project-memory/kb/` 不再只有 feature 视角，还会包含：

- `project-memory/kb/project-global/`：全盘扫描后的全局图
- `project-memory/state/project-protocols.json`：从项目代码里学习出的消息、dispatcher、状态模式

## 这个技能如何工作

这个技能遵循 KB-first 的定位协议：

1. 先读 `AGENTS.md`
2. 再读 active work
3. 再读相关 `docs`
4. 入口、事件绑定、调用链、状态流转优先查 `project-global KB`
5. 需要局部收窄时再查 feature KB
6. 只有 docs 和 KB 都不足时，才做大范围仓库搜索

也就是说：

- `docs` 负责解释
- `KB` 负责定位
- `grep/rg` 只负责兜底

推荐把 KB 的默认入口记成两条命令：

- `node scripts/query_project_kb.js --root <project-root>`
- `node scripts/query_kb.js --feature <feature-key>`

当你还不知道该读哪个 KB 文件时，不要先手翻 `chain.graph.json` 或 `chain.lookup.json`，先跑上面的命令看 project / feature 摘要。

这也是这个技能存在的核心原因：避免 AI 一上来就退回到全仓库搜索。

## 当前具备的提取能力

这版技能已经支持：

- project-global 全盘扫描
- 项目级协议学习（message / dispatcher / state pattern）
- 项目级业务时序学习（timing / phase / transition pattern）
- project 级查询入口
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

## 配置与输出约定

当前规范配置主键是：

- `featureKey`
- `featureName`
- `outputs.scan`
- `outputs.graph`
- `outputs.lookup`
- `outputs.report`

当前规范输出文件名是：

- `chain.graph.json`
- `chain.lookup.json`
- `scan.raw.json`
- `build.report.json`

推荐读取顺序是：

1. `scripts/query_project_kb.js`
2. `scripts/query_kb.js`
3. `build.report.json`
4. `docs`
5. `rg/grep`

各文件的推荐用途：

- `scripts/query_project_kb.js`：全局查询入口，先看 project summary、message、state、跨区域链路
- `project-protocols.json`：项目协议与业务时序学习结果，包含 message / timing / phase / transition patterns
- `scripts/query_kb.js`：统一查询入口，先看 feature 摘要、再做上下游和节点查询
- `build.report.json`：给人看的构建汇总与使用说明
- `chain.lookup.json`：查询脚本使用的索引，通常不要手读
- `chain.graph.json`：图节点与边的底层事实，通常不要手读
- `scan.raw.json`：原始抽取结果，只在怀疑 extractor 漏抓时回看

当前规范注册表字段是：

- `featureKey`
- `featureName`
- `kbDir`
- `outputs`

升级兼容说明：

- 旧字段 `key`、`name`、`outputDir` 仍可读取，但会打印弃用告警
- 旧文件名 `graph.json`、`lookup.json`、`scan.json`、`report.json` 仍可兼容
- 注册表里的旧字段 `key`、`name`、`graphPath`、`lookupPath` 仍可被查询脚本读取

## 仓库结构

```text
agents/       技能 UI 与 agent 接口配置
assets/       模板文件
references/   协议、边界、schema、技术适配器说明
scripts/      初始化、检测、抽取、构建、查询、校验脚本
SKILL.md      技能主说明
README.md     仓库级技能说明
```

## 建议先读这些文件

### 快速开始
- [SKILL.md](./SKILL.md) - 技能主说明（AI 使用）
- [examples/complete-workflow.md](./examples/complete-workflow.md) - 完整工作流示例
- [references/core/onboarding-playbook.md](./references/core/onboarding-playbook.md) - 接管手册

### 核心概念
- [references/core/work-protocols.md](./references/core/work-protocols.md) - 工作协议
- [references/core/kb-schema.md](./references/core/kb-schema.md) - KB 结构与查询面
- [references/core/document-boundaries.md](./references/core/document-boundaries.md) - 文档边界

### 参考文档
- [references/api-reference.md](./references/api-reference.md) - API 参考
- [CHANGELOG.md](./CHANGELOG.md) - 版本历史
- [CONTRIBUTING.md](./CONTRIBUTING.md) - 贡献指南

## 相关目录

- [agents/](./agents/) - Agent 接口配置
- [assets/](./assets/) - 模板文件
- [examples/](./examples/) - 使用示例
- [references/](./references/) - 协议、规范、适配器说明
- [scripts/](./scripts/) - 功能脚本
- [tests/](./tests/) - 测试文件

## 说明

- 这个仓库是技能仓库，不是通用应用仓库
- `.runtime/`、`node_modules/`、`__pycache__/` 已被忽略，不应提交
- 采用 MIT 许可证，详见 [LICENSE](./LICENSE)
