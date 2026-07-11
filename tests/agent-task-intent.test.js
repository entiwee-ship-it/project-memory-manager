const assert = require('node:assert/strict');
const { INTENTS, classifyTaskIntent } = require('../src/agent/task-intent');

assert.deepEqual(INTENTS, ['understand', 'implement', 'debug', 'resume', 'review', 'simple']);
assert.equal(classifyTaskIntent({ task: '解释 HTTP 登录到 Pinus 会话链路' }).intent, 'understand');
assert.equal(classifyTaskIntent({ task: '修复后台验证码偶尔不刷新' }).intent, 'debug');
assert.equal(classifyTaskIntent({ task: '实现商城充值商品快照统一来源' }).intent, 'implement');
assert.equal(classifyTaskIntent({ task: '继续上次大厅 prefab 调整' }).intent, 'resume');
assert.equal(classifyTaskIntent({ task: '审查这些改动有没有漏改', changedFiles: ['a.ts'] }).intent, 'review');
assert.equal(classifyTaskIntent({ task: '把按钮文案改成确定', knownFiles: ['View.vue'] }).intent, 'simple');

const ambiguous = classifyTaskIntent({ task: '处理商城这块' });
assert.equal(ambiguous.intent, 'implement');
assert.equal(ambiguous.confidence, 'low');
assert.ok(ambiguous.reasons.length > 0);
assert.ok(ambiguous.missingInputs.length > 0);

assert.throws(() => classifyTaskIntent({ task: 'test', intent: 'unknown' }), /invalid intent/i);
console.log('agent task intent validation passed');
