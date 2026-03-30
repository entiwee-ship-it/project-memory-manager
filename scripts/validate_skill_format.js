#!/usr/bin/env node
/**
 * 验证技能格式是否符合 Agent Skills 规范
 * 
 * 参考: https://moonshotai.github.io/kimi-cli/en/customization/skills.html
 */

const fs = require('fs');
const path = require('path');

const SKILL_DIR = process.cwd();
const ERRORS = [];
const WARNINGS = [];

function checkFile(filePath, description) {
    if (!fs.existsSync(filePath)) {
        ERRORS.push(`缺少必需文件: ${description} (${filePath})`);
        return false;
    }
    return true;
}

function checkOptionalDir(dirPath, description) {
    if (fs.existsSync(dirPath)) {
        const stat = fs.statSync(dirPath);
        if (!stat.isDirectory()) {
            ERRORS.push(`${description} 应该是目录，但却是文件: ${dirPath}`);
            return false;
        }
        return true;
    }
    return false;
}

function validateSkillMd() {
    const skillMdPath = path.join(SKILL_DIR, 'SKILL.md');
    if (!checkFile(skillMdPath, 'SKILL.md')) return;
    
    const content = fs.readFileSync(skillMdPath, 'utf8');
    
    // 检查 frontmatter (支持 --- 后换行或空格)
    const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!frontmatterMatch) {
        ERRORS.push('SKILL.md 缺少 YAML frontmatter');
        return;
    }
    
    // 解析 frontmatter
    const frontmatter = frontmatterMatch[1];
    
    // 检查 name 字段
    const nameMatch = frontmatter.match(/name:\s*(.+)/);
    if (!nameMatch) {
        ERRORS.push('SKILL.md frontmatter 缺少 name 字段');
    } else {
        const name = nameMatch[1].trim();
        // 检查 name 格式: 小写字母、数字、连字符
        if (!/^[a-z0-9-]+$/.test(name)) {
            ERRORS.push(`name 字段格式错误: "${name}"，只能包含小写字母、数字和连字符`);
        }
        if (name.length > 64) {
            ERRORS.push(`name 字段过长: ${name.length} 字符 (最大 64)`);
        }
        // 检查 name 是否匹配目录名
        const dirName = path.basename(SKILL_DIR);
        if (name !== dirName) {
            WARNINGS.push(`name 字段 "${name}" 与目录名 "${dirName}" 不匹配`);
        }
    }
    
    // 检查 description 字段
    const descMatch = frontmatter.match(/description:\s*(.+)/);
    if (!descMatch) {
        ERRORS.push('SKILL.md frontmatter 缺少 description 字段');
    } else {
        let desc = descMatch[1].trim();
        // 去除引号
        if ((desc.startsWith('"') && desc.endsWith('"')) || 
            (desc.startsWith("'") && desc.endsWith("'"))) {
            desc = desc.slice(1, -1);
        }
        if (desc.length < 10) {
            ERRORS.push(`description 字段过短: ${desc.length} 字符 (建议 10-1024)`);
        }
        if (desc.length > 1024) {
            ERRORS.push(`description 字段过长: ${desc.length} 字符 (最大 1024)`);
        }
        // 检查是否包含 WHAT 和 WHEN
        if (!desc.toLowerCase().includes('use when') && 
            !desc.toLowerCase().includes('when to') &&
            !desc.toLowerCase().includes('用于') &&
            !desc.toLowerCase().includes('使用场景')) {
            WARNINGS.push('description 建议包含 "Use when" 或 "用于" 说明使用场景');
        }
    }
    
    // 检查文件长度
    const lines = content.split('\n');
    if (lines.length > 500) {
        WARNINGS.push(`SKILL.md 行数较多: ${lines.length} 行 (建议 < 500，详细内容移到 references/)`);
    }
    
    // 检查 frontmatter 后是否直接是内容
    const afterFrontmatter = content.slice(frontmatterMatch[0].length).trim();
    if (!afterFrontmatter.startsWith('#')) {
        WARNINGS.push('SKILL.md frontmatter 后应该直接是 Markdown 标题');
    }
}

function validateDirectoryStructure() {
    // 必需文件
    checkFile(path.join(SKILL_DIR, 'SKILL.md'), 'SKILL.md');
    
    // 可选目录
    const optionalDirs = [
        { path: path.join(SKILL_DIR, 'scripts'), name: 'scripts/' },
        { path: path.join(SKILL_DIR, 'references'), name: 'references/' },
        { path: path.join(SKILL_DIR, 'assets'), name: 'assets/' },
        { path: path.join(SKILL_DIR, 'templates'), name: 'templates/' },
        { path: path.join(SKILL_DIR, 'tests'), name: 'tests/' },
    ];
    
    for (const dir of optionalDirs) {
        checkOptionalDir(dir.path, dir.name);
    }
}

function validateScripts() {
    const scriptsDir = path.join(SKILL_DIR, 'scripts');
    if (!fs.existsSync(scriptsDir)) return;
    
    const files = fs.readdirSync(scriptsDir);
    for (const file of files) {
        const filePath = path.join(scriptsDir, file);
        const stat = fs.statSync(filePath);
        if (stat.isFile() && stat.size > 5 * 1024 * 1024) {
            WARNINGS.push(`脚本文件过大: ${file} (${(stat.size / 1024 / 1024).toFixed(2)} MB, 建议 < 5MB)`);
        }
    }
}

function validateAssets() {
    const assetsDir = path.join(SKILL_DIR, 'assets');
    if (!fs.existsSync(assetsDir)) return;
    
    const checkDir = (dir) => {
        const files = fs.readdirSync(dir);
        for (const file of files) {
            const filePath = path.join(dir, file);
            const stat = fs.statSync(filePath);
            if (stat.isDirectory()) {
                checkDir(filePath);
            } else if (stat.size > 5 * 1024 * 1024) {
                WARNINGS.push(`资源文件过大: ${file} (${(stat.size / 1024 / 1024).toFixed(2)} MB, 建议 < 5MB)`);
            }
        }
    };
    
    checkDir(assetsDir);
}

function main() {
    console.log('=== Agent Skills 格式验证 ===\n');
    
    validateSkillMd();
    validateDirectoryStructure();
    validateScripts();
    validateAssets();
    
    // 输出结果
    if (ERRORS.length === 0 && WARNINGS.length === 0) {
        console.log('✅ 所有检查通过！');
        return 0;
    }
    
    if (ERRORS.length > 0) {
        console.log(`❌ 发现 ${ERRORS.length} 个错误:\n`);
        ERRORS.forEach(e => console.log(`  - ${e}`));
        console.log();
    }
    
    if (WARNINGS.length > 0) {
        console.log(`⚠️  发现 ${WARNINGS.length} 个警告:\n`);
        WARNINGS.forEach(w => console.log(`  - ${w}`));
        console.log();
    }
    
    console.log('=== 验证完成 ===');
    
    if (ERRORS.length > 0) {
        console.log('\n请修复错误后重新运行验证。');
        process.exit(1);
    }
    
    return 0;
}

main();
