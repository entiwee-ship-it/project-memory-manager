# PMM Data Access Summary Design

## Goal

Codex should be able to answer "this endpoint or method touches which database tables" directly from a PMM chain query. PMM already extracts table nodes and `reads` / `writes` edges, so this version turns those existing graph facts into a first-class query summary.

## Scope

- Add `focus=data` for any traversal query to attach a `dataAccessSummary` over the current traversal range.
- Add `mode=fullstack-data` to combine fullstack traversal depth with the same data summary.
- Keep extraction and graph building unchanged in this iteration.
- Keep the normal `traversal` array unchanged so existing Codex/MCP consumers do not lose context.

## Result Shape

Traversal JSON may include:

```json
{
  "dataAccessSummary": {
    "kind": "data-access-summary",
    "counts": {
      "tables": 3,
      "reads": 1,
      "writes": 3,
      "accessEdges": 4,
      "actors": 1
    },
    "tables": [
      {
        "name": "goldenEggUserInfoTable",
        "importPath": "../../db/schema/activity/goldenEggUserInfoSchema",
        "reads": [{ "method": "goldenEgg.getGoldenEggReward", "operation": "from" }],
        "writes": [{ "method": "goldenEgg.getGoldenEggReward", "operation": "update" }]
      }
    ]
  }
}
```

## Non-Goals

- Do not infer dynamic table names or raw SQL table names here.
- Do not change persisted KB schema.
- Do not replace source verification when the KB is stale or the query result is ambiguous.

## Verification

- Fixture test must fail before implementation and pass after adding the summary.
- Full PMM test suite must pass.
- qyProject project-global KB must rebuild with the new version and return real data summaries for backend chains.
