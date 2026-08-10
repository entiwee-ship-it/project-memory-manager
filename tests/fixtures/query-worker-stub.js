'use strict';

const { parentPort, threadId } = require('node:worker_threads');

parentPort.on('message', request => {
    if (request.scriptName === 'crash') {
        process.exit(17);
    }
    const delayMs = request.scriptName === 'delay' ? Number(request.argv?.[0] || 0) : 0;
    setTimeout(() => {
        parentPort.postMessage({
            id: request.id,
            ok: true,
            payload: {
                scriptName: request.scriptName,
                argv: request.argv,
                threadId,
            },
            elapsedMs: delayMs,
            threadId,
        });
    }, delayMs);
});
