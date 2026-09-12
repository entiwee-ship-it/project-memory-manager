/**
 * 简单的文件锁机制，防止并发操作冲突
 */

const fs = require('fs');
const path = require('path');

const LOCK_TIMEOUT = 60000; // 60秒超时

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

/**
 * 判断锁记录的持有进程是否仍然存活。
 *
 * @param pid 锁文件中记录的进程号。
 * @returns true 表示存活，false 表示已退出，null 表示无法判断。
 */
function isProcessAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) {
        return null;
    }
    try {
        // 信号 0 只做存在性探测，不会真正投递信号。
        process.kill(pid, 0);
        return true;
    } catch (error) {
        if (error.code === 'ESRCH') {
            return false;
        }
        // EPERM 等情况说明进程存在但当前用户无权发信号，按存活处理更安全。
        return true;
    }
}

/**
 * 读取锁文件并判断它是否已过期。
 *
 * 过期判定优先依据持有进程的存活状态：持有进程已退出说明锁是残留，可以立即回收；
 * 持有进程仍在运行则锁必须被尊重，否则超过声明超时的长时间操作会被并发进程抢锁。
 * 只有无法判断进程存活时才退回时间戳判定，避免永久阻塞。
 *
 * @param lockFilePath 锁文件路径。
 * @returns 判定结果。
 * @returns 判定结果.lockInfo 解析出的锁信息，无法解析时为 null。
 * @returns 判定结果.expired 锁是否已过期。
 * @returns 判定结果.reason 按过期处理的原因说明，正常解析且未过期时为空字符串。
 */
function inspectLock(lockFilePath) {
    let lockInfo = null;
    try {
        const lockContent = fs.readFileSync(lockFilePath, 'utf8');
        lockInfo = JSON.parse(lockContent);
    } catch (readError) {
        // 锁文件损坏或无法读取时按过期处理，但要保留原因，避免掩盖真实阻塞点。
        return {
            lockInfo: null,
            expired: true,
            reason: `锁文件无法读取或解析: ${readError.message}`,
        };
    }

    const ownerAlive = isProcessAlive(lockInfo.pid);
    if (ownerAlive === false) {
        return { lockInfo, expired: true, reason: `锁持有进程 ${lockInfo.pid} 已退出` };
    }
    if (ownerAlive === true) {
        // 持有进程仍在运行，锁继续有效。若进程实际卡死，诊断信息会给出 pid 和起始时间，
        // 由使用者判断是否手工删除锁文件。
        return { lockInfo, expired: false, reason: '' };
    }

    const lockTime = new Date(lockInfo.startTime).getTime();
    if (!Number.isFinite(lockTime)) {
        // 时间戳无效且无法判断持有进程时按过期处理，否则会永久阻塞。
        return { lockInfo, expired: true, reason: '锁文件缺少有效时间戳且无法判断持有进程' };
    }

    const lockTimeout = lockInfo.timeout || LOCK_TIMEOUT;
    return { lockInfo, expired: Date.now() - lockTime > lockTimeout, reason: '' };
}

/**
 * 尝试强制释放一个过期锁。
 *
 * @param lockFilePath 锁文件路径。
 * @returns 释放结果。
 * @returns 释放结果.released 是否成功删除锁文件。
 * @returns 释放结果.reason 释放失败的原因，成功时为空字符串。
 */
function forceReleaseLock(lockFilePath) {
    try {
        fs.unlinkSync(lockFilePath);
        return { released: true, reason: '' };
    } catch (unlinkError) {
        // 删除失败就是真实阻塞原因，必须向上传递，不能静默吞掉。
        return { released: false, reason: `强制释放过期锁失败: ${unlinkError.message}` };
    }
}

