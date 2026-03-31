# 完整工作流示例

从安装到高级语义查询的完整流程。

## 第一步：安装技能

```bash
# 通过 skills CLI 安装
npx skills add https://github.com/entiwee-ship-it/project-memory-manager.git --skill project-memory-manager -g
```

## 第二步：初始化项目记忆

```bash
# 进入目标项目目录
cd /path/to/your/project

# 初始化项目记忆
node ~/.config/agents/skills/project-memory-manager/scripts/init_project_memory.js \
  --root . \
  --name "MyGameProject"
```

## 第三步：检测项目拓扑

```bash
node ~/.config/agents/skills/project-memory-manager/scripts/detect_project_topology.js --root .
```

这将生成 `project-memory/state/project-profile.json`，识别前端/后端/共享等区域。

## 第四步：创建 Feature KB 配置

假设要分析前端游戏模块 `liu-yang-san-shi-er-zhang`：

```bash
# 复制模板配置
cp ~/.config/agents/skills/project-memory-manager/assets/templates/KB_CONFIG_TEMPLATE.json \
  project-memory/kb/configs/liu-yang-san-shi-er-zhang-config.json
```

编辑配置：

```json
{
  "featureKey": "liu-yang-san-shi-er-zhang",
  "featureName": "浏阳三十二张",
  "extractorAdapter": "fullstack",
  "componentRoots": ["xy-client/assets/script/game/poker/LiuYangSanShiErZhang"],
  "assetRoots": ["xy-client/assets/bundle/game/10021/liuYangSanShiErZhang"],
  "methodRoots": ["xy-client/assets/script/game/poker/LiuYangSanShiErZhang"],
  "serverRoots": ["qyserver/game-server/app/servers/pkroom/games/poker/LiuYangSanShiErZhang"],
  "scanTargets": {
    "handlers": ["qyserver/game-server/app/servers/*/handler/*.ts"],
    "remotes": ["qyserver/game-server/app/servers/*/remote/*.ts"]
  },
  "extractOptions": {
    "bodySnippetMaxLength": 500,
    "enableStructuredSummary": true
  },
  "outputs": {
    "scan": "project-memory/kb/games/<feature-key>/scan.raw.json",
    "graph": "project-memory/kb/games/<feature-key>/chain.graph.json",
    "lookup": "project-memory/kb/games/<feature-key>/chain.lookup.json",
    "report": "project-memory/kb/games/<feature-key>/build.report.json"
  }
}
```

## 第五步：构建 KB

```bash
node ~/.config/agents/skills/project-memory-manager/scripts/build_chain_kb.js \
  --root . \
  --config project-memory/kb/configs/liu-yang-san-shi-er-zhang-config.json \
  --enable-structured-summary
```

构建完成后会显示统计信息：
```
链路知识库已构建: liu-yang-san-shi-er-zhang
  - 脚本: 56, 方法: 1239
  - 导入解析: 345/405 (85%)
  - 结构化摘要: 690 个方法
```

## 第六步：基础查询

### 6.1 查看 Feature 摘要

```bash
node ~/.config/agents/skills/project-memory-manager/scripts/query_kb.js \
  --feature liu-yang-san-shi-er-zhang
```

### 6.2 查询方法上下游

```bash
# 查看 onOpenSmallSettlement 调用了哪些方法
node scripts/query_kb.js --feature liu-yang-san-shi-er-zhang \
  --method onOpenSmallSettlement --downstream
```

### 6.3 诊断调用链

```bash
# 检查 onRoundEnd 是否调用 onOpenSmallSettlement
node scripts/analyze_call_chain.js \
  --feature liu-yang-san-shi-er-zhang \
  --caller onRoundEnd \
  --callee onOpenSmallSettlement
```

## 第七步：语义查询（高级）

### 7.1 查找过滤无效数据的方法

```bash
node scripts/query_chain_kb.js --feature liu-yang-san-shi-er-zhang \
  --has-operation filter \
  --limit 10
```

### 7.2 查找有提前返回（卫语句）的方法

```bash
node scripts/query_chain_kb.js --feature liu-yang-san-shi-er-zhang \
  --has-operation condition \
  --min-complexity medium
```

### 7.3 查找处理特定变量的方法

```bash
node scripts/query_chain_kb.js --feature liu-yang-san-shi-er-zhang \
  --data-flow-to "this.directionList"
```

### 7.4 获取 JSON 格式结果

```bash
node scripts/query_chain_kb.js --feature liu-yang-san-shi-er-zhang \
  --has-operation filter \
  --json > filter-methods.json
```

## 第八步：Cocos 创作辅助

### 8.1 查看 Prefab 结构

```bash
node scripts/cocos_authoring.js \
  --feature liu-yang-san-shi-er-zhang \
  --prefab SmallSettlement \
  --intent profile
```

### 8.2 添加点击事件

```bash
node scripts/cocos_authoring.js \
  --feature liu-yang-san-shi-er-zhang \
  --prefab SmallSettlement \
  --intent click-event \
  --source-node "ContinueBtn" \
  --target-component "SmallSettlementComp" \
  --handler "onClickContinue"
```

## 故障排除

### 问题："未找到 KB，请先构建"

解决：
```bash
# 检查 feature-registry
ls project-memory/state/feature-registry.json

# 重新构建
node scripts/build_chain_kb.js --root . --config ...
```

### 问题："结构化摘要不可用"

解决：
```bash
# 确认启用了 --enable-structured-summary
# 检查 scan.raw.json 中是否有 bodySummary 字段
node -e "
const scan = require('./project-memory/kb/games/liu-yang-san-shi-er-zhang/scan.raw.json');
const withSummary = scan.scripts.flatMap(s => s.methods).filter(m => m.bodySummary).length;
console.log('Methods with bodySummary:', withSummary);
"
```

### 问题：语义查询无结果

解决：
1. 确认启用了结构化摘要
2. 尝试更通用的操作类型
3. 查看支持的操作类型列表：
   ```bash
   node scripts/query_chain_kb.js --feature liu-yang-san-shi-er-zhang
   # 查看帮助信息中的操作类型列表
   ```
