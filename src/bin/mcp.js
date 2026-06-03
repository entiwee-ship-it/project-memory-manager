#!/usr/bin/env node

const { run } = require('../mcp/server');

if (require.main === module) {
    run();
}

module.exports = { run };
