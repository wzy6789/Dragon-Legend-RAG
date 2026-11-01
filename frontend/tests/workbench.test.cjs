const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
};
const workbench = require('../lib/workbench.ts');
const api = require('../lib/api.ts');

test('comparison feedback distinguishes terminal failures from waiting and incompatible scores',()=>{
 const item=(status,evaluation)=>({message:{status},evaluation});
 const feedback=entries=>workbench.comparisonFeedback({entries,comparable:false,reasons:[]});
 assert.equal(feedback([item('done',{status:'error',score:0}),item('done',{status:'done',score:80})]).quality,'评分失败，查看详情');
 assert.equal(feedback([item('error'),item('done')]).timing,'本次运行未完成');
 assert.equal(feedback([item('done',{status:'done'}),item('done',{status:'done'})]).quality,'评分条件不一致');
 assert.equal(feedback([item('done'),item('done',{status:'not_authorized'})]).quality,'尚未评分');
 assert.equal(feedback([item('done',{status:'judging'}),item('done')]).quality,'正在独立评分');
 assert.equal(feedback([item('done',{status:'blocked'}),item('done')]).quality,'评测暂不可用');
});

test('restore comparison selectors with A left, B right and original tier even after B completes',()=>{
 const a={id:'a',role:'assistant',tier:'flash',research:{systemId:'flash-v19-sem_select',comparisonId:'g'}};
 const b={id:'b',role:'assistant',tier:'max',research:{systemId:'max-v31',comparisonId:'g',comparisonParentRunId:'run-a'}};
 const restored=workbench.restoreExperimentSetup({tier:'max',messages:[a,b]});
 assert.deepEqual(restored,{tier:'flash',systemId:'flash-v19-sem_select',compare:true,compareSystemId:'max-v31'});
 assert.equal(workbench.restoreExperimentSetup({tier:'pro',messages:[a,b,{id:'c',role:'assistant',tier:'pro',research:{systemId:'pro-v25'}}]}).compare,false);
 assert.equal(workbench.restoreExperimentSetup({tier:'flash',messages:[a],compareQueue:[{comparisonId:'g',systemId:'max-v31'}]}).compareSystemId,'max-v31');
});

test('comparison inspection synchronizes both peers but no unrelated runs', () => {
  const messages=[{id:'a',role:'assistant',runId:'ra',research:{comparisonId:'pair'}},{id:'b',role:'assistant',runId:'rb',research:{comparisonId:'pair'}},{id:'c',role:'assistant',runId:'rc'}];
  assert.deepEqual(workbench.inspectionTargets(messages,'b').map(x=>x.id),['a','b']);
  assert.deepEqual(workbench.inspectionTargets(messages,'c').map(x=>x.id),['c']);
  assert.deepEqual(workbench.inspectionTargets(messages,'deleted'),[]);
});

test('defaults are exact and pending/archive systems never become runnable', () => {
  assert.deepEqual(workbench.DEFAULT_SYSTEMS, { flash: 'flash-v19-sem_select', pro: 'pro-v25', max: 'max-v31' });
  assert.equal(workbench.canRunSystem({ status: 'archive', tiers: ['flash'] }, 'flash'), false);
  assert.equal(workbench.canRunSystem({ status: 'pending', tiers: ['flash'] }, 'flash'), false);
  assert.equal(workbench.canRunSystem({ status: 'runnable', tiers: ['pro'] }, 'flash'), false);
  assert.equal(workbench.canRunSystem({ status: 'runnable', tiers: ['flash'] }, 'flash'), true);
});

test('judge polling survives generation completion and unknown evaluation states', () => {
  assert.equal(workbench.shouldPollExperiment('done', { evaluations: [{ status: 'running' }] }), true);
  assert.equal(workbench.shouldPollExperiment('done', { evaluations: [{ status: 'new-status' }] }), true);
  assert.equal(workbench.shouldPollExperiment('done', { evaluations: [{ status: 'done' }, { status: 'error' }] }), false);
  assert.equal(workbench.shouldPollExperiment('running', { evaluations: [{ status: 'done' }] }), true);
  assert.equal(workbench.shouldPollExperiment('done', { evaluations: [] }), false);
  assert.equal(workbench.shouldPollExperiment('done', undefined), false);
  for (const status of ['not_authorized', 'unavailable', 'blocked', 'interrupted', 'unverified_gold']) {
    assert.equal(workbench.shouldPollExperiment('done', { evaluations: [{ status }] }), false);
  }
});

test('unknown metrics stay unknown, zero remains a measurement', () => {
  assert.equal(workbench.formatMs(undefined), '未记录');
  assert.equal(workbench.formatMs(null), '未记录');
  assert.equal(workbench.formatMs(NaN), '未记录');
  assert.equal(workbench.formatMs(-1), '未记录');
  assert.equal(workbench.formatMs(0), '0 ms');
});

