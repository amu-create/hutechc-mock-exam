import { EXAM, QUESTIONS } from '/lib/questions.js';
import { CATEGORIES, CATEGORY_LABEL, SCORING_CONFIG, gradeFor } from '/lib/scoring.js';

const app = document.getElementById('app');
const STORE_KEY = 'mockexam.attempts.v1';

// ---------- 공통 ----------
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function toast(msg, ms = 2600) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), ms);
}

function modal(html) {
  const m = document.getElementById('modal');
  m.innerHTML = `<div class="card">${html}</div>`;
  m.hidden = false;
  return m;
}
function closeModal() {
  document.getElementById('modal').hidden = true;
}

function loadAttempts() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
  } catch {
    return [];
  }
}
function saveAttempts(list) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(list));
  } catch {
    /* 저장 불가 환경 — 화면은 계속 동작 */
  }
}

function setActiveNav() {
  const h = location.hash || '#/';
  document.querySelectorAll('.topnav a').forEach((a) => {
    a.classList.toggle('active', h.startsWith('#/admin') ? a.getAttribute('href') === '#/admin' : a.getAttribute('href') === '#/');
  });
}

// ---------- 상태 ----------
const state = {
  name: '',
  answers: {},
  flags: {},
  current: 0,
  mtTab: {},
  endsAt: 0,
  timerId: null,
  alerted: {},
  lastResult: null,
};

// ---------- 홈 ----------
async function renderHome() {
  stopTimer();
  let mode = '확인 중';
  app.innerHTML = homeHtml(mode);
  bindHome();
  try {
    const r = await fetch('/api/grade');
    const j = await r.json();
    mode = j.mode === 'llm' ? `AI 채점 켜짐 · ${j.model}` : '규칙 채점만 (AI 키 없음)';
  } catch {
    mode = '채점 서버에 연결할 수 없음';
  }
  const el = document.getElementById('mode-badge');
  if (el) el.textContent = mode;
}

function homeHtml(mode) {
  const nTrans = QUESTIONS.filter((q) => q.type !== 'choice').length;
  return `
  <section class="hero">
    <div class="card pad">
      <span class="badge">모의시험 · 데모</span>
      <h1>${esc(EXAM.title)}</h1>
      <p class="muted">${esc(EXAM.subtitle)}. 주관식 번역 답안은 규칙 검사와 AI 오류 검출로 채점하고, 점수는 정해진 공식으로 계산합니다.</p>
      <div class="facts">
        <div class="fact"><b>${QUESTIONS.length}문항</b><span class="muted small">주관식 ${nTrans} · 객관식 ${QUESTIONS.length - nTrans}</span></div>
        <div class="fact"><b>${EXAM.minutes}분</b><span class="muted small">10분·5분 전 알림</span></div>
        <div class="fact"><b>100점</b><span class="muted small">${esc(EXAM.levelNote.split('·')[0])}</span></div>
      </div>
      <label class="field">
        <span class="small muted">수험자 이름</span>
        <input id="name" maxlength="20" placeholder="예: 홍길동" value="${esc(state.name)}" autocomplete="name" />
      </label>
      <div class="row">
        <button class="btn primary" id="start">시험 시작</button>
        <span class="badge" id="mode-badge">${esc(mode)}</span>
      </div>
    </div>
    <div class="card pad">
      <h2 style="margin-top:0;font-size:18px">채점 방식</h2>
      <div class="pipeline">
        <div class="pipe"><span class="n">1</span><div><b>규칙 검사</b><div class="muted small">빈 답안·언어·원문 복붙·숫자·부정 표현·말투·용어집</div></div></div>
        <div class="pipe"><span class="n">2</span><div><b>AI 오류 검출 ×3회</b><div class="muted small">오류 구간·유형·심각도만 JSON으로 받음 (점수는 AI가 매기지 않음)</div></div></div>
        <div class="pipe"><span class="n">3</span><div><b>코드로 점수 계산</b><div class="muted small">critical 25 · major 5 · minor 1 감점, 원문 길이로 정규화</div></div></div>
        <div class="pipe"><span class="n">4</span><div><b>중앙값 + 흔들림 표시</b><div class="muted small">3회 점수 범위가 ${SCORING_CONFIG.reviewRange}점을 넘으면 사람 검토로 넘김</div></div></div>
      </div>
      <p class="muted small" style="margin-bottom:0">답안 구간이 실제 답안에 없으면 AI가 지어낸 오류로 보고 버립니다.</p>
    </div>
  </section>`;
}

