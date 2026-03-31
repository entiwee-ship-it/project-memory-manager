const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function normalize(filePath) {
    return String(filePath || '').split(path.sep).join('/');
}

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function pathExists(targetPath) {
    try {
        fs.accessSync(targetPath);
        return true;
    } catch {
        return false;
    }
}

/**
 * 生成诊断式错误信息，帮助AI理解问题并修复
 * @param {string} context - 操作上下文
 * @param {Error} error - 原始错误
 * @param {string} filePath - 相关文件路径
 * @param {Object} options - 额外选项
 * @returns {Error} 包装后的错误
 */
function createDiagnosticError(context, error, filePath, options = {}) {
    const { suggestRebuild = false, suggestInit = false, featureKey = '' } = options;
    
    let diagnostic = `[SKILL-DIAGNOSIS] ${context} 失败\n`;
    diagnostic += `文件: ${filePath}\n`;
    diagnostic += `原始错误: ${error.message}\n\n`;
    
    // 根据错误类型提供具体建议
    if (error.code === 'ENOENT') {
        diagnostic += '可能原因:\n';
        diagnostic += '  1. 文件尚未生成（需要先构建）\n';
        diagnostic += '  2. 文件被移动或删除\n';
        diagnostic += '  3. 路径配置错误\n\n';
        
        if (suggestRebuild) {
            diagnostic += '修复命令:\n';
            if (featureKey) {
                diagnostic += `  node scripts/build_chain_kb.js --config project-memory/kb/configs/${featureKey}.json\n`;
            } else {
                diagnostic += '  node scripts/rebuild_kbs.js --root <project-root>\n';
            }
        }
        if (suggestInit) {
            diagnostic += '  node scripts/init_project_memory.js --root <project-root>\n';
        }
    } else if (error instanceof SyntaxError) {
        diagnostic += '可能原因:\n';
        diagnostic += '  1. JSON 格式错误（检查末尾逗号、引号匹配）\n';
        diagnostic += '  2. 文件写入过程中断（损坏）\n';
        diagnostic += '  3. 文件编码问题\n\n';
        diagnostic += '修复建议:\n';
        diagnostic += `  1. 手动检查文件格式: ${filePath}\n`;
        if (suggestRebuild) {
            diagnostic += '  2. 删除后重建\n';
        }
    } else if (error.code === 'EACCES' || error.code === 'EPERM') {
        diagnostic += '可能原因:\n';
        diagnostic += '  1. 文件权限不足\n';
        diagnostic += '  2. 文件被其他进程占用\n\n';
        diagnostic += '修复建议:\n';
        diagnostic += '  1. 检查文件权限\n';
        diagnostic += '  2. 关闭可能占用该文件的编辑器/IDE\n';
    } else if (error.code === 'EISDIR') {
        diagnostic += '可能原因:\n';
        diagnostic += '  期望是文件，但实际是目录\n\n';
    }
    
    const wrappedError = new Error(diagnostic);
    wrappedError.originalError = error;
    wrappedError.code = error.code;
    wrappedError.filePath = filePath;
    return wrappedError;
}

/**
 * 安全地读取 JSON 文件，提供诊断信息
 * @param {string} filePath - 文件路径
 * @param {Object} options - 选项
 * @returns {any} 解析后的 JSON
 * @throws {Error} 带有诊断信息的错误
 */
function readJsonSafe(filePath, options = {}) {
    const { required = true, defaultValue = null } = options;
    
    if (!pathExists(filePath)) {
        if (!required) {
            return defaultValue;
        }
        throw createDiagnosticError(
            '读取 JSON',
            { code: 'ENOENT', message: '文件不存在' },
            filePath,
            options
        );
    }
    
    let content;
    try {
        content = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
        throw createDiagnosticError('读取 JSON', err, filePath, options);
    }
    
    // 移除 BOM
    content = content.replace(/^\uFEFF/, '');
    
    try {
        return JSON.parse(content);
    } catch (err) {
        throw createDiagnosticError('解析 JSON', err, filePath, options);
    }
}

/**
 * 原子写入文件（先写临时文件，再重命名）
 * @param {string} filePath - 目标文件路径
 * @param {string} content - 文件内容
 * @param {Object} options - 选项
 */
