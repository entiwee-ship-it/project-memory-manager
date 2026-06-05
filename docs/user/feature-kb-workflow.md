# 功能 KB 工作流

发现功能候选：

```powershell
node src/bin/discover-features.js --workspace-root <project-root> --data-root <data-root> --limit 300 --min-confidence low --json
```

构建单个功能 KB：

```powershell
node src/bin/build-feature.js --workspace-root <project-root> --data-root <data-root> --feature-key <key> --json
```

重建所有已知 KB：

```powershell
node src/bin/rebuild-kbs.js --workspace-root <project-root> --data-root <data-root>
```

功能 KB 应从源码事实重新生成，不要手工编辑生成文件。
