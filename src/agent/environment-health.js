const fs = require('node:fs');
const path = require('node:path');
const { loadSkillVersion } = require('../maintenance/show-version');
const { pathExists, readJsonSafe } = require('../shared/common');
const { buildKbFreshnessStatus } = require('../shared/source-snapshot');
const { createWorkspaceContext } = require('../shared/workspace-layout');
const {
    buildWorkspaceIdentity,
    resolveWorkspace,
    workspaceHashFromRoot,
} = require('../shared/workspace-registry');

const CHECK_STATUS = new Set(['ok', 'warn', 'fail']);
const REQUIRED_MCP_TOOLS = [
    'agent_preflight',
    'get_current_state',
    'register_workspace',
    'diagnose_data_root',
    'start_build_project_index',
    'prepare_agent_brief',
];

/**
 * 返回当前版本要求 MCP runtime 必须暴露的工具列表。
 *
 * @param {string} version 当前 PMM 版本号；预留给后续按版本扩展工具矩阵。
 * @returns {string[]} 当前版本要求的 MCP tool 名称。
 */
function requiredMcpToolsForVersion(version = '') {
    void version;
    return [...REQUIRED_MCP_TOOLS];
}

/**
 * 按 check 状态计算环境健康分，fail 扣 30，warn 扣 10。
 *
 * @param {Array<{status: string}>} checks 环境检查项。
 * @returns {number} 0 到 100 之间的健康分。
 */
function buildHealthScore(checks = []) {
    const penalty = checks.reduce((total, check) => {
        if (check.status === 'fail') {
            return total + 30;
        }
        if (check.status === 'warn') {
            return total + 10;
        }
        return total;
    }, 0);
    return Math.max(0, Math.min(100, 100 - penalty));
}

/**
 * 将任意输入归一化为数组。
 *
 * @param {unknown} value 待归一化的值。
 * @returns {Array} 归一化后的数组。
 */
function asArray(value) {
    if (Array.isArray(value)) {
        return value;
    }
    if (value == null || value === '') {
        return [];
    }
    return [value];
}

/**
 * 生成去重后的数组，保留原始顺序。
 *
 * @param {Array} values 输入数组。
 * @returns {Array} 去重后的数组。
 */
function uniq(values = []) {
    return Array.from(new Set(values.filter(Boolean)));
}

/**
 * 读取 skill-version.json，失败时返回空值并记录诊断。
 *
 * @param {string} root skill 根目录。
 * @param {Array<object>} diagnostics 诊断输出数组。
 * @param {string} code 诊断 code。
 * @returns {object|null} 版本信息或 null。
 */
function loadVersionSafe(root, diagnostics, code) {
    try {
        return loadSkillVersion(root);
    } catch (error) {
        diagnostics.push({
            code,
            message: error instanceof Error ? error.message : String(error),
            root,
        });
        return null;
    }
}

/**
 * 安全读取 JSON，失败时记录诊断并返回 fallback。
 *
 * @param {string} filePath JSON 文件路径。
 * @param {unknown} fallback 读取失败时的返回值。
 * @param {Array<object>} diagnostics 诊断输出数组。
 * @param {string} code 诊断 code。
 * @returns {unknown} 解析后的 JSON 或 fallback。
 */
function readJsonDiagnostic(filePath, fallback, diagnostics, code) {
    try {
        return readJsonSafe(filePath, { required: false, defaultValue: fallback });
    } catch (error) {
        diagnostics.push({
            code,
            message: error instanceof Error ? error.message : String(error),
            file: filePath,
        });
        return fallback;
    }
}

/**
 * 构造稳定 check 对象，避免对外暴露非法状态。
 *
 * @param {string} code 检查项 code。
 * @param {string} status 检查状态。
 * @param {string} message 面向操作者的说明。
 * @param {object} details 附加细节。
 * @returns {{code: string, status: string, message: string, details: object}}
 */
