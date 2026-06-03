# Adapters

Topology adapters live in `src/adapters/topology`.

Extraction adapters live in `src/adapters/extract`.

Current adapter responsibilities:

- generic: broad JavaScript/TypeScript repository support.
- pinus: Pinus backend conventions.
- cocos: Cocos Creator asset, prefab, and script conventions.

Prefer adding adapter behavior behind the existing adapter interfaces instead of hardcoding project-specific logic in graph or query modules.
