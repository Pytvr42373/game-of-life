/* =====================================================================
 * game.js —— 《终局狂奔》主流程：Canvas 渲染 / 键鼠与触屏输入 /
 * HUD 状态 / 三屏切换 / 结算与 Top5 / 三幕场景 / 追击者形态 / 粒子与震动 /
 * 成就 · 档案 · 皮肤解锁 · 金币商店 · 每日挑战。
 * 依赖：engine.js(FinalRunEngine) / audio.js(FinalRunAudio)。
 * ===================================================================== */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  /* ---------------- 模块引用 ---------------- */
  var E = window.FinalRunEngine;
  var A = window.FinalRunAudio;
  var M = window.FinalRunMeta;
  var cfg = E.cfg;

  var canvas = $('gameCanvas');
  var ctx = canvas.getContext('2d');

  var startScreen = $('startScreen'), runScreen = $('runScreen'), overScreen = $('overScreen');
  var hudDist = $('hudDist'), hudCombo = $('hudCombo'), hudScore = $('hudScore'), hudShieldN = $('hudShieldN');
  var hudCoins = $('hudCoins');
  var dangerOverlay = $('dangerOverlay'), dangerText = $('dangerText');
  var tierToast = $('tierToast'), pauseHint = $('pauseHint');
  var statDist = $('statDist'), statCombo = $('statCombo'), statNear = $('statNear'), statTime = $('statTime');
  var statCoins = $('statCoins'), statRage = $('statRage'), statTotalDist = $('statTotalDist');
  var rankList = $('rankList'), overTitle = $('overTitle'), overSub = $('overSub');
  var rageHud = $('rageHud'), rageWaveN = $('rageWaveN');
  var shopModal = $('shopModal'), shopCoin = $('shopCoin'), skinGrid = $('skinGrid'), itemGrid = $('itemGrid');
  var dailyCard = $('dailyCard'), dailyGoal = $('dailyGoal'), dailyProg = $('dailyProg');
  var dailyOver = $('dailyOver'), dailyOverGoal = $('dailyOverGoal'), dailyOverProg = $('dailyOverProg');
  var achieveStrip = $('achieveStrip'), archiveDist = $('archiveDist'), archiveTime = $('archiveTime');
  var coinCount = $('coinCount'), dailyGoalShort = $('dailyGoalShort');

  /* ---------------- 状态 ---------------- */
  var S = null;
  var running = false;
  var paused = false;
  var rafId = 0;
  var lastTs = 0;
  var keys = {};
  var pendingAction = { jump: false, slide: false, drop: false };
  var elapsed = 0;
  var bgScroll = 0;
  var dangerTimer = 0;

  /* —— 输入缓冲：落地前 120ms 预输入 —— */
  var inputBuf = { jump: false, slide: false, expire: 0 };

  /* —— 粒子池 —— */
  var particles = [];
  var MAX_PARTICLES = 120;

  /* —— 屏幕震动 —— */
  var shake = { mag: 0, t: 0 };

  /* ---------------- 存档（localStorage） ---------------- */
  var TOP_KEY = 'final-run.top5.v1';
  var ARCH_KEY = 'final-run.archive.v2';
  var COIN_KEY = 'final-run.coins.v1';
  var ACH_KEY = 'final-run.ach.v1';
  var SHOP_KEY = 'final-run.shop.v1';
  var DAILY_KEY = 'final-run.daily.v1';
  function lsGet(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 静默 */ } }

  function loadArchive() {
    var a = lsGet(ARCH_KEY, null);
    if (!a) return { dist: 0, coins: 0, runs: 0, bestCombo: 0, time: 0, near: 0, score: 0 };
    return { dist: a.dist || 0, coins: a.coins || 0, runs: a.runs || 0, bestCombo: a.bestCombo || 0,
             time: a.time || 0, near: a.near || 0, score: a.score || 0 };
  }
  function saveArchive(a) { lsSet(ARCH_KEY, a); }
  function loadCoins() { var c = lsGet(COIN_KEY, null); return typeof c === 'number' ? c : 0; }
  function saveCoins(c) { lsSet(COIN_KEY, c); }
  function loadAch() { var a = lsGet(ACH_KEY, null); return a && a.unlocked ? a : { unlocked: [] }; }
  function saveAch(a) { lsSet(ACH_KEY, a); }
  function loadShop() {
    var s = lsGet(SHOP_KEY, null);
    if (!s) return { skins: ['cyber'], activeSkin: 'cyber', starter: null };
    return { skins: s.skins || ['cyber'], activeSkin: s.activeSkin || 'cyber', starter: s.starter || null };
  }
  function saveShop(s) { lsSet(SHOP_KEY, s); }
  function loadDaily() {
    var d = lsGet(DAILY_KEY, null);
    var today = M.dayStr();
    if (!d || d.date !== today) {
      var goal = M.DAILY_GOALS[M.hashDay(today) % M.DAILY_GOALS.length];
      return { date: today, goalId: goal.id, prog: { dist: 0, coins: 0, combo: 0, near: 0 }, done: false, claimed: false };
    }
    return d;
  }
  function saveDaily(d) { lsSet(DAILY_KEY, d); }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmtTime(sec) { var m = Math.floor(sec / 60), s = Math.floor(sec % 60); return pad(m) + ':' + pad(s); }

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
  var settings = { sound: true, music: true, vibrate: true };
  function loadSettings() {
    var s = lsGet('final-run.settings.v1', null);
    if (s) {
      if (typeof s.sound === 'boolean') settings.sound = s.sound;
      if (typeof s.music === 'boolean') settings.music = s.music;
      if (typeof s.vibrate === 'boolean') settings.vibrate = s.vibrate;
    }
  }
  function saveSettings() { lsSet('final-run.settings.v1', settings); }
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
  musicBtn.addEventListener('click', function () { settings.music = !settings.music; A.setMusic(settings.music); syncAudioButtons(); saveSettings(); });
  soundBtn.addEventListener('click', function () { settings.sound = !settings.sound; A.setSound(settings.sound); syncAudioButtons(); saveSettings(); });

  /* ---------------- 音效播放（事件 → 声音） ---------------- */
  function playEvent(ev) {
    if (!A || !A.sfx || !A.sfx[ev.type]) return;
    if (ev.type === 'jump') A.sfx.jump(ev.dbl);
    else A.sfx[ev.type]();
  }

  /* ---------------- 震动 ---------------- */
  function triggerShake(mag) {
    if (shake.mag < mag) { shake.mag = mag; shake.t = 0.28; }
    if (settings.vibrate && navigator.vibrate) { try { navigator.vibrate(mag > 8 ? 18 : 10); } catch (e) {} }
  }
  function updateShake(dt) {
    if (shake.t > 0) shake.t -= dt; else shake.mag = 0;
  }
  function shakeOffset() {
    if (shake.mag <= 0) return { x: 0, y: 0 };
    return { x: (Math.random() * 2 - 1) * shake.mag, y: (Math.random() * 2 - 1) * shake.mag };
  }

  /* ---------------- 粒子 ---------------- */
  function spawnParticles(x, y, opts) {
    opts = opts || {};
    var n = Math.min(opts.n || 8, 20);
    for (var i = 0; i < n; i++) {
      if (particles.length >= MAX_PARTICLES) particles.shift();
      var ang = (opts.ang0 || 0) + (opts.spread || Math.PI * 2) * Math.random();
      var spd = (opts.speed0 || 60) + Math.random() * (opts.speed1 || 120);
      particles.push({
        x: x, y: y,
        vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd - (opts.up || 40),
        life: opts.life || 0.5, maxLife: opts.life || 0.5,
        size: (opts.size0 || 3) + Math.random() * (opts.size1 || 3),
        color: opts.color || '#f5c518', grav: opts.grav === undefined ? 420 : opts.grav
      });
    }
  }
  function updateParticles(dt) {
    for (var i = particles.length - 1; i >= 0; i--) {
      var pt = particles[i];
      pt.life -= dt;
      if (pt.life <= 0) { particles.splice(i, 1); continue; }
      pt.vy += pt.grav * dt;
      pt.x += pt.vx * dt; pt.y += pt.vy * dt;
    }
  }
  function drawParticles() {
    for (var i = 0; i < particles.length; i++) {
      var pt = particles[i];
      ctx.save();
      ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife);
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
      ctx.restore();
    }
  }

  /* ---------------- 屏幕切换 ---------------- */
  function showScreen(scr) {
    [startScreen, runScreen, overScreen].forEach(function (s) {
      s.classList.toggle('active', s === scr);
      s.setAttribute('aria-hidden', s === scr ? 'false' : 'true');
    });
  }

  /* ---------------- 提示 toast ---------------- */
  function toast(text) {
    tierToast.textContent = text;
    tierToast.classList.remove('show');
    void tierToast.offsetWidth;
    tierToast.classList.add('show');
  }

  /* ---------------- 开始 ---------------- */
  function startGame() {
    S = E.newGame();
    var shop = loadShop();
    var skin = skinById(shop.activeSkin) || M.SKINS[0];
    activeSkin = skin;
    if (shop.starter === 'startShield') S.player.shield = 1;
    else if (shop.starter === 'startMagnet') S.player.magnet = 1.2;
    running = true; paused = false;
    elapsed = 0; bgScroll = 0;
    keys = {}; pendingAction = { jump: false, slide: false, drop: false };
    inputBuf = { jump: false, slide: false, expire: 0 };
    particles = []; shake = { mag: 0, t: 0 };
    clearTimeout(dangerTimer);
    dangerOverlay.classList.remove('on');
    tierToast.classList.remove('show');
    pauseHint.classList.remove('show');
    rageHud.classList.remove('on');
    hudShieldN.textContent = S.player.shield;
    hudCoins.textContent = '0';
    // 每局开局累计一次（皮肤解锁依据）
    var arch = loadArchive();
    arch.runs += 1;
    saveArchive(arch);
    showScreen(runScreen);
    A.unlock();
    A.startMusic();
    A.setTension(0);
    lastTs = 0;
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
  }

  /* ---------------- 结算与存档 ---------------- */
  function skinById(id) { for (var i = 0; i < M.SKINS.length; i++) if (M.SKINS[i].id === id) return M.SKINS[i]; return null; }
  var activeSkin = M.SKINS[0];

  function loadTop() { return lsGet(TOP_KEY, []); }
  function saveTop(list) { lsSet(TOP_KEY, list); }

  function submitScore() {
    var list = loadTop();
    list.push({ dist: Math.round(S.dist), combo: S.bestCombo, near: S.nearMiss,
                time: Math.round(elapsed), date: new Date().toISOString().slice(0, 10) });
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

  /* —— 结算：累计金币 / 档案 / 成就 / 每日挑战 —— */
  function finishGame() {
    if (!S || !S.gameOver || S._finished) return;
    S._finished = true;
    S.finished = true;
    running = false;
    cancelAnimationFrame(rafId);
    clearTimeout(dangerTimer);
    A.stopMusic();
    A.setTension(0);
    if (S.over === 'caught') { overTitle.textContent = '被捕获'; overSub.textContent = '暗影巨兽追上了你'; }
    else if (S.over === 'finish') { overTitle.textContent = '终局抵达'; overSub.textContent = '穿过最终防线，记录封存'; }
    else { overTitle.textContent = '终局'; overSub.textContent = '记录封存'; }
    statDist.textContent = Math.round(S.dist);
    statCombo.textContent = S.bestCombo;
    statNear.textContent = S.nearMiss;
    statTime.textContent = fmtTime(elapsed);
    statCoins.textContent = S.coinsGot;
    statRage.textContent = S.rageCleared;
    var list = submitScore();

    // —— 金币 ——
    var coins = loadCoins() + S.coinsGot;
    // —— 档案 ——
    var arch = loadArchive();
    arch.dist += Math.round(S.dist);
    arch.coins += S.coinsGot;
    arch.bestCombo = Math.max(arch.bestCombo, S.bestCombo);
    arch.time += Math.round(elapsed);
    arch.near += S.nearMiss;
    arch.score = Math.max(arch.score, S.score);
    // —— 每日挑战 ——
    var daily = loadDaily();
    var dgoal = M.dailyGoalOf(daily);
    daily.prog.dist += Math.round(S.dist);
    daily.prog.coins += S.coinsGot;
    daily.prog.combo = Math.max(daily.prog.combo, S.bestCombo);
    daily.prog.near += S.nearMiss;
    if (!daily.done && daily.prog[dgoal.metric] >= dgoal.target) { daily.done = true; }
    // 达标奖励（每完成一次 +100 金币）
    if (daily.done && !daily.claimed) { daily.claimed = true; coins += 100; }
    saveCoins(coins);
    saveArchive(arch);
    saveDaily(daily);

    statTotalDist.textContent = arch.dist;
    renderArchive();
    renderDaily(daily, dgoal);
    // —— 成就 ——
    var ach = loadAch();
    var newly = [];
    for (var i = 0; i < M.ACHS.length; i++) {
      var ac = M.ACHS[i];
      if (ach.unlocked.indexOf(ac.id) >= 0) continue;
      if (ac.test(S, arch, daily)) { ach.unlocked.push(ac.id); newly.push(ac); }
    }
    if (newly.length) { saveAch(ach); renderAchieve(newly); if (A.sfx.achievement) A.sfx.achievement(); }
    else achieveStrip.innerHTML = '';

    renderRank(list);
    setTimeout(function () { A.sfx.gameover(); }, 350);
    showScreen(overScreen);
  }

  function renderAchieve(newly) {
    achieveStrip.innerHTML = '';
    newly.forEach(function (ac) {
      var el = document.createElement('span');
      el.className = 'badge';
      el.textContent = ac.icon + ' ' + ac.name;
      el.title = ac.desc;
      achieveStrip.appendChild(el);
    });
  }
  function renderArchive() {
    var a = loadArchive();
    archiveDist.textContent = a.dist;
    archiveTime.textContent = fmtTime(a.time);
    coinCount.textContent = loadCoins();
  }
  function renderDaily(daily, dgoal) {
    var prog = daily.prog[dgoal.metric];
    var label = dgoal.name;
    dailyGoal.textContent = label;
    dailyProg.textContent = daily.done ? '✅ 已完成' : (prog + ' / ' + dgoal.target);
    dailyGoalShort.textContent = daily.done ? '✓' : dgoal.name.replace('今日', '').replace('累计', '');
    if (dailyOver) {
      dailyOverGoal.textContent = label;
      dailyOverProg.textContent = daily.done ? '✅ 今日完成 · 已领奖' : (prog + ' / ' + dgoal.target);
    }
  }
  function refreshHud() {
    renderArchive();
    var daily = loadDaily();
    renderDaily(daily, M.dailyGoalOf(daily));
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
      if (!keys.up) {
        if (S.player.airborne && S.player.jumps <= 0) { inputBuf.jump = true; inputBuf.expire = elapsed + 0.12; }
        else pendingAction.jump = true;
      }
      keys.up = true;
    } else if (k === 'ArrowDown' || k === 's' || k === 'S') {
      e.preventDefault();
      if (!keys.down) {
        if (S.player.airborne) { inputBuf.slide = true; inputBuf.expire = elapsed + 0.12; }
        else { pendingAction.slide = true; pendingAction.drop = true; }
      }
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
      if (dy < -14 && pendingAction.jump === false && touchSwallow('up')) {
        pendingAction.jump = true;
        swiping = false;
      } else if (dy > 14 && pendingAction.slide === false && touchSwallow('down')) {
        pendingAction.slide = true; pendingAction.drop = true;
        swiping = false;
      }
    }
    function touchSwallow(dir) {
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
    document.querySelectorAll('.tz-jump').forEach(function (b) {
      b.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        if (running && !paused && !S.gameOver) {
          if (S.player.airborne && S.player.jumps <= 0) { inputBuf.jump = true; inputBuf.expire = elapsed + 0.12; }
          else pendingAction.jump = true;
        }
      });
    });
    document.querySelectorAll('.tz-slide').forEach(function (b) {
      b.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        if (running && !paused && !S.gameOver) {
          if (S.player.airborne) { inputBuf.slide = true; inputBuf.expire = elapsed + 0.12; }
          else { pendingAction.slide = true; pendingAction.drop = true; }
        }
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
  $('homeBtn').addEventListener('click', function () { window.location.href = '../action-games/index.html'; });

  /* ---------------- 商店 ---------------- */
  function openShop() {
    renderShop();
    shopModal.classList.add('open');
    shopModal.setAttribute('aria-hidden', 'false');
  }
  function closeShop() {
    shopModal.classList.remove('open');
    shopModal.setAttribute('aria-hidden', 'true');
  }
  $('shopBtn').addEventListener('click', openShop);
  $('shopClose').addEventListener('click', closeShop);
  shopModal.addEventListener('click', function (e) { if (e.target === shopModal) closeShop(); });

  function renderShop() {
    var coins = loadCoins();
    var shop = loadShop();
    var arch = loadArchive();
    shopCoin.textContent = coins;
    skinGrid.innerHTML = '';
    M.SKINS.forEach(function (sk) {
      var owned = shop.skins.indexOf(sk.id) >= 0 || arch.runs >= sk.unlockRuns;
      var active = shop.activeSkin === sk.id;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'shop-item skin-item' + (active ? ' on' : '') + (owned ? '' : ' locked');
      var sw = document.createElement('i');
      sw.className = 'skin-swatch';
      sw.style.background = 'linear-gradient(135deg,' + sk.c1 + ',' + sk.c2 + ')';
      var nm = document.createElement('b');
      nm.textContent = sk.name;
      var st = document.createElement('span');
      if (active) st.textContent = '使用中';
      else if (owned) st.textContent = '已解锁';
      else st.textContent = '累计开局 ' + sk.unlockRuns + ' 次解锁 · 已开局 ' + arch.runs;
      btn.appendChild(sw); btn.appendChild(nm); btn.appendChild(st);
      btn.addEventListener('click', function () {
        if (active) return;
        if (!owned) { toast('🔒 累计开局 ' + sk.unlockRuns + ' 次解锁'); return; }
        shop.activeSkin = sk.id;
        if (shop.skins.indexOf(sk.id) < 0) shop.skins.push(sk.id);
        saveShop(shop);
        toast('🎨 已选择 ' + sk.name);
        if (A.sfx.achievement) A.sfx.achievement();
        renderShop();
      });
      skinGrid.appendChild(btn);
    });
    itemGrid.innerHTML = '';
    M.STARTERS.forEach(function (it) {
      var active = shop.starter === it.id;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'shop-item item-item' + (active ? ' on' : '');
      var nm = document.createElement('b');
      nm.textContent = it.name;
      var de = document.createElement('span');
      de.textContent = it.desc;
      var st = document.createElement('span');
      st.textContent = active ? '已装备' : it.price + ' 金币';
      btn.appendChild(nm); btn.appendChild(de); btn.appendChild(st);
      btn.addEventListener('click', function () {
        if (active) return;
        if (coins >= it.price) {
          coins -= it.price; saveCoins(coins);
          shop.starter = it.id; saveShop(shop);
          toast('🎒 已装备 ' + it.name);
          if (A.sfx.achievement) A.sfx.achievement();
        } else { toast('💰 金币不足'); return; }
        renderShop();
      });
      itemGrid.appendChild(btn);
    });
  }

  /* ---------------- 分享 ---------------- */
  $('shareBtn').addEventListener('click', function () {
    var txt = '🏃《终局狂奔》我跑了 ' + Math.round(S.dist) + 'm · 最高连击 ×' + S.bestCombo +
              ' · 极限闪避 ' + S.nearMiss + ' · 存活 ' + fmtTime(elapsed);
    function done() { toast('✅ 成绩已复制'); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(done).catch(function () { fallbackCopy(txt); });
    } else fallbackCopy(txt);
  });
  function fallbackCopy(txt) {
    var ta = document.createElement('textarea');
    ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('✅ 成绩已复制'); } catch (e) { toast('复制失败'); }
    document.body.removeChild(ta);
  }

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
      // 落地后消费预输入
      for (var i = 0; i < evs.length; i++) {
        if (evs[i].type === 'land') {
          if (inputBuf.jump && elapsed <= inputBuf.expire) { pendingAction.jump = true; inputBuf.jump = false; }
          else if (inputBuf.slide && elapsed <= inputBuf.expire) { pendingAction.slide = true; pendingAction.drop = true; inputBuf.slide = false; }
        }
      }
      for (i = 0; i < evs.length; i++) {
        handleEvent(evs[i]);
        if (S.gameOver) break;
      }
      bgScroll = (bgScroll + S.speed * dt) % 220;
      updateParticles(dt);
      updateShake(dt);
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

  /* ---------------- 事件处理 ---------------- */
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
        spawnParticles(cfg.playerX, cfg.groundY - cfg.actorH, { n: 10, color: '#22d3ee', up: 120, spread: Math.PI, speed0: 80, speed1: 200, life: 0.4 });
        triggerShake(6);
        break;
      case 'tierUp':
        toast('⚡ 难度提升 · LV ' + (ev.tier + 1));
        break;
      case 'hit':
        dangerOverlay.classList.add('on');
        dangerText.textContent = '被撞 · 快甩开！';
        A.setTension(2);
        spawnParticles(cfg.playerX, cfg.groundY - cfg.actorH / 2, { n: 14, color: '#f97316', spread: Math.PI * 1.4, up: 60, speed0: 60, speed1: 220, life: 0.45 });
        triggerShake(12);
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
      case 'finish':
        dangerOverlay.classList.remove('on');
        rageHud.classList.remove('on');
        toast('🏁 终局抵达 · 记录封存');
        finishGame();
        break;
      case 'magnet':
        toast('🧲 磁石冲刺！');
        break;
      case 'shieldBreak':
        spawnParticles(cfg.playerX, cfg.groundY - cfg.actorH / 2, { n: 12, color: '#34d399', spread: Math.PI * 2, up: 80, speed0: 80, speed1: 200, life: 0.4 });
        break;
      case 'coin':
        spawnParticles(cfg.playerX, cfg.groundY - cfg.actorH / 2, { n: 5, color: '#f5c518', spread: Math.PI, up: 100, speed0: 40, speed1: 120, life: 0.35 });
        break;
      case 'chaserSwitch':
        toast('👹 前方出现新的追击者 · ' + ev.label);
        if (A.sfx.chaserSwitch) A.sfx.chaserSwitch();
        triggerShake(8);
        break;
      case 'rageStart':
        toast('👹 巨兽狂怒！连续挣脱 ' + cfg.rageWaves + ' 次');
        rageHud.classList.add('on');
        rageWaveN.textContent = '1';
        spawnParticles(cfg.playerX, cfg.groundY - cfg.actorH, { n: 20, color: '#ef4444', spread: Math.PI * 2, up: 160, speed0: 120, speed1: 260, life: 0.8 });
        if (A.sfx.rage) A.sfx.rage();
        triggerShake(14);
        break;
      case 'rageWave':
        rageWaveN.textContent = ev.wave;
        spawnParticles(cfg.playerX, cfg.groundY - cfg.actorH, { n: 12, color: '#f97316', spread: Math.PI, up: 140, speed0: 80, speed1: 220, life: 0.5 });
        triggerShake(8);
        break;
      case 'rageClear':
        rageHud.classList.remove('on');
        toast('👹 狂怒击退 · +300');
        spawnParticles(cfg.playerX, cfg.groundY - cfg.actorH, { n: 22, color: '#fbbf24', spread: Math.PI * 2, up: 180, speed0: 120, speed1: 280, life: 0.8 });
        if (A.sfx.rageClear) A.sfx.rageClear();
        triggerShake(10);
        break;
      case 'act':
        var an = M.ACTS[ev.act];
        toast('🎬 ' + an.name);
        spawnParticles(cfg.playerX, cfg.groundY - 100, { n: 20, color: '#f5c518', spread: Math.PI * 2, up: 150, speed0: 100, speed1: 260, life: 0.7 });
        if (A.sfx.zone) A.sfx.zone();
        triggerShake(8);
        break;
      default:
        break;
    }
  }

  /* ---------------- 渲染 ---------------- */
  function themeOf() { return document.body.dataset.theme || '4399'; }
  function zoneIndex(dist) { return E.actFor(dist); }
  function zonePal() {
    var z = M.ZONES[zoneIndex(S ? S.dist : 0)];
    var t = themeOf();
    return z.pal[t] || z.pal['4399'];
  }
  function draw() {
    var W = canvas.width, H = canvas.height;
    var pal = zonePal();
    var off = shakeOffset();
    ctx.save();
    if (off.x || off.y) ctx.translate(off.x, off.y);

    // 天空
    var sky = ctx.createLinearGradient(0, 0, 0, cfg.groundY);
    sky.addColorStop(0, pal.skyTop);
    sky.addColorStop(1, pal.skyBot);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, cfg.groundY);

    /* 星星 */
    ctx.save();
    for (var i = 0; i < 30; i++) {
      var px = ((i * 173.31) % W), py = ((i * 97.17) % (cfg.groundY - 80)) + 16;
      px = ((px + bgScroll * (0.2 + (i % 3) * 0.3)) % W);
      ctx.globalAlpha = 0.25 + 0.2 * ((i * 37) % 5) / 5;
      ctx.fillStyle = pal.star;
      ctx.fillRect(px, py, 2, 2);
    }
    ctx.restore();

    /* 远景剪影（视差） */
    ctx.save();
    ctx.fillStyle = pal.building;
    var buildings = 6;
    for (i = 0; i < buildings; i++) {
      var bx = ((i * 158.7 - bgScroll * 0.45) % (W + 200)) - 100;
      if (bx + 90 < 0) bx += W + 200;
      var bh = 60 + (i * 37 % 90);
      ctx.fillRect(bx, cfg.groundY - bh, 90, bh + 40);
    }
    ctx.restore();

    // 地面
    ctx.fillStyle = pal.ground;
    ctx.fillRect(0, cfg.groundY, W, H - cfg.groundY);
    ctx.strokeStyle = pal.groundLine;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, cfg.groundY);
    ctx.lineTo(W, cfg.groundY);
    ctx.stroke();
    ctx.strokeStyle = pal.groundLine;
    ctx.lineWidth = 1;
    var dashes = 12;
    for (i = 0; i < dashes; i++) {
      var dx = ((i * 61 - bgScroll * 0.8) % (W + 40)) - 20;
      ctx.beginPath();
      ctx.moveTo(dx, cfg.groundY + 14);
      ctx.lineTo(dx + 22, cfg.groundY + 14);
      ctx.stroke();
    }

    if (!S) { ctx.restore(); return; }

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

    /* 障碍（含新类型） */
    for (i = 0; i < S.obstacles.length; i++) {
      var o = S.obstacles[i];
      if (o.x < -40) continue;
      var w = o.w, top = o.solidTop, bot = o.solidBottom;
      ctx.save();
      if (o.type === 'gap') {
        // 地面裂缝：凹陷 + 红色警示
        ctx.fillStyle = '#1a0f08';
        ctx.fillRect(o.x - w / 2, cfg.groundY - 6, w, 34);
        ctx.fillStyle = '#f97316';
        ctx.fillRect(o.x - w / 2, cfg.groundY - 6, w, 4);
        ctx.restore();
        continue;
      }
      if (o.type === 'spike') {
        // 空翻倒刺：高刺柱 + 顶部红刺
        ctx.fillStyle = '#713f12';
        ctx.shadowColor = '#f97316';
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.moveTo(o.x - w / 2, bot);
        ctx.lineTo(o.x - w / 2 + 4, top + 8);
        ctx.lineTo(o.x, top);
        ctx.lineTo(o.x + w / 2 - 4, top + 8);
        ctx.lineTo(o.x + w / 2, bot);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(o.x - w / 2 + 6, top - 4, w - 12, 5);
        ctx.restore();
        continue;
      }
      ctx.fillStyle = pal.obstacle;
      ctx.strokeStyle = pal.obstacleEdge;
      ctx.lineWidth = 1.5;
      ctx.shadowColor = pal.obstacleEdge;
      ctx.shadowBlur = 4;
      var grad = ctx.createLinearGradient(0, top, 0, bot);
      grad.addColorStop(0, pal.obstacleEdge);
      grad.addColorStop(0.18, pal.obstacle);
      grad.addColorStop(1, pal.obstacle);
      ctx.fillStyle = grad;
      ctx.fillRect(o.x - w / 2, top, w, bot - top);
      ctx.strokeRect(o.x - w / 2, top, w, bot - top);
      var warn = '#f5c518';
      if (o.type === 'high') warn = '#ef4444';
      if (o.type === 'moving') warn = '#22d3ee';
      ctx.fillStyle = warn;
      ctx.fillRect(o.x - w / 2, top - 3, w, 3);
      ctx.restore();
    }

    /* 粒子（在实体下方渲染为氛围层前先画主体后的拖影） */
    drawParticles();

    /* 追击者（按形态绘制） */
    if (S.chaser) drawChaser(pal);

    /* 玩家 */
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
    ctx.restore();

    /* HUD 刷新 */
    var d = Math.round(S.dist);
    if (hudDist.textContent !== String(d)) hudDist.textContent = d;
    if (hudCombo.textContent !== String(S.combo)) hudCombo.textContent = S.combo;
    if (hudScore.textContent !== String(S.score)) hudScore.textContent = S.score;
    if (hudShieldN.textContent !== String(S.player.shield)) hudShieldN.textContent = S.player.shield;
    if (hudCoins.textContent !== String(S.coinsGot)) hudCoins.textContent = S.coinsGot;
  }

  /* 追击者按形态绘制 */
  function drawChaser(pal) {
    var W = cfg.w, H = cfg.h;
    var cgap = S.chaser.gap;
    var threat = Math.max(0, Math.min(1, (cfg.gapBack - cgap) / (cfg.gapBack - cfg.gapDanger)));
    var kind = S.chaser.kind || 'beast';
    var scale = (E.cfg.chaserKinds[kind] || E.cfg.chaserKinds.beast).scale;
    var danger = cgap < cfg.gapDanger;
    var surge = S.chaser.burst > 0 ? 0.04 + Math.sin(elapsed * 11) * 0.025 : 0;
    var edge = ctx.createLinearGradient(0, 0, 130, 0);
    edge.addColorStop(0, 'rgba(239,68,68,' + (0.05 + threat * 0.2 + surge) + ')');
    edge.addColorStop(1, 'rgba(239,68,68,0)');
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, 130, H);
    var cx = cfg.playerX - cgap * 0.55;
    if (cx > W + 60) return;
    var fog = ctx.createRadialGradient(cx, cfg.groundY - 64 * scale, 10, cx, cfg.groundY - 64 * scale, 190 * scale);
    fog.addColorStop(0, danger ? 'rgba(239,68,68,.62)' : 'rgba(239,68,68,' + (0.16 + threat * 0.32) + ')');
    fog.addColorStop(1, 'rgba(239,68,68,0)');
    ctx.fillStyle = fog;
    ctx.fillRect(cx - 210 * scale, cfg.groundY - 240 * scale, 430 * scale, 280 * scale);

    ctx.save();
    ctx.shadowColor = '#ef4444';
    ctx.shadowBlur = danger ? 34 : 12 + threat * 12;
    if (kind === 'pack') {
      // 猎犬群：三只小体积
      for (var k = -1; k <= 1; k++) {
        var hx = cx + k * 34;
        var bH = 44 + threat * 8;
        ctx.fillStyle = danger ? '#7f1d1d' : '#450a0a';
        ctx.fillRect(hx - 18, cfg.groundY - bH, 36, bH);
        ctx.fillStyle = danger ? '#a12' : '#5a0f0f';
        ctx.fillRect(hx - 22, cfg.groundY - bH - 12, 44, 16);
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(hx - 13, cfg.groundY - bH - 7, 6, 4);
        ctx.fillRect(hx + 7, cfg.groundY - bH - 7, 6, 4);
      }
    } else {
      var bH = (86 + threat * 18) * scale;
      ctx.fillStyle = danger ? '#7f1d1d' : '#450a0a';
      ctx.fillRect(cx - 32 * scale, cfg.groundY - bH, 64 * scale, bH);
      ctx.fillStyle = danger ? '#a12' : '#5a0f0f';
      ctx.fillRect(cx - 40 * scale, cfg.groundY - bH - 20 * scale, 80 * scale, 28 * scale);
      ctx.fillStyle = '#ef4444';
      ctx.shadowBlur = 16;
      ctx.fillRect(cx - 24 * scale, cfg.groundY - bH - 12 * scale, 10 * scale, 6 * scale);
      ctx.fillRect(cx + 14 * scale, cfg.groundY - bH - 12 * scale, 10 * scale, 6 * scale);
    }
    ctx.restore();
  }

  /* 玩家绘制：当前皮肤配色 */
  function drawPlayer() {
    var p = S.player;
    var sliding = p.sliding > 0;
    var h = sliding ? cfg.slideH : cfg.actorH;
    var x = cfg.playerX - cfg.actorW / 2;
    var y = sliding ? cfg.groundY - cfg.slideH : p.y;
    var inv = p.invuln > 0;
    if (inv && Math.floor(elapsed * 16) % 2 === 0) return;
    var skin = activeSkin || M.SKINS[0];
    ctx.save();
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
    var grad = ctx.createLinearGradient(x, 0, x + cfg.actorW, 0);
    grad.addColorStop(0, skin.c1);
    grad.addColorStop(1, skin.c2);
    ctx.fillStyle = grad;
    ctx.strokeStyle = skin.edge;
    ctx.lineWidth = 1.5;
    ctx.shadowColor = skin.c2;
    ctx.shadowBlur = 10;
    ctx.fillRect(x, y, cfg.actorW, h);
    ctx.strokeRect(x, y, cfg.actorW, h);
    if (p.shield > 0) {
      ctx.strokeStyle = 'rgba(52,211,153,.9)';
      ctx.lineWidth = 2;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(cfg.playerX, y + h / 2, cfg.actorW + 6, 0, Math.PI * 2);
      ctx.stroke();
    }
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
    S = E.newGame(); running = false; draw();
    for (var i = 0; i < 8; i++) E.update(S, {}, 1 / 60);
    draw();
    refreshHud();
    var loader = $('loader');
    window.addEventListener('load', function () {
      setTimeout(function () { loader.classList.add('done'); }, 150);
    });
    setTimeout(function () { if (!loader.classList.contains('done')) loader.classList.add('done'); }, 1200);
  }
  init();
})();
