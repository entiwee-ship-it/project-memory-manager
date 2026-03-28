#!/usr/bin/env node

const path = require('path');
const { normalize, readJson, resolveProjectRoot, timestamp, writeJson } = require('./lib/common');
const { loadSkillVersion } = require('./show_skill_version');

function parseArgs(argv) {
    const args = {
        root: '',
        scan: '',
        graph: '',
        lookup: '',
        output: '',
        json: false,
    };

    for (let index = 0; index < argv.length; index++) {
        const token = argv[index];
        if (token === '--root') {
            args.root = argv[++index] || '';
            continue;
        }
        if (token === '--scan') {
            args.scan = argv[++index] || '';
            continue;
        }
        if (token === '--graph') {
            args.graph = argv[++index] || '';
            continue;
        }
        if (token === '--lookup') {
            args.lookup = argv[++index] || '';
            continue;
        }
        if (token === '--output') {
            args.output = argv[++index] || '';
            continue;
        }
        if (token === '--json') {
            args.json = true;
        }
    }

    return args;
}

function loadCurrentSkillBuildInfo() {
    const versionInfo = loadSkillVersion(path.resolve(__dirname, '..'));
    return {
        name: versionInfo.name || '',
        version: versionInfo.version || '',
        repo: versionInfo.repo || '',
        capabilities: Array.isArray(versionInfo.capabilities) ? versionInfo.capabilities : [],
    };
}

function buildMethodKey(scriptPath, methodName) {
    return `${normalize(scriptPath)}::${String(methodName || '').trim()}`;
}

function unique(values) {
    return Array.from(new Set((values || []).filter(Boolean)));
}

function dedupeBy(values, selector) {
    const seen = new Set();
    const result = [];
    for (const value of values || []) {
        const key = selector(value);
        if (!key || seen.has(key)) {
            continue;
        }
        seen.add(key);
        result.push(value);
    }
    return result;
}

function buildMethodIndexes(raw, graph) {
    const rawMethodMap = new Map();
    for (const script of raw.scripts || []) {
        for (const method of script.methods || []) {
            rawMethodMap.set(buildMethodKey(script.scriptPath, method.name), {
                scriptPath: script.scriptPath,
                methodName: method.name,
                script,
                method,
            });
        }
    }

    const graphMethodMap = new Map();
    for (const node of graph.nodes || []) {
        if (node.type !== 'method') {
            continue;
        }
        const methodName = node.meta?.methodName || String(node.name || '').split('.').slice(-1)[0] || '';
        const scriptPath = node.meta?.scriptPath || node.file || '';
        graphMethodMap.set(buildMethodKey(scriptPath, methodName), node);
    }

    return { rawMethodMap, graphMethodMap };
}

function makeMethodRef(rawMethodRecord, graphMethodMap) {
    const key = buildMethodKey(rawMethodRecord.scriptPath, rawMethodRecord.methodName);
    const methodNode = graphMethodMap.get(key);
    return {
        id: methodNode?.id || '',
        name: methodNode?.name || `${path.basename(rawMethodRecord.scriptPath, path.extname(rawMethodRecord.scriptPath))}.${rawMethodRecord.methodName}`,
        scriptPath: normalize(rawMethodRecord.scriptPath),
        line: rawMethodRecord.method?.line ?? null,
        area: methodNode?.area || rawMethodRecord.method?.area || 'unknown',
    };
}

function resolveMethodNodeRef(scriptPath, methodName, graphMethodMap) {
    const key = buildMethodKey(scriptPath, methodName);
    const methodNode = graphMethodMap.get(key);
    if (!methodNode) {
        return {
            id: '',
            name: `${path.basename(scriptPath, path.extname(scriptPath))}.${methodName}`,
            scriptPath: normalize(scriptPath),
        };
    }
    return {
        id: methodNode.id,
        name: methodNode.name,
        scriptPath: normalize(scriptPath),
    };
}

