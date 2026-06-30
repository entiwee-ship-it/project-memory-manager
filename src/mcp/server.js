#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn, spawnSync } = require('child_process');
const { createWorkspaceContext } = require('../shared/workspace-layout');
const { run: initProjectMemory } = require('../commands/lifecycle/init-workspace');
const { run: detectProjectTopology } = require('../commands/lifecycle/detect-topology');
const { run: buildProjectKb } = require('../commands/build/build-project');
const { run: discoverFeaturesCli } = require('../commands/build/discover-features');
const { run: buildFeatureIndexCli } = require('../commands/build/build-feature');
const { loadSkillVersion } = require('../maintenance/show-version');
const { loadFeatureLookupArtifacts, normalizeFeatureRecord } = require('../graph/feature-kb');
const { buildKbFreshnessStatus } = require('../shared/source-snapshot');
const {
    analyzeChangeImpact,
    explainFeatureForAgent,
    prepareTaskContext,
} = require('../agent/context-pack');
const {
    decidePmmUsage,
    planTaskExecution,
    recordTaskOutcome,
    reviewPatchForAgent,
    validateEditScope,
} = require('../agent/execution-loop');
const {
    prepareAgentBrief,
    recallTaskMemory,
    summarizeProjectMemory,
    updateProjectPlaybook,
} = require('../agent/memory-recall');
const {
    buildWorkspaceIdentity,
    diagnoseDataRoot,
    listRegisteredWorkspaces,
    registerWorkspace,
    resolveWorkspace,
} = require('../shared/workspace-registry');

const jobs = new Map();
let nextJobId = 1;

const DEFAULT_MCP_QUERY_LIMIT = 20;
const MAX_MCP_QUERY_LIMIT = 100;
const DEFAULT_MCP_QUERY_TIMEOUT_MS = 8000;
const MAX_MCP_QUERY_TIMEOUT_MS = 30000;
const DEFAULT_BUILD_WAIT_TIMEOUT_MS = 120000;
const MAX_BUILD_WAIT_TIMEOUT_MS = 600000;
const MAX_PROJECT_QUERY_CACHE_ENTRIES = 100;
const DEFAULT_FRESHNESS_POLICY = 'auto_rebuild';
const FRESHNESS_POLICIES = new Set(['auto_rebuild', 'require_fresh', 'allow_stale']);
const projectQueryCache = new Map();

