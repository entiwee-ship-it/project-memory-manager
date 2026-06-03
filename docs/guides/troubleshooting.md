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