function makeCheck(code, status, message, details = {}) {
    const normalizedStatus = CHECK_STATUS.has(status) ? status : 'warn';
    return {
        code,
        status: normalizedStatus,
        message,
        details,
    };
}

/**
 * 添加唯一 finding。
 *
 * @param {Array<object>} findings finding 数组。
 * @param {object} finding 新 finding。
 */
function addFinding(findings, finding) {
    if (!findings.some(item => item.code === finding.code)) {
        findings.push(finding);
    }
}

/**
 * 添加唯一修复动作。
 *
 * @param {Array<object>} repairPlan 修复计划数组。
 * @param {object} action 新修复动作。
 */
function addRepair(repairPlan, action) {
    const repair = {
        ...action,
        id: action.id || action.action,
        action: action.action || action.id,
    };
    if (!repairPlan.some(item => item.id === repair.id || item.action === repair.action)) {
        repairPlan.push(repair);
    }
}

/**
 * 读取当前源码仓库的版本摘要。
 *
 * @param {object|null} versionInfo skill-version 内容。
 * @returns {object|null} 版本摘要。
 */
function compactVersion(versionInfo) {
    if (!versionInfo) {
        return null;
    }
    return {
        name: versionInfo.name || '',
        version: versionInfo.version || '',
        repo: versionInfo.repo || '',
    };
}

/**
 * 拼接 CLI 命令，保留 Windows 路径空格的安全引号。
 *
 * @param {string} command 命令名。
 * @param {object} options 命令参数。
 * @returns {string} 可复制执行的命令。
 */
function buildCommand(command, options = {}) {
    const args = [`node src/bin/${command}.js`];
    if (options.workspaceRoot) {
        args.push(`--workspace-root "${options.workspaceRoot}"`);
    }
    if (options.dataRoot) {
        args.push(`--data-root "${options.dataRoot}"`);
    }
    args.push('--json');
    return args.join(' ');
}

/**
 * 从 runtime tools 输入中提取工具名。
 *
 * @param {unknown} runtimeTools MCP runtime tool 列表。
 * @returns {string[]} 工具名列表。
 */
function normalizeRuntimeTools(runtimeTools) {
    return uniq(asArray(runtimeTools)
        .flatMap(item => {
            if (typeof item === 'string') {
                return item.split(/[\s,;]+/);
            }
            if (item && typeof item === 'object' && item.name) {
                return [item.name];
            }
            return [];
        })
        .map(item => String(item || '').trim())
        .filter(Boolean));
}

/**
 * 归一化 MCP runtime 版本输入，兼容 MCP handler 传入的版本摘要对象。
 *
 * @param {string|{version?: string}|null|undefined} runtimeVersion MCP runtime 版本输入。
 * @returns {string} 可用于比较的版本号。
 */
function normalizeRuntimeVersion(runtimeVersion) {
    if (runtimeVersion && typeof runtimeVersion === 'object' && !Array.isArray(runtimeVersion)) {
        return String(runtimeVersion.version || '').trim();
    }
    return String(runtimeVersion || '').trim();
}

/**
 * 检查 MCP runtime 版本和工具能力。
 *
 * @param {object} params 检查参数。
 * @param {object|null} params.sourceVersion 当前源码版本。
 * @param {object} params.options agentPreflight 输入参数。
 * @param {Array<object>} params.findings finding 数组。
 * @param {Array<object>} params.repairPlan 修复计划数组。
 * @returns {Array<object>} MCP 相关 checks。
 */
