# PMM Usage Experience v0.26 Design

## Goal

Improve PMM query ergonomics for the latest qyProject usage report: fullstack traces should reach HTTP handlers without manual depth tuning, prefab impact analysis should answer batch usage questions, broad login/auth queries should be grouped, and safe skipped calls should remain visible when requested.

## Scope

- Add `mode=fullstack` / `fullstack=true` and `focus` query controls.
- Add `type=prefab-script-usage` for batch prefab script impact.
- Add `detail=counts` plus clearer limit metadata for prefab/script summaries.
- Add grouped recommendations for broad `type/name` searches.
- Preserve unresolved external/member calls as opt-in traversal facts.
- Improve Express route callback endpoints so inline game-server handlers produce a synthetic handler method.

## Architecture

Query ergonomics stay in `src/query/query-chain.js`: traversal depth adjustment, focus filtering, grouped search output, prefab batch summaries, and detail shaping all operate on existing graph facts. MCP and CLI only forward new parameters.

Graph-building changes stay narrow in `src/extraction/extract-feature-facts.js` and `src/graph/build-chain-kb.js`: extractor marks unsafe member calls as unresolved facts and labels inline HTTP callbacks; graph builder creates `unresolved-call` nodes and handler callback edges.

## Behavior

- `--method Login.handleLogin --downstream --mode fullstack` expands far enough to include frontend API, request, endpoint, and controller.
- `--focus fullstack` returns the main API/HTTP/endpoint chain first and folds same-file helpers into `relatedHelpers`.
- `--type prefab-script-usage --file <prefab>` returns every custom script mounted on that prefab and all prefab usage for each script.
- `--detail counts` returns counts and limit metadata only.
- Broad `--type endpoint --name login` can return grouped results with recommended narrowing parameters.
- `--include-unresolved` includes skipped external calls such as `redisClient.set` and `window.$requestService.resetAuthState`.

## Validation

Tests must cover fixture red/green behavior first. Final validation must run the PMM test suite, rebuild qyProject KB, and replay the latest usage report checks against `E:/xile-workspace/qyProject`.
