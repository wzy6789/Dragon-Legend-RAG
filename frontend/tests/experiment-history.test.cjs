const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
};

const { summarizeExperimentHistory } = require('../lib/experiment-history.ts');

const answer = (id, overrides = {}) => ({
  id, role: 'assistant', content: 'Recorded answer', createdAt: 1,
  tier: 'flash', version: 'v19', status: 'done', ...overrides,
});
const conversation = (messages = [], overrides = {}) => ({
  id: 'conversation', title: '实验', tier: 'pro', createdAt: 1, updatedAt: 2,
  messages, ...overrides,
});
const evaluation = (status, overrides = {}) => ({ id: status, status, ...overrides });
const scored = (id, status, overrides = {}) => answer(id, {
  experiment: { evaluations: [evaluation(status)] }, ...overrides,
});
const side = (id, parent, overrides = {}) => answer(id, {
  research: { systemId: id, benchmarkId: 'new49', questionId: 'q1',
    comparisonId: 'pair', ...(parent ? { comparisonParentRunId: parent } : {}) },
  ...overrides,
});

test('empty or question-only history never invents a completed run or a default version', () => {
  for (const messages of [[], [{ id: 'q', role: 'user', content: '问题', createdAt: 1 }]]) {
    const summary = summarizeExperimentHistory(conversation(messages));
    assert.equal(summary.label, 'Pro');
    assert.equal(summary.state, 'idle');
    assert.equal(summary.status, '未开始');
    assert.doesNotMatch(summary.title, /v19|v25|已完成/);
  }
});

test('snapshot identity and message tier win over current conversation settings and requested version', () => {
  const summary = summarizeExperimentHistory(conversation([answer('a', {
    version: 'engine-v19', research: { systemId: 'requested-system' },
    experiment: { system_id: 'recorded-system', system_snapshot: { label: 'Flash 实验版', version: 'v19.2' } },
  })]));
  assert.equal(summary.label, 'Flash 实验版 · Flash');
  for (const value of ['Flash 实验版', 'v19.2', 'engine-v19', 'recorded-system', 'requested-system']) {
    assert.ok(summary.title.includes(value), value);
  }
  assert.doesNotMatch(summary.label, /Pro|requested-system/);
});

test('legacy missing metadata stays unknown instead of borrowing a modern version or completion', () => {
  const summary = summarizeExperimentHistory(conversation([answer('old', {
    tier: undefined, version: undefined, status: undefined,
  })]));
  assert.equal(summary.label, '未记录版本');
  assert.equal(summary.status, '状态未记录');
  assert.equal(summary.state, 'idle');
});

test('an earlier active generation outranks a later completed or judging answer', () => {
  for (const [status, expected] of [
    ['queued', '排队中'], ['running', '生成中'], ['streaming', '生成中'], ['reviewing', '核验中'],
  ]) {
    const summary = summarizeExperimentHistory(conversation([
      answer('active', { status, version: 'active-version' }),
      scored('later', 'judging', { version: 'later-version' }),
      answer('latest', { version: 'latest-version' }),
    ]));
    assert.equal(summary.status, expected);
    assert.equal(summary.state, status === 'queued' ? 'queued' : 'running');
    assert.match(summary.label, /active-version/);
  }
});

test('latest scoring state distinguishes queued, judging, unauthorized, unavailable and unknown', () => {
  for (const [status, expected, state] of [
    ['pending_generation', '等待评分', 'queued'], ['queued', '等待评分', 'queued'],
    ['running', '评分中', 'judging'], ['scoring', '评分中', 'judging'], ['judging', '评分中', 'judging'],
    ['not_authorized', '未授权评分', 'idle'], ['unavailable', '评分不可用', 'error'],
    ['blocked', '评分受阻', 'error'], ['error', '评分失败', 'error'], ['failed', '评分失败', 'error'],
    ['cancelled', '评分已取消', 'partial'], ['interrupted', '评分已中断', 'partial'],
    ['unverified_gold', '标准答案未核验', 'partial'], ['future-state', '评分未完成', 'partial'],
  ]) {
    const summary = summarizeExperimentHistory(conversation([scored('a', status)]));
    assert.equal(summary.status, expected, status);
    assert.equal(summary.state, state, status);
  }
});

test('an earlier run still being scored remains visible when no generation is active', () => {
  const summary = summarizeExperimentHistory(conversation([
    scored('a', 'judging', { version: 'judged-version' }), answer('b'),
  ]));
  assert.equal(summary.status, '评分中');
  assert.match(summary.label, /judged-version/);
});

test('old failures or stale error text cannot poison a successful latest run and evaluation', () => {
  const summary = summarizeExperimentHistory(conversation([
    answer('old-error', { status: 'error' }),
    scored('old-score-error', 'error'),
    answer('latest', {
      error: 'stale transport error',
      experiment: { evaluations: [evaluation('error'), evaluation('done', { error: 'stale error', score: 0 })] },
    }),
  ]));
  assert.equal(summary.status, '已评分');
  assert.equal(summary.state, 'done');
});

test('a newer failed evaluation cannot fall back to an earlier score', () => {
  const summary = summarizeExperimentHistory(conversation([answer('a', {
    experiment: { evaluations: [evaluation('done', { score: 97 }), evaluation('error')] },
  })]));
  assert.equal(summary.status, '评分失败');
  assert.equal(summary.state, 'error');
});