const TOOL_DEFINITIONS = [
    {
        name: 'inspect_workspace',
        description: 'Inspect a target workspace without writing PMM files into it.',
        inputSchema: {
            type: 'object',
            properties: {
                workspaceRoot: { type: 'string' },
                dataRoot: { type: 'string' },
            },
            required: ['workspaceRoot'],
        },
    },
    {
        name: 'get_current_state',
        description: 'Return PMM data-root state for a target workspace.',
        inputSchema: {
            type: 'object',
            properties: {
                workspaceRoot: { type: 'string' },
                dataRoot: { type: 'string' },
            },
            required: ['workspaceRoot'],
        },
    },
    {
        name: 'register_workspace',
        description: 'Register or refresh a workspace entry in the shared PMM data-root registry.',
        inputSchema: {
            type: 'object',
            properties: {
                workspaceRoot: { type: 'string' },
                dataRoot: { type: 'string' },
                name: { type: 'string' },
            },
            required: ['workspaceRoot'],
        },
    },
    {
        name: 'list_workspaces',
        description: 'List workspaces known to the shared PMM data root.',
        inputSchema: {
            type: 'object',
            properties: {
                dataRoot: { type: 'string' },
                includeMissing: { type: 'boolean' },
            },
        },
    },
    {
        name: 'resolve_workspace',
        description: 'Resolve a workspace from PMM registry metadata such as root, id, hash, remote, or name.',
        inputSchema: {
            type: 'object',
            properties: {
                dataRoot: { type: 'string' },
                workspaceRoot: { type: 'string' },
                workspaceId: { type: 'string' },
                workspaceHash: { type: 'string' },
                gitRemote: { type: 'string' },
                name: { type: 'string' },
            },
        },
    },
    {
        name: 'diagnose_data_root',
        description: 'Diagnose shared PMM data-root registry, manifests, missing projects, and workspace-id collisions.',
        inputSchema: {
            type: 'object',
            properties: {
                dataRoot: { type: 'string' },
            },
        },
    },
    {
        name: 'build_project_index',
        description: 'Build project-global KB into PMM data root.',
        inputSchema: {
            type: 'object',
            properties: {
                workspaceRoot: { type: 'string' },
                dataRoot: { type: 'string' },
                dryRun: { type: 'boolean' },
            },
            required: ['workspaceRoot'],
        },
    },
    {
        name: 'init_workspace',
        description: 'Initialize PMM external data for a target workspace without writing memory files into the workspace.',
        inputSchema: {
            type: 'object',
            properties: {
                workspaceRoot: { type: 'string' },
                dataRoot: { type: 'string' },
                name: { type: 'string' },
            },
            required: ['workspaceRoot'],
        },
    },
    {
        name: 'detect_topology',
        description: 'Detect workspace topology and write project-profile.json into PMM data root.',
        inputSchema: {
            type: 'object',
            properties: {
                workspaceRoot: { type: 'string' },
                dataRoot: { type: 'string' },
            },
            required: ['workspaceRoot'],
        },
    },
    {
        name: 'diagnose_workspace',
        description: 'Diagnose PMM external-data state and suggest the next lifecycle action.',
        inputSchema: {
            type: 'object',
            properties: {
                workspaceRoot: { type: 'string' },
                dataRoot: { type: 'string' },
            },
            required: ['workspaceRoot'],
        },
    },
    {
        name: 'check_kb_freshness',
        description: 'Check whether project-global or feature KBs are fresh, stale, missing, or unknown before trusting query results.',
        inputSchema: {
            type: 'object',
            properties: {
                workspaceRoot: { type: 'string' },
                dataRoot: { type: 'string' },
                feature: { type: 'string' },
            },
            required: ['workspaceRoot'],
        },
    },
    {
        name: 'start_build_project_index',
        description: 'Start an asynchronous project-global KB build job.',
        inputSchema: {
            type: 'object',
            properties: {
                workspaceRoot: { type: 'string' },
                dataRoot: { type: 'string' },
                forceTopology: { type: 'boolean' },
                wait: { type: 'boolean' },
                timeoutMs: { type: 'number' },
            },
            required: ['workspaceRoot'],
        },
    },
    {
        name: 'get_job_status',
        description: 'Return current status for an asynchronous PMM job.',
        inputSchema: {
            type: 'object',
            properties: {
                jobId: { type: 'string' },
            },
            required: ['jobId'],
        },
    },
    {
        name: 'get_job_result',
        description: 'Return final result and workspace state for an asynchronous PMM job.',
        inputSchema: {
            type: 'object',
            properties: {
                jobId: { type: 'string' },
            },
            required: ['jobId'],
        },
    },
    {
        name: 'discover_features',
        description: 'Discover feature candidates from project-global KB and optionally write feature-candidates.json.',
        inputSchema: {
            type: 'object',
            properties: {
                workspaceRoot: { type: 'string' },
                dataRoot: { type: 'string' },
                limit: { type: 'number' },
                minConfidence: { type: 'string' },
                write: { type: 'boolean' },
            },
            required: ['workspaceRoot'],
        },
    },
    {
        name: 'build_feature_index',
        description: 'Generate a feature KB config from a discovered candidate and optionally build it.',
        inputSchema: {
            type: 'object',
            properties: {
                workspaceRoot: { type: 'string' },
                dataRoot: { type: 'string' },
                featureKey: { type: 'string' },
                dryRun: { type: 'boolean' },
            },
            required: ['workspaceRoot', 'featureKey'],
        },
    },
    {
        name: 'prepare_task_context',
        description: 'Prepare a concise, evidence-backed AI context pack from a natural-language development task.',
        inputSchema: {
            type: 'object',
            properties: {
                workspaceRoot: { type: 'string' },
                dataRoot: { type: 'string' },
                task: { type: 'string' },
                query: { type: 'string' },
                depth: { type: 'number' },
                limit: { type: 'number' },
                freshnessPolicy: { type: 'string', enum: Array.from(FRESHNESS_POLICIES) },
            },
            required: ['workspaceRoot'],
        },
    },
    {
        name: 'explain_feature_for_agent',
        description: 'Return an AI-oriented feature memory card with endpoints, methods, Prisma models, services, risks, and evidence.',
        inputSchema: {
            type: 'object',
            properties: {
                workspaceRoot: { type: 'string' },
                dataRoot: { type: 'string' },
                featureKey: { type: 'string' },
                feature: { type: 'string' },
                freshnessPolicy: { type: 'string', enum: Array.from(FRESHNESS_POLICIES) },
            },
            required: ['workspaceRoot'],
        },
    },
    {
        name: 'analyze_change_impact',
        description: 'Analyze changed files or git diff and return affected features, endpoints, methods, tables, external services, risks, and tests.',
        inputSchema: {
            type: 'object',
            properties: {
                workspaceRoot: { type: 'string' },
                dataRoot: { type: 'string' },
                changedFiles: {
                    type: 'array',
                    items: { type: 'string' },
                },
                changedFile: { type: 'string' },
                diff: { type: 'string' },
                diffFile: { type: 'string' },
                depth: { type: 'number' },
                freshnessPolicy: { type: 'string', enum: Array.from(FRESHNESS_POLICIES) },
            },
            required: ['workspaceRoot'],
        },
    },
    {
        name: 'decide_pmm_usage',
        description: 'Decide whether an AI task must use deep PMM context, can use a light PMM gate, or can proceed with a bounded edit.',
        inputSchema: {
            type: 'object',
            properties: {
                workspaceRoot: { type: 'string' },
                dataRoot: { type: 'string' },
                task: { type: 'string' },
                query: { type: 'string' },
                knownFiles: {
                    type: 'array',
                    items: { type: 'string' },
                },
                files: {
                    type: 'array',
                    items: { type: 'string' },
                },
                file: { type: 'string' },
                changedFiles: {
                    type: 'array',
                    items: { type: 'string' },
                },
                changedFile: { type: 'string' },
                diff: { type: 'string' },
                diffFile: { type: 'string' },
                featureKey: { type: 'string' },
                feature: { type: 'string' },
            },
        },
    },
    {
        name: 'plan_task_execution',
        description: 'Create an AI execution plan from PMM usage gate and, when needed, PMM context evidence.',
        inputSchema: {
            type: 'object',
            properties: {
                workspaceRoot: { type: 'string' },
                dataRoot: { type: 'string' },
                task: { type: 'string' },
                query: { type: 'string' },
                knownFiles: {
                    type: 'array',
                    items: { type: 'string' },
                },
                changedFiles: {
                    type: 'array',
                    items: { type: 'string' },
                },
                changedFile: { type: 'string' },
                diff: { type: 'string' },
                diffFile: { type: 'string' },
                depth: { type: 'number' },
                limit: { type: 'number' },
                freshnessPolicy: { type: 'string', enum: Array.from(FRESHNESS_POLICIES) },
            },
        },
    },
    {
        name: 'validate_edit_scope',
        description: 'Validate changed files against the PMM usage gate and task context before submission.',
        inputSchema: {
            type: 'object',
            properties: {
                workspaceRoot: { type: 'string' },
                dataRoot: { type: 'string' },
                task: { type: 'string' },
                query: { type: 'string' },
                knownFiles: {
                    type: 'array',
                    items: { type: 'string' },
                },
                changedFiles: {
                    type: 'array',
                    items: { type: 'string' },
                },
                changedFile: { type: 'string' },
                diff: { type: 'string' },
                diffFile: { type: 'string' },
                depth: { type: 'number' },
                freshnessPolicy: { type: 'string', enum: Array.from(FRESHNESS_POLICIES) },
            },
        },
    },
    {
        name: 'review_patch_for_agent',
        description: 'Review an AI patch with PMM scope evidence, impact risk, and a focused checklist.',
        inputSchema: {
            type: 'object',
            properties: {
                workspaceRoot: { type: 'string' },
                dataRoot: { type: 'string' },
                task: { type: 'string' },
                query: { type: 'string' },
                knownFiles: {
                    type: 'array',
                    items: { type: 'string' },
                },
                changedFiles: {
                    type: 'array',
                    items: { type: 'string' },
                },
                changedFile: { type: 'string' },
                diff: { type: 'string' },
                diffFile: { type: 'string' },
                depth: { type: 'number' },
                freshnessPolicy: { type: 'string', enum: Array.from(FRESHNESS_POLICIES) },
            },
        },
    },
    {
        name: 'record_task_outcome',
        description: 'Record a concise AI task outcome into PMM external data for later cross-session context.',
        inputSchema: {
            type: 'object',
            properties: {
                workspaceRoot: { type: 'string' },
                dataRoot: { type: 'string' },
                task: { type: 'string' },
                query: { type: 'string' },
                outcome: { type: 'string' },
                summary: { type: 'string' },
                changedFiles: {
                    type: 'array',
                    items: { type: 'string' },
                },
                changedFile: { type: 'string' },
                validation: {
                    type: 'array',
                    items: { type: 'string' },
                },
                observations: {
                    type: 'array',
                    items: { type: 'string' },
                },
                confidence: { type: 'string' },
            },
            required: ['workspaceRoot', 'task'],
        },
    },
    {
        name: 'recall_task_memory',
        description: 'Recall similar prior AI task outcomes, related files, validation commands, observations, and playbook rules.',
        inputSchema: {
            type: 'object',
            properties: {
                workspaceRoot: { type: 'string' },
                dataRoot: { type: 'string' },
                task: { type: 'string' },
                query: { type: 'string' },
                knownFiles: {
                    type: 'array',
                    items: { type: 'string' },
                },
                files: {
                    type: 'array',
                    items: { type: 'string' },
                },
                file: { type: 'string' },
                changedFiles: {
                    type: 'array',
                    items: { type: 'string' },
                },
                changedFile: { type: 'string' },
                limit: { type: 'number' },
                scanLimit: { type: 'number' },
            },
            required: ['workspaceRoot'],
        },
    },
    {
        name: 'prepare_agent_brief',
        description: 'Prepare a single AI brief that combines PMM usage gate, execution plan, recalled task memory, playbook rules, files, and validation.',
        inputSchema: {
            type: 'object',
            properties: {
                workspaceRoot: { type: 'string' },
                dataRoot: { type: 'string' },
                task: { type: 'string' },
                query: { type: 'string' },
                knownFiles: {
                    type: 'array',
                    items: { type: 'string' },
                },
                changedFiles: {
                    type: 'array',
                    items: { type: 'string' },
                },
                changedFile: { type: 'string' },
                diff: { type: 'string' },
                diffFile: { type: 'string' },
                depth: { type: 'number' },
                limit: { type: 'number' },
                freshnessPolicy: { type: 'string', enum: Array.from(FRESHNESS_POLICIES) },
            },
            required: ['workspaceRoot', 'task'],
        },
    },
    {
        name: 'summarize_project_memory',
        description: 'Summarize PMM agent memory: latest outcomes, frequent files, validation commands, and playbook rules.',
        inputSchema: {
            type: 'object',
            properties: {
                workspaceRoot: { type: 'string' },
                dataRoot: { type: 'string' },
                limit: { type: 'number' },
                scanLimit: { type: 'number' },
            },
            required: ['workspaceRoot'],
        },
    },
    {
        name: 'update_project_playbook',
        description: 'Add or infer stable project rules into the external PMM agent playbook.',
        inputSchema: {
            type: 'object',
            properties: {
                workspaceRoot: { type: 'string' },
                dataRoot: { type: 'string' },
                rule: { type: 'string' },
                rules: {
                    type: 'array',
                    items: { type: 'string' },
                },
                category: { type: 'string' },
                source: { type: 'string' },
                task: { type: 'string' },
                query: { type: 'string' },
                outcome: { type: 'string' },
                summary: { type: 'string' },
                changedFiles: {
                    type: 'array',
                    items: { type: 'string' },
                },
                changedFile: { type: 'string' },
                knownFiles: {
                    type: 'array',
                    items: { type: 'string' },
                },
                observations: {
                    type: 'array',
                    items: { type: 'string' },
                },
            },
            required: ['workspaceRoot'],
        },
    },
    {
        name: 'query_project_chain',
        description: 'Query project-global KB from PMM data root.',
        inputSchema: {
            type: 'object',
            properties: {
                workspaceRoot: { type: 'string' },
                dataRoot: { type: 'string' },
                message: { type: 'string' },
                timing: { type: 'string' },
                phase: { type: 'string' },
                transition: { type: 'string' },
                event: { type: 'string' },
                method: { type: 'string' },
                request: { type: 'string' },
                endpoint: { type: 'string' },
                state: { type: 'string' },
                type: { type: 'string' },
                name: { type: 'string' },
                tag: { type: 'string' },
                file: { type: 'string' },
                excludeFile: { type: 'string' },
                excludePrefab: { type: 'string' },
                area: { type: 'string' },
                module: { type: 'string' },
                excludeModule: { type: 'string' },
                protocol: { type: 'string' },
                path: { type: 'string' },
                detail: { type: 'string' },
                mode: { type: 'string' },
                fullstack: { type: 'boolean' },
                focus: { type: 'string' },
                includeUnresolved: { type: 'boolean' },
                grouped: { type: 'boolean' },
                groupLimit: { type: 'number' },
                instanceLimit: { type: 'number' },
                nodePathLimit: { type: 'number' },
                from: { type: 'string' },
                direction: { type: 'string' },
                upstream: { type: 'boolean' },
                downstream: { type: 'boolean' },
                limit: { type: 'number' },
                depth: { type: 'number' },
                timeoutMs: { type: 'number' },
                freshnessPolicy: { type: 'string', enum: Array.from(FRESHNESS_POLICIES) },
            },
            required: ['workspaceRoot'],
        },
    },
    {
        name: 'query_feature_chain',
        description: 'Query a feature KB from PMM data root, including grouped ambiguous entrypoint recommendations.',
        inputSchema: {
            type: 'object',
            properties: {
                workspaceRoot: { type: 'string' },
                dataRoot: { type: 'string' },
                feature: { type: 'string' },
                event: { type: 'string' },
                message: { type: 'string' },
                method: { type: 'string' },
                request: { type: 'string' },
                endpoint: { type: 'string' },
                state: { type: 'string' },
                type: { type: 'string' },
                name: { type: 'string' },
                tag: { type: 'string' },
                file: { type: 'string' },
                excludeFile: { type: 'string' },
                excludePrefab: { type: 'string' },
                area: { type: 'string' },
                module: { type: 'string' },
                excludeModule: { type: 'string' },
                protocol: { type: 'string' },
                path: { type: 'string' },
                detail: { type: 'string' },
                mode: { type: 'string' },
                fullstack: { type: 'boolean' },
                focus: { type: 'string' },
                includeUnresolved: { type: 'boolean' },
                grouped: { type: 'boolean' },
                groupLimit: { type: 'number' },
                instanceLimit: { type: 'number' },
                nodePathLimit: { type: 'number' },
                from: { type: 'string' },
                direction: { type: 'string' },
                upstream: { type: 'boolean' },
                downstream: { type: 'boolean' },
                limit: { type: 'number' },
                depth: { type: 'number' },
                timeoutMs: { type: 'number' },
                freshnessPolicy: { type: 'string', enum: Array.from(FRESHNESS_POLICIES) },
            },
            required: ['workspaceRoot', 'feature'],
        },
    },
];

