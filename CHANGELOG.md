# 更新日志

所有重要更新都会记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布]

## [0.30.1] - 2026-06-06

### 修复
- freshness 返回新增 `querySafe`、`sourceFallbackAllowed`、`mustRefreshBeforeQuery`、`mustRefreshBeforeSourceFallback` 和 `usageGate`，明确 `stale`、`missing`、`unknown` 是刷新门禁，不是绕开 PMM 直接读源码的理由。
- 强化 SKILL 和 MCP 文档：遇到过期 KB 时必须先自动重建或 `start_build_project_index(wait:true)` 等到 fresh，只有 MCP 不可用、重建失败或用户明确要求时才允许临时源码兜底。

## [0.30.0] - 2026-06-06

### 新增
- source snapshot 支持 `snapshotIgnore` 和 `generatedFiles`。`snapshotIgnore` 不参与 freshness 指纹；`generatedFiles` 参与扫描但使用内容哈希判断，内容未变时不会因为 mtime 变化触发 stale。
- `check_kb_freshness` 返回 `mtimeOnlyFiles` 和 `changeCounts.mtimeOnly`，用于识别只改 mtime 的文件。
- `start_build_project_index` 新增 `wait` / `timeoutMs` 参数，传 `wait:true` 时会等待 project-global 构建完成并直接返回最终 workspace state 和 freshness。

### 改进
- `queued` / `running` 状态下异步 job 的 `exitCode` 对外保持 `null`，只有终态才返回最终 exit code。
- 导入解析统计区分项目内未解析导入和外部 npm 依赖，外部依赖按包名去重计数，降低 `vue`、`element-plus` 这类提示噪声。
- `detect_topology` 会保留外置 project profile 中的 `snapshotIgnore` / `generatedFiles`，避免重新检测拓扑时抹掉手工规则。

## [0.29.0] - 2026-06-06

### 新增
- `query_project_chain` 和 `query_feature_chain` 新增 `freshnessPolicy`，默认 `auto_rebuild`。查询前如果 KB 是 `stale`、`missing` 或 `unknown`，MCP 会同步重建并等待最终 `fresh` 后再查询。
- 查询结果新增 `_mcpFreshness`，记录初始状态、最终状态、是否自动重建和重建输出尾部，便于确认 Codex 是否真的等到 KB 可用。

### 改进
- `freshnessPolicy=require_fresh` 会在 KB 非 `fresh` 时直接阻止查询；`freshnessPolicy=allow_stale` 才允许调试旧 KB。
- feature 查询结果在 selector 返回数组时也会补齐 `kbFreshness`，避免无法判断 feature KB 最终状态。

## [0.28.1] - 2026-06-05

### 修复
- 修复 `refresh-memory-indexes` 刷新 feature registry 时被 KB 目录扫描记录覆盖 `configPath` 的问题，避免 feature KB 已重建后仍被标记为 `missing-kb-config`。

## [0.28.0] - 2026-06-05

### 新增
- KB 构建产物新增 `sourceSnapshot`，记录扫描范围内源码文件的路径、mtime、size 和指纹，用于判断业务源码变化后 KB 是否过期。
- MCP 新增 `check_kb_freshness`，可显式返回 project-global 或指定 feature KB 的 `fresh` / `stale` / `missing` / `unknown` 状态、原因和推荐重建动作。
- `get_current_state` 新增 `projectGlobalFreshness`，查询前即可知道 project-global KB 是否可信。
- `query_project_chain` / `query_feature_chain` 结果新增 `kbFreshness`，并保留旧的 `kbVersionStatus` 兼容字段。

### 改进
- MCP project query cache 纳入源码快照指纹，目标源码变化时即使 KB 文件 mtime 未变，也会自动失效缓存并返回 stale 状态。
- README、SKILL、MCP 优先文档、查询指南和 MCP 工具参考补充 KB 新鲜度判断规则。

## [0.27.5] - 2026-06-05

### 文档
- 将 README 和 `docs/user` 下的使用流程统一改为中文表达，命令、配置键、路径和协议名保持技术原文。
- 将 PMM skill frontmatter 描述和版本升级提示改为中文，避免技能列表与版本信息继续显示英文说明。

## [0.27.4] - 2026-06-05

### 文档
- 强化 `SKILL.md` frontmatter 触发描述，覆盖项目理解、feature 发现、调用链、前后端链路、数据表影响、Cocos prefab/script 和跨会话上下文等 PMM 应主动介入的场景。
- 重写技能正文的使用判断、MCP-first 流程、常用查询配方和结果使用规则，减少依赖项目级硬规则才能想起使用 PMM。
- 更新 OpenAI skill 展示元数据，明确 PMM 应先查询或刷新外置 KB，再决定精读源码范围。

## [0.27.3] - 2026-06-05

