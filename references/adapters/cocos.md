# Cocos 适配器

## 使用场景

- 当前端区域是 Cocos Creator 项目时使用
- 当 prefab 绑定、组件脚本、`.meta` UUID、nested prefab override 是主要入口时使用

## 关注点

- prefab 根节点
- prefab 节点路径
- 自定义组件
- 脚本 `.ts.meta` UUID 与组件类型的映射
- 资源 `.meta` UUID 与 `SpriteFrame / Prefab / AudioClip / JsonAsset` 的映射
- serialized field 的节点 / 组件 / 资源引用
- nested prefab override
- click / toggle / 列表渲染事件绑定
- VM 路径
- 事件总线链路

## 当前能力

当前抽取器已经支持读取 Cocos prefab 与 TypeScript 脚本，并补充了以下前端语义：

- auto 模式下，如果 `methodRoots` / `assetRoots` 指向 `assets/` 或 `oops-plugin-framework/assets` 结构，即使没有 prefab 输入，也会优先选择 `cocos` 适配器
- `db://assets/...` 与 `db://oops-framework/...` 导入解析
- 跨文件静态 API 调用，例如 `PayApi.getOrderPayment()`、`UserApi.login()` 的 `calls` 建边
- 前端 HTTP 请求抽取，当前支持：
  - `HttpClient.getInstance().get/post/put/delete(url, ...)`
  - `HttpClient.getInstance().request({ url, method, ... })`
  - `fetch(url, init?)`
  - `axios.get/post/put/delete(url, ...)`
  - `axios.request({ url, method, ... })`
  - `axios({ url, method, ... })`
- 读取 `.ts.meta`，把 prefab 里的脚本组件 `__type__` / event `_componentId` 还原成真实脚本
- 读取通用资源 `.meta` 与 `subMetas`，把 prefab 里的 `__uuid__` 还原成真实资源路径
- 识别 prefab 中的：
  - 组件挂载：脚本挂在哪个节点上
  - 字段绑定：脚本字段当前引用的是节点、组件、资源还是普通值
  - nested prefab override：字段绑定其实落在嵌套预制体的哪个组件上
  - 事件绑定：按钮 / Toggle / 列表事件最终绑到哪个脚本方法

### 结构化语义摘要（v0.16.0+）

启用 `--enable-structured-summary` 后，Cocos 适配器会分析 TypeScript 方法体，提取：

- **操作序列**: filter, map, condition, loop, assignment, method_call, return
- **数据流**: 变量从输入到输出的流转路径
- **复杂度**: 自动评估为 low/medium/high

**使用场景**:
- 不读源码理解方法做什么："这个方法过滤了无效数据并渲染到列表"
- 语义查询："找到所有处理玩家数据并更新UI的方法"
- 快速定位业务逻辑："找到有复杂条件判断的方法"

**启用方式**:
```json
{
  "extractOptions": {
    "enableStructuredSummary": true
  }
}
```

**查询示例**:
```bash
# 查找使用 filter 的方法
node scripts/query_chain_kb.js --feature <key> --has-operation filter

# 查找数据流向 directionList 的方法
node scripts/query_chain_kb.js --feature <key> --data-flow-to "this.directionList"
```

## 绑定语义

这层最容易被 AI 搞混，所以现在的知识库会显式区分：

- `component-attachment`
  - 含义：某个脚本组件被挂到某个节点上
  - 应该改哪里：`prefab` 的组件列表
  - 不是：改脚本文件本身就能让它自动挂上去
- `node-reference`
  - 含义：脚本字段当前引用了某个节点
  - 应该改哪里：`prefab` 的 serialized field
- `component-reference`
  - 含义：脚本字段当前引用了某个组件
  - 应该改哪里：`prefab` 的 serialized field
- `asset-reference`
  - 含义：脚本字段当前引用了某个资源 UUID，例如 `SpriteFrame / Prefab / AudioClip`
  - 应该改哪里：`prefab` 的 serialized field
- `nested-prefab-override`
  - 含义：当前 prefab 没有直接持有目标组件，而是通过 override 指向 nested prefab 内部组件
  - 应该改哪里：当前 prefab 的 override 数据，而不是直接改嵌套脚本
- `event-handler`
  - 含义：Button / Toggle / ScrollView 的事件列表里挂了脚本方法
  - 应该改哪里：`prefab` 的事件配置

## 什么时候改脚本，什么时候改 prefab

