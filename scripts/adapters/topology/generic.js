const { normalize } = require('../../lib/common');

const COLLECTION_ROOTS = new Set([
    'app',
    'apps',
    'service',
    'services',
    'server',
    'servers',
    'package',
    'packages',
    'shared',
    'contract',
    'contracts',
    'schema',
    'schemas',
    'db',
    'database',
    'databases',
    'migration',
    'migrations',
    'ops',
    'tools',
    'scripts',
    'infra',
]);

const MANIFEST_BASENAMES = new Set([
    'package.json',
    'pyproject.toml',
    'requirements.txt',
    'pom.xml',
    'build.gradle',
    'build.gradle.kts',
    'go.mod',
]);

const IGNORED_PATH_SEGMENTS = new Set([
    'node_modules',
    '.git',
    '.store',
    '.kimi',
    'project-memory',
    'dist',
    'build',
    '.runtime',
    '.venv',
    'venv',
    'coverage',
    '.next',
    '.nuxt',
    '.turbo',
    '.cache',
]);

const FRONTEND_NAME_HINT = /(^|[-_])(web|site|admin|client|frontend|ui|portal|console|dashboard|mobile)([-_]|$)/;
const BACKEND_NAME_HINT = /(^|[-_])(api|server|backend|service|gateway)([-_]|$)/;
const BACKEND_SERVICE_HINT = /(^|[-_])(api|server|backend|service|gateway|worker|job|cron|scheduler|consumer|producer|queue)([-_]|$)/;
const SHARED_NAME_HINT = /(^|[-_])(shared|common|core|utils|sdk|lib|libs)([-_]|$)/;
const CONTRACT_NAME_HINT = /(^|[-_])(contract|contracts|schema|schemas|proto|protobuf|openapi|types?)([-_]|$)/;
const DATA_NAME_HINT = /(^|[-_])(db|database|databases|data|model|models|migration|migrations|sql|prisma|drizzle|seed|seeds)([-_]|$)/;
const OPS_NAME_HINT = /(^|[-_])(ops|tools|scripts|infra|deploy|deployment|devops|helm|terraform|ansible|ci|cd|job|jobs|worker|workers|cron)([-_]|$)/;
const FRONTEND_PATH_HINT = /(^|[-_])(frontend|client|web|ui|site|admin|portal|console|dashboard|mobile)([-_]|$)/;
const BACKEND_PATH_HINT = /(^|[-_])(backend|server|api|service|gateway)([-_]|$)/;

function splitSegments(filePath) {
    return normalize(filePath).toLowerCase().split('/').filter(Boolean);
}

function matchesHint(value, hint) {
    return hint.test(String(value || '').toLowerCase());
}

function shouldIgnorePath(relativePath) {
    return splitSegments(relativePath).some(segment => IGNORED_PATH_SEGMENTS.has(segment));
}

function collectPackageDeps(pkg = {}) {
    return new Set(
        Object.keys({
            ...(pkg.dependencies || {}),
            ...(pkg.devDependencies || {}),
            ...(pkg.optionalDependencies || {}),
            ...(pkg.peerDependencies || {}),
        }).map(name => String(name || '').toLowerCase())
    );
}

function hasDependency(depSet, names) {
    return names.some(name => depSet.has(String(name || '').toLowerCase()));
}

function pushUnique(target, value) {
    if (!target.includes(value)) {
        target.push(value);
    }
}

function safeReadText(fs, filePath) {
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch {
        return '';
    }
}

function manifestTextMatches(manifestTexts, patterns) {
    return manifestTexts.some(text => patterns.some(pattern => pattern.test(text)));
}

function hasDirectorySegment(dirHits, segments) {
    const expected = new Set(segments.map(segment => String(segment || '').toLowerCase()));
    return dirHits.some(hit => splitSegments(hit).some(segment => expected.has(segment)));
}