function checkMcpRuntime({ sourceVersion, options, findings, repairPlan }) {
    const checks = [];
    const runtimeVersion = normalizeRuntimeVersion(options.runtimeVersion || options.mcpRuntimeVersion);
    if (!runtimeVersion) {
        checks.push(makeCheck(
            'mcp_runtime_version_detected',
            'warn',
            '未提供 MCP runtime 版本，CLI 离线模式只能跳过版本一致性判断。'
        ));
    } else if (sourceVersion?.version && runtimeVersion !== sourceVersion.version) {
        checks.push(makeCheck(
            'mcp_runtime_version_detected',
            'warn',
            'MCP runtime 版本和源码版本不一致，建议重启 Codex MCP。',
            { runtimeVersion, actualVersion: runtimeVersion, sourceVersion: sourceVersion.version }
        ));
        addFinding(findings, {
            code: 'mcp_runtime_version_mismatch',
            severity: 'warn',
            message: 'MCP runtime 版本和源码版本不一致。',
            expected: sourceVersion.version,
            actual: runtimeVersion,
            actualVersion: runtimeVersion,
        });
        addRepair(repairPlan, {
            action: 'restart_codex_mcp',
            reason: 'MCP runtime 版本落后于当前源码。',
        });
    } else {
        checks.push(makeCheck(
            'mcp_runtime_version_detected',
            'ok',
            'MCP runtime 版本已检测。',
            { runtimeVersion, actualVersion: runtimeVersion }
        ));
    }

    const runtimeTools = normalizeRuntimeTools(options.runtimeTools || options.mcpTools);
    const requiredTools = requiredMcpToolsForVersion(sourceVersion?.version || runtimeVersion);
    if (!runtimeTools.length) {
        checks.push(makeCheck(
            'mcp_capability_match',
            'warn',
            '未提供 MCP runtime tools，CLI 离线模式无法确认 MCP 能力矩阵。',
            { requiredTools }
        ));
        return checks;
    }

    const missingTools = requiredTools.filter(tool => !runtimeTools.includes(tool));
    if (missingTools.length) {
        checks.push(makeCheck(
            'mcp_capability_match',
            'fail',
            'MCP runtime 缺少当前版本要求的工具，需要重启 Codex MCP。',
            { requiredTools, runtimeTools, missingTools }
        ));
        addFinding(findings, {
            code: 'mcp_capability_mismatch',
            severity: 'fail',
            message: 'MCP runtime 缺少必需工具。',
            missingTools,
        });
        addRepair(repairPlan, {
            action: 'restart_codex_mcp',
            reason: `MCP runtime 缺少工具: ${missingTools.join(', ')}`,
        });
        return checks;
    }

    checks.push(makeCheck(
        'mcp_capability_match',
        'ok',
        'MCP runtime tools 满足当前版本要求。',
        { requiredTools }
    ));
    return checks;
}

/**
 * 检查已安装 skill 副本是否和源码版本一致。
 *
 * @param {object} params 检查参数。
 * @param {object|null} params.sourceVersion 当前源码版本。
 * @param {object} params.options agentPreflight 输入参数。
 * @param {Array<object>} params.diagnostics 诊断数组。
 * @param {Array<object>} params.findings finding 数组。
 * @param {Array<object>} params.repairPlan 修复计划数组。
 * @returns {object} skill 安装检查项。
 */
function checkSkillInstallation({ sourceVersion, options, diagnostics, findings, repairPlan }) {
    const installedSkillRoot = String(options.installedSkillRoot || '').trim();
    if (!installedSkillRoot) {
        return makeCheck(
            'skill_installation_match',
            'warn',
            '未提供 installedSkillRoot，无法确认已安装 skill 副本版本。'
        );
    }

    const installedVersion = loadVersionSafe(path.resolve(installedSkillRoot), diagnostics, 'installed_skill_version_unreadable');
    if (!installedVersion) {
        addFinding(findings, {
            code: 'skill_installation_unreadable',
            severity: 'warn',
            message: '无法读取已安装 skill 的 skill-version.json。',
            installedSkillRoot,
        });
        addRepair(repairPlan, {
            action: 'reinstall_skill',
            reason: '已安装 skill 版本不可读。',
        });
        return makeCheck(
            'skill_installation_match',
            'warn',
            '已安装 skill 版本不可读，需要重装 skill。',
            { installedSkillRoot }
        );
    }

    if (sourceVersion?.version && installedVersion.version !== sourceVersion.version) {
        addFinding(findings, {
            code: 'skill_installation_mismatch',
            severity: 'warn',
            message: '已安装 skill 版本和源码版本不一致。',
            expected: sourceVersion.version,
            actual: installedVersion.version || '',
        });
        addRepair(repairPlan, {
            action: 'reinstall_skill',
            reason: '已安装 skill 版本和源码版本不一致。',
        });
        return makeCheck(
            'skill_installation_match',
            'warn',
            '已安装 skill 版本和源码版本不一致。',
            { sourceVersion: sourceVersion.version, installedVersion: installedVersion.version || '' }
        );
    }

    return makeCheck(
        'skill_installation_match',
        'ok',
        '已安装 skill 版本和源码版本一致。',
        { installedSkillRoot, version: installedVersion.version || '' }
    );
}

