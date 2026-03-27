#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { createExtractContext } = require('./adapters/extract');

const DEFAULT_METHOD_SKIP = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'constructor']);

function parseArgs(argv) {
    const args = {
        componentRoots: [],
        assetRoots: [],
        methodRoots: [],
        output: '',
        prefabs: [],
        adapter: 'auto',
    };

    for (let i = 0; i < argv.length; i++) {
        const token = argv[i];
        if (token === '--component-root') {
            args.componentRoots.push(argv[++i]);
            continue;
        }
        if (token === '--asset-root') {
            args.assetRoots.push(argv[++i]);
            continue;
        }
        if (token === '--method-root') {
            args.methodRoots.push(argv[++i]);
            continue;
        }
        if (token === '--output') {
            args.output = argv[++i];
            continue;
        }
        if (token === '--adapter') {
            args.adapter = argv[++i];
            continue;
        }
        args.prefabs.push(token);
    }

    if (!args.output || (args.prefabs.length <= 0 && args.methodRoots.length <= 0)) {
        throw new Error('用法: node extract_feature_facts.js [--adapter <auto|cocos|generic>] [--component-root <dir>] [--asset-root <dir>] [--method-root <dir>] --output <file> [<prefab...>]');
    }
    if (args.assetRoots.length <= 0) {
        args.assetRoots = [...args.componentRoots];
    }

    return args;
}

function normalize(filePath) {
    return filePath.split(path.sep).join('/');
}

function basenameWithoutExt(filePath) {
    return path.basename(filePath, path.extname(filePath));
}

function ensureArray(value) {
    return Array.isArray(value) ? value : [];
}

function readJson(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(raw);
}

function listFilesRecursive(rootPath, matcher, acc = []) {
    if (!fs.existsSync(rootPath)) {
        return acc;
    }

    const stat = fs.statSync(rootPath);
    if (stat.isFile()) {
        if (matcher(rootPath)) {
            acc.push(rootPath);
        }
        return acc;
    }

    const entries = fs.readdirSync(rootPath, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(rootPath, entry.name);
        if (entry.isDirectory()) {
            listFilesRecursive(fullPath, matcher, acc);
            continue;
        }
        if (matcher(fullPath)) {
            acc.push(fullPath);
        }
    }
    return acc;
}

function collectScriptMeta(componentRoots, context) {
    const map = new Map();
    for (const adapter of context.adapters) {
        const adapterMap = adapter.collectScriptMeta?.(componentRoots, context) || new Map();
        for (const [key, value] of adapterMap.entries()) {
            map.set(key, value);
        }
    }
    return map;
}

function collectPrefabMeta(assetRoots, context) {
    const map = new Map();
    for (const adapter of context.adapters) {
        const adapterMap = adapter.collectPrefabMeta?.(assetRoots, context) || new Map();
        for (const [key, value] of adapterMap.entries()) {
            map.set(key, value);
        }
    }
    return map;
}

function cleanDocBlock(docBlock) {
    return docBlock
        .replace(/^\/\*\*[\r\n]?/, '')
        .replace(/\*\/$/, '')
        .split(/\r?\n/)
        .map(line => line.replace(/^\s*\*\s?/, '').trim())
        .filter(Boolean);
}

function summarizeDocBlock(docBlock) {
    if (!docBlock) {
        return '';
    }

    const lines = cleanDocBlock(docBlock).filter(line => !line.startsWith('@'));
    return lines[0] || '';
}

function extractLeadingDoc(source, index, allowDecorators = false) {
    let cursor = index;
    while (cursor > 0 && /\s/.test(source[cursor - 1])) {
        cursor--;
    }

    if (allowDecorators) {
        while (cursor > 0) {
            const slice = source.slice(0, cursor);
            const lineStart = slice.lastIndexOf('\n') + 1;
            const line = slice.slice(lineStart, cursor).trim();
            if (!line.startsWith('@')) {
                break;
            }
            cursor = lineStart;
            while (cursor > 0 && /\s/.test(source[cursor - 1])) {
                cursor--;
            }
        }
    }

    if (!source.slice(0, cursor).endsWith('*/')) {
        return '';
    }

    const start = source.lastIndexOf('/**', cursor);
    const end = source.lastIndexOf('*/', cursor);
    if (start === -1 || end === -1 || start > end) {
        return '';
    }

    return source.slice(start, end + 2);
}

function resolveImportPath(specifier, scriptFile, context) {
    for (const adapter of context.adapters) {
        const resolvedPath = adapter.resolveImportPath?.(specifier, scriptFile, context) || null;
        if (resolvedPath) {
            return normalize(resolvedPath);
        }
    }
    return null;
}

function parseImportIdentifiers(clause) {
    const identifiers = [];
    const normalizedClause = clause.trim();
    if (!normalizedClause) {
        return identifiers;
    }

    const pushNamed = block => {
        block
            .split(',')
            .map(item => item.trim())
            .filter(Boolean)
            .forEach(item => {
                const aliasMatch = item.match(/^(.*?)\s+as\s+(.*)$/);
                identifiers.push(aliasMatch ? aliasMatch[2].trim() : item);
            });
    };

    if (normalizedClause.startsWith('{') && normalizedClause.endsWith('}')) {
        pushNamed(normalizedClause.slice(1, -1));
        return identifiers;
    }

    if (normalizedClause.startsWith('* as ')) {
        identifiers.push(normalizedClause.slice(5).trim());
        return identifiers;
    }

    if (normalizedClause.includes(',')) {
        const firstComma = normalizedClause.indexOf(',');
        const defaultImport = normalizedClause.slice(0, firstComma).trim();
        if (defaultImport) {
            identifiers.push(defaultImport);
        }
        const rest = normalizedClause.slice(firstComma + 1).trim();
        if (rest.startsWith('{') && rest.endsWith('}')) {
            pushNamed(rest.slice(1, -1));
        } else if (rest.startsWith('* as ')) {
            identifiers.push(rest.slice(5).trim());
        }
        return identifiers;
    }

    identifiers.push(normalizedClause);
    return identifiers;
}