function classifyAreaFromPath(relativePath) {
    const normalized = normalize(relativePath).toLowerCase();
    const segments = splitSegments(normalized);
    const last = segments[segments.length - 1] || normalized;
    const first = segments[0] || '';
    const second = segments[1] || '';

    if (!normalized) {
        return 'unknown';
    }
    if (matchesHint(first, OPS_NAME_HINT)) {
        return 'ops';
    }
    if (first === 'app' || first === 'apps') {
        if (matchesHint(second, FRONTEND_NAME_HINT)) {
            return 'frontend';
        }
        if (matchesHint(second, OPS_NAME_HINT)) {
            return 'ops';
        }
        if (matchesHint(second, BACKEND_SERVICE_HINT)) {
            return 'backend';
        }
    }
    if (first === 'service' || first === 'services' || first === 'server' || first === 'servers') {
        if (matchesHint(second, OPS_NAME_HINT)) {
            return 'ops';
        }
        if (second) {
            return 'backend';
        }
    }
    if (first === 'package' || first === 'packages') {
        if (matchesHint(second, CONTRACT_NAME_HINT)) {
            return 'contract';
        }
        if (matchesHint(second, DATA_NAME_HINT)) {
            return 'data';
        }
        if (matchesHint(second, BACKEND_NAME_HINT)) {
            return 'backend';
        }
        if (matchesHint(second, FRONTEND_NAME_HINT)) {
            return 'frontend';
        }
        if (matchesHint(second, SHARED_NAME_HINT)) {
            return 'shared';
        }
    }
    if (first === 'shared' || first === 'common' || first === 'libs' || first === 'lib') {
        return 'shared';
    }
    if (first === 'contract' || first === 'contracts' || first === 'schema' || first === 'schemas' || first === 'proto' || first === 'openapi') {
        return 'contract';
    }
    if (first === 'db' || first === 'database' || first === 'databases' || first === 'migration' || first === 'migrations' || first === 'sql' || first === 'prisma' || first === 'drizzle') {
        return 'data';
    }
    if (segments.some(segment => matchesHint(segment, FRONTEND_PATH_HINT)) || matchesHint(last, FRONTEND_PATH_HINT)) {
        return 'frontend';
    }
    if (segments.some(segment => matchesHint(segment, BACKEND_PATH_HINT)) || matchesHint(last, BACKEND_PATH_HINT)) {
        return 'backend';
    }
    if (segments.some(segment => matchesHint(segment, SHARED_NAME_HINT))) {
        return 'shared';
    }
    if (segments.some(segment => matchesHint(segment, CONTRACT_NAME_HINT))) {
        return 'contract';
    }
    if (segments.some(segment => matchesHint(segment, DATA_NAME_HINT))) {
        return 'data';
    }
    if (segments.some(segment => matchesHint(segment, OPS_NAME_HINT))) {
        return 'ops';
    }
    return 'unknown';
}

function canonicalAreaRoot(relativeDir, area) {
    const normalized = normalize(relativeDir);
    const segments = splitSegments(normalized);
    if (segments.length === 0) {
        return normalized;
    }

    const first = segments[0];
    const second = segments[1] || '';
    if (COLLECTION_ROOTS.has(first) && second) {
        return `${first}/${second}`;
    }
    if ((area === 'frontend' && matchesHint(second, FRONTEND_NAME_HINT))
        || (area === 'backend' && matchesHint(second, BACKEND_SERVICE_HINT))
        || (area === 'shared' && matchesHint(second, SHARED_NAME_HINT))
        || (area === 'contract' && matchesHint(second, CONTRACT_NAME_HINT))
        || (area === 'data' && matchesHint(second, DATA_NAME_HINT))
        || (area === 'ops' && matchesHint(second, OPS_NAME_HINT))) {
        return `${first}/${second}`;
    }
    return first;
}