function bindHome() {
  document.getElementById('start').onclick = () => {
    const name = document.getElementById('name').value.trim();
    if (!name) {
      toast('수험자 이름을 입력해 주세요');
      document.getElementById('name').focus();
      return;
    }
    state.name = name;
    state.answers = {};
    state.flags = {};
    state.current = 0;
    state.alerted = {};
    state.endsAt = Date.now() + EXAM.minutes * 60_000;
    location.hash = '#/exam';
  };
}

// ---------- 응시 ----------
function stopTimer() {
  if (state.timerId) clearInterval(state.timerId);
  state.timerId = null;
}

function fmt(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function tick() {
  const left = state.endsAt - Date.now();
  const el = document.getElementById('timer');
  if (el) {
    el.textContent = fmt(left);
    el.classList.toggle('low', left < 5 * 60_000);
  }
  for (const m of [10, 5]) {
    if (left <= m * 60_000 && !state.alerted[m] && left > 0) {
      state.alerted[m] = true;
      toast(`시험 종료 ${m}분 전입니다`);
    }
  }
  if (left <= 0) {
    stopTimer();
    toast('시간이 끝나 자동 제출합니다');
    submit();
  }
}

function isAnswered(q) {
  const a = state.answers[q.id];
  return q.type === 'choice' ? Number.isInteger(a) : !!String(a || '').trim();
}

function renderExam() {
  if (!state.name) {
    location.hash = '#/';
    return;
  }
  const q = QUESTIONS[state.current];
  const answered = QUESTIONS.filter(isAnswered).length;
  app.innerHTML = `
  <div class="card exam-head">
    <div>
      <div><b>${esc(EXAM.title)}</b></div>
      <div class="who">수험자 ${esc(state.name)} · 답한 문항 ${answered}/${QUESTIONS.length}</div>
    </div>
    <span class="spacer"></span>
    <button class="btn ghost small" id="font">글자 크기</button>
    <span class="timer" id="timer" aria-label="남은 시간">${fmt(state.endsAt - Date.now())}</span>
  </div>
  <div class="exam-grid">
    <aside class="card palette">
      <h3>문항</h3>
      <div class="pal-grid">
        ${QUESTIONS.map((x, i) => `<button class="pal-btn ${isAnswered(x) ? 'done' : ''} ${i === state.current ? 'current' : ''} ${state.flags[x.id] ? 'flag' : ''}" data-i="${i}" aria-label="${i + 1}번">${i + 1}</button>`).join('')}
      </div>
      <div class="legend"><span class="l-done">답함</span><span class="l-flag">검토 표시</span></div>
      <button class="btn small" id="unanswered" style="width:100%;margin-top:12px">안 푼 문항 보기</button>
    </aside>
    <section class="card q-card">${questionHtml(q)}
      <div class="q-nav">
        <button class="btn" id="prev" ${state.current === 0 ? 'disabled' : ''}>이전</button>
        <button class="btn" id="next" ${state.current === QUESTIONS.length - 1 ? 'disabled' : ''}>다음</button>
        <label class="row small muted" style="gap:6px"><input type="checkbox" id="flag" ${state.flags[q.id] ? 'checked' : ''}/> 검토 표시</label>
        <span class="spacer"></span>
        <button class="btn primary" id="submit">답안 제출</button>
      </div>
    </section>
  </div>`;
  bindExam(q);
  if (!state.timerId) state.timerId = setInterval(tick, 1000);
}

function questionHtml(q) {
  const head = `<div class="q-title"><span class="badge">${QUESTIONS.indexOf(q) + 1}번 · ${q.points}점</span><h2>${esc(q.title)}</h2></div><p class="muted" style="margin:0">${esc(q.instruction)}</p>`;
  if (q.type === 'choice') {
    return `${head}
      <div class="pane" style="min-height:auto;margin-top:14px"><div class="pane-body">${esc(q.source)}</div></div>
      <div class="choices">${q.choices.map((c, i) => `<button class="choice ${state.answers[q.id] === i ? 'on' : ''}" data-c="${i}"><span class="no">${'①②③④'[i]}</span><span>${esc(c)}</span></button>`).join('')}</div>`;
  }
  const engines = Object.keys(q.mt || {});
  const tab = state.mtTab[q.id] || engines[0];
  const val = state.answers[q.id] || '';
  const srcLabel = q.sourceLang === 'ko' ? '원문 (한국어)' : '원문 (English)';
  const tgtLabel = q.target === 'ko' ? '답안지 (한국어)' : '답안지 (English)';
  const glossary = (q.glossary || []).map((g) => `${esc(g.source)} → ${esc([].concat(g.target)[0])}`).join(' · ');
  return `${head}
    <div class="panes ${engines.length ? 'three' : 'two'}">
      <div class="pane"><div class="pane-head">${srcLabel}</div><div class="pane-body">${esc(q.source)}</div>
        ${glossary ? `<div class="pane-foot"><span>용어집: ${glossary}</span></div>` : ''}</div>
      ${engines.length ? `<div class="pane"><div class="pane-head">번역된 내용<div class="tabs">${engines.map((e) => `<button class="tab ${e === tab ? 'on' : ''}" data-tab="${esc(e)}">${esc(e)}</button>`).join('')}</div></div>
        <div class="pane-body">${esc(q.mt[tab])}</div>
        <div class="pane-foot"><button class="btn ghost small" id="copy-mt" style="padding:0">답안지에 붙여 넣기</button></div></div>` : ''}
      <div class="pane answer"><div class="pane-head">${tgtLabel}</div>
        <textarea id="answer" spellcheck="false" placeholder="여기에 번역을 쓰세요">${esc(val)}</textarea>
        <div class="pane-foot"><span id="count">${val.length}자</span><span>자동 저장됨</span></div></div>
    </div>`;
}

function bindExam(q) {
  document.querySelectorAll('.pal-btn').forEach((b) => (b.onclick = () => go(Number(b.dataset.i))));
  document.getElementById('prev').onclick = () => go(state.current - 1);
  document.getElementById('next').onclick = () => go(state.current + 1);
  document.getElementById('flag').onchange = (e) => {
    state.flags[q.id] = e.target.checked;
    renderExam();
  };
  document.getElementById('submit').onclick = confirmSubmit;
  document.getElementById('unanswered').onclick = () => {
    const left = QUESTIONS.map((x, i) => (isAnswered(x) ? null : i + 1)).filter(Boolean);
    toast(left.length ? `안 푼 문항: ${left.join(', ')}번` : '모든 문항에 답했습니다');
  };
  document.getElementById('font').onclick = () => {
    const cur = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--fs'), 10) || 16;
    document.documentElement.style.setProperty('--fs', `${cur >= 19 ? 15 : cur + 2}px`);
  };
  document.querySelectorAll('.choice').forEach((b) => (b.onclick = () => {
    state.answers[q.id] = Number(b.dataset.c);
    renderExam();
  }));
  document.querySelectorAll('.tab').forEach((b) => (b.onclick = () => {
    state.mtTab[q.id] = b.dataset.tab;
    renderExam();
  }));
  const ta = document.getElementById('answer');
  if (ta) {
    ta.oninput = () => {
      state.answers[q.id] = ta.value;
      document.getElementById('count').textContent = `${ta.value.length}자`;
      document.querySelectorAll('.pal-btn')[state.current].classList.toggle('done', isAnswered(q));
    };
    const copy = document.getElementById('copy-mt');
    if (copy) copy.onclick = () => {
      const engines = Object.keys(q.mt);
      ta.value = q.mt[state.mtTab[q.id] || engines[0]];
      ta.oninput();
      ta.focus();
    };
  }
}

function go(i) {
  if (i < 0 || i >= QUESTIONS.length) return;
  state.current = i;
  renderExam();
}

function confirmSubmit() {
  const left = QUESTIONS.filter((q) => !isAnswered(q)).length;
  const m = modal(`<h3>답안을 제출할까요?</h3>
    <p class="muted">${left ? `<b style="color:var(--warn)">안 푼 문항이 ${left}개</b> 있습니다. ` : ''}제출하면 수정할 수 없습니다.</p>
    <div class="row" style="justify-content:flex-end"><button class="btn" id="m-cancel">계속 풀기</button><button class="btn primary" id="m-ok">제출</button></div>`);
  m.querySelector('#m-cancel').onclick = closeModal;
  m.querySelector('#m-ok').onclick = () => {
    closeModal();
    submit();
  };
}

// ---------- 채점 ----------
async function submit() {
  stopTimer();
  app.innerHTML = `<div class="card grading"><div class="spinner"></div><h2 style="margin:0">채점 중입니다</h2><p class="muted" id="g-progress">주관식 답안을 문항마다 3번씩 채점하고 있어요.</p></div>`;
  const trans = QUESTIONS.filter((q) => q.type !== 'choice');
  let done = 0;
  const results = await Promise.all(
    trans.map(async (q) => {
      try {
        const r = await fetch('/api/grade', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ questionId: q.id, answer: state.answers[q.id] || '' }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || r.status);
        return j;
      } catch (e) {
        return { questionId: q.id, error: String(e.message || e), score: null };
      } finally {
        done++;
        const p = document.getElementById('g-progress');
        if (p) p.textContent = `${done}/${trans.length} 문항 채점 완료`;
      }
    }),
  );
  const byId = Object.fromEntries(results.map((r) => [r.questionId, r]));
  const items = QUESTIONS.map((q) => {
    if (q.type === 'choice') {
      const correct = state.answers[q.id] === q.answer;
      return { id: q.id, type: 'choice', points: q.points, earned: correct ? q.points : 0, correct, picked: state.answers[q.id] };
    }
    const r = byId[q.id];
    const earned = r.score == null ? null : Math.round((r.score / 100) * q.points * 10) / 10;
    return { id: q.id, type: q.type, points: q.points, earned, answer: state.answers[q.id] || '', grade: r };
  });
  const pending = items.some((i) => i.earned == null);
  const total = Math.round(items.reduce((a, i) => a + (i.earned || 0), 0) * 10) / 10;
  const attempt = {
    id: `A${Date.now().toString(36).toUpperCase()}`,
    name: state.name,
    at: new Date().toISOString(),
    total,
    grade: gradeFor(total),
    pending,
    needsReview: items.some((i) => i.grade?.needsReview),
    mode: results.find((r) => r.mode)?.mode || 'unknown',
    items,
    human: {},
    appeal: false,
  };
  const list = loadAttempts();
  list.unshift(attempt);
  saveAttempts(list.slice(0, 50));
  state.lastResult = attempt;
  state.name = '';
  location.hash = `#/result/${attempt.id}`;
}