function extractImports(source, scriptFile, context) {
    const imports = [];
    const importPattern = /^import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?/gm;
    let match = null;

    while ((match = importPattern.exec(source))) {
        const clause = match[1].trim().replace(/\s+/g, ' ');
        const specifier = match[2].trim();
        const resolvedPath = resolveImportPath(specifier, scriptFile, context);
        imports.push({
            clause,
            specifier,
            identifiers: parseImportIdentifiers(clause),
            resolvedPath,
            isLocal: Boolean(resolvedPath),
            isApi: Boolean(resolvedPath && /Api\.ts$/.test(resolvedPath)),
            isResponse: Boolean(resolvedPath && /Response\.ts$/.test(resolvedPath)),
        });
    }

    return imports;
}

function normalizeTypeName(typeText) {
    if (!typeText) {
        return '';
    }

    const cleaned = typeText
        .replace(/\[\]/g, ' ')
        .replace(/[<>{}|&,]/g, ' ')
        .replace(/\bnull\b/g, ' ')
        .replace(/\bundefined\b/g, ' ')
        .replace(/\breadonly\b/g, ' ')
        .trim();

    const match = cleaned.match(/[A-Za-z_$][\w$]*/);
    return match ? match[0] : '';
}

function extractFieldTypes(source, imports) {
    const fieldTypes = new Map();
    const importMap = new Map();

    for (const importInfo of imports) {
        for (const identifier of importInfo.identifiers) {
            importMap.set(identifier, importInfo);
        }
    }

    const fieldPattern = /^\s*(?:public|private|protected)?\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*:\s*([^=\n;]+?)\s*(?:=\s*[^;\n]+)?[;\n]/gm;
    let match = null;

    while ((match = fieldPattern.exec(source))) {
        const fieldName = match[1];
        const rawType = match[2].trim();
        const baseType = normalizeTypeName(rawType);
        const importInfo = importMap.get(baseType) || null;

        fieldTypes.set(fieldName, {
            fieldName,
            rawType,
            baseType,
            sourcePath: importInfo?.resolvedPath || null,
            sourceSpecifier: importInfo?.specifier || '',
        });
    }

    return fieldTypes;
}

