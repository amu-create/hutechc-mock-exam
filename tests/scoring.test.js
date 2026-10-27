import test from 'node:test';
import assert from 'node:assert/strict';
import { ruleChecks, validateErrors, scoreErrors, combineRuns, gradeFor } from '../lib/scoring.js';
import { findQuestion, QUESTIONS } from '../lib/questions.js';
import { gradeAnswer } from '../api/grade.js';

const q1 = findQuestion('q1');
const q3 = findQuestion('q3');
const q4 = findQuestion('q4');

test('모범답안은 규칙 검사에서 오류가 없다', () => {
  for (const q of QUESTIONS.filter((x) => x.type !== 'choice')) {
    const r = ruleChecks(q, q.reference);
    assert.equal(r.blocking, null, q.id);
    assert.deepEqual(r.errors, [], `${q.id}: ${JSON.stringify(r.errors)}`);
  }
});

test('빈 답안·다른 언어·원문 복붙은 차단', () => {
  assert.equal(ruleChecks(q1, '   ').blocking, '빈 답안');
  assert.match(ruleChecks(q1, '이 제품은 보관하지 마세요').blocking, /영어/);
  assert.match(ruleChecks(q3, q3.source).blocking, /한국어|원문/);
});

test('부정이 빠지면 critical (엔진 A 출력 그대로)', () => {
  const r = ruleChecks(q1, q1.mt['엔진 A']);
  assert.ok(r.errors.some((e) => e.severity === 'critical' && e.category === 'accuracy'));
  assert.ok(r.notes.some((n) => n.includes('기계번역')));
});

test('숫자가 빠지면 major', () => {
  const r = ruleChecks(q3, '지원자는 작성한 신청서를 3월 중순까지 제출해야 합니다. 늦게 내면 어떤 경우에도 받지 않습니다.');
  assert.ok(r.errors.some((e) => e.source_span === '5'));
  assert.ok(r.errors.some((e) => e.source_span === '14'));
});

test('반말 어미는 register major', () => {
  const r = ruleChecks(q4, q4.mt['엔진 A']);
  const reg = r.errors.find((e) => e.subcategory === 'register');
  assert.ok(reg);
  assert.ok(q4.mt['엔진 A'].includes(reg.span));
});

test('답안에 없는 구간을 지적한 오류는 버린다', () => {
  const { kept, dropped } = validateErrors(
    [
      { category: 'accuracy', subcategory: 'mistranslation', severity: 'major', span: '없는 구간' },
      { category: 'fluency', subcategory: 'grammar', severity: 'minor', span: '있는' },
      { category: 'accuracy', subcategory: 'omission', severity: 'major', span: '' },
    ],
    '여기 있는 답안',
  );
  assert.equal(kept.length, 2);
  assert.equal(dropped.length, 1);
});

test('점수 계산: 정규화와 스타일 상한', () => {
  const src = Array(20).fill('w').join(' '); // 20단어 → 바닥값 40 적용
  assert.equal(scoreErrors([], src).score, 100);
  assert.equal(scoreErrors([{ category: 'accuracy', severity: 'major' }], src).score, 87.5);
  assert.equal(scoreErrors([{ category: 'accuracy', severity: 'critical' }], src).score, 37.5);
  const style = Array(5).fill({ category: 'style', severity: 'major' }); // 25 → 상한 10
  assert.equal(scoreErrors(style, src).apt, 10);
});

test('3회 결과 합치기: 중앙값·범위·검토 깃발', () => {
  const c = combineRuns([{ score: 82 }, { score: 90 }, { score: 79 }]);
  assert.equal(c.score, 82);
  assert.equal(c.range, 11);
  assert.equal(c.needsReview, true);
  assert.equal(combineRuns([{ score: 80 }, { score: 82 }, { score: 81 }]).needsReview, false);
});

