const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, filename) => {
    module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, filename);
  };
}
const { buildScoreVisual, groupTimeline, formatScoreValue } = require('../lib/visual-metrics.ts');

// Actual fixed sample from test_experiment_service.py::test_fixed_new49_sample_matches_existing_score_function.
// L1 weights and the dimension scale come from src/evaluate_7d49.py, not from this sample's maximum.
const new49 = {
  id: 'new49-sample', status: 'done', judge_model: 'qwen3.8-flash',
  protocol_id: 'SCORING_STANDARD_7D49_R2', score: 89.2, score_scale: 100,
  dimensions: { rel: 8, fact: 9, reas: 7, comp: 10, lang: 8, tone: 9, cite: 9 },
  weights: { rel: 10, fact: 40, reas: 5, comp: 20, lang: 8, tone: 7, cite: 10 },
  reasons: 'All required atoms covered.',
};
const message = (timeline, status = 'done') => ({
  id: 'run', role: 'assistant', content: '', createdAt: 0, status,
  experiment: { timeline },
});

test('failed or queued judge output is never drawn as a valid zero score',()=>{
  for(const status of ['error','queued','judging','blocked']){
    const visual=buildScoreVisual({...new49,status,score:0});
    assert.equal(visual.total.percent,null);
    assert.equal(visual.total.state,'missing');
    assert.ok(visual.dimensions.every(row=>row.percent===null));
  }
});

test('real 7D49 fixture uses total 100, dimensions 10, and percentage-point weights', () => {
  const visual = buildScoreVisual(new49);
  assert.equal(visual.total.scale, 100);
  assert.equal(visual.total.percent, 89.2);
  assert.deepEqual(visual.dimensions.map(row => [row.key, row.scale, row.percent]), [
    ['rel', 10, 80], ['fact', 10, 90], ['reas', 10, 70], ['comp', 10, 100],
    ['lang', 10, 80], ['tone', 10, 90], ['cite', 10, 90],
  ]);
  assert.equal(visual.dimensions[1].weightPercent, 40);
  assert.equal(visual.dimensions[3].label, '覆盖完整');
  assert.equal(formatScoreValue(visual.total), '89.2');
});

test('zero is recorded; absent and null dimensions remain missing', () => {
  const visual = buildScoreVisual({ ...new49, score: 0, dimensions: { rel: 0, fact: null }, weights: { rel: 0 } });
  assert.equal(visual.total.percent, 0);
  assert.equal(formatScoreValue(visual.total), '0');
  assert.equal(visual.dimensions[0].percent, 0);
  assert.equal(visual.dimensions[0].weightPercent, 0);
  assert.equal(visual.dimensions[1].state, 'missing');
  assert.equal(visual.dimensions[2].state, 'missing');
  assert.equal(visual.dimensions[1].percent, null);
  assert.equal(formatScoreValue(visual.dimensions[1]), '未记录');
  assert.equal(buildScoreVisual().total.state, 'missing');
  assert.deepEqual(buildScoreVisual().dimensions, []);
});

test('online and legacy protocols have exact 10-point scales and fractional weights', () => {
  for (const protocol_id of ['ONLINE_DIAGNOSTIC_7D_V1', 'SCORING_STANDARD_8.86_老50题']) {
    const visual = buildScoreVisual({ ...new49, protocol_id, score: 7.1, score_scale: 10, weights: { fact: 0.4 } });
    assert.equal(visual.total.scale, 10);
    assert.equal(visual.total.percent, 71);
    assert.equal(visual.dimensions[1].weightPercent, 40);
    assert.equal(visual.dimensions[1].scale, 10);
  }
  assert.equal(buildScoreVisual({ ...new49, protocol_id: 'ONLINE_DIAGNOSTIC_7D_V1', score_scale: 10 }).dimensions[3].label, '估计完整度');
  assert.equal(buildScoreVisual({ ...new49, score_scale: undefined }).total.scale, 100);
});

test('unknown protocol never borrows dimension scale from total or observed maximum', () => {
  const visual = buildScoreVisual({ ...new49, protocol_id: 'FUTURE', score_scale: 100, dimensions: { fact: 9, extra: 0 } });
  assert.equal(visual.total.percent, 89.2);
  assert.deepEqual(visual.dimensions.map(row => [row.value, row.scale, row.percent, row.state]), [
    [9, null, null, 'unknown-scale'], [0, null, null, 'unknown-scale'],
  ]);
  assert.equal(visual.dimensions[0].weightPercent, null);
  const unknown = buildScoreVisual({ ...new49, protocol_id: 'SCORING_STANDARD_7D49_R3', score_scale: undefined });
  assert.equal(unknown.total.scale, null);
  assert.equal(unknown.total.percent, null);
  assert.equal(formatScoreValue(unknown.total), '89.2');
  assert.ok(unknown.notes.some(note => note.includes('量纲')));
});

