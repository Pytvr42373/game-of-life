/* ================= 谁是知识大王 · 30 秒知识挑战 ================= */
(function () {
  'use strict';

  /* ============ 纯逻辑工具（可测试 / 可导出） ============ */
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  function clamp(v, min, max) { return v < min ? min : (v > max ? max : v); }
  function timeRemaining(deadline, now) { return Math.max(0, deadline - now); }
  function deadlineAfter(remaining, now) { return now + Math.max(0, remaining); }
  function todayStr(timestamp) {
    const d = new Date(timestamp == null ? Date.now() : timestamp);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  // 选题：按难度取未用题目；存在候选时避免连续三题同类（用前两题类别判断）
  function chooseQuestion(pools, usedIds, prevCats, diff) {
    let pool = pools[diff].filter(function (q) { return !usedIds[q.id]; });
    if (pool.length === 0) {
      pool = []
        .concat(pools['简单'], pools['中等'], pools['困难'])
        .filter(function (q) { return !usedIds[q.id]; });
    }
    if (pool.length === 0) return null;
    const forbidden = (prevCats.length === 2 && prevCats[0] === prevCats[1])
      ? prevCats[0] : null;
    const preferred = forbidden
      ? pool.filter(function (q) { return q.category !== forbidden; })
      : pool;
    const source = preferred.length > 0 ? preferred : pool;
    return shuffle(source.slice())[0];
  }

  // Top5 清理：只保留 30 天内，按分数降序、同分准确率高者优先，取前 5
  function cleanupTop(list) {
    const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
    const kept = list.filter(function (r) {
      return r && typeof r.score === 'number' && typeof r.acc === 'number' &&
        typeof r.createdAt === 'number' && r.createdAt >= cutoff;
    });
    kept.sort(function (a, b) {
      return (b.score - a.score) || (b.acc - a.acc);
    });
    return kept.slice(0, 5);
  }
  // 得分：答对 min(100+(连击-1)*20, 300)；连击传入为“增加后的连击数”
  function gainFor(comboAfterIncrement) {
    return Math.min(100 + (comboAfterIncrement - 1) * 20, 300);
  }

  /* ============ 常量 / 状态 ============ */
  const TOP5_KEY = 'brain-king-top5-v1';
  const MAX_TIME = 30000;      // 最高 30 秒
  const START_TIME = 30000;    // 开局 30 秒
  const FEEDBACK_MS = 1000;    // 反馈固定 1 秒
  const COUNTDOWN_MS = 3000;   // 3-2-1 倒数

  const TOTAL_SEGS = 30;

  const DIFFS = ['简单', '中等', '困难'];

  const state = {
    phase: 'menu',        // menu | countdown | play | pause | result
    playState: 'idle',    // question | feedback
    pausedFrom: null,     // countdown | question | feedback
    remaining: START_TIME,// 当前计时剩余 ms（countdown 时为倒数剩余）
    tDeadline: 0,
    fbRemaining: 0,
    fbTimeout: null,
    score: 0, right: 0, wrong: 0, combo: 0, maxCombo: 0,
    qIndex: 1, totalValid: 0,
    usedIds: {}, prevCats: [], wrongQs: [],
    currentQ: null, answerButtons: [],
    pools: { '简单': [], '中等': [], '困难': [] }
  };

  let tickId = null;
  let lastCountSec = null;

  /* ============ DOM ============ */
  let el = null;
  let segEls = [];
  function buildEls() {
    function $(id) { return document.getElementById(id); }
    el = {
      screens: document.querySelectorAll('.screen'),
      countNum: $('countNum'),
      clock: $('clock'), clockTime: $('clockTime'), clockFlag: $('clockFlag'),
      lightStrip: $('lightStrip'),
      qIndex: $('qIndex'), qTotal: $('qTotal'),
      scoreVal: $('scoreVal'), comboVal: $('comboVal'), comboCell: $('comboCell'),
      qCat: $('qCat'), qDiff: $('qDiff'), questionText: $('questionText'),
      answers: $('answers'), feedback: $('feedback'),
      startBtn: $('startBtn'), menuError: $('menuError'),
      top5List: $('top5List'), top5Empty: $('top5Empty'),
      pauseNote: $('pauseNote'), resumeBtn: $('resumeBtn'),
      resultTitle: $('resultTitle'), resultSub: $('resultSub'),
      resultScore: $('resultScore'), rRight: $('rRight'), rWrong: $('rWrong'),
      rAcc: $('rAcc'), rCombo: $('rCombo'), rankLine: $('rankLine'),
      reviewBlock: $('reviewBlock'), reviewList: $('reviewList'),
      againBtn: $('againBtn'), toMenuBtn: $('toMenuBtn'),
      themeToggle: $('themeToggle'), loader: $('loader'), backHome: $('backHome')
    };
  }

  /* ============ 主题 ============ */
  let reduced = false;
  let themeBusy = false;
  if (typeof window !== 'undefined' && window.matchMedia) {
    const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
    reduced = motionQuery.matches;
    motionQuery.addEventListener('change', function (event) { reduced = event.matches; });
  }
  function iconSVG(arcade) {
    if (arcade) {
      return '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M12 12 L21 6 A10 10 0 1 0 21 18 Z"/><circle cx="13.5" cy="7.5" r="1.1" fill="#0a0a18"/></svg>';
    }
    return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3C9.8 3 8 4.8 8 7c0 .6.1 1.2.4 1.7C6.5 9.4 5.2 11 5.2 13c0 2.2 1.8 4 4 4h5.6c2.2 0 4-1.8 4-4 0-2-1.3-3.6-3.2-4.3.3-.5.4-1.1.4-1.7 0-2.2-1.8-4-4-4z"/><path d="M12 17v4"/><path d="M12 21l-3 2M12 21l3 2"/></svg>';
  }
  function paintThemeIcon() {
    const isArcade = document.body.dataset.theme === 'arcade';
    el.themeToggle.innerHTML = iconSVG(!isArcade);
    el.themeToggle.setAttribute('aria-label', isArcade ? '切换为清新日间主题' : '切换为街机夜间主题');
  }
  function applyTheme(t) {
    document.body.dataset.theme = t;
    try { localStorage.setItem('gh-theme', t); } catch (e) { /* 隐私模式仍本次生效 */ }
    paintThemeIcon();
  }
  function toggleTheme() {
    if (themeBusy) return;
    // 计时/反馈进行中：先暂停，切换完成后显示“继续挑战”
    if (state.phase === 'countdown' || state.phase === 'play') pauseGame('theme');
    const next = document.body.dataset.theme === 'arcade' ? '4399' : 'arcade';
    if (reduced) { applyTheme(next); return; }
    themeBusy = true;
    el.loader.classList.add('on');
    el.loader.setAttribute('aria-hidden', 'false');
    window.setTimeout(function () {
      applyTheme(next);
      window.setTimeout(function () {
        el.loader.classList.remove('on');
        el.loader.setAttribute('aria-hidden', 'true');
        themeBusy = false;
      }, 150);
    }, 500);
  }

  /* ============ 屏幕切换 ============ */
  function showScreen(name) {
    el.screens.forEach(function (s) {
      const active = s.id === 'screen-' + name;
      s.classList.toggle('active', active);
      s.setAttribute('aria-hidden', String(!active));
    });
  }

  /* ============ 题库校验 ============ */
  function buildPools() {
    const raw = window.BRAIN_KING_QUESTIONS;
    if (!Array.isArray(raw) || raw.length < 300) return false;
    state.pools = { '简单': [], '中等': [], '困难': [] };
    const seenIds = Object.create(null);
    const seenQuestions = Object.create(null);
    let valid = true;
    raw.forEach(function (q) {
      if (!q || typeof q !== 'object') { valid = false; return; }
      const diff = DIFFS.indexOf(q.difficulty) >= 0 ? q.difficulty : null;
      const opts = (Array.isArray(q.options) && q.options.length === 4 &&
        q.options.every(function (option) { return typeof option === 'string' && option.trim(); }))
        ? q.options.slice() : null;
      const ans = q.answer;
      const id = typeof q.id === 'string' ? q.id.trim() : '';
      const question = typeof q.question === 'string' ? q.question.trim() : '';
      const category = typeof q.category === 'string' ? q.category.trim() : '';
      const explanation = typeof q.explanation === 'string' ? q.explanation.trim() : '';
      if (!diff || !opts || !id || !question || !category || !explanation || typeof ans !== 'string' ||
          new Set(opts).size !== 4 || seenIds[id] || seenQuestions[question]) {
        valid = false;
        return;
      }
      const cnt = opts.filter(function (o) { return o === ans; }).length;
      if (cnt !== 1) { valid = false; return; }
      seenIds[id] = true;
      seenQuestions[question] = true;
      state.pools[diff].push({
        id: id,
        category: category,
        difficulty: diff,
        question: question,
        options: opts,
        answer: ans,
        explanation: explanation
      });
    });
    state.totalValid = state.pools['简单'].length + state.pools['中等'].length + state.pools['困难'].length;
    return valid && state.totalValid === raw.length && DIFFS.every(function (diff) { return state.pools[diff].length > 0; });
  }

  /* ============ 灯带 ============ */
  function buildStrip() {
    el.lightStrip.innerHTML = '';
    segEls = [];
    for (let i = 0; i < TOTAL_SEGS; i++) {
      const s = document.createElement('span');
      s.className = 'seg';
      el.lightStrip.appendChild(s);
      segEls.push(s);
    }
  }
  function renderStrip() {
    const lit = Math.max(0, Math.ceil(state.remaining / 1000));
    const urgent = state.remaining <= 5000;
    for (let i = 0; i < TOTAL_SEGS; i++) {
      const seg = segEls[i];
      seg.classList.toggle('dim', i >= lit);
      seg.classList.toggle('hot', urgent && i < lit);
      seg.classList.remove('gain');
    }
  }

  /* ============ 计时显示 ============ */
  function renderPlayTimer() {
    const secs = Math.max(0, Math.ceil(state.remaining / 1000));
    el.clockTime.textContent = secs;
    el.clock.classList.toggle('urgent', state.remaining <= 5000 && state.playState === 'question');
    renderStrip();
  }
  function renderCountdown() {
    const secs = Math.max(1, Math.ceil(state.remaining / 1000));
    if (el.countNum.textContent !== String(secs)) {
      el.countNum.textContent = secs;
      el.countNum.classList.remove('pop');
      void el.countNum.offsetWidth;
      el.countNum.classList.add('pop');
    }
  }

  /* 主计时器：唯一 interval，仅在 countdown / play-question 时推进，暂停即冻结 */
  function tick() {
    const now = performance.now();
    if (state.phase === 'countdown') {
      state.remaining = timeRemaining(state.tDeadline, now);
      renderCountdown();
      const secs = Math.max(1, Math.ceil(state.remaining / 1000));
      if (secs !== lastCountSec) { lastCountSec = secs; sfxCountTick(); }
      if (state.remaining <= 0) startPlay();
    } else if (state.phase === 'play' && state.playState === 'question') {
      state.remaining = timeRemaining(state.tDeadline, now);
      renderPlayTimer();
      if (state.remaining <= 0) settle('timeup');
    }
  }

  function applyTimeDelta(deltaMs, label) {
    const before = state.remaining;
    state.remaining = clamp(before + deltaMs, 0, MAX_TIME);
    el.clockFlag.textContent = label;
    el.clockTime.classList.remove('bump');
    void el.clockTime.offsetWidth;
    el.clockTime.classList.add('bump');
    renderPlayTimer();
    if (state.remaining > before) {
      const lit = Math.max(0, Math.ceil(state.remaining / 1000));
      if (lit > 0 && lit <= TOTAL_SEGS) {
        segEls[lit - 1].classList.add('gain');
        window.setTimeout(function () { segEls[lit - 1].classList.remove('gain'); }, 450);
      }
    }
    return state.remaining - before;
  }

  /* ============ 计分 / 连击 ============ */
  function renderHud() {
    el.scoreVal.textContent = state.score;
    el.comboVal.textContent = state.combo;
    el.qIndex.textContent = state.qIndex;
    el.qTotal.textContent = '/' + state.totalValid;
    el.comboCell.classList.toggle('gain', state.combo > 1);
    el.comboCell.classList.toggle('lost', state.combo === 0);
  }

  /* ============ 游戏流程 ============ */
  function startGame() {
    sfxClick();
    sfxStart();
    startBGM();
    state.score = 0; state.right = 0; state.wrong = 0;
    state.combo = 0; state.maxCombo = 0; state.qIndex = 1;
    state.usedIds = {}; state.prevCats = []; state.wrongQs = [];
    beginCountdown();
  }

  function beginCountdown() {
    state.phase = 'countdown';
    state.playState = 'idle';
    state.remaining = COUNTDOWN_MS;
    state.tDeadline = deadlineAfter(COUNTDOWN_MS, performance.now());
    el.clockFlag.textContent = '';
    showScreen('count');
    renderCountdown();
  }

  function startPlay() {
    sfxCountGo();
    state.phase = 'play';
    state.playState = 'question';
    state.remaining = START_TIME;
    state.tDeadline = deadlineAfter(START_TIME, performance.now());
    showScreen('play');
    renderPlayTimer();
    renderQuestion();
  }

  function noMoreQuestions() {
    for (let i = 0; i < DIFFS.length; i++) {
      if (state.pools[DIFFS[i]].some(function (q) { return !state.usedIds[q.id]; })) return false;
    }
    return true;
  }

  function renderQuestion() {
    const diff = state.qIndex <= 3 ? '简单' : (state.qIndex <= 8 ? '中等' : '困难');
    const q = chooseQuestion(state.pools, state.usedIds, state.prevCats, diff);
    if (!q) { settle('pass'); return; }
    state.currentQ = q;
    state.usedIds[q.id] = true;
    state.prevCats.push(q.category);
    if (state.prevCats.length > 2) state.prevCats.shift();

    el.qCat.textContent = q.category;
    const dEl = el.qDiff;
    dEl.textContent = q.difficulty;
    dEl.className = 'pill diff ' + (q.difficulty === '简单' ? 'simple' : q.difficulty === '中等' ? 'medium' : 'hard');
    el.questionText.textContent = q.question;
    el.feedback.innerHTML = '';
    el.feedback.className = 'feedback';
    el.clockFlag.textContent = '';
    renderHud();

    // Fisher-Yates 打乱选项
    const idxOrder = shuffle([0, 1, 2, 3]);
    const letters = ['A', 'B', 'C', 'D'];
    el.answers.innerHTML = '';
    state.answerButtons = [];
    idxOrder.forEach(function (i, position) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'answer';
      btn.dataset.answer = q.options[i];
      btn.innerHTML = '<span class="key-hint">' + letters[position] + '</span><span class="ans-txt"></span>';
      btn.querySelector('.ans-txt').textContent = q.options[i];
      btn.addEventListener('click', function () { chooseAnswer(btn); });
      el.answers.appendChild(btn);
      state.answerButtons.push(btn);
    });
  }

  function lockAnswers() {
    state.answerButtons.forEach(function (b) { b.disabled = true; });
  }
  function unlockAnswers() {
    state.answerButtons.forEach(function (b) { b.disabled = false; });
  }

  function chooseAnswer(btn) {
    if (state.phase !== 'play' || state.playState !== 'question') return; // 防双击/重复计分
    state.remaining = timeRemaining(state.tDeadline, performance.now());
    if (state.remaining <= 0) {
      renderPlayTimer();
      settle('timeup');
      return;
    }
    const picked = btn.dataset.answer;
    const correct = state.currentQ.answer;
    state.playState = 'feedback'; // 立即锁定
    lockAnswers();
    if (picked === correct) {
      onCorrect(btn);
    } else {
      onWrong(btn, picked, correct);
    }
    state.fbRemaining = FEEDBACK_MS;
    state.fbDeadline = performance.now() + FEEDBACK_MS;
    state.fbTimeout = window.setTimeout(completeFeedback, FEEDBACK_MS);
  }

  function onCorrect(btn) {
    state.right++;
    state.combo++;
    if (state.combo > state.maxCombo) state.maxCombo = state.combo;
    const add = gainFor(state.combo);
    state.score += add;
    sfxCorrect(state.combo);
    btn.classList.add('correct');
    const hadTimeRoom = state.remaining < MAX_TIME;
    const timeGain = applyTimeDelta(+1000, hadTimeRoom ? '+1 秒' : '已满 30 秒');
    const timeText = timeGain > 0 ? '+1 秒' : '时间已满';
    el.comboVal.classList.remove('combo-bump');
    void el.comboVal.offsetWidth;
    el.comboVal.classList.add('combo-bump');
    el.feedback.className = 'feedback good';
    el.feedback.innerHTML =
      '<svg aria-hidden="true"><use href="#bk-icon-check"></use></svg>' +
      '<span class="fb-line">答对了！+' + add + ' 分 · 连击 x' + state.combo + ' · ' + timeText + '</span>' +
      '<span class="fb-explain">' + esc(state.currentQ.explanation || '继续保持！') +
      (timeGain <= 0 ? ' 计时保持在 30 秒上限。' : '') + '</span>';
    renderHud();
  }

  function onWrong(btn, picked, correct) {
    sfxWrong();
    state.wrong++;
    state.score = Math.max(0, state.score - 50);
    state.combo = 0;
    btn.classList.add('wrong');
    // 高亮正确答案
    state.answerButtons.forEach(function (b) {
      if (b.dataset.answer === correct) b.classList.add('correct');
    });
    applyTimeDelta(-3000, '-3 秒');
    state.wrongQs.push({ q: state.currentQ, player: picked });
    el.feedback.className = 'feedback bad';
    el.feedback.innerHTML =
      '<svg aria-hidden="true"><use href="#bk-icon-x"></use></svg>' +
      '<span class="fb-line">答错了 -50 分 · -3 秒 · 正确答案：' + esc(correct) + '</span>' +
      '<span class="fb-explain">' + esc(state.currentQ.explanation || '记住正确答案，再接再厉。') + '</span>';
    renderHud();
  }

  function completeFeedback() {
    state.fbTimeout = null;
    if (state.phase !== 'play') return;
    state.playState = 'question';
    // 错误扣时到 0：已完整显示 1 秒反馈，再结算
    if (state.remaining <= 0) { settle('timeup'); return; }
    if (noMoreQuestions()) { settle('pass'); return; }
    state.qIndex++;
    state.tDeadline = deadlineAfter(state.remaining, performance.now());
    renderQuestion();
  }

  /* ============ 结算 ============ */
  function settle(reason) {
    if (state.phase !== 'play') return;
    lockAnswers();
    state.phase = 'result';
    state.playState = 'idle';
    if (state.fbTimeout) { window.clearTimeout(state.fbTimeout); state.fbTimeout = null; }
    const pass = reason === 'pass';
    if (reason === 'timeup') sfxTimeUp();
    else if (pass) sfxWin();
    else sfxResult();
    stopBGM();
    const acc = (state.right + state.wrong) > 0
      ? Math.round(state.right / (state.right + state.wrong) * 100) : 0;

    el.resultTitle.textContent = pass ? '题库通关！' : '挑战结束';
    el.resultTitle.classList.toggle('pass', pass);
    el.resultSub.textContent = pass ? '你已答完所有题目，太厉害了！' : '本局成绩';
    el.resultScore.textContent = state.score;
    el.rRight.textContent = state.right;
    el.rWrong.textContent = state.wrong;
    el.rAcc.textContent = acc + '%';
    el.rCombo.textContent = state.maxCombo;

    const rank = saveScore(state.score, acc);
    el.rankLine.textContent = rank ? ('本机排名：第 ' + rank + ' 名') : '未进入本机 Top 5';

    renderReview();
    showScreen('result');
  }

  function renderReview() {
    el.reviewList.innerHTML = '';
    if (!state.wrongQs.length) { el.reviewBlock.hidden = true; return; }
    el.reviewBlock.hidden = false;
    state.wrongQs.forEach(function (w) {
      const li = document.createElement('li');
      li.innerHTML =
        '<div class="rv-q">' + esc(w.q.question) + '</div>' +
        '<div class="rv-a">你的答案：<span class="val">' + esc(w.player) + '</span></div>' +
        '<div class="rv-a rv-correct">正确答案：<span class="val">' + esc(w.q.answer) + '</span></div>' +
        (w.q.explanation ? '<div class="rv-ex">' + esc(w.q.explanation) + '</div>' : '');
      el.reviewList.appendChild(li);
    });
  }

  /* ============ Top5（本地存储，无昵称） ============ */
  function readTop() {
    let list = [];
    try { list = JSON.parse(localStorage.getItem(TOP5_KEY) || '[]'); } catch (e) { list = []; }
    return Array.isArray(list) ? list : [];
  }
  function writeTop(list) {
    try { localStorage.setItem(TOP5_KEY, JSON.stringify(list)); } catch (e) { /* 隐私模式忽略 */ }
  }
  function saveScore(sc, acc) {
    let list = readTop();
    const createdAt = Date.now();
    const record = { score: sc, date: todayStr(createdAt), acc: acc, createdAt: createdAt };
    list.push(record);
    list = cleanupTop(list);
    writeTop(list);
    const idx = list.indexOf(record);
    return idx >= 0 ? idx + 1 : null;
  }
  function renderTop5() {
    const list = cleanupTop(readTop());
    writeTop(list); // 打开页面时清理
    el.top5List.innerHTML = '';
    const empty = !list.length;
    el.top5Empty.hidden = !empty;
    if (empty) return;
    list.forEach(function (r, i) {
      const li = document.createElement('li');
      li.innerHTML =
        '<span class="rank">' + (i + 1) + '</span>' +
        '<span class="ts-date">' + esc(r.date) + '</span>' +
        '<span class="ts-acc">' + (r.acc || 0) + '%</span>' +
        '<span class="ts-score">' + r.score + '</span>';
      el.top5List.appendChild(li);
    });
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ============ 暂停 / 恢复 ============ */
  function pauseGame(reason) {
    if (state.phase !== 'countdown' && state.phase !== 'play') return;
    const now = performance.now();
    if (state.phase === 'countdown') {
      state.remaining = timeRemaining(state.tDeadline, now);
      state.pausedFrom = 'countdown';
    } else if (state.playState === 'question') {
      state.remaining = timeRemaining(state.tDeadline, now);
      if (state.remaining <= 0) {
        renderPlayTimer();
        settle('timeup');
        return;
      }
      state.pausedFrom = 'question';
    } else { // feedback：倒计时已冻结，只冻结反馈剩余
      state.fbRemaining = timeRemaining(state.fbDeadline, now);
      if (state.fbTimeout) { window.clearTimeout(state.fbTimeout); state.fbTimeout = null; }
      state.pausedFrom = 'feedback';
    }
    state.phase = 'pause';
    state.playState = 'idle';
    el.pauseNote.textContent = reason === 'theme'
      ? '切换主题期间，计时和答题进度都已冻结。'
      : '计时和答题进度都已冻结，回来后继续挑战。';
    showScreen('pause');
    if (!document.hidden) el.resumeBtn.focus({ preventScroll: true });
  }

  function resumeGame() {
    if (state.phase !== 'pause') return;
    sfxClick();
    const now = performance.now();
    const pausedFrom = state.pausedFrom;
    state.pausedFrom = null;
    if (pausedFrom === 'countdown') {
      state.phase = 'countdown';
      state.tDeadline = deadlineAfter(state.remaining, now);
      showScreen('count');
      renderCountdown();
    } else {
      state.phase = 'play';
      if (pausedFrom === 'question') {
        state.playState = 'question';
        state.tDeadline = deadlineAfter(state.remaining, now);
        unlockAnswers();
      } else { // feedback
        state.playState = 'feedback';
        state.fbDeadline = deadlineAfter(state.fbRemaining, now);
        state.fbTimeout = window.setTimeout(completeFeedback, state.fbRemaining);
      }
      renderPlayTimer();
      showScreen('play');
    }
  }

  /* ============ 键盘 1-4 / A-D ============ */
  function onKeydown(e) {
    if (state.phase !== 'play' || state.playState !== 'question') return;
    const k = e.key;
    let idx = -1;
    if (k >= '1' && k <= '4') idx = k.charCodeAt(0) - 49;
    else if (k >= 'a' && k <= 'd') idx = k.charCodeAt(0) - 97;
    else if (k >= 'A' && k <= 'D') idx = k.charCodeAt(0) - 65;
    if (idx >= 0 && idx < state.answerButtons.length) {
      e.preventDefault();
      chooseAnswer(state.answerButtons[idx]);
    }
  }

  /* ============ 音效 & BGM（Web Audio 程序化合成，无外部音频文件） ============ */
  let AC = null;
  function audio() {
    if (!AC) {
      try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { AC = null; }
    }
    if (AC && AC.state === 'suspended') AC.resume();
    return AC;
  }
  // 统一发声：振荡器 + 增益包络；reduced-motion 时降低音量
  function tone(f, dur, type, vol, when) {
    const a = audio(); if (!a) return;
    const o = a.createOscillator(), g = a.createGain();
    const t = a.currentTime + (when || 0);
    o.type = type || 'square';
    o.frequency.value = f;
    const v = clamp((vol == null ? 0.05 : vol) * (reduced ? 0.4 : 1), 0, 1);
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(a.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }
  // MIDI 音符号 → 频率
  function noteFreq(n) { return 440 * Math.pow(2, (n - 69) / 12); }

  // ---- 音效 ----
  function sfxClick() { tone(720, 0.05, 'square', 0.04); }
  function sfxStart() { [440, 660, 880].forEach(function (f, i) { tone(f, 0.12, 'square', 0.05, i * 0.08); }); }
  function sfxCountTick() { tone(660, 0.07, 'square', 0.05); }
  function sfxCountGo() {
    tone(880, 0.14, 'square', 0.06);
    setTimeout(function () { tone(1174, 0.16, 'square', 0.05); }, 70);
  }
  function sfxCorrect(combo) {
    const base = 523 + clamp(combo - 1, 0, 12) * 42; // 连击越高音调越高
    tone(base, 0.1, 'triangle', 0.06);
    tone(base * 1.5, 0.16, 'triangle', 0.05, 0.07);
  }
  function sfxWrong() {
    tone(220, 0.22, 'sawtooth', 0.06);
    tone(147, 0.3, 'sawtooth', 0.05, 0.1);
  }
  function sfxTimeUp() { [880, 659, 494].forEach(function (f, i) { tone(f, 0.18, 'square', 0.06, i * 0.13); }); }
  function sfxResult() { [659, 523, 392, 494, 659].forEach(function (f, i) { tone(f, 0.16, 'triangle', 0.05, i * 0.12); }); }
  function sfxWin() {
    [523, 659, 784, 1046, 1318, 1568].forEach(function (f, i) { tone(f, 0.16, 'triangle', 0.06, i * 0.1); });
  }

  // ---- BGM：轻快循环（I-IV-V-I 琶音 + 旋律），lookahead 调度 ----
  const BGM_STEP = 0.24; // 每步间隔（秒）
  const BGM_ROOTS = [48, 53, 55, 48]; // C3 F3 G3 C3（MIDI）
  const BGM_MELODY = [
    72, 76, 79, 76, 72, 74, 76, 0,
    69, 72, 77, 72, 69, 72, 74, 0,
    71, 74, 79, 74, 71, 74, 76, 0,
    72, 76, 79, 84, 79, 76, 79, 84
  ];
  let bgmTimer = null;
  let bgmStep = 0;
  let bgmActive = false;
  function bgmSched() {
    const a = audio(); if (!a || !bgmActive) return;
    // 后台长时间挂起时跳过多余步数，避免一次性排大量音符
    const nowStep = Math.floor(a.currentTime / BGM_STEP);
    if (bgmStep < nowStep - 8) bgmStep = nowStep;
    const horizon = a.currentTime + 0.35;
    while (bgmStep * BGM_STEP < horizon) {
      const t = bgmStep * BGM_STEP;
      const idx = bgmStep % 32;
      const bar = Math.floor(idx / 8);
      const root = BGM_ROOTS[bar];
      const bass = (idx % 2 === 0) ? root : root + 7;
      tone(noteFreq(bass), 0.2, 'triangle', 0.03, t);
      const m = BGM_MELODY[idx];
      if (m) tone(noteFreq(m), 0.18, 'square', 0.028, t);
      bgmStep++;
    }
  }
  function startBGM() {
    stopBGM();
    const a = audio(); if (!a) return;
    bgmActive = true;
    bgmStep = 0;
    bgmSched();
    bgmTimer = window.setInterval(bgmSched, 120);
  }
  function stopBGM() {
    bgmActive = false;
    if (bgmTimer) { window.clearInterval(bgmTimer); bgmTimer = null; }
  }

  /* ============ 初始化 ============ */
  function init() {
    buildEls();
    // 主题
    let saved = '4399';
    try {
      const s = localStorage.getItem('gh-theme');
      if (s === '4399' || s === 'arcade') saved = s;
    } catch (e) { /* 默认日间 */ }
    applyTheme(saved);

    buildStrip();

    // 题库校验
    if (!buildPools()) {
      el.menuError.hidden = false;
      el.menuError.textContent = '题库加载失败，暂时无法开始。请刷新页面或稍后再试。';
      el.startBtn.disabled = true;
    }
    renderTop5();
    showScreen('menu');

    // 事件
    el.startBtn.addEventListener('click', startGame);
    el.resumeBtn.addEventListener('click', resumeGame);
    el.againBtn.addEventListener('click', startGame);
    el.toMenuBtn.addEventListener('click', function () {
      sfxClick();
      stopBGM();
      state.phase = 'menu';
      state.playState = 'idle';
      renderTop5();
      showScreen('menu');
      el.startBtn.focus({ preventScroll: true });
    });
    el.themeToggle.addEventListener('click', toggleTheme);
    el.themeToggle.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggleTheme();
      }
    });
    el.backHome.addEventListener('click', function () {
      try { sessionStorage.setItem('skipSplash', '1'); } catch (e) { /* 忽略 */ }
    });
    document.addEventListener('keydown', onKeydown);

    // 页面隐藏/后台自动暂停；返回后需点“继续挑战”
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) pauseGame('hide');
    });

    // 主计时器（唯一 interval，非计时状态立即返回，暂停即冻结，不会后台推进）
    tickId = window.setInterval(tick, 100);
  }

  if (typeof document !== 'undefined' && document.getElementById) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }

  /* ============ Node 自检导出 ============ */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      shuffle: shuffle,
      clamp: clamp,
      chooseQuestion: chooseQuestion,
      cleanupTop: cleanupTop,
      gainFor: gainFor,
      todayStr: todayStr,
      timeRemaining: timeRemaining,
      deadlineAfter: deadlineAfter
    };
    if (require.main === module) runSelfTests();
  }

  function runSelfTests() {
    const assert = require('assert');
    // 打乱
    const a = [1, 2, 3, 4];
    shuffle(a);
    assert.strictEqual(a.length, 4);
    assert.deepStrictEqual([1, 2, 3, 4].sort(), a.slice().sort(function (x, y) { return x - y; }));

    // clamp
    assert.strictEqual(clamp(5, 0, 10), 5);
    assert.strictEqual(clamp(-1, 0, 10), 0);
    assert.strictEqual(clamp(99, 0, 10), 10);

    // 得分
    assert.strictEqual(gainFor(1), 100);
    assert.strictEqual(gainFor(2), 120);
    assert.strictEqual(gainFor(11), 300);
    assert.strictEqual(gainFor(20), 300);

    // 反馈阶段冻结全局时间：1 秒反馈结束后，用冻结值重建截止点
    const questionDeadline = 30000;
    const frozenAtAnswer = timeRemaining(questionDeadline, 1234);
    assert.strictEqual(frozenAtAnswer, 28766);
    const resumedDeadline = deadlineAfter(frozenAtAnswer, 2234);
    assert.strictEqual(timeRemaining(resumedDeadline, 2234), frozenAtAnswer);
    assert.strictEqual(timeRemaining(resumedDeadline, 3234), frozenAtAnswer - 1000);

    // 选题避免连续三题同类
    const pools = { '简单': [], '中等': [], '困难': [] };
    const mk = function (id, cat, diff) { return { id: id, category: cat, difficulty: diff, options: ['1', '2', '3', '4'], answer: '1', question: 'q', explanation: '' }; };
    for (let i = 0; i < 3; i++) { pools['简单'].push(mk('s' + i, 'A', '简单')); }
    for (let i = 0; i < 3; i++) { pools['简单'].push(mk('b' + i, 'B', '简单')); }
    const used = { 's0': true, 's1': true };
    // 前两题同类 A，存在 B 候补 → 绝不能选 A
    const picked = chooseQuestion(pools, used, ['A', 'A'], '简单');
    assert.strictEqual(picked.category, 'B');
    // 无候补时允许同类
    const used2 = { 's0': true, 's1': true, 'b0': true, 'b1': true, 'b2': true };
    const picked2 = chooseQuestion(pools, used2, ['A', 'A'], '简单');
    assert.strictEqual(picked2.category, 'A');

    // Top5 清理：排序 + 截断
    const now = Date.now();
    const list = cleanupTop([
      { score: 200, date: todayStr(now), acc: 80, createdAt: now },
      { score: 300, date: todayStr(now), acc: 60, createdAt: now },
      { score: 200, date: todayStr(now), acc: 95, createdAt: now }
    ]);
    assert.strictEqual(list[0].score, 300);
    assert.strictEqual(list[1].acc, 95); // 同分准确率高者优先
    assert.strictEqual(list.length, 3);

    console.log('brain-king logic self-test: OK');
  }
})();
