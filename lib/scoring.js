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

  // 숫자 일치: 원문에 있는 숫자가 답안에 없으면 정확성 major
  const srcNums = new Set(extractNumbers(question.source));
  const ansNums = new Set(extractNumbers(text));
  for (const n of srcNums) {
    if (!ansNums.has(n)) {
      errors.push({
        category: 'accuracy',
        subcategory: 'mistranslation',
        severity: 'major',
        span: '',
        source_span: n,
        explanation: `원문의 숫자 "${n}"가 답안에 그대로 없습니다(단위 환산이면 사람이 확인).`,
        origin: 'rule',
      });
    }
  }

  // 부정(否定) 유지: 원문이 부정문인데 답안에 부정 표현이 없으면 의미 반전(critical)
  const srcNeg = question.sourceLang === 'ko'
    ? /(않|마십시오|마세요|말아|못|없|금지|불가|불허)/.test(question.source)
    : /\b(not|never|no)\b|n't/i.test(question.source);
  const ansNeg = expectKo
    ? /(않|마십시오|마세요|말아|못|없|금지|불가|불허)/.test(text)
    : /\b(not|never|no|prohibited|must not)\b|n't/i.test(text);
  if (srcNeg && !ansNeg) {
    errors.push({
      category: 'accuracy',
      subcategory: 'mistranslation',
      severity: 'critical',
      span: '',
      source_span: '부정 표현',
      explanation: '원문의 부정(하지 말 것/받지 않음)이 답안에서 사라져 의미가 반대가 될 수 있습니다.',
      origin: 'rule',
    });
  }

  // 말투: 한국어 도착어에서 반말 어미가 보이면 register major (지시문이 격식체를 요구할 때)
  if (expectKo && question.formal !== false) {
    const casual = [...new Set(text.match(/[가-힣]+(어\?|야\?|해\.|해\b|줘|워\.|고마워|알려줄)/g) || [])].slice(0, 3);
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

  // 문항별 핵심 요소: 채점 기준표처럼 꼭 들어가야 할 의미를 확인
  const lower = text.toLowerCase();
  for (const kp of question.keypoints || []) {
    if (!kp.any.some((w) => lower.includes(String(w).toLowerCase()))) {
      errors.push({
        category: kp.category || 'accuracy',
        subcategory: kp.category === 'style' ? 'awkward' : 'omission',
        severity: kp.severity || 'major',
        span: '',
        source_span: kp.label,
        explanation: `핵심 요소 누락 또는 오역: ${kp.label}`,
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
export function validateErrors(errors, answer) {
  const kept = [];
  const dropped = [];
  for (const e of errors || []) {
    if (!SEVERITY_PENALTY[e.severity] || !CATEGORIES.includes(e.category)) {
      dropped.push({ ...e, dropReason: '알 수 없는 유형' });
      continue;
    }
    // 누락(omission)은 답안에 구간이 없을 수 있다
    if (e.subcategory === 'omission' || !e.span) {
      kept.push(e);
      continue;
    }
    if (String(answer).includes(e.span)) kept.push(e);
    else dropped.push({ ...e, dropReason: '답안에 없는 구간' });
  }
  return { kept, dropped };
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
