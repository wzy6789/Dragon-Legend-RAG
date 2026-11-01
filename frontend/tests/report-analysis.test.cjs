const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
};
const { buildReportAnalysis } = require('../lib/report-analysis.ts');
const { reportRuns } = require('../lib/workbench.ts');

const PROTOCOL = 'SCORING_STANDARD_7D49_R2';
const FINGERPRINT = 'a1b2c3d4e5f60000000000000000000000';
function run(id = 'answer', { row = {}, message = {}, experiment = {}, evaluation = {}, metrics = {} } = {}) {
  return {
    conversationId: 'conversation', systemId: 'flash-v19', version: 'v19', benchmarkId: 'new49', status: 'done',
    message: {
      id, role: 'assistant', content: '答案', createdAt: 100, status: 'done',
      research: { systemId: 'flash-v19', benchmarkId: 'new49', questionId: 'q1', question: '唐舞麟是谁？' },
      experiment: {
        system_id: 'flash-v19', system_snapshot: { label: 'Flash v19' }, generation_model: 'generator-model',
        benchmark_id: 'new49', question_id: 'q1', protocol_id: PROTOCOL,
        evaluations: [{ id: 'judge-attempt', status: 'done', protocol_id: PROTOCOL, judge_model: 'judge-model',
          scorer_fingerprint: FINGERPRINT, type: 'L1', score: 82.5, score_scale: 100, ...evaluation }],
        metrics: { execution_ms: 1200, ttft_ms: 250, ...metrics }, ...experiment,
      }, ...message,
    }, ...row,
  };
}

function expectExcluded(row, bucket) {
  const counts = { incomplete: 0, unscored: 0, unverified: 0, timing: 0 };
  counts[bucket] = 1;
  assert.deepEqual(buildReportAnalysis([row]), { groups: [], excluded: counts, eligible: 0 });
}

test('empty input has no groups or invented scores', () => {
  assert.deepEqual(buildReportAnalysis([]), {
    groups: [], excluded: { incomplete: 0, unscored: 0, unverified: 0, timing: 0 }, eligible: 0,
  });
});

test('report rows project original scores, timing and answer navigation without aggregation', () => {
  const source = run();
  const rows = reportRuns([{ id: source.conversationId, messages: [source.message] }]);
  const result = buildReportAnalysis(rows);
  assert.equal(result.eligible, 1);
  assert.equal(result.groups.length, 1);
  assert.deepEqual(result.excluded, { incomplete: 0, unscored: 0, unverified: 0, timing: 0 });
  const { id, label, points, ...identity } = result.groups[0];
  assert.equal(typeof id, 'string');
  assert.ok(id.length > 0);
  assert.equal(typeof label, 'string');
  assert.deepEqual(identity, { benchmarkId: 'new49', protocolId: PROTOCOL, judgeModel: 'judge-model',
    scorerFingerprint: FINGERPRINT, questionType: 'L1', scale: 100 });
  const { key, ...point } = points[0];
  assert.equal(typeof key, 'string');
  assert.ok(key.length > 0);
  assert.deepEqual(point, { conversationId: 'conversation', messageId: 'answer', systemId: 'flash-v19',
    systemLabel: 'Flash v19', question: '唐舞麟是谁？', score: 82.5, executionMs: 1200, ttftMs: 250,
    createdAt: 100, generationModel: 'generator-model' });
});

