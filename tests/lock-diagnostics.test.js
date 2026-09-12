const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const { acquireLock, inspectLock, LOCK_TIMEOUT } = require('../src/shared/lock');

/**
 * 创建隔离的锁目录。
 */
function createLockDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-lock-diag-'));
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
 * 校验缺少有效时间戳的锁按过期处理，避免永久阻塞。
 */
function testLockWithoutValidTimestampIsTreatedAsExpired() {
    const dir = createLockDir();
    try {
        const lockPath = path.join(dir, 'rebuild.lock');
        fs.writeFileSync(
            lockPath,
            JSON.stringify({ pid: 1, startTime: 'not-a-date', timeout: LOCK_TIMEOUT })
        );

        const inspection = inspectLock(lockPath);
        assert.equal(inspection.expired, true);
        assert.match(inspection.reason, /有效时间戳/);

        const lock = acquireLock(lockPath, { wait: false });
        lock.release();
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

/**
 * 校验未过期的锁仍被判定为未过期，保持原有互斥语义。
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

testUnremovableStaleLockReportsReason();
testCorruptedLockIsReleasedAndReacquired();
testLockWithoutValidTimestampIsTreatedAsExpired();
testFreshLockIsNotExpired();
console.log('lock diagnostics validation passed');
