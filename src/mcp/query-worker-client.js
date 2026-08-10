'use strict';

const path = require('node:path');
const { Worker } = require('node:worker_threads');

const DEFAULT_WORKER_PATH = path.join(__dirname, 'query-worker.js');
const DEFAULT_RESOURCE_LIMITS = {
    maxOldGenerationSizeMb: 1024,
    maxYoungGenerationSizeMb: 64,
};
const DEFAULT_IDLE_TIMEOUT_MS = 120000;

class QueryWorkerClient {
    constructor(options = {}) {
        this.workerPath = path.resolve(options.workerPath || DEFAULT_WORKER_PATH);
        this.resourceLimits = options.resourceLimits || DEFAULT_RESOURCE_LIMITS;
        this.workerOptions = options.workerOptions || {};
        this.idleTimeoutMs = Number.isFinite(options.idleTimeoutMs)
            ? Math.max(0, Math.floor(options.idleTimeoutMs))
            : DEFAULT_IDLE_TIMEOUT_MS;
        this.worker = null;
        this.idleTimer = null;
        this.queue = [];
        this.active = null;
        this.nextRequestId = 1;
        this.generation = 0;
        this.closed = false;
    }

    run(scriptName, argv, timeoutMs, executionOptions = {}) {
        if (this.closed) {
            return Promise.resolve(this.failureResult('Query worker is closed.', 0));
        }
        this.clearIdleTimer();
        return new Promise(resolve => {
            this.queue.push({
                id: this.nextRequestId++,
                scriptName,
                argv,
                executionOptions,
                timeoutMs,
                resolve,
            });
            this.drain();
        });
    }

    startWorker() {
        const worker = new Worker(this.workerPath, {
            ...this.workerOptions,
            resourceLimits: this.resourceLimits,
        });
        const generation = ++this.generation;
        worker.on('message', message => this.handleMessage(worker, generation, message));
        worker.on('error', error => this.handleWorkerFailure(worker, generation, error));
        worker.on('exit', code => this.handleWorkerExit(worker, generation, code));
        worker.unref();
        this.worker = worker;
        return worker;
    }

    drain() {
        if (this.closed || this.active) {
            return;
        }
        if (this.queue.length <= 0) {
            this.scheduleIdleStop();
            return;
        }
        this.clearIdleTimer();
        const reusedWorker = Boolean(this.worker);
        const worker = this.worker || this.startWorker();
        const job = this.queue.shift();
        const startedAt = Date.now();
        const timeout = setTimeout(() => {
            if (this.active?.id !== job.id) {
                return;
            }
            const elapsedMs = Date.now() - startedAt;
            this.active = null;
            this.worker = null;
            job.resolve({
                ...this.failureResult(`Query timed out after ${job.timeoutMs}ms`, elapsedMs),
                timedOut: true,
                workerReused: reusedWorker,
                workerGeneration: this.generation,
            });
            this.terminateWorker(worker).finally(() => this.drain());
        }, job.timeoutMs);
        this.active = {
            ...job,
            startedAt,
            timeout,
            worker,
            generation: this.generation,
            reusedWorker,
        };
        try {
            worker.postMessage({
                id: job.id,
                scriptName: job.scriptName,
                argv: job.argv,
                executionOptions: job.executionOptions,
            });
        } catch (error) {
            clearTimeout(timeout);
            this.active = null;
            if (this.worker === worker) {
                this.worker = null;
            }
            job.resolve({
                ...this.failureResult(error.message, Date.now() - startedAt),
                workerReused: reusedWorker,
                workerGeneration: this.generation,
            });
            this.terminateWorker(worker).finally(() => this.drain());
        }
    }

    handleMessage(worker, generation, message) {
        const active = this.active;
        if (!active || active.worker !== worker || active.generation !== generation || active.id !== message.id) {
            return;
        }
        clearTimeout(active.timeout);
        this.active = null;
        const elapsedMs = Date.now() - active.startedAt;
        if (message.ok) {
            active.resolve({
                ok: true,
                timedOut: false,
                elapsedMs,
                queryElapsedMs: message.elapsedMs,
                payload: message.payload,
                stdout: '',
                stderr: '',
                workerThreadId: message.threadId,
                workerReused: active.reusedWorker,
                workerGeneration: generation,
            });
        } else {
            active.resolve({
                ...this.failureResult(message.error?.message || 'Query worker failed.', elapsedMs),
                errorCode: message.error?.code || '',
                stack: message.error?.stack || '',
                queryElapsedMs: message.elapsedMs,
                workerThreadId: message.threadId,
                workerReused: active.reusedWorker,
                workerGeneration: generation,
            });
        }
        queueMicrotask(() => this.drain());
    }

    handleWorkerFailure(worker, generation, error) {
        if (this.worker === worker) {
            this.worker = null;
        }
        const active = this.active;
        if (active?.worker === worker && active.generation === generation) {
            clearTimeout(active.timeout);
            this.active = null;
            active.resolve({
                ...this.failureResult(error.message, Date.now() - active.startedAt),
                workerReused: active.reusedWorker,
                workerGeneration: generation,
            });
        }
        queueMicrotask(() => this.drain());
    }

    handleWorkerExit(worker, generation, code) {
        if (this.worker === worker) {
            this.worker = null;
        }
        const active = this.active;
        if (active?.worker === worker && active.generation === generation) {
            clearTimeout(active.timeout);
            this.active = null;
            active.resolve({
                ...this.failureResult(`Query worker exited with code ${code}.`, Date.now() - active.startedAt),
                workerReused: active.reusedWorker,
                workerGeneration: generation,
            });
        }
        queueMicrotask(() => this.drain());
    }

    failureResult(error, elapsedMs) {
        return {
            ok: false,
            timedOut: false,
            elapsedMs,
            error,
            stdout: '',
            stderr: '',
        };
    }

    clearIdleTimer() {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
    }

    scheduleIdleStop() {
        if (!this.worker || this.idleTimer || this.idleTimeoutMs <= 0) {
            return;
        }
        const worker = this.worker;
        this.idleTimer = setTimeout(() => {
            this.idleTimer = null;
            if (this.worker !== worker || this.active || this.queue.length > 0) {
                return;
            }
            this.worker = null;
            this.terminateWorker(worker);
        }, this.idleTimeoutMs);
        this.idleTimer.unref?.();
    }

    async close() {
        this.closed = true;
        this.clearIdleTimer();
        const queued = this.queue.splice(0);
        queued.forEach(job => job.resolve(this.failureResult('Query worker is closed.', 0)));
        if (this.active) {
            clearTimeout(this.active.timeout);
            this.active.resolve(this.failureResult('Query worker is closed.', Date.now() - this.active.startedAt));
            this.active = null;
        }
        const worker = this.worker;
        this.worker = null;
        if (worker) {
            await this.terminateWorker(worker);
        }
    }

    terminateWorker(worker) {
        return Promise.resolve(worker.terminate()).catch(() => undefined);
    }
}

const defaultQueryWorker = new QueryWorkerClient();

function runQueryWorker(scriptName, argv, timeoutMs, executionOptions = {}) {
    return defaultQueryWorker.run(scriptName, argv, timeoutMs, executionOptions);
}

module.exports = {
    DEFAULT_IDLE_TIMEOUT_MS,
    DEFAULT_RESOURCE_LIMITS,
    QueryWorkerClient,
    runQueryWorker,
};
