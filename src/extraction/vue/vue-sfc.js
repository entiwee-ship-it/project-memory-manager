function getLineNumber(source, index) {
    return String(source || '').slice(0, index).split(/\r?\n/).length;
}

function extractVueScriptBlocks(source) {
    const blocks = [];
    const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    let match = null;

    while ((match = pattern.exec(source))) {
        const attrs = String(match[1] || '');
        const content = String(match[2] || '').replace(/^\s*\r?\n/, '');
        if (!content.trim()) {
            continue;
        }
        blocks.push({
            attrs,
            content,
            setup: /\bsetup\b/i.test(attrs),
            lang: (attrs.match(/\blang=["']?([A-Za-z0-9_-]+)/i) || [])[1] || '',
            lineOffset: getLineNumber(source, match.index) - 1,
        });
    }

    return blocks;
}

function extractVueScriptContent(source) {
    const blocks = extractVueScriptBlocks(source);
    return {
        content: blocks.map(block => block.content).join('\n\n'),
        blocks,
        lineOffset: blocks[0]?.lineOffset || 0,
    };
}

module.exports = {
    extractVueScriptBlocks,
    extractVueScriptContent,
};
