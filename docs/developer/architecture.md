# Architecture

PMM is a CommonJS Node application with MCP and CLI entrypoints.

Main layers:

- `src/bin`: executable wrappers.
- `src/commands`: CLI command implementations.
- `src/mcp`: MCP server.
- `src/extraction`: source and framework fact extraction.
- `src/graph`: graph building and feature KB helpers.
- `src/query`: query engine.
- `src/discovery`: feature candidate discovery.
- `src/adapters`: project topology and extractor adapters.
- `src/shared`: common filesystem, layout, lock, and path utilities.

The old flat `scripts/` directory is intentionally removed.