test('comparison queue waits for first run, also after restoration', () => {
  const queue = [{ afterMessageId: 'first', systemId: 'b' }];
  assert.equal(workbench.nextComparisonTask({ messages: [{ id: 'first', status: 'running' }], compareQueue: queue }), undefined);
  assert.deepEqual(workbench.nextComparisonTask({ messages: [{ id: 'first', status: 'done', runId: 'parent' }], compareQueue: queue }), { ...queue[0], comparisonParentRunId: 'parent' });
  assert.equal(workbench.nextComparisonTask({ messages: [], compareQueue: queue }), undefined);
});

test('batch export preserves experiment provenance, excludes credentials recursively and escapes CSV formulas', () => {
  const conversation = {
    id: 'batch', title: '=unsafe,"title"', tier: 'flash', createdAt: 1, updatedAt: 2,
    apiKey: 'never-export', compareQueue: [{ secret: 'never-export' }],
    messages: [
      { id: 'q', role: 'user', content: '=question', createdAt: 1 },
      { id: 'a', role: 'assistant', content: 'answer', createdAt: 2, runId: 'r', status: 'done',
        research: { systemId: 'a', benchmarkId: 'free', questionId: null },
        experiment: { system_id: 'a', system_snapshot: { config: { api_key: 'nested-secret', nested: { Authorization: 'secret', keep: true } } },
          metrics: { ttft_ms: 0 }, evaluations: [{ id: 'j', status: 'done', score: 0 }] },
      },
    ],
  };
  const json = workbench.exportBatch(conversation, 'json').content;
  assert.ok(!json.includes('never-export') && !json.includes('nested-secret') && !json.includes('Authorization'));
  assert.equal(JSON.parse(json).messages[1].experiment.metrics.ttft_ms, 0);
  assert.match(workbench.exportBatch(conversation, 'md').content, /在线诊断/);
  const csv = workbench.exportBatch(conversation, 'csv').content;
  assert.match(csv, /'\=question/);
  assert.match(csv, /ttft_ms/);
  assert.ok(!csv.includes('undefined'));
});

test('adapters use exact research contract and original owner header (mock transport only)', async () => {
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url, options = {}) => {
    calls.push({ url, ...options });
    return new Response(JSON.stringify({ run_id: 'run', token: 'session-only' }), { status: 200 });
  };
  try {
    await api.createRun({ message: 'q', tier: 'flash', conversationId: 'c', clientRequestId: 'request', apiKey: 'byok', accessKey: 'owner',
      research: { systemId: 'flash-v19-sem_select', benchmarkId: 'new49', questionId: 'Q1', protocolId: 'p' } });
    assert.equal(calls[0].headers['X-RAG-Access-Key'], 'owner');
    assert.equal(calls[0].headers['X-LLM-API-Key'], 'byok');
    assert.equal(calls[0].headers['X-Experiment-Admin'], undefined);
    assert.deepEqual(JSON.parse(calls[0].body), { message: 'q', tier: 'flash', conversation_id: 'c', client_request_id: 'request',
      system_id: 'flash-v19-sem_select', benchmark_id: 'new49', question_id: 'Q1', protocol_id: 'p' });
    await api.getExperiment('run /', 'owner');
    assert.match(calls[1].url, /run%20%2F\/experiment$/);
    assert.equal(calls[1].headers['X-RAG-Access-Key'], 'owner');
    await assert.rejects(() => api.evaluateRun('run', 'owner', ''), /管理员/);
    assert.equal(calls.length, 2);
    await assert.rejects(() => api.getArchives('owner', ''), /管理员/);
    assert.equal(calls.length, 2);
    await api.evaluateRun('run', 'owner', 'admin');
    assert.equal(calls[2].headers['X-Experiment-Admin'], 'admin');
    assert.equal(calls[2].body, '{}');
    await api.getArchives('owner', 'admin');
    assert.match(calls[3].url, /\/api\/archives$/);
    assert.equal(calls[3].headers['X-RAG-Access-Key'], 'owner');
    await api.getArchive('one/batch', 'owner', 'admin');
    assert.match(calls[4].url, /\/api\/archives\/one%2Fbatch$/);
    await api.loginAdmin('password', 'owner');
    assert.equal(calls[5].headers['X-RAG-Access-Key'], 'owner');
    assert.equal(calls[5].headers['X-Experiment-Admin'], undefined);
    assert.deepEqual(JSON.parse(calls[5].body), { password: 'password' });
    await api.createRun({ message: 'q', tier: 'pro', conversationId: 'c', clientRequestId: 'b', apiKey: 'byok', comparisonParentRunId: 'first-run', research: { systemId: 'pro-v25', benchmarkId: 'free', questionId: null } });
    assert.equal(JSON.parse(calls[6].body).comparison_parent_run_id, 'first-run');
  } finally { global.fetch = original; }
});

