/**
 * 路径解析和 --root 参数测试
 * 确保脚本能正确处理 --root 参数，不依赖 process.cwd()
 */

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const repoRoot = path.resolve(__dirname, '..');
const { run: detectProjectTopology } = require('../scripts/detect_project_topology');
const { run: queryProjectKb } = require('../scripts/query_project_kb');
const { resolveProjectRoot, validateProjectRoot } = require('../scripts/lib/common');

// 创建临时测试项目
function createTempProject() {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-test-'));
    fs.mkdirSync(path.join(tempDir, 'project-memory', 'state'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'project-memory', 'kb', 'project-global'), { recursive: true });
    
    // 创建 feature-registry.json
    fs.writeFileSync(
        path.join(tempDir, 'project-memory', 'state', 'feature-registry.json'),
        JSON.stringify({ generatedAt: new Date().toISOString(), features: [] }, null, 2)
    );
    
    // 创建 project-profile.json
    fs.writeFileSync(
        path.join(tempDir, 'project-memory', 'state', 'project-profile.json'),
        JSON.stringify({ projectName: 'test-project', projectType: 'test' }, null, 2)
    );
    
    return tempDir;
}

// 清理临时项目
function cleanupTempProject(tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
}

// 捕获输出
function captureOutput(fn) {
    const logs = [];
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    
    console.log = (...args) => logs.push(['log', ...args]);
    console.warn = (...args) => logs.push(['warn', ...args]);
    console.error = (...args) => logs.push(['error', ...args]);
    
    try {
        const result = fn();
        return { result, logs };
    } finally {
        console.log = originalLog;
        console.warn = originalWarn;
        console.error = originalError;
    }
}

console.log('=== 路径解析测试 ===');

// 测试 1: resolveProjectRoot 应该能正确解析 --root 参数
console.log('\n1. 测试 resolveProjectRoot 函数...');
{
    const tempProject = createTempProject();
    try {
        // 从其他目录解析应该能找到项目根
        const resolved = resolveProjectRoot(tempProject);
        assert.strictEqual(resolved, tempProject, '应该正确解析项目根目录');
        console.log('   ✓ resolveProjectRoot 能正确解析 --root');
    } finally {
        cleanupTempProject(tempProject);
    }
}

// 测试 2: validateProjectRoot 应该验证 project-memory 结构
console.log('\n2. 测试 validateProjectRoot 函数...');
{
    const tempProject = createTempProject();
    try {
        // 有效项目应该通过验证
        assert.doesNotThrow(() => {
            validateProjectRoot(tempProject, { scriptName: 'test' });
        }, '有效项目应该通过验证');
        console.log('   ✓ validateProjectRoot 通过有效项目验证');
        
        // 无效项目应该抛出错误
        assert.throws(() => {
            validateProjectRoot(path.join(tempProject, 'nonexistent'), { scriptName: 'test' });
        }, /未找到有效的项目根目录/, '无效项目应该抛出错误');
        console.log('   ✓ validateProjectRoot 正确拒绝无效项目');
    } finally {
        cleanupTempProject(tempProject);
    }
}

// 测试 3: detectProjectTopology 应该将输出写入 --root 指定的目录
console.log('\n3. 测试 detectProjectTopology --root 参数...');
{
    const tempProject = createTempProject();
    // 删除已有的 profile，让脚本重新生成
    fs.unlinkSync(path.join(tempProject, 'project-memory', 'state', 'project-profile.json'));
    
    try {
        const originalCwd = process.cwd();
        process.chdir(os.tmpdir()); // 切换到其他目录
        
        try {
            detectProjectTopology(['--root', tempProject]);
            
            // 验证输出文件是否写入 --root 指定的目录
            const profilePath = path.join(tempProject, 'project-memory', 'state', 'project-profile.json');
            assert.strictEqual(fs.existsSync(profilePath), true, 'project-profile.json 应该写入 --root 目录');
            console.log('   ✓ detectProjectTopology 正确写入 --root 目录');
        } finally {
            process.chdir(originalCwd);
        }
    } finally {
        cleanupTempProject(tempProject);
    }
}

console.log('\n=== 所有路径解析测试通过！===');
