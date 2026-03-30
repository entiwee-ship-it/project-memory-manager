# 故障排除指南

## 技能版本不更新

**症状**：`npx skills update` 显示成功，但版本还是旧的

**诊断**：
```bash
# 检查当前版本
node scripts/check_skill_version.js

# 对比远程版本
node scripts/check_skill_version.js --fix
```

**解决**：
```bash
# 方法1: 强制更新
npx skills remove project-memory-manager -g
npx skills add https://github.com/entiwee-ship-it/project-memory-manager.git --skill project-memory-manager -g -a codex -y

# 方法2: 自动修复
node scripts/check_skill_version.js --fix
```

---

## 安装路径混乱

**症状**：脚本调用时找不到文件，路径错误

**诊断**：
```bash
# 检查技能安装位置
node scripts/check_skill_version.js

# 检查路径问题
node scripts/diagnose_paths.js --root <your-project>
```

**常见路径**：
- Windows: `%USERPROFILE%\.config\agents\skills\project-memory-manager`
- Windows (旧): `%USERPROFILE%\.agents\skills\project-memory-manager`
- Linux/Mac: `~/.config/agents/skills/project-memory-manager`

**解决**：
```bash
# 设置环境变量统一路径
set AGENTS_CONFIG_DIR=%USERPROFILE%\.config\agents  # Windows
export AGENTS_CONFIG_DIR=~/.config/agents           # Linux/Mac
```

---

## 残留文件报警告

**症状**：重建 KB 时报警告"配置文件不存在"

**诊断**：
```bash
# 干运行查看可清理文件
node scripts/clean_temp_files.js --dry-run
```

**解决**：
```bash
# 清理残留文件
node scripts/clean_temp_files.js

# 测试配置建议命名 xxx-test.json，方便识别
```

---

## 路径解析问题

**症状**：`E:\xile` vs `e:\xile` 导致文件找不到

**诊断**：
```bash
# 诊断路径问题
node scripts/diagnose_paths.js --root <your-project>
```

**解决**：
```javascript
// 代码中使用统一的路径处理
const path = require('path');

// 不要直接比较路径字符串
if (path1.toLowerCase() === path2.toLowerCase()) // ❌

// 使用 path.normalize 或自定义 normalize
function normalizePath(p) {
    return path.normalize(p).replace(/\\/g, '/').toLowerCase();
}
if (normalizePath(path1) === normalizePath(path2)) // ✅
```

---

## 更新提示不明显

**解决**：主动检查版本
```bash
# 添加到 .bashrc / .zshrc / PowerShell profile
alias pmm-check='node ~/.config/agents/skills/project-memory-manager/scripts/check_skill_version.js'

# 定期运行（建议每周）
npx skills check
node scripts/check_skill_version.js
```

---

## 调用链断裂

**症状**：`--upstream` 查不到调用者

**诊断**：
```bash
# 诊断导入解析
node scripts/diagnose_import_resolution.js --root <project> --file <script.ts>

# 诊断调用链
node scripts/debug_call_chain.js --feature <key> --method <name>
```

---

## 构建失败

**症状**：`build_chain_kb.js` 报错

**检查清单**：
1. 检查配置文件 JSON 格式是否有效
2. 检查所有路径是否存在
3. 检查 `extractorAdapter` 是否设置正确
4. 运行 `node scripts/diagnose_paths.js` 检查路径问题
