#!/usr/bin/env node
/**
 * Kimi CLI 技能安装/更新脚本
 * 
 * 自动将本技能安装到 Kimi Code CLI 的技能目录，
 * 支持首次安装和后续更新。
 * 
 * 使用方式:
 *   node scripts/install_to_kimi_cli.js [--update]
 * 
 * 参数:
 *   --update    更新模式（拉取最新代码）
 *   --force     强制重新安装（删除后重新克隆）
 *   --dry-run   预览模式，不实际执行
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Kimi CLI 技能目录（Windows 默认路径）
const KIMI_SKILLS_DIRS = [
    // Windows
    path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming', 'Trae CN', 'User', 'globalStorage', 'moonshot-ai.kimi-code', 'bin', 'kimi', '_internal', 'kimi_cli', 'skills'),
    path.join(process.env.USERPROFILE || '', '.config', 'kimi', 'skills'),
    // Linux/Mac
    path.join(process.env.HOME || '', '.config', 'kimi', 'skills'),
];

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

// 查找 Kimi CLI 技能目录
function findKimiSkillsDir() {
    for (const dir of KIMI_SKILLS_DIRS) {
        if (fs.existsSync(dir)) {
            return dir;
        }
    }
    return null;
}

// 执行命令
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

// 主函数
function main() {
    const args = process.argv.slice(2);
    const isUpdate = args.includes('--update');
    const isForce = args.includes('--force');
    const dryRun = args.includes('--dry-run');
    const isInstall = !isUpdate || isForce;

    log('='.repeat(60), 'green');
    log(`Kimi CLI 技能${isUpdate ? '更新' : '安装'}工具`, 'green');
    log('='.repeat(60), 'green');

    if (dryRun) {
        log('\n[预览模式] 不会实际修改任何文件\n', 'yellow');
    }

    // 1. 查找 Kimi CLI 技能目录
    log('\n1. 查找 Kimi CLI 技能目录...', 'cyan');
    const kimiSkillsDir = findKimiSkillsDir();
    
    if (!kimiSkillsDir) {
        log('\n错误: 未找到 Kimi CLI 技能目录', 'red');
        log('可能的原因:', 'yellow');
        log('  - Kimi CLI 未安装');
        log('  - 技能目录路径不在预设列表中');
        log('\n请手动指定技能目录路径:');
        log(`  node scripts/install_to_kimi_cli.js --skills-dir <路径>`);
        process.exit(1);
    }
    
    log(`  ✓ 找到: ${kimiSkillsDir}`, 'green');

    const skillDir = path.join(kimiSkillsDir, SKILL_NAME);
    const exists = fs.existsSync(skillDir);

    // 2. 检查现有安装
    if (exists) {
        log(`\n2. 检测到现有安装: ${skillDir}`, 'yellow');
        
        if (isForce) {
            log('   强制重新安装模式，将删除现有安装...', 'yellow');
            if (!dryRun) {
                fs.rmSync(skillDir, { recursive: true, force: true });
            }
        } else if (isUpdate) {
            log('   更新模式，将拉取最新代码...', 'cyan');
        } else {
            log('\n提示: 使用 --update 参数更新，或使用 --force 强制重新安装', 'yellow');
            process.exit(0);
        }
    } else {
        log(`\n2. 目标位置: ${skillDir}`, 'cyan');
    }

    // 3. 执行安装/更新
    log(`\n3. ${isInstall ? '安装' : '更新'}技能...`, 'cyan');

    try {
        if (exists && isUpdate && !isForce) {
            // 更新模式：git pull
            runCommand('git pull origin main', skillDir, dryRun);
            log('  ✓ 更新完成', 'green');
        } else {
            // 安装模式：git clone
            runCommand(`git clone ${REPO_URL} ${SKILL_NAME}`, kimiSkillsDir, dryRun);
            log('  ✓ 克隆完成', 'green');
        }

        // 4. 验证安装
        log('\n4. 验证安装...', 'cyan');
        
        const skillMdPath = path.join(skillDir, 'SKILL.md');
        const versionPath = path.join(skillDir, 'skill-version.json');

        if (!dryRun) {
            if (!fs.existsSync(skillMdPath)) {
                throw new Error('SKILL.md 缺失');
            }
            if (!fs.existsSync(versionPath)) {
                throw new Error('skill-version.json 缺失');
            }

            // 读取版本信息
            const version = JSON.parse(fs.readFileSync(versionPath, 'utf8'));
            log(`  ✓ 技能名称: ${version.name}`, 'green');
            log(`  ✓ 当前版本: ${version.version}`, 'green');
            log(`  ✓ 发布日期: ${version.releaseDate}`, 'green');
        } else {
            log('  [预览模式] 跳过验证', 'yellow');
        }

        // 5. 可选清理
        log('\n5. 生产环境优化（可选）...', 'cyan');
        log('  如需清理非必要文件，请运行:', 'yellow');
        log(`  cd "${skillDir}"`, 'cyan');
        log('  node scripts/clean_for_production.js --level=standard', 'cyan');

        // 6. 完成
        log('\n' + '='.repeat(60), 'green');
        log(`${isUpdate ? '更新' : '安装'}成功！`, 'green');
        log('='.repeat(60), 'green');
        log('\n使用说明:', 'cyan');
        log('  1. 重启 Kimi CLI 以加载新技能');
        log('  2. 在对话中使用技能功能');
        log('  3. 技能文档位于: SKILL.md');
        
        if (!isUpdate) {
            log('\n后续更新:', 'cyan');
            log('  node scripts/install_to_kimi_cli.js --update');
        }

        log('');

    } catch (e) {
        log(`\n错误: ${e.message}`, 'red');
        process.exit(1);
    }
}

// 导出供其他脚本使用
module.exports = { findKimiSkillsDir, SKILL_NAME, REPO_URL };

// 直接运行
if (require.main === module) {
    main();
}
