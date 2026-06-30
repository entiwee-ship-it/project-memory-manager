# PMM v0.80 AI 自检与自愈设计

## 目标

PMM v0.80 的目标是让 AI 在使用 PMM 前先完成一次可解释、可执行的环境自检，并在发现问题时返回明确的修复动作。这个版本重点解决“AI 不知道当前 PMM 是否真的可用”的问题，包括 MCP 进程版本滞后、已安装 skill 与源码版本不一致、共享数据根定位错误、项目 KB 过期、workspace registry 缺失或异常等场景。

最终体验应该是：AI 接到开发任务后先调用一个高层入口，拿到 `health`、`findings`、`repairPlan`、`nextAction` 和必要命令。状态正常时继续进入 `prepare_agent_brief`；状态异常时先按修复计划执行或提示用户重启/重建，而不是绕过 PMM 直接读源码。

## 背景证据

当前 PMM 项目已经发布到 v0.71，但本次会话里暴露了两个典型问题：

- 本地源码和已安装 skill 已是 v0.71，当前 Codex 会话里的 MCP 工具列表仍像旧进程，缺少 v0.71 新增的 registry 诊断工具。
- PMM 自身 project-global KB 仍由 `project-memory-manager@0.30.2` 构建，当前源码是 v0.71，freshness 返回 `stale`，并提示新增和修改了大量源码文件。

这些问题对人类可解释，但对 AI 来说容易导致错误路径：它可能相信旧 MCP 的状态、误以为工具不存在、或跳过 stale 门禁。v0.80 应把这些判断变成产品能力。

## 方案选择

推荐采用“统一 Agent Preflight”方案。

备选方案一是只增强现有诊断命令，例如扩展 `get_current_state`、`diagnose_data_root` 和 `check_kb_freshness`。优点是改动小，缺点是 AI 仍要自己拼接多个工具结果，仍容易漏掉版本漂移和下一步动作。

备选方案二是新增统一的 `agent_preflight` / `prepare_agent_environment` 能力。它聚合版本、MCP 能力、数据根、workspace registry、freshness、历史记忆和修复建议，输出一个 AI 可直接消费的健康报告。优点是最符合“给 AI 用”的方向，缺点是需要新增结构化诊断模型和更多测试。

备选方案三是做完整自动修复，包括自动重建 KB、自动安装 skill、自动改 MCP 配置、自动重启 Codex。优点是最省心，缺点是会碰到权限、会话生命周期和用户环境安全边界，不适合作为第一版默认行为。

v0.80 选择方案二，并保守吸收方案三的一部分：只自动执行安全动作，例如注册 workspace、诊断数据根、重建 KB；需要用户介入的动作，例如重启 Codex、修改 MCP 配置、重新安装 skill，只返回明确指令和原因。

## 架构

新增一个 Agent 环境健康层，放在 `src/agent/` 下，避免把诊断逻辑继续堆进 MCP server。

建议模块：

- `src/agent/environment-health.js`：采集 PMM 运行环境指纹，生成健康诊断和修复计划。
- `src/commands/agent/agent-preflight.js`：CLI 命令实现，负责参数解析、JSON 输出和 exit code。
- `src/bin/agent-preflight.js`：薄入口。
- `src/mcp/server.js`：新增 MCP 工具定义和 handler，把核心逻辑委托给 agent 模块。
- `src/agent/context-pack.js` 或 `src/agent/execution-loop.js`：在高层 agent brief 入口中接入 preflight 摘要，避免 AI 开发任务绕过健康检查。

已有模块保持职责：

- `src/shared/source-snapshot.js` 继续负责 source snapshot 和 freshness 结果。
- `src/shared/workspace-registry.js` 继续负责 workspace registry 的读写、解析和诊断。
- `src/commands/lifecycle/*` 继续负责 workspace 初始化、注册、拓扑检测和数据根诊断。

## 诊断模型

`agent_preflight` 返回统一 JSON：

```json
{
  "kind": "agent-preflight",
  "status": "ready | needs_action | blocked",
  "workspaceRoot": "...",
  "dataRoot": "...",
  "health": {
    "score": 0,
    "checks": []
  },
  "findings": [],
  "repairPlan": [],
  "nextAction": {
    "type": "continue | run_command | restart_codex | ask_user",
    "reason": "...",
    "command": "..."
  }
}
```

检查项按 `ok`、`warn`、`fail` 分级，并带稳定 `code`。v0.80 至少覆盖：

- `source_version_detected`：源码或安装包版本可识别。
- `mcp_runtime_version_detected`：MCP 运行版本可识别。
- `mcp_capability_match`：当前 MCP 是否暴露当前版本应有工具。
- `skill_installation_match`：已安装 skill 与源码版本是否一致。
- `workspace_registered`：workspace 是否登记到共享数据根。
- `data_root_consistent`：dataRoot、registry、manifest、memoryRoot 是否互相一致。
- `kb_freshness_ready`：project-global KB 是否 fresh。
- `task_memory_available`：agent outcomes / playbook 是否可读。