function resolveImportedCallRef(importedCall, indexes) {
    if (!importedCall?.sourcePath || !importedCall?.method) {
        return importedCall?.identifier && importedCall?.method
            ? `${importedCall.identifier}.${importedCall.method}`
            : '';
    }
    return resolveMethodNodeRef(importedCall.sourcePath, importedCall.method, indexes.graphMethodMap).name;
}

function resolveFieldCallRef(fieldCall, indexes) {
    if (!fieldCall?.sourcePath || !fieldCall?.method) {
        return fieldCall?.fieldName && fieldCall?.method
            ? `${fieldCall.fieldName}.${fieldCall.method}`
            : '';
    }
    return resolveMethodNodeRef(fieldCall.sourcePath, fieldCall.method, indexes.graphMethodMap).name;
}

function extractNextMethodNames(rawMethodRecord, indexes) {
    const nextMethods = [];
    for (const callSite of rawMethodRecord.method?.localCallSites || []) {
        nextMethods.push(resolveMethodNodeRef(rawMethodRecord.scriptPath, callSite.method, indexes.graphMethodMap).name);
    }
    for (const call of rawMethodRecord.method?.importedCalls || []) {
        nextMethods.push(resolveImportedCallRef(call, indexes));
    }
    for (const call of rawMethodRecord.method?.fieldCalls || []) {
        nextMethods.push(resolveFieldCallRef(call, indexes));
    }
    return unique(nextMethods).filter(Boolean);
}

function extractMessageContext(rawMethodRecord, indexes, messagePatterns = []) {
    const methodRef = makeMethodRef(rawMethodRecord, indexes.graphMethodMap);
    const handled = [];
    const emitted = [];
    for (const pattern of messagePatterns) {
        if ((pattern.handlers || []).some(item => item.name === methodRef.name)) {
            handled.push(pattern.name);
        }
        if ((pattern.senders || []).some(item => item.name === methodRef.name)) {
            emitted.push(pattern.name);
        }
        if ((pattern.dispatchers || []).some(item => item.name === methodRef.name)) {
            handled.push(pattern.name);
        }
    }
    return {
        handledMessages: unique(handled).sort((left, right) => left.localeCompare(right)),
        emittedMessages: unique(emitted).sort((left, right) => left.localeCompare(right)),
    };
}

function buildTimingEventPattern(methodName, subscription, inlineActions, messageContext) {
    const nextMethods = unique([
        ...(inlineActions.localCalls || []).map(name => `${methodName.split('.').slice(0, -1).join('.') || methodName.split('.')[0]}.${name}`),
        ...(inlineActions.importedCalls || []).map(call => `${call.identifier}.${call.method}`),
        ...(inlineActions.fieldCalls || []).map(call => `${call.fieldName}.${call.method}`),
    ]).filter(Boolean);
    const evidenceFiles = unique([subscription.file || '']).filter(Boolean);
    const confidence = Math.min(
        0.9,
        0.45
        + (nextMethods.length > 0 ? 0.2 : 0)
        + ((inlineActions.stateWrites || []).length > 0 ? 0.15 : 0)
        + ((messageContext.handledMessages || []).length > 0 ? 0.1 : 0)
    );
    return {
        kind: 'event-gated',
        ownerMethod: methodName,
        event: subscription.event || '',
        protocol: subscription.bus || '',
        trigger: subscription.event || '',
        nextMethods,
        stateReads: inlineActions.stateReads || [],
        stateWrites: inlineActions.stateWrites || [],
        messageContext,
        confidence: Number(confidence.toFixed(2)),
        evidenceFiles,
    };
}

function ensureMessageBucket(bucketMap, messageName, protocol = '') {
    const key = String(messageName || '').trim();
    if (!key) {
        return null;
    }
    if (!bucketMap.has(key)) {
        bucketMap.set(key, {
            name: key,
            protocol: protocol || '',
            senders: [],
            handlers: [],
            dispatchers: [],
            evidence: [],
        });
    }
    const bucket = bucketMap.get(key);
    if (!bucket.protocol && protocol) {
        bucket.protocol = protocol;
    }
    return bucket;
}

function protocolFromMessageRoute(routeInfo = {}) {
    return routeInfo.protocol || (routeInfo.kind === 'table-msg' ? 'table-msg' : routeInfo.kind || '');
}

