'use strict';

const assert = require('node:assert/strict');
const { buildLookup } = require('../src/graph/build-chain-kb');
const {
    LOOKUP_SCHEMA_VERSION,
    LOOKUP_STORAGE,
    hydrateLookup,
    toPersistedLookup,
} = require('../src/shared/kb-lookup');

function makeGraph() {
    return {
        featureKey: 'lookup-contract',
        featureName: 'Lookup Contract',
        nodes: [
            {
                id: 'method:a',
                type: 'method',
                name: 'A.run',
                file: 'src/a.js',
                line: 3,
                area: 'backend',
                stack: 'node',
                meta: { methodName: 'run' },
            },
            {
                id: 'method:b',
                type: 'method',
                name: 'B.finish',
                file: 'src/b.js',
                line: 7,
                area: 'backend',
                stack: 'node',
                meta: { methodName: 'finish' },
            },
        ],
        edges: [
            {
                id: 'calls:a:b',
                type: 'calls',
                from: 'method:a',
                to: 'method:b',
                meta: { confidence: 'high' },
            },
        ],
    };
}

function testThinLookupRoundTrip() {
    const graph = makeGraph();
    const runtimeLookup = buildLookup(graph);
    const persisted = JSON.parse(JSON.stringify(toPersistedLookup(runtimeLookup)));

    assert.equal(persisted.lookupSchemaVersion, LOOKUP_SCHEMA_VERSION);
    assert.equal(persisted.storage, LOOKUP_STORAGE);
    assert.equal(Object.hasOwn(persisted, 'nodesById'), false);
    assert.equal(Object.hasOwn(persisted, 'adjacency'), false);
    assert.equal(Object.hasOwn(persisted.methods['A.run'], 'outgoing'), false);
    assert.equal(Object.hasOwn(persisted.methods['A.run'], 'incoming'), false);

    const hydrated = hydrateLookup(graph, persisted);
    assert.strictEqual(hydrated.nodesById['method:a'], graph.nodes[0]);
    assert.strictEqual(hydrated.adjacency.outgoing['method:a'][0], graph.edges[0]);
    assert.strictEqual(hydrated.adjacency.incoming['method:b'][0], graph.edges[0]);
    assert.strictEqual(hydrated.methods['A.run'].outgoing[0], graph.edges[0]);
    assert.strictEqual(hydrated.methods['B.finish'].incoming[0], graph.edges[0]);
    assert.equal(hydrated.methods['A.run'].file, 'src/a.js');
}

function testLegacyLookupRemainsUnchanged() {
    const graph = makeGraph();
    const legacyLookup = buildLookup(graph);
    assert.strictEqual(hydrateLookup(graph, legacyLookup), legacyLookup);
}

testThinLookupRoundTrip();
testLegacyLookupRemainsUnchanged();
console.log('kb-lookup tests passed');
