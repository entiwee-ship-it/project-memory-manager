const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const {
    getKimiSkillDirCandidates,
    findKimiSkillDirs,
    parseArgs,
} = require('../src/maintenance/install-kimi');

/**
 * 创建一个假的用户主目录，用于隔离文件系统探测。
 */
function createFakeHome() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-install-kimi-'));
}

/**
 * 校验候选目录的顺序和空主目录处理。
 *
 * 前两项必须是当前实际使用的安装位置，否则安装脚本会找不到已装好的技能。
 */
function testCandidateOrderPrefersCurrentLocations() {
    const candidates = getKimiSkillDirCandidates('C:/fake-home');
    assert.deepEqual(candidates, [
        path.join('C:/fake-home', '.kimi', 'skills'),
        path.join('C:/fake-home', '.kimi-code', 'skills'),
        path.join(
            'C:/fake-home',
            'AppData',
            'Roaming',
            'Trae CN',
            'User',
            'globalStorage',
            'moonshot-ai.kimi-code',
            'bin',
            'kimi',
            '_internal',
            'kimi_cli',
            'skills'
        ),
        path.join('C:/fake-home', '.config', 'kimi', 'skills'),
    ]);
    assert.deepEqual(getKimiSkillDirCandidates(''), [], '无法确定主目录时不应返回候选路径');
}

/**
 * 校验发现逻辑返回全部已存在的目录，而不是只返回第一个。
 *
 * 本机同时安装了多个 Kimi 客户端，只取首个命中目录会导致另一个副本长期不更新。
 */
function testDiscoveryReturnsEveryExistingDir() {
    const home = createFakeHome();
    try {
        fs.mkdirSync(path.join(home, '.kimi', 'skills'), { recursive: true });
        fs.mkdirSync(path.join(home, '.kimi-code', 'skills'), { recursive: true });

        const found = findKimiSkillDirs(home);
        assert.deepEqual(found, [
            path.join(home, '.kimi', 'skills'),
            path.join(home, '.kimi-code', 'skills'),
        ]);

        // 未创建的候选目录不得出现在结果里。
        assert.equal(
            found.some((dir) => dir.includes('Trae CN')),
            false,
            '不存在的候选目录不应被返回'
        );
    } finally {
        fs.rmSync(home, { recursive: true, force: true });
    }
}

/**
 * 校验命令行参数解析，重点是错误提示里承诺过的 --skills-dir。
 */
function testParseArgsSupportsSkillsDir() {
    const args = parseArgs(['--update', '--dry-run', '--skills-dir', '.', '--skills-dir', 'sub']);
    assert.equal(args.update, true);
    assert.equal(args.force, false);
    assert.equal(args.dryRun, true);
    assert.equal(args.skillsDirs.length, 2, '--skills-dir 必须可以重复传入');
    assert.equal(args.skillsDirs[0], path.resolve('.'));
    assert.equal(args.skillsDirs[1], path.resolve('sub'));

    // 缺少路径值时不应吞掉后续参数，也不应产生空路径。
    assert.deepEqual(parseArgs(['--skills-dir']).skillsDirs, []);
    assert.deepEqual(parseArgs([]).skillsDirs, []);
    assert.equal(parseArgs(['--force']).force, true);
}

testCandidateOrderPrefersCurrentLocations();
testDiscoveryReturnsEveryExistingDir();
testParseArgsSupportsSkillsDir();
console.log('install-kimi path validation passed');
