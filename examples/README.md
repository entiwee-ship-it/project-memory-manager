# 使用示例

本目录包含 project-memory-manager 技能的使用示例。

## 示例列表

### complete-workflow.md - 完整工作流示例

从安装到高级语义查询的完整流程，包括：

1. 安装技能
2. 初始化项目记忆
3. 检测项目拓扑
4. 创建 Feature KB 配置
5. 构建 KB
6. 基础查询（方法上下游、事件订阅）
7. 语义查询（高级）
8. Cocos 创作辅助

**适合**：首次使用本技能的用户

### semantic-query-examples.md - 语义查询示例

展示如何使用结构化语义摘要进行智能代码查询：

- 查找过滤数据的方法
- 查找复杂业务逻辑
- 查找处理特定数据的方法
- 组合查询技巧
- JSON 输出格式

**适合**：已掌握基础功能，希望使用高级查询的用户

## 快速开始

### 1. 安装技能

```powershell
npx skills add https://github.com/entiwee-ship-it/project-memory-manager.git --skill project-memory-manager -g -a codex -y
```

### 2. 初始化项目

```powershell
cd <你的项目目录>
node <技能路径>/scripts/init_project_memory.js --root . --name "MyProject"
```

### 3. 查看完整示例

阅读 [complete-workflow.md](./complete-workflow.md) 了解完整流程。

## 更多资源

- [SKILL.md](../SKILL.md) - 技能主说明（AI 使用）
- [README.md](../README.md) - 项目说明（人类使用）
- [references/api-reference.md](../references/api-reference.md) - API 参考
- [references/core/onboarding-playbook.md](../references/core/onboarding-playbook.md) - 接管手册

## 贡献示例

欢迎提交更多使用示例！

1. 在本目录创建新的 `.md` 文件
2. 参考现有示例的格式
3. 确保示例经过实际测试
4. 提交 Pull Request

示例文件命名规范：
- `feature-xxx.md` - 特定功能示例
- `integration-xxx.md` - 集成示例
- `tips-xxx.md` - 技巧提示
