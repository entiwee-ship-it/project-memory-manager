#!/usr/bin/env node

const { run } = require('../commands/diagnostics/diagnose-imports');

if (require.main === module) {
    try {
        run(process.argv.slice(2));
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    }
}

module.exports = { run };