function detectStacksFromManifest({ manifestName, pkg, manifestText = '', relativeDir = '' }) {
    const stacks = new Set();
    if (manifestName === 'package.json') {
        const deps = collectPackageDeps(pkg);
        stacks.add('nodejs');
        if (pkg?.creator?.version) {
            stacks.add('cocos');
            stacks.add('typescript');
        }
        if (hasDependency(deps, ['typescript'])) {
            stacks.add('typescript');
        }
        if (hasDependency(deps, ['vue'])) {
            stacks.add('vue');
        }
        if (hasDependency(deps, ['react', 'react-dom'])) {
            stacks.add('react');
        }
        if (hasDependency(deps, ['next'])) {
            stacks.add('next');
            stacks.add('react');
        }
        if (hasDependency(deps, ['nuxt'])) {
            stacks.add('nuxt');
            stacks.add('vue');
        }
        if (hasDependency(deps, ['nestjs', '@nestjs/core', '@nestjs/common', '@nestjs/platform-express', '@nestjs/platform-fastify'])) {
            stacks.add('nestjs');
            stacks.add('nodejs');
        }
        if (hasDependency(deps, ['express'])) {
            stacks.add('express');
        }
        if (hasDependency(deps, ['pinus'])) {
            stacks.add('pinus');
        }
        if (hasDependency(deps, ['koa'])) {
            stacks.add('koa');
        }
        if (hasDependency(deps, ['fastify'])) {
            stacks.add('fastify');
        }
        if (hasDependency(deps, ['graphql', '@apollo/server', 'apollo-server', 'apollo-server-express', 'graphql-yoga'])) {
            stacks.add('graphql');
        }
        if ((splitSegments(relativeDir).some(segment => matchesHint(segment, FRONTEND_PATH_HINT)))
            && !stacks.has('cocos')
            && !stacks.has('typescript')
            && !stacks.has('vue')
            && !stacks.has('react')) {
            stacks.add('frontend-js');
        }
        return stacks;
    }
    if (manifestName === 'go.mod') {
        stacks.add('go');
        if (/github\.com\/gin-gonic\/gin|gin-gonic\/gin/i.test(manifestText)) {
            stacks.add('gin');
        }
        if (/github\.com\/labstack\/echo|labstack\/echo/i.test(manifestText)) {
            stacks.add('echo');
        }
        if (/github\.com\/gofiber\/fiber|gofiber\/fiber/i.test(manifestText)) {
            stacks.add('fiber');
        }
    } else if (manifestName === 'pom.xml' || manifestName === 'build.gradle' || manifestName === 'build.gradle.kts') {
        stacks.add('java');
        if (/spring-boot|spring-boot-starter|spring-web|org\.springframework/i.test(manifestText)) {
            stacks.add('spring');
        }
    } else if (manifestName === 'requirements.txt' || manifestName === 'pyproject.toml') {
        stacks.add('python');
        if (/\bfastapi\b/i.test(manifestText)) {
            stacks.add('fastapi');
        }
        if (/\bdjango\b/i.test(manifestText)) {
            stacks.add('django');
        }
        if (/\bflask\b/i.test(manifestText)) {
            stacks.add('flask');
        }
    }
    return stacks;
}

