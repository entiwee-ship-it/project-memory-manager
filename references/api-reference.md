# API 参考

## 脚本命令行接口

### 初始化脚本

#### `init_project_memory.js`

初始化新项目的项目记忆系统。

```bash
node scripts/init_project_memory.js --root <repo-root> --name <project-name>
```

**参数：**
- `--root <path>`: 项目根目录（必需）
- `--name <name>`: 项目名称（可选，默认使用目录名）

**输出：**
- `project-memory/` 目录结构
- `AGENTS.md` 模板

---

### 拓扑检测

#### `detect_project_topology.js`

检测项目技术栈和区域分布。

```bash
node scripts/detect_project_topology.js --root <repo-root> [--out <output-path>]
```

**参数：**
- `--root <path>`: 项目根目录（必需）
- `--out <path>`: 输出文件路径（可选，默认：`project-memory/state/project-profile.json`）

**输出：**
- `project-profile.json`: 包含项目类型、技术栈、区域分布

---

### KB 构建

#### `build_chain_kb.js`

构建功能级知识库。

```bash
node scripts/build_chain_kb.js --config <config-path> [--enable-structured-summary]
```

**参数：**
- `--config <path>`: KB 配置文件路径（必需）
- `--enable-structured-summary`: 启用结构化语义摘要（可选，推荐）

**配置示例：**
```json
{
  "featureKey": "backend-core",
  "featureName": "Backend Core",
  "scanTargets": {
    "handlers": ["app/servers/*/handler/*.ts"],
    "remotes": ["app/servers/*/remote/*.ts"]
  },
  "extractorAdapter": "pinus"
}
```

**输出：**
- `chain.graph.json`: 图节点和边
- `chain.lookup.json`: 查询索引
- `scan.raw.json`: 原始抽取结果
- `build.report.json`: 构建报告

---

#### `build_project_kb.js`

构建项目级全局知识库。

```bash
node scripts/build_project_kb.js --root <repo-root>
```

**参数：**
- `--root <path>`: 项目根目录（必需）

**输出：**
- `project-memory/kb/project-global/chain.graph.json`
- `project-memory/state/project-protocols.json`

---

### KB 查询

#### `query_project_kb.js`

查询项目级知识库。

```bash
# 项目摘要
node scripts/query_project_kb.js --root <repo-root>

# 消息查询
node scripts/query_project_kb.js --root <repo-root> --message <msg> --downstream

# 时序查询
node scripts/query_project_kb.js --root <repo-root> --timing <query>

# 阶段查询
node scripts/query_project_kb.js --root <repo-root> --phase <query>
```

**参数：**
- `--root <path>`: 项目根目录（必需）
- `--message <name>`: 查询消息
- `--timing <query>`: 查询时序模式
- `--phase <query>`: 查询阶段模式
- `--transition <query>`: 查询状态转换
- `--downstream`: 下游遍历
- `--upstream`: 上游遍历
- `--json`: JSON 输出

---

#### `query_kb.js` / `query_chain_kb.js`

查询功能级知识库。

```bash
# 功能摘要
node scripts/query_kb.js --feature <feature-key>

# 方法上下游
node scripts/query_kb.js --feature <key> --method <name> --downstream

# 事件查询
node scripts/query_kb.js --feature <key> --event <name>

# 语义查询（需启用结构化摘要）
node scripts/query_kb.js --feature <key> --has-operation filter
node scripts/query_kb.js --feature <key> --min-complexity high
```

**参数：**
- `--feature <key>`: 功能键（必需）
- `--method <name>`: 方法名
- `--event <name>`: 事件名
- `--request <name>`: 请求名
- `--state <name>`: 状态名
- `--type <type>`: 节点类型过滤
- `--name <keyword>`: 名称关键字
- `--downstream`: 下游遍历
- `--upstream`: 上游遍历
- `--depth <n>`: 遍历深度（默认：2）
- `--limit <n>`: 结果限制（默认：20）

---

### Cocos 创作辅助

#### `cocos_authoring.js`

辅助 Cocos prefab 绑定和事件处理。

```bash
# Prefab 概览
node scripts/cocos_authoring.js --feature <key> --prefab <name> --intent profile

# 添加点击事件
node scripts/cocos_authoring.js --feature <key> --prefab <name> --intent click-event \
  --source-node <node> --target-component <comp> --handler <method>

# 字段绑定
node scripts/cocos_authoring.js --feature <key> --prefab <name> --intent field-binding \
  --component-node <node> --component <comp> --field <field> --target-node <target>
```

**参数：**
- `--feature <key>`: 功能键
- `--prefab <name>`: Prefab 名称
- `--intent <type>`: profile | click-event | field-binding
- `--apply`: 实际应用更改（默认只输出规划）
- `--json`: JSON 输出

---

### 诊断工具

#### `diagnose_paths.js`

诊断路径问题。

```bash
node scripts/diagnose_paths.js --root <repo-root>
```

#### `diagnose_import_resolution.js`

诊断导入解析问题。

```bash
node scripts/diagnose_import_resolution.js --root <repo-root> --file <script-file>
```

---

### 重建和迁移

#### `rebuild_kbs.js`

重建所有 KB。

```bash
node scripts/rebuild_kbs.js --root <repo-root>
```

**参数：**
- `--root <path>`: 项目根目录
- `--feature <key>`: 只重建特定功能
- `--stop-on-error`: 遇到错误停止（默认继续）

---

#### `migrate_legacy_memory.js`

迁移旧记忆体系。

```bash
node scripts/migrate_legacy_memory.js --root <repo-root> --source <old-system>
```

---

## 环境变量

- `PMM_PROJECT_ROOT`: 默认项目根目录
- `PMM_QYSERVER_ROOT`: qyserver 项目路径（用于测试）

## 返回码

- `0`: 成功
- `1`: 一般错误
- `2`: 配置错误
- `3`: 项目未初始化
