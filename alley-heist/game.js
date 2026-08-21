/* =====================================================================
 * game.js —— 《暗巷潜行》主流程：Canvas 渲染 / 键鼠与触屏输入 /
 * HUD 阶段与状态 / 三屏切换 / 星级结算 / localStorage 关卡进度。
 * 依赖：engine.js(AlleyEngine v3) / audio.js(AlleyAudio)。
 * 契约：默认行走、Shift/Ctrl 冲刺、E 交互；actions={up,down,left,right,
 *       sprint,interact,lastDir}；视觉与逻辑同源（逐格 canSee 视锥），
 *       不画穿墙扇形；BGM tension 由当前状态推导，不用累计暴露数。
 * ===================================================================== */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  var E = window.AlleyEngine;
  var A = window.AlleyAudio;
  var cfg = E.cfg;
  var PX = 60; // 格子像素（960×540 画布，地图用视窗平移）

  var canvas = $('gameCanvas');
  var ctx = canvas.getContext('2d');
  var W = canvas.width, H = canvas.height;

  /* —— 元素引用 —— */
  var startScreen = $('startScreen'), runScreen = $('runScreen'), overScreen = $('overScreen');
  var hudLevel = $('hudLevel'), hudTime = $('hudTime'), hudPhase = $('hudPhase');
  var hudKey = $('hudKey'), hudStatus = $('hudStatus');
  var dangerOverlay = $('dangerOverlay'), dangerText = $('dangerText');
  var pauseHint = $('pauseHint'), hintToast = $('hintToast');
  var overTitle = $('overTitle'), overSub = $('overSub');
  var statStars = $('statStars'), statTime = $('statTime'), statDetections = $('statDetections');
  var levelSelect = $('levelSelect');
  var rulesModal = $('rulesModal'), rulesBtn = $('rulesBtn');
  var rulesCloseBtn = $('rulesCloseBtn'), rulesConfirmBtn = $('rulesConfirmBtn');
  var rulesLead = $('rulesLead');

  /* —— 状态 —— */
  var S = null;
  var running = false, paused = false;
  var rafId = 0, lastTs = 0;
  var transition = 0;      // 被抓瞬间的红色渐显（0-1）
  var toastTimer = 0;
  var touchKeys = { up: false, down: false, left: false, right: false };
  var touchSprint = false;
  var interactQueued = false;
  var keys = { up: false, down: false, left: false, right: false, sprint: false };
  var dirOrder = [];       // 当前按住的方向，按最后按下排序（键盘/触屏共用）
  var waves = [];          // 声波扩散圈（只动 Canvas 绘制参数）
  var lastCellKey = '';
  var heardHintShown = false, lastHeardCue = -10;
  var renderErrorLogged = false;
  var rulesMode = null, rulesWasPaused = false, pendingLevel = 0, rulesFocus = null;

  var PROGRESS_KEY = 'alley-heist.progress.v2';
  var OLD_PROGRESS_KEY = 'alley-heist.progress.v1';
  var PAR_TIMES = [25, 35, 55, 60, 45, 70]; // 每关 3 星 par 时间（秒）

  /* ================= 主题 ================= */
  var themeToggle = $('themeToggle');
  function themeIcon(target) {
    if (target === 'arcade') {
      return '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 3.2a5.8 5.8 0 0 1 5.8 5.8 5.8 5.8 0 0 1-5.8 5.8V6.2z" opacity=".92"/></svg>';
    }
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M12 4c1.8 3-1 5.5-1 8 0 1.5 1 2.4 1 4-.8 2.4-3.6 3-5 4M12 4c-1.8 3 1 5.5 1 8 0 1.5-1 2.4-1 4M5 20c1-1.5 2.4-2 4-2M15 20c1-1.5 2.4-2 4-2"/><circle cx="12" cy="4" r="1.2"/></svg>';
  }
  function paintIcon() {
    var target = document.body.dataset.theme === 'arcade' ? '4399' : 'arcade';
    themeToggle.innerHTML = themeIcon(target);
    themeToggle.setAttribute('aria-label', '切换到' + (target === 'arcade' ? '街机' : '清新') + '主题');
  }
  function applyTheme(t, persist) {
    document.body.dataset.theme = t;
    if (persist !== false) { try { localStorage.setItem('gh-theme', t); } catch (e) {} }
    paintIcon();
  }
  themeToggle.addEventListener('click', function () {
    applyTheme(document.body.dataset.theme === 'arcade' ? '4399' : 'arcade', true);
  });

  /* ================= 进度持久化（v2） ================= */
  function loadProgress() {
    var p = null;
    try { p = JSON.parse(localStorage.getItem(PROGRESS_KEY) || 'null'); } catch (e) { p = null; }
    if (p && typeof p === 'object') {
      if (!p.lv || typeof p.lv !== 'object') p.lv = {};
      return p;
    }
    // 迁移 v1：只保留已解锁与最好时间，旧金币/旧星级不作新成绩
    var v1 = null;
    try { v1 = JSON.parse(localStorage.getItem(OLD_PROGRESS_KEY) || 'null'); } catch (e) { v1 = null; }
    var out = { v: 2, lv: {} };
    if (v1 && typeof v1 === 'object') {
      for (var k in v1) {
        if (!/^l\d+$/.test(k)) continue;
        var rec = v1[k];
        if (rec && typeof rec === 'object') {
          out.lv[k] = {
            unlocked: true,
            stars: 0,
            time: typeof rec.time === 'number' ? rec.time : 9e9,
            det: 9e9
          };
        }
      }
    }
    return out;
  }
  function saveProgress(p) {
    try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(p)); } catch (e) { /* 静默 */ }
  }
  /* 星级：1 星通关；潜入期零暴露 +1；低于该关 par 时间 +1 */
  function starsFor(s) {
    var st = 1;
    if (s.player.preKeyDetections === 0) st++;
    if (s.time < PAR_TIMES[s.idx]) st++;
    return Math.min(3, st);
  }
  function recordResult(idx, stars, timeSec, det) {
    var p = loadProgress();
    var key = 'l' + (idx + 1);
    var prev = p.lv[key] || { unlocked: true, stars: 0, time: 9e9, det: 9e9 };
    p.lv[key] = {
      unlocked: true,
      stars: Math.max(prev.stars || 0, stars),
      time: Math.min(typeof prev.time === 'number' ? prev.time : 9e9, timeSec),
      det: Math.min(typeof prev.det === 'number' ? prev.det : 9e9, det)
    };
    saveProgress(p);
    buildLevelSelect();
    return p;
  }
  function levelUnlocked(idx) {
    if (idx === 0) return true;
    var p = loadProgress();
    var rec = p.lv['l' + idx];
    return !!(rec && rec.unlocked);
  }
  /* 选最高已解锁关（而不是永远第 1 关） */
  function getFirstUnlocked() {
    var best = 0;
    for (var i = 0; i < E.LEVELS.length; i++) {
      if (levelUnlocked(i)) best = i;
    }
    return best;
  }

  /* ================= 屏幕切换 ================= */
  function showScreen(scr) {
    [startScreen, runScreen, overScreen].forEach(function (s) {
      s.classList.toggle('active', s === scr);
      s.setAttribute('aria-hidden', s === scr ? 'false' : 'true');
    });
  }

  /* ================= 共用规则弹窗 ================= */
  function rulesVisible() { return rulesModal.classList.contains('show'); }
  function openRules(mode) {
    if (rulesVisible()) return;
    rulesMode = mode;
    rulesFocus = document.activeElement;
    if (mode === 'game') {
      rulesWasPaused = paused;
      paused = true;
      clearKeys();
      pauseHint.classList.remove('show');
      rulesLead.textContent = '任务已暂停。确认视线、声音与捷径规则后，继续完成当前行动。';
      rulesConfirmBtn.textContent = '继续当前任务';
      if (A && A.setTension) A.setTension(0);
    } else {
      rulesWasPaused = false;
      pendingLevel = getFirstUnlocked();
      rulesLead.textContent = '先安静潜入。钥匙到手后警报必响，利用声响、转角和捷径甩开追兵。';
      rulesConfirmBtn.textContent = '明白，开始潜入';
    }
    rulesModal.hidden = false;
    rulesModal.inert = false;
    rulesModal.setAttribute('aria-hidden', 'false');
    rulesModal.classList.add('show');
    setTimeout(function () { if (rulesConfirmBtn.focus) rulesConfirmBtn.focus(); }, 0);
  }
  function closeRules() {
    if (!rulesVisible()) return;
    var mode = rulesMode;
    rulesModal.classList.remove('show');
    rulesModal.setAttribute('aria-hidden', 'true');
    rulesModal.hidden = true;
    rulesModal.inert = true;
    rulesMode = null;
    if (mode === 'game') {
      paused = rulesWasPaused;
      if (!paused) {
        lastTs = 0;
        updateTension();
      }
    }
    if (rulesFocus && rulesFocus.focus) rulesFocus.focus();
    rulesFocus = null;
  }

  /* ================= 音效开关 ================= */
  var musicBtn = $('musicBtn'), soundBtn = $('soundBtn');
  var settings = { sound: true, music: true };
  function loadSettings() {
    try {
      var s = JSON.parse(localStorage.getItem('alley-heist.settings.v1') || 'null');
      if (s) {
        if (typeof s.sound === 'boolean') settings.sound = s.sound;
        if (typeof s.bgm === 'boolean') settings.music = s.bgm;
        else if (typeof s.music === 'boolean') settings.music = s.music;
      }
    } catch (e) { /* 静默 */ }
  }
  function saveSettings() {
    try { localStorage.setItem('alley-heist.settings.v1', JSON.stringify({ sound: settings.sound, bgm: settings.music })); } catch (e) { /* 静默 */ }
  }
  function refreshBtns() {
    musicBtn.textContent = settings.music ? '♪' : '';
    soundBtn.textContent = settings.sound ? '♫' : '';
  }
  loadSettings();
  if (A && A.init) {
    A.init();
    if (A.setSound) A.setSound(settings.sound);
    if (A.setMusic) A.setMusic(settings.music);
  }
  refreshBtns();
  musicBtn.addEventListener('click', function () {
    settings.music = !settings.music;
    if (A) {
      if (A.setMusic) A.setMusic(settings.music);
      else settings.music ? A.startMusic() : A.stopMusic();
    }
    saveSettings(); refreshBtns();
  });
  soundBtn.addEventListener('click', function () {
    settings.sound = !settings.sound;
    if (A) A.setSound(settings.sound);
    saveSettings(); refreshBtns();
  });

  /* ================= 关卡控制 ================= */
  function clearKeys() {
    keys.up = keys.down = keys.left = keys.right = keys.sprint = false;
    touchKeys.up = touchKeys.down = touchKeys.left = touchKeys.right = false;
    touchSprint = false;
    interactQueued = false;
    dirOrder.length = 0;
  }

  function startLevel(idx) {
    if (rulesVisible()) closeRules();
    S = E.newGame(idx);
    running = true; paused = false;
    lastTs = 0; transition = 0;
    clearKeys();
    waves.length = 0;
    heardHintShown = false; lastHeardCue = -10;
    lastCellKey = S.player.r + ',' + S.player.c;
    renderErrorLogged = false;
    hudLevel.textContent = String(idx + 1);
    hudTime.textContent = '0:00';
    hudPhase.textContent = '潜入';
    hudPhase.classList.remove('escape');
    hudKey.textContent = '取钥匙';
    hudStatus.textContent = '隐蔽';
    hudStatus.classList.remove('hud-status-warn', 'hud-status-chase');
    dangerOverlay.classList.remove('on');
    pauseHint.classList.remove('show');
    showScreen(runScreen);
    var lv = E.LEVELS[idx];
    if (lv && lv.hint) showToast(lv.hint);
    if (A) {
      A.unlock();
      if (settings.music) A.startMusic();
      A.setTension(0);
    }
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
  }

  function finishGame() {
    if (!S || !S.done || S._finished) return;
    S._finished = true;
    running = false;
    cancelAnimationFrame(rafId);
    if (A) { A.stopMusic(); A.setTension(0); }
    var idx = S.idx;
    statTime.textContent = fmtTime(S.time);
    statDetections.textContent = String(S.player.preKeyDetections);
    if (S.result === 'win') {
      var st = starsFor(S);
      recordResult(idx, st, S.time, S.player.preKeyDetections);
      overTitle.textContent = '潜入成功';
      overSub.textContent = '你从' + S.name.split('·')[0].trim() + '全身而退';
      statStars.textContent = '★'.repeat(st) + '☆'.repeat(3 - st);
      var hasNext = idx + 1 < E.LEVELS.length;
      $('nextBtn').style.display = hasNext ? '' : 'none';
      if (A && A.sfx) setTimeout(function () { if (A && A.sfx) A.sfx.goal(); }, 200);
    } else {
      overTitle.textContent = '被逮住了';
      overSub.textContent = '守卫记住了你的样子——再试一次';
      statStars.textContent = '—';
      $('nextBtn').style.display = 'none';
      if (A && A.sfx) setTimeout(function () { if (A && A.sfx) A.sfx.lose(); }, 200);
    }
    showScreen(overScreen);
  }

  function fmtTime(sec) {
    var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  /* ================= 事件处理 =================
   * 同一帧同类型事件只处理一次（heard 一帧多守卫只响一次）；
   * UI（toast/overlay）不依赖 Audio 是否存在。 */
  function handleEvents(evs) {
    if (!evs || !evs.length) return;
    var seen = {};
    for (var i = 0; i < evs.length; i++) {
      var e = evs[i];
      if (seen[e.type]) continue;
      seen[e.type] = true;
      var sfx = A && A.sfx;
      switch (e.type) {
        case 'noticed':
          if (sfx) sfx.noticed();
          break;
        case 'heard':
          if (S.time - lastHeardCue > 0.65) {
            if (sfx) sfx.heard();
            lastHeardCue = S.time;
          }
          if (!heardHintShown) {
            heardHintShown = true;
            showToast('声圈碰到守卫，它会去声音位置调查');
          }
          break;
        case 'spotted':
          if (sfx) sfx.spotted();
          showToast('被看见了——快甩开视线');
          break;
        case 'key':
          if (sfx) sfx.key();
          showToast('钥匙到手，出口已开');
          break;
        case 'alarm':
          if (!seen.key) showToast('警报响起——守卫赶往钥匙处');
          break;
        case 'switch':
          if (sfx) sfx.switch();
          break;
        case 'gateOpen':
          if (sfx) sfx.gateOpen();
          showToast('卷帘门开了——巨响引来守卫');
          break;
        case 'lost':
          if (sfx) sfx.lost();
          break;
        case 'calm':
          break; // 状态由 HUD 每帧反映
        case 'lockedExit':
          showToast('出口还锁着——先取钥匙');
          break;
        case 'caught':
          if (sfx) sfx.caught();
          transition = 1;
          break;
        case 'goal':
          break; // 结算流程处理
      }
    }
  }

  /* ================= 主循环 ================= */
  function loop(ts) {
    if (!running) return;
    if (!lastTs) lastTs = ts;
    var dt = Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;
    if (!paused) {
      var act = buildActions();
      var evs = E.update(S, act, dt);
      consumePulses();
      updateWaves(dt);
      playMoveSfx(S.player);
      handleEvents(evs);
      updateHud();
      updateTension();
      if (transition > 0) transition = Math.max(0, transition - dt * 1.6);
      if (S.done) { finishGame(); return; }
      safeRender();
    } else {
      safeRender();
    }
    rafId = requestAnimationFrame(loop);
  }

  function buildActions() {
    var act = {
      up: keys.up || touchKeys.up,
      down: keys.down || touchKeys.down,
      left: keys.left || touchKeys.left,
      right: keys.right || touchKeys.right,
      sprint: !!(keys.sprint || touchSprint),
      interact: !!interactQueued,
      lastDir: lastDirKey() || null
    };
    interactQueued = false;
    return act;
  }

  /* 脚步音：按完成格数驱动，节奏匹配速度；不借用 engine 的 heard */
  function playMoveSfx(p) {
    if (!A || !A.sfx) return;
    if (p.caught || S.done) return;
    var ck = p.r + ',' + p.c;
    if (ck === lastCellKey) return;
    lastCellKey = ck;
    if (p.running) A.sfx.run(); else A.sfx.step();
  }

  /* 读取本帧声脉冲（冲刺完成一格 / 开关巨响），加入扩散声圈 */
  function consumePulses() {
    if (S._sprintPulse) {
      addWave(S._sprintPulse.r, S._sprintPulse.c, {
        maxR: 44, speed: 95, alpha: 0.5, fade: 0.55,
        color: 'rgba(232,184,75,1)', width: 2.5
      });
    }
    if (S._loudPulse) {
      addWave(S._loudPulse.r, S._loudPulse.c, {
        maxR: 110, speed: 160, alpha: 0.65, fade: 0.4,
        color: 'rgba(239,68,68,1)', width: 4
      });
    }
  }
  function addWave(r, c, o) {
    waves.push({
      x: c * PX + PX / 2, y: r * PX + PX / 2,
      r: 4, maxR: o.maxR, speed: o.speed,
      alpha: o.alpha, fade: o.fade, color: o.color, width: o.width
    });
  }
  function updateWaves(dt) {
    for (var i = waves.length - 1; i >= 0; i--) {
      var w = waves[i];
      w.r += w.speed * dt;
      w.alpha = Math.max(0, w.alpha - w.fade * dt);
      if (w.r >= w.maxR || w.alpha <= 0) waves.splice(i, 1);
    }
  }

  /* HUD 每帧：阶段 / 钥匙目标 / 守卫状态 / 追捕警示 */
  function hasChase() {
    for (var i = 0; i < S.guards.length; i++) {
      if (S.guards[i].state === 'chase') return true;
    }
    return false;
  }
  function statusText() {
    var chase = false, notice = false, invest = false, hunt = false, search = false, active = false;
    for (var i = 0; i < S.guards.length; i++) {
      var g = S.guards[i];
      if (g.state === 'chase') chase = true;
      else if (g.state === 'investigate') invest = true;
      else if (g.state === 'hunt') hunt = true;
      else if (g.state === 'search') search = true;
      if (g.notice > 0) notice = true;
      if (g.state === 'patrol' || g.state === 'return') active = true;
    }
    if (chase) return { text: '追捕', cls: 'chase' };
    if (notice) return { text: '正在确认', cls: 'warn' };
    if (invest) return { text: '调查声响', cls: 'warn' };
    if (hunt) return { text: '警报搜索', cls: 'warn' };
    if (search) return { text: '搜索中', cls: 'warn' };
    if (active && S.phase === 'escape') return { text: '封锁巡逻', cls: '' };
    return { text: '隐蔽', cls: '' };
  }
  function updateHud() {
    hudLevel.textContent = String(S.idx + 1);
    hudTime.textContent = fmtTime(S.time);
    if (S.phase === 'escape') {
      hudPhase.textContent = '撤离';
      hudPhase.classList.add('escape');
    } else {
      hudPhase.textContent = '潜入';
      hudPhase.classList.remove('escape');
    }
    hudKey.textContent = S.key.got ? '去出口' : '取钥匙';
    var st = statusText();
    hudStatus.textContent = st.text;
    hudStatus.classList.toggle('hud-status-warn', st.cls === 'warn');
    hudStatus.classList.toggle('hud-status-chase', st.cls === 'chase');
    var chase = hasChase();
    dangerOverlay.classList.toggle('on', chase);
    if (chase) dangerText.textContent = '追捕中 · 转角断线';
  }

  /* BGM tension：有 chase=2；否则 escape 或 investigate/hunt/search=1；普通潜入=0 */
  function updateTension() {
    if (!A || !A.setTension) return;
    if (S.done) { A.setTension(0); return; }
    var t = 0, chase = false, alert = false;
    for (var i = 0; i < S.guards.length; i++) {
      var g = S.guards[i];
      if (g.state === 'chase') chase = true;
      else if (g.state === 'investigate' || g.state === 'hunt' || g.state === 'search') alert = true;
    }
    if (chase) t = 2;
    else if (alert || S.phase === 'escape') t = 1;
    A.setTension(t);
  }

  /* ================= 输入 ================= */
  function pushDir(d) {
    var i = dirOrder.indexOf(d);
    if (i !== -1) dirOrder.splice(i, 1);
    dirOrder.push(d);
  }
  function popDir(d) {
    var i = dirOrder.indexOf(d);
    if (i !== -1) dirOrder.splice(i, 1);
  }
  function lastDirKey() {
    return dirOrder.length ? dirOrder[dirOrder.length - 1] : null;
  }

  function keyDown(e) {
    var k = e.key;
    if (rulesVisible()) {
      if (k === 'Escape') { e.preventDefault(); closeRules(); }
      return;
    }
    if (k === 'p' || k === 'P' || k === 'Escape') {
      if (running && S && !S.done) { e.preventDefault(); togglePause(); }
      return;
    }
    if (!running || paused || (S && S.done)) return;
    if (k === 'ArrowUp' || k === 'w' || k === 'W') { e.preventDefault(); keys.up = true; pushDir('up'); }
    else if (k === 'ArrowDown' || k === 's' || k === 'S') { e.preventDefault(); keys.down = true; pushDir('down'); }
    else if (k === 'ArrowLeft' || k === 'a' || k === 'A') { e.preventDefault(); keys.left = true; pushDir('left'); }
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') { e.preventDefault(); keys.right = true; pushDir('right'); }
    else if (k === 'Shift' || k === 'Control') { keys.sprint = true; }
    else if (k === 'e' || k === 'E') { interactQueued = true; }
  }
  function keyUp(e) {
    var k = e.key;
    if (k === 'ArrowUp' || k === 'w' || k === 'W') { keys.up = false; popDir('up'); }
    else if (k === 'ArrowDown' || k === 's' || k === 'S') { keys.down = false; popDir('down'); }
    else if (k === 'ArrowLeft' || k === 'a' || k === 'A') { keys.left = false; popDir('left'); }
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') { keys.right = false; popDir('right'); }
    else if (k === 'Shift' || k === 'Control') { keys.sprint = false; }
  }
  window.addEventListener('keydown', keyDown);
  window.addEventListener('keyup', keyUp);
  window.addEventListener('blur', function () {
    if (!rulesVisible() && running && !paused && S && !S.done) togglePause();
  });

  /* 触屏：方向按住、sprint 按住激活、interact 点按 */
  (function () {
    var dirs = { tzUp: 'up', tzLeft: 'left', tzDown: 'down', tzRight: 'right' };
    Object.keys(dirs).forEach(function (id) {
      var btn = $(id);
      var d = dirs[id];
      btn.addEventListener('pointerdown', function (e) { e.preventDefault(); touchKeys[d] = true; pushDir(d); });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (t) {
        btn.addEventListener(t, function () { touchKeys[d] = false; popDir(d); });
      });
      btn.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    });
    var sprintBtn = $('tzSprint');
    sprintBtn.addEventListener('pointerdown', function (e) {
      e.preventDefault(); touchSprint = true;
      sprintBtn.classList.add('active');
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (t) {
      sprintBtn.addEventListener(t, function () {
        touchSprint = false;
        sprintBtn.classList.remove('active');
      });
    });
    var interactBtn = $('tzInteract');
    interactBtn.addEventListener('pointerdown', function (e) { e.preventDefault(); interactQueued = true; });
    interactBtn.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  })();

  function togglePause() {
    if (rulesVisible() || !running || (S && S.done)) return;
    paused = !paused;
    pauseHint.classList.toggle('show', paused);
    if (A && paused) A.setTension(0);
    if (!paused) { lastTs = 0; cancelAnimationFrame(rafId); rafId = requestAnimationFrame(loop); }
  }
  $('pauseBtn').addEventListener('click', togglePause);
  $('resumeBtn').addEventListener('click', togglePause);
  $('quitBtn').addEventListener('click', function () {
    running = false; paused = false;
    cancelAnimationFrame(rafId);
    if (A) { A.stopMusic(); A.setTension(0); }
    pauseHint.classList.remove('show');
    clearKeys();
    showScreen(startScreen);
  });

  $('startBtn').addEventListener('click', function () {
    if (A) A.unlock();
    openRules('start');
  });
  rulesBtn.addEventListener('click', function () {
    if (running && S && !S.done) openRules('game');
  });
  rulesCloseBtn.addEventListener('click', closeRules);
  rulesConfirmBtn.addEventListener('click', function () {
    var mode = rulesMode;
    var level = pendingLevel;
    closeRules();
    if (mode === 'start') startLevel(level);
  });
  rulesModal.addEventListener('click', function (e) {
    if (e.target === rulesModal) closeRules();
  });
  $('againBtn').addEventListener('click', function () { startLevel(S ? S.idx : 0); });
  $('nextBtn').addEventListener('click', function () {
    if (S && S.idx + 1 < E.LEVELS.length) startLevel(S.idx + 1);
  });
  $('homeBtn').addEventListener('click', function () {
    window.location.href = '../action-games/index.html';
  });

  /* ================= 关卡选择 ================= */
  function buildLevelSelect() {
    levelSelect.innerHTML = '';
    var p = loadProgress();
    var highest = getFirstUnlocked();
    E.LEVELS.forEach(function (lv, i) {
      var btn = document.createElement('button');
      btn.type = 'button';
      var rec = p.lv['l' + (i + 1)];
      var unlocked = levelUnlocked(i);
      var cls = ['lv-btn'];
      if (rec && (rec.stars > 0 || rec.unlocked)) cls.push('done');
      if (i === highest) cls.push('current');
      if (!unlocked) cls.push('locked');
      btn.className = cls.join(' ');
      btn.textContent = (rec && rec.stars ? '★'.repeat(rec.stars) : '') + ' ' + (i + 1) + '·' + lv.name.split('·')[0].trim();
      btn.disabled = !unlocked;
      btn.addEventListener('click', (function (j) { return function () { startLevel(j); }; })(i));
      levelSelect.appendChild(btn);
    });
  }

  /* ================= Toast ================= */
  function showToast(msg) {
    hintToast.textContent = msg;
    hintToast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { hintToast.classList.remove('show'); }, 2600);
  }

  /* ================= 渲染 ================= */
  function themeOf() { return document.body.dataset.theme || '4399'; }
  function cssVar(name, dflt) {
    var v = getComputedStyle(document.body).getPropertyValue(name).trim();
    return v || dflt;
  }
  function safeRender() {
    try { render(); } catch (e) {
      if (!renderErrorLogged) {
        console.error('[alley-heist] render error:', e);
        renderErrorLogged = true;
      }
    }
  }

  function render() {
    var t = themeOf();
    var isArcade = t === 'arcade';
    var bg1 = cssVar('--bg', '#0d1510');
    var bg2 = cssVar('--bg2', '#191712');
    var wall = isArcade ? '#150b2a' : '#3a2d1f';
    var road = bg2;
    var roadLine = cssVar('--line', 'rgba(232,160,106,.25)');
    var gold = cssVar('--gold', '#e8b84b');

    ctx.fillStyle = bg1;
    ctx.fillRect(0, 0, W, H);

    var panX = Math.max(0, Math.min(PX * S.w - W, PX * S.player.pc - W / 2 + PX / 2));
    var panY = Math.max(0, Math.min(PX * S.h - H, PX * S.player.pr - H / 2 + PX / 2));

    ctx.save();
    ctx.translate(-panX, -panY);

    drawFloor(wall, road, roadLine);
    drawGates();
    drawSwitch(gold);
    drawExit(gold);
    drawKeyItem(gold);
    drawVision();
    drawClues();
    drawGuards();
    drawPlayer();
    drawWaves();

    ctx.restore();

    drawCompass();
    if (transition > 0) {
      ctx.fillStyle = 'rgba(180,30,30,' + transition * 0.5 + ')';
      ctx.fillRect(0, 0, W, H);
    }
  }

  function drawFloor(wall, road, roadLine) {
    for (var r = 0; r < S.h; r++) {
      for (var c = 0; c < S.w; c++) {
        var x = c * PX, y = r * PX;
        if (S.solid[r + ',' + c]) {
          ctx.fillStyle = wall;
          ctx.fillRect(x, y, PX, PX);
          ctx.strokeStyle = 'rgba(0,0,0,.35)';
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, PX - 1, PX - 1);
        } else {
          ctx.fillStyle = road;
          ctx.fillRect(x, y, PX, PX);
          ctx.strokeStyle = roadLine;
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, PX - 1, PX - 1);
        }
      }
    }
  }

  /* 卷帘门：关闭=金属帘片；开启=地面轨道 */
  function drawGates() {
    for (var i = 0; i < S.gates.length; i++) {
      var g = S.gates[i];
      var x = g.c * PX, y = g.r * PX;
      if (E.isSolid(S, g.r, g.c)) {
        ctx.fillStyle = '#3f4756';
        ctx.fillRect(x, y, PX, PX);
        ctx.strokeStyle = 'rgba(255,255,255,.12)';
        ctx.lineWidth = 1;
        for (var yy = y + 7; yy < y + PX; yy += 9) {
          ctx.beginPath();
          ctx.moveTo(x + 2, yy); ctx.lineTo(x + PX - 2, yy);
          ctx.stroke();
        }
        ctx.fillStyle = 'rgba(255,255,255,.14)';
        ctx.fillRect(x, y, 3, PX);
        ctx.fillStyle = 'rgba(0,0,0,.28)';
        ctx.fillRect(x + PX - 3, y, 3, PX);
        ctx.fillStyle = '#9aa3b2';
        ctx.fillRect(x, y, PX, 5);
      } else {
        ctx.fillStyle = 'rgba(148,163,184,.06)';
        ctx.fillRect(x, y, PX, PX);
        ctx.strokeStyle = 'rgba(148,163,184,.4)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + 7, y + 3); ctx.lineTo(x + 7, y + PX - 3);
        ctx.moveTo(x + PX - 7, y + 3); ctx.lineTo(x + PX - 7, y + PX - 3);
        ctx.stroke();
      }
    }
  }

  /* 开关：站上未用显示 E 提示 */
  function drawSwitch(gold) {
    if (!S.switch) return;
    var sx = S.switch.c * PX + PX / 2, sy = S.switch.r * PX + PX / 2;
    var used = S.switch.used;
    ctx.fillStyle = used ? 'rgba(100,116,139,.22)' : 'rgba(52,211,153,.16)';
    ctx.fillRect(sx - 16, sy - 16, 32, 32);
    ctx.strokeStyle = used ? '#64748b' : '#34d399';
    ctx.lineWidth = 2;
    ctx.strokeRect(sx - 16, sy - 16, 32, 32);
    ctx.fillStyle = used ? '#64748b' : '#34d399';
    ctx.beginPath();
    ctx.arc(sx, sy, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.3)';
    ctx.lineWidth = 1;
    ctx.stroke();
    if (!used && S.player.r === S.switch.r && S.player.c === S.switch.c) {
      drawEHint(sx, sy - 26);
    }
  }
  function drawEHint(cx, cy) {
    ctx.save();
    ctx.globalAlpha = 0.75 + 0.25 * Math.sin(S.time * 5);
    ctx.fillStyle = 'rgba(15,20,25,.82)';
    ctx.strokeStyle = 'rgba(52,211,153,.95)';
    ctx.lineWidth = 2;
    roundRectPath(cx - 13, cy - 15, 26, 26, 7);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#34d399';
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('E', cx, cy - 1);
    ctx.restore();
  }

  /* 出口：取钥匙前挂锁；取钥匙后高亮 + 脉冲环 */
  function drawExit(gold) {
    var ex = S.exit.c * PX + PX / 2, ey = S.exit.r * PX + PX / 2;
    var open = S.key.got;
    if (open) {
      ctx.fillStyle = 'rgba(52,211,153,.2)';
      ctx.fillRect(ex - 18, ey - 18, 36, 36);
      ctx.strokeStyle = '#34d399';
      ctx.lineWidth = 2;
      ctx.strokeRect(ex - 18, ey - 18, 36, 36);
      var pr = 16 + 5 * Math.sin(S.time * 3);
      ctx.strokeStyle = 'rgba(52,211,153,.55)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(ex, ey, pr, 0, Math.PI * 2);
      ctx.stroke();
      drawDoorChevron(ex, ey, exitOutDir(), '#a7f3d0');
    } else {
      ctx.fillStyle = 'rgba(100,116,139,.16)';
      ctx.fillRect(ex - 16, ey - 16, 32, 32);
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 2;
      ctx.strokeRect(ex - 16, ey - 16, 32, 32);
      drawPadlock(ex, ey);
    }
  }
  function exitOutDir() {
    if (S.exit.c === 0) return Math.PI;
    if (S.exit.c === S.w - 1) return 0;
    if (S.exit.r === 0) return -Math.PI / 2;
    return Math.PI / 2;
  }
  function drawPadlock(cx, cy) {
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy - 4, 6, Math.PI, 0);
    ctx.stroke();
    ctx.fillStyle = '#cbd5e1';
    ctx.fillRect(cx - 7, cy - 4, 14, 11);
    ctx.fillStyle = 'rgba(15,23,42,.7)';
    ctx.beginPath();
    ctx.arc(cx, cy + 1, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  function drawDoorChevron(cx, cy, ang, color) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(6, -6);
    ctx.lineTo(6, 6);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(6, 0);
    ctx.lineTo(-1, -6);
    ctx.lineTo(-1, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /* 钥匙：Canvas 几何图形（圆环 + 柄身 + 齿），不用 emoji */
  function drawKeyItem(gold) {
    if (S.key.got) return;
    var kx = S.key.c * PX + PX / 2;
    var ky = S.key.r * PX + PX / 2 + Math.sin(S.time * 2.6) * 2;
    ctx.save();
    ctx.translate(kx, ky);
    ctx.rotate(-Math.PI / 4);
    ctx.shadowColor = gold;
    ctx.shadowBlur = 14;
    ctx.fillStyle = gold;
    ctx.strokeStyle = 'rgba(60,40,0,.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(-7, 0, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(60,40,0,.55)';
    ctx.beginPath();
    ctx.arc(-7, 0, 2.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = gold;
    ctx.fillRect(-2, -2.5, 16, 5);
    ctx.fillRect(12, 1, 3, 5);
    ctx.fillRect(9, 1, 3, 3.5);
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  /* 视锥：与逻辑一致——对固定视距内逐格 canSee 画半透明可见格 */
  function visionColor(g) {
    if (g.state === 'chase') return 'rgba(239,68,68,.2)';
    if (g.state === 'hunt') return 'rgba(217,70,239,.14)';
    if (g.state === 'investigate') return 'rgba(234,88,12,.16)';
    if (g.state === 'search') return 'rgba(148,163,184,.14)';
    if (g.notice > 0) return 'rgba(245,158,11,.16)';
    return 'rgba(250,204,21,.09)';
  }
  function drawVision() {
    var R = cfg.fovDist;
    for (var gi = 0; gi < S.guards.length; gi++) {
      var g = S.guards[gi];
      var col = visionColor(g);
      for (var rr = g.r - R; rr <= g.r + R; rr++) {
        for (var cc = g.c - R; cc <= g.c + R; cc++) {
          if (rr < 0 || cc < 0 || rr >= S.h || cc >= S.w) continue;
          if (E.isSolid(S, rr, cc)) continue;
          if (!E.canSee(S, g, rr, cc)) continue;
          ctx.fillStyle = col;
          ctx.fillRect(cc * PX, rr * PX, PX, PX);
        }
      }
    }
  }

  /* 守卫掌握的线索：调查点 / 猎捕点 / 最后看见位置 */
  function drawClues() {
    for (var i = 0; i < S.guards.length; i++) {
      var g = S.guards[i];
      var target = null, color = null;
      if (g.state === 'investigate' && g.tgt) { target = g.tgt; color = 'rgba(245,158,11,.85)'; }
      else if (g.state === 'hunt' && g.huntTarget) { target = g.huntTarget; color = 'rgba(217,70,239,.85)'; }
      else if ((g.state === 'chase' || g.state === 'search') && g.lastSeen) { target = g.lastSeen; color = 'rgba(239,68,68,.85)'; }
      if (target) {
        var cx = target.c * PX + PX / 2, cy = target.r * PX + PX / 2;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        if (ctx.setLineDash) ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(cx, cy, 13, 0, Math.PI * 2);
        ctx.stroke();
        if (ctx.setLineDash) ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(cx - 7, cy); ctx.lineTo(cx + 7, cy);
        ctx.moveTo(cx, cy - 7); ctx.lineTo(cx, cy + 7);
        ctx.stroke();
      }
      if (g.state === 'chase' && g.lastHeard &&
          (!g.lastSeen || g.lastHeard.r !== g.lastSeen.r || g.lastHeard.c !== g.lastSeen.c)) {
        var hx = g.lastHeard.c * PX + PX / 2, hy = g.lastHeard.r * PX + PX / 2;
        ctx.strokeStyle = 'rgba(148,163,184,.5)';
        ctx.lineWidth = 1.5;
        if (ctx.setLineDash) ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.arc(hx, hy, 11, 0, Math.PI * 2);
        ctx.stroke();
        if (ctx.setLineDash) ctx.setLineDash([]);
      }
    }
  }

  function guardColor(g) {
    if (g.state === 'chase') return '#dc2626';
    if (g.state === 'hunt') return '#c026d3';
    if (g.state === 'investigate') return '#ea580c';
    if (g.state === 'search') return '#64748b';
    if (g.notice > 0) return '#f59e0b';
    return '#c2410c';
  }
  function drawGuards() {
    for (var i = 0; i < S.guards.length; i++) {
      var g = S.guards[i];
      var gx = g.pc * PX + PX / 2, gy = g.pr * PX + PX / 2;
      var col = guardColor(g);
      ctx.save();
      ctx.translate(gx, gy);
      ctx.fillStyle = col;
      ctx.strokeStyle = '#fca5a5';
      ctx.lineWidth = 1.5;
      ctx.shadowColor = '#ef4444';
      ctx.shadowBlur = g.state === 'chase' ? 18 : (g.state === 'hunt' ? 14 : 8);
      ctx.beginPath();
      ctx.arc(0, 0, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.rotate(g.dir);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(9, 0, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.restore();
      // notice 确认进度弧
      if (g.notice > 0) {
        var frac = Math.min(1, g.notice / cfg.noticeTime);
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(gx, gy, 17, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
        ctx.stroke();
      }
      // 状态标记
      var mark = null, markCol = '#fff';
      if (g.state === 'chase') { mark = '!!'; markCol = '#fecaca'; }
      else if (g.state === 'investigate' || g.state === 'search') { mark = '?'; markCol = '#e2e8f0'; }
      else if (g.notice > 0) { mark = '!'; markCol = '#fde68a'; }
      if (mark) {
        ctx.fillStyle = markCol;
        ctx.font = 'bold 13px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(mark, gx, gy - 24);
      }
      // 猎犬 H 标识
      if (g.hound) {
        ctx.fillStyle = 'rgba(15,23,42,.85)';
        roundRectPath(gx + 11, gy - 23, 17, 17, 4);
        ctx.fill();
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = '#e2e8f0';
        ctx.font = 'bold 11px sans-serif';
        ctx.fillText('H', gx + 19.5, gy - 14.5);
      }
    }
  }

  function drawPlayer() {
    var p = S.player;
    var pcx = p.pc * PX + PX / 2, pcy = p.pr * PX + PX / 2;
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.beginPath();
    if (ctx.ellipse) {
      ctx.ellipse(pcx, pcy + 10, 13, 5, 0, 0, Math.PI * 2);
    } else {
      ctx.arc(pcx, pcy + 10, 9, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.save();
    ctx.translate(pcx, pcy);
    ctx.rotate(p.dir);
    ctx.fillStyle = '#38bdf8';
    ctx.strokeStyle = '#bae6fd';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = '#38bdf8';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(0, 0, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#e0f2fe';
    ctx.beginPath();
    ctx.arc(8, 0, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
    if (p.sprinting) {
      ctx.fillStyle = '#7dd3fc';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('冲刺', pcx, pcy - 24);
    }
  }

  function drawWaves() {
    for (var i = 0; i < waves.length; i++) {
      var w = waves[i];
      ctx.globalAlpha = w.alpha;
      ctx.strokeStyle = w.color;
      ctx.lineWidth = w.width;
      ctx.beginPath();
      ctx.arc(w.x, w.y, w.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /* 取钥匙后持久显示出口方向罗盘（画布角落） */
  function drawCompass() {
    if (!S.key.got) return;
    var p = S.player;
    var ang = Math.atan2(S.exit.r - p.pr, S.exit.c - p.pc);
    var cx = W - 38, cy = 38;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = 'rgba(52,211,153,.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, 13, 0, Math.PI * 2);
    ctx.stroke();
    ctx.rotate(ang);
    ctx.fillStyle = '#34d399';
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(-5, -6);
    ctx.lineTo(-2, 0);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function roundRectPath(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ================= 初始化 ================= */
  (function () {
    var loader = $('loader');
    function hide() { if (loader) loader.classList.add('done'); }
    window.addEventListener('load', function () { setTimeout(hide, 120); });
    setTimeout(hide, 1300);
  })();

  function init() {
    applyTheme((function () { try { return localStorage.getItem('gh-theme') === 'arcade' ? 'arcade' : '4399'; } catch (e) { return '4399'; } })(), false);
    buildLevelSelect();
    showScreen(startScreen);
    // 预渲染开始屏背景（缩略迷宫）
    S = E.newGame(0);
    safeRender();
  }
  init();
})();
