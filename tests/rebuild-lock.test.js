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
 * 校验重建锁超时确实大于默认超时并留出余量。
 *
 * 实测 qyProject 全量重建约 170 秒，而 shared/lock 默认只有 60 秒。该超时现在只在
 * 无法判断持有进程存活时作为兜底判定，但仍需覆盖真实重建时长。
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
testAcquireRecordsRebuildTimeout();
console.log('rebuild lock validation passed');
