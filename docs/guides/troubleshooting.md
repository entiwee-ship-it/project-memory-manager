# Troubleshooting

Check paths:

```powershell
node src/bin/diagnose-paths.js --workspace-root <project-root> --data-root <data-root>
```

Check imports:

```powershell
node src/bin/diagnose-imports.js --root <project-root> --file <script-file>
```

Check package health:

```powershell
node src/bin/validate-package.js .
npm run test:source-layout
```

If MCP tools still call old paths, update Codex config to `src/bin/mcp.js` and restart Codex.

## MCP 旧进程或版本漂移

AI 开发任务开始前先调用 `agent_preflight`。MCP 暂不可用时用 CLI 兜底：

```powershell
node src/bin/agent-preflight.js --workspace-root <project-root> --data-root <pmm-data-root> --task "修复登录接口" --json
```

按返回的 `status` 和 `findings` 处理：

- `mcp_capability_mismatch`：通常是 Codex 仍在使用旧 MCP 进程。保存当前工作后重启 Codex，让 MCP tool 列表重新加载。
- `kb_freshness_not_ready`：先重建目标项目 KB，再重新运行 preflight。

```powershell
node src/bin/rebuild-kbs.js --workspace-root <project-root> --data-root <pmm-data-root>
```

- skill 安装问题：重新安装 skill，然后重启 Codex。

```powershell
npx skills remove project-memory-manager -g -a codex -y
npx skills add https://github.com/entiwee-ship-it/project-memory-manager.git --skill project-memory-manager -g -a codex -y --full-depth
```

重启 Codex、修改 MCP 配置、重装 skill 都需要用户确认并手动完成；PMM 只返回 `repairPlan` 和 `nextAction`，不会自动执行这些动作。
