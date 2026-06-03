const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createWorkspaceContext } = require('../scripts/lib/workspace-layout');
const {
    discoverFeatureCandidates,
    generateFeatureConfig,
} = require('../scripts/lib/feature-discovery');

function makeContext() {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-feature-discovery-workspace-'));
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-feature-discovery-data-'));
    return createWorkspaceContext({ workspaceRoot, dataRoot });
}

function sampleGraph() {
    return {
        nodes: [
            {
                id: 'endpoint:get:activity-goldenegg-getactivityinfo',
                type: 'endpoint',
                name: 'GET /activity/goldenEgg/getActivityInfo',
                file: 'E:/xile-workspace/qyProject/qy-server/game-server/app/http/routes/activity/goldenEgg.ts',
                area: 'backend',
                meta: {
                    path: '/activity/goldenEgg/getActivityInfo',
                    tags: ['activity', 'golden', 'egg', 'endpoint'],
                },
            },
            {
                id: 'message:pinus:app.rpc.pkclub.handler.getclubrules',
                type: 'message',
                name: 'app.rpc.pkclub.handler.getClubRules',
                file: 'E:/xile-workspace/qyProject/qy-server/game-server/app/servers/pkclub/handler/handler.ts',
                area: 'backend',
                meta: {
                    protocol: 'pinus',
                    tags: ['pinus', 'pkclub', 'club', 'rules', 'message'],
                },
            },
            {
                id: 'method:paodekuai:view',
                type: 'method',
                name: 'PaoDeKuaiViewComp.vieGuanBtn',
                file: 'E:/xile-workspace/qyProject/xy-client/assets/script/game/poker/PaoDeKuai/PaoDeKuaiViewComp.ts',
                area: 'frontend',
                meta: {
                    methodName: 'vieGuanBtn',
                    tags: ['pao', 'de', 'kuai', 'poker', 'view', 'click'],
                },
            },
        ],
        edges: [],
    };
}

function adminFullstackGraph() {
    return {
        nodes: [
            {
                id: 'script:cms-login',
                type: 'script',
                name: 'Login.vue',
                file: 'E:/xile-workspace/qyProject/cms-client/src/views/login/Login.vue',
                area: 'frontend',
                meta: { tags: ['login', 'vue', 'admin'] },
            },
            {
                id: 'request:auth-captcha',
                type: 'request',
                name: 'GET /auth/captcha',
                file: 'E:/xile-workspace/qyProject/cms-client/src/api/authApi.js',
                area: 'frontend',
                meta: { tags: ['captcha', 'auth', 'admin'] },
            },
            {
                id: 'endpoint:auth-captcha',
                type: 'endpoint',
                name: 'GET /api/auth/captcha',
                file: 'E:/xile-workspace/qyProject/cms-server/src/routes/authRoutes.ts',
                area: 'backend',
                meta: {
                    path: '/api/auth/captcha',
                    tags: ['captcha', 'auth', 'admin'],
                },
            },
            {
                id: 'method:auth-controller',
                type: 'method',
                name: 'authController.getCaptcha',
                file: 'E:/xile-workspace/qyProject/cms-server/src/controllers/authController.ts',
                area: 'backend',
                meta: { tags: ['captcha', 'auth', 'admin'] },
            },
        ],
        edges: [],
    };
}

function testDiscoversCandidatesFromGraphSignals() {
    const candidates = discoverFeatureCandidates({
        graph: sampleGraph(),
        workspaceRoot: 'E:/xile-workspace/qyProject',
        limit: 10,
    });

    const keys = candidates.map(candidate => candidate.featureKey);
    assert.ok(keys.includes('golden-egg'), 'expected HTTP endpoint feature candidate');
    assert.ok(keys.includes('pkclub'), 'expected Pinus message feature candidate');
    assert.ok(keys.includes('pao-de-kuai'), 'expected Cocos gameplay feature candidate');

    const activity = candidates.find(candidate => candidate.featureKey === 'golden-egg');
    assert.equal(activity.featureName, 'Golden Egg');
    assert.equal(activity.areas.includes('backend'), true);
    assert.equal(activity.methodRoots.includes('qy-server/game-server/app/http/routes/activity'), true);
    assert.equal(activity.confidence, 'high');
    assert.equal(activity.evidence.length > 0, true);
}

function testDiscoversAdminFullstackCandidate() {
    const candidates = discoverFeatureCandidates({
        graph: adminFullstackGraph(),
        workspaceRoot: 'E:/xile-workspace',
        limit: 10,
    });

    const admin = candidates.find(candidate => candidate.featureKey === 'qyproject-admin');
    assert.ok(admin, 'expected qyproject-admin feature candidate');
    assert.equal(admin.confidence, 'high');
    assert.equal(admin.areas.includes('frontend'), true);
    assert.equal(admin.areas.includes('backend'), true);
    assert.equal(admin.methodRoots.includes('qyProject/cms-client/src'), true);
    assert.equal(admin.methodRoots.includes('qyProject/cms-server/src'), true);
    assert.equal(admin.evidence.some(item => item.file.includes('cms-client/src/views/login/Login.vue')), true);
    assert.equal(admin.evidence.some(item => item.file.includes('cms-server/src/routes/authRoutes.ts')), true);
}

function testDiscoversAdminCandidateInsideProjectRoot() {
    const candidates = discoverFeatureCandidates({
        graph: adminFullstackGraph(),
        workspaceRoot: 'E:/xile-workspace/qyProject',
        limit: 10,
    });

    const admin = candidates.find(candidate => candidate.featureKey === 'qyproject-admin');
    assert.ok(admin, 'expected qyproject-admin feature candidate when qyProject is workspace root');
    assert.equal(admin.methodRoots.includes('cms-client/src'), true);
    assert.equal(admin.methodRoots.includes('cms-server/src'), true);
}

function testGeneratesFeatureConfigInExternalDataRoot() {
    const context = makeContext();
    const candidate = {
        featureKey: 'activity-golden-egg',
        featureName: 'Activity Golden Egg',
        summary: 'Discovered from HTTP endpoint path /activity/goldenEgg/getActivityInfo',
        areas: ['backend'],
        methodRoots: ['qy-server/game-server/app/http/routes/activity'],
        componentRoots: [],
        assetRoots: [],
        prefabs: [],
    };

    const { config, configPath } = generateFeatureConfig({ context, candidate });

    assert.equal(config.featureKey, 'activity-golden-egg');
    assert.equal(config.featureName, 'Activity Golden Egg');
    assert.equal(config.methodRoots.includes('qy-server/game-server/app/http/routes/activity'), true);
    assert.equal(config.outputs.graph, path.join(context.paths.featuresDir, 'activity-golden-egg', 'chain.graph.json'));
    assert.equal(configPath, path.join(context.paths.configsDir, 'activity-golden-egg.json'));
    assert.equal(config.registerFeature, true);
    assert.equal(fs.existsSync(path.join(context.workspaceRoot, 'project-memory')), false);
}

testDiscoversCandidatesFromGraphSignals();
testDiscoversAdminFullstackCandidate();
testDiscoversAdminCandidateInsideProjectRoot();
testGeneratesFeatureConfigInExternalDataRoot();
console.log('feature-discovery validation passed');
