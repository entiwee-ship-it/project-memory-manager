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
function acquireLock(lockFilePath, options = {}) {
    const { timeout = LOCK_TIMEOUT, wait = false } = options;
    const startTime = Date.now();
    
    // 确保锁目录存在
    ensureDir(path.dirname(lockFilePath));
    
    while (true) {
        try {
            // 尝试创建锁文件（原子操作）
            // 确保锁目录存在
ensureDir(path.dirname(lockFilePath));
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
                        console.warn(`[SKILL-WARN] 释放锁失败: ${lockFilePath}`);
                    }
                },
                info: lockInfo,
            };
        } catch (err) {
            // 锁文件已存在
            if (err.code === 'EEXIST') {
                // 检查锁是否过期
                try {
                    const lockContent = fs.readFileSync(lockFilePath, 'utf8');
                    const lockInfo = JSON.parse(lockContent);
                    const lockTime = new Date(lockInfo.startTime).getTime();
                    
                    if (Date.now() - lockTime > (lockInfo.timeout || LOCK_TIMEOUT)) {
                        // 锁已过期，强制删除
                        console.warn(`[SKILL-WARN] 检测到过期锁，将强制释放: ${lockFilePath}`);
                        try {
                            fs.unlinkSync(lockFilePath);
                            continue; // 重试
                        } catch {
                            // 删除失败，继续等待或报错
                        }
                    }
                } catch {
                    // 锁文件损坏，尝试删除
                    try {
                        fs.unlinkSync(lockFilePath);
                        continue;
                    } catch {
                        // 忽略
                    }
                }
                
                if (wait) {
                    // 等待模式：轮询
                    if (Date.now() - startTime > timeout) {
                        throw new Error(
                            `[SKILL-DIAGNOSIS] 获取锁超时\n` +
                            `锁文件: ${lockFilePath}\n` +
                            `超时: ${timeout}ms\n\n` +
                            `可能原因:\n` +
                            `  1. 另一个进程正在执行相同操作\n` +
                            `  2. 之前的进程崩溃，未释放锁\n\n` +
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
                    throw new Error(
                        `[SKILL-DIAGNOSIS] 无法获取锁，另一个操作正在进行中\n` +
                        `锁文件: ${lockFilePath}\n\n` +
                        `可能原因:\n` +
                        `  1. 另一个 AI/进程正在构建 KB\n` +
                        `  2. 之前的操作异常退出，未清理锁\n\n` +
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
 * @param {string} root - 项目根目录
 * @param {string} operation - 操作名称
 * @returns {string} 锁文件路径
 */
function getProjectLockPath(root, operation = 'build') {
    return path.join(root, 'project-memory', '.locks', `${operation}.lock`);
}

/**
 * 使用锁执行操作
 * @param {string} lockPath - 锁文件路径
 * @param {Function} operation - 要执行的操作
 * @param {Object} options - 选项
 * @returns {any} 操作结果
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
    LOCK_TIMEOUT,
};