test('invalid, conflicting and out-of-range scales never fabricate a full or clamped bar', () => {
  const conflict = buildScoreVisual({ ...new49, score_scale: 10 });
  assert.equal(conflict.total.scale, null);
  assert.equal(conflict.total.percent, null);
  assert.equal(conflict.dimensions[0].scale, 10);
  assert.ok(conflict.notes.some(note => note.includes('冲突')));
  for (const score_scale of [0, -1, Infinity, NaN, '100']) {
    assert.equal(buildScoreVisual({ ...new49, score_scale }).total.percent, null);
  }
  for (const score of [-1, 101]) {
    const total = buildScoreVisual({ ...new49, score }).total;
    assert.equal(total.state, 'out-of-range');
    assert.equal(total.percent, null);
    assert.equal(total.value, score);
  }
  for (const score of [true, NaN, Infinity, '8', { score: 8 }]) {
    const total = buildScoreVisual({ ...new49, score }).total;
    assert.equal(total.state, 'invalid');
    assert.equal(total.percent, null);
  }
});

test('unknown extra dimensions retain the raw value but get no invented scale', () => {
  const visual = buildScoreVisual({ ...new49, dimensions: { ...new49.dimensions, novelty: 4 } });
  assert.equal(visual.dimensions.at(-1).key, 'novelty');
  assert.equal(visual.dimensions.at(-1).value, 4);
  assert.equal(visual.dimensions.at(-1).scale, null);
  assert.equal(visual.dimensions.at(-1).percent, null);
});

// Same event order and millisecond values as the bridge's generation-lock fixture.
const serviceTimeline = [
  { event: 'stage', stage: 'queued outside lock', at_ms: 200 },
  { event: 'started', at_ms: 500 },
  { event: 'first_draft_token', at_ms: 700 },
  { event: 'first_token', at_ms: 900 },
  { event: 'sources', at_ms: 900 },
  { event: 'retrieval_start', at_ms: 900 },
  { event: 'retrieval_end', at_ms: 900 },
  { event: 'done', at_ms: 1000 },
];

test('actual backend timeline groups adjacent delivery events, retaining exact order and timestamps', () => {
  const groups = groupTimeline(message(serviceTimeline));
  assert.deepEqual(groups.map(group => group.phase), ['event', 'execution', 'output', 'evidence', 'retrieval', 'completed']);
  assert.equal(groups[2].noisy, true);
  assert.equal(groups[2].events.length, 2);
  assert.equal(groups[4].events.length, 2);
  assert.deepEqual(groups.flatMap(group => group.events.map(event => event.atMs)), [200, 500, 700, 900, 900, 900, 900, 1000]);
  assert.deepEqual(groups.flatMap(group => group.events.map(event => event.event)), serviceTimeline.map(event => event.event));
});

test('only observed phases appear, and retries remain in chronological position', () => {
  const groups = groupTimeline(message([
    { event: 'stage', stage: '规划要点并整理证据', at_ms: 0 },
    { event: 'retrieval_start', at_ms: 1.125 },
    { event: 'stage', stage: '生成待核验初稿', at_ms: 2 },
    { event: 'stage', stage: '核验证据并修订答案', at_ms: 3 },
    { event: 'retrieval_start', at_ms: 4 },
    { event: 'error', at_ms: 5 },
  ], 'error'));
  assert.deepEqual(groups.map(group => group.phase), ['planning', 'retrieval', 'generation', 'revision', 'retrieval', 'error']);
  assert.equal(groups[1].events[0].atMs, 1.125);
  assert.ok(!groups.some(group => group.phase === 'completed'));
  assert.deepEqual(groupTimeline({ ...message([], 'running'), stage: '正在检索' }), []);
  assert.deepEqual(groupTimeline(message([], 'done')), []);
});

test('timeline drops payloads and preserves unknown stage metadata without interpreting completion', () => {
  const groups = groupTimeline(message([
    { event: 'stage', stage: '核验证据', at_ms: 0, reasoning: 'private-thought', text: 'private-body' },
    { event: 'draft_token', at_ms: 1, text: 'private-draft' },
    { event: 'future_event', stage: '未知阶段', at_ms: null, chain_of_thought: 'private-chain' },
  ], 'done'));
  assert.equal(groups[0].label, '核验证据');
  assert.equal(groups[2].phase, 'event');
  assert.equal(groups[2].events[0].stage, '未知阶段');
  assert.equal(groups[2].events[0].atMs, null);
  assert.ok(!JSON.stringify(groups).includes('private-'));
  assert.ok(!groups.some(group => group.phase === 'completed'));
});

test('cancelled and interrupted runs retain their event labels without a synthetic done phase', () => {
  for (const event of ['cancelled', 'interrupted']) {
    const groups = groupTimeline(message([{ event, at_ms: 0 }], 'interrupted'));
    assert.equal(groups.length, 1);
    assert.equal(groups[0].phase, event);
    assert.equal(groups[0].events[0].atMs, 0);
  }
});
