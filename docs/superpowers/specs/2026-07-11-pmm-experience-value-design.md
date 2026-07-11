# PMM Experience Value Design

## 目标

本阶段不再以压缩 token 为首要目标，而是验证并提升 PMM 对真实代码开发的必要使用价值。PMM 必须在项目理解、开发安全、跨会话连续性和审查质量上产生可测量收益，不能仅凭功能数量、测试覆盖或输出体积宣称有用。

评测对象为 `E:/xile-workspace/qyProject` 的 12 个已完成历史任务。评测只读取源码、fresh KB 和外置 PMM 数据，不修改 qyProject 业务源码。历史任务答案只用于评测，不得进入正式查询逻辑。

## 成功标准

本阶段采用以下硬性验收线：

- 关键文件 Top-5 命中率至少 85%。
- 高风险任务不得漏掉核心调用方、接口端或数据表。
- 无关文件比例不超过 20%。
- PMM 执行计划至少 80% 可直接采用，不需要重新进行大范围搜索。
- 历史任务召回准确率至少 90%；没有相关历史时必须返回空结果。
- 跨会话恢复必须准确返回当前状态、已验证内容、剩余风险和下一步操作。
- 至少 75% 的任务中，PMM 路径比直接源码路径减少搜索轮次或纠偏次数。
- Token、输出字符数和耗时只作为次要指标，不得通过删除必要证据换取压缩。

任何一项硬指标未达到，都不能把本阶段标记为完成。最终报告必须明确说明 PMM 是否值得作为默认开发入口，以及哪些任务应跳过 PMM。

## 真实任务语料

语料覆盖六类任务，每类至少两个，共 12 个：

1. 游戏客户端 UI 与状态处理。
2. Pinus 游戏后端、登录和会话链路。
3. CMS 前后端 HTTP 接口链路。
4. 麻将或其他玩法规则与表现链路。
5. 配置、数据库或跨模块影响分析。
6. 跨会话恢复、改动范围复核和 patch review。

每个任务使用独立 JSON fixture，至少包含：

```json
{
  "id": "login-pinus-session",
  "task": "HTTP 登录到 Pinus 会话",
  "intent": "understand",
  "risk": "high",
  "requiredFiles": [],
  "acceptedFiles": [],
  "forbiddenDomains": [],
  "requiredEvidence": {
    "methods": [],
    "endpoints": [],
    "requests": [],
    "messages": [],
    "tables": []
  },
  "expectedValidation": [],
  "resumeExpectation": {
    "completed": [],
    "remainingRisks": [],
    "nextAction": ""
  }
}
```

`requiredFiles` 是完成任务不可缺少的核心文件；`acceptedFiles` 是合理但非必需的相关文件；其他推荐文件进入噪声计算。`forbiddenDomains` 用于识别扑克、活动、CMS 与游戏服等明显跨域污染。

## Experience Harness

新增独立的 `PMM Experience Harness`。Harness 运行于 PMM 仓库，所有临时工作目录和报告写入系统临时目录或 `.gitignore` 已覆盖的运行目录，不写入 qyProject，不写入正式 PMM outcome/playbook。

每个任务执行两条路径：

```text
直接源码路径
任务 -> 搜索 -> 阅读源码 -> 文件范围、调用链和执行计划

PMM 路径
任务 -> brief -> 必要时 context/selector -> 精确源码确认 -> 文件范围、调用链和执行计划
```

直接源码路径不是模拟完整 AI 推理，而是记录达到标准答案所需的确定性搜索步骤、读取文件和纠偏次数。PMM 路径记录实际 MCP/领域函数输出、后续 selector 次数和源码确认范围。两条路径使用同一标准答案评分。

Harness 输出单任务结果和汇总报告：

```json
{
  "taskId": "login-pinus-session",
  "fileMetrics": {
    "top5Recall": 1,
    "top10Recall": 1,
    "noiseRatio": 0.1
  },
  "evidenceCoverage": {
    "entrypoint": true,
    "implementation": true,
    "callers": true,
    "backend": true,
    "data": null,
    "validation": true
  },
  "workflowMetrics": {
    "searchRounds": 2,
    "selectorRounds": 1,
    "correctionRounds": 0,
    "planAdoptable": true
  },
  "memoryMetrics": {
    "expected": 0,
    "recalled": 0,
    "precision": 1
  },
  "resumeMetrics": {
    "statusComplete": true,
    "validationComplete": true,
    "riskComplete": true,
    "nextActionCorrect": true
  },
  "cost": {
    "chars": 0,
    "estimatedTokens": 0,
    "elapsedMs": 0
  }
}
```

汇总报告必须分别展示平均值和最差任务，避免高分任务掩盖高风险失败。

## 任务意图分类

新增确定性的 `classifyTaskIntent()`，返回以下模式之一：

- `understand`：解释模块、功能、调用链、状态流或数据流。
- `implement`：开发或修改功能，需要目标文件、编辑边界、依赖调用方和验证。
- `debug`：排查异常，需要现象入口、状态、配置、日志位置和可证伪假设。
- `resume`：跨会话继续，需要已完成内容、当前状态、未验证项、风险和第一步操作。
- `review`：提交前审查，需要越界、漏改、风险链路和测试缺口。
- `simple`：已知少量文件的低风险修改，只执行轻量 Usage Gate。