function messageNameFromRequest(request = {}) {
    const target = String(request.target || '').trim();
    if (target.startsWith('cmd:')) {
        return target.slice(4);
    }
    return '';
}

function protocolFromRequest(request = {}) {
    if (request.protocol) {
        return request.protocol;
    }
    if (String(request.callee || '').includes('tableMsg')) {
        return 'table-msg';
    }
    return '';
}

function learnMessagePatterns(raw, indexes) {
    const bucketMap = new Map();

    for (const rawMethodRecord of indexes.rawMethodMap.values()) {
        const method = rawMethodRecord.method || {};
        const methodRef = makeMethodRef(rawMethodRecord, indexes.graphMethodMap);

        for (const routeInfo of method.messageRoutes || []) {
            const bucket = ensureMessageBucket(bucketMap, routeInfo.route, protocolFromMessageRoute(routeInfo));
            if (!bucket) {
                continue;
            }
            const role = routeInfo.role || 'handler';
            const entry = {
                ...methodRef,
                role,
                kind: routeInfo.kind || '',
                protocol: protocolFromMessageRoute(routeInfo),
            };
            if (role === 'dispatcher') {
                bucket.dispatchers.push(entry);
            } else {
                bucket.handlers.push(entry);
            }
            bucket.evidence.push({
                type: 'message-route',
                file: normalize(rawMethodRecord.scriptPath),
                method: methodRef.name,
                route: routeInfo.route,
                role,
                protocol: entry.protocol,
            });
        }

        for (const request of method.networkRequests || []) {
            const messageName = messageNameFromRequest(request);
            if (!messageName) {
                continue;
            }
            const bucket = ensureMessageBucket(bucketMap, messageName, protocolFromRequest(request));
            if (!bucket) {
                continue;
            }
            bucket.senders.push({
                ...methodRef,
                callee: request.callee || '',
                protocol: protocolFromRequest(request),
            });
            bucket.evidence.push({
                type: 'network-request',
                file: normalize(rawMethodRecord.scriptPath),
                method: methodRef.name,
                callee: request.callee || '',
                target: request.target || '',
                protocol: protocolFromRequest(request),
            });
        }
    }

    return Array.from(bucketMap.values()).map(bucket => {
        const handlers = dedupeBy(bucket.handlers, item => `${item.scriptPath}::${item.name}::${item.role}`);
        const dispatchers = dedupeBy(bucket.dispatchers, item => `${item.scriptPath}::${item.name}::${item.role}`);
        const senders = dedupeBy(bucket.senders, item => `${item.scriptPath}::${item.name}::${item.callee || ''}`);
        const evidence = dedupeBy(bucket.evidence, item => `${item.type}::${item.file}::${item.method}::${item.route || item.target || ''}`);
        const confidence = Math.min(
            0.95,
            0.35
            + (handlers.length > 0 ? 0.3 : 0)
            + (senders.length > 0 ? 0.2 : 0)
            + (dispatchers.length > 0 ? 0.1 : 0)
            + (evidence.length > 2 ? 0.05 : 0)
        );
        return {
            kind: 'message-route',
            name: bucket.name,
            protocol: bucket.protocol || '',
            confidence: Number(confidence.toFixed(2)),
            handlers,
            dispatchers,
            senders,
            evidence,
            evidenceFiles: unique(evidence.map(item => item.file)),
        };
    }).sort((left, right) => left.name.localeCompare(right.name));
}