/**
 * 检查 dataRoot 是否存在且可用于外置记忆。
 *
 * @param {object} params 检查参数。
 * @param {object} params.context 工作区上下文。
 * @param {Array<object>} params.findings finding 数组。
 * @param {Array<object>} params.repairPlan 修复计划数组。
 * @returns {{check: object, dataRootExists: boolean}}
 */
function checkDataRoot({ context, findings, repairPlan }) {
    const dataRootExists = pathExists(context.dataRoot);
    if (!dataRootExists) {
        addFinding(findings, {
            code: 'data_root_missing',
            severity: 'fail',
            message: 'PMM dataRoot 不存在，无法安全使用外置记忆。',
            dataRoot: context.dataRoot,
        });
        addRepair(repairPlan, {
            action: 'init_workspace',
            reason: 'dataRoot 不存在，需要先初始化工作区外置记忆。',
            command: buildCommand('init-workspace', context),
        });
        return {
            dataRootExists,
            check: makeCheck(
                'data_root_consistent',
                'fail',
                'PMM dataRoot 不存在。',
                { dataRoot: context.dataRoot }
            ),
        };
    }

    return {
        dataRootExists,
        check: makeCheck(
            'data_root_consistent',
            'ok',
            'PMM dataRoot 存在。',
            { dataRoot: context.dataRoot }
        ),
    };
}

/**
 * 检查当前 workspace 是否登记在共享 registry。
 *
 * @param {object} params 检查参数。
 * @param {object} params.context 工作区上下文。
 * @param {boolean} params.dataRootExists dataRoot 是否存在。
 * @param {Array<object>} params.diagnostics 诊断数组。
 * @param {Array<object>} params.findings finding 数组。
 * @param {Array<object>} params.repairPlan 修复计划数组。
 * @returns {object} workspace registry 检查项。
 */
function checkWorkspaceRegistered({ context, dataRootExists, diagnostics, findings, repairPlan }) {
    if (!dataRootExists) {
        return makeCheck(
            'workspace_registered',
            'warn',
            'dataRoot 不存在，暂时无法确认 workspace registry。',
            { workspaceRoot: context.workspaceRoot }
        );
    }

    try {
        const resolution = resolveWorkspace({
            dataRoot: context.dataRoot,
            workspaceRoot: context.workspaceRoot,
        });
        const registered = resolution.matches.some(match => match.registered === true);
        if (registered) {
            return makeCheck(
                'workspace_registered',
                'ok',
                'workspace 已登记在 PMM registry。',
                { matchCount: resolution.matchCount }
            );
        }
        addFinding(findings, {
            code: 'workspace_not_registered',
            severity: 'warn',
            message: 'workspace 未登记在共享 PMM registry。',
            workspaceRoot: context.workspaceRoot,
        });
        addRepair(repairPlan, {
            action: 'register_workspace',
            reason: 'workspace 未登记，可能导致跨会话或多项目 dataRoot 定位不稳定。',
            command: buildCommand('register-workspace', context),
        });
        return makeCheck(
            'workspace_registered',
            'warn',
            'workspace 未登记在 PMM registry。',
            { registryPath: path.join(context.dataRoot, 'workspace-registry.json') }
        );
    } catch (error) {
        diagnostics.push({
            code: 'workspace_registry_diagnostic_failed',
            message: error instanceof Error ? error.message : String(error),
            workspaceRoot: context.workspaceRoot,
        });
        return makeCheck(
            'workspace_registered',
            'warn',
            'workspace registry 诊断失败，已降级为 finding。',
            { workspaceRoot: context.workspaceRoot }
        );
    }
}