function normalizeInlineExpression(expression) {
    const normalized = String(expression || '')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\/\/.*$/gm, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const quotedMatch = normalized.match(/^['"](.+)['"]$/);
    return quotedMatch ? quotedMatch[1] : normalized;
}

function extractHandlerMaps(source) {
    const handlerMaps = new Map();
    const fieldPattern = /^\s*(?:public|private|protected)?\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*(?::\s*[^=]+)?=\s*\{([\s\S]*?)^\s*\};/gm;
    let match = null;

    while ((match = fieldPattern.exec(source))) {
        const fieldName = match[1];
        const objectBody = match[2];
        const entries = [];
        const entryPattern = /(?:\[\s*([^\]]+?)\s*\]|['"]([^'"]+)['"]|([A-Za-z_$][\w$.]*))\s*:\s*this\.([A-Za-z_$][\w$]*)/g;
        let entryMatch = null;

        while ((entryMatch = entryPattern.exec(objectBody))) {
            const rawEvent = entryMatch[1] || entryMatch[2] || entryMatch[3] || '';
            const handlerName = entryMatch[4];
            const eventName = normalizeInlineExpression(rawEvent);
            if (!eventName || !handlerName) {
                continue;
            }

            entries.push({
                event: eventName,
                handler: handlerName,
            });
        }

        if (entries.length > 0) {
            handlerMaps.set(fieldName, entries);
        }
    }

    return handlerMaps;
}

function extractBlockContent(source, openBraceIndex) {
    let depth = 0;
    for (let index = openBraceIndex; index < source.length; index++) {
        const char = source[index];
        if (char === '{') {
            depth++;
            continue;
        }
        if (char === '}') {
            depth--;
            if (depth === 0) {
                return source.slice(openBraceIndex + 1, index);
            }
        }
    }
    return '';
}

function extractWrappedContent(source, openIndex, openChar = '(', closeChar = ')') {
    const range = extractWrappedRange(source, openIndex, openChar, closeChar);
    return range ? range.content : '';
}

function extractWrappedRange(source, openIndex, openChar = '(', closeChar = ')') {
    let depth = 0;
    let quote = '';
    let escaped = false;

    for (let index = openIndex; index < source.length; index++) {
        const char = source[index];
        if (quote) {
            if (escaped) {
                escaped = false;
                continue;
            }
            if (char === '\\') {
                escaped = true;
                continue;
            }
            if (char === quote) {
                quote = '';
            }
            continue;
        }

        if (char === '"' || char === '\'' || char === '`') {
            quote = char;
            continue;
        }

        if (char === openChar) {
            depth++;
            continue;
        }
        if (char === closeChar) {
            depth--;
            if (depth === 0) {
                return {
                    content: source.slice(openIndex + 1, index),
                    closeIndex: index,
                };
            }
        }
    }

    return null;
}

function splitTopLevelArgs(content) {
    const args = [];
    let current = '';
    let parenDepth = 0;
    let braceDepth = 0;
    let bracketDepth = 0;
    let quote = '';
    let escaped = false;

    for (let index = 0; index < content.length; index++) {
        const char = content[index];

        if (quote) {
            current += char;
            if (escaped) {
                escaped = false;
                continue;
            }
            if (char === '\\') {
                escaped = true;
                continue;
            }
            if (char === quote) {
                quote = '';
            }
            continue;
        }

        if (char === '"' || char === '\'' || char === '`') {
            quote = char;
            current += char;
            continue;
        }

        if (char === '(') {
            parenDepth++;
            current += char;
            continue;
        }
        if (char === ')') {
            parenDepth--;
            current += char;
            continue;
        }
        if (char === '{') {
            braceDepth++;
            current += char;
            continue;
        }
        if (char === '}') {
            braceDepth--;
            current += char;
            continue;
        }
        if (char === '[') {
            bracketDepth++;
            current += char;
            continue;
        }
        if (char === ']') {
            bracketDepth--;
            current += char;
            continue;
        }

        if (char === ',' && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
            args.push(current.trim());
            current = '';
            continue;
        }

        current += char;
    }

    if (current.trim()) {
        args.push(current.trim());
    }

    return args;
}

function extractParamNames(paramsText) {
    return splitTopLevelArgs(paramsText)
        .map(param => {
            const normalized = param
                .replace(/^[.]{3}/, '')
                .replace(/=[\s\S]*$/, '')
                .trim();
            const match = normalized.match(/^([A-Za-z_$][\w$]*)/);
            return match ? match[1] : '';
        })
        .filter(Boolean);
}

function extractMethodDefinitions(source) {
    const definitions = [];
    const headerPattern = /^\s*(public|private|protected)?\s*(static\s+)?(async\s+)?([A-Za-z_$][\w$]*)\s*\(/gm;
    let match = null;

    while ((match = headerPattern.exec(source))) {
        const methodName = match[4];
        if (DEFAULT_METHOD_SKIP.has(methodName)) {
            continue;
        }

        const openParenIndex = headerPattern.lastIndex - 1;
        const paramRange = extractWrappedRange(source, openParenIndex, '(', ')');
        if (!paramRange) {
            continue;
        }

        let cursor = paramRange.closeIndex + 1;
        while (cursor < source.length && /\s/.test(source[cursor])) {
            cursor++;
        }

        let returnType = '';
        if (source[cursor] === ':') {
            cursor++;
            const returnStart = cursor;
            while (cursor < source.length && source[cursor] !== '{') {
                cursor++;
            }
            returnType = source.slice(returnStart, cursor).trim();
        }

        while (cursor < source.length && /\s/.test(source[cursor])) {
            cursor++;
        }
        if (source[cursor] !== '{') {
            continue;
        }

        definitions.push({
            name: methodName,
            access: (match[1] || 'public').trim(),
            static: Boolean(match[2]),
            async: Boolean(match[3]),
            params: paramRange.content.trim(),
            returnType,
            startIndex: match.index,
            openBraceIndex: cursor,
        });

        headerPattern.lastIndex = cursor + 1;
    }

    return definitions;
}

function uniqueSorted(values) {
    return Array.from(new Set(values.filter(Boolean))).sort((left, right) => left.localeCompare(right));
}

function dedupeBy(values, keySelector) {
    const result = [];
    const seen = new Set();

    for (const value of values) {
        const key = keySelector(value);
        if (!key || seen.has(key)) {
            continue;
        }
        seen.add(key);
        result.push(value);
    }

    return result;
}

function extractDirectEventSubscriptions(methodBody) {
    const subscriptions = [];
    const subscriptionPattern = /\b(eventBus|oops\.message|director)\.(on|once)\(\s*([^,\n]+?)\s*,\s*this\.([A-Za-z_$][\w$]*)/g;
    let match = null;

    while ((match = subscriptionPattern.exec(methodBody))) {
        subscriptions.push({
            bus: match[1],
            mode: match[2],
            event: normalizeInlineExpression(match[3]),
            handler: match[4],
            via: 'direct',
        });
    }

    return subscriptions.filter(subscription => subscription.event && subscription.handler);
}

function extractMappedEventSubscriptions(methodBody, handlerMaps) {
    const subscriptions = [];
    const mapPattern = /Object\.entries\(this\.([A-Za-z_$][\w$]*)\)\.forEach\(\(\[\s*([A-Za-z_$][\w$]*)\s*,\s*([A-Za-z_$][\w$]*)\s*\]\)\s*=>\s*\{([\s\S]*?)\}\s*\)/g;
    let match = null;

    while ((match = mapPattern.exec(methodBody))) {
        const fieldName = match[1];
        const eventVar = match[2];
        const handlerVar = match[3];
        const callbackBody = match[4];
        const entries = handlerMaps.get(fieldName) || [];
        if (entries.length <= 0) {
            continue;
        }

        const busPattern = new RegExp(`\\b(eventBus|oops\\.message)\\.(on|once)\\(\\s*${eventVar}\\s*,\\s*${handlerVar}\\s*,\\s*this\\s*\\)`, 'g');
        let busMatch = null;
        while ((busMatch = busPattern.exec(callbackBody))) {
            for (const entry of entries) {
                subscriptions.push({
                    bus: busMatch[1],
                    mode: busMatch[2],
                    event: entry.event,
                    handler: entry.handler,
                    via: `handlerMap:${fieldName}`,
                });
            }
        }
    }

    return subscriptions;
}

function extractVmEventSubscriptions(methodBody) {
    const subscriptions = [];
    const pattern = /\b(?:this\.)?VM\.(bindPath)\(\s*([^,\n]+?)\s*,\s*this\.([A-Za-z_$][\w$]*)/g;
    let match = null;

    while ((match = pattern.exec(methodBody))) {
        subscriptions.push({
            bus: 'VM',
            mode: match[1],
            event: normalizeInlineExpression(match[2]),
            handler: match[3],
            via: 'direct',
        });
    }

    return subscriptions.filter(subscription => subscription.event && subscription.handler);
}

function createInlineActionSummary(callInfo) {
    return {
        localCalls: callInfo.localCalls,
        importedCalls: callInfo.importedCalls,
        fieldCalls: callInfo.fieldCalls,
        eventDispatches: callInfo.eventDispatches,
        networkRequests: callInfo.networkRequests,
        callbackInvocations: callInfo.callbackInvocations,
    };
}

function extractInlineEventSubscriptions(methodBody, imports, fieldTypes, handlerMaps, paramNames) {
    const subscriptions = [];
    const pattern = /\b(eventBus|oops\.message|director)\.(on|once)\s*\(/g;
    let match = null;

    while ((match = pattern.exec(methodBody))) {
        const openParenIndex = pattern.lastIndex - 1;
        const argRange = extractWrappedRange(methodBody, openParenIndex, '(', ')');
        if (!argRange) {
            continue;
        }

        const args = splitTopLevelArgs(argRange.content);
        const callbackArg = args[1] || '';
        if (!callbackArg || !/=>|function\b/.test(callbackArg)) {
            pattern.lastIndex = argRange.closeIndex + 1;
            continue;
        }

        const callbackBody = extractInlineCallbackBody(callbackArg);
        const callbackParamsText = callbackArg.includes('=>')
            ? callbackArg
                  .slice(0, callbackArg.indexOf('=>'))
                  .trim()
                  .replace(/^async\s+/, '')
                  .replace(/^\(/, '')
                  .replace(/\)$/, '')
            : '';
        const inlineParamNames = callbackParamsText ? extractParamNames(callbackParamsText) : [];
        const inlineCallInfo = callbackBody
            ? extractMethodCalls(callbackBody, '__inline_event__', imports, fieldTypes, handlerMaps, [...paramNames, ...inlineParamNames])
            : {
                  localCalls: [],
                  importedCalls: [],
                  apiCalls: [],
                  fieldCalls: [],
                  eventSubscriptions: [],
                  eventDispatches: [],
                  networkRequests: [],
                  callbackInvocations: [],
              };

        subscriptions.push({
            bus: match[1],
            mode: match[2],
            event: normalizeInlineExpression(args[0] || ''),
            handler: '',
            via: 'inline',
            inlineActions: createInlineActionSummary(inlineCallInfo),
        });

        pattern.lastIndex = argRange.closeIndex + 1;
    }

    return subscriptions.filter(subscription => subscription.event);
}

function extractEventDispatches(methodBody) {
    const dispatches = [];
    const dispatchPattern = /\b(eventBus|oops\.message|director)\.(emitAsync|emit|dispatchEvent)\(\s*([^,\)\n]+?)(?=\s*(?:,|\)|$))/g;
    let match = null;

    while ((match = dispatchPattern.exec(methodBody))) {
        dispatches.push({
            bus: match[1],
            mode: match[2],
            event: normalizeInlineExpression(match[3]),
        });
    }

    return dispatches.filter(dispatch => dispatch.event);
}

function extractVmEventDispatches(methodBody) {
    const dispatches = [];
    const pattern = /\b(?:this\.)?VM\.(setValue|addValue)\(\s*([^,\n]+?)(?=\s*,)/g;
    let match = null;

    while ((match = pattern.exec(methodBody))) {
        dispatches.push({
            bus: 'VM',
            mode: match[1],
            event: normalizeInlineExpression(match[2]),
        });
    }

    return dispatches.filter(dispatch => dispatch.event);
}

function extractInvokedIdentifierNames(body, candidateNames) {
    const invoked = [];
    for (const name of candidateNames) {
        const pattern = new RegExp(`\\b${name.replace(/\$/g, '\\$')}(?:\\?\\.)?\\s*\\(`, 'g');
        if (pattern.test(body)) {
            invoked.push(name);
        }
    }

    return uniqueSorted(invoked);
}

function extractInlineCallbackBody(callbackArg) {
    const normalizedArg = callbackArg.trim();
    const arrowIndex = normalizedArg.indexOf('=>');
    if (arrowIndex !== -1) {
        const bodyText = normalizedArg.slice(arrowIndex + 2).trim();
        if (bodyText.startsWith('{')) {
            return extractWrappedContent(bodyText, 0, '{', '}');
        }
        return bodyText;
    }

    const functionMatch = normalizedArg.match(/^async\s+function\b|^function\b/);
    if (functionMatch) {
        const braceIndex = normalizedArg.indexOf('{');
        if (braceIndex !== -1) {
            return extractWrappedContent(normalizedArg, braceIndex, '{', '}');
        }
    }

    return '';
}

function summarizeNetworkTarget(callee, args) {
    if (/\.tableMsg$/.test(callee)) {
        const cmdMatch = args[0]?.match(/\bcmd\s*:\s*['"]([^'"]+)['"]/);
        return cmdMatch ? `cmd:${cmdMatch[1]}` : normalizeInlineExpression(args[0] || '');
    }

    if (/\.request$/.test(callee)) {
        return normalizeInlineExpression(args[0] || '');
    }

    return normalizeInlineExpression(args[0] || '');
}

function extractNetworkRequests(methodBody, imports, fieldTypes, handlerMaps, paramNames) {
    const requests = [];
    const requestPattern = /\bNet\.inst\.(tableMsg|request)\s*\(/g;
    let match = null;

    while ((match = requestPattern.exec(methodBody))) {
        const callee = `Net.inst.${match[1]}`;
        const openParenIndex = requestPattern.lastIndex - 1;
        const content = extractWrappedContent(methodBody, openParenIndex, '(', ')');
        const args = splitTopLevelArgs(content);
        const callbackArg = args.find(arg => /=>|function\b/.test(arg)) || '';
        const callbackBody = callbackArg ? extractInlineCallbackBody(callbackArg) : '';
        const callbackCallInfo = callbackBody
            ? extractMethodCalls(callbackBody, '__network_callback__', imports, fieldTypes, handlerMaps, paramNames)
            : {
                  localCalls: [],
                  importedCalls: [],
                  apiCalls: [],
                  fieldCalls: [],
                  eventSubscriptions: [],
                  eventDispatches: [],
                  networkRequests: [],
                  callbackInvocations: [],
              };

        requests.push({
            callee,
            target: summarizeNetworkTarget(callee, args),
            callbackKind: callbackArg ? 'inline' : (args[args.length - 1] && paramNames.includes(args[args.length - 1].trim()) ? 'paramRef' : 'none'),
            callbackRef: callbackArg ? '' : (args[args.length - 1] && paramNames.includes(args[args.length - 1].trim()) ? args[args.length - 1].trim() : ''),
            callbackLocalCalls: callbackCallInfo.localCalls,
            callbackImportedCalls: callbackCallInfo.importedCalls,
            callbackFieldCalls: callbackCallInfo.fieldCalls,
            callbackEventDispatches: callbackCallInfo.eventDispatches,
            callbackInvocations: callbackBody ? extractInvokedIdentifierNames(callbackBody, paramNames) : [],
        });
    }

    return dedupeBy(
        requests,
        request => `${request.callee}::${request.target}::${request.callbackKind}::${request.callbackRef}::${request.callbackLocalCalls.join(',')}`
    );
}

function extractMethodCalls(methodBody, methodName, imports, fieldTypes, handlerMaps, paramNames = []) {
    const localCalls = [];
    const localCallSites = [];
    const localPattern = /\bthis\.([A-Za-z_$][\w$]*)\s*\(/g;
    let match = null;
    while ((match = localPattern.exec(methodBody))) {
        if (match[1] !== methodName) {
            localCalls.push(match[1]);
            const openParenIndex = localPattern.lastIndex - 1;
            const argRange = extractWrappedRange(methodBody, openParenIndex, '(', ')');
            localCallSites.push({
                method: match[1],
                args: argRange ? splitTopLevelArgs(argRange.content) : [],
            });
            if (argRange) {
                localPattern.lastIndex = argRange.closeIndex + 1;
            }
        }
    }

    const importedCalls = [];
    for (const importInfo of imports) {
        for (const identifier of importInfo.identifiers) {
            const callPattern = new RegExp(`\\b${identifier.replace(/\$/g, '\\$')}\\.([A-Za-z_$][\\w$]*)\\s*\\(`, 'g');
            let callMatch = null;
            while ((callMatch = callPattern.exec(methodBody))) {
                importedCalls.push({
                    identifier,
                    method: callMatch[1],
                    sourcePath: importInfo.resolvedPath,
                    sourceSpecifier: importInfo.specifier,
                    isApi: importInfo.isApi,
                });
            }
        }
    }

    const fieldCalls = [];
    const fieldCallPattern = /\bthis\.([A-Za-z_$][\w$]*)(?:\?\.|\.)\s*([A-Za-z_$][\w$]*)\s*\(/g;
    let fieldMatch = null;
    while ((fieldMatch = fieldCallPattern.exec(methodBody))) {
        const fieldName = fieldMatch[1];
        const calledMethod = fieldMatch[2];
        const fieldType = fieldTypes.get(fieldName);
        if (!fieldType || !fieldType.sourcePath) {
            continue;
        }

        fieldCalls.push({
            fieldName,
            fieldType: fieldType.baseType,
            method: calledMethod,
            sourcePath: fieldType.sourcePath,
            sourceSpecifier: fieldType.sourceSpecifier,
        });
    }

    const eventSubscriptions = dedupeBy(
        [
            ...extractDirectEventSubscriptions(methodBody),
            ...extractInlineEventSubscriptions(methodBody, imports, fieldTypes, handlerMaps, paramNames),
            ...extractMappedEventSubscriptions(methodBody, handlerMaps),
            ...extractVmEventSubscriptions(methodBody),
        ],
        subscription => `${subscription.bus}::${subscription.mode}::${subscription.event}::${subscription.handler || '(inline)'}::${subscription.via}`
    );
    const eventDispatches = dedupeBy(
        [
            ...extractEventDispatches(methodBody),
            ...extractVmEventDispatches(methodBody),
        ],
        dispatch => `${dispatch.bus}::${dispatch.mode}::${dispatch.event}`
    );
    const networkRequests = extractNetworkRequests(methodBody, imports, fieldTypes, handlerMaps, paramNames);
    const callbackInvocations = extractInvokedIdentifierNames(methodBody, paramNames);

    return {
        localCalls: uniqueSorted(localCalls),
        localCallSites: dedupeBy(localCallSites, callSite => `${callSite.method}::${callSite.args.join('||')}`),
        importedCalls: uniqueSorted(importedCalls.map(call => `${call.identifier}.${call.method}`)).map(signature => {
            const [identifier, method] = signature.split('.');
            const sample = importedCalls.find(call => call.identifier === identifier && call.method === method);
            return {
                identifier,
                method,
                sourcePath: sample?.sourcePath || null,
                sourceSpecifier: sample?.sourceSpecifier || '',
                isApi: Boolean(sample?.isApi),
            };
        }),
        apiCalls: uniqueSorted(importedCalls.filter(call => call.isApi).map(call => `${call.identifier}.${call.method}`)),
        fieldCalls: uniqueSorted(fieldCalls.map(call => `${call.fieldName}.${call.method}`)).map(signature => {
            const [fieldName, method] = signature.split('.');
            const sample = fieldCalls.find(call => call.fieldName === fieldName && call.method === method);
            return {
                fieldName,
                fieldType: sample?.fieldType || '',
                method,
                sourcePath: sample?.sourcePath || null,
                sourceSpecifier: sample?.sourceSpecifier || '',
            };
        }),
        eventSubscriptions,
        eventDispatches,
        networkRequests,
        callbackInvocations,
    };
}

function extractExports(source) {
    const exports = [];
    const exportPattern = /export\s+(type|enum|class|interface|const|function)\s+([A-Za-z_$][\w$]*)/g;
    let match = null;

    while ((match = exportPattern.exec(source))) {
        const docBlock = extractLeadingDoc(source, match.index, true);
        exports.push({
            kind: match[1],
            name: match[2],
            line: source.slice(0, match.index).split(/\r?\n/).length,
            summary: summarizeDocBlock(docBlock),
        });
    }

    return exports;
}

function extractScriptSummary(source, scriptFile, exports) {
    const classPattern = /(?:@[^\n]+\s*)*export\s+class\s+([A-Za-z_$][\w$]*)/g;
    const classMatch = classPattern.exec(source);
    if (classMatch) {
        const docBlock = extractLeadingDoc(source, classMatch.index, true);
        const summary = summarizeDocBlock(docBlock);
        if (summary) {
            return summary;
        }
    }

    const firstExportSummary = exports.find(item => item.summary);
    if (firstExportSummary) {
        return firstExportSummary.summary;
    }

    for (const methodDef of extractMethodDefinitions(source)) {
        const summary = summarizeDocBlock(extractLeadingDoc(source, methodDef.startIndex));
        if (summary) {
            return summary;
        }
    }

    return basenameWithoutExt(scriptFile);
}

function extractScriptInsights(methodRoots, context) {
    const result = [];

    for (const root of methodRoots) {
        const scriptFiles = listFilesRecursive(root, filePath => filePath.endsWith('.ts'));
        for (const scriptFile of scriptFiles) {
            const normalizedScript = normalize(scriptFile);
            const source = fs.readFileSync(scriptFile, 'utf8');
            const imports = extractImports(source, scriptFile, context);
            const fieldTypes = extractFieldTypes(source, imports);
            const handlerMaps = extractHandlerMaps(source);
            const exports = extractExports(source);
            const methods = [];
            for (const methodDef of extractMethodDefinitions(source)) {
                const line = source.slice(0, methodDef.startIndex).split(/\r?\n/).length;
                const docBlock = extractLeadingDoc(source, methodDef.startIndex);
                const methodBody = extractBlockContent(source, methodDef.openBraceIndex);
                const paramNames = extractParamNames(methodDef.params);
                const callInfo = extractMethodCalls(methodBody, methodDef.name, imports, fieldTypes, handlerMaps, paramNames);

                methods.push({
                    name: methodDef.name,
                    access: methodDef.access,
                    static: methodDef.static,
                    async: methodDef.async,
                    params: methodDef.params,
                    returnType: methodDef.returnType,
                    paramNames,
                    line,
                    summary: summarizeDocBlock(docBlock),
                    localCalls: callInfo.localCalls,
                    localCallSites: callInfo.localCallSites,
                    importedCalls: callInfo.importedCalls,
                    apiCalls: callInfo.apiCalls,
                    fieldCalls: callInfo.fieldCalls,
                    eventSubscriptions: callInfo.eventSubscriptions,
                    eventDispatches: callInfo.eventDispatches,
                    networkRequests: callInfo.networkRequests,
                    callbackInvocations: callInfo.callbackInvocations,
                });
            }

            result.push({
                scriptPath: normalizedScript,
                summary: extractScriptSummary(source, scriptFile, exports),
                imports,
                fieldTypes: Array.from(fieldTypes.values()),
                handlerMaps: Array.from(handlerMaps.entries()).map(([fieldName, entries]) => ({
                    fieldName,
                    entries,
                })),
                exports,
                methods,
            });
        }
    }

    return result;
}

function createAnalyzer(prefabPath, scriptMetaMap, prefabMetaMap, prefabCache) {
    const normalizedPrefabPath = normalize(prefabPath);
    if (prefabCache.has(normalizedPrefabPath)) {
        return prefabCache.get(normalizedPrefabPath);
    }

    const objects = readJson(prefabPath);
    const analyzer = {
        prefabPath: normalizedPrefabPath,
        objects,
        scriptMetaMap,
        prefabMetaMap,
        prefabCache,
        pathByNodeId: new Map(),
        infoByNodeId: new Map(),
        componentByFileId: new Map(),
        overridesByPrefabInstanceId: new Map(),
        nestedPrefabByNodeId: new Map(),
        customComponents: [],
        keyNodes: [],
        events: [],
        rootNodeId: objects?.[0]?.data?.__id__ ?? 1,
    };
    prefabCache.set(normalizedPrefabPath, analyzer);

    buildPrefabInstanceOverrides(analyzer);
    buildNestedPrefabInfo(analyzer);
    buildNodePaths(analyzer);
    buildComponentFileIdMap(analyzer);
    analyzer.keyNodes = collectKeyNodes(analyzer);
    analyzer.customComponents = collectCustomComponents(analyzer);
    analyzer.events = collectEvents(analyzer);

    return analyzer;
}

function buildPrefabInstanceOverrides(analyzer) {
    analyzer.objects.forEach((object, index) => {
        if (object?.__type__ !== 'cc.PrefabInstance') {
            return;
        }

        const overrideMap = {};
        for (const overrideRef of ensureArray(object.propertyOverrides)) {
            const overrideObject = analyzer.objects[overrideRef.__id__];
            if (!overrideObject || overrideObject.__type__ !== 'CCPropertyOverrideInfo') {
                continue;
            }
            const propertyPath = ensureArray(overrideObject.propertyPath).join('.');
            if (!propertyPath) {
                continue;
            }
            overrideMap[propertyPath] = overrideObject.value;
        }

        analyzer.overridesByPrefabInstanceId.set(index, overrideMap);
    });
}

function buildNestedPrefabInfo(analyzer) {
    analyzer.objects.forEach((object, index) => {
        if (object?.__type__ !== 'cc.Node' || !object._prefab?.__id__) {
            return;
        }

        const prefabInfo = analyzer.objects[object._prefab.__id__];
        if (!prefabInfo || prefabInfo.__type__ !== 'cc.PrefabInfo' || !prefabInfo.asset?.__uuid__) {
            return;
        }

        const nestedPrefabPath = analyzer.prefabMetaMap.get(prefabInfo.asset.__uuid__) || null;
        const instanceOverrides = prefabInfo.instance?.__id__ != null ? analyzer.overridesByPrefabInstanceId.get(prefabInfo.instance.__id__) || {} : {};
        analyzer.nestedPrefabByNodeId.set(index, {
            nestedPrefabPath,
            nestedPrefabUuid: prefabInfo.asset.__uuid__,
            overrides: instanceOverrides,
        });
    });
}

function resolveNodeName(analyzer, nodeId) {
    const node = analyzer.objects[nodeId];
    if (!node) {
        return `Node#${nodeId}`;
    }
    if (node._name) {
        return node._name;
    }

    const nestedPrefabInfo = analyzer.nestedPrefabByNodeId.get(nodeId);
    if (nestedPrefabInfo?.overrides?._name) {
        return nestedPrefabInfo.overrides._name;
    }
    if (nestedPrefabInfo?.nestedPrefabPath) {
        return path.basename(nestedPrefabInfo.nestedPrefabPath, '.prefab');
    }
    return `Node#${nodeId}`;
}

function resolveNodeActive(analyzer, nodeId) {
    const node = analyzer.objects[nodeId];
    if (typeof node?._active === 'boolean') {
        return node._active;
    }
    const nestedPrefabInfo = analyzer.nestedPrefabByNodeId.get(nodeId);
    if (typeof nestedPrefabInfo?.overrides?._active === 'boolean') {
        return nestedPrefabInfo.overrides._active;
    }
    return true;
}

function buildNodePaths(analyzer) {
    const visit = (nodeId, parentPath = '') => {
        const node = analyzer.objects[nodeId];
        if (!node || node.__type__ !== 'cc.Node') {
            return;
        }

        const nodeName = resolveNodeName(analyzer, nodeId);
        const nodePath = parentPath ? `${parentPath}/${nodeName}` : nodeName;
        analyzer.pathByNodeId.set(nodeId, nodePath);
        analyzer.infoByNodeId.set(nodeId, {
            nodeId,
            path: nodePath,
            active: resolveNodeActive(analyzer, nodeId),
            name: nodeName,
            nestedPrefab: analyzer.nestedPrefabByNodeId.get(nodeId) || null,
        });

        for (const childRef of ensureArray(node._children)) {
            visit(childRef.__id__, nodePath);
        }
    };

    visit(analyzer.rootNodeId, '');
}

function buildComponentFileIdMap(analyzer) {
    analyzer.objects.forEach((object, index) => {
        if (!object || !object.node?.__id__ || !object.__prefab?.__id__) {
            return;
        }

        const prefabInfo = analyzer.objects[object.__prefab.__id__];
        if (!prefabInfo?.fileId) {
            return;
        }

        analyzer.componentByFileId.set(prefabInfo.fileId, { componentId: index, object });
    });
}

function collectKeyNodes(analyzer) {
    const interestingComponentTypes = new Set(['cc.Button', 'cc.Toggle', 'VScrollViewMode', 'BhvFrameIndex']);
    const keyNodes = [];

    analyzer.infoByNodeId.forEach((nodeInfo, nodeId) => {
        const node = analyzer.objects[nodeId];
        const componentSummaries = [];

        for (const componentRef of ensureArray(node._components)) {
            const componentObject = analyzer.objects[componentRef.__id__];
            if (!componentObject) {
                continue;
            }

            const componentSummary = getComponentDescriptor(componentObject, analyzer.scriptMetaMap);
            if (!componentSummary) {
                continue;
            }

            componentSummaries.push(componentSummary);
        }

        const shouldKeep = nodeInfo.nestedPrefab
            || componentSummaries.some(component => component.isCustom || interestingComponentTypes.has(component.name))
            || componentSummaries.some(component => component.name === 'cc.Label' || component.name === 'cc.EditBox');

        if (!shouldKeep) {
            return;
        }

        keyNodes.push({
            path: nodeInfo.path,
            active: nodeInfo.active,
            nestedPrefabPath: nodeInfo.nestedPrefab?.nestedPrefabPath || null,
            components: componentSummaries,
        });
    });

    return keyNodes;
}

function getComponentDescriptor(componentObject, scriptMetaMap) {
    const typeName = componentObject.__type__;
    if (!typeName) {
        return null;
    }

    const scriptInfo = scriptMetaMap.get(typeName) || null;
    return {
        rawType: typeName,
        name: scriptInfo?.name || typeName,
        scriptPath: scriptInfo?.path || null,
        isCustom: Boolean(scriptInfo) || !typeName.startsWith('cc.'),
    };
}

function isCustomComponent(componentObject, scriptMetaMap) {
    return Boolean(scriptMetaMap.get(componentObject.__type__)) || !componentObject.__type__.startsWith('cc.');
}

function collectCustomComponents(analyzer) {
    const components = [];

    analyzer.infoByNodeId.forEach((nodeInfo, nodeId) => {
        const node = analyzer.objects[nodeId];
        for (const componentRef of ensureArray(node._components)) {
            const componentId = componentRef.__id__;
            const componentObject = analyzer.objects[componentId];
            if (!componentObject || !isCustomComponent(componentObject, analyzer.scriptMetaMap)) {
                continue;
            }

            const descriptor = getComponentDescriptor(componentObject, analyzer.scriptMetaMap);
            components.push({
                nodePath: nodeInfo.path,
                componentName: descriptor.name,
                scriptPath: descriptor.scriptPath,
                rawType: descriptor.rawType,
                serializedFields: collectSerializedFields(componentObject, analyzer),
                fieldOverrides: collectFieldOverrides(componentId, analyzer),
            });
        }
    });

    return components;
}

function collectSerializedFields(componentObject, analyzer) {
    const fields = [];
    const skipKeys = new Set(['__type__', '_name', '_objFlags', '__editorExtras__', 'node', '_enabled', '__prefab', '_id']);

    for (const [fieldName, rawValue] of Object.entries(componentObject)) {
        if (skipKeys.has(fieldName) || fieldName.startsWith('_')) {
            continue;
        }
        fields.push({
            field: fieldName,
            value: describeValue(rawValue, analyzer),
        });
    }

    return fields;
}

function collectFieldOverrides(componentId, analyzer) {
    const overrides = [];

    analyzer.objects.forEach(object => {
        if (object?.__type__ !== 'cc.TargetOverrideInfo' || object.source?.__id__ !== componentId) {
            return;
        }

        const propertyPath = ensureArray(object.propertyPath).join('.');
        const targetNodeId = object.target?.__id__;
        const targetInfo = analyzer.objects[object.targetInfo?.__id__];
        const localId = targetInfo?.localID?.[0] || '';
        const targetNodeInfo = analyzer.infoByNodeId.get(targetNodeId) || null;
        const nestedPrefabInfo = targetNodeId != null ? analyzer.nestedPrefabByNodeId.get(targetNodeId) || null : null;
        let resolvedTarget = null;

        if (nestedPrefabInfo?.nestedPrefabPath && localId) {
            const nestedAnalyzer = createAnalyzer(path.resolve(nestedPrefabInfo.nestedPrefabPath), analyzer.scriptMetaMap, analyzer.prefabMetaMap, analyzer.prefabCache);
            const nestedComponent = nestedAnalyzer.componentByFileId.get(localId);
            if (nestedComponent) {
                const nestedDescriptor = getComponentDescriptor(nestedComponent.object, analyzer.scriptMetaMap);
                const nestedNodeId = nestedComponent.object.node?.__id__;
                resolvedTarget = {
                    prefabPath: nestedAnalyzer.prefabPath,
                    nodePath: nestedAnalyzer.pathByNodeId.get(nestedNodeId) || null,
                    componentName: nestedDescriptor?.name || null,
                    scriptPath: nestedDescriptor?.scriptPath || null,
                    localId,
                };
            }
        }

        overrides.push({
            field: propertyPath,
            targetNodePath: targetNodeInfo?.path || null,
            nestedPrefabPath: nestedPrefabInfo?.nestedPrefabPath || null,
            resolvedTarget,
        });
    });

    return overrides;
}

function describeValue(value, analyzer) {
    if (value === null || value === undefined) {
        return { kind: 'primitive', value: null };
    }
    if (Array.isArray(value)) {
        return {
            kind: 'array',
            items: value.map(item => describeValue(item, analyzer)),
        };
    }
    if (typeof value !== 'object') {
        return { kind: 'primitive', value };
    }
    if (value.__id__ == null) {
        return { kind: 'object', value };
    }

    const targetObject = analyzer.objects[value.__id__];
    if (!targetObject) {
        return { kind: 'reference', targetId: value.__id__, value: null };
    }
    if (targetObject.__type__ === 'cc.Node') {
        return {
            kind: 'node',
            nodePath: analyzer.pathByNodeId.get(value.__id__) || null,
            active: resolveNodeActive(analyzer, value.__id__),
            nestedPrefabPath: analyzer.nestedPrefabByNodeId.get(value.__id__)?.nestedPrefabPath || null,
        };
    }
    if (targetObject.node?.__id__ != null) {
        const componentDescriptor = getComponentDescriptor(targetObject, analyzer.scriptMetaMap);
        return {
            kind: 'component',
            componentName: componentDescriptor?.name || targetObject.__type__,
            scriptPath: componentDescriptor?.scriptPath || null,
            nodePath: analyzer.pathByNodeId.get(targetObject.node.__id__) || null,
        };
    }

    return {
        kind: 'reference',
        targetId: value.__id__,
        targetType: targetObject.__type__ || null,
    };
}

function collectEvents(analyzer) {
    const eventList = [];

    analyzer.infoByNodeId.forEach((nodeInfo, nodeId) => {
        const node = analyzer.objects[nodeId];
        for (const componentRef of ensureArray(node._components)) {
            const componentObject = analyzer.objects[componentRef.__id__];
            if (!componentObject) {
                continue;
            }

            const componentDescriptor = getComponentDescriptor(componentObject, analyzer.scriptMetaMap);
            if (!componentDescriptor) {
                continue;
            }

            const pushEvents = (sourceKind, eventHandlers, extra = {}) => {
                for (const eventHandler of eventHandlers) {
                    const resolvedEvent = resolveEventHandler(eventHandler, analyzer);
                    if (!resolvedEvent) {
                        continue;
                    }
                    eventList.push({
                        sourceNodePath: nodeInfo.path,
                        sourceComponent: componentDescriptor.name,
                        sourceKind,
                        ...extra,
                        ...resolvedEvent,
                    });
                }
            };

            if (componentObject.__type__ === 'cc.Button') {
                pushEvents('clickEvents', ensureArray(componentObject.clickEvents).map(ref => analyzer.objects[ref.__id__]));
            }

            if (componentObject.__type__ === 'cc.Toggle') {
                pushEvents('checkEvents', ensureArray(componentObject.checkEvents).map(ref => analyzer.objects[ref.__id__]), {
                    defaultChecked: componentObject._isChecked,
                });
            }

            if (componentDescriptor.name === 'VScrollViewMode') {
                pushEvents('renderEvent', [dereference(componentObject.renderEvent, analyzer.objects)]);
                const refreshData = dereference(componentObject.refreshData, analyzer.objects);
                pushEvents('refreshEvent', [dereference(refreshData?.refreshEvent, analyzer.objects)]);
                const loadMoreData = dereference(componentObject.loadMoreData, analyzer.objects);
                pushEvents('loadMoreEvent', [dereference(loadMoreData?.loadMoreEvent, analyzer.objects)]);
                pushEvents('itemClickEvent', [dereference(componentObject.itemClickEvent, analyzer.objects)]);
            }
        }
    });

    return eventList;
}

function dereference(ref, objects) {
    if (!ref || ref.__id__ == null) {
        return ref || null;
    }
    return objects[ref.__id__] || null;
}

function resolveEventHandler(eventHandler, analyzer) {
    if (!eventHandler || !eventHandler.handler) {
        return null;
    }

    const targetNodeId = eventHandler.target?.__id__;
    const targetNodePath = targetNodeId != null ? analyzer.pathByNodeId.get(targetNodeId) || null : null;
    let targetScriptPath = null;
    let targetComponentName = null;

    if (eventHandler._componentId) {
        const scriptInfo = analyzer.scriptMetaMap.get(eventHandler._componentId) || null;
        targetComponentName = scriptInfo?.name || eventHandler._componentId;
        targetScriptPath = scriptInfo?.path || null;
    }

    return {
        handler: eventHandler.handler,
        customEventData: eventHandler.customEventData || '',
        targetNodePath,
        targetComponentName,
        targetScriptPath,
    };
}

function collectTrackedFiles(prefabs, scripts) {
    const trackedFiles = new Set();

    const addFile = filePath => {
        if (!filePath) {
            return;
        }
        trackedFiles.add(normalize(path.resolve(filePath)));
    };

    for (const prefab of prefabs) {
        addFile(prefab.prefabPath);

        for (const keyNode of ensureArray(prefab.keyNodes)) {
            addFile(keyNode.nestedPrefabPath);

            for (const component of ensureArray(keyNode.components)) {
                addFile(component.scriptPath);
            }
        }

        for (const component of ensureArray(prefab.customComponents)) {
            addFile(component.scriptPath);

            for (const field of ensureArray(component.serializedFields)) {
                const value = field?.value || null;
                if (value?.kind === 'component') {
                    addFile(value.scriptPath);
                }
            }

            for (const override of ensureArray(component.fieldOverrides)) {
                addFile(override.nestedPrefabPath);
                addFile(override.resolvedTarget?.prefabPath);
                addFile(override.resolvedTarget?.scriptPath);
            }
        }

        for (const eventInfo of ensureArray(prefab.events)) {
            addFile(eventInfo.targetScriptPath);
        }
    }

    for (const scriptInfo of scripts) {
        addFile(scriptInfo.scriptPath);
        for (const importInfo of ensureArray(scriptInfo.imports)) {
            addFile(importInfo.resolvedPath);
        }
    }

    return Array.from(trackedFiles).sort((left, right) => left.localeCompare(right));
}

function runScan(rawArgs = process.argv.slice(2)) {
    const args = parseArgs(rawArgs);
    const extractContext = createExtractContext(args, process.cwd());
    const scriptMetaMap = collectScriptMeta(args.componentRoots.map(root => path.resolve(root)), extractContext);
    const prefabMetaMap = collectPrefabMeta(args.assetRoots.map(root => path.resolve(root)), extractContext);
    const scripts = extractScriptInsights(args.methodRoots.map(root => path.resolve(root)), extractContext);
    const prefabCache = new Map();

    const prefabs = args.prefabs.map(prefabPath => {
        const resolvedPrefabPath = path.resolve(prefabPath);
        const analyzer = createAnalyzer(resolvedPrefabPath, scriptMetaMap, prefabMetaMap, prefabCache);
        return {
            prefabPath: analyzer.prefabPath,
            keyNodes: analyzer.keyNodes,
            customComponents: analyzer.customComponents,
            events: analyzer.events,
        };
    });

    const output = {
        generatedAt: new Date().toISOString(),
        scanConfig: {
            componentRoots: args.componentRoots.map(root => normalize(path.resolve(root))),
            assetRoots: args.assetRoots.map(root => normalize(path.resolve(root))),
            methodRoots: args.methodRoots.map(root => normalize(path.resolve(root))),
            prefabInputs: args.prefabs.map(prefabPath => normalize(path.resolve(prefabPath))),
        },
        prefabs,
        scripts,
        trackedFiles: collectTrackedFiles(prefabs, scripts),
    };

    fs.mkdirSync(path.dirname(args.output), { recursive: true });
    fs.writeFileSync(args.output, JSON.stringify(output, null, 2), 'utf8');
}

module.exports = {
    runExtract: runScan,
    runScan,
};

if (require.main === module) {
    try {
        runScan();
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    }
}