分类输入包括任务文本、显式文件、changed files 和调用工具。分类结果必须包含 `intent`、`confidence` 和可解释的 `reasons`。低置信度时默认使用 `implement`，但必须标记需要确认的缺口，不得通过猜测生成高置信度计划。

## 模式化 Brief

`prepare_agent_brief` 保持统一入口，但内部按 intent 组合不同信息：

- `understand`：功能边界、入口、核心链路、关键文件、事实缺口。
- `implement`：目标文件、编辑边界、调用方、风险、验证命令、历史经验。
- `debug`：症状入口、状态流、配置、日志位置、假设和证伪步骤。
- `resume`：已完成、已验证、未完成、剩余风险、第一步操作。
- `review`：changed files、影响范围、遗漏文件、风险和测试缺口。
- `simple`：Usage Gate、显式文件和最小验证，不生成完整 context。

历史 outcome、项目 playbook 和 fresh KB 事实必须分区输出：

```json
{
  "currentFacts": {},
  "historicalExperience": {},
  "projectRules": {}
}
```

历史经验不得进入 `currentFacts`，也不得单独提高当前源码结论的置信度。

## Readiness 与证据覆盖

所有模式化 brief 返回统一质量字段：

```json
{
  "intent": "implement",
  "readiness": "ready",
  "confidence": "high",
  "coverage": {
    "entrypoint": true,
    "implementation": true,
    "callers": true,
    "backend": true,
    "data": false,
    "validation": true
  },
  "missingEvidence": [],
  "sourceConfirmation": []
}
```

`readiness` 只能是：

- `ready`：核心证据完整，可以进入精确源码读取或实现。
- `needs_selector`：存在歧义，必须先运行推荐 selector。
- `needs_source_confirmation`：静态图无法确认动态调用、运行时配置或隐式关系。
- `blocked`：freshness、数据根、版本或必要输入未通过。

coverage 字段根据 intent 解释。与任务无关的维度使用 `null`，不能把“不适用”计为失败或成功。

## 失败处理

- KB 不是 `fresh`：返回 `blocked`，先重建，不生成源码结论。
- 多个同名入口：返回 `needs_selector`、候选和推荐 selector，不自行选择。
- 核心证据缺失：返回 `needs_source_confirmation` 和具体文件/原因。
- 推荐结果跨越明显无关领域：降低 readiness，不生成可执行计划。
- 高风险 implement/debug 任务未找到应有的后端、调用方或数据证据：在 `missingEvidence` 中列出。
- 历史记录只有弱词或宽目录命中：不召回。
- resume 无法证明状态来源：不输出确定的“已完成”结论。
- PMM 路径在体验 Harness 中比直接源码路径产生更多纠偏：记录失败类型，先增加回归用例，再修改生产逻辑。

## 实施结构

计划新增或调整以下职责边界：

- `tests/experience/fixtures/*.json`：12 个真实任务的评测答案。
- `tests/experience/pmm-experience-harness.test.js`：双轨执行和总体验合同。
- `src/agent/task-intent.js`：任务意图分类和解释。
- `src/agent/brief-readiness.js`：coverage、missingEvidence、sourceConfirmation 和 readiness 计算。
- `src/agent/memory-recall.js`：按 intent 控制历史经验进入 brief 的方式。
- `src/agent/output-projection.js`：模式化 compact 投影，不负责领域结论。
- `src/agent/context-pack.js`：根据意图和证据覆盖提供当前事实。
- `docs/reference/mcp-tools.md`、`README.md`、`SKILL.md`：记录模式、readiness 和 Usage Gate 合同。

Harness 评分代码与生产代码必须分离。生产代码不得导入 `tests/experience` 或评测标准答案。

## TDD 与验证

实施遵循失败驱动顺序：

1. 先建立 12 个 fixture 和 Harness。
2. 运行现有 PMM，保存未达标基线。
3. 每次只选择一个失败类别，写最小失败断言。
4. 修改最小生产逻辑使该类别通过。
5. 同时运行体验 Harness、Agent/MCP 定向测试和完整回归。
6. 重新构建 qyProject fresh KB 后复测真实任务。

发布前必须通过：

```powershell
npm run test:experience
npm run test:agent
npm run test:mcp
npm run test:all
node src/bin/validate-package.js .
git diff --check
```

还必须重建 PMM 自身 KB，运行 `validate_edit_scope` 和 `review_patch_for_agent`，并等待 GitHub Actions 成功。

## 非目标

- 不引入 embedding、向量数据库或外部 AI API。
- 不修改 qyProject 业务源码。
- 不继续以压缩 token 为主要优化方向。
- 不把历史任务答案、文件名或业务结论硬编码进生产评分。
- 不强制所有简单任务运行深度 PMM。
- 不用平均分掩盖高风险任务中的核心文件或链路遗漏。

## 最终决策输出

阶段结束时必须给出明确结论：

1. 哪些任务类型默认应该使用 PMM。
2. 哪些任务类型应该只走轻量 Usage Gate。
3. 哪些任务直接读源码更可靠。
4. 未达到的体验指标及其失败样本。
5. PMM 是否已经产生足够价值，值得保留为默认开发工具。
