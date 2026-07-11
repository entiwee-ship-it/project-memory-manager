# PMM Token ROI 修复设计

## 目标

本阶段把 PMM 从“能返回项目上下文”推进到“返回的上下文比直接源码检索更准、更小、更可执行”。修复完成后，中文开发任务应能稳定命中真实业务文件，历史任务只在存在明确相关性时进入 brief，MCP 默认输出受固定字符预算约束，同时保留 `detail=full` 作为诊断兼容入口。

本阶段的核心验收指标是 Token ROI，而不是新增更多查询能力：

- 中文验证码、麻将胡牌、登录会话任务的推荐文件 Top-N 必须包含真实入口和关键实现文件。
- 没有语义命中的节点不能只依靠 endpoint/method 类型奖励进入结果。
- 仅因“最近 30 天”而获得的历史任务不能被召回。
- compact MCP 输出必须显著小于完整领域对象，并保持文件、行号、方向、风险和下一步动作等可执行证据。
- `detail=full` 保持当前完整结构，避免破坏诊断和已有调用方。

## 当前问题与证据

对 `E:/xile-workspace/qyProject` fresh project-global KB 的三个真实任务进行 A/B 估算后，直接 `rg` 加关键源码约消耗 11,122 token；当前 PMM brief 加源码确认约消耗 28,038 token，约为直接方式的 2.5 倍。

已确认的典型问题：

- `prepare_task_context` 单次约 27,800 到 38,019 token。
- 精确 selector 查询仍约 8,650 到 16,672 token。
- 双向 `MaJiangBaseView.onMJHu` 查询约 117,225 token。
- “转转麻将胡牌特效”推荐大量扑克玩法文件。
- “后台验证码链路”推荐 DELETE/game/activity API，真实 captcha 文件未进入前列。
- 历史 brief 混入大厅动画、赠送活动等弱相关任务。
- outcome 原始 `confidence=high` 被检索相关性分数覆盖为 `low`。

根因位于四个边界：

1. `src/agent/context-pack.js` 和 `src/agent/memory-recall.js` 只按 ASCII 分隔符提取词，中文连续文本被丢弃。
2. `scoreNode()` 在零任务词命中时仍为 endpoint/request/method 增加类型奖励。
3. `scoreRecord()` 对最近任务无条件加分，且 `score > 0` 即召回。
4. `src/agent/output-projection.js` 只压缩少数 Agent 工具，通用 query 和多个执行闭环工具仍返回完整对象。

## 方案

### 1. 共享任务词解析

新增 `src/agent/task-terms.js`，统一承担自然语言任务词提取和确定性别名扩展。模块不引入向量数据库或第三方分词器，继续使用可解释、可测试的规则：

- 提取英文标识符、路径、HTTP 路径和 CJK 连续片段。
- 对 CJK 片段生成 2 到 4 字 n-gram，保留完整片段。
- 过滤“完整、调用链、梳理、查找、修改、修复、问题”等低信息词。
- 将 `cms-client`、`cms-server`、`handler`、`http` 等范围词标记为低权重，而不是让它们主导排序。
- 确定性扩展常用业务别名：验证码、胡牌、特效/动画、麻将、转转、Pinus、会话和登录游戏服。

返回结构保持可解释：

```json
{
  "raw": "后台验证码链路",
  "normalized": "后台验证码链路",
  "terms": [
    { "value": "验证码", "weight": 3, "source": "cjk" },
    { "value": "captcha", "weight": 4, "source": "alias" }
  ]
}
```

`context-pack.js` 与 `memory-recall.js` 共用该模块，避免两套分词规则再次漂移。

### 2. 有效命中门禁与排序

`scoreNode()` 改为先计算任务词命中分，再决定是否追加节点类型奖励：

- 没有任何有效任务词命中时返回 0。
- 精确名称、文件路径、HTTP 路径和别名命中权重高于范围词。
- endpoint/request/method 类型奖励只用于同相关性候选的次级排序。
- 同分时优先更多高权重命中，再按稳定名称排序。

历史任务召回采用相同门禁：