function textResult(value) {
    return {
        content: [
            {
                type: 'text',
                text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
            },
        ],
    };
}

function toolArgs(params = {}) {
    return params.arguments && typeof params.arguments === 'object' ? params.arguments : {};
}

function layoutArgv(args = {}) {
    const argv = ['--workspace-root', args.workspaceRoot, '--layout', 'external-data'];
    if (args.dataRoot) {
        argv.push('--data-root', args.dataRoot);
    }
    return argv;
}

function readJsonSafe(filePath, fallback = null) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return fallback;
    }
}

function hasConfiguredAreaRoots(projectProfile) {
    return Object.values(projectProfile?.areas || {}).some(
        roots => Array.isArray(roots) && roots.length > 0
    );
}

function currentSkillSummary() {
    try {
        const version = loadSkillVersion(path.resolve(__dirname, '..', '..'));
        return {
            name: version.name || '',
            version: version.version || '',
            repo: version.repo || '',
        };
    } catch {
        return null;
    }
}

function projectGlobalConfigPath(context) {
    return path.join(context.paths.configsDir, 'project-global.json');
}

function buildProjectGlobalFreshness(context) {
    const graphPath = path.join(context.paths.projectGlobalDir, 'chain.graph.json');
    const lookupPath = path.join(context.paths.projectGlobalDir, 'chain.lookup.json');
    const graph = readJsonSafe(graphPath, null);
    const hasLookup = fs.existsSync(lookupPath);
    if (!graph || !hasLookup) {
        return buildKbFreshnessStatus({
            root: context.workspaceRoot,
            graph: null,
            config: null,
            currentSkill: currentSkillSummary(),
            recommendedAction: 'build_project_index',
        });
    }
    return buildKbFreshnessStatus({
        root: context.workspaceRoot,
        graph,
        config: readJsonSafe(projectGlobalConfigPath(context), null),
        currentSkill: currentSkillSummary(),
        recommendedAction: 'build_project_index',
    });
}

function readFeatureRegistry(context) {
    const registry = readJsonSafe(context.paths.featureRegistry, { features: [] });
    return (registry.features || []).map(item => normalizeFeatureRecord(item));
}

function buildFeatureFreshness(context, featureKey) {
    const feature = readFeatureRegistry(context).find(item => item.featureKey === featureKey);
    if (!feature) {
        const usageGate = {
            querySafe: false,
            sourceFallbackAllowed: false,
            mustRefreshBeforeQuery: true,
            mustRefreshBeforeSourceFallback: true,
            instruction: '未找到功能 KB。不要绕开 PMM 直接查源码；先运行 discover_features/build_feature_index，或改用 project-global 查询并让 MCP 等到 fresh。',
        };
        return {
            kind: 'kb-freshness',
            status: 'missing',
            stale: true,
            querySafe: false,
            sourceFallbackAllowed: false,
            mustRefreshBeforeQuery: true,
            mustRefreshBeforeSourceFallback: true,
            usageGate,
            reasonCodes: ['missing-feature'],
            reasons: [`未找到功能 KB: ${featureKey}`],
            recommendedAction: 'discover_features',
        };
    }
    const { graph } = loadFeatureLookupArtifacts(context.workspaceRoot, feature);
    const configPath = path.isAbsolute(feature.configPath)
        ? feature.configPath
        : path.resolve(context.workspaceRoot, feature.configPath || '');
    return buildKbFreshnessStatus({
        root: context.workspaceRoot,
        graph,
        config: readJsonSafe(configPath, null),
        currentSkill: currentSkillSummary(),
        recommendedAction: `build_feature_index:${feature.featureKey}`,
    });
}

function captureConsoleLog(fn) {
    const output = [];
    const oldLog = console.log;
    try {
        console.log = (...values) => output.push(values.map(value => String(value)).join(' '));
        const value = fn();
        return { output: output.join('\n'), value };
    } finally {
        console.log = oldLog;
    }
}

function clampInteger(value, fallback, max) {
    if (!Number.isFinite(value)) {
        return fallback;
    }
    const integer = Math.max(1, Math.floor(value));
    return Math.min(integer, max);
}

function resolveBuildWaitTimeoutMs(value) {
    return clampInteger(value, DEFAULT_BUILD_WAIT_TIMEOUT_MS, MAX_BUILD_WAIT_TIMEOUT_MS);
}

function resolveMcpQueryOptions(args = {}) {
    return {
        limit: clampInteger(args.limit, DEFAULT_MCP_QUERY_LIMIT, MAX_MCP_QUERY_LIMIT),
        depth: Number.isFinite(args.depth) ? Math.max(1, Math.floor(args.depth)) : null,
        timeoutMs: clampInteger(args.timeoutMs, DEFAULT_MCP_QUERY_TIMEOUT_MS, MAX_MCP_QUERY_TIMEOUT_MS),
    };
}

