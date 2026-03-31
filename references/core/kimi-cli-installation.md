# Kimi CLI 安装指南

本文档详细说明如何在 Kimi Code CLI 中安装和使用 `project-memory-manager` 技能。

## 系统要求

- **操作系统**: Windows 10/11, macOS, Linux
- **依赖**: Git, Node.js (>= 16)
- **Kimi CLI**: 已安装并配置

## 安装方法

### 方法1：使用安装脚本（推荐）

本技能提供自动安装脚本，自动检测 Kimi CLI 技能目录并完成安装。

```powershell
# 1. 克隆本仓库
git clone https://github.com/entiwee-ship-it/project-memory-manager.git
cd project-memory-manager

# 2. 预览安装（可选，查看将要执行的操作）
node scripts/install_to_kimi_cli.js --dry-run

# 3. 正式安装
node scripts/install_to_kimi_cli.js
```

安装成功后会显示：
```
✓ 技能名称: project-memory-manager
✓ 当前版本: 0.16.1
✓ 发布日期: 2026-03-31
```

### 方法2：手动安装

如果自动脚本无法工作，可以手动安装：

```powershell
# 1. 找到 Kimi CLI 技能目录
# Windows 默认路径：
cd "C:\Users\<用户名>\AppData\Roaming\Trae CN\User\globalStorage\moonshot-ai.kimi-code\bin\kimi\_internal\kimi_cli\skills"

# 2. 克隆技能仓库
git clone https://github.com/entiwee-ship-it/project-memory-manager.git project-memory-manager

# 3. 验证安装
ls project-memory-manager/SKILL.md
```

### 方法3：符号链接（开发使用）

如果您在开发技能，可以使用符号链接保持同步：

```powershell
# Windows (管理员权限)
New-Item -ItemType SymbolicLink `
  -Path "C:\Users\<用户名>\AppData\Roaming\Trae CN\User\globalStorage\moonshot-ai.kimi-code\bin\kimi\_internal\kimi_cli\skills\project-memory-manager" `
  -Target "E:\skills"

# Linux/Mac
ln -s /path/to/skills/project-memory-manager \
  ~/.config/kimi/skills/project-memory-manager
```

## 验证安装

安装完成后，重启 Kimi CLI 使技能生效。

验证技能是否加载：

1. 启动 Kimi CLI
2. 在对话中询问项目记忆相关功能
3. AI 应该能够引用 `SKILL.md` 中的指南

## 更新技能

### 自动更新

```powershell
cd project-memory-manager
node scripts/install_to_kimi_cli.js --update
```

### 强制重新安装

如果遇到问题，可以强制重新安装：

```powershell
node scripts/install_to_kimi_cli.js --force
```

### 手动更新

```powershell
cd "C:\Users\<用户名>\AppData\Roaming\Trae CN\User\globalStorage\moonshot-ai.kimi-code\bin\kimi\_internal\kimi_cli\skills\project-memory-manager"
git pull origin main
```

## 故障排除

### 问题：找不到 Kimi CLI 技能目录

**症状**：安装脚本报错 "未找到 Kimi CLI 技能目录"

**解决**：

1. 确认 Kimi CLI 已安装
2. 手动查找技能目录：
   ```powershell
   Get-ChildItem -Path $env:USERPROFILE -Recurse -Filter "skills" -ErrorAction SilentlyContinue | 
     Where-Object { $_.FullName -like "*kimi*" }
   ```
3. 使用 `--skills-dir` 参数指定目录（脚本支持此参数）

### 问题：Git 克隆失败

**症状**：网络超时或权限错误

**解决**：

1. 检查网络连接
2. 使用 SSH 替代 HTTPS：
   ```powershell
   git clone git@github.com:entiwee-ship-it/project-memory-manager.git
   ```
3. 手动下载 ZIP 并解压到技能目录

### 问题：技能未生效

**症状**：重启后 AI 仍然不知道技能内容

**解决**：

1. 确认 `SKILL.md` 存在且格式正确
2. 检查 Kimi CLI 版本是否支持技能系统
3. 查看 Kimi CLI 日志（如有）

### 问题：权限不足

**症状**：无法写入技能目录

**解决**：

- Windows：以管理员身份运行 PowerShell
- Linux/Mac：使用 `sudo` 或更改目录权限

## 卸载技能

```powershell
# Windows
Remove-Item -Recurse -Force "C:\Users\<用户名>\AppData\Roaming\Trae CN\User\globalStorage\moonshot-ai.kimi-code\bin\kimi\_internal\kimi_cli\skills\project-memory-manager"

# Linux/Mac
rm -rf ~/.config/kimi/skills/project-memory-manager
```

## 与 Codex CLI 的对比

| 功能 | Kimi CLI | Codex CLI |
|------|----------|-----------|
| 安装命令 | `node scripts/install_to_kimi_cli.js` | `npx skills add` |
| 更新命令 | `node scripts/install_to_kimi_cli.js --update` | `npx skills update` |
| 配置位置 | `SKILL.md` frontmatter | `agents/openai.yaml` |
| 技能目录 | 内部目录 | `~/.config/agents/skills/` |

## 最佳实践

1. **定期更新**: 每月检查一次更新，获取新功能和修复
2. **预览模式**: 更新前使用 `--dry-run` 预览变更
3. **生产清理**: 安装后执行 `clean_for_production.js` 减小体积
4. **版本校验**: 更新后运行 `show_skill_version.js` 确认版本

## 相关文档

- [SKILL.md](../../SKILL.md) - 技能使用说明
- [production-cleanup.md](./production-cleanup.md) - 生产环境清理
- [troubleshooting.md](./troubleshooting.md) - 故障排除
