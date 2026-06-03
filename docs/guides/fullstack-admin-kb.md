# Fullstack Admin KB

For Vue/Express admin projects:

```powershell
node src/bin/build-project.js --workspace-root <project-root> --data-root <data-root> --json
node src/bin/discover-features.js --workspace-root <project-root> --data-root <data-root> --limit 300 --min-confidence low --json
node src/bin/build-feature.js --workspace-root <project-root> --data-root <data-root> --feature-key qyproject-admin --json
node src/bin/query-feature.js --workspace-root <project-root> --data-root <data-root> --feature qyproject-admin --request captcha --downstream --depth 5 --json
```

Expected fullstack chains include frontend API calls, Express routes, controller methods, services, and storage helpers when source facts are available.
