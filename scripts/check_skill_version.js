#!/usr/bin/env node
/**
 * 检查技能版本并提示更新
 * 
 * 使用方法:
 *   node scripts/check_skill_version.js [--fix]
 * 
 * 选项:
 *   --fix  自动执行修复建议
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SKILL_NAME = 'project-memory-manager';
const REPO_URL = 'https://github.com/entiwee-ship-it/project-memory-manager.git';

function parseArgs(argv) {
    return {
        fix: argv.includes('--fix'),
    };
}

function findSkillInstallPath() {
    const possiblePaths = [
        path.join(process.env.USERPROFILE || process.env.HOME, '.config', 'agents', 'skills', SKILL_NAME),
        path.join(process.env.USERPROFILE || process.env.HOME, '.agents', 'skills', SKILL_NAME),
        path.join(process.env.APPDATA || '', 'agents', 'skills', SKILL_NAME),
        // 当前目录（如果是开发模式）
        process.cwd(),
    ];

    for (const p of possiblePaths) {
        if (fs.existsSync(path.join(p, 'skill-version.json'))) {
            return p;
        }
    }
    return null;
}

function getLocalVersion(skillPath) {
    try {
        const versionFile = path.join(skillPath, 'skill-version.json');
        const content = fs.readFileSync(versionFile, 'utf8');
        const data = JSON.parse(content);
        return {
            version: data.version || 'unknown',
            name: data.name || SKILL_NAME,
            releaseDate: data.releaseDate || '',
            capabilities: data.capabilities || [],
        };
    } catch (err) {
        return null;
    }
}

function getRemoteVersion() {
    try {
        // 尝试从 git 获取最新版本信息
        const tmpDir = path.join(process.env.TEMP || '/tmp', 'pmm-version-check');
        
        // 清理旧的临时目录
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {}
        
        // 浅克隆获取最新版本
        execSync(`git clone --depth 1 --quiet ${REPO_URL} "${tmpDir}"`, { 
            timeout: 30000,
            windowsHide: true,
        });
        
        const versionFile = path.join(tmpDir, 'skill-version.json');
        const content = fs.readFileSync(versionFile, 'utf8');
        const data = JSON.parse(content);
        
        // 清理
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {}
        
        return {
            version: data.version || 'unknown',
            releaseDate: data.releaseDate || '',
        };
    } catch (err) {
        return null;
    }
}

function compareVersions(v1, v2) {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);
    
    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
        const p1 = parts1[i] || 0;
        const p2 = parts2[i] || 0;
        if (p1 > p2) return 1;
        if (p1 < p2) return -1;
    }
    return 0;
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    
    console.log('=== Project Memory Manager Version Check ===\n');
    
    // 1. 查找安装路径
    const skillPath = findSkillInstallPath();
    if (!skillPath) {
        console.log('❌ 未找到技能安装路径');
        console.log('可能的安装位置:');
        console.log('  - ~/.config/agents/skills/project-memory-manager');
        console.log('  - ~/.agents/skills/project-memory-manager');
        console.log('\n修复命令:');
        console.log(`  npx skills add ${REPO_URL} --skill ${SKILL_NAME} -g -a codex -y`);
        process.exit(1);
    }
    
    console.log(`✅ 找到技能安装路径: ${skillPath}`);
    
    // 2. 获取本地版本
    const localVersion = getLocalVersion(skillPath);
    if (!localVersion) {
        console.log('❌ 无法读取本地版本信息');
        process.exit(1);
    }
    
    console.log(`📦 本地版本: ${localVersion.version} (${localVersion.releaseDate})`);
    console.log(`🛠️  能力: ${localVersion.capabilities.slice(0, 5).join(', ')}${localVersion.capabilities.length > 5 ? '...' : ''}`);
    
    // 3. 获取远程版本
    console.log('\n⏳ 检查远程版本...');
    const remoteVersion = getRemoteVersion();
    if (!remoteVersion) {
        console.log('⚠️  无法获取远程版本信息（网络问题或 Git 未安装）');
        process.exit(0);
    }
    
    console.log(`📦 远程版本: ${remoteVersion.version} (${remoteVersion.releaseDate})`);
    
    // 4. 比较版本
    const comparison = compareVersions(remoteVersion.version, localVersion.version);
    
    if (comparison > 0) {
        console.log('\n🔔 发现新版本！');
        console.log(`   本地: ${localVersion.version} → 远程: ${remoteVersion.version}`);
        console.log('\n更新命令:');
        console.log('  方法1: npx skills update');
        console.log('  方法2: npx skills check && npx skills update');
        console.log('  方法3（强制重装）:');
        console.log(`    npx skills remove ${SKILL_NAME} -g`);
        console.log(`    npx skills add ${REPO_URL} --skill ${SKILL_NAME} -g -a codex -y`);
        
        if (args.fix) {
            console.log('\n⏳ 正在执行强制重装...');
            try {
                execSync(`npx skills remove ${SKILL_NAME} -g`, { stdio: 'inherit' });
                execSync(`npx skills add ${REPO_URL} --skill ${SKILL_NAME} -g -a codex -y`, { stdio: 'inherit' });
                console.log('✅ 更新完成！');
            } catch (err) {
                console.log('❌ 更新失败:', err.message);
            }
        }
    } else if (comparison < 0) {
        console.log('\n✨ 本地版本比远程新（可能是开发版本）');
    } else {
        console.log('\n✅ 已是最新版本');
    }
    
    // 5. 检查环境变量
    console.log('\n=== 环境检查 ===');
    const agentConfigDir = process.env.AGENTS_CONFIG_DIR;
    if (agentConfigDir) {
        console.log(`AGENTS_CONFIG_DIR: ${agentConfigDir}`);
    }
    
    console.log('\n=== 使用提示 ===');
    console.log('1. 如果 npx skills update 无效，尝试强制重装');
    console.log('2. 如果路径混乱，检查 AGENTS_CONFIG_DIR 环境变量');
    console.log('3. 定期运行此检查: node scripts/check_skill_version.js');
}

main();
