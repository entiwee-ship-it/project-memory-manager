# Feature KB Workflow

Discover candidates:

```powershell
node src/bin/discover-features.js --workspace-root <project-root> --data-root <data-root> --limit 300 --min-confidence low --json
```

Build one feature:

```powershell
node src/bin/build-feature.js --workspace-root <project-root> --data-root <data-root> --feature-key <key> --json
```

Rebuild all known KBs:

```powershell
node src/bin/rebuild-kbs.js --workspace-root <project-root> --data-root <data-root>
```

Feature KBs should be regenerated from source facts, not manually edited.