function hasQuerySelector(args = {}) {
    return [
        'message',
        'timing',
        'phase',
        'transition',
        'event',
        'method',
        'request',
        'endpoint',
        'state',
        'type',
        'name',
        'tag',
        'file',
        'excludeFile',
        'excludePrefab',
        'area',
        'module',
        'excludeModule',
        'protocol',
        'path',
        'detail',
        'mode',
        'focus',
        'from',
        'direction',
    ].some(key => Boolean(args[key])) || Boolean(args.upstream || args.downstream || args.fullstack || args.includeUnresolved || args.grouped || args.groupLimit || args.instanceLimit || args.nodePathLimit);
}

function statSignature(filePath) {
    try {
        const stat = fs.statSync(filePath);
        return {
            file: filePath,
            exists: true,
            mtimeMs: stat.mtimeMs,
            size: stat.size,
        };
    } catch {
        return {
            file: filePath,
            exists: false,
            mtimeMs: 0,
            size: 0,
        };
    }
}

function buildProjectArtifactState(args) {
    const context = createWorkspaceContext({
        workspaceRoot: args.workspaceRoot,
        dataRoot: args.dataRoot,
        layout: 'external-data',
    });
    const artifacts = [
        statSignature(path.join(context.paths.projectGlobalDir, 'chain.graph.json')),
        statSignature(path.join(context.paths.projectGlobalDir, 'chain.lookup.json')),
        statSignature(context.paths.projectProtocols),
    ];
    const projectGlobalFreshness = buildProjectGlobalFreshness(context);
    const artifactSignature = JSON.stringify(artifacts.map(artifact => ({
        file: artifact.file,
        exists: artifact.exists,
        mtimeMs: artifact.mtimeMs,
        size: artifact.size,
    })));
    const sourceSignature = JSON.stringify({
        status: projectGlobalFreshness.status,
        currentFingerprint: projectGlobalFreshness.currentSnapshot?.fingerprint || '',
        storedFingerprint: projectGlobalFreshness.sourceSnapshot?.fingerprint || '',
        reasonCodes: projectGlobalFreshness.reasonCodes || [],
    });
    return {
        context,
        artifacts,
        projectGlobalFreshness,
        artifactSignature,
        sourceSignature,
        signature: JSON.stringify({ artifactSignature, sourceSignature }),
    };
}

function evictOldestProjectQueryCacheEntry() {
    const oldestKey = projectQueryCache.keys().next().value;
    if (oldestKey) {
        projectQueryCache.delete(oldestKey);
    }
}

function parseJsonOutput(output) {
    return JSON.parse(String(output || '').trim() || '{}');
}

function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}

function withMcpQueryMetadata(payload, cacheMeta, queryMeta, freshnessMeta = null) {
    const result = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? cloneJson(payload)
        : { result: payload };
    if (!result.kbFreshness && cacheMeta?.projectGlobalFreshness) {
        result.kbFreshness = cacheMeta.projectGlobalFreshness;
    }
    if (!result.kbFreshness && cacheMeta?.featureFreshness) {
        result.kbFreshness = cacheMeta.featureFreshness;
    }
    if (freshnessMeta) {
        result._mcpFreshness = freshnessMeta;
    }
    result._mcpCache = cacheMeta;
    result._mcpQuery = queryMeta;
    return result;
}

function buildWorkspaceState(args) {
    const context = createWorkspaceContext({
        workspaceRoot: args.workspaceRoot,
        dataRoot: args.dataRoot,
        layout: 'external-data',
    });
    const identity = buildWorkspaceIdentity(context);
    const projectProfile = readJsonSafe(context.paths.projectProfile, null);
    const hasProjectProfile = Boolean(projectProfile);
    const hasAreaRoots = hasConfiguredAreaRoots(projectProfile);
    const hasProjectGlobalKb = fs.existsSync(path.join(context.paths.projectGlobalDir, 'chain.graph.json'))
        && fs.existsSync(path.join(context.paths.projectGlobalDir, 'chain.lookup.json'));
    const projectGlobalFreshness = buildProjectGlobalFreshness(context);
    const suggestedNextAction = !fs.existsSync(context.paths.manifest)
        ? 'init_workspace'
        : (!hasProjectProfile || !hasAreaRoots)
            ? 'detect_topology'
            : !hasProjectGlobalKb
                ? 'build_project_index'
                : projectGlobalFreshness.stale
                    ? 'build_project_index'
                    : 'query_project_chain';
    return {
        workspaceRoot: context.workspaceRoot,
        dataRoot: context.dataRoot,
        layout: context.layout,
        workspaceId: context.workspaceId,
        workspaceHash: identity.workspaceHash,
        memoryRoot: context.memoryRoot,
        manifest: context.paths.manifest,
        registryPath: identity.registryPath,
        projectProfile: context.paths.projectProfile,
        featureRegistry: context.paths.featureRegistry,
        projectGlobalDir: context.paths.projectGlobalDir,
        initialized: fs.existsSync(context.paths.manifest),
        hasProjectProfile,
        hasConfiguredAreaRoots: hasAreaRoots,
        hasProjectGlobalKb,
        projectGlobalFreshness,
        legacyProjectMemoryExists: fs.existsSync(path.join(context.workspaceRoot, 'project-memory')),
        workspaceIdentity: identity,
        areas: projectProfile?.areas || null,
        stacks: projectProfile?.stacks || null,
        suggestedNextAction,
    };
}

function inspectWorkspace(args) {
    const context = createWorkspaceContext({
        workspaceRoot: args.workspaceRoot,
        dataRoot: args.dataRoot,
        layout: 'external-data',
    });
    return textResult({
        workspaceRoot: context.workspaceRoot,
        dataRoot: context.dataRoot,
        workspaceId: context.workspaceId,
        memoryRoot: context.memoryRoot,
        layout: context.layout,
    });
}

function getCurrentState(args) {
    return textResult(buildWorkspaceState(args));
}

function registerWorkspaceTool(args) {
    const context = createWorkspaceContext({
        workspaceRoot: args.workspaceRoot,
        dataRoot: args.dataRoot,
        layout: 'external-data',
    });
    return textResult(registerWorkspace(context, { name: args.name }));
}

function listWorkspacesTool(args) {
    return textResult(listRegisteredWorkspaces({
        dataRoot: args.dataRoot,
        includeMissing: args.includeMissing !== false,
    }));
}

function resolveWorkspaceTool(args) {
    return textResult(resolveWorkspace(args));
}

function diagnoseDataRootTool(args) {
    return textResult(diagnoseDataRoot({ dataRoot: args.dataRoot }));
}

function initWorkspace(args) {
    const argv = [...layoutArgv(args)];
    if (args.name) {
        argv.push('--name', args.name);
    }
    const captured = captureConsoleLog(() => initProjectMemory(argv));
    return textResult({
        ...buildWorkspaceState(args),
        initialized: true,
        output: captured.output,
    });
}

function detectTopology(args) {
    const captured = captureConsoleLog(() => detectProjectTopology(layoutArgv(args)));
    return textResult({
        ...buildWorkspaceState(args),
        output: captured.output,
    });
}

function ensureWorkspacePrepared(args) {
    let state = buildWorkspaceState(args);
    const output = [];
    if (!state.initialized) {
        output.push(captureConsoleLog(() => initProjectMemory(layoutArgv(args))).output);
        state = buildWorkspaceState(args);
    }
    if (!state.hasProjectProfile || !state.hasConfiguredAreaRoots) {
        output.push(captureConsoleLog(() => detectProjectTopology(layoutArgv(args))).output);
        state = buildWorkspaceState(args);
    }
    return {
        state,
        output: output.filter(Boolean).join('\n'),
    };
}

function diagnoseWorkspace(args) {
    const state = buildWorkspaceState(args);
    const missingAreaRoots = [];
    for (const roots of Object.values(state.areas || {})) {
        for (const areaRoot of Array.isArray(roots) ? roots : []) {
            if (!fs.existsSync(path.resolve(state.workspaceRoot, areaRoot))) {
                missingAreaRoots.push(areaRoot);
            }
        }
    }
    return textResult({
        ...state,
        missingAreaRoots,
        isHealthy: state.initialized && state.hasProjectProfile && state.hasConfiguredAreaRoots && missingAreaRoots.length === 0,
    });
}

