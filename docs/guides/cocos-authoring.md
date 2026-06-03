# Cocos Authoring

Build the feature KB and authoring profile first:

```powershell
node src/bin/build-feature.js --workspace-root <project-root> --data-root <data-root> --feature-key <key>
node src/bin/build-cocos-authoring-profile.js --workspace-root <project-root> --data-root <data-root>
```

Inspect binding options:

```powershell
node src/bin/cocos-authoring.js --workspace-root <project-root> --data-root <data-root> --feature <key> --prefab <prefab-name> --intent profile
```

Plan a click event:

```powershell
node src/bin/cocos-authoring.js --workspace-root <project-root> --data-root <data-root> --feature <key> --prefab <prefab-name> --intent click-event --source-node <node> --target-component <component> --handler <method>
```