function learnDispatcherPatterns(messagePatterns = []) {
    const dispatcherMap = new Map();
    for (const pattern of messagePatterns) {
        for (const dispatcher of pattern.dispatchers || []) {
            const key = `${dispatcher.scriptPath}::${dispatcher.name}`;
            if (!dispatcherMap.has(key)) {
                dispatcherMap.set(key, {
                    kind: 'dispatcher',
                    name: dispatcher.name,
                    scriptPath: dispatcher.scriptPath,
                    area: dispatcher.area || 'unknown',
                    protocol: pattern.protocol || '',
                    messages: [],
                    evidenceFiles: [],
                });
            }
            const current = dispatcherMap.get(key);
            current.messages.push(pattern.name);
            current.evidenceFiles.push(...(pattern.evidenceFiles || []));
            if (!current.protocol && pattern.protocol) {
                current.protocol = pattern.protocol;
            }
        }
    }

    return Array.from(dispatcherMap.values()).map(item => ({
        ...item,
        confidence: Number((0.55 + Math.min(0.3, unique(item.messages).length * 0.05)).toFixed(2)),
        messages: unique(item.messages).sort((left, right) => left.localeCompare(right)),
        evidenceFiles: unique(item.evidenceFiles).sort((left, right) => left.localeCompare(right)),
    })).sort((left, right) => left.name.localeCompare(right.name));
}

function learnTimingPatterns(raw, indexes, messagePatterns = []) {
    const patterns = [];

    for (const rawMethodRecord of indexes.rawMethodMap.values()) {
        const methodRef = makeMethodRef(rawMethodRecord, indexes.graphMethodMap);
        const method = rawMethodRecord.method || {};
        const messageContext = extractMessageContext(rawMethodRecord, indexes, messagePatterns);

        for (const signal of method.timingSignals || []) {
            const nextMethods = unique([
                ...(signal.callbackLocalCalls || []).map(name => resolveMethodNodeRef(rawMethodRecord.scriptPath, name, indexes.graphMethodMap).name),
                ...(signal.callbackImportedCalls || []).map(call => resolveImportedCallRef(call, indexes)),
                ...(signal.callbackFieldCalls || []).map(call => resolveFieldCallRef(call, indexes)),
            ]).filter(Boolean);
            const confidence = Math.min(
                0.92,
                0.45
                + (nextMethods.length > 0 ? 0.2 : 0)
                + ((signal.callbackStateWrites || []).length > 0 ? 0.15 : 0)
                + (signal.delayMs ? 0.1 : 0)
                + ((messageContext.handledMessages || []).length > 0 ? 0.05 : 0)
            );
            patterns.push({
                kind: signal.kind || 'timing-signal',
                ownerMethod: methodRef.name,
                trigger: signal.delayMs ? `${signal.callee}:${signal.delayMs}` : signal.callee || '',
                callee: signal.callee || '',
                delayMs: signal.delayMs || '',
                event: signal.event || '',
                callbackKind: signal.callbackKind || 'none',
                callbackRef: signal.callbackRef || '',
                nextMethods,
                stateReads: signal.callbackStateReads || [],
                stateWrites: signal.callbackStateWrites || [],
                messageContext,
                confidence: Number(confidence.toFixed(2)),
                evidenceFiles: [normalize(rawMethodRecord.scriptPath)],
            });
        }

        for (const subscription of method.eventSubscriptions || []) {
            const inlineActions = subscription.inlineActions || null;
            if (!inlineActions || !subscription.event) {
                continue;
            }
            if (!/(anim|animation|tween|finish|finished|complete|completed|end|ended|delay|wait|after)/i.test(subscription.event)) {
                continue;
            }
            patterns.push({
                ...buildTimingEventPattern(methodRef.name, { ...subscription, file: normalize(rawMethodRecord.scriptPath) }, inlineActions, messageContext),
            });
        }

        for (const request of method.networkRequests || []) {
            const nextMethods = unique([
                ...(request.callbackLocalCalls || []).map(name => resolveMethodNodeRef(rawMethodRecord.scriptPath, name, indexes.graphMethodMap).name),
                ...(request.callbackImportedCalls || []).map(call => resolveImportedCallRef(call, indexes)),
                ...(request.callbackFieldCalls || []).map(call => resolveFieldCallRef(call, indexes)),
            ]).filter(Boolean);
            if (nextMethods.length <= 0) {
                continue;
            }
            patterns.push({
                kind: 'request-callback',
                ownerMethod: methodRef.name,
                trigger: request.target || request.callee || '',
                callee: request.callee || '',
                delayMs: '',
                event: '',
                callbackKind: request.callbackKind || 'none',
                callbackRef: request.callbackRef || '',
                nextMethods,
                stateReads: [],
                stateWrites: [],
                messageContext,
                confidence: 0.62,
                evidenceFiles: [normalize(rawMethodRecord.scriptPath)],
            });
        }
    }

    return dedupeBy(
        patterns.map(item => ({
            ...item,
            nextMethods: unique(item.nextMethods).sort((left, right) => left.localeCompare(right)),
            stateReads: unique(item.stateReads).sort((left, right) => left.localeCompare(right)),
            stateWrites: unique(item.stateWrites).sort((left, right) => left.localeCompare(right)),
            evidenceFiles: unique(item.evidenceFiles).sort((left, right) => left.localeCompare(right)),
        })),
        item => `${item.kind}::${item.ownerMethod}::${item.trigger}::${item.callbackRef}::${item.nextMethods.join(',')}::${item.stateWrites.join(',')}`
    );
}