function checkKbFreshness(args) {
    const context = createWorkspaceContext({
        workspaceRoot: args.workspaceRoot,
        dataRoot: args.dataRoot,
        layout: 'external-data',
    });
    const projectGlobal = buildProjectGlobalFreshness(context);
    const result = {
        workspaceRoot: context.workspaceRoot,
        dataRoot: context.dataRoot,
        layout: context.layout,
        projectGlobal,
    };
    if (args.feature) {
        result.feature = {
            featureKey: args.feature,
            freshness: buildFeatureFreshness(context, args.feature),
        };
    }
    return textResult(result);
}

function resolveFreshnessPolicy(args = {}) {
    const requested = String(args.freshnessPolicy || '').trim();
    if (!requested) {
        return DEFAULT_FRESHNESS_POLICY;
    }
    return FRESHNESS_POLICIES.has(requested) ? requested : DEFAULT_FRESHNESS_POLICY;
}

function summarizeFreshness(freshness) {
    return {
        status: freshness?.status || 'unknown',
        stale: Boolean(freshness?.stale),
        reasonCodes: Array.isArray(freshness?.reasonCodes) ? freshness.reasonCodes : [],
        recommendedAction: freshness?.recommendedAction || '',
    };
}

function buildFreshnessMeta({ scope, policy, initialFreshness, finalFreshness, rebuilt = false, output = '', error = '' }) {
    return {
        scope,
        policy,
        initialStatus: initialFreshness?.status || 'unknown',
        finalStatus: finalFreshness?.status || initialFreshness?.status || 'unknown',
        rebuilt,
        blocked: Boolean(finalFreshness?.stale),
        initial: summarizeFreshness(initialFreshness),
        final: summarizeFreshness(finalFreshness || initialFreshness),
        rebuildOutput: output ? output.slice(-4000) : '',
        error,
    };
}

function buildNotFreshResult({ scope, policy, freshnessMeta, freshness, error = '' }) {
    return textResult({
        ok: false,
        error: error || 'KB_NOT_FRESH',
        message: policy === 'require_fresh'
            ? 'KB 状态不是 fresh，freshnessPolicy=require_fresh 已阻止查询。'
            : 'KB 自动重建后仍不是 fresh，已阻止查询旧 KB。',
        scope,
        freshnessPolicy: policy,
        kbFreshness: freshness || freshnessMeta?.final || null,
        _mcpFreshness: freshnessMeta,
    });
}

function runProjectRebuildForQuery(args) {
    const prepared = ensureWorkspacePrepared(args);
    const captured = captureConsoleLog(() => buildProjectKb(layoutArgv(args)));
    return [prepared.output, captured.output].filter(Boolean).join('\n');
}

function ensureProjectFreshForQuery(args, policy) {
    const initial = buildWorkspaceState(args).projectGlobalFreshness;
    if (policy === 'allow_stale' || !initial?.stale) {
        return {
            ok: true,
            finalFreshness: initial,
            freshnessMeta: buildFreshnessMeta({
                scope: 'project-global',
                policy,
                initialFreshness: initial,
                finalFreshness: initial,
            }),
        };
    }
    if (policy === 'require_fresh') {
        const freshnessMeta = buildFreshnessMeta({
            scope: 'project-global',
            policy,
            initialFreshness: initial,
            finalFreshness: initial,
        });
        return {
            ok: false,
            result: buildNotFreshResult({ scope: 'project-global', policy, freshnessMeta, freshness: initial }),
        };
    }

    let output = '';
    try {
        output = runProjectRebuildForQuery(args);
    } catch (error) {
        const finalFreshness = buildWorkspaceState(args).projectGlobalFreshness;
        const freshnessMeta = buildFreshnessMeta({
            scope: 'project-global',
            policy,
            initialFreshness: initial,
            finalFreshness,
            rebuilt: true,
            output,
            error: error instanceof Error ? error.message : String(error),
        });
        return {
            ok: false,
            result: buildNotFreshResult({
                scope: 'project-global',
                policy,
                freshnessMeta,
                freshness: finalFreshness,
                error: error instanceof Error ? error.message : String(error),
            }),
        };
    }

    const finalFreshness = buildWorkspaceState(args).projectGlobalFreshness;
    const freshnessMeta = buildFreshnessMeta({
        scope: 'project-global',
        policy,
        initialFreshness: initial,
        finalFreshness,
        rebuilt: true,
        output,
    });
    if (finalFreshness?.stale) {
        return {
            ok: false,
            result: buildNotFreshResult({ scope: 'project-global', policy, freshnessMeta, freshness: finalFreshness }),
        };
    }
    return { ok: true, freshnessMeta, finalFreshness };
}

function runFeatureRebuildForQuery(args) {
    const argv = [...layoutArgv(args), '--feature-key', args.feature, '--json'];
    return captureConsoleLog(() => buildFeatureIndexCli(argv)).output;
}

function ensureFeatureFreshForQuery(args, policy) {
    const context = createWorkspaceContext({
        workspaceRoot: args.workspaceRoot,
        dataRoot: args.dataRoot,
        layout: 'external-data',
    });
    const initial = buildFeatureFreshness(context, args.feature);
    if (policy === 'allow_stale' || !initial?.stale) {
        return {
            ok: true,
            finalFreshness: initial,
            freshnessMeta: buildFreshnessMeta({
                scope: `feature:${args.feature}`,
                policy,
                initialFreshness: initial,
                finalFreshness: initial,
            }),
        };
    }
    if (policy === 'require_fresh') {
        const freshnessMeta = buildFreshnessMeta({
            scope: `feature:${args.feature}`,
            policy,
            initialFreshness: initial,
            finalFreshness: initial,
        });
        return {
            ok: false,
            result: buildNotFreshResult({ scope: `feature:${args.feature}`, policy, freshnessMeta, freshness: initial }),
        };
    }

    let output = '';
    try {
        output = runFeatureRebuildForQuery(args);
    } catch (error) {
        const finalFreshness = buildFeatureFreshness(context, args.feature);
        const freshnessMeta = buildFreshnessMeta({
            scope: `feature:${args.feature}`,
            policy,
            initialFreshness: initial,
            finalFreshness,
            rebuilt: true,
            output,
            error: error instanceof Error ? error.message : String(error),
        });
        return {
            ok: false,
            result: buildNotFreshResult({
                scope: `feature:${args.feature}`,
                policy,
                freshnessMeta,
                freshness: finalFreshness,
                error: error instanceof Error ? error.message : String(error),
            }),
        };
    }

    const finalFreshness = buildFeatureFreshness(context, args.feature);
    const freshnessMeta = buildFreshnessMeta({
        scope: `feature:${args.feature}`,
        policy,
        initialFreshness: initial,
        finalFreshness,
        rebuilt: true,
        output,
    });
    if (finalFreshness?.stale) {
        return {
            ok: false,
            result: buildNotFreshResult({ scope: `feature:${args.feature}`, policy, freshnessMeta, freshness: finalFreshness }),
        };
    }
    return { ok: true, freshnessMeta, finalFreshness };
}

function buildProjectIndex(args) {
    if (args.dryRun !== false) {
        return inspectWorkspace(args);
    }
    const prepared = ensureWorkspacePrepared(args);
    const captured = captureConsoleLog(() => buildProjectKb(layoutArgv(args)));
    return textResult({
        ...buildWorkspaceState(args),
        output: [prepared.output, captured.output].filter(Boolean).join('\n'),
    });
}

function createJob(type, args) {
    const jobId = `job-${Date.now()}-${nextJobId++}`;
    const job = {
        jobId,
        type,
        args: { ...args },
        status: 'queued',
        phase: 'queued',
        startedAt: null,
        endedAt: null,
        exitCode: null,
        output: '',
        error: '',
    };
    jobs.set(jobId, job);
    return job;
}

function runNodeScript(job, phase, scriptName, args) {
    return new Promise(resolve => {
        job.phase = phase;
        const child = spawn(process.execPath, [path.resolve(__dirname, '..', 'bin', scriptName), ...args], {
            cwd: path.resolve(__dirname, '..', '..'),
            windowsHide: true,
        });
        child.stdout.on('data', chunk => {
            job.output += chunk.toString();
        });
        child.stderr.on('data', chunk => {
            job.error += chunk.toString();
        });
        child.on('close', code => {
            job.exitCode = code;
            resolve(code === 0);
        });
        child.on('error', error => {
            job.error += `${error.message}\n`;
            job.exitCode = 1;
            resolve(false);
        });
    });
}