test('a superseded queued evaluation does not override the latest successful evaluation', () => {
  const summary = summarizeExperimentHistory(conversation([answer('a', {
    experiment: { evaluations: [evaluation('queued'), evaluation('done')] },
  })]));
  assert.equal(summary.status, '已评分');
});

test('generation failure, interruption and partial content never inherit scoring success', () => {
  for (const [overrides, expected, state] of [
    [{ status: 'error' }, '生成失败', 'error'],
    [{ status: 'stopped' }, '已停止', 'partial'],
    [{ status: 'interrupted' }, '已中断', 'partial'],
    [{ completionStatus: 'partial' }, '部分完成', 'partial'],
    [{ completionStatus: 'unknown' }, '部分完成', 'partial'],
    [{ provisional: true }, '部分完成', 'partial'],
  ]) {
    const summary = summarizeExperimentHistory(conversation([
      scored('older', 'done'), scored('latest', 'done', overrides),
    ]));
    assert.equal(summary.status, expected);
    assert.equal(summary.state, state);
  }
});

test('a completed unscored generation is not presented as scored', () => {
  const summary = summarizeExperimentHistory(conversation([answer('a')]));
  assert.equal(summary.status, '已生成 · 未评分');
  assert.equal(summary.state, 'idle');
});

test('comparison identifies both recorded versions without combining different protocol scores', () => {
  const summary = summarizeExperimentHistory(conversation([
    side('a', undefined, { experiment: { system_snapshot: { label: 'Alpha', version: 'v1' },
      evaluations: [evaluation('done', { protocol_id: 'seven-dim', score: 83, score_scale: 100 })] } }),
    side('b', 'run-a', { tier: 'max', experiment: { system_snapshot: { label: 'Beta', version: 'v2' },
      evaluations: [evaluation('done', { protocol_id: 'five-dim', score: 4, score_scale: 5 })] } }),
  ]));
  assert.equal(summary.label, 'A/B 对比');
  assert.match(summary.title, /A：Alpha/);
  assert.match(summary.title, /B：Beta/);
  assert.match(summary.title, /v1/);
  assert.match(summary.title, /v2/);
  assert.equal(summary.status, '已评分');
  assert.equal(summary.state, 'done');
  assert.doesNotMatch(JSON.stringify(summary), /83|43\.5|score|总分|均分|可比/);
});

test('comparison failures and partial scoring cannot be hidden by a successful later side', () => {
  for (const [a, expected, state] of [
    [side('a', undefined, { status: 'error' }), '生成失败', 'error'],
    [side('a', undefined, { completionStatus: 'partial' }), '部分完成', 'partial'],
    [side('a', undefined, { experiment: { evaluations: [evaluation('error')] } }), '评分失败', 'error'],
    [side('a'), '部分已评分', 'partial'],
  ]) {
    const summary = summarizeExperimentHistory(conversation([
      a, side('b', 'run-a', { experiment: { evaluations: [evaluation('done')] } }),
    ]));
    assert.equal(summary.label, 'A/B 对比');
    assert.equal(summary.status, expected);
    assert.equal(summary.state, state);
  }
});

test('a queued comparison side is represented before it has an assistant message', () => {
  const pending = { systemId: 'next-system', tier: 'max', benchmarkId: 'new49', questionId: 'q1',
    comparisonId: 'pair', prompt: '问题', afterMessageId: 'a' };
  const summary = summarizeExperimentHistory(conversation([
    side('a', undefined, { experiment: { evaluations: [evaluation('judging')] } }),
  ], { compareQueue: [pending] }));
  assert.equal(summary.label, 'A/B 对比');
  assert.equal(summary.status, '等待对比');
  assert.equal(summary.state, 'queued');
  assert.match(summary.title, /B：next-system/);
  const failed = summarizeExperimentHistory(conversation([
    side('a', undefined, { status: 'error' }),
  ], { compareQueue: [pending] }));
  assert.equal(failed.status, '生成失败');
});

test('missing comparison side stays incomplete and a surviving B is never relabeled A', () => {
  const summary = summarizeExperimentHistory(conversation([side('b', 'run-a', { version: 'Beta-only' })]));
  assert.equal(summary.status, '对比未完成');
  assert.equal(summary.state, 'partial');
  assert.match(summary.title, /A：未记录/);
  assert.match(summary.title, /B：Beta-only/);
});

test('an old failed comparison cannot change the newest independent experiment or mutate history', () => {
  const input = conversation([
    side('a', undefined, { status: 'error' }), side('b', 'run-a'), scored('latest', 'done'),
  ]);
  const before = structuredClone(input);
  const summary = summarizeExperimentHistory(input);
  assert.equal(summary.label, 'v19 · Flash');
  assert.equal(summary.status, '已评分');
  assert.deepEqual(input, before);
});

test('missing or unknown generation status cannot be inferred from a successful score', () => {
  for (const status of [undefined, '', 'future-status']) {
    const summary = summarizeExperimentHistory(conversation([scored('a', 'done', { status })]));
    assert.equal(summary.status, '状态未记录');
    assert.equal(summary.state, 'idle');
    const comparison = summarizeExperimentHistory(conversation([
      side('a', undefined, { status, experiment: { evaluations: [evaluation('done')] } }),
      side('b', 'run-a', { experiment: { evaluations: [evaluation('done')] } }),
    ]));
    assert.equal(comparison.status, '状态未记录');
    assert.equal(comparison.state, 'idle');
  }
});
