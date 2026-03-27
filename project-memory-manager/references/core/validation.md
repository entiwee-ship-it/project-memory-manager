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
- 在 Windows / Python 3.13 一类临时目录 ACL 偏严格的环境里，会自动注入安全临时目录补丁，并改走“先建无 pip venv，再手动 ensurepip”的自举链路
- 若本地 venv 自举失败，再尝试 `pip install --user`
- 两种自举都失败后，回退到内置纯 Python 便携校验
- 若安全临时目录链路仍无法完成 `pip/ensurepip` 自举，才回退到便携校验，避免长时间卡在环境安装阶段

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
- 本地 venv 默认放在运行时目录下的 `validation-tools-venv`，临时安装缓存放在 `validation-temp/` 会话目录。
- 若要启用 TypeScript AST 抽取，可在技能目录执行 `npm install` 安装 `package.json` 中的 `typescript`，或将 `PMM_TYPESCRIPT_PATH` 指向 `typescript` 包目录。
