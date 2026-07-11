const ASCII_TOKEN_PATTERN = /[a-z0-9_./:-]{2,}/gi;
const CJK_SEGMENT_PATTERN = /[\u3400-\u9fff]{2,}/g;

const STOP_WORDS = new Set([
    'the', 'and', 'for', 'with', 'from', 'this', 'that', 'task', 'fix', 'add',
    '修改', '修复', '新增', '调整', '一个', '这个', '那个', '功能', '逻辑', '问题',
    '完整', '调用链', '链路', '梳理', '查找', '查看', '分析', '项目', '代码', '相关',
]);

const SCOPE_TERMS = new Set([
    'http', 'https', 'handler', 'client', 'server', 'frontend', 'backend',
    'cms-client', 'cms-server', 'xy-client', 'qy-server', 'game-server',
]);

const ALIAS_RULES = [
    {
        pattern: /验证码|captcha|verify.?code/,
        terms: ['captcha', 'getcaptcha', 'generatecaptcha', 'savecaptcha', 'auth/captcha', '/api/auth/captcha'],
    },
    {
        pattern: /转转|zhuan.?zhuan/,
        terms: ['zhuanzhuan', 'zhuanzhuanmj'],
    },
    {
        pattern: /麻将|majiang|\bmj\b/,
        terms: ['majiang', 'mahjong', 'mj', 'mjhu'],
    },
    {
        pattern: /胡牌|和牌|mjhu|onmjhu|hupai/,
        terms: ['mjhu', 'onmjhu', 'hupai', 'gethupaitype', 'showhupaieffect'],
    },
    {
        pattern: /特效|动画|effect|animation|\bani\b/,
        terms: ['effect', 'animation', 'ani', 'showhupaifangxingeffect', 'showhupaieffect'],
    },
    {
        pattern: /登录|login|logged.?in/,
        terms: ['login', 'loggedin', 'dologin', 'ensureloggedin', 'loginview', 'logingameserver'],
    },
    {
        pattern: /会话|session|socket|pinus|游戏服|连接服/,
        terms: ['session', 'pinus', 'socket', 'gamesession', 'pkcon', 'logingameserver'],
    },
    {
        pattern: /settings|setting|设置/,
        terms: ['settings', 'setting', 'settingspage', 'loadsettings', 'savesettings'],
    },
    {
        pattern: /\bai\b|模型|配置|config/,
        terms: ['ai', 'aiconfig', 'getaiconfig', 'saveaiconfig', '/api/ai/config', '/api/ai/models'],
    },
    {
        pattern: /chat|聊天|流式|回复|对话|stream|claude|anthropic/,
        terms: ['chat', 'stream', 'streamchatcompletion', 'claude', 'anthropic', '/api/chat'],
    },
    {
        pattern: /facebook|graph|oauth|授权|脸书/,
        terms: ['facebook', 'graph', 'oauth', 'facebookconnection', '/api/facebook/oauth'],
    },
    {
        pattern: /auth|logout|register|token|jwt|鉴权|注册|登出|令牌/,
        terms: ['auth', 'logout', 'register', 'token', 'jwt', '/api/auth'],
    },
    {
        pattern: /prisma|schema|database|数据库|数据表|\bdb\b/,
        terms: ['prisma', 'schema.prisma', 'database', 'db'],
    },
    {
        pattern: /campaign|activity|order|payment|mall|shop|活动|订单|支付|商城|赠送/,
        terms: ['campaign', 'activity', 'order', 'payment', 'mall', 'gift'],
    },
];

function normalizeTaskText(value = '') {
    return String(value || '').replace(/\\/g, '/').toLowerCase();
}

function addTerm(byValue, value, weight, source) {
    const normalized = normalizeTaskText(value).trim();
    if (!normalized || STOP_WORDS.has(normalized)) {
        return;
    }
    const adjustedWeight = SCOPE_TERMS.has(normalized) ? Math.min(weight, 0.5) : weight;
    const previous = byValue.get(normalized);
    if (!previous || adjustedWeight > previous.weight) {
        byValue.set(normalized, {
            value: normalized,
            weight: adjustedWeight,
            source,
        });
    }
}

function addCjkTerms(byValue, segment) {
    if (!segment || STOP_WORDS.has(segment)) {
        return;
    }
    addTerm(byValue, segment, segment.length <= 8 ? 3 : 2, 'cjk');
    for (let size = 2; size <= Math.min(4, segment.length); size += 1) {
        for (let index = 0; index <= segment.length - size; index += 1) {
            addTerm(byValue, segment.slice(index, index + size), 1 + (size * 0.5), 'cjk-ngram');
        }
    }
}

function parseTaskTerms(...values) {
    const raw = values.flat().filter(Boolean).join(' ').trim();
    const normalized = normalizeTaskText(raw);
    const byValue = new Map();

    for (const match of normalized.match(ASCII_TOKEN_PATTERN) || []) {
        addTerm(byValue, match, 2.5, 'ascii');
    }
    for (const segment of normalized.match(CJK_SEGMENT_PATTERN) || []) {
        addCjkTerms(byValue, segment);
    }
    for (const rule of ALIAS_RULES) {
        if (rule.pattern.test(normalized)) {
            for (const alias of rule.terms) {
                addTerm(byValue, alias, 4, 'alias');
            }
        }
    }

    return {
        raw,
        normalized,
        terms: Array.from(byValue.values())
            .sort((left, right) => right.weight - left.weight || left.value.localeCompare(right.value)),
    };
}

function termValues(terms = []) {
    return terms.map(term => typeof term === 'string' ? normalizeTaskText(term) : term?.value).filter(Boolean);
}

function scoreTextMatches(value, terms = []) {
    const text = normalizeTaskText(value);
    let score = 0;
    const matchedTerms = [];
    for (const input of terms) {
        const term = typeof input === 'string'
            ? { value: normalizeTaskText(input), weight: 1 }
            : input;
        if (!term?.value || !text.includes(term.value)) {
            continue;
        }
        score += term.weight * (term.value.includes('/') ? 1.5 : 1);
        matchedTerms.push(term.value);
    }
    return {
        score,
        matchedTerms: Array.from(new Set(matchedTerms)),
    };
}

module.exports = {
    normalizeTaskText,
    parseTaskTerms,
    scoreTextMatches,
    termValues,
};
