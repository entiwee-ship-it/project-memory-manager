#!/usr/bin/env node

const { run: runCocosAuthoring } = require('./cocos_authoring');

function translateArgs(argv = []) {
    const translated = [];
    const source = [...argv];
    let intent = '';

    for (let index = 0; index < source.length; index++) {
        const token = source[index];
        const next = source[index + 1];

        if (token === '--node') {
            translated.push('--component-node', next);
            index += 1;
            continue;
        }
        if (token === '--component') {
            translated.push('--component', next);
            index += 1;
            continue;
        }
        if (token === '--handler') {
            translated.push('--handler', next);
            intent = 'click-event';
            index += 1;
            continue;
        }
        if (token === '--event') {
            intent = 'click-event';
            continue;
        }
        if (token === '--field') {
            translated.push('--field', next);
            intent = 'field-binding';
            index += 1;
            continue;
        }
        if (token === '--target-node') {
            translated.push('--target-node', next);
            if (!intent) {
                intent = 'field-binding';
            }
            index += 1;
            continue;
        }
        if (token === '--target-component') {
            translated.push('--target-component', next);
            if (!intent) {
                intent = 'field-binding';
            }
            index += 1;
            continue;
        }
        if (token === '--target-asset') {
            translated.push('--target-asset', next);
            if (!intent) {
                intent = 'field-binding';
            }
            index += 1;
            continue;
        }
        translated.push(token);
    }

    if (!translated.includes('--intent')) {
        translated.push('--intent', intent || 'profile');
    }
    if (translated.includes('--component-node') && translated.includes('--intent') && translated[translated.indexOf('--intent') + 1] === 'click-event') {
        const nodeIndex = translated.indexOf('--component-node');
        if (nodeIndex !== -1) {
            const value = translated[nodeIndex + 1];
            translated.splice(nodeIndex, 2, '--source-node', value);
        }
    }

    return translated;
}

function run(argv = process.argv.slice(2)) {
    return runCocosAuthoring(translateArgs(argv));
}

module.exports = {
    run,
    translateArgs,
};

if (require.main === module) {
    try {
        run();
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    }
}
