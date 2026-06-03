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
node scripts/rebuild_kbs.js --workspace-root "<project-root>"
```

升级这个技能本身时，请遵循这条规则：

- 不要直接修改已安装副本目录
- 先执行 `npx skills update`
- 最后执行 `rebuild_kbs.js`

### Codex MCP first

推荐让 Codex 先走 MCP，而不是直接翻文件或手写 CLI。MCP server 启动入口：

```powershell
node scripts/mcp_server.js
```

推荐给 Codex 配置一个固定的 `PMM_DATA_ROOT`，让记忆文件、KB、状态和报告都落在 PMM data root，而不是目标业务项目里：

```toml
[mcp_servers.project_memory_manager]
command = "node"
args = ["<project-memory-manager>/scripts/mcp_server.js"]

[mcp_servers.project_memory_manager.env]
PMM_DATA_ROOT = "<project-memory-data>"
```

Codex 的标准调用顺序：

1. `inspect_workspace`：确认目标项目和 data root，不写文件
2. `diagnose_workspace`：判断下一步是初始化、拓扑检测、构建还是查询
3. `init_workspace`：只初始化外置 memory root
4. `detect_topology`：生成 `state/project-profile.json`
5. `start_build_project_index`：异步构建 `project-global KB`
6. `get_job_status` / `get_job_result`：等待构建完成
7. `discover_features`：从 `project-global KB` 发现 feature 候选
8. `build_feature_index`：从已确认候选生成并构建 feature KB
9. `query_project_chain`：查询入口、消息、状态、上下游链路

`query_project_chain` 会对同一 KB mtime 下的重复查询做 MCP 级缓存；当 `chain.graph.json`、`chain.lookup.json` 或 `project-protocols.json` 更新时间变化时自动失效。具体查询默认收窄到 `limit=20`，最大 `limit=100`，可用 `timeoutMs` 控制单次查询超时。

CLI 仍保留给人工或 MCP 不可用时使用：

```powershell
node scripts/init_project_memory.js --workspace-root E:/xile-workspace
node scripts/detect_project_topology.js --workspace-root E:/xile-workspace
node scripts/build_project_kb.js --workspace-root E:/xile-workspace
node scripts/discover_features.js --workspace-root E:/xile-workspace
node scripts/build_feature_index.js --workspace-root E:/xile-workspace --feature-key <feature-key>
node scripts/query_project_kb.js --workspace-root E:/xile-workspace
```

默认布局是 `external-data`，这些命令写入插件源码/安装目录同级的 `project-memory-data`，也可以用 `PMM_DATA_ROOT` 或 `--data-root` 覆盖；不会在目标业务项目下创建 `project-memory/`。

## 这个技能解决什么问题

这个技能解决的是“AI 进入复杂项目后如何稳定接管、定位、开发、沉淀”的问题。

它把项目记忆拆成两层：

- `docs`：长期结论层，保存项目概览、FAQ、定位文档、变更指南、协作规则
- `KB`：事实层，保存脚本可重建的调用链、事件绑定、request-callback、状态流转

它同时补齐项目开发需要的几个入口：

- 轻入口控制台：`AGENTS.md`
- PMM data root：默认位于技能源码或安装包同级的 `project-memory-data`
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
<pmm-data-root>/workspaces/<workspace-id>/
├── SYSTEM/
├── docs/
├── kb/
├── state/
├── reports/
└── legacy/
```

其中最重要的是：

- `<memory-root>/docs/`：长期记忆和工作文档
- `<memory-root>/kb/`：feature 级可查询链路知识库
- `<memory-root>/state/`：项目画像、active work、feature registry
- 目标业务仓库默认不创建 `project-memory/`

新版本里，`<memory-root>/kb/` 不再只有 feature 视角，还会包含：

- `<memory-root>/kb/project-global/`：全盘扫描后的全局图
- `<memory-root>/state/project-protocols.json`：从项目代码里学习出的消息、dispatcher、状态模式

`project-global` 是每个 workspace 固定只有一个的全局 KB。它负责回答“这个项目整体有哪些入口、事件、状态流转、跨区域调用链”。feature KB 是按具体功能再细分的局部 KB，只有显式创建 feature 配置并构建后才会出现。因此刚接入一个项目时只看到一个 `project-global` 是正常状态。

feature KB 可以半自动生成：先运行 `discover_features` 生成 `<memory-root>/state/feature-candidates.json`，确认候选后再运行 `build_feature_index`。这样避免按目录批量创建低质量 KB，同时保留跨前端、后端、消息和状态链路的业务边界。后台全栈项目会识别 `cms-client` + `cms-server` 结构，例如在 `qyProject` 下自动生成 `qyproject-admin` 候选。

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

- `node scripts/query_project_kb.js --workspace-root <project-root>`
- `node scripts/query_kb.js --feature <feature-key>`

通过 MCP 使用时，对应入口是：

- `query_project_chain`：查询 project-global KB
- `query_feature_chain`：查询单个 feature KB，并保留 `recommendations.groups` 消歧推荐

当你还不知道该读哪个 KB 文件时，不要先手翻 `chain.graph.json` 或 `chain.lookup.json`，先跑上面的命令看 project / feature 摘要。

这也是这个技能存在的核心原因：避免 AI 一上来就退回到全仓库搜索。

## 当前具备的提取能力

这版技能已经支持：

- project-global 全盘扫描
- 项目级协议学习（message / dispatcher / state pattern）
- 项目级业务时序学习（timing / phase / transition pattern）
- project 级查询入口
- MCP feature 级查询入口
- feature 候选自动发现
- 候选驱动的 feature KB 配置生成
- Vue SFC / JS API / Express Router / controller-service 后台全栈链路抽取
- HTTP request 到 endpoint 的链路匹配
- MCP 查询缓存、mtime 自动失效、limit 和 timeout 保护
- 歧义查询推荐入口分组
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
- `scripts/query_kb.js`：统一查询入口，先看 feature 摘要、再做上下游和节点查询；当查询命中多个节点时会按 HTTP 接口、Pinus 路由、请求、方法、UI/Prefab、状态/数据等类型返回推荐入口
- `build.report.json`：给人看的构建汇总与使用说明
- `chain.lookup.json`：查询脚本使用的索引，通常不要手读
- `chain.graph.json`：图节点与边的底层事实，通常不要手读
- `scan.raw.json`：原始抽取结果，只在怀疑 extractor 漏抓时回看

默认扫描会跳过依赖和生成目录，避免 project-global KB 被环境文件污染：

- `node_modules`
- `.git`
- `.runtime`
- `dist` / `build` / `coverage` / `out`
- `.next` / `.nuxt`
- `project-memory` / `project-memory-data`
- `codex-work/work/tmp`
- `legacy-root-backups`
- `codex-tools`

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