test('every benchmark, protocol, judge, full fingerprint, type and total scale gets its own group', () => {
  const base = run('base', { experiment: { protocol_id: 'custom-protocol' }, evaluation: { protocol_id: 'custom-protocol' } });
  const rows = [base];
  for (const [name, change] of [
    ['bank', r => { r.benchmarkId = 'legacy50'; r.message.experiment.benchmark_id = 'legacy50'; }],
    ['protocol', r => { r.message.experiment.protocol_id = 'another-protocol'; r.message.experiment.evaluations[0].protocol_id = 'another-protocol'; }],
    ['judge', r => { r.message.experiment.evaluations[0].judge_model = 'another-judge'; }],
    ['fingerprint', r => { r.message.experiment.evaluations[0].scorer_fingerprint = 'a1b2c3d4e5f60000000000000000000001'; }],
    ['type', r => { r.message.experiment.evaluations[0].type = 'L2'; }],
    ['scale', r => { r.message.experiment.evaluations[0].score_scale = 10; r.message.experiment.evaluations[0].score = 8.25; }],
  ]) {
    const next = structuredClone(base);
    next.message.id = name;
    change(next);
    rows.push(next);
  }
  const sameRubric = structuredClone(base);
  sameRubric.message.id = 'another-system';
  sameRubric.systemId = 'pro-v25';
  sameRubric.version = 'v25';
  sameRubric.message.experiment.generation_model = 'another-generator';
  sameRubric.message.experiment.evaluations[0].score = 90;
  rows.push(sameRubric);
  const result = buildReportAnalysis(rows);
  assert.equal(result.eligible, 8);
  assert.equal(result.groups.length, 7);
  assert.equal(new Set(result.groups.map(g => g.id)).size, 7);
  assert.deepEqual(result.groups.find(g => g.points.some(p => p.messageId === 'base')).points.map(p => p.score), [82.5, 90]);
  for (const name of ['bank', 'protocol', 'judge', 'fingerprint', 'type', 'scale']) {
    assert.equal(result.groups.find(g => g.points.some(p => p.messageId === name)).points.length, 1);
  }
});

test('identity comparisons preserve case and raw text rather than normalizing distinct scorers', () => {
  for (const change of [
    r => { r.benchmarkId = 'NEW49'; },
    r => { r.message.experiment.evaluations[0].judge_model = 'Judge-Model'; },
    r => { r.message.experiment.evaluations[0].scorer_fingerprint = FINGERPRINT.toUpperCase(); },
    r => { r.message.experiment.evaluations[0].type = 'l1'; },
    r => { r.message.experiment.evaluations[0].judge_model = ' judge-model '; },
    r => { r.message.experiment.protocol_id = PROTOCOL.toLowerCase(); r.message.experiment.evaluations[0].protocol_id = PROTOCOL.toLowerCase(); },
  ]) {
    const next = run('distinct');
    change(next);
    const result = buildReportAnalysis([run(), next]);
    assert.equal(result.eligible, 2);
    assert.equal(result.groups.length, 2);
  }
});

test('group and point IDs do not collide when identifiers contain separators', () => {
  const a = run('answer:one', { row: { conversationId: 'conversation' }, evaluation: { judge_model: 'judge|part', type: 'type' } });
  const b = run('one', { row: { conversationId: 'conversation:answer' }, evaluation: { judge_model: 'judge', type: 'part|type' } });
  const result = buildReportAnalysis([a, b]);
  assert.equal(new Set(result.groups.map(g => g.id)).size, 2);
  assert.equal(new Set(result.groups.flatMap(g => g.points.map(p => p.key))).size, 2);
});

test('zero score, zero execution and zero TTFT are recorded and no score averaging occurs', () => {
  const result = buildReportAnalysis([
    run('zero', { evaluation: { score: 0 }, metrics: { execution_ms: 0, ttft_ms: 0 } }),
    run('maximum', { evaluation: { score: 100 } }),
  ]);
  assert.equal(result.eligible, 2);
  assert.deepEqual(result.groups[0].points.map(p => [p.score, p.executionMs, p.ttftMs]), [[0, 0, 0], [100, 1200, 250]]);
});

test('known protocol total scales are reused, never inferred from dimensions or observed scores', () => {
  for (const [protocol, scale, score] of [
    [PROTOCOL, 100, 82.5], ['ONLINE_DIAGNOSTIC_7D_V1', 10, 7.5], ['SCORING_STANDARD_8.86_老50题', 10, 9],
  ]) {
    for (const recorded of [undefined, null, scale]) {
      const result = buildReportAnalysis([run('valid', { experiment: { protocol_id: protocol },
        evaluation: { protocol_id: protocol, score, score_scale: recorded, dimensions: { fact: 10 } } })]);
      assert.equal(result.eligible, 1);
      assert.equal(result.groups[0].scale, scale);
      assert.equal(result.groups[0].points[0].score, score);
    }
  }
  expectExcluded(run('conflict', { evaluation: { score: 8, score_scale: 10 } }), 'unverified');
  expectExcluded(run('unknown', { experiment: { protocol_id: 'FUTURE' },
    evaluation: { protocol_id: 'FUTURE', score_scale: undefined, dimensions: { fact: 100 } } }), 'unverified');
});