function learnStateMachinePatterns(messagePatterns = [], indexes) {
    const stateMap = new Map();

    for (const pattern of messagePatterns) {
        for (const handler of pattern.handlers || []) {
            const rawMethodRecord = indexes.rawMethodMap.get(buildMethodKey(handler.scriptPath, handler.name.split('.').slice(-1)[0]));
            if (!rawMethodRecord) {
                continue;
            }
            const stateReads = rawMethodRecord.method?.stateReads || [];
            const stateWrites = rawMethodRecord.method?.stateWrites || [];
            const touchedStates = unique([...(stateReads || []), ...(stateWrites || [])]);
            for (const stateName of touchedStates) {
                const key = `${pattern.name}::${stateName}`;
                if (!stateMap.has(key)) {
                    stateMap.set(key, {
                        kind: 'message-state-pattern',
                        message: pattern.name,
                        state: stateName,
                        protocol: pattern.protocol || '',
                        readers: [],
                        writers: [],
                        handlers: [],
                        evidenceFiles: [],
                    });
                }
                const current = stateMap.get(key);
                current.handlers.push(handler.name);
                current.evidenceFiles.push(normalize(rawMethodRecord.scriptPath));
                if (stateReads.includes(stateName)) {
                    current.readers.push(handler.name);
                }
                if (stateWrites.includes(stateName)) {
                    current.writers.push(handler.name);
                }
            }
        }
    }

    return Array.from(stateMap.values()).map(item => {
        const readers = unique(item.readers).sort((left, right) => left.localeCompare(right));
        const writers = unique(item.writers).sort((left, right) => left.localeCompare(right));
        const handlers = unique(item.handlers).sort((left, right) => left.localeCompare(right));
        const confidence = Math.min(
            0.9,
            0.45
            + (readers.length > 0 ? 0.15 : 0)
            + (writers.length > 0 ? 0.2 : 0)
            + (readers.length > 0 && writers.length > 0 ? 0.1 : 0)
        );
        return {
            ...item,
            transitionKind: readers.length > 0 && writers.length > 0
                ? 'cycle'
                : writers.length > 0
                  ? 'state-write'
                  : 'state-read',
            confidence: Number(confidence.toFixed(2)),
            readers,
            writers,
            handlers,
            evidenceFiles: unique(item.evidenceFiles).sort((left, right) => left.localeCompare(right)),
        };
    }).sort((left, right) => `${left.message}::${left.state}`.localeCompare(`${right.message}::${right.state}`));
}