// ---------- 결과 ----------
function highlight(answer, errors) {
  const spans = [];
  for (const e of errors || []) {
    if (!e.span) continue;
    const at = answer.indexOf(e.span);
    if (at < 0) continue;
    if (spans.some((s) => at < s.end && at + e.span.length > s.start)) continue;
    spans.push({ start: at, end: at + e.span.length, e });
  }
  spans.sort((a, b) => a.start - b.start);
  let out = '';
  let pos = 0;
  for (const s of spans) {
    out += esc(answer.slice(pos, s.start));
    out += `<mark class="${s.e.severity}" title="${esc(`${CATEGORY_LABEL[s.e.category]} · ${s.e.severity} — ${s.e.explanation}`)}">${esc(answer.slice(s.start, s.end))}</mark>`;
    pos = s.end;
  }
  return out + esc(answer.slice(pos));
}

function renderResult(id) {
  const a = loadAttempts().find((x) => x.id === id) || state.lastResult;
  if (!a) {
    app.innerHTML = `<div class="card pad">결과를 찾을 수 없습니다. <a href="#/">처음으로</a></div>`;
    return;
  }
  const deductions = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  for (const it of a.items) for (const c of CATEGORIES) deductions[c] += it.grade?.byCategory?.[c] || 0;
  const maxDed = Math.max(10, ...Object.values(deductions));
  const modeLabel = a.mode === 'llm' ? 'AI 채점(3회 중앙값) + 규칙 검사' : '규칙 검사만 (AI 키 없는 데모 모드)';
  app.innerHTML = `
  <div class="result-top">
    <div class="card score-big">
      <div class="muted small">${esc(a.name)} · ${new Date(a.at).toLocaleString('ko-KR')}</div>
      <div class="num">${a.total}</div>
      <div class="grade">${esc(a.grade)}</div>
      <div class="row" style="justify-content:center;margin-top:10px">
        <span class="badge">${esc(modeLabel)}</span>
        ${a.needsReview ? '<span class="badge warn">사람 검토 필요</span>' : ''}
        ${a.pending ? '<span class="badge crit">일부 채점 실패</span>' : ''}
      </div>
    </div>
    <div class="card pad">
      <h2 style="margin-top:0;font-size:17px">영역별 감점 (AI·규칙 합계)</h2>
      <div class="bars">${CATEGORIES.map((c) => `<div class="bar-row"><span>${CATEGORY_LABEL[c]}</span><div class="bar loss"><i style="width:${(deductions[c] / maxDed) * 100}%"></i></div><span class="muted">-${deductions[c]}</span></div>`).join('')}</div>
      <h2 style="font-size:17px">문항별 득점</h2>
      <div class="bars">${a.items.map((it, i) => `<div class="bar-row"><span>${i + 1}번</span><div class="bar"><i style="width:${((it.earned || 0) / it.points) * 100}%"></i></div><span class="muted">${it.earned ?? '-'}/${it.points}</span></div>`).join('')}</div>
    </div>
  </div>
  <p class="notice" style="margin-top:16px">AI 채점은 참고용입니다. 최종 점수는 채점자 검토 후 확정됩니다. 급수 기준(90·80·70)은 데모용 가정입니다.</p>
  ${a.items.map((it, i) => itemHtml(it, i)).join('')}
  <div class="row" style="margin-top:20px">
    <a class="btn" href="#/">다시 응시</a>
    <button class="btn" id="appeal" ${a.appeal ? 'disabled' : ''}>${a.appeal ? '이의 신청 접수됨' : '이의 신청'}</button>
    <span class="spacer"></span>
    <a class="btn primary" href="#/admin">관리자 화면</a>
  </div>`;
  app.querySelectorAll('.item-head').forEach((h) => (h.onclick = () => h.nextElementSibling.toggleAttribute('hidden')));
  document.getElementById('appeal').onclick = () => {
    const list = loadAttempts();
    const t = list.find((x) => x.id === a.id);
    if (t) t.appeal = true;
    saveAttempts(list);
    toast('이의 신청이 접수되었습니다');
    renderResult(a.id);
  };
}