- 任务词或已知文件至少有一个有效命中，才能进入 recalledTasks。
- 最近时间只作为已有语义命中的微弱 tie-breaker，不能独立产生相关性。
- 默认只保留高于最小相关性阈值的记录。
- 原始结果置信度输出为 `outcomeConfidence`，检索相关性输出为 `relevanceConfidence`，不再复用 `confidence` 覆盖业务记录。

### 3. Compact 投影

扩展 `src/agent/output-projection.js`，让以下 MCP 工具默认经过紧凑投影：

- `prepare_task_context`
- `analyze_change_impact`
- `plan_task_execution`
- `validate_edit_scope`
- `review_patch_for_agent`
- `recall_task_memory`
- `summarize_project_memory`
- `query_project_chain`
- `query_feature_chain`

compact 输出遵循“保留动作证据，删除重复元数据”的原则：

- 节点只保留 `id/type/name/file/line/area` 和协议相关的少量字段。
- 边只保留 `direction/depth/type/sourceKind/from/to`。
- 不重复返回完整 `node`、`resolvedStart.meta`、tags、完整 artifact 列表和 source snapshot。
- 文本、观察、风险和错误流统一截断。
- 数组采用固定上限，并在 `_output` 中声明 `truncated` 和 `fullDetail`。

默认字符预算：

| 工具 | compact 最大字符数 |
| --- | ---: |
| `prepare_agent_brief` | 4,000 |
| `prepare_task_context` | 6,000 |
| `analyze_change_impact` | 6,000 |
| `plan_task_execution` | 6,000 |
| `validate_edit_scope` | 6,000 |
| `review_patch_for_agent` | 6,000 |
| `recall_task_memory` | 6,000 |
| `summarize_project_memory` | 6,000 |
| `query_project_chain` | 6,000 |
| `query_feature_chain` | 6,000 |

预算通过结构化裁剪实现，不对最终 JSON 字符串做破坏性截断。若仍超预算，依次收缩低优先级数组，直到满足预算。

### 4. MCP 接入与缓存

`src/mcp/server.js` 保持缓存完整 payload，只在返回 MCP 文本前调用 `projectAgentOutput()`。这样：

- compact 和 full 可以复用同一份完整缓存。
- `detail=full` 不会因为 compact 缓存丢失元数据。
- query 失败时只返回截断后的错误摘要，不泄漏大段 stdout/stderr、artifact 和 snapshot。

`runAgentProjectTool()`、memory 工具和 project/feature query 工具都必须统一接入投影。CLI 领域函数保持完整输出，避免把 MCP token 策略侵入核心数据模型。

## 文件边界

- 新增 `src/agent/task-terms.js`：任务词、CJK n-gram、权重、别名和停用词。
- 修改 `src/agent/context-pack.js`：使用共享任务词并增加有效命中门禁。
- 修改 `src/agent/memory-recall.js`：共享任务词、相关性阈值、recent tie-break、置信度拆分。
- 修改 `src/agent/output-projection.js`：新增 Agent/Memory/Query compact 投影和预算收缩。
- 修改 `src/mcp/server.js`：所有目标工具统一经过 projection，完整 payload 继续进入缓存。
- 修改 `tests/agent-token-efficiency.test.js`：中文召回、历史隔离、置信度和字符预算回归。
- 修改 `tests/mcp-server.test.js`：query compact/full 兼容和错误输出回归。
- 修改 `package.json`：新增 `test:token-roi` 并纳入 `test:agent`/`test:all`。
- 修改 `CHANGELOG.md`、`README.md`、`SKILL.md` 和 MCP 参考文档：说明默认 compact、`detail=full` 和中文任务行为。

## 测试设计

确定性 fixture 基于 `tests/fixtures/admin-fullstack-sample`，测试运行时复制到临时 workspace 并补充干扰文件：

