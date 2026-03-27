const generic = require('./generic');

function inferTopologyProfile() {
    return 'generic';
}

function getTopologyAdapters(root = process.cwd(), profile = 'auto') {
    const selectedProfile = profile === 'auto' ? inferTopologyProfile(root) : profile;
    switch (selectedProfile) {
        case 'generic':
        default:
            return [generic];
    }
}

module.exports = {
    inferTopologyProfile,
    getTopologyAdapters,
};