### 文档
- 技能安装命令补充 `--full-depth`，避免 `npx skills add` 使用缓存元数据导致安装旧版 PMM skill。
- 技能升级流程改为 `skills remove` 后重新 `skills add --full-depth`，不再建议对 GitHub root skill 使用 `skills update`。

## [0.27.2] - 2026-06-05

### 文档
- GitHub 部署说明补充 `npx skills add ... --skill project-memory-manager`，明确 skill 安装和 MCP 配置是两个独立步骤。
- README、快速开始和 MCP 优先文档补充技能安装命令，避免只配置 MCP 后技能列表里看不到 PMM。

## [0.27.1] - 2026-06-05

### 文档
- 新增 `docs/user/install-from-github.md`，覆盖新电脑从 GitHub clone PMM、安装依赖、配置 Codex MCP、首次构建、查询验证、升级和故障排查的完整流程。
- README、快速开始、MCP 优先、外置数据布局和 SKILL 入口补充新部署路径和 MCP 配置模板。

## [0.27.0] - 2026-06-04

### 新增
- 链路查询新增 `focus=data`，会在普通 downstream/upstream 结果中附加 `dataAccessSummary`，按表汇总当前遍历范围内的读写方法、操作和统计数量。
- 链路查询新增 `mode=fullstack-data`，在 `mode=fullstack` 的自动深度基础上同时返回数据表读写摘要，方便从页面/API/endpoint 一路看到后端表影响面。

## [0.26.0] - 2026-06-04

### 新增
- 查询新增 `mode=fullstack` / `--fullstack`，前端方法到 HTTP request、后端 endpoint、handler/controller 的链路可自动扩展到完整深度。
- 查询新增 `focus=fullstack`，主链路优先展示 API / HTTP / endpoint，折叠同文件 helper 到 `relatedHelpers`。
- Cocos 新增 `type=prefab-script-usage`，可一次性查看某个 prefab 上所有自定义脚本在其它 prefab 的绑定情况。
- Cocos summary 新增 `detail=counts`，并返回 `limits` 元数据说明 group / nodePath / instance 的限制与截断状态。
- 宽泛 `type/name` 查询支持 `grouped` 分组输出，并附带 `module` / `protocol` 等推荐收窄参数。
- 查询新增 `includeUnresolved` / `--include-unresolved`，可显示安全跳过的外部或动态 member call。

### 改进
- Express inline route callback 会作为 synthetic handler 进入链路，endpoint 可继续追到 callback 内直接导入的 service 方法。
- 直接调用导入函数（例如 `saveCaptcha(...)`）也会被解析成 imported function call。

## [0.25.0] - 2026-06-04

### 新增
- 支持 Vite `@/` alias 和 `api.auth.*` 这类 API namespace getter，后台 Vue 页面方法可继续追到 API 模块、request 和后端 endpoint。
- 查询新增 `area`、`module`、`excludeModule`、`protocol`、`path` 过滤参数，可收窄 `login`、`captcha`、`auth` 等宽泛词结果。
- Cocos summary 查询新增 `detail=summary|grouped|full`，`limit` 明确作用于分组数量。

### 修复
- 修复 `redisClient.set` 被误连到 `app.set` 这类低可信 member call。
- 修复 `window.$requestService?.resetAuthState()` 被误判为 Vue 文件本地 `resetAuthState` 自环。
- `method=getCaptcha --area backend` / `--file <path>` 这类查询可在歧义候选中直接消解。

## [0.24.0] - 2026-06-04

### 新增
- Cocos prefab 组件挂载专用查询：`--type prefab-component --file <prefab>`，按自定义脚本、内置组件和未解析组件分组。
- Cocos 脚本反查 prefab 使用方：`--type script-usage --file <script>`，按 prefab 和 nodePath 聚合，并支持 `--exclude-file <prefab>` 排除当前 prefab。

### 改进
- MCP 查询参数透传支持 `excludeFile` / `excludePrefab`，方便 Codex 直接回答“这个脚本是否还被其它 prefab 使用”。
- 将旧的 `E:/xile-workspace` 全局运行态 KB 归档隔离，避免继续命中 `codex-work/work/tmp` 和历史备份路径；当前有效入口应使用具体项目根，例如 `E:/xile-workspace/qyProject`。

## [0.23.0] - 2026-06-03

### 破坏性变更
- 删除旧 `scripts/*.js` 入口，所有 CLI 和 MCP 启动路径统一切换为 `src/bin/*.js`。
- 根目录不再保留运行态 `project-memory/`，项目记忆数据继续通过 `--data-root` 或 MCP 配置外置管理。

### 改进
- 源码按 `bin`、`commands`、`mcp`、`extraction`、`graph`、`query`、`discovery`、`adapters`、`maintenance`、`shared` 分层，降低命令入口和核心模块耦合。
- 重写 README、SKILL 和分层文档，明确 MCP-first 使用方式、external-data 边界、CLI 命令和源码维护入口。
- 新增源码布局回归测试，防止后续重新引入旧 `scripts` 入口或根运行态记忆目录。

