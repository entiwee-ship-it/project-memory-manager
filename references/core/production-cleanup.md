# 生产环境清理指南

在将技能安装到 AI 环境后，清理非必需文件可以显著减小体积并避免不必要的干扰。

## 为什么需要清理

开发仓库包含许多 AI 运行时不需要的文件：

| 类别 | 示例 | 占用空间 | 是否需要 |
|------|------|----------|----------|
| Git 历史 | `.git/` | 1-5 MB | 否 |
| 测试文件 | `tests/` | 50-200 KB | 否 |
| 开发文档 | `CONTRIBUTING.md` | 5-10 KB | 否 |
| 版本历史 | `CHANGELOG.md` | 3-5 KB | 否 |
| 许可证 | `LICENSE` | 1 KB | 否 |
| 示例文件 | `examples/` | 5-20 KB | 可选 |

**AI 运行时必需的文件**：
- `SKILL.md` - 核心使用说明
- `agents/` - 接口配置
- `assets/` - 初始化模板
- `references/` - 参考文档
- `scripts/` - 功能脚本
- `skill-version.json` - 版本信息
- `node_modules/` - 运行时依赖

## 使用清理脚本

### 基本用法

```bash
# 预览清理内容（强烈推荐先预览）
node scripts/clean_for_production.js --level=standard --dry-run

# 执行标准清理
node scripts/clean_for_production.js --level=standard
```

### 清理级别

#### minimal（最小清理）

仅清理最大的非必要文件。

```bash
node scripts/clean_for_production.js --level=minimal
```

**清理内容**：
- `.git/` - Git 历史
- `tests/` - 测试文件
- `.runtime/` - 运行时临时目录

**保留内容**：
- 所有文档（README、CHANGELOG、LICENSE 等）
- 示例文件

**适用场景**：仍需保留人类可读文档，供团队成员参考。

---

#### standard（标准清理）- 推荐

平衡体积和功能，是推荐级别。

```bash
node scripts/clean_for_production.js --level=standard
```

**额外清理内容**：
- `LICENSE` - 许可证（法律声明已包含在源码中）
- `CHANGELOG.md` - 版本历史
- `CONTRIBUTING.md` - 贡献指南

**保留内容**：
- `README.md` - 项目说明（人类可读）
- `examples/` - 使用示例
- `SKILL.md` - AI 核心文档
- `references/` - 参考文档

**适用场景**：AI 和人类共用的环境，既减小体积又保留必要文档。

---

#### full（完整清理）

仅保留 AI 运行必需的最低限度文件。

```bash
node scripts/clean_for_production.js --level=full
```

**额外清理内容**：
- `README.md` - AI 不读 README，只读 SKILL.md
- `examples/` - AI 通过 SKILL.md 学习，不需要示例
- TypeScript 多语言文档（保留英文）

**保留内容**：
- `SKILL.md` - 核心
- `agents/` - 配置
- `assets/` - 模板
- `references/` - 参考
- `scripts/` - 功能
- 核心依赖

**适用场景**：纯 AI 使用环境，如服务器部署、CI/CD 等。

## 清理效果示例

以本技能包为例（版本 0.16.1）：

| 级别 | 释放空间 | 剩余大小 | 说明 |
|------|----------|----------|------|
| 原始 | - | ~50 MB | 含 node_modules |
| minimal | ~15 MB | ~35 MB | 清理 Git 和测试 |
| standard | ~15 MB | ~35 MB | 同上，加文档 |
| full | ~20 MB | ~30 MB | 最大清理 |

*实际大小取决于 node_modules 和 Git 历史*

## 清理后验证

清理脚本会自动验证核心文件：

```
✓ SKILL.md
✓ skill-version.json
✓ package.json
✓ scripts/init_project_memory.js
✓ scripts/build_chain_kb.js
...
✓ 所有核心文件完好
```

如需手动验证：

```bash
python scripts/validate_skill_runtime.py . --mode auto
```

## 恢复清理的文件

如需恢复，重新安装技能包即可：

```bash
npx skills remove project-memory-manager -g
npx skills add https://github.com/entiwee-ship-it/project-memory-manager.git --skill project-memory-manager -g -a codex -y
```

## 自动化建议

### CI/CD 集成

在持续集成流程中自动清理：

```yaml
# .github/workflows/deploy.yml 示例
- name: Install Skill
  run: |
    npx skills add ... --skill project-memory-manager -g

- name: Cleanup for Production
  run: |
    cd ~/.config/agents/skills/project-memory-manager
    node scripts/clean_for_production.js --level=standard

- name: Verify
  run: |
    node scripts/show_skill_version.js --text
```

### 安装后自动清理

创建安装脚本：

```bash
#!/bin/bash
# install-skill.sh

# 安装
npx skills add https://github.com/entiwee-ship-it/project-memory-manager.git \
  --skill project-memory-manager -g -a codex -y

# 清理
SKILL_PATH="${HOME}/.config/agents/skills/project-memory-manager"
cd "$SKILL_PATH"
node scripts/clean_for_production.js --level=standard

echo "技能安装并清理完成"
```

## 注意事项

1. **先预览再执行**
   - 始终先用 `--dry-run` 预览
   - 确认无误后再实际执行

2. **不要清理后提交修改**
   - 清理是安装后的操作
   - 不要在清理后的副本上做开发

3. **升级前无需恢复**
   - `npx skills update` 会重新拉取完整副本
   - 升级后可再次清理

4. **保留 SKILL.md**
   - 这是 AI 使用技能的核心文档
   - 任何级别都不会清理此文件

## 故障排除

### 清理后脚本无法运行

```bash
# 检查核心文件是否存在
ls scripts/*.js | head -5

# 验证完整性
python scripts/validate_skill_runtime.py . --mode auto
```

### 误删重要文件

重新安装：

```bash
npx skills remove project-memory-manager -g
npx skills add https://github.com/entiwee-ship-it/project-memory-manager.git \
  --skill project-memory-manager -g -a codex -y
```

### 空间未明显减少

检查 node_modules 大小：

```bash
du -sh node_modules/
```

如需进一步减小，考虑：

```bash
# 清理 npm 缓存
npm cache clean --force

# 或仅安装生产依赖（不推荐，可能破坏功能）
# npm prune --production
```
