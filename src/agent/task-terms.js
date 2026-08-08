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
    'config', 'prefab', 'component',
]);

const WEAK_CJK_FRAGMENTS = [
    '后台', '前台', '前端', '后端', '前后', '检查', '调用', '统一', '同步',
    '调整', '修改', '解释', '排查', '避免', '范围', '组件', '节点', '结构',
    '引用', '显示', '消息', '任务', '改动', '漏掉', '是否', '链路', '一致性',
    '中文', '提示', '配置',
];

const ALIAS_RULES = [
    {
        pattern: /验证码|captcha|verify.?code/,
        semanticTerms: ['验证码', 'captcha'],
        terms: ['captcha', 'getcaptcha', 'generatecaptcha', 'savecaptcha', 'auth/captcha', '/api/auth/captcha'],
    },
    {
        pattern: /(?:后台|管理).*验证码|验证码.*(?:后台|管理)/,
        weight: 6,
        terms: ['authapi', 'authcontroller', 'authroutes', 'login.vue', 'captcha.ts', 'captchaservice'],
    },
    {
        pattern: /转转|zhuan.?zhuan/,
        terms: ['zhuanzhuan', 'zhuanzhuanmj'],
    },
    {
        pattern: /转转.*(?:胡牌|特效)|(?:胡牌|特效).*转转/,
        terms: [
            'zhuanzhuanmjviewcomp', 'zhuanzhuanmjhandler', 'getspecialhueffecttype', 'majiangbaseview',
            'effectanicomp', 'zhuanzhuanmjeffect',
        ],
    },
    {
        pattern: /转转.*(?:胡牌|特效)|(?:胡牌|特效).*转转/,
        weight: 6,
        terms: [
            'zhuanzhuanmjviewcomp.ts', 'zhuanzhuanmjhandler.ts', 'majiangbaseview.ts',
            'effectanicomp.ts', 'zhuanzhuanmjeffect.ts',
        ],
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
        excludePattern: /(?:后台|管理).*验证码|验证码.*(?:后台|管理)/,
        terms: ['login', 'loggedin', 'dologin', 'ensureloggedin', 'loginview', 'logingameserver'],
    },
    {
        pattern: /pinus|游戏会话|游戏登录|登录.*游戏服|游戏服.*登录/,
        terms: ['loadingviewcomp', 'loginviewcomp', 'userapi', 'gamesessionmgr', 'pkcon'],
    },
    {
        pattern: /pinus|游戏会话|游戏登录|登录.*游戏服|游戏服.*登录/,
        weight: 6,
        terms: [
            'loadingviewcomp.ts', 'loginviewcomp.ts', 'userapi.ts', 'gamesessionmgr.ts',
            'pkcon/handler/handler.ts', 'pkconhandler.ts',
        ],
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
        pattern: /\bai\b|ai.?config|模型|aiconfig/,
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
        pattern: /prisma|schema|database|数据库|数据表|\bdb\b|sql/,
        terms: ['prisma', 'schema.prisma', 'schema.sql', 'database', 'db'],
    },
    {
        pattern: /campaign|activity|活动|赠送/,
        terms: ['campaign', 'activity', 'order', 'payment', 'mall', 'gift'],
    },
    {
        pattern: /order|payment|transaction|订单|支付|交易/,
        terms: ['order', 'payment', 'transaction'],
    },
    {
        pattern: /mall|shop|商城/,
        semanticTerms: ['商城', 'mall'],
        terms: ['mall', 'shop'],
    },
    {
        pattern: /充值|recharge/,
        weight: 6,
        semanticTerms: ['商城充值', '充值配置', 'recharge'],
        terms: [
            'recharge', 'rechargeladder', 'rechargeladderlist', 'rechargeladdermodel',
            'rechargeladderschema', 'mallruntimeconfig', 'tb_recharge_ladder', 'schema.sql',
        ],
    },
    {
        pattern: /商品快照|product.?snapshot|充值商品/,
        weight: 6,
        semanticTerms: ['商品快照', '充值商品', 'productsnapshot'],
        terms: ['mallrechargeproductsnapshot', 'getrechargeproductsnapshot', 'schema.sql', 'tb_recharge_ladder'],
    },
    {
        pattern: /新版大厅|new.?lobby/,
        semanticTerms: ['新版大厅', 'newlobby'],
        terms: ['lobby-view', 'lobbyview', 'lobbyviewcomp'],
    },
    {
        pattern: /新版大厅|new.?lobby/,
        weight: 6,
        terms: ['lobbyview.prefab', 'lobbyviewcomp.ts'],
    },
    {
        pattern: /新版大厅.*(?:入场动画|首帧)|(?:入场动画|首帧).*新版大厅/,
        terms: ['viewenteranimator', 'onadded', 'gameuiconfig', 'lobbyviewcomp', 'lobbyview'],
    },
    {
        pattern: /新版大厅.*(?:入场动画|首帧)|(?:入场动画|首帧).*新版大厅/,
        weight: 6,
        terms: ['viewenteranimator.onadded', 'viewenteranimator.ts', 'lobbyviewcomp.ts', 'lobbyview.prefab', 'gameuiconfig.ts', 'lobbyview.ts'],
    },
    {
        pattern: /head.?frame|头像框/,
        weight: 6,
        terms: ['headframe.prefab', 'headframecomp.ts', 'lobbyviewcomp.ts', 'lobbyview.prefab'],
    },
    {
        pattern: /bottomactionmodule|bottom.?action|底部操作/,
        weight: 6,
        terms: ['bottomactionmodule', 'lobbyviewcomp.ts', 'lobbyview.prefab'],
    },
    {
        pattern: /游戏配置.*(?:规则|默认)|(?:规则|默认).*游戏配置/,
        semanticTerms: ['游戏配置', '规则默认'],
        terms: [
            'gameedit', 'gameschemaeditor', 'rulecanvas', 'gameschema',
            'gamecontroller', 'gamemodel', 'gamerulestoragemapper',
        ],
    },
    {
        pattern: /游戏配置.*(?:规则|默认)|(?:规则|默认).*游戏配置/,
        weight: 6,
        terms: [
            'gameedit.vue', 'gameschemaeditor.vue', 'rulecanvas.vue', 'gameschema.ts',
            'gamecontroller.ts', 'gamemodel.ts',
        ],
    },
    {
        pattern: /错误提示|error.?message|错误中文|中文化/,
        weight: 6,
        semanticTerms: ['错误提示', 'errormessage'],
        terms: [
            'errormessage', 'errormessage.js', 'errormessage.ts', 'requesterrorcontext',
            'requesterrorcontext.ts',
        ],
    },
    {
        pattern: /后台|\bcms\b|\badmin\b/,
        terms: ['cms-client', 'cms-server', 'admin'],
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
            const term = segment.slice(index, index + size);
            if (WEAK_CJK_FRAGMENTS.some(fragment => term.includes(fragment))) {
                continue;
            }
            addTerm(byValue, term, 1 + (size * 0.5), 'cjk-ngram');
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
        if (rule.pattern.test(normalized) && !(rule.excludePattern && rule.excludePattern.test(normalized))) {
            for (const alias of rule.semanticTerms || []) {
                addTerm(byValue, alias, rule.weight || 4, 'semantic-alias');
            }
            for (const alias of rule.terms) {
                addTerm(byValue, alias, rule.weight || 4, 'alias');
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
