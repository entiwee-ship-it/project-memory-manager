# KB Schema

PMM writes graph, lookup, report, registry, and project protocol artifacts under the workspace data root.

Important artifacts:

- `state/project-profile.json`
- `state/feature-registry.json`
- `state/feature-candidates.json`
- `kb/project-global/chain.graph.json`
- `kb/project-global/chain.lookup.json`
- `kb/features/<feature-key>/chain.graph.json`
- `kb/features/<feature-key>/chain.lookup.json`
- `kb/features/<feature-key>/build.report.json`

Generated artifacts are rebuildable and should not be hand edited.