function itemHtml(it, i) {
  const q = QUESTIONS.find((x) => x.id === it.id);
  if (it.type === 'choice') {
    return `<div class="card item"><div class="item-head"><span class="badge ${it.correct ? 'ok' : 'crit'}">${it.correct ? '정답' : '오답'}</span><h3>${i + 1}. ${esc(q.title)}</h3><span class="spacer"></span><b>${it.earned}/${it.points}</b></div>
      <div class="item-body" hidden><div class="muted small">고른 답: ${it.picked == null ? '미응답' : esc(q.choices[it.picked])} · 정답: ${esc(q.choices[q.answer])}</div></div></div>`;
  }
  const g = it.grade || {};
  if (g.error) {
    return `<div class="card item"><div class="item-head"><span class="badge crit">채점 실패</span><h3>${i + 1}. ${esc(q.title)}</h3></div><div class="item-body"><div class="notice">${esc(g.error)}</div></div></div>`;
  }
  const errs = g.errors || [];
  return `<div class="card item">
    <div class="item-head">
      <span class="badge ${g.score >= 80 ? 'ok' : g.score >= 70 ? '' : 'warn'}">${g.score}점</span>
      <h3>${i + 1}. ${esc(q.title)}</h3>
      ${g.needsReview ? '<span class="badge warn">사람 검토</span>' : ''}
      <span class="spacer"></span><b>${it.earned}/${it.points}</b>
    </div>
    <div class="item-body" ${!g.needsReview && !g.blocked && !(g.notes || []).length && errs.length === 0 ? 'hidden' : ''}>
      ${g.blocked ? `<div class="notice">${esc(g.blocked)} → 0점</div>` : ''}
      ${(g.notes || []).map((n) => `<div class="notice">${esc(n)}</div>`).join('')}
      <div><div class="muted small" style="margin-bottom:4px">내 답안 (오류 구간 표시)</div><div class="answer-view">${highlight(it.answer || '', errs) || '<span class="muted">(빈 답안)</span>'}</div></div>
      ${errs.length ? `<ul class="err-list">${errs.map((e) => `<li class="err"><span class="sev ${e.severity}">${e.severity.toUpperCase()}</span><div><b>${CATEGORY_LABEL[e.category]}</b> · ${esc(e.subcategory)} ${e.origin === 'rule' ? '<span class="badge">규칙</span>' : '<span class="badge ok">AI</span>'}<div>${esc(e.explanation)}</div>${e.suggestion ? `<div class="muted small">고친 표현: ${esc(e.suggestion)}</div>` : ''}${e.source_span ? `<div class="muted small">원문: ${esc(e.source_span)}</div>` : ''}</div></li>`).join('')}</ul>` : '<div class="muted small">발견된 오류가 없습니다.</div>'}
      ${(g.strengths || []).length ? `<div class="small"><b>잘한 점</b> · ${g.strengths.map(esc).join(' / ')}</div>` : ''}
      <div class="runs small"><span class="muted">${g.mode === 'llm' ? `AI 채점 ${g.scores?.length || 0}회` : '규칙 채점'}:</span>${(g.scores || []).map((s) => `<span class="run-dot">${s}</span>`).join('')}<span class="muted">→ 중앙값 ${g.score}, 범위 ${g.range}</span>${g.dropped?.length ? `<span class="muted">· 답안에 없는 구간이라 버린 AI 지적 ${g.dropped.length}건</span>` : ''}</div>
      <details class="small"><summary class="muted">모범답안 (여러 정답 중 하나)</summary><div style="margin-top:6px">${esc(q.reference)}</div></details>
    </div>
  </div>`;
}