test('percentiles use nearest rank and discard missing, nonfinite and negative timings', () => {
  assert.equal(workbench.percentile([null, undefined, NaN, Infinity, -1], 50), undefined);
  assert.equal(workbench.percentile([30, 0, 10, 20, null, NaN], 50), 10);
  assert.equal(workbench.percentile([30, 0, 10, 20], 95), 30);
  assert.equal(workbench.percentile([0], 95), 0);
  assert.equal(workbench.percentile(Array.from({ length: 100 }, (_, index) => index + 1), 95), 95);
});

test('report filters apply to each run and use inclusive local calendar dates', () => {
  const message = { id: 'a', role: 'assistant', status: 'done', version: 'v1', createdAt: new Date(2026, 9, 31, 23, 59).getTime(),
    experiment: { system_id: 's', benchmark_id: 'new49', system_snapshot: { version: 'v2' } } };
  const rows = workbench.reportRuns([{ id: 'c', messages: [{ role: 'user', content: 'q' }, message] }]);
  assert.equal(rows.length, 1);
  assert.equal(workbench.filterReportRuns(rows, { systemId: 's', version: 'v2', benchmarkId: 'new49', status: 'done', fromDate: '2026-10-31', toDate: '2026-10-31' }).length, 1);
  for (const filters of [{ systemId: 'other' }, { version: 'v1' }, { benchmarkId: 'free' }, { status: 'error' }, { fromDate: '2026-11-01' }, { toDate: '2026-10-30' }]) {
    assert.equal(workbench.filterReportRuns(rows, filters).length, 0);
  }
});

test('report timing summary counts failures separately and never substitutes zero for missing queue', () => {
  const messages = [
    { role: 'assistant', status: 'done', experiment: { metrics: { e2e_ms: 100, queue_ms: 20, ttft_ms: 0 } } },
    { role: 'assistant', status: 'done', experiment: { metrics: { e2e_ms: 200 } } },
    { role: 'assistant', status: 'done', experiment: { metrics: { e2e_ms: Infinity, queue_ms: 0 } } },
    { role: 'assistant', status: 'error', experiment: { metrics: { e2e_ms: 900, queue_ms: 0 } } },
    { role: 'assistant', status: 'running' },
    { role: 'assistant', status: 'interrupted' },
    { role: 'assistant' },
  ];
  const rows = workbench.reportRuns([{ id: 'c', messages }]);
  const summary = workbench.summarizeReport(rows, true);
  assert.deepEqual([summary.total, summary.succeeded, summary.failed, summary.active, summary.unknown], [7, 3, 2, 1, 1]);
  assert.deepEqual(summary.metrics.e2e_ms, { samples: 1, excluded: 2, p50: 80, p95: 80 });
  assert.deepEqual(summary.metrics.ttft_ms, { samples: 1, excluded: 2, p50: 0, p95: 0 });
  assert.equal(workbench.summarizeReport(rows, false).metrics.e2e_ms.samples, 2);
});

function comparisonMessages() {
  return [{ id: 'q', role: 'user', content: 'exact question' }, ...['a', 'b'].map((id, index) => ({
    id, role: 'assistant', status: 'done', research: { comparisonId: 'pair', question: 'exact question' },
    experiment: { system_id: id, context_hash: 'frozen-context', benchmark_id: 'new49', question_id: '1', protocol_id: 'protocol',
      evaluations: [{ id: 'judge-' + id, status: 'done', judge_model: 'judge', protocol_id: 'protocol', scorer_fingerprint: 'pinned-scorer', type: 'frozen-type', score_scale: 100, score: index ? 85 : 80 }] },
  }))];
}

test('score delta requires recorded matching question, context, bank, protocol, judge and frozen type', () => {
  const messages = comparisonMessages();
  const result = workbench.compareResults(messages, 'pair');
  assert.equal(result.comparable, true);
  assert.equal(result.delta, 5);
  assert.deepEqual(result.entries.map((row) => row.evaluation.score), [80, 85]);
  const missing = workbench.compareResults(messages.slice(0, 2), 'pair');
  assert.equal(missing.delta, undefined);
  assert.ok(missing.reasons.length);
});