function detectIntegrations(root) {
    const fs = require('fs');
    const path = require('path');
    const integrations = {
        primary: [],
        secondary: [],
    };

    const dirHits = [];
    const manifestTexts = [];
    const packageDepSets = [];
    let hasProtoFile = false;

    const walk = dir => {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const normalized = normalize(path.relative(root, fullPath)).toLowerCase();
            if (!normalized || shouldIgnorePath(normalized)) {
                continue;
            }
            if (entry.isDirectory()) {
                dirHits.push(normalized);
                walk(fullPath);
                continue;
            }
            const baseName = path.basename(fullPath).toLowerCase();
            if (baseName.endsWith('.proto')) {
                hasProtoFile = true;
                continue;
            }
            if (!MANIFEST_BASENAMES.has(baseName)) {
                continue;
            }

            const manifestText = safeReadText(fs, fullPath);
            if (!manifestText) {
                continue;
            }
            if (baseName === 'package.json') {
                try {
                    packageDepSets.push(collectPackageDeps(JSON.parse(manifestText)));
                } catch {
                    // ignore invalid package.json during integration inference
                }
            } else {
                manifestTexts.push(manifestText.toLowerCase());
            }
        }
    };

    if (fs.existsSync(root)) {
        walk(root);
    }

    const hasPackageDependency = names => packageDepSets.some(depSet => hasDependency(depSet, names));

    if (
        hasDirectorySegment(dirHits, ['websocket', 'websockets', 'socket', 'sockets', 'ws'])
        || hasPackageDependency(['ws', 'socket.io', 'sockjs', 'websocket', '@nestjs/websockets'])
        || manifestTextMatches(manifestTexts, [/\bwebsockets\b/i, /gorilla\/websocket/i, /spring-websocket/i])
    ) {
        pushUnique(integrations.primary, 'websocket');
    }

    if (
        hasDirectorySegment(dirHits, ['http', 'rest'])
        || hasPackageDependency(['express', 'koa', 'fastify', '@nestjs/core', '@nestjs/platform-express', '@nestjs/platform-fastify'])
        || manifestTextMatches(manifestTexts, [
            /\bfastapi\b/i,
            /\bdjango\b/i,
            /\bflask\b/i,
            /spring-boot-starter-web|spring-webmvc|spring-webflux|org\.springframework:spring-web/i,
            /github\.com\/gin-gonic\/gin|github\.com\/labstack\/echo|github\.com\/gofiber\/fiber/i,
        ])
    ) {
        pushUnique(integrations.secondary, 'http');
    }

    if (
        hasProtoFile
        || hasPackageDependency(['@grpc/grpc-js', 'grpc'])
        || manifestTextMatches(manifestTexts, [/google\.golang\.org\/grpc/i, /\bgrpcio\b/i, /\bio\.grpc\b/i])
    ) {
        pushUnique(integrations.secondary, 'grpc');
    }

    if (
        hasDirectorySegment(dirHits, ['graphql'])
        || hasPackageDependency(['graphql', '@apollo/server', 'apollo-server', 'apollo-server-express', 'graphql-yoga'])
        || manifestTextMatches(manifestTexts, [/\bgraphene\b/i, /\bariadne\b/i, /graphql-java/i, /graphql-go\/graphql/i])
    ) {
        pushUnique(integrations.secondary, 'graphql');
    }

    if (
        hasDirectorySegment(dirHits, ['mq', 'queue', 'queues', 'rabbitmq', 'kafka', 'pubsub'])
        || hasPackageDependency(['amqplib', 'amqp-connection-manager', 'kafkajs', 'kafka-node', 'bull', 'bullmq', 'nats', '@aws-sdk/client-sqs', '@google-cloud/pubsub'])
        || manifestTextMatches(manifestTexts, [/rabbitmq/i, /\bkafka\b/i, /\bpika\b/i, /\bcelery\b/i, /\bnats\b/i, /pubsub/i, /rocketmq/i])
    ) {
        pushUnique(integrations.secondary, 'mq');
    }

    if (
        hasDirectorySegment(dirHits, ['rpc', 'thrift', 'dubbo'])
        || hasPackageDependency(['thrift', 'tars', 'dubbo', 'brpc'])
        || manifestTextMatches(manifestTexts, [/\bthrift\b/i, /\bdubbo\b/i, /\btars\b/i, /\bbrpc\b/i, /\brpcx\b/i])
    ) {
        pushUnique(integrations.secondary, 'rpc');
    }

    return integrations;
}

module.exports = {
    name: 'generic',
    classifyAreaFromPath,
    canonicalAreaRoot,
    detectStacksFromManifest,
    detectIntegrations,
};
