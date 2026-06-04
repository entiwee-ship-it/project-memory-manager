# PMM Data Access Summary Plan

## Step 1: Red Test

- Add fixture assertions for `focus=data`.
- Add fixture assertions for `mode=fullstack-data`.
- Confirm the test fails because `dataAccessSummary` is missing.

## Step 2: Query Implementation

- Teach fullstack mode detection about `fullstack-data`.
- Add a data summary trigger for `focus=data` and `mode=fullstack-data`.
- Build the summary from traversal `reads` / `writes` edges where one side is a `table` node.
- Preserve the original traversal output.

## Step 3: Documentation

- Bump `skill-version.json` to `0.27.0`.
- Update changelog, CLI reference, MCP reference, query guide, README, and SKILL entrypoint.

## Step 4: Verification

- Run PMM test suite.
- Validate package layout.
- Rebuild qyProject project-global KB in external data root.
- Run real qyProject CLI and MCP data summary checks.

## Step 5: Release

- Commit with a Chinese commit message.
- Push directly to `main`.
