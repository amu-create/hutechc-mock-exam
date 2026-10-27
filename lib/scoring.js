// 채점 계산 — LLM은 오류 목록만 내고, 점수는 여기서 결정적으로 계산한다.
// 브라우저와 서버(api/grade.js)가 같은 파일을 쓴다.

export const SEVERITY_PENALTY = { critical: 25, major: 5, minor: 1 };
export const CATEGORIES = ['accuracy', 'fluency', 'terminology', 'style'];
export const CATEGORY_LABEL = {
  accuracy: '정확성',
  fluency: '유창성',
  terminology: '용어',
  style: '스타일',
};

// 데모용 가정값 — 사람 채점 표본으로 맞추기 전까지 '미보정'.
export const SCORING_CONFIG = {
  minWords: 40, // 짧은 문항에서 오류 1개가 점수를 과하게 깎지 않도록 바닥값
  k: 1, // 보정계수
  styleCap: 10, // 스타일 감점 상한(APT 기준)
  reviewRange: 5, // 재채점 범위가 이 값을 넘으면 사람 검토
};

export const GRADE_BANDS = [
  { min: 90, label: '1급' },
  { min: 80, label: '2급' },
  { min: 70, label: '3급' },
  { min: 0, label: '불합격' },
];

export function gradeFor(score) {
  return GRADE_BANDS.find((b) => score >= b.min).label;
}

