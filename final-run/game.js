/* =====================================================================
 * game.js —— 《终局狂奔》主流程：Canvas 渲染 / 键鼠与触屏输入 /
 * HUD 状态 / 三屏切换 / 结算与 Top5 排行榜。
 * 依赖：engine.js(FinalRunEngine) / audio.js(FinalRunAudio)。
 * ===================================================================== */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  /* ---------------- 模块引用 ---------------- */
  var E = window.FinalRunEngine;
  var A = window.FinalRunAudio;
  var cfg = E.cfg;

  var canvas = $('gameCanvas');
  var ctx = canvas.getContext('2d');

  var startScreen = $('startScreen'), runScreen = $('runScreen'), overScreen = $('overScreen');
  var hudDist = $('hudDist'), hudCombo = $('hudCombo'), hudScore = $('hudScore'), hudShieldN = $('hudShieldN');
  var dangerOverlay = $('dangerOverlay'), dangerText = $('dangerText');
  var tierToast = $('tierToast'), pauseHint = $('pauseHint');
  var statDist = $('statDist'), statCombo = $('statCombo'), statNear = $('statNear'), statTime = $('statTime');
  var rankList = $('rankList'), overTitle = $('overTitle'), overSub = $('overSub');

  /* ---------------- 状态 ---------------- */
  var S = null;          // 引擎状态
  var running = false;   // 引擎是否在跑
  var paused = false;
  var rafId = 0;
  var lastTs = 0;
  var keys = {};
  var pendingAction = { jump: false, slide: false, drop: false };
  var elapsed = 0;       // 存活秒数（用于结算）

  var bgScroll = 0;      // 背景视差偏移
  var dangerTimer = 0;

  /* ---------------- 主题 ---------------- */
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

  /* ---------------- 音效开关 ---------------- */
  var musicBtn = $('musicBtn'), soundBtn = $('soundBtn');
  var settings = { sound: true, music: true };
  function loadSettings() {
    try {
      var s = JSON.parse(localStorage.getItem('final-run.settings.v1') || 'null');
      if (s) {
        if (typeof s.sound === 'boolean') settings.sound = s.sound;
        if (typeof s.music === 'boolean') settings.music = s.music;
      }
    } catch (e) { /* 静默 */ }
  }
  function saveSettings() {
    try { localStorage.setItem('final-run.settings.v1', JSON.stringify(settings)); } catch (e) { /* 静默 */ }
  }
  function syncAudioButtons() {
    musicBtn.textContent = '♪';
    soundBtn.textContent = '♫';
    musicBtn.classList.toggle('off', !settings.music);
    soundBtn.classList.toggle('off', !settings.sound);
    musicBtn.setAttribute('aria-pressed', String(settings.music));
    soundBtn.setAttribute('aria-pressed', String(settings.sound));
    musicBtn.title = settings.music ? '关闭音乐' : '开启音乐';
    soundBtn.title = settings.sound ? '关闭音效' : '开启音效';
  }
  loadSettings();
  A.init();
  syncAudioButtons();
  musicBtn.addEventListener('click', function () {
    settings.music = !settings.music;
    A.setMusic(settings.music);
    syncAudioButtons();
    saveSettings();
  });
  soundBtn.addEventListener('click', function () {
    settings.sound = !settings.sound;
    A.setSound(settings.sound);
    syncAudioButtons();
    saveSettings();
  });

  /* ---------------- 音效播放（事件 → 声音） ---------------- */
  function playEvent(ev) {
    if (!A || !A.sfx || !A.sfx[ev.type]) return;
    if (ev.type === 'jump') A.sfx.jump(ev.dbl);
    else A.sfx[ev.type]();
  }

  /* ---------------- 屏幕切换 ---------------- */
  function showScreen(scr) {
    [startScreen, runScreen, overScreen].forEach(function (s) {
      s.classList.toggle('active', s === scr);
      s.setAttribute('aria-hidden', s === scr ? 'false' : 'true');
    });
  }

  /* ---------------- 开始 ---------------- */
  function startGame() {
    S = E.newGame();
    running = true; paused = false;
    elapsed = 0; bgScroll = 0;
    keys = {}; pendingAction = { jump: false, slide: false, drop: false };
    clearTimeout(dangerTimer);
    dangerOverlay.classList.remove('on');
    tierToast.classList.remove('show');
    pauseHint.classList.remove('show');
    hudShieldN.textContent = '0';
    showScreen(runScreen);
    A.unlock();
    A.startMusic();
    A.setTension(0);
    lastTs = 0;
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
  }

  /* ---------------- 结算 ---------------- */
  var TOP_KEY = 'final-run.top5.v1';
  function loadTop() {
    try { return JSON.parse(localStorage.getItem(TOP_KEY) || '[]'); } catch (e) { return []; }
  }
  function saveTop(list) {
    try { localStorage.setItem(TOP_KEY, JSON.stringify(list)); } catch (e) { /* 静默 */ }
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmtTime(sec) {
    var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return pad(m) + ':' + pad(s);
  }
  function submitScore() {
    var list = loadTop();
    list.push({
      dist: Math.round(S.dist),
      combo: S.bestCombo,
      near: S.nearMiss,
      time: Math.round(elapsed),
      date: new Date().toISOString().slice(0, 10)
    });
    list.sort(function (a, b) { return b.dist - a.dist; });
    list = list.slice(0, 5);
    saveTop(list);
    return list;
  }
  function renderRank(list) {
    rankList.innerHTML = '';
    if (!list.length) {
      var li = document.createElement('li');
      li.textContent = '暂无记录 —— 跑出你的第一个终局';
      rankList.appendChild(li);
      return;
    }
    list.forEach(function (r, i) {
      var li = document.createElement('li');
      var sc = document.createElement('span');
      sc.className = 'rk-score';
      sc.textContent = r.dist + 'm';
      var dt = document.createElement('span');
      dt.className = 'rk-date';
      dt.textContent = '×' + r.combo + ' · ' + (r.date || '');
      li.textContent = (r.time > 0 ? fmtTime(r.time) : '—') + ' · ';
      li.appendChild(sc);
      li.appendChild(dt);
      rankList.appendChild(li);
    });
  }
  function finishGame() {
    if (!S || !S.gameOver || S._finished) return;
    S._finished = true;
    running = false;
    cancelAnimationFrame(rafId);
    clearTimeout(dangerTimer);
    A.stopMusic();
    A.setTension(0);
    if (S.over === 'caught') {
      overTitle.textContent = '被捕获';
      overSub.textContent = '暗影巨兽追上了你';
    } else {
      overTitle.textContent = '终局';
      overSub.textContent = '记录封存';
    }
    statDist.textContent = Math.round(S.dist);
    statCombo.textContent = S.bestCombo;
    statNear.textContent = S.nearMiss;
    statTime.textContent = fmtTime(elapsed);
    var list = submitScore();
    renderRank(list);
    setTimeout(function () { A.sfx.gameover(); }, 350);
    showScreen(overScreen);
  }

  /* ---------------- 输入 ---------------- */
  function keyDown(e) {
    if (!running || S.gameOver) return;
    var k = e.key;
    if (k === 'p' || k === 'P' || k === 'Escape') {
      e.preventDefault();
      togglePause();
      return;
    }
    if (paused) return;
    if (k === ' ' || k === 'ArrowUp' || k === 'w' || k === 'W') {
      e.preventDefault();
      if (!keys.up) pendingAction.jump = true;
      keys.up = true;
    } else if (k === 'ArrowDown' || k === 's' || k === 'S') {
      e.preventDefault();
      if (!keys.down) { pendingAction.slide = true; pendingAction.drop = true; }
      keys.down = true;
    }
  }
  function keyUp(e) {
    var k = e.key;
    if (k === ' ' || k === 'ArrowUp' || k === 'w' || k === 'W') keys.up = false;
    else if (k === 'ArrowDown' || k === 's' || k === 'S') keys.down = false;
  }
  window.addEventListener('keydown', keyDown);
  window.addEventListener('keyup', keyUp);
  window.addEventListener('blur', function () {
    if (running && !paused && !S.gameOver) togglePause();
  });

  /* 触屏：轻点/上滑=跳，下滑=滑铲 */
  (function () {
    var startY = 0, startX = 0, swiping = false;
    function onTouchStart(e) {
      if (!running || paused || S.gameOver) return;
      var t = e.changedTouches[0];
      startY = t.clientY; startX = t.clientX; swiping = true;
    }
    function onTouchMove(e) {
      if (!swiping || !running) return;
      var t = e.changedTouches[0];
      var dy = t.clientY - startY, dx = t.clientX - startX;
      if (Math.abs(dy) < 14 && Math.abs(dx) < 14) return;
      // 判定方向后锁死，避免连续触发
      if (dy < -14 && pendingAction.jump === false && touchSwallow('up')) {
        pendingAction.jump = true;
        swiping = false;
      } else if (dy > 14 && pendingAction.slide === false && touchSwallow('down')) {
        pendingAction.slide = true; pendingAction.drop = true;
        swiping = false;
      }
    }
    function touchSwallow(dir) {
      // 简单防抖：滑动后 180ms 内忽略同向新滑动
      if (lastGest[dir] && Date.now() - lastGest[dir] < 180) return false;
      lastGest[dir] = Date.now();
      return true;
    }
    var lastGest = { up: 0, down: 0 };
    function onTouchEnd() {
      if (swiping && running && !paused && !S.gameOver) pendingAction.jump = true;
      swiping = false;
    }
    canvas.addEventListener('touchstart', onTouchStart, { passive: true });
    canvas.addEventListener('touchmove', onTouchMove, { passive: true });
    canvas.addEventListener('touchend', onTouchEnd);
    /* 手柄按钮（粗指针设备） */
    document.querySelectorAll('.tz-jump').forEach(function (b) {
      b.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        if (running && !paused && !S.gameOver) pendingAction.jump = true;
      });
    });
    document.querySelectorAll('.tz-slide').forEach(function (b) {
      b.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        if (running && !paused && !S.gameOver) { pendingAction.slide = true; pendingAction.drop = true; }
      });
    });
  })();

  function togglePause() {
    if (!running || S.gameOver) return;
    paused = !paused;
    pauseHint.classList.toggle('show', paused);
    A.setTension(paused ? 0 : tensionNow());
    if (!paused) { lastTs = 0; cancelAnimationFrame(rafId); rafId = requestAnimationFrame(loop); }
  }
  $('resumeBtn').addEventListener('click', togglePause);
  $('startBtn').addEventListener('click', function () { A.unlock(); startGame(); });
  $('againBtn').addEventListener('click', startGame);
  $('homeBtn').addEventListener('click', function () {
    window.location.href = '../action-games/index.html';
  });

  /* ---------------- 主循环 ---------------- */
  function loop(ts) {
    if (!running) return;
    if (!lastTs) lastTs = ts;
    var dt = Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;
    if (!paused) {
      elapsed += dt;
      var evs = E.update(S, pendingAction, dt);
      pendingAction = { jump: false, slide: false, drop: false };
      for (var i = 0; i < evs.length; i++) {
        handleEvent(evs[i]);
        if (S.gameOver && evs[i].type === 'caught') break;
      }
      bgScroll = (bgScroll + S.speed * dt) % 220;
    }
    draw();
    if (running) rafId = requestAnimationFrame(loop);
  }

  function tensionNow() {
    if (!S || !S.chaser) return 0;
    if (S.chaser.gap < cfg.gapDanger) return 2;
    if (S.chaser.gap < cfg.gapDanger + 160) return 1;
    return 0;
  }

  function handleEvent(ev) {
    playEvent(ev);
    switch (ev.type) {
      case 'danger':
        clearTimeout(dangerTimer);
        dangerOverlay.classList.add('on');
        dangerText.textContent = '甩开它 · ' + (Math.ceil(ev.left * 10) / 10).toFixed(1) + 's';
        A.setTension(2);
        break;
      case 'chase':
        A.setTension(ev.burst ? Math.max(1, tensionNow()) : tensionNow());
        break;
      case 'escape':
        clearTimeout(dangerTimer);
        dangerOverlay.classList.remove('on');
        A.setTension(tensionNow());
        break;
      case 'tierUp':
        tierToast.textContent = '⚡ 难度提升 · LV ' + (ev.tier + 1);
        tierToast.classList.remove('show');
        void tierToast.offsetWidth; // 重启动画
        tierToast.classList.add('show');
        break;
      case 'hit':
        dangerOverlay.classList.add('on');
        dangerText.textContent = '被撞 · 快甩开！';
        A.setTension(2);
        clearTimeout(dangerTimer);
        dangerTimer = setTimeout(function () {
          if (!running || tensionNow() >= 2) return;
          dangerOverlay.classList.remove('on');
          A.setTension(tensionNow());
        }, 600);
        break;
      case 'caught':
        dangerOverlay.classList.add('on');
        finishGame();
        break;
      case 'magnet':
        tierToast.textContent = '🧲 磁石冲刺！';
        tierToast.classList.remove('show');
        void tierToast.offsetWidth;
        tierToast.classList.add('show');
        break;
      default:
        break;
    }
  }

  /* ---------------- 渲染 ---------------- */
  function themeOf() {
    return document.body.dataset.theme || '4399';
  }
  function draw() {
    var W = canvas.width, H = canvas.height;
    var t = themeOf();
    var css = getComputedStyle(document.body);
    var skyTop = css.getPropertyValue('--sky-top').trim() || (t === 'arcade' ? '#05070f' : '#0a1c12');
    var skyBot = css.getPropertyValue('--sky-bot').trim() || (t === 'arcade' ? '#0b1128' : '#0c2318');
    var ground = css.getPropertyValue('--ground').trim() || '#0d2b1c';
    var groundLine = css.getPropertyValue('--ground-line').trim() || 'rgba(74,222,128,.25)';
    var obstacle = css.getPropertyValue('--obstacle').trim() || '#2f6b4f';
    var obstacleEdge = css.getPropertyValue('--obstacle-edge').trim() || 'rgba(154,230,172,.5)';
    var text = css.getPropertyValue('--text').trim() || '#eaf8ef';
    var muted = css.getPropertyValue('--muted').trim() || '#8fbfa0';

    // 天空
    var sky = ctx.createLinearGradient(0, 0, 0, cfg.groundY);
    sky.addColorStop(0, skyTop);
    sky.addColorStop(1, skyBot);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, cfg.groundY);

    /* 微弱星星（arcade 霓虹感 / 4399 萤火） */
    ctx.save();
    for (var i = 0; i < 30; i++) {
      var px = ((i * 173.31) % W), py = ((i * 97.17) % (cfg.groundY - 80)) + 16;
      px = ((px + bgScroll * (0.2 + (i % 3) * 0.3)) % W);
      ctx.globalAlpha = 0.25 + 0.2 * ((i * 37) % 5) / 5;
      ctx.fillStyle = t === 'arcade' ? '#9be8ff' : '#c9e8d2';
      ctx.fillRect(px, py, 2, 2);
    }
    ctx.restore();

    /* 远景废墟剪影（视差） */
    ctx.save();
    ctx.fillStyle = t === 'arcade' ? 'rgba(16,27,61,.85)' : 'rgba(18,48,31,.85)';
    var buildings = 6;
    for (i = 0; i < buildings; i++) {
      var bx = ((i * 158.7 - bgScroll * 0.45) % (W + 200)) - 100;
      if (bx + 90 < 0) bx += W + 200;
      ctx.fillRect(bx, cfg.groundY - (60 + (i * 37 % 90)), 90, 90 + (i * 13 % 40));
    }
    ctx.restore();

    // 地面
    ctx.fillStyle = ground;
    ctx.fillRect(0, cfg.groundY, W, H - cfg.groundY);
    ctx.strokeStyle = groundLine;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, cfg.groundY);
    ctx.lineTo(W, cfg.groundY);
    ctx.stroke();
    ctx.strokeStyle = groundLine;
    ctx.lineWidth = 1;
    var dashes = 12;
    for (i = 0; i < dashes; i++) {
      var dx = ((i * 61 - bgScroll * 0.8) % (W + 40)) - 20;
      ctx.beginPath();
      ctx.moveTo(dx, cfg.groundY + 14);
      ctx.lineTo(dx + 22, cfg.groundY + 14);
      ctx.stroke();
    }

    if (!S) return;

    /* 道具与金币 */
    for (i = 0; i < S.coins.length; i++) {
      var c = S.coins[i];
      ctx.save();
      ctx.fillStyle = '#f5c518';
      ctx.shadowColor = '#f5c518';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,.25)';
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('$', c.x, c.y + 0.5);
      ctx.restore();
    }
    for (i = 0; i < S.pickups.length; i++) {
      var pk = S.pickups[i];
      ctx.save();
      if (pk.kind === 'magnet') {
        ctx.fillStyle = '#22d3ee';
        ctx.shadowColor = '#22d3ee';
        ctx.shadowBlur = 12;
        ctx.font = 'bold 20px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('🧲', pk.x, pk.y);
      } else {
        ctx.fillStyle = '#34d399';
        ctx.shadowColor = '#34d399';
        ctx.shadowBlur = 12;
        ctx.strokeStyle = '#34d399';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(pk.x, pk.y, 15, 0, Math.PI * 2);
        ctx.stroke();
        ctx.font = 'bold 16px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('🛡', pk.x, pk.y + 1);
      }
      ctx.restore();
    }

    /* 障碍 */
    for (i = 0; i < S.obstacles.length; i++) {
      var o = S.obstacles[i];
      if (o.x < -40) continue;
      var w = o.w, top = o.solidTop, bot = o.solidBottom;
      ctx.save();
      ctx.fillStyle = obstacle;
      ctx.strokeStyle = obstacleEdge;
      ctx.lineWidth = 1.5;
      ctx.shadowColor = obstacleEdge;
      ctx.shadowBlur = 4;
      var grad = ctx.createLinearGradient(0, top, 0, bot);
      grad.addColorStop(0, obstacleEdge);
      grad.addColorStop(0.18, obstacle);
      grad.addColorStop(1, obstacle);
      ctx.fillStyle = grad;
      ctx.fillRect(o.x - w / 2, top, w, bot - top);
      ctx.strokeRect(o.x - w / 2, top, w, bot - top);
      // 顶部危险警示线
      ctx.fillStyle = o.type === 'high' ? '#ef4444' : '#f5c518';
      ctx.fillRect(o.x - w / 2, top - 3, w, 3);
      ctx.restore();
    }

    /* 追击者（身后红色巨影） */
    if (S.chaser) {
      var cgap = S.chaser.gap;
      var threat = Math.max(0, Math.min(1, (cfg.gapBack - cgap) / (cfg.gapBack - cfg.gapDanger)));
      var cx = cfg.playerX - cgap * 0.55;
      // 红雾始终压在左侧，爆发时随距离增强，让追击在进入危险区前就可感知
      if (cx < W + 40) {
        ctx.save();
        var danger = cgap < cfg.gapDanger;
        var surge = S.chaser.burst > 0 ? 0.04 + Math.sin(elapsed * 11) * 0.025 : 0;
        var edge = ctx.createLinearGradient(0, 0, 130, 0);
        edge.addColorStop(0, 'rgba(239,68,68,' + (0.05 + threat * 0.2 + surge) + ')');
        edge.addColorStop(1, 'rgba(239,68,68,0)');
        ctx.fillStyle = edge;
        ctx.fillRect(0, 0, 130, H);
        // 红雾拖尾
        var fog = ctx.createRadialGradient(cx, cfg.groundY - 64, 10, cx, cfg.groundY - 64, 190);
        fog.addColorStop(0, danger ? 'rgba(239,68,68,.62)' : 'rgba(239,68,68,' + (0.16 + threat * 0.32) + ')');
        fog.addColorStop(1, 'rgba(239,68,68,0)');
        ctx.fillStyle = fog;
        ctx.fillRect(cx - 210, cfg.groundY - 240, 430, 280);
        // 巨兽本体（暗色猩红）
        ctx.fillStyle = danger ? '#7f1d1d' : '#450a0a';
        ctx.shadowColor = '#ef4444';
        ctx.shadowBlur = danger ? 34 : 12 + threat * 12;
        var bH = 86 + threat * 18;
        ctx.fillRect(cx - 32, cfg.groundY - bH, 64, bH);
        // 头部 + 猩红目
        ctx.fillStyle = danger ? '#a12' : '#5a0f0f';
        ctx.fillRect(cx - 40, cfg.groundY - bH - 20, 80, 28);
        ctx.fillStyle = '#ef4444';
        ctx.shadowBlur = 16;
        ctx.fillRect(cx - 24, cfg.groundY - bH - 12, 10, 6);
        ctx.fillRect(cx + 14, cfg.groundY - bH - 12, 10, 6);
        ctx.restore();
      }
    }

    /* 玩家（青蓝小跑者） */
    drawPlayer();

    /* 连击浮动指示 */
    if (S.combo >= 2) {
      ctx.save();
      ctx.fillStyle = '#f5c518';
      ctx.shadowColor = '#f5c518';
      ctx.shadowBlur = 10;
      ctx.font = 'bold 20px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('×' + S.combo, cfg.playerX, cfg.groundY - cfg.actorH - 44);
      ctx.restore();
    }
    /* 贴脸倒计时条 */
    if (S.chaser && S.chaser.gap < cfg.gapDanger) {
      var frac = Math.max(0, S.chaser.dangerLeft / (S.chaser.dangerMax || cfg.dangerTime));
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,.5)';
      ctx.fillRect(W / 2 - 110, 18, 220, 8);
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(W / 2 - 110 + (1 - frac) * 220, 18, 220 * frac, 8);
      ctx.restore();
    }

    /* HUD 刷新（低频不重复） */
    var d = Math.round(S.dist);
    if (hudDist.textContent !== String(d)) hudDist.textContent = d;
    if (hudCombo.textContent !== String(S.combo)) hudCombo.textContent = S.combo;
    if (hudScore.textContent !== String(S.score)) hudScore.textContent = S.score;
    if (hudShieldN.textContent !== String(S.player.shield)) hudShieldN.textContent = S.player.shield;
  }

  /* 玩家绘制：青蓝跑者（跳=起飞姿态 / 滑=低身） */
  function drawPlayer() {
    var p = S.player;
    var sliding = p.sliding > 0;
    var h = sliding ? cfg.slideH : cfg.actorH;
    var x = cfg.playerX - cfg.actorW / 2;
    var y = sliding ? cfg.groundY - cfg.slideH : p.y;
    var inv = p.invuln > 0;
    // 无敌闪烁
    if (inv && Math.floor(elapsed * 16) % 2 === 0) return;
    ctx.save();
    // 磁石拖影
    if (p.magnet > 0) {
      ctx.strokeStyle = 'rgba(34,211,238,.5)';
      ctx.lineWidth = 4;
      for (var k = 1; k <= 3; k++) {
        ctx.beginPath();
        ctx.moveTo(x - k * 10, y + h / 2 + Math.sin(elapsed * 9 + k) * 5);
        ctx.lineTo(x - k * 10 - 14, y + h / 2 + Math.sin(elapsed * 9 + k + 1) * 5);
        ctx.stroke();
      }
    }
    // 本体
    var grad = ctx.createLinearGradient(x, 0, x + cfg.actorW, 0);
    grad.addColorStop(0, '#0ea5e9');
    grad.addColorStop(1, '#22d3ee');
    ctx.fillStyle = grad;
    ctx.strokeStyle = '#a5f3fc';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = '#22d3ee';
    ctx.shadowBlur = 10;
    ctx.fillRect(x, y, cfg.actorW, h);
    ctx.strokeRect(x, y, cfg.actorW, h);
    // 护盾光环
    if (p.shield > 0) {
      ctx.strokeStyle = 'rgba(52,211,153,.9)';
      ctx.lineWidth = 2;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(cfg.playerX, y + h / 2, cfg.actorW + 6, 0, Math.PI * 2);
      ctx.stroke();
    }
    // 眼睛
    ctx.fillStyle = '#fff';
    ctx.fillRect(x + cfg.actorW - 11, y + (sliding ? 7 : 12), 6, 5);
    ctx.fillStyle = '#032030';
    ctx.fillRect(x + cfg.actorW - 9, y + (sliding ? 8 : 13), 3, 3);
    ctx.restore();
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    applyTheme((function () { try { return localStorage.getItem('gh-theme') === 'arcade' ? 'arcade' : '4399'; } catch (e) { return '4399'; } })(), false);
    showScreen(startScreen);
    // 首帧背景绘制（避免白屏）
    S = E.newGame(); running = false; draw();
    // 预生成障碍，让开始页背景有内容
    for (var i = 0; i < 8; i++) E.update(S, {}, 1 / 60);
    draw();
    // 加载器淡出
    var loader = $('loader');
    window.addEventListener('load', function () {
      setTimeout(function () { loader.classList.add('done'); }, 150);
    });
    // 兜底：load 已过则立即隐藏
    setTimeout(function () { if (!loader.classList.contains('done')) loader.classList.add('done'); }, 1200);
  }
  init();
})();
