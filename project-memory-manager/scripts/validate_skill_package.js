#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const MAX_SKILL_NAME_LENGTH = 64;

function parseArgs(argv) {
    const defaultSkillPath = path.resolve(__dirname, '..');
    return {
        skillPath: path.resolve(argv[0] || defaultSkillPath),
    };
}

function readText(filePath) {
    return fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
}

function fail(message) {
    return { valid: false, message };
}

function ok(message) {
    return { valid: true, message };
}

function parseSimpleFrontmatter(frontmatterText) {
    const result = {};
    for (const rawLine of frontmatterText.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) {
            continue;
        }
        const match = line.match(/^([A-Za-z0-9_-]+):\s*(.+)$/);
        if (!match) {
            throw new Error(`Unsupported frontmatter line: ${rawLine}`);
        }
        const key = match[1];
        let value = match[2].trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        result[key] = value;
    }
    return result;
}

function parseOpenAiYaml(content) {
    const lines = content.split(/\r?\n/);
    const interfaceData = {};
    let inInterface = false;

    for (const line of lines) {
        if (!line.trim()) {
            continue;
        }
        if (!line.startsWith(' ') && !line.startsWith('\t')) {
            inInterface = line.trim() === 'interface:';
            continue;
        }
        if (!inInterface) {
            continue;
        }
        const match = line.match(/^\s{2}([A-Za-z0-9_-]+):\s*"([^"]*)"$/);
        if (match) {
            interfaceData[match[1]] = match[2];
        }
    }

    return { interface: interfaceData };
}

function validateSkillMd(skillPath) {
    const skillMdPath = path.join(skillPath, 'SKILL.md');
    if (!fs.existsSync(skillMdPath)) {
        return fail('未找到 SKILL.md');
    }

    const content = readText(skillMdPath);
    if (!content.startsWith('---')) {
        return fail('SKILL.md 缺少 YAML frontmatter');
    }

    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) {
        return fail('SKILL.md frontmatter 格式无效');
    }

    let frontmatter = null;
    try {
        frontmatter = parseSimpleFrontmatter(match[1]);
    } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
    }

    const allowed = new Set(['name', 'description', 'license', 'allowed-tools', 'metadata']);
    for (const key of Object.keys(frontmatter)) {
        if (!allowed.has(key)) {
            return fail(`SKILL.md frontmatter 存在未允许字段: ${key}`);
        }
    }

    if (!frontmatter.name) {
        return fail("SKILL.md frontmatter 缺少 'name'");
    }
    if (!frontmatter.description) {
        return fail("SKILL.md frontmatter 缺少 'description'");
    }

    if (!/^[a-z0-9-]+$/.test(frontmatter.name)) {
        return fail(`技能名 '${frontmatter.name}' 无效：只能使用小写字母、数字和连字符`);
    }
    if (frontmatter.name.startsWith('-') || frontmatter.name.endsWith('-') || frontmatter.name.includes('--')) {
        return fail(`技能名 '${frontmatter.name}' 无效：不能以连字符开头或结尾，也不能包含连续连字符`);
    }
    if (frontmatter.name.length > MAX_SKILL_NAME_LENGTH) {
        return fail(`技能名过长（${frontmatter.name.length}），最大长度为 ${MAX_SKILL_NAME_LENGTH}`);
    }
    if (frontmatter.description.includes('<') || frontmatter.description.includes('>')) {
        return fail('description 不能包含尖括号');
    }
    if (frontmatter.description.length > 1024) {
        return fail(`description 过长（${frontmatter.description.length}），最大长度为 1024`);
    }

    return ok('SKILL.md 校验通过');
}

function validateOpenAiYaml(skillPath, expectedSkillName) {
    const yamlPath = path.join(skillPath, 'agents', 'openai.yaml');
    if (!fs.existsSync(yamlPath)) {
        return fail('未找到 agents/openai.yaml');
    }

    const yaml = parseOpenAiYaml(readText(yamlPath));
    const defaultPrompt = yaml.interface?.default_prompt || '';
    if (!defaultPrompt.includes(`$${expectedSkillName}`)) {
        return fail(`agents/openai.yaml 的 default_prompt 必须显式包含 $${expectedSkillName}`);
    }
    if (!yaml.interface?.display_name) {
        return fail('agents/openai.yaml 缺少 interface.display_name');
    }
    if (!yaml.interface?.short_description) {
        return fail('agents/openai.yaml 缺少 interface.short_description');
    }

    return ok('agents/openai.yaml 校验通过');
}

function validateRequiredStructure(skillPath) {
    const requiredPaths = [
        'scripts',
        'references',
        'assets',
        path.join('agents', 'openai.yaml'),
    ];

    for (const relativePath of requiredPaths) {
        if (!fs.existsSync(path.join(skillPath, relativePath))) {
            return fail(`缺少必要路径: ${relativePath}`);
        }
    }

    return ok('必要目录结构完整');
}

function run(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    const checks = [];

    const skillMdResult = validateSkillMd(args.skillPath);
    checks.push({ name: 'skill-md', ...skillMdResult });
    if (!skillMdResult.valid) {
        console.error(skillMdResult.message);
        process.exit(1);
    }

    const frontmatter = parseSimpleFrontmatter(readText(path.join(args.skillPath, 'SKILL.md')).match(/^---\r?\n([\s\S]*?)\r?\n---/)[1]);
    const yamlResult = validateOpenAiYaml(args.skillPath, frontmatter.name);
    checks.push({ name: 'openai-yaml', ...yamlResult });
    if (!yamlResult.valid) {
        console.error(yamlResult.message);
        process.exit(1);
    }

    const structureResult = validateRequiredStructure(args.skillPath);
    checks.push({ name: 'structure', ...structureResult });
    if (!structureResult.valid) {
        console.error(structureResult.message);
        process.exit(1);
    }

    console.log(`便携技能校验通过: ${args.skillPath}`);
    checks.forEach(check => console.log(`- ${check.name}: ${check.message}`));
}

module.exports = {
    run,
};

if (require.main === module) {
    try {
        run();
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    }
}