test('incomplete generation wins over all other exclusion reasons, including partial done output', () => {
  for (const status of ['queued', 'running', 'streaming', 'reviewing', 'error', 'stopped', 'interrupted', '', undefined]) {
    expectExcluded(run('incomplete', { row: { status }, message: { status, experiment: undefined } }), 'incomplete');
  }
  for (const completionStatus of ['partial', 'unknown', '', ' complete ', null]) {
    expectExcluded(run('partial', { message: { completionStatus }, experiment: { evaluations: [] }, metrics: { execution_ms: null } }), 'incomplete');
  }
  for (const completionStatus of [undefined, 'complete']) {
    assert.equal(buildReportAnalysis([run('complete', { message: { completionStatus } })]).eligible, 1);
  }
  expectExcluded(run('stale-row', { message: { status: 'error' } }), 'incomplete');
  expectExcluded(run('stale-message', { row: { status: 'running' } }), 'incomplete');
});

test('only the last judge attempt counts, even when retry timestamps or older scores look better', () => {
  for (const status of ['failed', 'error', 'queued', 'pending_generation', 'judging', 'running', 'scoring', 'blocked',
    'not_authorized', 'unavailable', 'cancelled', 'canceled', 'interrupted', 'skipped', 'unverified_gold', 'future', '', undefined]) {
    const row = run();
    row.message.experiment.evaluations[0].created_at = 500;
    row.message.experiment.evaluations.push({ id: 'retry', status, score: 0, created_at: 1 });
    row.message.experiment.metrics.execution_ms = null;
    expectExcluded(row, 'unscored');
  }
  for (const evaluations of [undefined, [], [undefined]]) {
    expectExcluded(run('missing', { experiment: { evaluations } }), 'unscored');
  }
  expectExcluded(run('no-experiment', { message: { experiment: undefined } }), 'unscored');
  const retry = run();
  const good = { ...retry.message.experiment.evaluations[0], id: 'retry', score: 0 };
  retry.message.experiment.evaluations.push(good);
  assert.equal(buildReportAnalysis([retry]).groups[0].points[0].score, 0);
  good.score = undefined;
  expectExcluded(retry, 'unverified');
});

test('all successful judge status spellings use the same score validation', () => {
  for (const status of ['done', 'complete', 'completed', 'success', 'succeeded']) {
    assert.equal(buildReportAnalysis([run('valid', { evaluation: { status } })]).eligible, 1);
  }
});

test('missing, blank or non-string identities are unverified before missing execution timing', () => {
  for (const value of [undefined, null, '', '   ', '\t\n', 0, {}, '未记录', ' 未记录 ']) {
    for (const change of [
      r => { r.benchmarkId = value; },
      r => { r.message.experiment.protocol_id = value; },
      r => { r.message.experiment.evaluations[0].protocol_id = value; },
      r => { r.message.experiment.evaluations[0].judge_model = value; },
      r => { r.message.experiment.evaluations[0].scorer_fingerprint = value; },
      r => { r.message.experiment.evaluations[0].type = value; },
    ]) {
      const row = run('invalid', { metrics: { execution_ms: null } });
      change(row);
      expectExcluded(row, 'unverified');
    }
  }
  for (const protocol_id of [PROTOCOL.toLowerCase(), ` ${PROTOCOL}`, 'ONLINE_DIAGNOSTIC_7D_V1']) {
    expectExcluded(run('mismatch', { evaluation: { protocol_id } }), 'unverified');
  }
});

test('missing, invalid, out-of-range scores and invalid scales never become zero points', () => {
  for (const score of [undefined, null, '', '0', true, {}, [], NaN, Infinity, -Infinity, -0.1, 100.1]) {
    expectExcluded(run('score', { evaluation: { score }, metrics: { execution_ms: null } }), 'unverified');
  }
  for (const score_scale of ['', '100', true, {}, 0, -1, NaN, Infinity, -Infinity, 10]) {
    expectExcluded(run('scale', { evaluation: { score_scale } }), 'unverified');
  }
});

test('invalid execution is excluded without borrowing E2E, while invalid TTFT remains null', () => {
  for (const value of [undefined, null, '', '0', false, {}, NaN, Infinity, -Infinity, -1]) {
    expectExcluded(run('timing', { metrics: { execution_ms: value, e2e_ms: 1500, queue_ms: 300 } }), 'timing');
    const result = buildReportAnalysis([run('ttft', { metrics: { ttft_ms: value } })]);
    assert.equal(result.eligible, 1);
    assert.equal(result.groups[0].points[0].ttftMs, null);
  }
  expectExcluded(run('no-metrics', { experiment: { metrics: null } }), 'timing');
});

