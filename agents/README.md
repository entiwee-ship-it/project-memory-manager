# Agents 配置

本目录存放技能的 UI 与 Agent 接口配置。

## 文件说明

### openai.yaml

OpenAI Codex CLI 的接口配置，定义技能的基本信息：

```yaml
interface:
  display_name: "项目记忆管理器"           # 显示名称
  short_description: "KB-first 项目记忆..." # 简短描述
  default_prompt: "使用 $project-memory-manager..." # 默认提示词
```

## 配置规范

### display_name
- 技能在 UI 中的显示名称
- 建议使用中文，简短明了

### short_description
- 技能功能描述
- 50 字以内，概括核心能力

### default_prompt
- 默认触发提示词
- 可以包含变量，如 `$project-memory-manager`
- 建议说明技能的主要使用场景

## 扩展配置

如需支持其他 Agent 平台，可添加对应的配置文件：

- `claude.yaml` - Claude Code 配置
- `cursor.yaml` - Cursor 编辑器配置
- `copilot.yaml` - GitHub Copilot 配置

配置格式参考各平台的技能/插件规范。

## 与其他目录的关系

```
agents/         # 本目录：UI 与接口配置
├── openai.yaml # OpenAI Codex CLI 配置

scripts/        # 功能脚本
references/     # 文档与规范
assets/         # 模板资源
```