function writeFileAtomic(filePath, content, options = {}) {
    const { encoding = 'utf8' } = options;
    const dir = path.dirname(filePath);
    
    // 确保目录存在
    ensureDir(dir);
    
    // 生成临时文件名（在同一目录内，确保原子重命名）
    const tempName = `.tmp-${crypto.randomBytes(8).toString('hex')}-${path.basename(filePath)}`;
    const tempPath = path.join(dir, tempName);
    
    try {
        // 写入临时文件
        fs.writeFileSync(tempPath, content, { encoding });
        
        // 原子重命名
        fs.renameSync(tempPath, filePath);
    } catch (err) {
        // 清理临时文件
        try {
            if (pathExists(tempPath)) {
                fs.unlinkSync(tempPath);
            }
        } catch {
            // 忽略清理错误
        }
        
        throw createDiagnosticError('写入文件', err, filePath, options);
    }
}

/**
 * 原子写入 JSON 文件
 * @param {string} filePath - 目标文件路径
 * @param {any} value - 要写入的值
 * @param {Object} options - 选项
 */
function writeJsonAtomic(filePath, value, options = {}) {
    const content = `${JSON.stringify(value, null, 2)}\n`;
    writeFileAtomic(filePath, content, options);
}

/**
 * 原子写入文本文件
 * @param {string} filePath - 目标文件路径
 * @param {string} value - 要写入的内容
 * @param {Object} options - 选项
 */
function writeTextAtomic(filePath, value, options = {}) {
    writeFileAtomic(filePath, value, options);
}

// 保留旧函数以保持兼容性
function readJson(filePath) {
    return readJsonSafe(filePath, { required: true });
}

function writeJson(filePath, value) {
    writeJsonAtomic(filePath, value);
}

function writeText(filePath, value) {
    writeTextAtomic(filePath, value);
}

function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
}

function listFilesRecursive(rootPath, matcher = () => true, acc = [], options = {}) {
    const ignorePath = typeof options.ignorePath === 'function' ? options.ignorePath : () => false;
    const { maxDepth = 100, currentDepth = 0 } = options;
    
    if (currentDepth > maxDepth) {
        return acc;
    }
    
    if (!fs.existsSync(rootPath)) {
        return acc;
    }

    let stat;
    try {
        stat = fs.statSync(rootPath);
    } catch {
        return acc;
    }
    
    if (stat.isFile()) {
        if (!ignorePath(rootPath) && matcher(rootPath)) {
            acc.push(rootPath);
        }
        return acc;
    }

    let entries;
    try {
        entries = fs.readdirSync(rootPath, { withFileTypes: true });
    } catch {
        return acc;
    }
    
    for (const entry of entries) {
        const fullPath = path.join(rootPath, entry.name);
        
        // 跳过符号链接（防止循环）
        if (entry.isSymbolicLink()) {
            continue;
        }
        
        if (ignorePath(fullPath)) {
            continue;
        }
        
        if (entry.isDirectory()) {
            listFilesRecursive(fullPath, matcher, acc, { ...options, currentDepth: currentDepth + 1 });
            continue;
        }
        
        if (matcher(fullPath)) {
            acc.push(fullPath);
        }
    }

    return acc;
}

function repoRelative(filePath, root = process.cwd()) {
    return normalize(path.relative(root, path.resolve(filePath)));
}

function findProjectRoot(startDir = process.cwd()) {
    let current = path.resolve(startDir);

    while (true) {
        if (pathExists(path.join(current, 'project-memory'))) {
            return current;
        }

        const parent = path.dirname(current);
        if (parent === current) {
            return null;
        }
        current = parent;
    }
}

function resolveProjectRoot(startDir = process.cwd(), options = {}) {
    const { strict = false } = options;
    
    const envRoot = String(process.env.PMM_PROJECT_ROOT || '').trim();
    if (envRoot) {
        const resolvedEnvRoot = path.resolve(envRoot);
        if (pathExists(path.join(resolvedEnvRoot, 'project-memory'))) {
            return resolvedEnvRoot;
        }
        // 环境变量设置但目录不存在，发出警告
        console.warn(`[SKILL-WARN] PMM_PROJECT_ROOT 指向的目录不存在: ${envRoot}`);
        console.warn(`[SKILL-WARN] 将尝试自动查找项目根目录...`);
    }

    const foundRoot = findProjectRoot(startDir);
    if (!foundRoot) {
        if (strict) {
            return null;
        }
        // 非严格模式下发出警告并返回当前目录（保持向后兼容）
        console.warn(`[SKILL-WARN] 未找到 project-memory 目录，将使用当前目录: ${path.resolve(startDir)}`);
        console.warn(`[SKILL-WARN] 如需初始化，运行: node scripts/init_project_memory.js --root <path>`);
    }
    
    return foundRoot || path.resolve(startDir);
}

/**
 * 验证项目根目录是否有效（包含有效的 project-memory 结构）
 * @param {string} root - 项目根目录
 * @param {Object} options - 选项
 * @param {string} options.scriptName - 脚本名称（用于错误提示）
 * @param {boolean} options.requireRegistry - 是否要求 feature-registry.json 存在
 * @throws {Error} 如果项目根目录无效
 */
