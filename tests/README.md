# 测试

本目录包含 project-memory-manager 技能的测试文件。

## 测试结构

```
tests/
├── fixtures/                    # 测试固件（样本项目）
│   ├── pinus-sample/           # Pinus 后端样本
│   ├── cocos-http-sample/      # Cocos HTTP 样本
│   ├── cocos-prefab-sample/    # Cocos Prefab 样本
│   └── project-global-sample/  # Project-global 样本
├── path-resolution.test.js     # 路径解析测试
├── pinus-backend.test.js       # Pinus 后端功能测试
└── structured-summary.test.js  # 结构化摘要测试
```

## 运行测试

### 运行所有测试

```powershell
npm test
```

或：

```powershell
node tests/pinus-backend.test.js
```

### 运行特定测试

```powershell
# Pinus 后端测试
node tests/pinus-backend.test.js

# 结构化摘要测试
node tests/structured-summary.test.js

# 路径解析测试
node tests/path-resolution.test.js
```

## 测试内容

### pinus-backend.test.js

测试 Pinus 后端知识库功能：

- `buildChainKb` - 功能级 KB 构建
- `buildProjectKb` - 项目级 KB 构建
- `queryChainKb` - 调用链查询
- `queryKb` - KB 查询
- `queryProjectKb` - 项目级查询
- `buildCocosAuthoringProfile` - Cocos 创作配置构建
- `cocosAuthoring` - Cocos 创作辅助
- `planCocosBinding` - 绑定规划
- `rebuildKbs` - KB 重建
- `refreshMemoryIndexes` - 索引刷新
- `showSkillVersion` - 版本显示

### structured-summary.test.js

测试结构化语义摘要功能：

- 操作类型识别（filter、map、condition、loop 等）
- 复杂度评估
- 数据流追踪
- 自然语言查询匹配

### path-resolution.test.js

测试路径解析功能：

- Windows/Unix 路径处理
- 相对/绝对路径转换
- 导入路径解析

## 测试固件

### fixtures/pinus-sample/

模拟 Pinus 后端项目结构，用于测试：

- Handler 提取
- Remote 提取
- 路由分析
- 数据库模型识别

### fixtures/cocos-http-sample/

模拟 Cocos 前端项目结构，用于测试：

- 组件提取
- 方法提取
- HTTP 请求识别
- 事件绑定分析

### fixtures/cocos-prefab-sample/

模拟 Cocos Prefab 结构，用于测试：

- Prefab 解析
- 节点层级分析
- 组件绑定
- 字段绑定

### fixtures/project-global-sample/

模拟完整项目结构，用于测试：

- 全盘扫描
- 项目协议学习
- 跨区域链路分析

## 添加测试

### 1. 创建测试文件

```javascript
const assert = require('node:assert/strict');

// 测试函数
function testSomething() {
    const result = someFunction();
    assert.strictEqual(result, expected);
    console.log('✓ testSomething passed');
}

// 运行测试
testSomething();
```

### 2. 添加测试固件（如需）

在 `fixtures/` 下创建新的样本目录，包含：

- 最小化的项目结构
- 代表性的代码文件
- `README.md` 说明固件用途

### 3. 更新 package.json

如需添加新的测试入口：

```json
{
  "scripts": {
    "test": "node tests/pinus-backend.test.js",
    "test:path": "node tests/path-resolution.test.js",
    "test:summary": "node tests/structured-summary.test.js"
  }
}
```

## 测试规范

1. **使用 Node.js 内置 assert 模块**，不引入额外依赖
2. **测试函数以 `test` 开头**，便于识别
3. **输出清晰的通过/失败信息**
4. **清理测试产生的临时文件**
5. **使用绝对路径**，避免工作目录问题

## 持续集成

建议将测试集成到 CI 流程：

```yaml
# 示例 GitHub Actions 配置
name: Test
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm install
      - run: npm test
```

## 故障排除

### 测试失败：找不到模块

确保已安装依赖：

```powershell
npm install
```

### 测试失败：路径问题

检查是否在项目根目录运行测试：

```powershell
cd project-memory-manager
npm test
```

### 测试失败：fixtures 缺失

确保测试固件完整：

```powershell
ls tests/fixtures/
```
