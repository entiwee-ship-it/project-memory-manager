# 更新日志

所有重要更新都会记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布]

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