/**
 * 构建 project-global KB freshness 状态。
 *
 * @param {object} context 工作区上下文。
 * @param {object|null} sourceVersion 当前源码版本。
 * @param {Array<object>} diagnostics 诊断数组。
 * @returns {object} KB freshness 结果。
 */
function buildProjectGlobalFreshness(context, sourceVersion, diagnostics) {
    const graphPath = path.join(context.paths.projectGlobalDir, 'chain.graph.json');
    const lookupPath = path.join(context.paths.projectGlobalDir, 'chain.lookup.json');
    const graph = readJsonDiagnostic(graphPath, null, diagnostics, 'project_global_graph_unreadable');
    const lookupExists = fs.existsSync(lookupPath);
    if (!graph || !lookupExists) {
        return buildKbFreshnessStatus({
            root: context.workspaceRoot,
            graph: null,
            config: null,
            currentSkill: compactVersion(sourceVersion),
            recommendedAction: 'build_project_index',
        });
    }
    const config = readJsonDiagnostic(
        path.join(context.paths.configsDir, 'project-global.json'),
        null,
        diagnostics,
        'project_global_config_unreadable'
    );
    return buildKbFreshnessStatus({
        root: context.workspaceRoot,
        graph,
        config,
        currentSkill: compactVersion(sourceVersion),
        recommendedAction: 'build_project_index',
    });
}

/**
 * 检查 project-global KB 是否 fresh。
 *
 * @param {object} params 检查参数。
 * @param {object} params.context 工作区上下文。
 * @param {boolean} params.dataRootExists dataRoot 是否存在。
 * @param {object|null} params.sourceVersion 当前源码版本。
 * @param {Array<object>} params.diagnostics 诊断数组。
 * @param {Array<object>} params.findings finding 数组。
 * @param {Array<object>} params.repairPlan 修复计划数组。
 * @returns {object} KB freshness 检查项。
 */
function checkKbFreshness({ context, dataRootExists, sourceVersion, diagnostics, findings, repairPlan }) {
    if (!dataRootExists) {
        return makeCheck(
            'kb_freshness_ready',
            'warn',
            'dataRoot 不存在，暂时无法确认 KB freshness。',
            { workspaceRoot: context.workspaceRoot }
        );
    }

    let freshness;
    try {
        freshness = buildProjectGlobalFreshness(context, sourceVersion, diagnostics);
    } catch (error) {
        diagnostics.push({
            code: 'kb_freshness_diagnostic_failed',
            message: error instanceof Error ? error.message : String(error),
        });
        freshness = buildKbFreshnessStatus({
            root: context.workspaceRoot,
            graph: null,
            config: null,
            currentSkill: compactVersion(sourceVersion),
            recommendedAction: 'build_project_index',
        });
    }

    if (freshness.status === 'fresh') {
        return makeCheck(
            'kb_freshness_ready',
            'ok',
            'project-global KB fresh。',
            { kbFreshness: freshness }
        );
    }

    addFinding(findings, {
        code: 'kb_freshness_not_ready',
        severity: 'warn',
        message: 'project-global KB 不是 fresh。',
        status: freshness.status,
        reasonCodes: freshness.reasonCodes || [],
    });
    addRepair(repairPlan, {
        action: 'rebuild_project_kb',
        reason: 'project-global KB stale/missing/unknown，需要重建后才能作为 PMM 上下文使用。',
        command: buildCommand('build-project', context),
    });
    return makeCheck(
        'kb_freshness_ready',
        'warn',
        'project-global KB 不是 fresh。',
        { kbFreshness: freshness }
    );
}