test('question text falls back to recorded question ID then an explicit missing label', () => {
  for (const question of [undefined, null, '', '   ']) {
    const row = run();
    row.message.research.question = question;
    assert.equal(buildReportAnalysis([row]).groups[0].points[0].question, 'q1');
    row.message.experiment.question_id = ' ';
    assert.equal(buildReportAnalysis([row]).groups[0].points[0].question, '题目未记录');
  }
  const row = run('fallback', { message: { research: undefined },
    experiment: { system_snapshot: undefined, generation_model: null } });
  const point = buildReportAnalysis([row]).groups[0].points[0];
  assert.equal(point.question, 'q1');
  assert.equal(point.systemLabel, 'flash-v19');
  assert.equal(point.generationModel, '未记录');
});

test('points sort newest first with stable ties; groups sort by newest point then deterministic identity', () => {
  const rows = [
    run('old', { message: { createdAt: 1 } }),
    run('tie-first', { message: { createdAt: 300 } }),
    run('other-group', { message: { createdAt: 250 }, evaluation: { type: 'L2' } }),
    run('tie-second', { message: { createdAt: 300 } }),
    run('newest', { message: { createdAt: 400 }, evaluation: { type: 'L3' } }),
    run('unknown-time', { message: { createdAt: NaN } }),
  ];
  const before = structuredClone(rows);
  const result = buildReportAnalysis(rows);
  assert.deepEqual(result.groups.map(g => g.questionType), ['L3', 'L1', 'L2']);
  assert.deepEqual(result.groups[1].points.map(p => p.messageId), ['tie-first', 'tie-second', 'old', 'unknown-time']);
  assert.deepEqual(rows, before);
  const tiedGroups = [run('b', { evaluation: { type: 'L2' } }), run('a')];
  const ids = buildReportAnalysis(tiedGroups).groups.map(g => g.id);
  assert.deepEqual(ids, buildReportAnalysis([...tiedGroups].reverse()).groups.map(g => g.id));
});

test('duplicate records and overlapping points remain separate with unique, repeatable navigation keys', () => {
  const row = run();
  const other = run('other-answer');
  const result = buildReportAnalysis([row, row, other]);
  assert.equal(result.eligible, 3);
  assert.equal(result.groups[0].points.length, 3);
  assert.deepEqual(result.groups[0].points.map(p => p.messageId), ['answer', 'answer', 'other-answer']);
  const keys = result.groups[0].points.map(p => p.key);
  assert.equal(new Set(keys).size, 3);
  assert.deepEqual(keys, buildReportAnalysis([row, row, other]).groups[0].points.map(p => p.key));
  assert.equal(keys[2], buildReportAnalysis([other]).groups[0].points[0].key);
});

test('labels identify bank, type and judge before the protocol and fingerprint prefix', () => {
  const result = buildReportAnalysis([
    run(),
    run('other', { evaluation: { scorer_fingerprint: 'b2c3d4e5f6000000000000000000000000' } }),
    run('same-prefix', { evaluation: { scorer_fingerprint: 'a1b2c3d4e5f60000000000000000000001' } }),
  ]);
  assert.equal(new Set(result.groups.map(g => g.label)).size, 3);
  for (const group of result.groups) {
    assert.match(group.label, /new49|新49/);
    assert.ok(group.label.indexOf('L1') < group.label.indexOf(PROTOCOL));
    assert.ok(group.label.indexOf('judge-model') < group.label.indexOf(PROTOCOL));
    assert.ok(group.label.includes(group.scorerFingerprint.slice(0, 8)));
  }
});

test('all rows are accounted for once across eligible and ordered exclusion buckets', () => {
  const result = buildReportAnalysis([
    run('eligible'),
    run('incomplete', { row: { status: 'error' }, message: { status: 'error', experiment: undefined } }),
    run('unscored', { experiment: { evaluations: [] }, metrics: { execution_ms: null } }),
    run('unverified', { evaluation: { scorer_fingerprint: '' }, metrics: { execution_ms: null } }),
    run('timing', { metrics: { execution_ms: null } }),
  ]);
  assert.equal(result.eligible, 1);
  assert.deepEqual(result.excluded, { incomplete: 1, unscored: 1, unverified: 1, timing: 1 });
  assert.equal(result.eligible + Object.values(result.excluded).reduce((sum, count) => sum + count, 0), 5);
});
