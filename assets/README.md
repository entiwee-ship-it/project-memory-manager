# 资源文件

本目录存放技能使用的模板文件和资源。

## 目录结构

```
assets/
├── templates/                    # 模板文件
│   ├── AGENTS_TEMPLATE.md       # AGENTS.md 模板
│   ├── FEATURE_TEMPLATE.md      # Feature 文档模板
│   ├── KB_CONFIG_TEMPLATE.json  # KB 配置模板
│   ├── KB_CONFIG_PINUS_BACKEND_EXAMPLE.json  # Pinus 后端配置示例
│   ├── PROJECT_OVERVIEW_TEMPLATE.md          # 项目概览模板
│   └── WORK_TEMPLATE.md         # Active work 模板
└── README.md                    # 本文件
```

## 模板说明

### AGENTS_TEMPLATE.md

仓库级轻入口模板，初始化项目时自动生成到目标仓库根目录。

包含：
- 项目基本信息
- 常用定位文档链接
- 当前工作状态
- AI 工作规则

### FEATURE_TEMPLATE.md

Feature 级文档模板，用于记录特定功能模块的详细信息。

包含：
- Feature 概述
- 关键文件定位
- 常见问题
- 变更指南

### KB_CONFIG_TEMPLATE.json

功能级知识库配置文件模板。

关键字段：
- `featureKey`: 功能标识（唯一）
- `featureName`: 功能显示名称
- `extractorAdapter`: 提取器适配器（generic/cocos/vue/react/node/pinus/fullstack）
- `scanTargets`: 扫描目标配置
- `outputs`: 输出文件路径

### KB_CONFIG_PINUS_BACKEND_EXAMPLE.json

Pinus 后端项目的完整配置示例。

展示如何配置：
- Handler 扫描
- Remote 扫描
- Module 扫描
- 路由分析

### PROJECT_OVERVIEW_TEMPLATE.md

项目概览文档模板，记录项目整体信息。

包含：
- 项目简介
- 技术栈
- 目录结构
- 开发规范

### WORK_TEMPLATE.md

Active work 文档模板，记录当前进行中的工作。

包含：
- 当前任务
- 已完成
- 待处理
- 阻塞项

## 使用方式

### 初始化时使用

```powershell
node scripts/init_project_memory.js --root <项目根目录> --name <项目名称>
```

初始化脚本会自动复制相关模板到目标项目。

### 手动复制

```powershell
# 复制 KB 配置模板
cp assets/templates/KB_CONFIG_TEMPLATE.json project-memory/kb/configs/my-feature-config.json

# 复制 Feature 文档模板
cp assets/templates/FEATURE_TEMPLATE.md project-memory/docs/features/my-feature.md
```

### 自定义模板

可以基于现有模板创建自定义模板：

1. 复制模板文件
2. 修改内容适应项目需求
3. 保存到 `assets/templates/`（可选）

## 模板变量

部分模板支持变量替换：

- `{{PROJECT_NAME}}` - 项目名称
- `{{FEATURE_KEY}}` - 功能键
- `{{DATE}}` - 当前日期
- `{{YEAR}}` - 当前年份

## 添加新模板

如需添加新模板：

1. 在 `templates/` 目录创建模板文件
2. 更新本 README.md 说明
3. 在初始化脚本中添加复制逻辑（如需自动使用）

## 与其他目录的关系

```
assets/         # 本目录：模板和资源
├── templates/  # 模板文件

scripts/        # 使用模板的脚本
references/     # 模板使用文档
```