// 한국어는 어절, 영어는 단어 수
export function countWords(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

export function hangulRatio(text) {
  const letters = String(text || '').match(/[A-Za-z가-힣]/g) || [];
  if (!letters.length) return 0;
  const hangul = letters.filter((c) => /[가-힣]/.test(c)).length;
  return hangul / letters.length;
}

function normalizeNumber(n) {
  return n.replace(/,/g, '');
}

export function extractNumbers(text) {
  return (String(text || '').match(/\d[\d,]*(?:\.\d+)?/g) || []).map(normalizeNumber);
}

function similarity(a, b) {
  // 문자 bigram Dice 계수 — 원문/기계번역 복붙 감지용
  const grams = (s) => {
    const t = String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const out = new Map();
    for (let i = 0; i < t.length - 1; i++) {
      const g = t.slice(i, i + 2);
      out.set(g, (out.get(g) || 0) + 1);
    }
    return out;
  };
  const A = grams(a);
  const B = grams(b);
  let inter = 0;
  let total = 0;
  for (const [g, n] of A) {
    inter += Math.min(n, B.get(g) || 0);
    total += n;
  }
  for (const n of B.values()) total += n;
  return total ? (2 * inter) / total : 0;
}

/**
 * 규칙 검사 — LLM 호출 전에 돌린다.
 * 반환: { blocking: 문자열|null, errors: [...], notes: [...] }
 * blocking이 있으면 LLM을 부르지 않고 0점 처리한다.
 */
export function ruleChecks(question, answer) {
  const notes = [];
  const errors = [];
  const text = String(answer || '').trim();
  if (!text) return { blocking: '빈 답안', errors, notes };

  const expectKo = question.target === 'ko';
  const ratio = hangulRatio(text);
  if (expectKo && ratio < 0.3) return { blocking: '도착어(한국어)로 쓰지 않은 답안', errors, notes };
  if (!expectKo && ratio > 0.5) return { blocking: '도착어(영어)로 쓰지 않은 답안', errors, notes };

  if (similarity(text, question.source) > 0.9) {
    return { blocking: '원문을 그대로 옮긴 답안', errors, notes };
  }

  for (const mt of Object.values(question.mt || {})) {
    if (similarity(text, mt) > 0.97) {
      notes.push('기계번역 출력과 거의 같습니다(후편집 없이 제출).');
      break;
    }
  }

  // 숫자 일치: 원문 숫자가 답안에 그대로 없으면 minor + 사람 확인 (15:00, three, 사흘 같은 바꿔 쓰기가 있어서 약하게)
  const srcNums = new Set(extractNumbers(question.source));
  const ansNums = new Set(extractNumbers(text));
  for (const n of srcNums) {
    if (!ansNums.has(n)) {
      errors.push({
        category: 'accuracy',
        subcategory: 'mistranslation',
        severity: 'minor',
        span: '',
        source_span: n,
        explanation: `원문의 숫자 "${n}"가 답안에 그대로 없습니다. 다른 표기(15:00, three 등)로 옮겼다면 채점자가 확인합니다.`,
        origin: 'rule',
      });
    }
  }

  // 말투: 한국어 도착어에서 반말 어미가 보이면 register major
  if (expectKo && question.formal !== false) {
    const casual = [...new Set(text.match(/[가-힣]*(어\?|야\?|와\?|니\?|냐\?|지\?|래\?|해\.|해\?|줘|워\.|고마워|알려줄)/g) || [])].slice(0, 3);
    for (const span of casual) {
      errors.push({
        category: 'fluency',
        subcategory: 'register',
        severity: 'major',
        span,
        source_span: '',
        explanation: '격식체가 필요한 문맥에 반말 어미가 쓰였습니다.',
        origin: 'rule',
      });
    }
  }

  // 문항별 채점 기준: any(이 중 하나는 있어야 함) / forbid(있으면 의미가 반대)
  const lower = text.toLowerCase();
  for (const kp of question.keypoints || []) {
    const bad = (kp.forbid || []).find((w) => lower.includes(String(w).toLowerCase()));
    if (bad) {
      errors.push({
        category: 'accuracy',
        subcategory: 'mistranslation',
        severity: 'critical',
        span: text.slice(lower.indexOf(String(bad).toLowerCase()), lower.indexOf(String(bad).toLowerCase()) + String(bad).length),
        source_span: kp.label,
        explanation: `원문과 반대 의미: ${kp.label}`,
        origin: 'rule',
      });
      continue;
    }
    if (kp.any && !kp.any.some((w) => lower.includes(String(w).toLowerCase()))) {
      errors.push({
        category: kp.category || 'accuracy',
        subcategory: kp.category === 'style' ? 'awkward' : 'omission',
        severity: kp.severity || 'major',
        span: '',
        source_span: kp.label,
        explanation: `채점 기준 미충족: ${kp.label}`,
        origin: 'rule',
      });
    }
  }

  // 용어집: 지정 번역어가 하나도 안 보이면 용어 minor
  for (const g of question.glossary || []) {
    const options = Array.isArray(g.target) ? g.target : [g.target];
    const hit = options.some((t) => text.toLowerCase().includes(String(t).toLowerCase()));
    if (!hit) {
      errors.push({
        category: 'terminology',
        subcategory: 'glossary',
        severity: 'minor',
        span: '',
        source_span: g.source,
        explanation: `용어집: "${g.source}" → ${options.map((o) => `"${o}"`).join(' / ')} 권장`,
        origin: 'rule',
      });
    }
  }

  return { blocking: null, errors, notes };
}

/**
 * LLM이 낸 오류 중 span이 실제 답안에 없는 것은 환각으로 보고 버린다.
 */
export function normalizeError(e) {
  return {
    ...e,
    category: String(e.category || '').toLowerCase().trim(),
    subcategory: String(e.subcategory || '').toLowerCase().trim(),
    severity: String(e.severity || '').toLowerCase().trim(),
    span: String(e.span || ''),
  };
}

/**
 * 오류 검증: 유형이 맞는지, AI가 지적한 구간이 실제 답안에 있는지.
 * - 규칙 오류는 구간 없이도 인정한다(규칙이 직접 확인한 것).
 * - AI 오류는 누락(omission)만 구간 없이 인정하고, 나머지는 구간이 답안에 있어야 한다.
 */
export function validateErrors(errors, answer) {
  const kept = [];
  const dropped = [];
  for (const raw of errors || []) {
    const e = normalizeError(raw);
    if (!SEVERITY_PENALTY[e.severity] || !CATEGORIES.includes(e.category)) {
      dropped.push({ ...e, dropReason: '알 수 없는 유형' });
      continue;
    }
    if (e.origin === 'rule' || e.subcategory === 'omission') {
      kept.push(e);
      continue;
    }
    if (e.span && String(answer).includes(e.span)) kept.push(e);
    else dropped.push({ ...e, dropReason: e.span ? '답안에 없는 구간' : '구간 없음' });
  }
  return { kept, dropped };
}

/**
 * 규칙이 이미 찾은 오류와 같은 것을 AI가 또 지적하면 하나만 센다.
 * 같은 구간(span)이 겹치거나, 둘 다 구간 없이 같은 원문 부분을 가리키면 중복.
 */
export function dedupeAgainstRules(ruleErrors, aiErrors) {
  const overlaps = (a, b) => a && b && (a.includes(b) || b.includes(a));
  const out = [];
  const dropped = [];
  for (const e of aiErrors) {
    const dup = ruleErrors.some(
      (r) =>
        (r.span && overlaps(r.span, e.span)) ||
        (r.category === e.category && r.source_span && e.source_span && overlaps(r.source_span, e.source_span)) ||
        (r.subcategory === 'register' && e.subcategory === 'register'),
    );
    if (dup) dropped.push({ ...e, dropReason: '규칙 검사와 중복' });
    else out.push(e);
  }
  return { kept: out, dropped };
}

export function scoreErrors(errors, sourceText, config = SCORING_CONFIG) {
  const byCategory = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  for (const e of errors) {
    byCategory[e.category] += SEVERITY_PENALTY[e.severity] || 0;
  }
  byCategory.style = Math.min(byCategory.style, config.styleCap);
  const apt = Object.values(byCategory).reduce((a, b) => a + b, 0);
  const words = Math.max(countWords(sourceText), config.minWords);
  const npt = (apt * 100) / words;
  const score = Math.max(0, Math.round((100 - npt * config.k) * 10) / 10);
  return { score, apt, npt: Math.round(npt * 10) / 10, words, byCategory };
}

export function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * 여러 번 채점한 결과를 합친다. 대표 실행은 중앙값에 가장 가까운 실행.
 */
export function combineRuns(runs, config = SCORING_CONFIG) {
  const scores = runs.map((r) => r.score);
  const med = median(scores);
  const range = Math.max(...scores) - Math.min(...scores);
  const representative = runs.reduce((best, r) =>
    Math.abs(r.score - med) < Math.abs(best.score - med) ? r : best,
  );
  return {
    score: med,
    scores,
    range: Math.round(range * 10) / 10,
    needsReview: range > config.reviewRange,
    representative,
  };
}