`findings` 面向 AI 和用户解释原因，`repairPlan` 面向 AI 执行动作。每个修复动作包含：

- `id`：稳定动作 ID。
- `title`：中文简短说明。
- `severity`：`info | warn | error`。
- `safeToAutoRun`：是否允许工具自动执行。
- `command`：可执行命令，若适用。
- `requiresUserAction`：是否需要用户重启 Codex 或确认配置。
- `afterAction`：执行后建议再次调用的工具。

## 行为

CLI 入口：

```powershell
node src/bin/agent-preflight.js --workspace-root <project-root> --data-root <pmm-data-root> --task "..." --json
```

MCP 入口：

- `agent_preflight`：只诊断并返回修复计划，不执行修复。
- `prepare_agent_brief`：内部先调用轻量 preflight；如果状态是 `blocked`，直接返回 preflight 结果和下一步动作；如果是 `needs_action` 且动作可自动执行，则提示推荐动作；如果是 `ready`，继续生成原有 brief。

v0.80 不默认新增“全自动修复”MCP 工具。原因是自动安装 skill、修改 MCP 配置和重启 Codex 都涉及用户环境边界。重建 KB、注册 workspace 这类已有安全命令可以作为 repairPlan 命令返回，由 AI 或用户按需执行。

## 错误处理

诊断自身不能因为某个子检查失败而整体崩溃。单项失败应写入 `findings`，并尽量继续执行其他检查。

典型处理：

- MCP 运行版本无法识别：标记 `warn`，建议重启 Codex 或使用 CLI 验证源码版本。
- dataRoot 不存在：标记 `blocked`，建议先执行 `init_workspace`。
- registry 缺失但 manifest 存在：标记 `needs_action`，建议执行 `register_workspace`。
- KB stale：标记 `needs_action`，建议执行 `start_build_project_index(wait:true)` 或 CLI `build-project.js`。
- MCP 工具缺失但源码存在对应 handler：标记 `blocked`，建议重启 Codex，因为当前会话加载的是旧 MCP。

## 文档

需要更新：

- `README.md`：增加 Agent Preflight 作为 AI 任务起手式。
- `docs/user/mcp-first.md`：把 preflight 放在 `prepare_agent_brief` 之前。
- `docs/reference/cli.md`：增加 `agent-preflight.js`。
- `docs/reference/mcp-tools.md`：增加 `agent_preflight`。
- `docs/guides/troubleshooting.md`：增加“源码/skill/MCP 版本不一致”和“MCP 旧进程”排查。
- `SKILL.md`：升级后提示 AI 先用 preflight。

## 测试

新增 `tests/agent-preflight.test.js`，覆盖：

- clean ready：workspace 已注册、KB fresh、版本一致。
- stale KB：返回 `needs_action` 和 rebuild 命令。
- MCP capability mismatch：返回 `blocked` 和重启 Codex 建议。
- registry missing：返回 register workspace 修复建议。
- dataRoot missing：返回 init workspace 修复建议。
- 单项检查失败不会导致整体崩溃。

更新：

- `tests/mcp-server.test.js`：确认 `agent_preflight` 工具暴露且 schema 稳定。
- `tests/agent-context-pack.test.js` 或 `tests/agent-execution-loop.test.js`：确认 `prepare_agent_brief` 会携带 preflight 摘要。
- `tests/workspace-registry.test.js`：复用 registry 诊断 fixture。

最终验证命令：

```powershell
npm.cmd run test:agent
npm.cmd run test:mcp
npm.cmd run test:registry
npm.cmd run test:layout
node src/bin/validate-package.js .
```

如果实现触及 freshness 或 query 逻辑，再追加：

```powershell
npm.cmd run test:path
npm.cmd run test:source-layout
```

## 验收标准

- AI 可以通过一个入口判断 PMM 是否适合继续用于当前项目。
- 版本不一致、MCP 旧进程、KB stale、workspace registry 缺失都有稳定 code 和中文修复建议。
- `prepare_agent_brief` 不再在明显 blocked 的 PMM 环境下继续给出看似可用的旧上下文。
- CLI 与 MCP 输出字段一致，便于 Codex、Claude Code 或其他 Agent 复用。
- 不把 PMM 运行数据写入目标项目源码目录。
- 需要用户介入的动作不会被自动执行，只给出明确原因和步骤。

## 非目标

- 不在 v0.80 自动重启 Codex。
- 不自动修改用户 MCP 配置文件。
- 不引入后台守护进程。
- 不重新设计 workspace registry。
- 不把 query、freshness、registry 的核心实现迁移到新模块，只做聚合诊断和面向 AI 的输出。
