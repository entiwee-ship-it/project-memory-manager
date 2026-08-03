const LEGACY_DIRECT_APPLY_ENV = 'PMM_ENABLE_LEGACY_DIRECT_COCOS_APPLY';

function legacyDirectCocosApplyEnabled() {
    return process.env[LEGACY_DIRECT_APPLY_ENV] === '1';
}

function assertLegacyDirectCocosApplyEnabled() {
    if (legacyDirectCocosApplyEnabled()) {
        return;
    }
    const error = new Error(
        `PMM 默认禁止直接修改 .prefab/.scene/.meta；请改用 Cocos Creator Bridge/MCP。仅兼容旧流程时才可显式设置 ${LEGACY_DIRECT_APPLY_ENV}=1。`
    );
    error.code = 'LEGACY_DIRECT_COCOS_APPLY_DISABLED';
    throw error;
}

module.exports = {
    LEGACY_DIRECT_APPLY_ENV,
    assertLegacyDirectCocosApplyEnabled,
    legacyDirectCocosApplyEnabled,
};