- 多个 game/activity DELETE API，验证 captcha 不被范围词和 endpoint 类型奖励压制。
- 最小 `LoginView`、`GameSessionMgr`、`pkcon.handler.doLogin` 链。
- 最小 `MaJiangBaseView.onMJHu`、转转麻将 handler/effect 链和扑克动画干扰文件。
- 两条历史 outcome：一条与当前任务明确相关，一条只满足“最近任务”。

必须先观察失败再实现，验收断言包括：

- “后台验证码链路” Top-8 包含 `authApi.js`、`Login.vue`、`authRoutes.ts`、`authController.ts`、`captchaService.ts`。
- “转转麻将胡牌特效”包含麻将 handler/base/effect 文件，不包含扑克干扰文件。
- “HTTP 登录到 Pinus 会话”包含 `LoginView`、`GameSessionMgr`、`pkcon` handler。
- 无关最近任务不进入 `recalledTasks`。
- outcome 的 `outcomeConfidence` 与 `relevanceConfidence` 分离。
- 每个目标 MCP compact 输出满足字符预算。
- 同一请求传 `detail=full` 时仍可看到完整结构和元数据。
- 精确 selector compact 保留起点、方向、紧凑边、文件和行号。

## 真实项目复测

自动测试通过后，重建 qyProject project-global KB，再用相同三个任务重新测量：

1. HTTP 登录到 Pinus 会话。
2. 转转麻将胡牌特效。
3. 后台验证码链路。

记录 compact 字符数、估算 token、Top-N 文件和是否需要额外源码纠偏。阶段成功标准：

- 三个任务关键文件命中率明显高于当前基线。
- PMM brief 加必要源码确认的总估算 token 不高于直接检索基线的 1.2 倍；若未达到，必须在交付中列出剩余噪声来源，不能宣称 Token ROI 已解决。
- 任一目标工具不得再出现十万字符级默认 compact 输出。

## 实测结果

2026-07-11 重建 qyProject project-global KB 后，fresh 快照包含 1,624 个脚本、18,033 个方法，导入解析为 6,308/8,307（76%）。三个真实任务的 compact 结果如下：

| 任务 | brief | context | 精确 query | 历史误召回 | 关键文件结果 |
| --- | ---: | ---: | ---: | ---: | --- |
| HTTP 登录到 Pinus 会话 | 3,874 chars / 969 token | 5,629 chars / 1,408 token | 4,959 chars / 1,240 token | 0 | `GameSessionMgr.ts`、`LoginViewComp.ts`、`pkcon/handler.ts`、`TokenManager.ts`、`UserApi.ts` |
| 转转麻将胡牌特效 | 3,772 chars / 943 token | 5,535 chars / 1,384 token | 5,060 chars / 1,265 token | 0 | `ZhuanZhuanMJViewComp.ts`、`PlayerHandComp.ts`、`EffectAniComp.ts`、`MaJiangBaseView.ts`、`MaJiangZz.ts` |
| 后台验证码链路 | 3,823 chars / 956 token | 5,655 chars / 1,414 token | 4,693 chars / 1,174 token | 0 | `Login.vue`、`authController.ts`、`authRoutes.ts`、`authApi.js`、`captcha.ts` |

源码确认采用每个关键实现点约 61 行的固定窗口，三项估算分别为 2,474、2,198、1,697 token。按“brief + 精确 query + 源码确认”口径，三任务总估算为 12,916 token，相对直接源码基线 11,122 token 为 1.16 倍，低于本阶段 1.2 倍验收线；相对修复前 PMM 加源码的 28,038 token 降低约 54%。

因此本阶段解决了“PMM 明显放大 token 且定位错误”的问题，并让项目理解、文件排序、历史隔离和 selector 链路具备实际帮助，但尚不能宣称已经形成绝对 token 节省。下一阶段应继续减少精确 query 与源码确认的重复内容，目标是把同口径总量压到直接源码基线以下。

## 非目标

- 不引入向量数据库、embedding 或外部模型调用。
- 不新增语言适配器或重写图构建器。
- 不改变 CLI 默认完整领域输出。
- 不删除 `detail=full`。
- 不借机重构 `query-chain.js` 的全部历史结构。
- 不把 PMM 运行数据写入源码仓库。