/**
 * 检查 AI task memory 是否可读取。
 *
 * @param {object} params 检查参数。
 * @param {object} params.context 工作区上下文。
 * @param {boolean} params.dataRootExists dataRoot 是否存在。
 * @returns {object} task memory 检查项。
 */
function checkTaskMemory({ context, dataRootExists }) {
    if (!dataRootExists) {
        return makeCheck(
            'task_memory_available',
            'warn',
            'dataRoot 不存在，暂时无法读取 task memory。',
            { workspaceRoot: context.workspaceRoot }
        );
    }
    const taskMemoryPath = path.join(context.paths.stateDir, 'agent-outcomes', 'task-outcomes.jsonl');
    if (!pathExists(taskMemoryPath)) {
        return makeCheck(
            'task_memory_available',
            'warn',
            '当前 workspace 尚未沉淀 task memory。',
            { taskMemoryPath }
        );
    }
    return makeCheck(
        'task_memory_available',
        'ok',
        'task memory 文件可读取。',
        { taskMemoryPath }
    );
}

/**
 * 根据修复计划选择下一步动作。
 *
 * @param {Array<object>} repairPlan 修复计划。
 * @returns {object} 推荐下一步动作。
 */
function selectNextAction(repairPlan = []) {
    const byAction = new Map(repairPlan.map(item => [item.action, item]));
    if (byAction.has('restart_codex_mcp')) {
        return {
            type: 'restart_codex',
            action: 'restart_codex_mcp',
            reason: byAction.get('restart_codex_mcp').reason,
        };
    }
    if (byAction.has('init_workspace')) {
        const repair = byAction.get('init_workspace');
        return {
            type: 'run_command',
            action: 'init_workspace',
            command: repair.command,
            reason: repair.reason,
        };
    }
    if (byAction.has('register_workspace')) {
        const repair = byAction.get('register_workspace');
        return {
            type: 'run_command',
            action: 'register_workspace',
            command: repair.command,
            reason: repair.reason,
        };
    }
    if (byAction.has('rebuild_project_kb')) {
        const repair = byAction.get('rebuild_project_kb');
        return {
            type: 'run_command',
            action: 'rebuild_project_kb',
            command: repair.command,
            reason: repair.reason,
        };
    }
    if (byAction.has('reinstall_skill')) {
        return {
            type: 'run_command',
            action: 'reinstall_skill',
            command: '按 skill-version.json 中 updateCommands 重新安装 project-memory-manager skill。',
            reason: byAction.get('reinstall_skill').reason,
        };
    }
    return {
        type: 'continue',
        action: 'proceed',
        reason: 'Agent Preflight 未发现阻塞项。',
    };
}

/**
 * 按 checks 和 repairPlan 归纳整体 preflight 状态。
 *
 * @param {Array<object>} checks 检查项。
 * @param {Array<object>} repairPlan 修复计划。
 * @returns {'ready'|'needs_action'|'blocked'} 整体状态。
 */
function deriveStatus(checks, repairPlan) {
    if (checks.some(check => check.status === 'fail')) {
        return 'blocked';
    }
    if (repairPlan.length) {
        return 'needs_action';
    }
    return 'ready';
}

/**
 * 执行 Agent Preflight，只读检查环境、MCP 能力、registry、KB freshness 和 task memory。
 *
 * @param {object} options 检查选项。
 * @param {string} options.workspaceRoot 目标 workspace 根目录。
 * @param {string} options.dataRoot PMM 外置 dataRoot。
 * @param {string} options.installedSkillRoot 已安装 skill 副本根目录。
 * @param {string|string[]} options.runtimeTools MCP runtime 已暴露的 tool 名称。
 * @param {string|{version?: string}} options.runtimeVersion MCP runtime 版本号或版本摘要对象。
 * @returns {object} agent-preflight 稳定 JSON 结果。
 */
