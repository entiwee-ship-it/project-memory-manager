# KB Schema

## 节点类型

- `module`
- `script`
- `class`
- `method`
- `component`
- `route`
- `endpoint`
- `service`
- `event`
- `message`
- `request`
- `response`
- `dto`
- `model`
- `state`
- `table`
- `config`
- `job`

## 边类型

- `contains`
- `binds`
- `calls`
- `field_calls`
- `subscribes`
- `emits`
- `vm_binds`
- `vm_emits`
- `requests`
- `callback_calls`
- `reads`
- `writes`
- `depends_on`

## 查询要求

需要直接支持：

- event -> subscribers / emitters
- method -> outgoing / incoming edges
- request -> callers
- endpoint / route / table 的 `--type` / `--name` / `--from --direction` 查询
- upstream 遍历
- downstream 遍历
- component -> binds(handler / sourceEventKind)
- state -> readers / writers
- tag / 语义标签检索
- `--feature <key>` 的 feature-summary 摘要输出
- `--root <repo-root>` 的 project-summary 摘要输出
- 推荐单入口 `query_kb.js`，`query_chain_kb.js` 作为兼容入口保留
- `query_project_kb.js --timing/--phase/--transition` 的项目协议查询

## 节点 ID 格式说明

**重要**: 节点 ID 使用 `slugify` 函数标准化处理：
- 全小写 (`toLowerCase`)
- 特殊字符替换为连字符 (`-`)
- 例如: `method:e-xile-xy-client-assets-script-game-poker-liuyangsanshierzhangviewcomp.ts:onroundend`

**查询方式**: 
- 使用 `query_chain_kb.js` 或 `query_project_kb.js` 时，**直接使用原始驼峰命名**即可
- 例如: `--method onOpenSmallSettlement` 或 `--method LiuYangSanShiErZhangViewComp.onRoundEnd`
- 工具会自动匹配 `node.name` 或 `node.meta.methodName`，无需手动构造 slugified ID

## 配置与注册表规范

### KB 配置规范

- 必填：`featureKey`、`featureName`、`outputs.scan`、`outputs.graph`、`outputs.lookup`、`outputs.report`
- 可选：`type`、`summary`、`areas`、`extractorAdapter`、`scanTargets`

### 注册表规范

- `featureKey`
- `featureName`
- `kbDir`
- `outputs`

### project-global 产物

- `project-memory/kb/project-global/scan.raw.json`
- `project-memory/kb/project-global/chain.graph.json`
- `project-memory/kb/project-global/chain.lookup.json`
- `project-memory/kb/project-global/build.report.json`
- `project-memory/state/project-protocols.json`

### 输出文件命名规范

- `chain.graph.json`
- `chain.lookup.json`
- `scan.raw.json`
- `build.report.json`

### 输出文件用途

- `scripts/query_kb.js`
  - purpose: 统一查询入口
  - useWhen: 遇到入口、事件、request、state、上下游链路问题时先运行
- `build.report.json`
  - purpose: 给人看的构建汇总、默认排查顺序和 KB 文件说明
  - useWhen: 刚构建完 KB，或不知道该查哪个文件时优先看
- `chain.lookup.json`
  - purpose: 查询索引
  - useWhen: 通常不要手读；只有调试查询或排查索引异常时才打开
- `chain.graph.json`
  - purpose: 图节点与边的底层事实
  - useWhen: 通常不要手读；只有确认边类型、节点 meta 或导出图时才打开
- `scan.raw.json`
  - purpose: 原始抽取结果
  - useWhen: 通常不要手读；只有怀疑 extractor 漏抓时才打开
- `project-protocols.json`
  - purpose: 项目级协议学习结果，包含 message / dispatcher / state / timing / phase / transition patterns
  - useWhen: 排查项目自定义消息路径、状态机、阶段推进和时序阻塞点时优先看

### feature-summary / build-report 自描述要求

- `query_kb.js --feature <key>` 返回的 `feature-summary` 必须包含：
  - `purpose`
  - `useWhen`
  - `defaultWorkflow`
  - `artifacts`
  - `examples`
- `build.report.json` 必须包含：
  - `kind`
  - `purpose`
  - `useWhen`
  - `defaultWorkflow`
  - `queryExamples`
  - `artifacts`
- `query_project_kb.js --root <repo-root>` 返回的 `project-summary` 必须包含：
  - `project`
  - `counts`
  - `builtWithSkill`
  - `protocolsSummary`
  - `examples`

### 升级兼容

- 允许读取旧字段 `key`、`name`、`outputDir`
- 允许读取旧注册表字段 `graphPath`、`lookupPath`
- 允许读取旧文件名 `graph.json`、`lookup.json`、`scan.json`、`report.json`