async function runBuildJob(job) {
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    const args = layoutArgv(job.args);
    const initOk = await runNodeScript(job, 'init', 'init-workspace.js', args);
    if (!initOk) {
        job.status = 'failed';
        job.endedAt = new Date().toISOString();
        return;
    }
    if (job.args.forceTopology !== false) {
        const topologyOk = await runNodeScript(job, 'topology', 'detect-topology.js', args);
        if (!topologyOk) {
            job.status = 'failed';
            job.endedAt = new Date().toISOString();
            return;
        }
    }
    const buildOk = await runNodeScript(job, 'build', 'build-project.js', args);
    job.status = buildOk ? 'succeeded' : 'failed';
    job.phase = buildOk ? 'done' : job.phase;
    job.endedAt = new Date().toISOString();
}

function runBuildJobWithTimeout(job, timeoutMs) {
    return new Promise(resolve => {
        const timer = setTimeout(() => resolve('timeout'), timeoutMs);
        runBuildJob(job)
            .then(() => {
                clearTimeout(timer);
                resolve('finished');
            })
            .catch(error => {
                clearTimeout(timer);
                job.status = 'failed';
                job.endedAt = new Date().toISOString();
                job.error += `${error instanceof Error ? error.message : String(error)}\n`;
                job.exitCode = job.exitCode ?? 1;
                resolve('finished');
            });
    });
}

function publicJob(job) {
    const isFinal = job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled';
    return {
        jobId: job.jobId,
        type: job.type,
        status: job.status,
        phase: job.phase,
        startedAt: job.startedAt,
        endedAt: job.endedAt,
        exitCode: isFinal ? job.exitCode : null,
        outputTail: job.output.slice(-4000),
        errorTail: job.error.slice(-4000),
    };
}

async function startBuildProjectIndex(args) {
    const job = createJob('build_project_index', args);
    if (args.wait === true) {
        const timeoutMs = resolveBuildWaitTimeoutMs(args.timeoutMs);
        const outcome = await runBuildJobWithTimeout(job, timeoutMs);
        const payload = {
            ...publicJob(job),
            wait: true,
            timeoutMs,
            timedOut: outcome === 'timeout',
        };
        if (outcome === 'finished') {
            return textResult({
                ...payload,
                ...buildWorkspaceState(job.args),
            });
        }
        return textResult(payload);
    }
    setImmediate(() => runBuildJob(job));
    return textResult({
        ...publicJob(job),
        wait: false,
    });
}

function getJobStatus(args) {
    const job = jobs.get(args.jobId);
    if (!job) {
        return textResult({ status: 'missing', jobId: args.jobId, isError: true });
    }
    return textResult(publicJob(job));
}

function getJobResult(args) {
    const job = jobs.get(args.jobId);
    if (!job) {
        return textResult({ status: 'missing', jobId: args.jobId, isError: true });
    }
    return textResult({
        ...publicJob(job),
        ...buildWorkspaceState(job.args),
    });
}

function discoverFeatures(args) {
    const argv = [...layoutArgv(args), '--json'];
    if (Number.isFinite(args.limit)) {
        argv.push('--limit', String(args.limit));
    }
    if (args.minConfidence) {
        argv.push('--min-confidence', args.minConfidence);
    }
    if (args.write === false) {
        argv.push('--no-write');
    }
    const captured = captureConsoleLog(() => discoverFeaturesCli(argv));
    return textResult(captured.value || captured.output);
}

function buildFeatureIndex(args) {
    const argv = [...layoutArgv(args), '--feature-key', args.featureKey, '--json'];
    if (args.dryRun !== false) {
        argv.push('--dry-run');
    }
    const captured = captureConsoleLog(() => buildFeatureIndexCli(argv));
    return textResult({
        ...(captured.value || {}),
        workspaceState: buildWorkspaceState(args),
    });
}

function agentQueryMeta(args = {}, toolName = '') {
    const options = resolveMcpQueryOptions(args);
    return {
        tool: toolName,
        limit: options.limit,
        depth: options.depth,
        freshnessPolicy: resolveFreshnessPolicy(args),
    };
}

function attachAgentMcpMetadata(payload, freshnessMeta, queryMeta) {
    return {
        ...payload,
        _mcpFreshness: freshnessMeta,
        _mcpQuery: queryMeta,
    };
}

function runAgentProjectTool(args, toolName, fn) {
    const freshnessPolicy = resolveFreshnessPolicy(args);
    const freshnessGate = ensureProjectFreshForQuery(args, freshnessPolicy);
    if (!freshnessGate.ok) {
        return freshnessGate.result;
    }
    const options = resolveMcpQueryOptions(args);
    const payload = fn({
        ...args,
        layout: 'external-data',
        limit: options.limit,
        depth: options.depth || args.depth,
    });
    return textResult(attachAgentMcpMetadata(payload, freshnessGate.freshnessMeta, agentQueryMeta(args, toolName)));
}

function prepareTaskContextTool(args) {
    if (!String(args.task || args.query || '').trim()) {
        return textResult({
            ok: false,
            error: 'MISSING_TASK',
            message: 'prepare_task_context 需要 task 或 query。',
        });
    }
    return runAgentProjectTool(args, 'prepare_task_context', prepareTaskContext);
}

function analyzeChangeImpactTool(args) {
    const hasInput = Boolean(
        (Array.isArray(args.changedFiles) && args.changedFiles.length)
        || String(args.changedFiles || '').trim()
        || String(args.changedFile || '').trim()
        || String(args.diff || '').trim()
        || String(args.diffFile || '').trim()
    );
    if (!hasInput) {
        return textResult({
            ok: false,
            error: 'MISSING_CHANGE_INPUT',
            message: 'analyze_change_impact 需要 changedFiles、changedFile、diff 或 diffFile。',
        });
    }
    return runAgentProjectTool(args, 'analyze_change_impact', analyzeChangeImpact);
}

function explainFeatureForAgentTool(args) {
    const feature = String(args.featureKey || args.feature || '').trim();
    if (!feature) {
        return textResult({
            ok: false,
            error: 'MISSING_FEATURE',
            message: 'explain_feature_for_agent 需要 featureKey 或 feature。',
        });
    }
    const freshnessPolicy = resolveFreshnessPolicy(args);
    const freshnessGate = ensureFeatureFreshForQuery({ ...args, feature }, freshnessPolicy);
    if (!freshnessGate.ok) {
        return freshnessGate.result;
    }
    const payload = explainFeatureForAgent({
        ...args,
        featureKey: feature,
        feature,
        layout: 'external-data',
    });
    return textResult(attachAgentMcpMetadata(payload, freshnessGate.freshnessMeta, agentQueryMeta(args, 'explain_feature_for_agent')));
}

function hasWorkspaceRoot(args = {}) {
    return Boolean(String(args.workspaceRoot || '').trim());
}

function attachGateOnlyMcpMetadata(payload, args, toolName) {
    return textResult({
        ...payload,
        _mcpFreshness: {
            scope: 'usage-gate',
            policy: 'gate-only',
            initialStatus: 'not-required',
            finalStatus: 'not-required',
            rebuilt: false,
            blocked: false,
        },
        _mcpQuery: agentQueryMeta(args, toolName),
    });
}

function runExecutionLoopTool(args, toolName, fn) {
    const gate = decidePmmUsage(args);
    if (gate.deepPmmRequired && !hasWorkspaceRoot(args)) {
        return textResult({
            ok: false,
            error: 'MISSING_WORKSPACE_ROOT',
            message: `${toolName} 需要 workspaceRoot 才能读取深度 PMM 上下文。`,
            pmmGate: gate,
        });
    }
    if (!gate.deepPmmRequired) {
        const payload = fn({
            ...args,
            layout: 'external-data',
        });
        return attachGateOnlyMcpMetadata(payload, args, toolName);
    }

    const freshnessPolicy = resolveFreshnessPolicy(args);
    const freshnessGate = ensureProjectFreshForQuery(args, freshnessPolicy);
    if (!freshnessGate.ok) {
        return freshnessGate.result;
    }
    const options = resolveMcpQueryOptions(args);
    const payload = fn({
        ...args,
        layout: 'external-data',
        limit: options.limit,
        depth: options.depth || args.depth,
    });
    return textResult(attachAgentMcpMetadata(payload, freshnessGate.freshnessMeta, agentQueryMeta(args, toolName)));
}

