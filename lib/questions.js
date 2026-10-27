// 데모용 문항 — 실제 ITT·AITe 기출이 아니라 직접 만든 예시다.
// 서버는 이 파일에서 원문·모범답안을 찾는다(브라우저가 보낸 원문을 믿지 않는다).

export const EXAM = {
  id: 'aite-demo-01',
  title: 'AI 번역 전문가 모의시험 (한↔영)',
  subtitle: '기계번역 후편집 · 번역 · 직업윤리',
  minutes: 25,
  levelNote: '총점 90 이상 1급 · 80 이상 2급 · 70 이상 3급 (데모 기준)',
};

export const QUESTIONS = [
  {
    id: 'q1',
    type: 'postedit',
    points: 20,
    title: '기계번역 후편집 — 제품 보관 안내',
    instruction: '번역기 출력을 참고해 영어로 완성하세요. 의미 오류를 반드시 바로잡으세요.',
    sourceLang: 'ko',
    target: 'en',
    source:
      '본 제품은 영하 10도 이하의 환경에서 보관하지 마십시오. 보관 온도를 지키지 않아 생긴 고장은 무상 수리 대상에서 제외됩니다.',
    mt: {
      '엔진 A': 'Please store this product in an environment below minus 10 degrees. Failures caused by not keeping the storage temperature are excluded from free repair.',
      '엔진 B': 'Do not keep this product under -10 degrees. Breakdowns because of storage temperature is not free repair.',
    },
    reference:
      'Do not store this product at or below -10°C. Damage caused by failure to observe the storage temperature is not covered by free repair service.',
    keypoints: [
      { label: '보관 금지(부정)', any: ['do not', "don't", 'never', 'must not', 'should not', 'avoid storing'], severity: 'critical', category: 'accuracy' },
      { label: '무상 수리 제외', any: ['not covered', 'excluded', 'not eligible', 'void', 'not include'], severity: 'major', category: 'accuracy' },
    ],
    glossary: [{ source: '무상 수리', target: ['free repair', 'warranty'] }],
  },
  {
    id: 'q2',
    type: 'translate',
    points: 20,
    title: '한→영 — 비즈니스 메일',
    instruction: '격식 있는 비즈니스 메일 문체로 영어 번역하세요.',
    sourceLang: 'ko',
    target: 'en',
    source:
      '회의는 다음 주 화요일 오후 3시로 연기되었습니다. 발표 자료는 목요일까지 공유해 주시기 바랍니다.',
    mt: {},
    reference:
      'The meeting has been postponed to 3 p.m. next Tuesday. Please share the presentation materials by Thursday.',
    keypoints: [
      { label: '회의 연기', any: ['postpon', 'reschedul', 'moved', 'pushed back', 'delayed'], severity: 'major', category: 'accuracy' },
      { label: '목요일까지(기한)', any: ['by thursday', 'no later than thursday', 'before thursday', 'by this thursday', 'by next thursday'], severity: 'major', category: 'accuracy' },
    ],
    glossary: [{ source: '발표 자료', target: ['presentation', 'slides'] }],
  },
  {
    id: 'q3',
    type: 'translate',
    points: 20,
    title: '영→한 — 접수 공지문',
    instruction: '공지문에 맞는 격식체(합쇼체)로 한국어 번역하세요.',
    sourceLang: 'en',
    target: 'ko',
    source:
      'Applicants must submit the completed form no later than 5 p.m. on March 14. Late submissions will not be accepted under any circumstances.',
    mt: {},
    reference:
      '지원자는 작성한 신청서를 3월 14일 오후 5시까지 제출해야 합니다. 기한이 지난 제출은 어떠한 경우에도 받지 않습니다.',
    keypoints: [
      { label: '기한(~까지)', any: ['까지'], severity: 'major', category: 'accuracy' },
      { label: '예외 없음', any: ['어떠한 경우', '어떤 경우', '예외 없이', '절대'], severity: 'minor', category: 'accuracy' },
    ],
    glossary: [{ source: 'Applicants', target: ['지원자', '응시자', '신청자'] }],
  },
  {
    id: 'q4',
    type: 'postedit',
    points: 20,
    title: '기계번역 후편집 — 고객 상담 (말투 주의)',
    instruction: '상담원은 고객에게 존댓말을 써야 합니다. 번역기 출력을 고쳐 한국어로 완성하세요.',
    sourceLang: 'en',
    target: 'ko',
    source:
      'Customer: Could you tell me when my order will arrive? Agent: Your order will arrive within 3 business days. Thank you for waiting.',
    mt: {
      '엔진 A': '고객: 내 주문이 언제 도착하는지 알려줄 수 있어? 상담원: 네 주문은 3 영업일 안에 도착해. 기다려줘서 고마워.',
      '엔진 B': '고객: 제 주문이 언제 도착하는지 알려 주실 수 있나요? 상담원: 주문은 3일 이내에 도착합니다. 기다려서 감사합니다.',
    },
    reference:
      '고객: 제 주문이 언제 도착하는지 알려 주시겠어요? 상담원: 고객님의 주문은 영업일 기준 3일 이내에 도착할 예정입니다. 기다려 주셔서 감사합니다.',
    keypoints: [
      { label: '기다려 주셔서(감사 표현)', any: ['기다려 주셔서', '기다려주셔서', '기다려 주신', '기다려주신'], severity: 'minor', category: 'style' },
    ],
    glossary: [{ source: 'business days', target: ['영업일'] }],
  },
  {
    id: 'q5',
    type: 'choice',
    points: 10,
    title: '직업윤리 — 기밀 문서',
    instruction: '가장 알맞은 행동을 고르세요.',
    source: '고객이 보낸 비공개 계약서를 급하게 번역해야 합니다. 무료 공개 번역기에 그대로 붙여 넣으려 할 때 가장 먼저 할 일은?',
    choices: [
      '바로 붙여 넣고 결과만 꼼꼼히 검수한다',
      '개인정보·기밀을 가리거나, 보안 계약이 된 번역 엔진을 쓴다',
      '번역 속도를 위해 문서를 여러 번역기에 나눠 넣는다',
      '고객에게 알리지 않고 진행한다',
    ],
    answer: 1,
  },
  {
    id: 'q6',
    type: 'choice',
    points: 10,
    title: '오류 유형 — 숫자',
    instruction: '아래 기계번역 오류의 유형을 고르세요.',
    source: '원문 "예산은 1,500만 원입니다." → 기계번역 "The budget is 1,500 million won."',
    choices: ['문체 오류', '단위·수량 환산 오류', '용어 불일치', '누락'],
    answer: 1,
  },
];

export function findQuestion(id) {
  return QUESTIONS.find((q) => q.id === id);
}
