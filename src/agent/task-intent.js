const { normalizeTaskText } = require('./task-terms');

const INTENTS = ['understand', 'implement', 'debug', 'resume', 'review', 'simple'];
const INTENT_SET = new Set(INTENTS);

const CUES = {
    review: [
        /审查|复核|review|code review|patch|漏改|越界|改动范围|changed files?|scope/i,
    ],
    resume: [
        /继续|接着|恢复|上次|上一轮|历史任务|交接|resume|continue/i,
    ],
    debug: [
        /排查|定位|异常|报错|错误|失败|偶尔|无法|不能|无效|不刷新|卡死|闪现|崩溃|超时|回归|bug|debug/i,
    ],
    understand: [
        /解释|理解|说明|梳理|追踪|调用链|链路|数据流|状态流|如何.*建立|怎么.*工作|what|explain|trace|understand/i,
    ],
    implement: [
        /实现|开发|新增|修改|调整|重构|优化|同步|统一|接入|替换|删除|改成|修复|implement|build|add|change|refactor|optimize/i,
    ],
};

const HIGH_RISK_PATTERN = /api|接口|数据库|数据表|鉴权|登录|auth|token|支付|充值|订单|交易|商城|配置同步|跨模块|服务端|后端|schema|sql/i;
const SIMPLE_PATTERN = /按钮|文案|文字|颜色|间距|样式|对齐|图标|label|button|copy|style|css|ui/i;
const IMPLEMENT_DIRECTIVE_PATTERN = /^(?:请|需要)?(?:统一|同步|实现|接入|调整|修改|新增|重构|优化|替换|删除|改成|开发)/i;

function asArray(value) {
    if (Array.isArray(value)) {
        return value.filter(Boolean).map(String);
    }
    return value ? [String(value)] : [];
}

function cueScore(text, intent) {
    return CUES[intent].reduce((score, pattern) => score + (pattern.test(text) ? 1 : 0), 0);
}

function confidenceFor(score, margin) {
    if (score >= 7 && margin >= 2) {
        return 'high';
    }
    if (score >= 4) {
        return 'medium';
    }
    return 'low';
}

function explicitIntent(options) {
    if (!options.intent) {
        return null;
    }
    const intent = String(options.intent).trim().toLowerCase();
    if (!INTENT_SET.has(intent)) {
        throw new Error(`invalid intent: ${options.intent}`);
    }
    return {
        intent,
        confidence: 'high',
        score: 100,
        reasons: [`explicit-intent:${intent}`],
        missingInputs: [],
    };
}

function classifyTaskIntent(options = {}) {
    const explicit = explicitIntent(options);
    if (explicit) {
        return explicit;
    }

    const task = String(options.task || options.query || '').trim();
    const text = normalizeTaskText(task);
    const knownFiles = asArray(options.knownFiles || options.knownFile);
    const changedFiles = asArray(options.changedFiles || options.changedFile);
    const reasons = [];
    const scores = {
        understand: cueScore(text, 'understand') * 6,
        implement: cueScore(text, 'implement') * 5,
        debug: cueScore(text, 'debug') * 7,
        resume: cueScore(text, 'resume') * 8,
        review: cueScore(text, 'review') * 8,
        simple: 0,
    };

    if (changedFiles.length > 0) {
        scores.review += cueScore(text, 'review') ? 4 : 0;
        reasons.push(`changed-files:${changedFiles.length}`);
    }
    if (knownFiles.length > 0) {
        reasons.push(`known-files:${knownFiles.length}`);
    }
    if (IMPLEMENT_DIRECTIVE_PATTERN.test(text)) {
        scores.implement += 4;
        reasons.push('implementation-directive');
    }
    if (knownFiles.length > 0
        && changedFiles.length === 0
        && scores.implement > 0
        && scores.review > 0) {
        scores.implement += 4;
        reasons.push('known-files-implementation-scope');
    }
    if (scores.debug > 0 && /修复|fix/i.test(text)) {
        scores.debug += 2;
    }
    if (scores.resume > 0 && (changedFiles.length > 0 || knownFiles.length > 0 || /上次|上一轮|历史任务|交接/.test(text))) {
        scores.resume += 2;
    }
    if (knownFiles.length > 0 && knownFiles.length <= 2
        && SIMPLE_PATTERN.test(text)
        && !HIGH_RISK_PATTERN.test(text)
        && scores.review === 0
        && scores.resume === 0
        && scores.debug === 0) {
        scores.simple = 9;
        reasons.push('small-known-ui-scope');
    }

    const ranked = Object.entries(scores)
        .sort((left, right) => right[1] - left[1] || INTENTS.indexOf(left[0]) - INTENTS.indexOf(right[0]));
    let [intent, score] = ranked[0];
    const margin = score - ranked[1][1];
    const missingInputs = [];

    if (score === 0) {
        intent = 'implement';
        score = 1;
        reasons.push('default:implement');
        missingInputs.push('请明确是理解、实现、排错、继续还是审查任务。');
    } else {
        reasons.push(`matched:${intent}`);
    }
    if (!task) {
        missingInputs.push('缺少任务描述。');
    }
    if (intent === 'implement' && knownFiles.length === 0 && changedFiles.length === 0 && score < 5) {
        missingInputs.push('缺少明确目标文件或功能入口。');
    }

    return {
        intent,
        confidence: confidenceFor(score, margin),
        score,
        reasons,
        missingInputs,
    };
}

module.exports = {
    INTENTS,
    classifyTaskIntent,
};
