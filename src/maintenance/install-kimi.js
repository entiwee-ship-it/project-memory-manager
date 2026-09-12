#!/usr/bin/env node
/**
 * Kimi CLI 技能安装/更新脚本
 * 
 * 自动将本技能安装到 Kimi CLI 的技能目录，
 * 支持首次安装和后续更新。
 * 
 * 使用方式:
 *   node src/bin/install-kimi.js [--update] [--force] [--dry-run] [--skills-dir <路径>]
 * 
 * 参数:
 *   --update                更新模式（拉取最新代码）
 *   --force                 强制重新安装（删除后重新克隆）
 *   --dry-run               预览模式，不实际执行
 *   --skills-dir <路径>     显式指定技能根目录，可重复传入多个
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REPO_URL = 'https://github.com/entiwee-ship-it/project-memory-manager.git';
const SKILL_NAME = 'project-memory-manager';

// 颜色输出
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

/**
 * 按优先级返回 Kimi CLI 可能的技能根目录。
 *
 * 前两项是当前实际使用的安装位置，后两项是旧版 Trae 内置目录和 XDG 风格目录，
 * 保留它们以兼容历史安装。同一台机器可能同时装有多个 Kimi 客户端，因此这里返回
 * 完整候选列表而不是第一个命中项。
 *
 * @param homeDir 用户主目录，默认取 USERPROFILE 或 HOME。
 * @returns 候选技能根目录列表，顺序即优先级；无法确定主目录时返回空列表。
 */
