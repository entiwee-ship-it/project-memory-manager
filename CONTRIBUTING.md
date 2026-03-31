# 贡献指南

感谢您对 project-memory-manager 的兴趣！本文档将帮助您了解如何参与项目贡献。

## 行为准则

- 尊重所有参与者，保持友善和专业的交流
- 接受建设性的批评，专注于最有利的事情
- 为社区用户的利益着想

## 如何贡献

### 报告问题

如果您发现了 bug 或有功能建议，请通过以下方式提交：

1. **检查现有问题**：先在问题列表中搜索，避免重复提交
2. **提供详细信息**：
   - 问题描述：清晰描述发生了什么
   - 复现步骤：详细步骤说明如何复现
   - 期望结果：描述您期望的正确行为
   - 实际结果：描述实际发生的情况
   - 环境信息：操作系统、Node.js 版本、技能版本等

### 提交代码

#### 开发环境准备

```powershell
# 克隆仓库
git clone https://github.com/entiwee-ship-it/project-memory-manager.git
cd project-memory-manager

# 安装依赖
npm install

# 验证环境
python scripts/validate_skill_runtime.py . --mode auto
```

#### 代码规范

1. **JavaScript/Node.js**
   - 使用 CommonJS 模块规范（`require`/`module.exports`）
   - 遵循现有代码风格
   - 添加适当的注释说明复杂逻辑

2. **Python**
   - 遵循 PEP 8 规范
   - 使用 4 空格缩进

3. **文档**
   - 使用中文编写
   - 保持与现有文档风格一致
   - 更新相关引用文档

#### 提交流程

1. **创建分支**
   ```powershell
   git checkout -b feature/your-feature-name
   # 或
   git checkout -b fix/issue-description
   ```

2. **进行修改**
   - 编写代码
   - 更新文档
   - 添加测试

3. **测试验证**
   ```powershell
   # 运行测试
   npm test
   
   # 验证技能包
   python scripts/validate_skill_runtime.py . --mode auto
   
   # 检查版本
   node scripts/show_skill_version.js --text
   ```

4. **提交更改**
   ```powershell
   git add .
   git commit -m "type: 简短描述
   
   详细描述（可选）
   
   - 修改点1
   - 修改点2"
   ```

   提交类型：
   - `feat`: 新功能
   - `fix`: Bug 修复
   - `docs`: 文档更新
   - `style`: 代码格式调整
   - `refactor`: 重构
   - `test`: 测试相关
   - `chore`: 构建/工具相关

5. **推送并创建 PR**
   ```powershell
   git push origin feature/your-feature-name
   ```
   然后在 GitHub 上创建 Pull Request

### 技能升级特别说明

**重要**：这是技能仓库，不是普通应用仓库。

- **永远不要直接修改已安装的副本目录**
- 正确流程是：修改 GitHub 源仓库 → 校验 → commit/push → `npx skills update`
- 技能升级完成后，必须在技能根目录执行 `node scripts/rebuild_kbs.js --root <项目根目录>` 重建现有 KB

## 开发指南

### 项目结构

```
project-memory-manager/
├── agents/           # 技能 UI 与 agent 接口配置
├── assets/           # 模板文件
├── examples/         # 使用示例
├── references/       # 协议、边界、schema、技术适配器说明
├── scripts/          # 初始化、检测、抽取、构建、查询、校验脚本
├── tests/            # 测试文件
├── README.md         # 仓库级技能说明
├── SKILL.md          # 技能主说明
└── CHANGELOG.md      # 版本历史
```

### 添加新适配器

如果要支持新的技术栈：

1. 在 `references/adapters/` 创建新的适配器文档
2. 参考 `references/core/adapter-protocol.md` 了解适配器接口规范
3. 在 `scripts/extract_feature_facts.js` 中添加提取逻辑
4. 更新 `references/api-reference.md` 文档
5. 添加测试用例到 `tests/`

### 添加新脚本

1. 在 `scripts/` 目录创建脚本文件
2. 提供命令行接口（使用 `process.argv` 解析参数）
3. 在 `references/api-reference.md` 中添加文档
4. 添加相应的测试

## 测试

### 运行测试

```powershell
# 运行所有测试
npm test

# 运行特定测试
node tests/pinus-backend.test.js
node tests/structured-summary.test.js
```

### 添加测试

1. 在 `tests/` 目录创建测试文件
2. 使用 Node.js 内置的 `assert` 模块
3. 在 `tests/fixtures/` 提供测试固件

## 文档

### 文档规范

- 使用 Markdown 格式
- 使用中文编写
- 代码示例使用正确的语法高亮

### 需要更新的文档

修改代码时，请检查是否需要更新以下文档：

- `README.md`: 如果影响基本使用
- `SKILL.md`: 如果影响 AI 使用方式
- `CHANGELOG.md`: 记录变更
- `references/api-reference.md`: 如果修改了 API
- `references/core/*.md`: 如果修改了核心协议
- `references/adapters/*.md`: 如果修改了适配器

## 发布流程

维护者按以下步骤发布新版本：

1. 更新 `skill-version.json` 中的版本号
2. 更新 `CHANGELOG.md`
3. 创建 git tag
4. 推送到 GitHub
5. 用户通过 `npx skills update` 获取更新

## 生产环境清理

在技能正式安装到 AI 环境后，建议清理非必需文件以减小体积：

```powershell
# 预览清理内容（推荐先预览）
node scripts/clean_for_production.js --level=standard --dry-run

# 执行标准清理（推荐）
node scripts/clean_for_production.js --level=standard

# 最小清理（仅清理最大的非必要文件）
node scripts/clean_for_production.js --level=minimal

# 完整清理（仅保留 AI 运行必需的）
node scripts/clean_for_production.js --level=full
```

### 清理级别说明

| 级别 | 保留文件 | 清理内容 | 适用场景 |
|------|----------|----------|----------|
| `minimal` | 全部功能文档 | `.git`、`tests`、`.runtime` | 需要保留人类可读文档 |
| `standard` | README、示例、核心文档 | LICENSE、CHANGELOG、CONTRIBUTING、tests | 推荐，平衡体积和功能 |
| `full` | 仅 AI 运行必需的 | README、examples 等 | 纯 AI 使用环境 |

### 清理后验证

清理脚本会自动验证核心文件是否完好：

```powershell
# 验证技能包完整性
python scripts/validate_skill_runtime.py . --mode auto
```

**注意**：清理后的技能包仍可正常使用，AI 将通过 `SKILL.md` 和 `references/` 目录获取使用说明。

## 获取帮助

- 查看 `references/core/troubleshooting.md` 故障排除指南
- 在 GitHub Issues 中提问
- 参考 `README.md` 中的建议阅读文件列表

## 致谢

感谢所有为 project-memory-manager 做出贡献的开发者！
