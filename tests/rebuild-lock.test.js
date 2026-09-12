const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const { acquireLock, LOCK_TIMEOUT } = require('../src/shared/lock');
const { REBUILD_LOCK_TIMEOUT } = require('../src/commands/lifecycle/rebuild-kbs');

/**
 * 创建隔离的锁目录。
 */
function createLockDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-rebuild-lock-'));
}

/**
 * 写入一个「已经被持有 ageMs 毫秒」的锁文件，用于模拟并发进程看到的锁状态。
 */
function writeHeldLock(lockPath, ageMs, timeout) {
    fs.writeFileSync(lockPath, JSON.stringify({
        pid: 999999,
        startTime: new Date(Date.now() - ageMs).toISOString(),
        timeout,
    }, null, 2));
}

/**
 * 校验重建锁超时确实大于默认超时并留出余量。
 *
 * 实测 qyProject 全量重建约 170 秒，而 shared/lock 默认只有 60 秒。
 */
function testRebuildLockTimeoutExceedsDefault() {
    assert.equal(LOCK_TIMEOUT, 60000, '默认锁超时发生变化，需要重新评估重建锁取值');
    assert.ok(
        REBUILD_LOCK_TIMEOUT > LOCK_TIMEOUT,
        `重建锁超时 ${REBUILD_LOCK_TIMEOUT} 必须大于默认 ${LOCK_TIMEOUT}`
    );
    assert.ok(
        REBUILD_LOCK_TIMEOUT >= 10 * 60 * 1000,
        '重建锁超时应留出足够余量，避免长时间重建被并发进程抢锁'
    );
}

/**
 * 行为验证：已持有 61 秒的锁在默认超时下会被抢走，在重建锁超时下必须仍然有效。
 *
 * 这正是修复前的问题——并发重建会在 60 秒后把仍在运行的锁判为过期并抢走。
 */
function testHeldLockSurvivesUnderRebuildTimeout() {
    const dir = createLockDir();
    try {
        const defaultLockPath = path.join(dir, 'default.lock');
        writeHeldLock(defaultLockPath, 61 * 1000, LOCK_TIMEOUT);
        const stolen = acquireLock(defaultLockPath, { wait: false });
        stolen.release();
        assert.equal(fs.existsSync(defaultLockPath), false, '默认超时下过期锁应被强制释放');

        const rebuildLockPath = path.join(dir, 'rebuild.lock');
        writeHeldLock(rebuildLockPath, 61 * 1000, REBUILD_LOCK_TIMEOUT);
        assert.throws(
            () => acquireLock(rebuildLockPath, { wait: false, timeout: REBUILD_LOCK_TIMEOUT }),
            /无法获取锁/,
            '重建锁在 61 秒后仍应有效，不能被并发进程抢走'
        );
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

/**
 * 校验重建路径传入的超时会被写入锁文件，且互斥和释放行为正常。
 */
function testAcquireRecordsRebuildTimeout() {
    const dir = createLockDir();
    try {
        const lockPath = path.join(dir, 'rebuild.lock');
        const lock = acquireLock(lockPath, { wait: false, timeout: REBUILD_LOCK_TIMEOUT });

        const recorded = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
        assert.equal(recorded.timeout, REBUILD_LOCK_TIMEOUT, '锁文件必须记录重建锁超时');
        assert.equal(recorded.pid, process.pid);

        // 锁被持有期间，第二次获取必须失败。
        assert.throws(() => acquireLock(lockPath, { wait: false }), /无法获取锁/);

        lock.release();
        assert.equal(fs.existsSync(lockPath), false, '释放后锁文件必须被删除');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

testRebuildLockTimeoutExceedsDefault();
testHeldLockSurvivesUnderRebuildTimeout();
testAcquireRecordsRebuildTimeout();
console.log('rebuild lock validation passed');
