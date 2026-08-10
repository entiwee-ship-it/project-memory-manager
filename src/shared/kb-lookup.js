'use strict';

const LOOKUP_SCHEMA_VERSION = 2;
const LOOKUP_STORAGE = 'thin-graph-references';

function createIndex() {
    return Object.create(null);
}

function pushEdge(bucket, nodeId, edge) {
    if (!bucket[nodeId]) {
        bucket[nodeId] = [];
    }
    bucket[nodeId].push(edge);
}

/**
 * Restore the runtime lookup contract from a thin persisted lookup.
 * Old full lookups are returned unchanged for backward compatibility.
 *
 * @param {object} graph Parsed chain graph.
 * @param {object} lookup Parsed persisted lookup.
 * @returns {object} Runtime lookup with node and edge object references.
 */
function hydrateLookup(graph = {}, lookup = {}) {
    if (!lookup || lookup.storage !== LOOKUP_STORAGE) {
        return lookup;
    }

    const nodesById = createIndex();
    for (const node of graph.nodes || []) {
        if (node?.id) {
            nodesById[node.id] = node;
        }
    }

    const outgoing = createIndex();
    const incoming = createIndex();
    for (const edge of graph.edges || []) {
        if (!edge) {
            continue;
        }
        pushEdge(outgoing, edge.from, edge);
        pushEdge(incoming, edge.to, edge);
    }

    const methods = Object.create(null);
    for (const [name, method] of Object.entries(lookup.methods || {})) {
        const node = nodesById[method.id];
        methods[name] = {
            ...method,
            ...(node ? {
                file: node.file,
                line: node.line,
                area: node.area,
                stack: node.stack,
            } : {}),
            outgoing: outgoing[method.id] || [],
            incoming: incoming[method.id] || [],
        };
    }

    return {
        ...lookup,
        nodesById,
        adjacency: { outgoing, incoming },
        methods,
    };
}

/**
 * Convert a runtime lookup to a compact persisted representation.
 * Nodes and edges already live in chain.graph.json; retaining them here
 * creates a second copy that dominates both disk size and parse-time memory.
 *
 * @param {object} lookup Runtime lookup produced by buildLookup.
 * @returns {object} Thin lookup suitable for JSON persistence.
 */
function toPersistedLookup(lookup = {}) {
    const persistedMethods = Object.fromEntries(
        Object.entries(lookup.methods || {}).map(([name, method]) => {
            const { outgoing, incoming, ...metadata } = method || {};
            void outgoing;
            void incoming;
            return [name, metadata];
        })
    );

    const {
        nodesById,
        adjacency,
        methods,
        ...indexes
    } = lookup;
    void nodesById;
    void adjacency;
    void methods;

    return {
        ...indexes,
        lookupSchemaVersion: LOOKUP_SCHEMA_VERSION,
        storage: LOOKUP_STORAGE,
        methods: persistedMethods,
    };
}

module.exports = {
    LOOKUP_SCHEMA_VERSION,
    LOOKUP_STORAGE,
    hydrateLookup,
    toPersistedLookup,
};