function decidePmmUsageTool(args) {
    return textResult({
        ...decidePmmUsage(args),
        _mcpQuery: agentQueryMeta(args, 'decide_pmm_usage'),
    });
}

function planTaskExecutionTool(args) {
    return runExecutionLoopTool(args, 'plan_task_execution', planTaskExecution);
}

function validateEditScopeTool(args) {
    return runExecutionLoopTool(args, 'validate_edit_scope', validateEditScope);
}

function reviewPatchForAgentTool(args) {
    return runExecutionLoopTool(args, 'review_patch_for_agent', reviewPatchForAgent);
}

function recordTaskOutcomeTool(args) {
    if (!hasWorkspaceRoot(args)) {
        return textResult({
            ok: false,
            error: 'MISSING_WORKSPACE_ROOT',
            message: 'record_task_outcome 需要 workspaceRoot。',
        });
    }
    if (!String(args.task || args.query || '').trim() || !String(args.outcome || args.summary || '').trim()) {
        return textResult({
            ok: false,
            error: 'MISSING_OUTCOME',
            message: 'record_task_outcome 需要 task 和 outcome/summary。',
        });
    }
    const payload = recordTaskOutcome({
        ...args,
        layout: 'external-data',
    });
    return textResult({
        ...payload,
        _mcpQuery: agentQueryMeta(args, 'record_task_outcome'),
    });
}

function recallTaskMemoryTool(args) {
    if (!hasWorkspaceRoot(args)) {
        return textResult({
            ok: false,
            error: 'MISSING_WORKSPACE_ROOT',
            message: 'recall_task_memory 需要 workspaceRoot。',
        });
    }
    const payload = recallTaskMemory({
        ...args,
        layout: 'external-data',
    });
    return textResult({
        ...payload,
        _mcpQuery: agentQueryMeta(args, 'recall_task_memory'),
    });
}

function prepareAgentBriefTool(args) {
    if (!hasWorkspaceRoot(args)) {
        return textResult({
            ok: false,
            error: 'MISSING_WORKSPACE_ROOT',
            message: 'prepare_agent_brief 需要 workspaceRoot。',
        });
    }
    if (!String(args.task || args.query || '').trim()) {
        return textResult({
            ok: false,
            error: 'MISSING_TASK',
            message: 'prepare_agent_brief 需要 task 或 query。',
        });
    }
    return runExecutionLoopTool(args, 'prepare_agent_brief', prepareAgentBrief);
}

function summarizeProjectMemoryTool(args) {
    if (!hasWorkspaceRoot(args)) {
        return textResult({
            ok: false,
            error: 'MISSING_WORKSPACE_ROOT',
            message: 'summarize_project_memory 需要 workspaceRoot。',
        });
    }
    const payload = summarizeProjectMemory({
        ...args,
        layout: 'external-data',
    });
    return textResult({
        ...payload,
        _mcpQuery: agentQueryMeta(args, 'summarize_project_memory'),
    });
}

function updateProjectPlaybookTool(args) {
    if (!hasWorkspaceRoot(args)) {
        return textResult({
            ok: false,
            error: 'MISSING_WORKSPACE_ROOT',
            message: 'update_project_playbook 需要 workspaceRoot。',
        });
    }
    const hasInput = String(args.rule || '').trim()
        || (Array.isArray(args.rules) && args.rules.length)
        || String(args.task || args.query || args.outcome || args.summary || '').trim()
        || (Array.isArray(args.changedFiles) && args.changedFiles.length)
        || String(args.changedFile || '').trim();
    if (!hasInput) {
        return textResult({
            ok: false,
            error: 'MISSING_PLAYBOOK_INPUT',
            message: 'update_project_playbook 需要 rule/rules，或可推断规则的 task/outcome/changedFiles。',
        });
    }
    const payload = updateProjectPlaybook({
        ...args,
        layout: 'external-data',
    });
    return textResult({
        ...payload,
        _mcpQuery: agentQueryMeta(args, 'update_project_playbook'),
    });
}

function runQueryScript(scriptName, argv, timeoutMs) {
    const startedAt = Date.now();
    const child = spawnSync(process.execPath, [path.resolve(__dirname, '..', 'bin', scriptName), ...argv], {
        cwd: path.resolve(__dirname, '..', '..'),
        encoding: 'utf8',
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer: 20 * 1024 * 1024,
    });
    const elapsedMs = Date.now() - startedAt;
    if (child.error?.code === 'ETIMEDOUT') {
        return {
            ok: false,
            timedOut: true,
            elapsedMs,
            stdout: child.stdout || '',
            stderr: child.stderr || '',
            error: `Query timed out after ${timeoutMs}ms`,
        };
    }
    if (child.error) {
        return {
            ok: false,
            timedOut: false,
            elapsedMs,
            stdout: child.stdout || '',
            stderr: child.stderr || '',
            error: child.error.message,
        };
    }
    if (child.status !== 0) {
        return {
            ok: false,
            timedOut: false,
            elapsedMs,
            stdout: child.stdout || '',
            stderr: child.stderr || '',
            error: (child.stderr || child.stdout || `Query exited with code ${child.status}`).trim(),
        };
    }
    return {
        ok: true,
        timedOut: false,
        elapsedMs,
        stdout: child.stdout || '',
        stderr: child.stderr || '',
    };
}

function appendQuerySelectorArgs(argv, args, options) {
    for (const key of ['message', 'timing', 'phase', 'transition', 'event', 'method', 'request', 'endpoint', 'state', 'type', 'name', 'tag', 'file', 'area', 'module', 'protocol', 'path', 'detail', 'mode', 'focus', 'from', 'direction']) {
        if (args[key]) {
            argv.push(`--${key}`, args[key]);
        }
    }
    if (args.excludeFile) {
        argv.push('--exclude-file', args.excludeFile);
    }
    if (args.excludePrefab) {
        argv.push('--exclude-prefab', args.excludePrefab);
    }
    if (args.excludeModule) {
        argv.push('--exclude-module', args.excludeModule);
    }
    if (args.fullstack) {
        argv.push('--fullstack');
    }
    if (args.includeUnresolved) {
        argv.push('--include-unresolved');
    }
    if (args.grouped) {
        argv.push('--grouped');
    }
    if (args.groupLimit) {
        argv.push('--group-limit', String(args.groupLimit));
    }
    if (args.instanceLimit) {
        argv.push('--instance-limit', String(args.instanceLimit));
    }
    if (args.nodePathLimit) {
        argv.push('--node-path-limit', String(args.nodePathLimit));
    }
    if (hasQuerySelector(args)) {
        argv.push('--limit', String(options.limit));
    }
    if (options.depth) {
        argv.push('--depth', String(options.depth));
    }
    if (args.upstream) {
        argv.push('--upstream');
    }
    if (args.downstream) {
        argv.push('--downstream');
    }
}