function getKimiSkillDirCandidates(homeDir = process.env.USERPROFILE || process.env.HOME || '') {
    if (!homeDir) {
        return [];
    }
    return [
        path.join(homeDir, '.kimi', 'skills'),
        path.join(homeDir, '.kimi-code', 'skills'),
        path.join(
            homeDir,
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
        path.join(homeDir, '.config', 'kimi', 'skills'),
    ];
}

/**
 * 返回本机所有已存在的 Kimi 技能根目录。
 *
 * @param homeDir 用户主目录，默认取 USERPROFILE 或 HOME。
 * @returns 已存在的技能根目录列表。
 */
function findKimiSkillDirs(homeDir) {
    return getKimiSkillDirCandidates(homeDir).filter((dir) => fs.existsSync(dir));
}

/**
 * 解析命令行参数。
 *
 * @param argv 命令行参数列表。
 * @returns 解析结果对象。
 * @returns 解析结果.update 是否为更新模式。
 * @returns 解析结果.force 是否为强制重新安装。
 * @returns 解析结果.dryRun 是否为预览模式。
 * @returns 解析结果.skillsDirs 显式指定的技能根目录列表，已转为绝对路径。
 */
function parseArgs(argv) {
    const args = { update: false, force: false, dryRun: false, skillsDirs: [] };
    for (let index = 0; index < argv.length; index++) {
        const item = argv[index];
        if (item === '--update') {
            args.update = true;
        } else if (item === '--force') {
            args.force = true;
        } else if (item === '--dry-run') {
            args.dryRun = true;
        } else if (item === '--skills-dir' && index + 1 < argv.length) {
            args.skillsDirs.push(path.resolve(argv[index + 1]));
            index += 1;
        }
    }
    return args;
}

/**
 * 执行外部命令。
 *
 * @param command 要执行的命令。
 * @param cwd 命令执行目录。
 * @param dryRun 预览模式下只打印命令，不实际执行。
 * @returns 命令标准输出；预览模式返回空字符串。
 */
function runCommand(command, cwd, dryRun = false) {
    log(`  > ${command}`, 'cyan');
    if (dryRun) {
        log('  [预览模式] 未执行', 'yellow');
        return '';
    }
    try {
        return execSync(command, { 
            cwd, 
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe']
        });
    } catch (e) {
        throw new Error(`命令执行失败: ${e.message}`);
    }
}

/**
 * 处理单个技能根目录下的安装或更新。
 *
 * @param kimiSkillsDir Kimi 技能根目录。
 * @param options 处理选项。
 * @param options.update 是否为更新模式。
 * @param options.force 是否为强制重新安装。
 * @param options.dryRun 是否为预览模式。
 * @returns 处理结果。
 * @returns 处理结果.status 处理状态，取值 installed、updated、skipped 或 failed。
 * @returns 处理结果.message 失败原因或跳过原因，成功时为空字符串。
 */
function processSkillDir(kimiSkillsDir, options) {
    const { update, force, dryRun } = options;
    const skillDir = path.join(kimiSkillsDir, SKILL_NAME);
    const exists = fs.existsSync(skillDir);

    log(`\n${'-'.repeat(60)}`, 'cyan');
    log(`目标: ${skillDir}`, 'cyan');

    if (exists && !update && !force) {
        log('  已存在同名技能，跳过安装', 'yellow');
        log('  如需更新请加 --update，如需覆盖请加 --force', 'yellow');
        return { status: 'skipped', message: '已存在同名技能' };
    }

    if (exists && update && !force) {
        log('  更新模式，将拉取最新代码...', 'cyan');
        runCommand('git pull origin main', skillDir, dryRun);
        log('  ✓ 更新完成', 'green');
    } else {
        if (exists && force && !dryRun) {
            log('  强制重新安装模式，将删除现有安装...', 'yellow');
            fs.rmSync(skillDir, { recursive: true, force: true });
        }
        log('  安装模式，将从远端克隆...', 'cyan');
        runCommand(`git clone ${REPO_URL} ${SKILL_NAME}`, kimiSkillsDir, dryRun);
        log('  ✓ 克隆完成', 'green');
    }

    if (dryRun) {
        log('  [预览模式] 跳过验证', 'yellow');
        return { status: exists && update ? 'updated' : 'installed', message: '' };
    }

    const skillMdPath = path.join(skillDir, 'SKILL.md');
    const versionPath = path.join(skillDir, 'skill-version.json');
    if (!fs.existsSync(skillMdPath)) {
        throw new Error('SKILL.md 缺失');
    }
    if (!fs.existsSync(versionPath)) {
        throw new Error('skill-version.json 缺失');
    }

    const version = JSON.parse(fs.readFileSync(versionPath, 'utf8'));
    log(`  ✓ 技能名称: ${version.name}`, 'green');
    log(`  ✓ 当前版本: ${version.version}`, 'green');
    log(`  ✓ 发布日期: ${version.releaseDate}`, 'green');

    return { status: exists ? 'updated' : 'installed', message: '' };
}

/**
 * 脚本入口。
 *
 * @param argv 命令行参数列表，默认取进程参数。
 */
function run(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    const { update, force, dryRun } = args;
    const isUpdate = update && !force;

    log('='.repeat(60), 'green');
    log(`Kimi CLI 技能${isUpdate ? '更新' : '安装'}工具`, 'green');
    log('='.repeat(60), 'green');

    if (dryRun) {
        log('\n[预览模式] 不会实际修改任何文件\n', 'yellow');
    }

    // 1. 确定目标技能根目录：显式 --skills-dir 优先，否则探测全部命中项。
    log('\n1. 查找 Kimi CLI 技能目录...', 'cyan');
    const targetDirs = args.skillsDirs.length > 0 ? args.skillsDirs : findKimiSkillDirs();

    if (targetDirs.length === 0) {
        log('\n错误: 未找到 Kimi CLI 技能目录', 'red');
        log('可能的原因:', 'yellow');
        log('  - Kimi CLI 未安装');
        log('  - 技能目录路径不在预设列表中');
        log('\n请手动指定技能目录路径:');
        log('  node src/bin/install-kimi.js --skills-dir <路径>');
        process.exit(1);
    }

    for (const dir of targetDirs) {
        log(`  ✓ 目标: ${dir}`, 'green');
    }

    // 2. 逐个目录处理，单个目录失败不影响其余目录。
    const failures = [];
    let changed = 0;

    for (const kimiSkillsDir of targetDirs) {
        try {
            const result = processSkillDir(kimiSkillsDir, { update, force, dryRun });
            if (result.status === 'installed' || result.status === 'updated') {
                changed += 1;
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            log(`  ✗ 失败: ${message}`, 'red');
            failures.push({ dir: path.join(kimiSkillsDir, SKILL_NAME), message });
        }
    }

    // 3. 汇总处理结果。
    log(`\n${'='.repeat(60)}`, failures.length > 0 ? 'yellow' : 'green');
    log(`处理完成：变更 ${changed} 个，失败 ${failures.length} 个`, failures.length > 0 ? 'yellow' : 'green');
    for (const failure of failures) {
        log(`  ✗ ${failure.dir}: ${failure.message}`, 'red');
    }
    log('='.repeat(60), failures.length > 0 ? 'yellow' : 'green');

    if (!dryRun && changed > 0) {
        log('\n使用说明:', 'cyan');
        log('  1. 重启 Kimi CLI 以加载新技能');
        log('  2. 在对话中使用技能功能');
        log('  3. 技能文档位于: SKILL.md');
        log('\n生产环境优化（可选）:', 'cyan');
        log('  node src/bin/clean-production.js --level=standard');
    }

    log('');

    if (failures.length > 0) {
        process.exit(1);
    }
}

// 导出供其他脚本使用
module.exports = {
    getKimiSkillDirCandidates,
    findKimiSkillDirs,
    parseArgs,
    run,
    SKILL_NAME,
    REPO_URL,
};

// 直接运行
if (require.main === module) {
    run();
}