function acquireLock(lockFilePath, options = {}) {
    const { timeout = LOCK_TIMEOUT, wait = false } = options;
    const startTime = Date.now();

    // 确保锁目录存在
    ensureDir(path.dirname(lockFilePath));

    while (true) {
        try {
            // 尝试创建锁文件（原子操作）
            const fd = fs.openSync(lockFilePath, 'wx');
            const lockInfo = {
                pid: process.pid,
                startTime: new Date().toISOString(),
                timeout,
            };
            fs.writeSync(fd, JSON.stringify(lockInfo, null, 2));
            fs.closeSync(fd);

            return {
                release: () => {
                    try {
                        if (fs.existsSync(lockFilePath)) {
                            fs.unlinkSync(lockFilePath);
                        }
                    } catch (err) {
                        console.warn(`[SKILL-WARN] 释放锁失败: ${lockFilePath}（${err.message}）`);
                    }
                },
                info: lockInfo,
            };
        } catch (err) {
            // 锁文件已存在
            if (err.code === 'EEXIST') {
                const inspection = inspectLock(lockFilePath);
                let blockingReason = inspection.reason;

                if (inspection.expired) {
                    console.warn(`[SKILL-WARN] 检测到过期锁，将强制释放: ${lockFilePath}`);
                    const released = forceReleaseLock(lockFilePath);
                    if (released.released) {
                        continue; // 重试
                    }
                    blockingReason = released.reason;
                    console.warn(`[SKILL-WARN] ${blockingReason}`);
                }

                // 把真实阻塞原因写进诊断信息，避免把「过期锁释放失败」误报成并发冲突。
                const reasonBlock = blockingReason ? `\n阻塞原因:\n  ${blockingReason}\n` : '';
                // 锁仍有效时给出持有进程信息，便于区分正常并发与进程卡死。
                const holder = inspection.lockInfo;
                const holderBlock = holder && Number.isInteger(holder.pid)
                    ? `\n持有进程:\n  pid ${holder.pid}，起始 ${holder.startTime}\n`
                    : '';

                if (wait) {
                    // 等待模式：轮询
                    if (Date.now() - startTime > timeout) {
                        throw new Error(
                            `[SKILL-DIAGNOSIS] 获取锁超时\n` +
                            `锁文件: ${lockFilePath}\n` +
                            `超时: ${timeout}ms\n` +
                            reasonBlock +
                            holderBlock +
                            `\n可能原因:\n` +
                            `  1. 另一个进程正在执行相同操作\n` +
                            `  2. 之前的进程崩溃，未释放锁\n` +
                            `  3. 过期锁释放失败，见上方阻塞原因\n\n` +
                            `修复建议:\n` +
                            `  1. 等待其他操作完成后再试\n` +
                            `  2. 或手动删除锁文件: rm ${lockFilePath}`
                        );
                    }
                    // 等待 100ms 后重试
                    const endTime = Date.now() + 100;
                    while (Date.now() < endTime) {
                        // 忙等待
                    }
                    continue;
                } else {
                    // 非等待模式：立即报错
                    const headline = blockingReason
                        ? '无法获取锁：过期锁释放失败'
                        : '无法获取锁，另一个操作正在进行中';
                    throw new Error(
                        `[SKILL-DIAGNOSIS] ${headline}\n` +
                        `锁文件: ${lockFilePath}\n` +
                        reasonBlock +
                        holderBlock +
                        `\n可能原因:\n` +
                        `  1. 另一个 AI/进程正在构建 KB\n` +
                        `  2. 之前的操作异常退出，未清理锁\n` +
                        `  3. 过期锁释放失败，见上方阻塞原因\n\n` +
                        `修复建议:\n` +
                        `  1. 等待其他操作完成\n` +
                        `  2. 手动删除锁文件（如果确定无其他操作）: rm ${lockFilePath}\n` +
                        `  3. 使用 --wait 参数等待锁释放`
                    );
                }
            }

            throw err;
        }
    }
}

/**
 * 创建项目锁文件路径
 * @param root - 项目根目录
 * @param operation - 操作名称
 * @returns 锁文件路径
 */
function getProjectLockPath(root, operation = 'build') {
    return path.join(root, 'project-memory', '.locks', `${operation}.lock`);
}

/**
 * 使用锁执行操作
 * @param lockPath - 锁文件路径
 * @param operation - 要执行的操作
 * @param options - 选项
 * @returns 操作结果
 */
function withLock(lockPath, operation, options = {}) {
    const lock = acquireLock(lockPath, options);

    try {
        return operation();
    } finally {
        lock.release();
    }
}

module.exports = {
    acquireLock,
    getProjectLockPath,
    withLock,
    inspectLock,
    isProcessAlive,
    LOCK_TIMEOUT,
};