function learnPhasePatterns(raw, indexes, messagePatterns = [], timingPatterns = []) {
    const timingByOwner = new Map();
    for (const pattern of timingPatterns) {
        const bucket = timingByOwner.get(pattern.ownerMethod) || [];
        bucket.push(pattern);
        timingByOwner.set(pattern.ownerMethod, bucket);
    }

    const patterns = [];
    for (const rawMethodRecord of indexes.rawMethodMap.values()) {
        const methodRef = makeMethodRef(rawMethodRecord, indexes.graphMethodMap);
        const method = rawMethodRecord.method || {};
        const messageContext = extractMessageContext(rawMethodRecord, indexes, messagePatterns);
        const directNextMethods = extractNextMethodNames(rawMethodRecord, indexes);
        const timing = timingByOwner.get(methodRef.name) || [];
        const asyncNextMethods = unique(timing.flatMap(item => item.nextMethods || []));
        const stateReads = unique(method.stateReads || []);
        const stateWrites = unique(method.stateWrites || []);
        const nextMethods = unique([...directNextMethods, ...asyncNextMethods]);

        if (
            nextMethods.length <= 0
            && stateReads.length <= 0
            && stateWrites.length <= 0
            && (messageContext.handledMessages || []).length <= 0
            && (messageContext.emittedMessages || []).length <= 0
        ) {
            continue;
        }

        const phaseConfidence = Math.min(
            0.94,
            0.38
            + (nextMethods.length > 0 ? 0.2 : 0)
            + (stateWrites.length > 0 ? 0.16 : 0)
            + ((messageContext.handledMessages || []).length > 0 ? 0.12 : 0)
            + (timing.length > 0 ? 0.08 : 0)
        );

        patterns.push({
            kind: 'phase-sequence',
            name: methodRef.name,
            entryMethod: methodRef.name,
            handledMessages: messageContext.handledMessages || [],
            emittedMessages: messageContext.emittedMessages || [],
            stateReads,
            stateWrites,
            directNextMethods,
            asyncNextMethods,
            nextMethods,
            timingKinds: unique(timing.map(item => item.kind)).sort((left, right) => left.localeCompare(right)),
            confidence: Number(phaseConfidence.toFixed(2)),
            evidenceFiles: [normalize(rawMethodRecord.scriptPath)],
        });
    }

    return patterns.sort((left, right) => left.name.localeCompare(right.name));
}

function learnTransitionPatterns(phasePatterns = [], timingPatterns = []) {
    const timingByOwner = new Map();
    for (const pattern of timingPatterns) {
        const bucket = timingByOwner.get(pattern.ownerMethod) || [];
        bucket.push(pattern);
        timingByOwner.set(pattern.ownerMethod, bucket);
    }

    const transitions = [];
    for (const phase of phasePatterns) {
        const timing = timingByOwner.get(phase.entryMethod) || [];
        for (const stateName of phase.stateWrites || []) {
            transitions.push({
                kind: 'state-transition',
                name: `${phase.entryMethod} -> ${stateName}`,
                state: stateName,
                driverMethod: phase.entryMethod,
                handledMessages: phase.handledMessages || [],
                emittedMessages: phase.emittedMessages || [],
                nextMethods: phase.nextMethods || [],
                timingKinds: phase.timingKinds || [],
                transitionKind: (phase.stateReads || []).includes(stateName) ? 'state-cycle' : 'state-progress',
                delayKinds: unique(timing.map(item => item.kind)).sort((left, right) => left.localeCompare(right)),
                confidence: Number(Math.min(
                    0.95,
                    0.45
                    + ((phase.nextMethods || []).length > 0 ? 0.18 : 0)
                    + ((phase.handledMessages || []).length > 0 ? 0.12 : 0)
                    + ((phase.timingKinds || []).length > 0 ? 0.08 : 0)
                    + ((phase.stateReads || []).includes(stateName) ? 0.06 : 0)
                ).toFixed(2)),
                evidenceFiles: phase.evidenceFiles || [],
            });
        }
    }

    return dedupeBy(
        transitions,
        item => `${item.state}::${item.driverMethod}::${item.transitionKind}::${(item.handledMessages || []).join(',')}`
    ).sort((left, right) => left.name.localeCompare(right.name));
}

