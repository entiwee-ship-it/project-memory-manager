# 更新日志

所有重要更新都会记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布]

## [0.27.2] - 2026-06-05

### 文档
- GitHub 部署说明补充 `npx skills add ... --skill project-memory-manager`，明确 skill 安装和 MCP 配置是两个独立步骤。
- README、Quick Start 和 MCP First 补充技能安装命令，避免只配置 MCP 后技能列表里看不到 PMM。

## [0.27.1] - 2026-06-05

### 文档
- 新增 `docs/user/install-from-github.md`，覆盖新电脑从 GitHub clone PMM、安装依赖、配置 Codex MCP、首次构建、查询验证、升级和故障排查的完整流程。
- README、Quick Start、MCP First、External Data Layout 和 SKILL 入口补充新部署路径和 MCP 配置模板。

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