test('execution comparison uses matched complete runs and never substitutes missing time with zero', () => {
  const messages = comparisonMessages();
  messages[1].experiment.metrics = { execution_ms: 2000, queue_ms: 0 };
  messages[2].experiment.metrics = { execution_ms: 1600, queue_ms: 9000 };
  const entries = workbench.compareResults(messages, 'pair').entries;
  assert.equal(workbench.compareExecution(entries).delta, -400);
  for (const mutation of [
    m => m.status = 'stopped', m => m.status = 'error', m => m.completionStatus = 'partial',
    m => m.experiment.context_hash = '', m => m.experiment.context_hash = 'different',
    m => m.research.question = 'another question', m => m.experiment.question_id = '2',
    m => m.experiment.benchmark_id = 'free', m => delete m.experiment.metrics.execution_ms,
    m => m.experiment.metrics.execution_ms = NaN, m => m.experiment.metrics.execution_ms = -1,
  ]) {
    const copy = structuredClone(messages); mutation(copy[2]);
    assert.equal(workbench.compareExecution(workbench.compareResults(copy,'pair').entries).delta, undefined);
  }
  messages[1].experiment.metrics.execution_ms = 0;
  messages[2].experiment.metrics.execution_ms = 0;
  assert.equal(workbench.compareExecution(workbench.compareResults(messages,'pair').entries).delta,0);
});

test('comparison preserves B identity after A is removed and keeps missing scores distinct', () => {
  const messages = comparisonMessages();
  messages[2].research.comparisonParentRunId = 'parent-a';
  const entries = workbench.compareResults([messages[0],messages[2]],'pair').entries;
  const sides = workbench.comparisonSides(entries);
  assert.equal(sides[0],undefined); assert.equal(sides[1].message.id,messages[2].id);
  assert.equal(workbench.evaluationLabel(undefined),'未评分');
  assert.equal(workbench.evaluationLabel({status:'not_authorized'}),'未评分');
  assert.equal(workbench.evaluationLabel({status:'running'}),'评分中');
  assert.equal(workbench.comparisonRunStatus({status:'done',completionStatus:'partial'}),'部分完成');
  assert.equal(workbench.comparisonRunStatus({status:'stopped'}),'已停止');
});

test('incomparable comparisons retain raw scores and explain each mismatched or missing field', () => {
  const mutations = [
    (message) => { message.research.question = 'different question'; },
    (message) => { message.experiment.context_hash = ''; },
    (message) => { message.experiment.context_hash = 'other-context'; },
    (message) => { message.experiment.benchmark_id = 'free'; },
    (message) => { message.experiment.question_id = '2'; },
    (message) => { message.experiment.protocol_id = ''; },
    (message) => { message.experiment.evaluations[0].protocol_id = 'other-protocol'; },
    (message) => { message.experiment.evaluations[0].judge_model = ''; },
    (message) => { message.experiment.evaluations[0].judge_model = 'other-judge'; },
    (message) => { message.experiment.evaluations[0].type = null; },
    (message) => { message.experiment.evaluations[0].type = 'other-type'; },
    (message) => { message.experiment.evaluations[0].score = null; },
    (message) => { message.experiment.evaluations[0].score_scale = 10; },
    (message) => { message.experiment.evaluations[0].status = 'running'; },
  ];
  for (const change of mutations) {
    const messages = comparisonMessages(); change(messages[2]);
    const result = workbench.compareResults(messages, 'pair');
    assert.equal(result.comparable, false);
    assert.equal(result.delta, undefined);
    assert.ok(result.reasons.length);
    assert.equal(result.entries[0].evaluation.score, 80);
  }
});

test('scorer identity must have equal nonempty pinned fingerprints, including historical records', () => {
  for (const fingerprint of [undefined, null, '', '   ', 'different-scorer']) {
    const messages = comparisonMessages();
    messages[2].experiment.evaluations[0].scorer_fingerprint = fingerprint;
    const result = workbench.compareResults(messages, 'pair');
    assert.equal(result.comparable, false);
    assert.equal(result.delta, undefined);
    assert.match(result.reasons.join(' '), /评分器身份/);
    assert.deepEqual(result.entries.map((entry) => entry.evaluation.score), [80, 85]);
  }
  const old = comparisonMessages();
  for (const message of old.slice(1)) {
    delete message.experiment.evaluations[0].scorer_fingerprint;
    message.experiment.evaluations[0].scorer_identity = { prompt_sha256: 'same-prompt' };
  }
  const result = workbench.compareResults(old, 'pair');
  assert.equal(result.delta, undefined);
  assert.match(result.reasons.join(' '), /身份未记录/);
});

test('exclude queue changes only E2E, leaving submission-origin TTFT and execution intact', () => {
  const rows = workbench.reportRuns([{ id: 'c', messages: [{ role: 'assistant', status: 'done', experiment: {
    metrics: { e2e_ms: 1000, queue_ms: 100, execution_ms: 900, ttft_ms: 150, draft_ttft_ms: 130 },
  } }] }]);
  const included = workbench.summarizeReport(rows, false).metrics;
  const excluded = workbench.summarizeReport(rows, true).metrics;
  assert.equal(included.e2e_ms.p50, 1000);
  assert.equal(excluded.e2e_ms.p50, 900);
  for (const key of ['ttft_ms', 'draft_ttft_ms', 'execution_ms', 'retrieval_ms']) assert.deepEqual(excluded[key], included[key]);
});