function queryProjectChain(args) {
    const options = resolveMcpQueryOptions(args);
    const freshnessPolicy = resolveFreshnessPolicy(args);
    const freshnessGate = ensureProjectFreshForQuery(args, freshnessPolicy);
    if (!freshnessGate.ok) {
        return freshnessGate.result;
    }
    const argv = [...layoutArgv(args), '--json'];
    appendQuerySelectorArgs(argv, args, options);

    const artifactState = buildProjectArtifactState(args);
    const queryMeta = {
        limit: hasQuerySelector(args) ? options.limit : null,
        depth: options.depth,
        timeoutMs: options.timeoutMs,
        freshnessPolicy,
    };
    const baseKey = JSON.stringify({
        tool: 'query_project_chain',
        workspaceRoot: artifactState.context.workspaceRoot,
        dataRoot: artifactState.context.dataRoot,
        layout: artifactState.context.layout,
        freshnessPolicy,
        argv,
    });
    const cacheKey = JSON.stringify({ baseKey, signature: artifactState.signature });
    let invalidatedByMtime = false;
    let invalidatedBySource = false;
    for (const [key, entry] of projectQueryCache.entries()) {
        if (entry.baseKey === baseKey && entry.signature !== artifactState.signature) {
            projectQueryCache.delete(key);
            if (entry.artifactSignature !== artifactState.artifactSignature) {
                invalidatedByMtime = true;
            }
            if (entry.sourceSignature !== artifactState.sourceSignature) {
                invalidatedBySource = true;
            }
        }
    }

    const cached = projectQueryCache.get(cacheKey);
    if (cached) {
        return textResult(withMcpQueryMetadata(cached.payload, {
            hit: true,
            invalidatedByMtime: false,
            invalidatedBySource: false,
            cachedAt: cached.cachedAt,
            elapsedMs: 0,
            artifacts: artifactState.artifacts,
            projectGlobalFreshness: artifactState.projectGlobalFreshness,
        }, queryMeta, freshnessGate.freshnessMeta));
    }

    const result = runQueryScript('query-project.js', argv, options.timeoutMs);
    if (!result.ok) {
        return textResult({
            ok: false,
            error: result.error,
            timedOut: result.timedOut,
            stdout: result.stdout,
            stderr: result.stderr,
            _mcpCache: {
                hit: false,
                invalidatedByMtime,
                invalidatedBySource,
                elapsedMs: result.elapsedMs,
                artifacts: artifactState.artifacts,
                projectGlobalFreshness: artifactState.projectGlobalFreshness,
            },
            _mcpQuery: queryMeta,
            _mcpFreshness: freshnessGate.freshnessMeta,
        });
    }

    const payload = parseJsonOutput(result.stdout);
    while (projectQueryCache.size >= MAX_PROJECT_QUERY_CACHE_ENTRIES) {
        evictOldestProjectQueryCacheEntry();
    }
    const cachedAt = new Date().toISOString();
    projectQueryCache.set(cacheKey, {
        baseKey,
        signature: artifactState.signature,
        artifactSignature: artifactState.artifactSignature,
        sourceSignature: artifactState.sourceSignature,
        payload,
        cachedAt,
    });
    return textResult(withMcpQueryMetadata(payload, {
        hit: false,
        invalidatedByMtime,
        invalidatedBySource,
        cachedAt,
        elapsedMs: result.elapsedMs,
        artifacts: artifactState.artifacts,
        projectGlobalFreshness: artifactState.projectGlobalFreshness,
    }, queryMeta, freshnessGate.freshnessMeta));
}

function queryFeatureChain(args) {
    const options = resolveMcpQueryOptions(args);
    const freshnessPolicy = resolveFreshnessPolicy(args);
    const freshnessGate = ensureFeatureFreshForQuery(args, freshnessPolicy);
    if (!freshnessGate.ok) {
        return freshnessGate.result;
    }
    const argv = [...layoutArgv(args), '--feature', args.feature, '--json'];
    appendQuerySelectorArgs(argv, args, options);
    const result = runQueryScript('query-feature.js', argv, options.timeoutMs);
    if (!result.ok) {
        return textResult({
            ok: false,
            error: result.error,
            timedOut: result.timedOut,
            stdout: result.stdout,
            stderr: result.stderr,
            _mcpQuery: {
                limit: hasQuerySelector(args) ? options.limit : null,
                depth: options.depth,
                timeoutMs: options.timeoutMs,
                freshnessPolicy,
            },
            _mcpFreshness: freshnessGate.freshnessMeta,
        });
    }
    const payload = parseJsonOutput(result.stdout);
    return textResult(withMcpQueryMetadata(payload, {
        hit: false,
        supported: false,
        elapsedMs: result.elapsedMs,
        featureFreshness: freshnessGate.finalFreshness,
    }, {
        limit: hasQuerySelector(args) ? options.limit : null,
        depth: options.depth,
        timeoutMs: options.timeoutMs,
        freshnessPolicy,
    }, freshnessGate.freshnessMeta));
}

async function handleMcpRequest(request) {
    if (request.method === 'initialize') {
        const version = loadSkillVersion(path.resolve(__dirname, '..', '..')).version;
        return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
                protocolVersion: '2024-11-05',
                capabilities: { tools: { listChanged: false } },
                serverInfo: { name: 'project-memory-manager', version },
            },
        };
    }
    if (request.method === 'tools/list') {
        return { jsonrpc: '2.0', id: request.id, result: { tools: TOOL_DEFINITIONS } };
    }
    if (request.method === 'tools/call') {
        const name = request.params?.name;
        const args = toolArgs(request.params);
        const result = await (name === 'inspect_workspace'
            ? inspectWorkspace(args)
            : name === 'get_current_state'
                ? getCurrentState(args)
                : name === 'register_workspace'
                    ? registerWorkspaceTool(args)
                    : name === 'list_workspaces'
                        ? listWorkspacesTool(args)
                        : name === 'resolve_workspace'
                            ? resolveWorkspaceTool(args)
                            : name === 'diagnose_data_root'
                                ? diagnoseDataRootTool(args)
                                : name === 'init_workspace'
                                    ? initWorkspace(args)
                                    : name === 'detect_topology'
                                        ? detectTopology(args)
                                        : name === 'diagnose_workspace'
                                            ? diagnoseWorkspace(args)
                                            : name === 'check_kb_freshness'
                                                ? checkKbFreshness(args)
                                                : name === 'build_project_index'
                                                    ? buildProjectIndex(args)
                                                    : name === 'start_build_project_index'
                                                        ? startBuildProjectIndex(args)
                                                        : name === 'get_job_status'
                                                            ? getJobStatus(args)
                                                            : name === 'get_job_result'
                                                                ? getJobResult(args)
                                                                : name === 'discover_features'
                                                                    ? discoverFeatures(args)
                                                                    : name === 'build_feature_index'
                                                                        ? buildFeatureIndex(args)
                                                                        : name === 'prepare_task_context'
                                                                            ? prepareTaskContextTool(args)
                                                                            : name === 'explain_feature_for_agent'
                                                                                ? explainFeatureForAgentTool(args)
                                                                                : name === 'analyze_change_impact'
                                                                                    ? analyzeChangeImpactTool(args)
                                                                                    : name === 'decide_pmm_usage'
                                                                                        ? decidePmmUsageTool(args)
                                                                                        : name === 'plan_task_execution'
                                                                                            ? planTaskExecutionTool(args)
                                                                                            : name === 'validate_edit_scope'
                                                                                                ? validateEditScopeTool(args)
                                                                                                : name === 'review_patch_for_agent'
                                                                                                    ? reviewPatchForAgentTool(args)
                                                                                                    : name === 'record_task_outcome'
                                                                                                        ? recordTaskOutcomeTool(args)
                                                                                                        : name === 'recall_task_memory'
                                                                                                            ? recallTaskMemoryTool(args)
                                                                                                            : name === 'prepare_agent_brief'
                                                                                                                ? prepareAgentBriefTool(args)
                                                                                                                : name === 'summarize_project_memory'
                                                                                                                    ? summarizeProjectMemoryTool(args)
                                                                                                                    : name === 'update_project_playbook'
                                                                                                                        ? updateProjectPlaybookTool(args)
                                                                                                                        : name === 'query_project_chain'
                                                                                                                            ? queryProjectChain(args)
                                                                                                                            : name === 'query_feature_chain'
                                                                                                                                ? queryFeatureChain(args)
                                                                                                                                : textResult({ error: `Unknown tool: ${name}` }));
        return { jsonrpc: '2.0', id: request.id, result };
    }
    if (request.id == null) {
        return null;
    }
    return {
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32601, message: `Unsupported method: ${request.method}` },
    };
}

function startStdioServer() {
    const rl = readline.createInterface({ input: process.stdin });
    rl.on('line', async line => {
        if (!line.trim()) {
            return;
        }
        try {
            const request = JSON.parse(line.replace(/^\uFEFF/, ''));
            const response = await handleMcpRequest(request);
            if (response) {
                process.stdout.write(`${JSON.stringify(response)}\n`);
            }
        } catch (error) {
            process.stdout.write(`${JSON.stringify({
                jsonrpc: '2.0',
                id: null,
                error: { code: -32603, message: error.message },
            })}\n`);
        }
    });
}

module.exports = { handleMcpRequest, run: startStdioServer, startStdioServer };

if (require.main === module) {
    startStdioServer();
}