- 想把脚本挂到另一个节点：改 `prefab`，不是改脚本
- 想把脚本字段改绑到另一个节点 / 组件 / 资源：改 `prefab` serialized field
- 想改默认行为、增加新字段、改方法逻辑：改脚本
- 想让编辑器里多一个可绑定字段：先改脚本定义，再去 `prefab` 里赋值
- 想改按钮点击后调用哪个方法：改 `prefab` 事件绑定
- 想改 nested prefab 内部某个目标组件的外部引用：优先看 override，而不是直接猜脚本

## 推荐查询

- `node scripts/query_kb.js --feature <feature-key>`
- `node scripts/query_kb.js --feature <feature-key> --type binding --name <field|handler>`
- `node scripts/query_kb.js --feature <feature-key> --type ui-node --name <node-path>`
- `node scripts/query_kb.js --feature <feature-key> --type asset --name <asset-name>`
- `node scripts/query_chain_kb.js --feature <feature-key> --downstream <binding-node-name>`
- `node scripts/cocos_authoring.js --feature <feature-key> --prefab <prefab-name> --intent profile`

## 创作辅助层

现在新增了 `scripts/cocos_authoring.js`，它不是只解释现状，而是给“新增功能时该怎么绑定”出规划，必要时还能直接应用修改。

第一版支持两类规划：

- 新增点击事件
  - 示例：
    - `node scripts/cocos_authoring.js --feature <feature-key> --prefab <prefab-name> --intent click-event --source-node <source-node> --target-component <target-component> --handler <method>`
- 新增字段绑定
  - 示例：
    - `node scripts/cocos_authoring.js --feature <feature-key> --prefab <prefab-name> --intent field-binding --component-node <component-node> --component <target-component> --field <field-name> --target-node <node-path>`
    - `node scripts/cocos_authoring.js --feature <feature-key> --prefab <prefab-name> --intent field-binding --component-node <component-node> --component <target-component> --field <field-name> --target-asset <asset-name>`

它当前会输出：

- 目标脚本组件是否已经挂到正确节点
- handler 方法是否已经存在，是否需要先改脚本
- 事件应该写入哪个 `clickEvents`
- 字段应该写回哪个 serialized field
- 当前 prefab 里已有的 click 绑定约定，作为项目级学习样本

如果你只是想先看某个 prefab 里“有哪些节点、哪些脚本、哪些可绑定字段、已有事件习惯”，可以直接运行：

- `node scripts/cocos_authoring.js --feature <feature-key> --prefab <prefab-name> --intent profile`

如果你要直接回答“Prefab 里这个节点 / 组件的具体索引是多少”“脚本字段有没有绑上”“Spine 组件到底挂在哪”，优先用 profile 的过滤参数，而不是写临时 Python：

- 节点定位：
  - `node scripts/cocos_authoring.js --feature <feature-key> --prefab <prefab-name> --intent profile --node <node-name> --json`
- 组件定位：
  - `node scripts/cocos_authoring.js --feature <feature-key> --prefab <prefab-name> --intent profile --component <component-name> --json`
- 字段绑定审计：
  - `node scripts/cocos_authoring.js --feature <feature-key> --prefab <prefab-name> --intent profile --component <component-name> --field <field-name> --json`

现在 `profile` 结果里会直接包含：

- `nodes[*].nodeIndex`
- `nodes[*].components[*].componentIndex`
- `components[*].componentKind`
- `specialComponents`
- `bindingAudit`
- `summary.bindingAudit.missing`

其中：

- `componentKind = spine` 会把 `sp.Skeleton` 这类组件显式标出来
- `bindingAudit.status = missing` 表示脚本字段已存在，但 prefab 里当前还没有绑定
- `bindingAudit.status = override-bound` 表示它不是普通 serialized field，而是 nested prefab override

## 推荐理解顺序

- 先看 `component-attachment`，确认脚本实际挂在哪个节点
- 再看 `binding` 节点，确认字段当前绑的是节点、组件还是资源
- 再看 `event-handler`，确认按钮 / Toggle / 列表事件到底调了哪个方法
- 如果目标节点来自 nested prefab，再顺着 `nested-prefab-override` 往下查

## 当前限制

- 动态拼接后的 URL 目前只保留原始表达式，不做跨变量求值
- `HttpClient.getInstance().request(config)` 这类“config 变量来自更早赋值”的场景，还不会反推出内层 `url/method`
- 还没有实现前后端自动联查；前端 `request` 节点与后端 `endpoint/route` 节点仍需分别查询
- 目前仍然是静态分析，不会真的打开 Cocos 编辑器去回放场景操作
- 对没有出现在 prefab 里的“潜在可绑定字段”，现在会通过 `bindingAudit` 报告它们是 `missing`，但不会自动假设目标节点或资源
