# 语义查询示例

本文档展示如何使用结构化语义摘要进行智能代码查询。

## 前置条件

构建 KB 时必须启用结构化摘要：

```bash
node scripts/build_chain_kb.js --config <config-path> --enable-structured-summary
```

## 示例 1：查找过滤数据的方法

查找所有使用 `.filter()` 方法过滤数据的方法：

```bash
node scripts/query_chain_kb.js --feature liu-yang-san-shi-er-zhang --has-operation filter --limit 5
```

预期输出：
```
=== 语义查询结果 (16 个匹配) ===

1. christmasEvent.ensureTasksStructure
   文件: .../christmasEvent.ts:665
   复杂度: high | 操作数: 37
   匹配操作:
     - filter | filter | target: TASK_CONFIG | condition: (taskConfig) => { ... }

2. taskCreatorService.createTasksForMain
   文件: .../taskCreatorService.ts:99
   复杂度: high | 操作数: 78
   匹配操作:
     - filter | filter | target: ... | condition: Boolean
```

## 示例 2：查找复杂业务逻辑

查找包含条件判断且复杂度为 high 的方法：

```bash
node scripts/query_chain_kb.js --feature liu-yang-san-shi-er-zhang --has-operation condition --min-complexity high --limit 5
```

## 示例 3：查找处理特定数据的方法

查找数据流中涉及 `historyData` 的方法：

```bash
node scripts/query_chain_kb.js --feature liu-yang-san-shi-er-zhang --data-flow-to historyData
```

## 示例 4：组合查询

查找有复杂条件判断且数据流向 `result` 变量的方法：

```bash
node scripts/query_chain_kb.js --feature liu-yang-san-shi-er-zhang \
  --has-operation condition \
  --min-complexity medium \
  --data-flow-to result \
  --limit 10
```

## 示例 5：查找循环操作

查找包含循环（for/of/while）的方法：

```bash
node scripts/query_chain_kb.js --feature liu-yang-san-shi-er-zhang --has-operation loop
```

## 支持的操作类型

| 操作类型 | 说明 | 示例代码 |
|----------|------|----------|
| `filter` | 数组过滤 | `arr.filter(x => x > 0)` |
| `map` | 数组映射 | `arr.map(x => x * 2)` |
| `condition` | 条件判断 | `if (x > 0) { ... }` |
| `loop` | 循环 | `for (const x of arr) { ... }` |
| `assignment` | 变量赋值 | `const x = y` |
| `method_call` | 方法调用 | `this.service.fetch()` |
| `return` | 返回语句 | `return x` |

## 复杂度级别

| 级别 | 描述 | 典型特征 |
|------|------|----------|
| `low` | 简单方法 | <3 个操作，无复杂逻辑 |
| `medium` | 中等复杂度 | 3-5 个操作，有分支或循环 |
| `high` | 复杂方法 | >5 个操作，多重嵌套逻辑 |

## JSON 输出

使用 `--json` 参数获取机器可读的输出：

```bash
node scripts/query_chain_kb.js --feature liu-yang-san-shi-er-zhang --has-operation filter --json
```

输出格式：
```json
{
  "query": {
    "hasOperation": "filter",
    "minComplexity": ""
  },
  "total": 16,
  "results": [
    {
      "node": { "name": "...", "file": "...", "line": 123 },
      "bodySummary": {
        "complexity": "high",
        "operations": [...],
        "data_flow": [...]
      },
      "matchedOperations": [...]
    }
  ]
}
```