## [0.22.0] - 2026-06-03

### 新增
- Vue SFC、普通 JS API 类、Express Router mount、controller/service 方法的后台全栈链路抽取。
- HTTP request 到后端 endpoint 的 `matches_endpoint` 关系，支持 `--request`、`--endpoint`、`--method` 串联查询。
- MCP `query_project_chain` 查询缓存，KB 文件 mtime 改变后自动失效，并内置查询 `limit` 与 `timeoutMs` 保护。
- `qyproject-admin` 后台全栈 feature 候选自动发现，识别 `cms-client` + `cms-server` 结构并生成跨前后端 KB 配置。
- 查询类型选错时返回可继续执行的 typed selector 建议，避免把业务词误当 message 后直接中断。

### 改进
- project-global 默认扫描排除 `codex-work/work/tmp`、`legacy-root-backups`、`project-memory-data` 和插件源码目录，降低临时文件与工具源码污染。
- method 节点显示优先使用类名或对象名，例如 `AuthApi.getCaptcha`、`authController.getCaptcha`。
- feature discovery 增强后台结构型候选，避免只按单个接口路径拆出低质量 feature。

## [0.17.0] - 2026-04-01

### 新增
- Kimi CLI 自动安装脚本 `scripts/install_to_kimi_cli.js`
- Kimi CLI 安装指南文档
- 文档全面完善，新增 LICENSE、CHANGELOG、CONTRIBUTING 等文件
- 生产环境清理脚本 `scripts/clean_for_production.js`
- API 参考文档

### 改进
- 同时支持 OpenAI Codex CLI 和 Kimi Code CLI 两种安装方式
- README 和 SKILL.md 添加双平台安装说明

## [0.16.1] - 2026-03-31

### 新增
- 项目级协议学习功能，支持 message / timing / phase / transition 模式识别
- 业务时序查询支持，可分析"为什么这个阶段太早/太晚切换"类问题
- 全栈适配器 `fullstack`，同时支持 Cocos 前端和 Pinus 后端解析
- 自动预制体扫描，无需手动列出所有 `.prefab` 文件
- JSDoc 语义提取，自动解析 `@param`、`@returns`、`@example` 等标签
- 类型信息增强，包含参数类型、返回类型、访问修饰符
- 导入解析诊断工具 `diagnose_import_resolution.js`
- 前后端数据流分析工具 `query_dataflow.js`

### 改进
- 结构化语义摘要功能增强，支持自然语言查询
- 查询接口统一，`query_kb.js` 作为功能级查询主入口
- 版本检查和自动修复功能
- 路径问题诊断工具

## [0.16.0] - 2026-03-15

### 新增
- Project-global KB 全盘扫描功能
- 项目协议学习结果保存到 `project-protocols.json`
- 跨区域链路分析支持

### 改进
- 优化 KB 查询性能
- 改进特征提取准确率

## [0.15.0] - 2026-02-28

### 新增
- Pinus 后端完整支持
- Cocos 创作辅助工具
- Prefab 绑定分析

### 改进
- 适配器架构重构，支持更多技术栈

## [0.14.0] - 2026-02-10

### 新增
- 语义标签检索功能
- 方法上下游查询
- 事件订阅关系查询

### 修复
- Windows 路径大小写问题
- PowerShell 转义问题

## [0.13.0] - 2026-01-20

### 新增
- 项目记忆迁移工具，支持从 `.kimi` 迁移
- 项目拓扑检测功能

## [0.12.0] - 2026-01-05

### 新增
- 结构化语义摘要功能
- 操作类型识别（filter、map、condition、loop 等）

## [0.11.0] - 2025-12-20

### 新增
- 首次公开发布
- KB-first 项目记忆管理
- AGENTS.md 轻入口支持
- Cocos、Vue、React、Node.js 适配器

---

## 版本升级指南

### 从 0.15.x 升级到 0.16.x

1. 更新技能包
   ```powershell
   npx skills check
   npx skills update
   ```

2. 验证版本
   ```powershell
   node scripts/show_skill_version.js --text
   python scripts/validate_skill_runtime.py . --mode auto
   ```

3. 重建项目 KB
   ```powershell
   node scripts/rebuild_kbs.js --root <项目根目录>
   ```

### 从 0.14.x 升级到 0.15.x

1. 更新技能包
2. 运行项目级全盘扫描
   ```powershell
   node scripts/build_project_kb.js --root <项目根目录>
   ```

## 兼容性说明

- 旧字段 `key`、`name`、`outputDir` 仍可读取，但会打印弃用告警
- 旧文件名 `graph.json`、`lookup.json`、`scan.json`、`report.json` 仍可兼容
- 注册表里的旧字段仍可被查询脚本读取
