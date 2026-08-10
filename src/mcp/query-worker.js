'use strict';

const { parentPort, threadId } = require('node:worker_threads');
const { executeQuery: executeProjectQuery } = require('../commands/query/query-project');
const { executeQuery: executeFeatureQuery } = require('../query/query-chain');

const queryRunners = {
    'query-project.js': executeProjectQuery,
    'query-feature.js': executeFeatureQuery,
};

function serializeError(error) {
    return {
        message: error instanceof Error ? error.message : String(error),
        code: error?.code || '',
        stack: error instanceof Error ? error.stack || '' : '',
    };
}

parentPort.on('message', request => {
    const startedAt = Date.now();
    try {
        const runner = queryRunners[request.scriptName];
        if (!runner) {
            throw new Error(`Unsupported query script: ${request.scriptName}`);
        }
        const execution = runner(
            Array.isArray(request.argv) ? request.argv : [],
            request.executionOptions || {}
        );
        parentPort.postMessage({
            id: request.id,
            ok: true,
            payload: execution.payload,
            elapsedMs: Date.now() - startedAt,
            threadId,
        });
    } catch (error) {
        parentPort.postMessage({
            id: request.id,
            ok: false,
            error: serializeError(error),
            elapsedMs: Date.now() - startedAt,
            threadId,
        });
    }
});
