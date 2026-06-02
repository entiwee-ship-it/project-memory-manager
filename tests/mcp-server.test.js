const assert = require('node:assert/strict');
const { handleMcpRequest } = require('../scripts/mcp_server');

async function testToolsList() {
    const response = await handleMcpRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
    });
    assert.equal(response.id, 1);
    assert.equal(Array.isArray(response.result.tools), true);
    assert.equal(response.result.tools.some(tool => tool.name === 'inspect_workspace'), true);
    assert.equal(response.result.tools.some(tool => tool.name === 'build_project_index'), true);
}

async function testInitialize() {
    const response = await handleMcpRequest({
        jsonrpc: '2.0',
        id: 2,
        method: 'initialize',
        params: {},
    });
    assert.equal(response.result.serverInfo.name, 'project-memory-manager');
    assert.equal(response.result.capabilities.tools.listChanged, false);
}

Promise.all([testInitialize(), testToolsList()])
    .then(() => console.log('mcp-server validation passed'))
    .catch(error => {
        console.error(error.stack || error.message);
        process.exit(1);
    });
