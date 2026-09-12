const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

const { acquireLock, inspectLock, isProcessAlive, LOCK_TIMEOUT } = require('../src/shared/lock');

/**
 * 创建隔离的锁目录。
 */
function createLockDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-lock-diag-'));
}

/**
 * 返回一个确定已经退出的进程号，用于构造残留锁。
 */
function getExitedPid() {
    const child = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
    assert.ok(Number.isInteger(child.pid), '未能取得已退出子进程的 pid');
    return child.pid;
}

/**
 * 写入指定的锁内容。
 */
function writeLock(lockPath, lockInfo) {
    fs.writeFileSync(lockPath, JSON.stringify(lockInfo, null, 2));
}

/**
 * 校验进程存活探测的三种结果。
 */
function testProcessLivenessProbe() {
    assert.equal(isProcessAlive(process.pid), true, '当前进程必须判定为存活');
    assert.equal(isProcessAlive(getExitedPid()), false, '已退出的进程必须判定为已退出');
    assert.equal(isProcessAlive(0), null, '非法 pid 必须返回无法判断');
    assert.equal(isProcessAlive(undefined), null, '缺失 pid 必须返回无法判断');
}

/**
 * 校验持有进程已退出的锁被立即回收。
 *
 * 这是本次改动的核心：锁声明的超时远未到期，但持有进程已经退出。修复前该锁会一直
 * 阻塞到超时为止（重建锁为 30 分钟），现在可以立即回收。
 */
function testDeadOwnerLockIsReclaimed() {
    const dir = createLockDir();
    try {
        const lockPath = path.join(dir, 'rebuild.lock');
        writeLock(lockPath, {
            pid: getExitedPid(),
            startTime: new Date().toISOString(),
            timeout: 30 * 60 * 1000,
        });

        const inspection = inspectLock(lockPath);
        assert.equal(inspection.expired, true, '持有进程已退出时必须判定为过期');
        assert.match(inspection.reason, /已退出/);

        const lock = acquireLock(lockPath, { wait: false });
        assert.equal(JSON.parse(fs.readFileSync(lockPath, 'utf8')).pid, process.pid);
        lock.release();
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

/**
 * 校验持有进程仍存活的锁即使超过声明超时也继续有效。
 *
 * 修复前超时是唯一判据，长时间操作会在超时后被并发进程抢锁。
 */
function testLiveOwnerLockIsRespected() {
    const dir = createLockDir();
    try {
        const lockPath = path.join(dir, 'rebuild.lock');
        writeLock(lockPath, {
            pid: process.pid,
            startTime: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
            timeout: LOCK_TIMEOUT,
        });

        assert.equal(inspectLock(lockPath).expired, false, '持有进程存活时锁必须继续有效');

        assert.throws(
            () => acquireLock(lockPath, { wait: false }),
            (error) => {
                assert.match(error.message, /持有进程/, '诊断信息必须给出持有进程');
                assert.match(error.message, new RegExp(`pid ${process.pid}`));
                return true;
            }
        );
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

/**
 * 校验无法判断持有进程时退回时间戳判定，且超过超时后可以回收。
 */
function testUnknownOwnerFallsBackToTimeout() {
    const dir = createLockDir();
    try {
        const lockPath = path.join(dir, 'rebuild.lock');
        writeLock(lockPath, {
            pid: 0,
            startTime: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
            timeout: LOCK_TIMEOUT,
        });

        const inspection = inspectLock(lockPath);
        assert.equal(inspection.expired, true, '超过声明超时后必须按过期处理');
        assert.equal(inspection.reason, '');

        const lock = acquireLock(lockPath, { wait: false });
        lock.release();
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

/**
 * 校验无法判断持有进程且时间戳无效时按过期处理，避免永久阻塞。
 */
function testUnknownOwnerWithoutValidTimestampIsExpired() {
    const dir = createLockDir();
    try {
        const lockPath = path.join(dir, 'rebuild.lock');
        writeLock(lockPath, { pid: 0, startTime: 'not-a-date', timeout: LOCK_TIMEOUT });

        const inspection = inspectLock(lockPath);
        assert.equal(inspection.expired, true);
        assert.match(inspection.reason, /无法判断持有进程/);

        const lock = acquireLock(lockPath, { wait: false });
        lock.release();
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

/**
 * 校验过期锁删除失败时，诊断信息必须指出真实原因。
 *
 * 用目录占住锁路径可以稳定构造这条路径：openSync 报 EEXIST 进入「锁已存在」分支，
 * readFileSync 报 EISDIR 被判为过期，unlinkSync 报 EPERM/EISDIR 导致强制释放失败。
 * 修复前这里只会报「另一个操作正在进行中」，把删除失败误报成并发冲突。
 */
function testUnremovableStaleLockReportsReason() {
    const dir = createLockDir();
    try {
        const lockPath = path.join(dir, 'rebuild.lock');
        fs.mkdirSync(lockPath);

        assert.throws(
            () => acquireLock(lockPath, { wait: false }),
            (error) => {
                assert.match(error.message, /阻塞原因/, '诊断信息必须包含阻塞原因段落');
                assert.match(error.message, /强制释放过期锁失败/, '必须指出是释放过期锁失败');
                assert.match(error.message, /无法获取锁：过期锁释放失败/, '标题应区分于并发冲突');
                return true;
            }
        );
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

/**
 * 校验损坏的锁文件按过期处理、能被释放，并且不阻断后续获取。
 */
function testCorruptedLockIsReleasedAndReacquired() {
    const dir = createLockDir();
    try {
        const lockPath = path.join(dir, 'rebuild.lock');
        fs.writeFileSync(lockPath, '{ not json');

        const inspection = inspectLock(lockPath);
        assert.equal(inspection.expired, true);
        assert.match(inspection.reason, /无法读取或解析/);

        const lock = acquireLock(lockPath, { wait: false });
        assert.equal(JSON.parse(fs.readFileSync(lockPath, 'utf8')).pid, process.pid);
        lock.release();
        assert.equal(fs.existsSync(lockPath), false, '释放后锁文件必须被删除');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

/**
 * 校验正常持有的锁仍被判定为未过期。
 */
function testFreshLockIsNotExpired() {
    const dir = createLockDir();
    try {
        const lockPath = path.join(dir, 'rebuild.lock');
        const lock = acquireLock(lockPath, { wait: false });

        const inspection = inspectLock(lockPath);
        assert.equal(inspection.expired, false);
        assert.equal(inspection.reason, '');

        lock.release();
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

testProcessLivenessProbe();
testDeadOwnerLockIsReclaimed();
testLiveOwnerLockIsRespected();
testUnknownOwnerFallsBackToTimeout();
testUnknownOwnerWithoutValidTimestampIsExpired();
testUnremovableStaleLockReportsReason();
testCorruptedLockIsReleasedAndReacquired();
testFreshLockIsNotExpired();
console.log('lock diagnostics validation passed');