test('급수 경계', () => {
  assert.equal(gradeFor(90), '1급');
  assert.equal(gradeFor(89.9), '2급');
  assert.equal(gradeFor(70), '3급');
  assert.equal(gradeFor(69), '불합격');
});

test('API 키 없이 규칙 채점 모드로 동작', async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  const good = await gradeAnswer({ questionId: 'q2', answer: findQuestion('q2').reference });
  assert.equal(good.mode, 'rules-only');
  assert.equal(good.score, 100);
  const bad = await gradeAnswer({ questionId: 'q1', answer: q1.mt['엔진 A'] });
  assert.ok(bad.score < 70, `score ${bad.score}`);
  await assert.rejects(gradeAnswer({ questionId: 'q5', answer: '1' }));
  if (saved) process.env.ANTHROPIC_API_KEY = saved;
});

test('AI 모드: 요청 형식·응답 파싱·환각 거르기·중앙값 (fetch 가짜)', async () => {
  const saved = { key: process.env.ANTHROPIC_API_KEY, fetch: globalThis.fetch };
  process.env.ANTHROPIC_API_KEY = 'test-key';
  const answer = 'The meeting was cancelled. Please share the presentation materials by Thursday.';
  const sent = [];
  let call = 0;
  const variants = [
    [{ category: 'accuracy', subcategory: 'mistranslation', severity: 'critical', span: 'was cancelled', source_span: '연기되었습니다', explanation: '연기를 취소로 옮김', suggestion: 'has been postponed' }],
    [{ category: 'accuracy', subcategory: 'mistranslation', severity: 'critical', span: 'was cancelled', source_span: '연기되었습니다', explanation: '연기를 취소로 옮김', suggestion: 'has been postponed' },
     { category: 'accuracy', subcategory: 'omission', severity: 'major', span: '', source_span: '다음 주 화요일 오후 3시', explanation: '일시 누락', suggestion: '' }],
    [{ category: 'style', subcategory: 'awkward', severity: 'minor', span: '답안에 없는 말', source_span: '', explanation: '환각', suggestion: '' }],
  ];
  globalThis.fetch = async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body), headers: init.headers });
    const errors = variants[call++ % 3];
    return {
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: JSON.stringify({ analysis: 'a', is_translation: true, errors, strengths: ['기한 표현 정확'], reference_divergence_ok: true }) }] }),
    };
  };
  try {
    const r = await gradeAnswer({ questionId: 'q2', answer });
    assert.equal(r.mode, 'llm');
    assert.equal(sent.length, 3);
    assert.equal(sent[0].url, 'https://api.anthropic.com/v1/messages');
    assert.equal(sent[0].body.output_config.format.type, 'json_schema');
    assert.equal(sent[0].headers['anthropic-version'], '2023-06-01');
    assert.match(sent[0].body.messages[0].content, /<student_answer>/);
    assert.equal(r.scores.length, 3);
    assert.ok(r.range > 5 && r.needsReview, JSON.stringify(r.scores));
    assert.ok(r.errors.every((e) => !e.span || answer.includes(e.span)));
  } finally {
    globalThis.fetch = saved.fetch;
    if (saved.key) process.env.ANTHROPIC_API_KEY = saved.key; else delete process.env.ANTHROPIC_API_KEY;
  }
});

test('스키마에 Claude 구조화 출력이 지원하지 않는 키워드가 없다', async () => {
  const src = await import('node:fs').then((fs) => fs.readFileSync(new URL('../api/grade.js', import.meta.url), 'utf8'));
  const schemaPart = src.slice(src.indexOf('const ERROR_SCHEMA'), src.indexOf('const SYSTEM'));
  for (const bad of ['maxLength', 'minLength', 'maximum', 'minimum', 'maxItems']) assert.ok(!schemaPart.includes(bad), bad);
  const objects = schemaPart.match(/type: 'object'/g).length;
  const closed = schemaPart.match(/additionalProperties: false/g).length;
  assert.equal(objects, closed);
});