function learnRoutingPatterns(raw, messagePatterns = []) {
    const routeKinds = new Map();
    const requestProtocols = new Map();

    for (const script of raw.scripts || []) {
        for (const method of script.methods || []) {
            for (const routeInfo of method.messageRoutes || []) {
                const key = `${routeInfo.kind || ''}::${routeInfo.protocol || ''}`;
                routeKinds.set(key, (routeKinds.get(key) || 0) + 1);
            }
            for (const request of method.networkRequests || []) {
                const key = `${request.protocol || ''}::${request.transport || ''}::${request.callee || ''}`;
                requestProtocols.set(key, (requestProtocols.get(key) || 0) + 1);
            }
        }
    }

    const learnedMessageProtocols = dedupeBy(
        messagePatterns.map(pattern => ({
            kind: 'message-protocol',
            protocol: pattern.protocol || '',
            message: pattern.name,
            confidence: pattern.confidence,
        })),
        item => `${item.protocol}::${item.message}`
    );

    return {
        messageProtocols: learnedMessageProtocols,
        routeKinds: Array.from(routeKinds.entries()).map(([key, count]) => {
            const [kind, protocol] = key.split('::');
            return { kind, protocol, count };
        }),
        requestProtocols: Array.from(requestProtocols.entries()).map(([key, count]) => {
            const [protocol, transport, callee] = key.split('::');
            return { protocol, transport, callee, count };
        }),
    };
}

function learnProjectProtocols(raw, graph, lookup, root) {
    const indexes = buildMethodIndexes(raw, graph);
    const messagePatterns = learnMessagePatterns(raw, indexes);
    const dispatcherPatterns = learnDispatcherPatterns(messagePatterns);
    const stateMachinePatterns = learnStateMachinePatterns(messagePatterns, indexes);
    const timingPatterns = learnTimingPatterns(raw, indexes, messagePatterns);
    const phasePatterns = learnPhasePatterns(raw, indexes, messagePatterns, timingPatterns);
    const transitionPatterns = learnTransitionPatterns(phasePatterns, timingPatterns);
    const routingPatterns = learnRoutingPatterns(raw, messagePatterns);

    return {
        kind: 'project-protocols',
        generatedAt: timestamp(),
        projectRoot: normalize(root),
        builtWithSkill: loadCurrentSkillBuildInfo(),
        messagePatterns,
        dispatcherPatterns,
        stateMachinePatterns,
        timingPatterns,
        phasePatterns,
        transitionPatterns,
        routingPatterns,
        summary: {
            messages: messagePatterns.length,
            dispatchers: dispatcherPatterns.length,
            statePatterns: stateMachinePatterns.length,
            timingPatterns: timingPatterns.length,
            phasePatterns: phasePatterns.length,
            transitionPatterns: transitionPatterns.length,
            routeKinds: routingPatterns.routeKinds.length,
            requestProtocols: routingPatterns.requestProtocols.length,
        },
    };
}

function resolveArtifactPaths(root, args) {
    return {
        scanPath: path.resolve(root, args.scan || 'project-memory/kb/project-global/scan.raw.json'),
        graphPath: path.resolve(root, args.graph || 'project-memory/kb/project-global/chain.graph.json'),
        lookupPath: path.resolve(root, args.lookup || 'project-memory/kb/project-global/chain.lookup.json'),
        outputPath: path.resolve(root, args.output || 'project-memory/state/project-protocols.json'),
    };
}

function run(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    const root = resolveProjectRoot(args.root || process.cwd());
    const { scanPath, graphPath, lookupPath, outputPath } = resolveArtifactPaths(root, args);
    const raw = readJson(scanPath);
    const graph = readJson(graphPath);
    const lookup = readJson(lookupPath);
    const protocols = learnProjectProtocols(raw, graph, lookup, root);
    writeJson(outputPath, protocols);
    if (args.json) {
        console.log(JSON.stringify(protocols, null, 2));
        return;
    }
    console.log(`项目协议已学习: ${outputPath}`);
    console.log(`- messages: ${protocols.summary.messages}`);
    console.log(`- dispatchers: ${protocols.summary.dispatchers}`);
    console.log(`- statePatterns: ${protocols.summary.statePatterns}`);
    console.log(`- timingPatterns: ${protocols.summary.timingPatterns}`);
    console.log(`- phasePatterns: ${protocols.summary.phasePatterns}`);
    console.log(`- transitionPatterns: ${protocols.summary.transitionPatterns}`);
}

module.exports = {
    learnProjectProtocols,
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