function validateProjectRoot(root, options = {}) {
    const { scriptName = 'script', requireRegistry = true } = options;
    const pmDir = path.join(root, 'project-memory');
    const registryPath = path.join(pmDir, 'state', 'feature-registry.json');
    
    if (!pathExists(pmDir)) {
        throw new Error(
            `[SKILL-DIAGNOSIS] 未找到有效的项目根目录: ${root}\n` +
            `提示: 该目录下没有 project-memory 文件夹。\n\n` +
            `可能原因:\n` +
            `  1. 未指定 --root 参数，且当前目录不是项目根目录\n` +
            `  2. 项目尚未初始化（缺少 project-memory 目录）\n\n` +
            `修复方法:\n` +
            `  1. 指定 --root 参数: node scripts/${scriptName}.js --root <项目路径> ...\n` +
            `  2. 或切换到项目目录后运行\n` +
            `  3. 或设置环境变量: set PMM_PROJECT_ROOT=<项目路径>\n` +
            `  4. 初始化新项目: node scripts/init_project_memory.js --root <项目路径>`
        );
    }
    
    if (requireRegistry && !pathExists(registryPath)) {
        // 检查是否是技能目录本身
        const skillVersionPath = path.join(root, 'skill-version.json');
        if (pathExists(skillVersionPath)) {
            throw new Error(
                `[SKILL-DIAGNOSIS] 检测到在技能目录运行脚本: ${root}\n` +
                `技能目录不能作为项目目录使用。\n\n` +
                `修复方法:\n` +
                `  1. 指定 --root 参数指向项目目录: node scripts/${scriptName}.js --root E:\\xile ...\n` +
                `  2. 或切换到项目目录后运行: cd E:\\xile && node <技能路径>\\scripts\\${scriptName}.js ...\n` +
                `  3. 或设置环境变量: set PMM_PROJECT_ROOT=E:\\xile`
            );
        }
        
        throw new Error(
            `[SKILL-DIAGNOSIS] 项目尚未完全初始化: ${root}\n` +
            `提示: 未找到 feature-registry.json。\n\n` +
            `修复方法:\n` +
            `  1. 初始化项目记忆: node scripts/init_project_memory.js --root ${root}\n` +
            `  2. 或重建 KB: node scripts/rebuild_kbs.js --root ${root}`
        );
    }
}

function slugify(input) {
    return String(input || '')
        .trim()
        .replace(/[^\w.-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase();
}

function loadProjectProfile(root = process.cwd()) {
    const profilePath = path.join(root, 'project-memory', 'state', 'project-profile.json');
    return readJsonSafe(profilePath, { required: false, suggestInit: true });
}

function makeAreaRootMap(config = {}, projectProfile = null, root = process.cwd()) {
    const areaMap = new Map();
    const source = config.areaRoots || projectProfile?.areas || {};

    for (const [area, roots] of Object.entries(source)) {
        const normalizedRoots = (Array.isArray(roots) ? roots : [])
            .map(item => path.resolve(root, item))
            .map(normalize);
        areaMap.set(area, normalizedRoots);
    }

    return areaMap;
}

function inferArea(filePath, config = {}, projectProfile = null, root = process.cwd()) {
    const target = normalize(path.resolve(root, filePath));
    const areaRoots = makeAreaRootMap(config, projectProfile, root);
    let bestArea = 'unknown';
    let bestLength = -1;

    for (const [area, roots] of areaRoots.entries()) {
        for (const areaRoot of roots) {
            if (!areaRoot) {
                continue;
            }
            if (target === areaRoot || target.startsWith(`${areaRoot}/`)) {
                if (areaRoot.length > bestLength) {
                    bestArea = area;
                    bestLength = areaRoot.length;
                }
            }
        }
    }

    return bestArea;
}

function inferStacks(area, projectProfile = null) {
    const stacks = projectProfile?.stacks?.[area];
    return Array.isArray(stacks) ? stacks : [];
}

function timestamp() {
    return new Date().toISOString();
}

module.exports = {
    createDiagnosticError,
    ensureDir,
    findProjectRoot,
    hasOwn,
    inferArea,
    inferStacks,
    listFilesRecursive,
    loadProjectProfile,
    normalize,
    pathExists,
    readJson,
    readJsonSafe,
    repoRelative,
    resolveProjectRoot,
    slugify,
    timestamp,
    validateProjectRoot,
    writeFileAtomic,
    writeJson,
    writeJsonAtomic,
    writeText,
    writeTextAtomic,
};
