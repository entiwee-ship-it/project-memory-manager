# 校验与环境自举

## 目标

在新环境里校验技能包时，优先自动补齐环境，而不是直接因为缺少依赖失败。

## 默认命令

```bash
python scripts/validate_skill_runtime.py <skill-path> --mode auto
```

## 模式

### `auto`
- 先尝试严格 PyYAML 校验
- 若缺少 PyYAML，先尝试本地 venv 安装 `scripts/requirements-validation.txt`
- 若本地 venv 自举失败，再尝试 `pip install --user`
- 两种自举都失败后，回退到内置纯 Python 便携校验

### `strict`
- 强制使用 PyYAML
- 适用于环境已准备好，或自举已成功的场景

### `portable`
- 仅使用内置纯 Python 解析器
- 不依赖 PyYAML
- 不依赖 Node
- 适用于离线或受限环境

## 说明

- 便携校验能力比完整 YAML 解析窄，但足以覆盖当前技能的 `SKILL.md` 与 `agents/openai.yaml` 结构。
- `auto` 模式的默认策略是：能补环境就补环境，补不了才做最后兜底。