// ---------- 관리자 ----------
function renderAdmin() {
  stopTimer();
  const list = loadAttempts();
  const trans = QUESTIONS.filter((q) => q.type !== 'choice');
  const avg = (arr) => (arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : 0);
  const totals = list.map((a) => a.total);
  const perQ = QUESTIONS.map((q) => {
    const xs = list.map((a) => a.items.find((i) => i.id === q.id)?.earned).filter((x) => x != null);
    return { q, avg: avg(xs) };
  });
  const pairs = [];
  for (const a of list) for (const [qid, h] of Object.entries(a.human || {})) {
    const it = a.items.find((i) => i.id === qid);
    if (it?.grade?.score != null && h !== '' && h != null) pairs.push({ ai: it.grade.score, human: Number(h) });
  }
  const mae = pairs.length ? Math.round((pairs.reduce((s, p) => s + Math.abs(p.ai - p.human), 0) / pairs.length) * 10) / 10 : null;
  const sameGrade = pairs.length ? Math.round((pairs.filter((p) => gradeFor(p.ai) === gradeFor(p.human)).length / pairs.length) * 100) : null;

  app.innerHTML = `
  <div class="kpis">
    <div class="card kpi"><span class="muted small">응시</span><b>${list.length}</b></div>
    <div class="card kpi"><span class="muted small">평균 점수</span><b>${avg(totals)}</b></div>
    <div class="card kpi"><span class="muted small">사람 검토 필요</span><b>${list.filter((a) => a.needsReview).length}</b></div>
    <div class="card kpi"><span class="muted small">이의 신청</span><b>${list.filter((a) => a.appeal).length}</b></div>
  </div>
  <div class="result-top" style="grid-template-columns:1fr 1fr">
    <div class="card pad">
      <h2 style="margin-top:0;font-size:17px">문항별 평균 득점</h2>
      <div class="bars">${perQ.map(({ q, avg: v }, i) => `<div class="bar-row"><span>${i + 1}번</span><div class="bar"><i style="width:${(v / q.points) * 100}%"></i></div><span class="muted">${v}/${q.points}</span></div>`).join('')}</div>
    </div>
    <div class="card pad">
      <h2 style="margin-top:0;font-size:17px">AI ↔ 사람 채점 비교</h2>
      <p class="muted small">아래 표에 채점자 점수(0~100)를 넣으면 AI 점수와의 차이를 계산합니다. 사람 채점 10~20건으로 급수 경계와 보정계수를 맞추는 용도입니다.</p>
      <div class="row"><span class="badge">비교 ${pairs.length}건</span><span class="badge">평균 절대 차이 ${mae ?? '-'}점</span><span class="badge">급수 일치 ${sameGrade ?? '-'}%</span></div>
    </div>
  </div>
  <div class="card pad" style="margin-top:16px">
    <div class="row"><h2 style="margin:0;font-size:17px">응시 기록</h2><span class="spacer"></span>
      <button class="btn small" id="csv" ${list.length ? '' : 'disabled'}>CSV 다운로드</button>
      <button class="btn ghost small" id="clear" ${list.length ? '' : 'disabled'}>기록 지우기</button></div>
    <p class="muted small">기록은 이 브라우저에만 저장됩니다(데모). 실제 운영은 DB(Supabase 등)와 관리자 로그인으로 옮깁니다.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>응시번호</th><th>이름</th><th>일시</th><th>총점</th><th>급수</th><th>상태</th>${trans.map((q) => `<th>${QUESTIONS.indexOf(q) + 1}번 AI / 사람</th>`).join('')}</tr></thead>
      <tbody>${list.length ? list.map((a) => `<tr>
        <td><a href="#/result/${a.id}">${a.id}</a></td><td>${esc(a.name)}</td><td class="small">${new Date(a.at).toLocaleString('ko-KR')}</td>
        <td><b>${a.total}</b></td><td>${esc(a.grade)}</td>
        <td>${a.needsReview ? '<span class="badge warn">검토</span>' : ''}${a.appeal ? '<span class="badge crit">이의</span>' : ''}${a.mode === 'llm' ? '' : '<span class="badge">규칙만</span>'}</td>
        ${trans.map((q) => {
          const it = a.items.find((i) => i.id === q.id);
          return `<td>${it?.grade?.score ?? '-'} / <input type="number" min="0" max="100" data-a="${a.id}" data-q="${q.id}" value="${esc(a.human?.[q.id] ?? '')}" aria-label="사람 점수"/></td>`;
        }).join('')}
      </tr>`).join('') : `<tr><td colspan="${6 + trans.length}" class="muted">아직 응시 기록이 없습니다.</td></tr>`}</tbody>
    </table></div>
  </div>`;
  app.querySelectorAll('td input').forEach((inp) => (inp.onchange = () => {
    const all = loadAttempts();
    const t = all.find((x) => x.id === inp.dataset.a);
    if (!t) return;
    t.human = t.human || {};
    t.human[inp.dataset.q] = inp.value === '' ? '' : Math.max(0, Math.min(100, Number(inp.value)));
    saveAttempts(all);
    renderAdmin();
  }));
  const csv = document.getElementById('csv');
  if (csv) csv.onclick = () => {
    const rows = [['id', 'name', 'at', 'total', 'grade', 'needsReview', 'appeal', ...trans.flatMap((q) => [`${q.id}_ai`, `${q.id}_human`])]];
    for (const a of list) rows.push([a.id, a.name, a.at, a.total, a.grade, a.needsReview, a.appeal, ...trans.flatMap((q) => [a.items.find((i) => i.id === q.id)?.grade?.score ?? '', a.human?.[q.id] ?? ''])]);
    const blob = new Blob(['﻿' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement('a'), { href: url, download: 'mock-exam-attempts.csv' });
    link.click();
    URL.revokeObjectURL(url);
  };
  const clear = document.getElementById('clear');
  if (clear) clear.onclick = () => {
    const m = modal(`<h3>응시 기록을 모두 지울까요?</h3><p class="muted">이 브라우저에 저장된 기록만 지워집니다.</p><div class="row" style="justify-content:flex-end"><button class="btn" id="m-cancel">취소</button><button class="btn primary" id="m-ok">지우기</button></div>`);
    m.querySelector('#m-cancel').onclick = closeModal;
    m.querySelector('#m-ok').onclick = () => {
      saveAttempts([]);
      closeModal();
      renderAdmin();
    };
  };
}

// ---------- 라우터 ----------
function route() {
  setActiveNav();
  closeModal();
  const h = location.hash || '#/';
  if (h.startsWith('#/exam')) renderExam();
  else if (h.startsWith('#/result/')) renderResult(h.split('/')[2]);
  else if (h.startsWith('#/admin')) renderAdmin();
  else renderHome();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
route();
