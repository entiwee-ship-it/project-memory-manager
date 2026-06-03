# Source Layout

`src/bin` files must stay thin. They load a command module, call `run(argv)`, and export `run`.

Command modules own argument parsing and user-facing output. Domain modules should not parse CLI arguments.

Use these ownership boundaries:

- lifecycle setup: `src/commands/lifecycle`
- build/discovery: `src/commands/build`
- query commands: `src/commands/query` and `src/query`
- MCP transport: `src/mcp`
- Cocos authoring: `src/commands/cocos` plus `src/extraction/cocos`
- maintenance: `src/maintenance`

Do not reintroduce compatibility wrappers under `scripts/`.