function agentPreflight(options = {}) {
    const diagnostics = [];
    const findings = [];
    const repairPlan = [];
    const sourceRoot = path.resolve(options.sourceRoot || path.resolve(__dirname, '..', '..'));
    const sourceVersion = loadVersionSafe(sourceRoot, diagnostics, 'source_version_unreadable');

    let context;
    try {
        context = createWorkspaceContext({
            workspaceRoot: options.workspaceRoot,
            dataRoot: options.dataRoot,
            layout: options.layout,
        });
    } catch (error) {
        const workspaceRoot = path.resolve(options.workspaceRoot || process.cwd());
        const dataRoot = path.resolve(options.dataRoot || '');
        const workspaceHash = workspaceHashFromRoot(workspaceRoot);
        diagnostics.push({
            code: 'workspace_context_failed',
            message: error instanceof Error ? error.message : String(error),
        });
        const checks = [
            makeCheck('source_version_detected', sourceVersion ? 'ok' : 'warn', sourceVersion ? '源码版本已检测。' : '源码版本不可读。'),
            makeCheck('mcp_runtime_version_detected', 'warn', 'workspace context 构建失败，跳过 MCP runtime 版本检查。'),
            makeCheck('mcp_capability_match', 'warn', 'workspace context 构建失败，跳过 MCP 能力检查。'),
            makeCheck('skill_installation_match', 'warn', 'workspace context 构建失败，跳过 skill 安装检查。'),
            makeCheck('data_root_consistent', 'fail', 'workspace context 构建失败。'),
            makeCheck('workspace_registered', 'warn', 'workspace context 构建失败，跳过 registry 检查。'),
            makeCheck('kb_freshness_ready', 'warn', 'workspace context 构建失败，跳过 KB freshness 检查。'),
            makeCheck('task_memory_available', 'warn', 'workspace context 构建失败，跳过 task memory 检查。'),
        ];
        addRepair(repairPlan, {
            action: 'init_workspace',
            reason: 'workspace context 构建失败，需要重新初始化外置记忆。',
            command: buildCommand('init-workspace', { workspaceRoot, dataRoot }),
        });
        return {
            kind: 'agent-preflight',
            status: 'blocked',
            workspaceRoot,
            dataRoot,
            workspaceId: '',
            workspaceHash,
            health: {
                score: buildHealthScore(checks),
                checks,
            },
            findings,
            repairPlan,
            nextAction: selectNextAction(repairPlan),
            diagnostics,
        };
    }

    const identity = buildWorkspaceIdentity(context);
    const checks = [];
    checks.push(makeCheck(
        'source_version_detected',
        sourceVersion ? 'ok' : 'warn',
        sourceVersion ? '源码版本已检测。' : '源码版本不可读。',
        compactVersion(sourceVersion) || {}
    ));
    checks.push(...checkMcpRuntime({ sourceVersion, options, findings, repairPlan }));
    checks.push(checkSkillInstallation({ sourceVersion, options, diagnostics, findings, repairPlan }));
    const dataRootResult = checkDataRoot({ context, findings, repairPlan });
    checks.push(dataRootResult.check);
    checks.push(checkWorkspaceRegistered({
        context,
        dataRootExists: dataRootResult.dataRootExists,
        diagnostics,
        findings,
        repairPlan,
    }));
    checks.push(checkKbFreshness({
        context,
        dataRootExists: dataRootResult.dataRootExists,
        sourceVersion,
        diagnostics,
        findings,
        repairPlan,
    }));
    checks.push(checkTaskMemory({ context, dataRootExists: dataRootResult.dataRootExists }));

    return {
        kind: 'agent-preflight',
        status: deriveStatus(checks, repairPlan),
        workspaceRoot: context.workspaceRoot,
        dataRoot: context.dataRoot,
        workspaceId: context.workspaceId,
        workspaceHash: identity.workspaceHash,
        health: {
            score: buildHealthScore(checks),
            checks,
        },
        findings,
        repairPlan,
        nextAction: selectNextAction(repairPlan),
        diagnostics,
    };
}

module.exports = {
    agentPreflight,
    buildHealthScore,
    requiredMcpToolsForVersion,
};
