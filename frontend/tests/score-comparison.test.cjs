const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, file);
const { compareResults, comparisonFeedback } = require('../lib/workbench.ts');
function pair() {
  return ['a', 'b'].map((id, i) => ({ id, role: 'assistant', status: 'done', content: 'answer', createdAt: 1,
    research: { comparisonId: 'pair', question: 'same question', ...(i ? { comparisonParentRunId: 'a' } : {}) },
    experiment: { system_id: id, benchmark_id: 'new49', question_id: '1', context_hash: 'same', protocol_id: 'SCORING_STANDARD_7D49_R2',
      evaluations: [{ id, status: 'done', score: i ? 92 : 86, score_scale: 100, protocol_id: 'SCORING_STANDARD_7D49_R2', type: 'L3',
        judge_model: 'judge', scorer_fingerprint: 'frozen', dimensions: { rel: 8, fact: i ? 9 : 7, reas: i ? 6 : 9, comp: 0 }, weights: { fact: 40 } }] } }));
}
const rows = messages => require('../lib/score-comparison.ts').buildDimensionComparison(compareResults(messages, 'pair'));

test('partial generation must not claim a score winner even with a successful judge', () => {
  const messages = pair(); messages[1].completionStatus = 'degraded';
  const result = compareResults(messages, 'pair');
  assert.equal(result.comparable, false);
  assert.equal(result.delta, undefined);
  assert.equal(comparisonFeedback(result).quality, '回答未完整完成');
});
test('invalid, conflicting and unknown total scales cannot yield a winner', () => {
  for (const scale of [0, -1, NaN, '100', 10]) {
    const messages = pair(); messages[1].experiment.evaluations[0].score_scale = scale;
    assert.equal(compareResults(messages, 'pair').delta, undefined, String(scale));
  }
  for (const score of [-1, 101, Infinity]) {
    const messages = pair(); messages[1].experiment.evaluations[0].score = score;
    assert.equal(compareResults(messages, 'pair').delta, undefined);
  }
  const messages = pair(); for (const m of messages) {
    m.experiment.protocol_id = 'UNKNOWN'; m.experiment.evaluations[0].protocol_id = 'UNKNOWN';
    delete m.experiment.evaluations[0].score_scale;
  }
  assert.equal(compareResults(messages, 'pair').delta, undefined);
});
test('dimensions align by key, preserve zero and distinguish missing from a draw', () => {
  const result = rows(pair());
  assert.equal(result.find(r => r.key === 'fact').delta, 2);
  assert.equal(result.find(r => r.key === 'reas').delta, -3);
  assert.equal(result.find(r => r.key === 'comp').delta, 0);
  assert.equal(result.find(r => r.key === 'comp').left.value, 0);
  assert.equal(result.find(r => r.key === 'lang').delta, undefined);
  assert.equal(result.find(r => r.key === 'fact').left.weightPercent, 40);
});
test('no dimension differences across incompatible judging protocols or failed retries', () => {
  for (const mutate of [e => e.judge_model = 'other', e => e.type = 'L2', e => e.scorer_fingerprint = '', e => e.status = 'error']) {
    const messages = pair(); mutate(messages[1].experiment.evaluations[0]);
    assert.ok(rows(messages).every(r => r.delta === undefined));
  }
});
test('extra, missing or invalid dimensions never become a computed difference', () => {
  const messages = pair(); Object.assign(messages[0].experiment.evaluations[0].dimensions, { fact: 11, novelty: 4 });
  Object.assign(messages[1].experiment.evaluations[0].dimensions, { novelty: 5 });
  const result = rows(messages);
  assert.equal(result.find(r => r.key === 'fact').delta, undefined);
  assert.equal(result.find(r => r.key === 'novelty').left.value, 4);
  assert.equal(result.find(r => r.key === 'novelty').delta, undefined);
});
test('a deleted A keeps the surviving score in column B', () => {
  const result = rows(pair().slice(1));
  assert.equal(result.find(r => r.key === 'fact').left, undefined);
  assert.equal(result.find(r => r.key === 'fact').right.value, 9);
  assert.ok(result.every(r => r.delta === undefined));
});
test('known protocol can resolve an unrecorded scale without fabricating a new one', () => {
  const messages = pair(); delete messages[0].experiment.evaluations[0].score_scale;
  assert.equal(compareResults(messages, 'pair').delta, 6);
  assert.equal(rows(messages).find(r => r.key === 'fact').delta, 2);
});
test('recorded conflicting weights disable claims about a like-for-like winner', () => {
  const messages = pair(); messages[1].experiment.evaluations[0].weights.fact = 30;
  assert.equal(compareResults(messages, 'pair').delta, undefined);
  assert.ok(rows(messages).every(r => r.delta === undefined));
});
