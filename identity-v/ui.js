/* ============================================================
 * ui.js - 渲染 / HUD / 菜单 / 输入 (全部程序化绘制)
 * ============================================================ */
(function (global) {
  'use strict';

  var UI = {};
  var G = null;
  var canvas, ctx, cw = 960, ch = 540;
  var keys = {};
  var touch = { active: false, id: -1, ox: 0, oy: 0, dx: 0, dy: 0, baseX: 0, baseY: 0 };
  var reducedMotion = false;
  var isTouch = false;
  var lastTime = 0;
  var frame = 0;
  var fogBlobs = [];
  var prevState = null;

  var events = { attack: false, interact: false, skill: false, skill2: false, pause: false, selfHeal: false };

  function $(id) { return document.getElementById(id); }

  /* 极罕见兜底：canvas 2d 上下文不可用时，用 no-op 上下文防止整条渲染链路崩溃（避免白屏无响应） */
  function makeNoopCtx() {
    return new Proxy({}, {
      get: function (t, p) {
        if (typeof p === 'symbol') return undefined;
        if (p === 'canvas') return canvas;
        if (p in t) return t[p];
        return function () { return { addColorStop: function () {}, width: 10 }; };
      },
      set: function () { return true; }
    });
  }

  /* ================= 初始化 ================= */
  UI.init = function () {
    canvas = $('game');
    ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
    if (!ctx) ctx = makeNoopCtx(); // 兜底，避免后续渲染崩溃
    resize();
    window.addEventListener('resize', resize);

    // 读取设置
    var st = loadSave();
    if (st.settings) G.settings = st.settings;
    reducedMotion = !!G.settings.reducedMotion;
    if (AudioSys) {
      AudioSys.init();
      AudioSys.setVolume(G.settings.volume);
      AudioSys.setMuted(G.settings.muted);
    }

    // 雾斑
    for (var i = 0; i < 7; i++) {
      fogBlobs.push({ x: Math.random(), y: Math.random(), r: 0.2 + Math.random() * 0.3, spd: 0.004 + Math.random() * 0.01, ph: Math.random() * 6.28 });
    }

    // 键盘
    window.addEventListener('keydown', function (e) {
      var k = e.key.toLowerCase();
      keys[k] = true;
      if (k === ' ') {
        if (G && G.state === 'playing' && G.playerIsHunter) events.attack = true;
        else if (G && G.state === 'playing' && G.player && G.player.kind === 'survivor' && G.player.hp === 0) events.selfHeal = true;
        else events.interact = true;
        e.preventDefault();
      }
      if (k === 'e' || k === 'enter') events.interact = true;
      if (k === 'shift') { events.skill = true; }
      if (k === 'q') { events.skill2 = true; }
      if (k === 'p' || k === 'escape') { events.pause = true; }
      if (k === 'c') { keys.c = true; }
      if (k === 'arrowup' || k === 'arrowdown' || k === 'arrowleft' || k === 'arrowright') e.preventDefault();
    });
    window.addEventListener('keyup', function (e) { keys[e.key.toLowerCase()] = false; });

    // 触摸
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
      isTouch = true;
      $('touch').style.display = 'flex';
      setupTouch();
    }

    // 首次手势解锁音频
    var unlockAudio = function () { if (AudioSys) { AudioSys.init(); AudioSys.resume(); } };
    document.addEventListener('pointerdown', unlockAudio, { once: true });
    document.addEventListener('keydown', unlockAudio, { once: true });

    // 按钮
    bindButtons();

    // 构建角色选择
    buildCharList();
    buildHunterList();
    buildMapList();

    // 启动时始终显示主菜单，避免进入后卡在加载/空白界面
    showPanel('menu');

    lastTime = performance.now();
    requestAnimationFrame(loop);
  };

  function resize() {
    cw = window.innerWidth; ch = window.innerHeight;
    var dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    if (canvas) {
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
      canvas.style.width = cw + 'px';
      canvas.style.height = ch + 'px';
    }
    try { if (ctx && ctx.setTransform) ctx.setTransform(dpr, 0, 0, dpr, 0, 0); } catch (e) {}
  }

  /* ================= 存档 ================= */
  function loadSave() {
    var def = { stats: { wins: 0, losses: 0, best: 0, games: 0 }, settings: { volume: 0.7, muted: false, reducedMotion: false, difficulty: 'normal' } };
    var d = JSON.parse(JSON.stringify(def));
    try {
      var raw = localStorage.getItem('dawn-maze-save');
      if (raw) {
        var p = JSON.parse(raw);
        if (p && typeof p === 'object' && !Array.isArray(p)) {
          d = p;
          if (!d.stats || typeof d.stats !== 'object') d.stats = JSON.parse(JSON.stringify(def.stats));
          if (!d.settings || typeof d.settings !== 'object') d.settings = JSON.parse(JSON.stringify(def.settings));
        }
      }
    } catch (e) {}
    return d;
  }
  function save() {
    try { localStorage.setItem('dawn-maze-save', JSON.stringify(currentSave)); } catch (e) {}
  }
  var currentSave = null;

  UI.applySettings = function () {
    if (!G) return;
    G.settings = currentSave.settings;
    reducedMotion = !!G.settings.reducedMotion;
    if (AudioSys) { AudioSys.setVolume(G.settings.volume); AudioSys.setMuted(G.settings.muted); }
  };

  /* ================= 输入采集 ================= */
  function sampleInput() {
    if (G.state !== 'playing') {
      return { x: 0, y: 0, attack: false, interact: false, skill: false, skill2: false, crouch: false, pause: events.pause };
    }
    var x = 0, y = 0;
    if (keys['arrowright'] || keys.d) x += 1;
    if (keys['arrowleft'] || keys.a) x -= 1;
    if (keys['arrowdown'] || keys.s) y += 1;
    if (keys['arrowup'] || keys.w) y -= 1;
    if (touch.active) { x = touch.dx; y = touch.dy; }
    var len = Math.sqrt(x * x + y * y);
    if (len > 1) { x /= len; y /= len; }
    var crouch = !!(keys.c || keys['control']) ;
    var hunter = G.playerIsHunter;
    var inp = {
      x: x, y: y,
      attack: events.attack || (hunter && uiBtn.interact),
      interact: events.interact || (hunter ? uiBtn.crouch : uiBtn.interact),
      skill: events.skill || uiBtn.skill,
      skill2: events.skill2 || uiBtn.skill2,
      crouch: !hunter && (crouch || uiBtn.crouch),
      selfHeal: events.selfHeal || (!hunter && G.player && G.player.hp === 0 && uiBtn.interact),
      pause: events.pause
    };
    return inp;
  }

  /* ================= 触摸控件 ================= */
  var uiBtn = { interact: false, skill: false, skill2: false, crouch: false };

  function setupTouch() {
    var stick = $('stick');
    var zone = $('stickzone');
    var moved = false;
    zone.addEventListener('pointerdown', function (e) {
      if (e.target !== zone) return;
      touch.active = true; moved = false;
      touch.ox = e.clientX; touch.oy = e.clientY;
      touch.baseX = e.clientX; touch.baseY = e.clientY;
      stick.style.display = 'flex';
      stick.style.left = (e.clientX - 28) + 'px';
      stick.style.top = (e.clientY - 28) + 'px';
      zone.setPointerCapture(e.pointerId);
    });
    zone.addEventListener('pointermove', function (e) {
      if (!touch.active) return;
      var dx = e.clientX - touch.baseX, dy = e.clientY - touch.baseY;
      var len = Math.sqrt(dx * dx + dy * dy);
      var max = 52;
      if (len > max) { dx = dx / len * max; dy = dy / len * max; len = max; }
      touch.dx = dx / max; touch.dy = dy / max;
      if (len > 6) moved = true;
      stick.style.left = (touch.baseX + dx - 28) + 'px';
      stick.style.top = (touch.baseY + dy - 28) + 'px';
    });
    zone.addEventListener('pointerup', function (e) {
      touch.active = false; touch.dx = 0; touch.dy = 0;
      stick.style.display = 'none';
    });
    zone.addEventListener('pointercancel', function () {
      touch.active = false; touch.dx = 0; touch.dy = 0;
      stick.style.display = 'none';
    });
    // 按钮
    bindTouchBtn('btn-interact', 'interact');
    bindTouchBtn('btn-skill', 'skill');
    bindTouchBtn('btn-skill2', 'skill2');
    bindTouchBtn('btn-crouch', 'crouch');
    $('btn-pause').addEventListener('click', function () { if (G) G.togglePause(); });
  }
  function bindTouchBtn(id, name) {
    var el = $(id);
    el.addEventListener('pointerdown', function (e) { e.preventDefault(); uiBtn[name] = true; });
    el.addEventListener('pointerup', function () { uiBtn[name] = false; });
    el.addEventListener('pointercancel', function () { uiBtn[name] = false; });
    el.addEventListener('pointerleave', function () { uiBtn[name] = false; });
  }

  function setTouchRole(asHunter) {
    var primary = $('btn-interact');
    var secondary = $('btn-crouch');
    var skill = $('btn-skill');
    var skill2 = $('btn-skill2');
    var role = G && G.player;
    var active = role && role.char && role.char.active;
    var active2 = asHunter && role && role.char && role.char.active2;
    if (primary) {
      primary.textContent = asHunter ? '攻击' : '交互';
      if (primary.setAttribute) primary.setAttribute('aria-label', asHunter ? '攻击' : '交互');
    }
    if (secondary) {
      secondary.textContent = asHunter ? '交互' : '蹲';
      if (secondary.setAttribute) secondary.setAttribute('aria-label', asHunter ? '牵制、挂椅或破坏木板' : '蹲伏');
    }
    if (skill) {
      skill.textContent = active ? active.name : '技能';
      if (skill.setAttribute) skill.setAttribute('aria-label', active ? active.name : '角色技能');
    }
    if (skill2) {
      skill2.textContent = active2 ? active2.name : '技能2';
      skill2.style.display = active2 ? 'flex' : 'none';
      if (skill2.setAttribute) skill2.setAttribute('aria-label', active2 ? active2.name : '技能2（不可用）');
    }
  }

  function bindButtons() {
    var map = {
      'btn-start': function () { closeCharacterBriefs($('charsel-list')); showPanel('charsel'); AudioSys.uiOpen(); },
      'btn-hunter': function () { closeCharacterBriefs($('huntersel-list')); showPanel('huntersel'); AudioSys.uiOpen(); },
      'btn-maps': function () { showPanel('mapsel'); AudioSys.uiOpen(); },
      'btn-settings': function () { openSettings(true); showPanel('settings'); AudioSys.uiOpen(); },
      'btn-tutorial': function () { showPanel('tutorial'); AudioSys.uiOpen(); },
      'btn-stats': function () { refreshStats(); showPanel('stats'); AudioSys.uiOpen(); },
      'btn-back-menu': function () { showPanel('menu'); AudioSys.uiClick(); },
      'btn-back-chars': function () { showPanel('menu'); AudioSys.uiClick(); },
      'btn-back-hunters': function () { showPanel('menu'); AudioSys.uiClick(); },
      'btn-back-maps': function () { showPanel('menu'); AudioSys.uiClick(); },
      'btn-back-settings': function () { showPanel(settingsFrom); AudioSys.uiClick(); },
      'btn-back-tutorial': function () { showPanel('menu'); AudioSys.uiClick(); },
      'btn-back-stats': function () { showPanel('menu'); AudioSys.uiClick(); },
      'btn-resume': function () { G.togglePause(); AudioSys.uiClick(); },
      'btn-restart': function () { G.togglePause(); restart(); AudioSys.uiClick(); },
      'btn-quit': function () { quitToMenu(); AudioSys.uiClick(); },
      'btn-again': function () { restart(); AudioSys.uiClick(); },
      'btn-result-menu': function () { quitToMenu(); AudioSys.uiClick(); }
    };
    for (var id in map) {
      var el = $(id);
      if (el) el.addEventListener('click', map[id]);
    }
    // 音量
    var vol = $('volume');
    if (vol) vol.addEventListener('input', function () {
      currentSave.settings.volume = parseFloat(vol.value);
      UI.applySettings(); save();
    });
    var diff = $('difficulty');
    if (diff) diff.addEventListener('change', function () {
      currentSave.settings.difficulty = diff.value;
      save();
    });
    var rm = $('reduced-motion');
    if (rm) rm.addEventListener('change', function () {
      currentSave.settings.reducedMotion = rm.checked;
      UI.applySettings(); save();
    });
    var mute = $('mute');
    if (mute) mute.addEventListener('change', function () {
      currentSave.settings.muted = mute.checked;
      UI.applySettings(); save();
    });
  }

  var settingsFrom = 'menu';
  function openSettings(from) {
    settingsFrom = from || 'menu';
    var st = currentSave.settings;
    $('volume').value = st.volume;
    $('difficulty').value = st.difficulty || 'normal';
    $('reduced-motion').checked = !!st.reducedMotion;
    $('mute').checked = !!st.muted;
  }

  function showPanel(id) {
    var panels = ['menu', 'charsel', 'huntersel', 'mapsel', 'settings', 'tutorial', 'stats', 'pause', 'result'];
    for (var i = 0; i < panels.length; i++) {
      var el = $(panels[i]);
      if (el) el.style.display = (panels[i] === id) ? 'flex' : 'none';
    }
    var home = $('btn-home');
    if (home) home.style.display = 'flex';
    if (id === 'menu') { G.state = 'menu'; }
  }

  /* ================= 角色列表 ================= */
  function escapeHTML(text) {
    return String(text).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function emphasizeBrief(text) {
    return escapeHTML(text)
      .replace(/(\+?\d+(?:\.\d+)?(?:%|px|秒|点|档)?)/g, '<strong>$1</strong>')
      .replace(/(立刻|立即|恢复一档伤势|直接完成|直接击倒|抵挡下一次攻击|无法锁定|显示所有求生者位置|不可穿墙|传送|定身|击晕)/g, '<strong>$1</strong>');
  }

  function skillBrief(skill, key, kind) {
    return '<div class="brief-skill"><div class="brief-skill-meta">' +
      '<span class="brief-kind">' + kind + '</span><kbd class="brief-key">' + key + '</kbd>' +
      '<span class="brief-cd">冷却 ' + skill.cd + ' 秒</span></div>' +
      '<strong class="brief-skill-name">' + escapeHTML(skill.name) + '</strong>' +
      '<p class="brief-effect">' + emphasizeBrief(skill.desc) + '</p></div>';
  }

  function buildCharacterBrief(c, isHunter) {
    var brief = document.createElement('div');
    brief.className = 'char-brief';
    brief.id = 'char-brief-' + c.id;
    brief.innerHTML = '<div class="brief-role-row"><span class="brief-label">' +
      (isHunter ? '战术定位' : '团队定位') + '</span><strong class="brief-role">' + escapeHTML(c.position) + '</strong></div>' +
      '<p class="brief-contribution"><span>' + (isHunter ? '战术优势' : '团队作用') + '</span>' + escapeHTML(c.contribution) + '</p>' +
      skillBrief(c.active, 'SHIFT', '主动技能') +
      (c.active2 ? skillBrief(c.active2, 'Q', '技能 2') : '') +
      '<div class="brief-passive"><div class="brief-passive-title"><span>被动</span><strong>' +
      escapeHTML(c.passive.name) + '</strong></div><p class="brief-effect">' + emphasizeBrief(c.passive.desc) + '</p></div>' +
      '<div class="brief-action">' + (isTouch ? '再次点按选择角色' : '点击选择角色') + '</div>';
    return brief;
  }

  function closeCharacterBriefs(box) {
    if (!box || !box.children) return;
    for (var i = 0; i < box.children.length; i++) {
      var card = box.children[i];
      card._briefOpen = false;
      card.className = card.className.replace(/\s*brief-open/g, '');
    }
  }

  function bindCharacterCard(card, box, select) {
    card.addEventListener('pointerdown', function (e) {
      card._touchActivation = e.pointerType !== 'mouse';
    });
    card.addEventListener('mousedown', function () {
      if (card._touchActivation !== true) card._touchActivation = false;
    });
    card.addEventListener('click', function () {
      if (isTouch && card._touchActivation !== false && !card._briefOpen) {
        closeCharacterBriefs(box);
        card._briefOpen = true;
        card.className += ' brief-open';
        AudioSys.uiOpen();
        return;
      }
      select();
    });
    card.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      if (e.stopPropagation) e.stopPropagation();
      select();
    });
  }

  function buildCharList() {
    var box = $('charsel-list'); if (!box) return;
    box.innerHTML = '';
    SURVIVORS.forEach(function (c, i) {
      var card = document.createElement('div');
      card.className = 'char-card has-brief';
      card.tabIndex = 0;
      if (card.style.setProperty) card.style.setProperty('--char-accent', c.color);
      if (card.setAttribute) {
        card.setAttribute('role', 'button');
        card.setAttribute('aria-label', '选择' + c.name + '，' + c.position + '定位；悬停或聚焦查看技能资料');
        card.setAttribute('aria-describedby', 'char-brief-' + c.id);
      }
      var cv = document.createElement('canvas');
      cv.width = 120; cv.height = 140;
      var cx = cv.getContext('2d');
      drawPortrait(cx, c, 60, 84, 40, false);
      var info = document.createElement('div');
      info.className = 'char-info';
      info.innerHTML = '<div class="cn">' + c.name + '</div><div class="ct">' + c.title + '</div>' +
        '<div class="char-summary"><span class="char-position">' + c.position + '</span>' +
        '<span class="char-active">' + c.active.name + '</span></div>' +
        '<div class="char-peek">' + (isTouch ? '点按查看战术资料' : '悬停查看战术资料') + '</div>';
      card.appendChild(cv);
      card.appendChild(info);
      card.appendChild(buildCharacterBrief(c, false));
      bindCharacterCard(card, box, function () {
        selectedSurvivor = c.id;
        startAsSurvivor(c.id);
        AudioSys.uiClick();
      });
      box.appendChild(card);
    });
  }

  function buildHunterList() {
    var box = $('huntersel-list'); if (!box) return;
    box.innerHTML = '';
    HUNTERS.forEach(function (c) {
      var card = document.createElement('div');
      card.className = 'char-card has-brief';
      card.tabIndex = 0;
      if (card.style.setProperty) card.style.setProperty('--char-accent', c.color);
      if (card.setAttribute) {
        card.setAttribute('role', 'button');
        card.setAttribute('aria-label', '选择' + c.name + '，' + c.position + '定位；悬停或聚焦查看技能资料');
        card.setAttribute('aria-describedby', 'char-brief-' + c.id);
      }
      var cv = document.createElement('canvas');
      cv.width = 120; cv.height = 140;
      var cx = cv.getContext('2d');
      drawPortrait(cx, c, 60, 84, 40, true);
      var info = document.createElement('div');
      info.className = 'char-info';
      info.innerHTML = '<div class="cn">' + c.name + '</div><div class="ct">' + c.title + '</div>' +
        '<div class="char-summary"><span class="char-position">' + c.position + '</span>' +
        '<span class="char-active">' + c.active.name + '</span></div>' +
        '<div class="char-peek">' + (isTouch ? '点按查看战术资料' : '悬停查看战术资料') + '</div>';
      card.appendChild(cv);
      card.appendChild(info);
      card.appendChild(buildCharacterBrief(c, true));
      bindCharacterCard(card, box, function () {
        startAsHunter(c.id);
        AudioSys.uiClick();
      });
      box.appendChild(card);
    });
  }

  function buildMapList() {
    var box = $('mapsel-list'); if (!box) return;
    box.innerHTML = '';
    MAPS.forEach(function (m, i) {
      var card = document.createElement('div');
      card.className = 'char-card map-card';
      var info = document.createElement('div');
      info.className = 'char-info';
      info.innerHTML = '<div class="cn">' + m.name + '</div><div class="ct">' + m.en + '</div><div class="cs desc">' + m.desc + '</div>';
      card.appendChild(info);
      card.addEventListener('click', function () {
        selectedMap = i;
        currentSave.map = i; save();
        AudioSys.uiClick();
        showPanel('menu');
      });
      box.appendChild(card);
    });
  }

  function refreshStats() {
    var st = currentSave.stats;
    $('stat-games').textContent = st.games;
    $('stat-wins').textContent = st.wins;
    $('stat-losses').textContent = st.losses;
    $('stat-best').textContent = st.best;
  }

  /* ================= 角色立绘 ================= */
  function drawPortrait(cx, c, x, y, size, isHunter) {
    var r = size / 2;
    // 背景光圈
    var grd = cx.createRadialGradient(x, y, r * 0.2, x, y, r * 1.5);
    grd.addColorStop(0, hexA(c.color, 0.35));
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    cx.fillStyle = grd;
    cx.fillRect(x - r * 2, y - r * 2, r * 4, r * 4);

    if (isHunter) {
      // 监管者：斗篷+发光眼+武器
      cx.save();
      cx.translate(x, y);
      var st = c.style;
      cx.fillStyle = 'rgba(0,0,0,0.35)';
      cx.beginPath(); cx.ellipse(0, r * 0.95, r * 0.8, r * 0.3, 0, 0, 6.283); cx.fill();
      cx.fillStyle = st.cloak;
      cx.beginPath(); cx.moveTo(-r * 0.55, r * 0.9); cx.lineTo(r * 0.55, r * 0.9); cx.lineTo(r * 0.95, -r * 0.5); cx.lineTo(-r * 0.95, -r * 0.5); cx.closePath(); cx.fill();
      cx.fillStyle = st.trim;
      cx.beginPath(); cx.moveTo(-r * 0.25, r * 0.9); cx.lineTo(r * 0.25, r * 0.9); cx.lineTo(r * 0.05, -r * 0.4); cx.lineTo(-r * 0.05, -r * 0.4); cx.closePath(); cx.fill();
      // 兜帽
      cx.fillStyle = st.cloak;
      cx.beginPath(); cx.arc(0, -r * 0.35, r * 0.55, Math.PI, 0); cx.fill();
      // 发光眼睛
      cx.fillStyle = st.glow;
      cx.beginPath(); cx.arc(-r * 0.16, -r * 0.3, r * 0.07, 0, 6.283); cx.arc(r * 0.16, -r * 0.3, r * 0.07, 0, 6.283); cx.fill();
      // 武器
      cx.strokeStyle = '#3a3a4a';
      cx.lineWidth = r * 0.09;
      cx.beginPath(); cx.moveTo(r * 0.5, r * 0.5); cx.lineTo(r * 1.15, r * 0.1); cx.stroke();
      cx.restore();
      return;
    }

    // 求生者：身体+头+发型+帽子
    var st = c.style;
    cx.save();
    cx.translate(x, y);
    cx.fillStyle = 'rgba(0,0,0,0.3)';
    cx.beginPath(); cx.ellipse(0, r * 0.92, r * 0.55, r * 0.22, 0, 0, 6.283); cx.fill();
    // 身体(斗篷/服装)
    cx.fillStyle = st.cloak;
    cx.beginPath(); cx.moveTo(-r * 0.42, r * 0.9); cx.lineTo(r * 0.42, r * 0.9); cx.lineTo(r * 0.6, -r * 0.15); cx.lineTo(-r * 0.6, -r * 0.15); cx.closePath(); cx.fill();
    // 领口/装饰
    cx.fillStyle = st.trim;
    cx.beginPath(); cx.moveTo(-r * 0.16, r * 0.9); cx.lineTo(r * 0.16, r * 0.9); cx.lineTo(r * 0.05, -r * 0.1); cx.lineTo(-r * 0.05, -r * 0.1); cx.closePath(); cx.fill();
    // 头
    cx.fillStyle = st.skin;
    cx.beginPath(); cx.arc(0, -r * 0.35, r * 0.34, 0, 6.283); cx.fill();
    // 头发
    cx.fillStyle = st.hair;
    cx.beginPath(); cx.arc(0, -r * 0.42, r * 0.34, Math.PI, 0); cx.fill();
    // 帽子
    drawHat(cx, st.hat, st, r);
    cx.restore();
  }

  function drawHat(cx, hat, st, r) {
    cx.fillStyle = st.cloak;
    if (hat === 'nurse') {
      cx.fillStyle = '#ffffff';
      cx.beginPath(); cx.arc(0, -r * 0.55, r * 0.28, Math.PI, 0); cx.fill();
      cx.fillStyle = st.accent;
      cx.fillRect(-r * 0.06, -r * 0.75, r * 0.12, r * 0.22);
      cx.fillRect(-r * 0.2, -r * 0.68, r * 0.4, r * 0.08);
    } else if (hat === 'goggles') {
      cx.fillStyle = st.hair;
      cx.fillRect(-r * 0.42, -r * 0.52, r * 0.84, r * 0.12);
      cx.fillStyle = '#b0c0d8';
      cx.beginPath(); cx.arc(-r * 0.15, -r * 0.44, r * 0.13, 0, 6.283); cx.arc(r * 0.15, -r * 0.44, r * 0.13, 0, 6.283); cx.fill();
      cx.strokeStyle = '#4a4a5a'; cx.lineWidth = r * 0.04;
      cx.beginPath(); cx.arc(-r * 0.15, -r * 0.44, r * 0.13, 0, 6.283); cx.arc(r * 0.15, -r * 0.44, r * 0.13, 0, 6.283); cx.stroke();
    } else if (hat === 'beret') {
      cx.fillStyle = st.cloak;
      cx.beginPath(); cx.ellipse(0, -r * 0.52, r * 0.34, r * 0.16, 0, 0, 6.283); cx.fill();
    } else if (hat === 'scarf') {
      cx.fillStyle = st.accent;
      cx.beginPath(); cx.ellipse(0, -r * 0.34, r * 0.34, r * 0.1, 0, 0, 6.283); cx.fill();
      cx.strokeStyle = st.accent; cx.lineWidth = r * 0.1;
      cx.beginPath(); cx.moveTo(r * 0.2, -r * 0.2); cx.lineTo(r * 0.42, r * 0.3); cx.stroke();
    } else if (hat === 'knight') {
      cx.fillStyle = '#8a98a8';
      cx.beginPath(); cx.arc(0, -r * 0.42, r * 0.32, Math.PI, 0); cx.fill();
      cx.fillRect(-r * 0.34, -r * 0.5, r * 0.68, r * 0.08);
      cx.fillStyle = '#a8b8c8';
      cx.beginPath(); cx.moveTo(-r * 0.2, -r * 0.5); cx.lineTo(r * 0.2, -r * 0.5); cx.lineTo(r * 0.12, -r * 0.78); cx.lineTo(-r * 0.12, -r * 0.78); cx.closePath(); cx.fill();
    } else if (hat === 'hood') {
      cx.fillStyle = st.cloak;
      cx.beginPath(); cx.arc(0, -r * 0.4, r * 0.4, Math.PI, 0); cx.fill();
      cx.beginPath(); cx.moveTo(-r * 0.4, -r * 0.4); cx.lineTo(-r * 0.55, r * 0.1); cx.lineTo(-r * 0.3, r * 0.05); cx.lineTo(-r * 0.2, -r * 0.4); cx.closePath(); cx.fill();
      cx.fillStyle = '#d8e4ff';
      cx.beginPath(); cx.arc(-r * 0.12, -r * 0.3, r * 0.04, 0, 6.283); cx.arc(r * 0.12, -r * 0.3, r * 0.04, 0, 6.283); cx.fill();
    } else if (hat === 'cap') {
      // 工装鸭舌帽
      cx.fillStyle = st.accent;
      cx.beginPath(); cx.arc(0, -r * 0.5, r * 0.3, Math.PI, 0); cx.fill();
      cx.fillStyle = st.cloak;
      cx.beginPath(); cx.ellipse(0, -r * 0.52, r * 0.34, r * 0.1, 0, 0, 6.283); cx.fill();
      cx.fillStyle = st.accent;
      cx.beginPath(); cx.ellipse(r * 0.18, -r * 0.44, r * 0.22, r * 0.08, 0.1, 0, 6.283); cx.fill();
    }
  }

  /* ================= 主循环 ================= */
  function loop(t) {
    var dt = (t - lastTime) / 1000;
    lastTime = t;
    dt = Math.max(0, Math.min(0.05, dt));
    frame++;

    if (!G) return;
    // 自愈兜底：主菜单状态下若所有面板都不可见（异常/白屏）才强制回主菜单；
    // 用户在设置/角色选择等子面板时不得打断，避免点击菜单按钮被拉回主菜单
    if (G.state === 'menu') {
      var menuEl = $('menu');
      if (menuEl && menuEl.style.display !== 'flex') {
        var subPanelVisible = false;
        var subPanels = ['charsel', 'huntersel', 'mapsel', 'settings', 'tutorial', 'stats'];
        for (var pi = 0; pi < subPanels.length; pi++) {
          var pe = $(subPanels[pi]);
          if (pe && pe.style.display === 'flex') { subPanelVisible = true; break; }
        }
        if (!subPanelVisible) showPanel('menu');
      }
    }
    var stateAtFrameStart = G.state;
    if (G.state === 'playing') {
      var inp = sampleInput();
      G.updateInput(inp);
      G.update(dt);
      // 音频环境
      if (AudioSys && frame % 30 === 0) {
        if (G.state === 'playing' && !AudioSys.chaseOn && G.player && G.player.kind === 'survivor' && G.heartRate > 60) AudioSys.startChase();
        else if ((!G.player || G.player.kind !== 'survivor' || G.heartRate <= 60) && AudioSys.chaseOn) AudioSys.stopChase();
      }
    } else if (G.state === 'paused') {
      // 不更新；暂停面板幂等显示（进入 paused 的当帧 prevState 已同步为 paused，故不能依赖 prevState 判断）
      showPanel('pause');
      if (events.pause) G.togglePause(); // 再次按 P/Esc 恢复对局，避免卡在暂停界面
    }
    // 结算面板：任何方式进入 over（G.update 内部 checkWin→endMatch 触发，或外部直接调用）
    // 都必须触发一次。注意 endMatch 在 G.update 内部就把 state 置为 over，此时 prevState 尚未同步，
    // 因此不能只依赖 prevState 判断，需结合本帧开始时的 state 一并判定，确保不漏结算。
    if (G.state === 'over' && (stateAtFrameStart !== 'over' || prevState !== 'over')) {
      UI.onMatchOver();
    }
    if (G.state === 'playing' && prevState === 'paused') hideAllPanels();
    prevState = G.state;
    events.attack = false; events.interact = false; events.skill = false; events.skill2 = false; events.pause = false; events.selfHeal = false;
    uiBtn.interact = false; uiBtn.skill = false; uiBtn.skill2 = false;

    render();
    requestAnimationFrame(loop);
  }

  /* ================= 渲染 ================= */
  function render() {
    ctx.clearRect(0, 0, cw, ch);
    // 背景
    var bg = ctx.createLinearGradient(0, 0, 0, ch);
    bg.addColorStop(0, '#0b0d1a');
    bg.addColorStop(0.6, '#141226');
    bg.addColorStop(1, '#0a0a12');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, cw, ch);

    if (G.state === 'playing' || G.state === 'paused' || G.state === 'over') {
      drawWorld();
      if (G.state === 'playing' || G.state === 'paused') drawHUD();
      if (G.state === 'paused') drawPauseDim();
    } else {
      drawMenuBackdrop();
    }
  }

  /* ================= 菜单背景 ================= */
  function drawMenuBackdrop() {
    // 月亮
    var moonX = cw * 0.76, moonY = ch * 0.2;
    var mg = ctx.createRadialGradient(moonX, moonY, 4, moonX, moonY, 130);
    mg.addColorStop(0, 'rgba(190,205,255,0.9)');
    mg.addColorStop(0.3, 'rgba(150,165,230,0.35)');
    mg.addColorStop(1, 'rgba(150,165,230,0)');
    ctx.fillStyle = mg;
    ctx.beginPath(); ctx.arc(moonX, moonY, 130, 0, 6.283); ctx.fill();
    // 教堂剪影
    drawChapelSilhouette();
    // 雾
    drawFog(true);
    // 飘浮光点
    for (var i = 0; i < 26; i++) {
      var px = (i * 137.3 + frame * 0.4) % cw;
      var py = ch * 0.3 + Math.sin(i * 1.7 + frame * 0.02) * 40;
      var a = 0.08 + 0.06 * Math.sin(i * 2.1 + frame * 0.03);
      ctx.fillStyle = 'rgba(220,200,255,' + a.toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(px, py, 1.6, 0, 6.283); ctx.fill();
    }
  }

  function drawChapelSilhouette() {
    var gx = cw * 0.22, gy = ch * 0.72;
    ctx.fillStyle = 'rgba(6,7,14,0.9)';
    // 主体
    ctx.fillRect(gx - 60, gy - 90, 120, 90);
    // 塔尖
    ctx.beginPath(); ctx.moveTo(gx - 60, gy - 90); ctx.lineTo(gx, gy - 170); ctx.lineTo(gx + 60, gy - 90); ctx.closePath(); ctx.fill();
    // 尖拱窗
    ctx.fillStyle = 'rgba(255,190,90,0.28)';
    ctx.beginPath(); ctx.moveTo(gx - 34, gy); ctx.lineTo(gx - 34, gy - 46); ctx.quadraticCurveTo(gx - 34, gy - 66, gx - 14, gy - 66); ctx.lineTo(gx - 14, gy); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(gx + 14, gy); ctx.lineTo(gx + 14, gy - 46); ctx.quadraticCurveTo(gx + 14, gy - 66, gx + 34, gy - 66); ctx.lineTo(gx + 34, gy); ctx.closePath(); ctx.fill();
    // 侧塔
    ctx.fillStyle = 'rgba(6,7,14,0.9)';
    ctx.fillRect(gx - 110, gy - 50, 34, 50);
    ctx.beginPath(); ctx.moveTo(gx - 110, gy - 50); ctx.lineTo(gx - 93, gy - 84); ctx.lineTo(gx - 76, gy - 50); ctx.closePath(); ctx.fill();
  }

  /* ================= 雾 ================= */
  function drawFog(inMenu) {
    if (reducedMotion) return;
    var baseA = inMenu ? 0.032 : 0.012;
    for (var i = 0; i < fogBlobs.length; i++) {
      var b = fogBlobs[i];
      var x = (b.x * (cw + 400) - 200 + frame * b.spd * 60) % (cw + 400) - 200;
      var y = b.y * ch + Math.sin(frame * 0.005 + b.ph) * 20;
      var r = b.r * 170;
      var a = baseA * (0.5 + 0.5 * Math.sin(frame * 0.01 + b.ph));
      var g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(180,190,215,' + a.toFixed(3) + ')');
      g.addColorStop(1, 'rgba(180,190,215,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
    }
  }

  /* ================= 世界渲染 ================= */
  function drawWorld() {
    var ts = G.ts;
    var ox = G.cam.x - cw / 2, oy = G.cam.y - ch / 2;
    if (G.cam.shake > 0 && !reducedMotion) {
      ox += (Math.random() - 0.5) * G.cam.shake * 34;
      oy += (Math.random() - 0.5) * G.cam.shake * 34;
    }
    var x0 = Math.max(0, Math.floor(ox / ts) - 1), x1 = Math.min(G.cols - 1, Math.ceil((ox + cw) / ts) + 1);
    var y0 = Math.max(0, Math.floor(oy / ts) - 1), y1 = Math.min(G.rows - 1, Math.ceil((oy + ch) / ts) + 1);

    // 地板
    for (var y = y0; y <= y1; y++) {
      for (var x = x0; x <= x1; x++) {
        var c = G.grid[y][x];
        var sx = x * ts - ox, sy = y * ts - oy;
        if (c === '#' ) {
          drawWall(sx, sy, ts, x, y);
        } else {
          drawFloor(sx, sy, ts, x, y, c);
        }
      }
    }
    // 窗户
    for (var w = 0; w < G.windows.length; w++) drawWindow(G.windows[w], ox, oy, ts);
    // 板子
    for (var p = 0; p < G.pallets.length; p++) drawPallet(G.pallets[p], ox, oy, ts);
    // 密码机
    for (var m = 0; m < G.machines.length; m++) drawMachine(G.machines[m], ox, oy);
    // 处刑架
    for (var r = 0; r < G.chairs.length; r++) drawChair(G.chairs[r], ox, oy);
    // 逃生门
    for (var g = 0; g < G.gates.length; g++) drawGate(G.gates[g], ox, oy, ts);

    // 主题装饰物（可行走、不挡路，突出游乐园/医院主题）
    if (G.map && G.map.entities && G.map.entities.decors && G.map.entities.decors.length) {
      drawDecors(G.map.entities.decors, ox, oy, ts);
    }

    // 铁笼陷阱(缚骨陷阱师)：对求生者隐形，被踩中后短暂显现
    if (G.hunter && G.hunter.traps && G.hunter.traps.length) {
      for (var tp = 0; tp < G.hunter.traps.length; tp++) {
        var trapE = G.hunter.traps[tp];
        if (G.playerIsHunter || trapE.revealedT > 0) drawTrap(trapE, ox, oy, ts);
      }
    }

    // 监管者脚下状态在实体之前，避免遮住角色
    if (G.hunter) drawHunterGroundFx(G.hunter, ox, oy);

    // 实体(按 y 排序)
    var ents = [];
    for (var i = 0; i < G.survivors.length; i++) if (G.survivors[i].alive && !G.survivors[i].escaped) ents.push(G.survivors[i]);
    if (G.hunter) ents.push(G.hunter);
    ents.sort(function (a, b) { return a.y - b.y; });
    for (var e = 0; e < ents.length; e++) {
      if (ents[e].kind === 'survivor') drawSurvivor(ents[e], ox, oy);
      else drawHunter(ents[e], ox, oy);
    }

    // 锁链在实体上方，端点始终使用技能提供的世界坐标
    if (G.hunter && G.hunter.chainFx > 0) drawChainFx(G.hunter, ox, oy);

    // 粒子
    drawParticles(ox, oy);
    // 浮字
    drawFloaters(ox, oy);

    // 雾(世界)
    drawFog(false);

    // 月光冷蓝 + 暗角
    drawLighting();

    // 受击红闪
    if (G.vignette > 0) {
      ctx.fillStyle = 'rgba(200,20,20,' + (G.vignette * 0.35).toFixed(3) + ')';
      ctx.fillRect(0, 0, cw, ch);
    }

    // 相机震动
    if (G.cam.shake > 0) {
      var sh = G.cam.shake * 8;
      // 已在渲染层偏移，这里不做
    }
  }

  function hash2(x, y) { var n = x * 374761393 + y * 668265263; n = (n ^ (n >> 13)) * 1274126177; return ((n ^ (n >> 16)) >>> 0) / 4294967295; }

  function drawFloor(sx, sy, ts, x, y, c) {
    var h = hash2(x, y);
    var base = c === 'x' ? '#171526' : '#18162a';
    if (h > 0.86) base = '#1a1830';
    ctx.fillStyle = base;
    ctx.fillRect(sx, sy, ts, ts);
    // 石砖缝
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(sx + 0.5, sy + 0.5, ts - 1, ts - 1);
    // 临墙地面冷光描边，增强地图轮廓清晰度
    if (G.grid) {
      ctx.fillStyle = 'rgba(170,190,255,0.10)';
      if (y > 0 && G.grid[y - 1][x] === '#') ctx.fillRect(sx, sy, ts, 2);
      if (y < G.rows - 1 && G.grid[y + 1][x] === '#') ctx.fillRect(sx, sy + ts - 2, ts, 2);
      if (x > 0 && G.grid[y][x - 1] === '#') ctx.fillRect(sx, sy, 2, ts);
      if (x < G.cols - 1 && G.grid[y][x + 1] === '#') ctx.fillRect(sx + ts - 2, sy, 2, ts);
    }
    // 装饰：蜡烛/碎石/苔藓
    if (h > 0.93 && x % 3 !== 0 && y % 2 !== 0) drawCandle(sx + ts / 2, sy + ts / 2, h);
    else if (h > 0.8 && h <= 0.86) {
      ctx.fillStyle = 'rgba(20,26,30,0.6)';
      ctx.beginPath(); ctx.ellipse(sx + ts * 0.3, sy + ts * 0.6, ts * 0.2, ts * 0.1, 0.3, 0, 6.283); ctx.fill();
    }
  }

  function drawCandle(cx, cy, h) {
    var fl = 0.7 + 0.3 * Math.sin(frame * 0.1 + h * 40);
    ctx.fillStyle = 'rgba(235,225,190,0.85)';
    ctx.fillRect(cx - 2, cy - 6, 4, 6);
    var g = ctx.createRadialGradient(cx, cy - 8, 0, cx, cy - 8, 8 * fl);
    g.addColorStop(0, 'rgba(255,200,90,0.9)');
    g.addColorStop(1, 'rgba(255,140,40,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy - 8, 8 * fl, 0, 6.283); ctx.fill();
  }

  function drawWall(sx, sy, ts, x, y) {
    var h = hash2(x, y);
    // 砖墙：暖褐色调 + 更亮明度，与深紫黑地板形成明显区分（明度/色相双拉开）
    var g = ctx.createLinearGradient(sx, sy, sx, sy + ts);
    g.addColorStop(0, '#5b4c3d');
    g.addColorStop(1, '#332a20');
    ctx.fillStyle = g;
    ctx.fillRect(sx, sy, ts, ts);
    // 砖纹理
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(sx + 1, sy + 1, ts - 2, ts - 2);
    var half = ts / 2;
    ctx.beginPath();
    ctx.moveTo(sx + half, sy + 1); ctx.lineTo(sx + half, sy + ts - 1);
    ctx.moveTo(sx + 1, sy + half); ctx.lineTo(sx + half - (h > 0.5 ? 0 : half), sy + half);
    ctx.moveTo(sx + half, sy + half); ctx.lineTo(sx + ts - 1, sy + half);
    ctx.stroke();
    // 砖缝暖色微高亮（增强立体感，与地板进一步拉开）
    ctx.strokeStyle = 'rgba(255,230,180,0.10)';
    ctx.beginPath();
    ctx.moveTo(sx + half + 1, sy + 1); ctx.lineTo(sx + half + 1, sy + ts - 1);
    ctx.moveTo(sx + 1, sy + half + 1); ctx.lineTo(sx + half - (h > 0.5 ? 0 : half), sy + half + 1);
    ctx.moveTo(sx + half + 1, sy + half + 1); ctx.lineTo(sx + ts - 1, sy + half + 1);
    ctx.stroke();
    // 顶部高光(月光)
    if (h > 0.7) {
      ctx.fillStyle = 'rgba(190,205,250,0.26)';
      ctx.fillRect(sx, sy, ts, 3);
    }
  }

  function drawTrap(t, ox, oy, ts) {
    var sx = t.x - ox, sy = t.y - oy;
    var pulse = 0.7 + 0.3 * Math.sin(frame * 0.2);
    ctx.save();
    ctx.translate(sx, sy);
    // 地面警示圈
    ctx.fillStyle = 'rgba(255,184,96,0.16)';
    ctx.beginPath(); ctx.arc(0, 0, 12, 0, 6.283); ctx.fill();
    ctx.strokeStyle = 'rgba(255,184,96,' + (0.45 + 0.4 * pulse).toFixed(2) + ')';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 11 * pulse, 0, 6.283); ctx.stroke();
    // 铁笼
    ctx.strokeStyle = '#c8a060';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(-8, -8, 16, 16);
    ctx.beginPath(); ctx.moveTo(-8, -8); ctx.lineTo(8, 8); ctx.moveTo(8, -8); ctx.lineTo(-8, 8); ctx.stroke();
    ctx.restore();
  }

  function zoneAlpha(z) {
    var fadeIn = Math.min(1, z.t / 0.35);
    var fadeOut = Math.min(1, Math.max(0, (z.dur - z.t) / 0.55));
    return Math.min(fadeIn, fadeOut);
  }

  function drawFogZones(ox, oy) {
    if (!G.fogZones || !G.fogZones.length) return;
    for (var i = 0; i < G.fogZones.length; i++) {
      var z = G.fogZones[i], a = zoneAlpha(z);
      if (a <= 0) continue;
      var sx = z.x - ox, sy = z.y - oy;
      var pulse = reducedMotion ? 1 : 1 + Math.sin(frame * 0.06 + i) * 0.035;
      ctx.save();
      ctx.globalAlpha = a;
      var haze = ctx.createRadialGradient(sx, sy, z.radius * 0.38, sx, sy, z.radius * pulse);
      haze.addColorStop(0, 'rgba(101,88,128,0.23)');
      haze.addColorStop(0.72, 'rgba(82,76,111,0.16)');
      haze.addColorStop(1, 'rgba(50,45,76,0.03)');
      ctx.fillStyle = haze;
      ctx.beginPath(); ctx.arc(sx, sy, z.radius * pulse, 0, 6.283); ctx.fill();
      ctx.strokeStyle = 'rgba(160,137,190,0.62)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(sx, sy, z.radius, 0, 6.283); ctx.stroke();
      if (!reducedMotion) {
        ctx.strokeStyle = 'rgba(190,170,210,0.18)';
        ctx.lineWidth = 3;
        for (var w = 0; w < 3; w++) {
          var wr = z.radius * (0.45 + w * 0.16);
          ctx.beginPath();
          ctx.arc(sx + Math.sin(frame * 0.018 + w) * 5, sy + Math.cos(frame * 0.014 + w) * 4, wr, w * 1.7, w * 1.7 + 1.8);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  function drawHunterGroundFx(h, ox, oy) {
    drawFogZones(ox, oy);
    if (!(h.smashT > 0)) return;
    var sx = h.x - ox, sy = h.y - oy;
    var active = h.char.active2 || {};
    var duration = active.duration || 6;
    var progress = Math.max(0, Math.min(1, h.smashT / duration));
    var pulse = reducedMotion ? 1 : 1 + Math.sin(frame * 0.16) * 0.08;
    ctx.save();
    ctx.globalAlpha = 0.55 + progress * 0.35;
    ctx.strokeStyle = 'rgba(224,92,55,0.72)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(sx, sy + 5, 25 * pulse, 0, 6.283); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,143,73,0.42)';
    ctx.beginPath(); ctx.arc(sx, sy + 5, 34 * pulse, 0, 6.283); ctx.stroke();
    ctx.fillStyle = 'rgba(203,67,43,0.25)';
    ctx.beginPath(); ctx.arc(sx, sy + 5, 20, 0, 6.283); ctx.fill();
    for (var i = 0; i < 4; i++) {
      var ang = i * 1.57 + 0.2;
      var len = 7 + (reducedMotion ? 0 : Math.sin(frame * 0.12 + i) * 3);
      ctx.fillStyle = 'rgba(255,157,78,0.6)';
      ctx.fillRect(sx + Math.cos(ang) * 26 - 2, sy + 5 + Math.sin(ang) * 26 - 2, len, 3);
    }
    ctx.restore();
  }

  function drawChainFx(h, ox, oy) {
    var x1 = h.x - ox, y1 = h.y - oy, x2 = h.chainFxX - ox, y2 = h.chainFxY - oy;
    var dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy) || 1;
    var ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
    var a = Math.min(1, h.chainFx / 0.18);
    var hit = h.chainFxHit;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.strokeStyle = hit ? 'rgba(226,126,62,0.9)' : 'rgba(112,72,57,0.72)';
    ctx.lineWidth = hit ? 4 : 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (var i = 0; i <= 8; i++) {
      var t = i / 8, sway = (i % 2 ? 3 : -3) * (hit ? 1 : 0.7);
      var px = x1 + dx * t + nx * sway, py = y1 + dy * t + ny * sway;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.strokeStyle = hit ? 'rgba(255,211,139,0.9)' : 'rgba(122,91,78,0.45)';
    ctx.lineWidth = 1;
    for (var j = 1; j < 8; j += 2) {
      var tx = x1 + dx * (j / 8), ty = y1 + dy * (j / 8);
      ctx.beginPath(); ctx.arc(tx, ty, 4, 0, 6.283); ctx.stroke();
    }
    ctx.fillStyle = hit ? 'rgba(255,157,77,0.85)' : 'rgba(107,75,65,0.45)';
    if (hit) { ctx.beginPath(); ctx.arc(x2, y2, 6, 0, 6.283); ctx.fill(); }
    else for (var k = -1; k <= 1; k++) { ctx.beginPath(); ctx.arc(x2 + nx * k * 7 - ux * 3, y2 + ny * k * 7 - uy * 3, 2.5, 0, 6.283); ctx.fill(); }
    ctx.restore();
  }

  function drawWindow(w, ox, oy, ts) {
    var sx = w.x - ox - ts / 2, sy = w.y - oy - ts / 2;
    ctx.fillStyle = '#0a0a18';
    ctx.fillRect(sx + 4, sy + 4, ts - 8, ts - 8);
    ctx.strokeStyle = '#4a4870';
    ctx.lineWidth = 3;
    ctx.strokeRect(sx + 4, sy + 4, ts - 8, ts - 8);
    ctx.beginPath();
    ctx.moveTo(sx + ts / 2, sy + 4); ctx.lineTo(sx + ts / 2, sy + ts - 4);
    ctx.moveTo(sx + 4, sy + ts / 2); ctx.lineTo(sx + ts - 4, sy + ts / 2);
    ctx.stroke();
    // 月光透入
    ctx.fillStyle = 'rgba(160,190,255,0.26)';
    ctx.fillRect(sx + 6, sy + 6, ts - 12, ts - 12);
    ctx.strokeStyle = 'rgba(160,190,255,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(sx + 2.5, sy + 2.5, ts - 5, ts - 5);
  }

  function drawPallet(p, ox, oy, ts) {
    if (p.destroyed) return;
    var sx = p.x - ox, sy = p.y - oy;
    ctx.save();
    ctx.translate(sx, sy);
    if (p.axis === 'vertical') ctx.rotate(Math.PI / 2);
    if (p.down) {
      ctx.fillStyle = '#4a3520';
      ctx.fillRect(-18, -14, 36, 28);
      ctx.fillStyle = '#6a4a28';
      ctx.fillRect(-18, -12, 36, 4);
      ctx.fillRect(-18, 8, 36, 4);
      ctx.strokeStyle = '#2a1c0e';
      ctx.lineWidth = 1;
      for (var i = 0; i < 5; i++) { ctx.beginPath(); ctx.moveTo(-14 + i * 8, -12); ctx.lineTo(-14 + i * 8, 12); ctx.stroke(); }
      ctx.strokeStyle = 'rgba(255,190,120,0.5)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-18.5, -14.5, 37, 29);
      if (p.breakT > 0) {
        var pct = Math.min(1, p.breakT / Math.max(0.01, p.breakDur || 1.8));
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.fillRect(-19, -21, 38, 5);
        ctx.fillStyle = '#ff9a6a';
        ctx.fillRect(-18, -20, 36 * pct, 3);
      }
    } else {
      ctx.fillStyle = 'rgba(60,45,30,0.55)';
      ctx.fillRect(-16, -4, 32, 8);
      ctx.fillStyle = '#6a4a28';
      ctx.fillRect(-16, -2, 32, 4);
      ctx.strokeStyle = '#3a2818';
      for (var j = 0; j < 4; j++) { ctx.beginPath(); ctx.moveTo(-13 + j * 8, -2); ctx.lineTo(-13 + j * 8, 2); ctx.stroke(); }
      ctx.strokeStyle = 'rgba(255,210,140,0.45)';
      ctx.lineWidth = 1;
      ctx.strokeRect(-16.5, -4.5, 33, 9);
    }
    ctx.restore();
  }

  function drawMachine(m, ox, oy) {
    var sx = m.x - ox, sy = m.y - oy;
    // 底座
    ctx.fillStyle = '#2a2f3e';
    ctx.beginPath(); ctx.ellipse(sx, sy + 6, 20, 12, 0, 0, 6.283); ctx.fill();
    // 机器
    ctx.fillStyle = m.decoded ? '#3a3a3a' : '#31354a';
    ctx.fillRect(sx - 14, sy - 18, 28, 26);
    ctx.fillStyle = '#454a62';
    ctx.fillRect(sx - 10, sy - 14, 20, 6);
    ctx.strokeStyle = m.decoded ? 'rgba(120,255,160,0.4)' : 'rgba(255,210,120,0.45)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(sx - 14.5, sy - 18.5, 29, 27);
    // 顶部灯
    var glow = 0.5 + 0.5 * Math.sin(frame * 0.08 + m.x);
    ctx.fillStyle = m.decoded ? 'rgba(120,255,160,0.8)' : 'rgba(255,200,90,' + (0.6 + glow * 0.4).toFixed(2) + ')';
    ctx.beginPath(); ctx.arc(sx, sy - 20, 4 + glow, 0, 6.283); ctx.fill();
    if (!m.decoded) {
      var g = ctx.createRadialGradient(sx, sy - 20, 1, sx, sy - 20, 16);
      g.addColorStop(0, 'rgba(255,200,90,0.4)');
      g.addColorStop(1, 'rgba(255,200,90,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(sx, sy - 20, 16, 0, 6.283); ctx.fill();
    }
    // 进度
    if (m.progress > 0 && !m.decoded) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(sx - 16, sy - 28, 32, 5);
      ctx.fillStyle = '#ffd25a';
      ctx.fillRect(sx - 15, sy - 27, 30 * (m.progress / m.max), 3);
    }
    if (m.decoded) {
      ctx.fillStyle = 'rgba(120,255,160,0.7)';
      ctx.font = 'bold 10px serif';
      ctx.textAlign = 'center';
      ctx.fillText('OK', sx, sy + 2);
    }
  }

  function drawChair(c, ox, oy) {
    if (c.broken) return;
    var sx = c.x - ox, sy = c.y - oy;
    // 处刑架基座
    ctx.fillStyle = '#201c30';
    ctx.beginPath(); ctx.ellipse(sx, sy + 8, 18, 10, 0, 0, 6.283); ctx.fill();
    // 立柱
    ctx.fillStyle = '#4a2a2a';
    ctx.fillRect(sx - 4, sy - 20, 8, 30);
    // 铁钩
    ctx.strokeStyle = '#7a6a6a';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(sx, sy - 16, 10, Math.PI, 2 * Math.PI); ctx.stroke();
    // 顶部警示灯
    var bl = 0.4 + 0.6 * Math.abs(Math.sin(frame * 0.04 + c.x));
    ctx.fillStyle = c.occupant ? 'rgba(255,70,70,' + bl.toFixed(2) + ')' : 'rgba(255,90,90,0.25)';
    ctx.beginPath(); ctx.arc(sx, sy - 20, 3, 0, 6.283); ctx.fill();
    if (c.occupant) {
      // 倒计时环
      ctx.strokeStyle = 'rgba(255,120,120,0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy - 20, 9, -Math.PI / 2, -Math.PI / 2 + (1 - c.timer / c.total) * 2 * Math.PI);
      ctx.stroke();
      ctx.fillStyle = '#ffd0d0';
      ctx.font = 'bold 9px serif';
      ctx.textAlign = 'center';
      ctx.fillText(Math.ceil(c.total - c.timer), sx, sy - 2);
    }
  }

  function drawGate(g, ox, oy, ts) {
    var sx = g.x - ox, sy = g.y - oy;
    // 门洞
    ctx.fillStyle = '#0c0b18';
    ctx.fillRect(sx - 20, sy - 16, 40, 34);
    // 门框
    ctx.strokeStyle = g.powered ? '#5a6a8a' : '#3a3a50';
    ctx.lineWidth = 3;
    ctx.strokeRect(sx - 20, sy - 16, 40, 34);
    if (g.open) {
      // 开启：透出亮光
      var gg = ctx.createRadialGradient(sx, sy, 2, sx, sy, 46);
      gg.addColorStop(0, 'rgba(255,240,200,0.85)');
      gg.addColorStop(1, 'rgba(255,240,200,0)');
      ctx.fillStyle = gg;
      ctx.fillRect(sx - 46, sy - 46, 92, 92);
      ctx.fillStyle = 'rgba(255,250,220,0.9)';
      ctx.fillRect(sx - 20, sy - 16, 40, 34);
    } else if (g.progress > 0) {
      ctx.fillStyle = '#ffd25a';
      ctx.fillRect(sx - 18, sy + 12, 36 * (g.progress / 100), 4);
    }
    ctx.fillStyle = g.powered ? '#cfe0ff' : '#6a6a80';
    ctx.font = 'bold 9px serif';
    ctx.textAlign = 'center';
    ctx.fillText(g.powered ? (g.open ? '开启' : '通电·交互') : '未通电', sx, sy + 28);
  }

  /* ================= 主题装饰物 ================= */
  /* 游乐园/医院专属摆设：可行走、不挡路，仅增强主题氛围 */
  function drawDecors(decors, ox, oy, ts) {
    var name = G.map ? G.map.name : '';
    var carnival = name.indexOf('游乐园') >= 0;
    var asylum = name.indexOf('医院') >= 0;
    for (var i = 0; i < decors.length; i++) {
      var d = decors[i];
      var sx = d.x - ox, sy = d.y - oy;
      if (sx < -ts || sy < -ts || sx > 960 + ts || sy > 540 + ts) continue;
      var h = hash2(d.tx, d.ty);
      if (carnival) drawCarnivalDecor(sx, sy, h);
      else if (asylum) drawHospitalDecor(sx, sy, h);
      else drawGenericDecor(sx, sy, h);
    }
  }

  /* 游乐园：旋转木马马匹 / 棉花糖车 / 气球束 */
  function drawCarnivalDecor(sx, sy, h) {
    var k = h % 3;
    ctx.save();
    if (k < 1) {
      // 旋转木马马匹：圆杆 + 彩条
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(sx, sy + 8); ctx.lineTo(sx, sy - 10); ctx.stroke();
      ctx.fillStyle = 'rgba(255,140,200,0.9)';
      ctx.beginPath(); ctx.ellipse(sx - 4, sy - 12, 7, 5, 0, 0, 6.283); ctx.fill();
      ctx.fillStyle = 'rgba(255,210,120,0.9)';
      ctx.beginPath(); ctx.ellipse(sx + 4, sy - 12, 7, 5, 0, 0, 6.283); ctx.fill();
    } else if (k < 2) {
      // 棉花糖车：小摊
      ctx.fillStyle = 'rgba(120,80,200,0.85)';
      ctx.fillRect(sx - 9, sy - 4, 18, 12);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath(); ctx.arc(sx, sy - 10, 6, 0, 6.283); ctx.fill();
      ctx.fillStyle = 'rgba(255,120,120,0.5)';
      ctx.beginPath(); ctx.arc(sx - 4, sy - 12, 3, 0, 6.283); ctx.arc(sx + 4, sy - 12, 3, 0, 6.283); ctx.fill();
    } else {
      // 气球束
      for (var b = -1; b <= 1; b++) {
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(sx, sy + 6); ctx.lineTo(sx + b * 5, sy - 12); ctx.stroke();
        ctx.fillStyle = b < 0 ? 'rgba(255,90,90,0.9)' : (b > 0 ? 'rgba(90,200,255,0.9)' : 'rgba(255,220,80,0.9)');
        ctx.beginPath(); ctx.ellipse(sx + b * 5, sy - 15, 4, 5.5, 0, 0, 6.283); ctx.fill();
      }
    }
    ctx.restore();
  }

  /* 医院：病床 / 轮椅 / 输液架 */
  function drawHospitalDecor(sx, sy, h) {
    var k = h % 3;
    ctx.save();
    if (k < 1) {
      // 病床
      ctx.fillStyle = 'rgba(200,200,210,0.5)';
      ctx.fillRect(sx - 10, sy - 6, 20, 5);
      ctx.fillStyle = 'rgba(120,140,170,0.9)';
      ctx.fillRect(sx - 10, sy - 1, 20, 3);
      ctx.strokeStyle = 'rgba(160,170,190,0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(sx - 10, sy - 6); ctx.lineTo(sx - 10, sy + 6); ctx.moveTo(sx + 10, sy - 6); ctx.lineTo(sx + 10, sy + 6); ctx.stroke();
    } else if (k < 2) {
      // 轮椅
      ctx.strokeStyle = 'rgba(180,190,210,0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(sx, sy - 2, 6, 0, 6.283); ctx.stroke();
      ctx.fillStyle = 'rgba(120,140,170,0.8)';
      ctx.fillRect(sx - 4, sy - 8, 8, 6);
      ctx.beginPath(); ctx.moveTo(sx, sy - 8); ctx.lineTo(sx, sy - 12); ctx.stroke();
    } else {
      // 输液架
      ctx.strokeStyle = 'rgba(190,200,220,0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(sx, sy + 8); ctx.lineTo(sx, sy - 12); ctx.stroke();
      ctx.fillStyle = 'rgba(200,80,80,0.75)';
      ctx.fillRect(sx - 3, sy - 12, 6, 7);
      ctx.strokeStyle = 'rgba(160,170,190,0.7)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(sx, sy - 12); ctx.lineTo(sx + 8, sy - 18); ctx.moveTo(sx, sy - 9); ctx.lineTo(sx - 8, sy - 15); ctx.stroke();
    }
    ctx.restore();
  }

  /* 通用装饰：小碎石/木箱 */
  function drawGenericDecor(sx, sy, h) {
    ctx.save();
    ctx.fillStyle = h > 0.5 ? 'rgba(90,70,50,0.6)' : 'rgba(60,60,80,0.6)';
    ctx.fillRect(sx - 4, sy - 4, 8, 8);
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(sx - 4, sy - 4, 8, 8);
    ctx.restore();
  }

  /* ================= 角色绘制 ================= */
  function drawSurvivor(s, ox, oy) {
    var sx = s.x - ox, sy = s.y - oy;
    if (s.carriedBy) return; // 由监管者绘制
    var st = s.char.style;
    var r = 13;
    ctx.save();
    if (s.invisible > 0 && s.hp > 0) ctx.globalAlpha = 0.25;

    // 阴影
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(sx, sy + 9, r * 0.85, r * 0.32, 0, 0, 6.283); ctx.fill();

    // 倒地：横躺
    ctx.translate(sx, sy);
    if (s.hp === 0) ctx.rotate(Math.PI / 2);
    if (s.chair) { drawPortraitAt(ctx, st, s, r * 0.9, true); }
    else {
      drawPortraitAt(ctx, st, s, r, false);
      // 移动腿/走路动效
      if (Math.abs(s.moveX) > 0.01 || Math.abs(s.moveY) > 0.01) {
        var sw = Math.sin(frame * 0.25) * 3;
        ctx.fillStyle = '#2a2438';
        ctx.fillRect(-4, r * 0.8 + sw * 0.4, 4, 6);
        ctx.fillRect(2, r * 0.8 - sw * 0.4, 4, 6);
      }
    }

    // 方向指示(眼睛)
    if (!s.chair && s.hp > 0) {
      var ex = Math.cos(s.dir) * 3, ey = Math.sin(s.dir) * 3;
      ctx.fillStyle = '#1c1c28';
      ctx.beginPath(); ctx.arc(ex - 4, -r * 0.3 + ey, 1.6, 0, 6.283); ctx.arc(ex + 4, -r * 0.3 + ey, 1.6, 0, 6.283); ctx.fill();
    }

    // 护盾
    if (s.shield > 0) {
      ctx.strokeStyle = 'rgba(120,200,255,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, r + 7, 0, 6.283); ctx.stroke();
      ctx.fillStyle = 'rgba(120,200,255,0.12)';
      ctx.beginPath(); ctx.arc(0, 0, r + 7, 0, 6.283); ctx.fill();
    }
    // 受伤红晕
    if (s.hp === 1) {
      ctx.strokeStyle = 'rgba(255,60,60,0.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, r + 3, 0, 6.283); ctx.stroke();
    }
    // 受击闪白
    if (s.hurtFlash > 0) {
      ctx.fillStyle = 'rgba(255,255,255,' + (s.hurtFlash * 0.6).toFixed(2) + ')';
      ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.283); ctx.fill();
    }
    // 修机状态标记
    if (s.decoding) {
      ctx.fillStyle = 'rgba(255,210,90,0.9)';
      ctx.beginPath(); ctx.arc(0, -r - 8, 2.5, 0, 6.283); ctx.fill();
    }
    // 技能激活光环
    if (s.sprintT > 0) { ctx.strokeStyle = 'rgba(255,180,90,0.7)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, r + 5, 0, 6.283); ctx.stroke(); }
    if (s.decodeBoostT > 0) { ctx.strokeStyle = 'rgba(180,140,255,0.7)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, r + 5, 0, 6.283); ctx.stroke(); }

    ctx.restore();
    // 名字
    if (s.isPlayer) {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = 'bold 10px serif';
      ctx.textAlign = 'center';
      ctx.fillText(s.name, sx, sy - r - 12);
    }
  }

  function drawPortraitAt(ctx, st, s, r, seated) {
    // 身体
    ctx.fillStyle = st.cloak;
    ctx.beginPath(); ctx.moveTo(-r * 0.42, r * 0.75); ctx.lineTo(r * 0.42, r * 0.75); ctx.lineTo(r * 0.6, -r * 0.1); ctx.lineTo(-r * 0.6, -r * 0.1); ctx.closePath(); ctx.fill();
    ctx.fillStyle = st.trim;
    ctx.beginPath(); ctx.moveTo(-r * 0.14, r * 0.75); ctx.lineTo(r * 0.14, r * 0.75); ctx.lineTo(r * 0.05, -r * 0.06); ctx.lineTo(-r * 0.05, -r * 0.06); ctx.closePath(); ctx.fill();
    // 头
    ctx.fillStyle = st.skin;
    ctx.beginPath(); ctx.arc(0, -r * 0.32, r * 0.32, 0, 6.283); ctx.fill();
    ctx.fillStyle = st.hair;
    ctx.beginPath(); ctx.arc(0, -r * 0.38, r * 0.32, Math.PI, 0); ctx.fill();
    drawHat(ctx, st.hat, st, r);
  }

  function drawHunter(h, ox, oy) {
    var sx = h.x - ox, sy = h.y - oy;
    var st = h.char.style;
    var r = 16;
    ctx.save();
    ctx.translate(sx, sy);

    // 压迫光环
    var aura = 0.12 + 0.08 * Math.sin(frame * 0.1);
    var ag = ctx.createRadialGradient(0, 0, 4, 0, 0, 44);
    ag.addColorStop(0, 'rgba(255,60,60,' + aura.toFixed(3) + ')');
    ag.addColorStop(1, 'rgba(255,60,60,0)');
    ctx.fillStyle = ag;
    ctx.beginPath(); ctx.arc(0, 0, 44, 0, 6.283); ctx.fill();

    // 阴影
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath(); ctx.ellipse(0, 10, r * 0.95, r * 0.35, 0, 0, 6.283); ctx.fill();

    // 冲刺残影
    if (h.dashT > 0) {
      ctx.fillStyle = 'rgba(255,80,80,0.18)';
      for (var i = 1; i <= 3; i++) {
        ctx.beginPath(); ctx.arc(-Math.cos(h.dashDir) * i * 10, -Math.sin(h.dashDir) * i * 10, r, 0, 6.283); ctx.fill();
      }
    }

    // 长袍
    ctx.fillStyle = st.cloak;
    ctx.beginPath(); ctx.moveTo(-r * 0.5, r * 0.85); ctx.lineTo(r * 0.5, r * 0.85); ctx.lineTo(r * 0.9, -r * 0.45); ctx.lineTo(-r * 0.9, -r * 0.45); ctx.closePath(); ctx.fill();
    // 下摆飘动
    ctx.fillStyle = st.trim;
    ctx.beginPath(); ctx.moveTo(-r * 0.2, r * 0.85); ctx.lineTo(r * 0.2, r * 0.85); ctx.lineTo(r * 0.08, -r * 0.35); ctx.lineTo(-r * 0.08, -r * 0.35); ctx.closePath(); ctx.fill();
    // 兜帽
    ctx.fillStyle = st.cloak;
    ctx.beginPath(); ctx.arc(0, -r * 0.3, r * 0.5, Math.PI, 0); ctx.fill();
    // 发光眼
    var eg = 0.8 + 0.2 * Math.sin(frame * 0.15);
    ctx.fillStyle = st.glow;
    ctx.globalAlpha = eg;
    ctx.beginPath(); ctx.arc(-r * 0.15, -r * 0.26, 2.4, 0, 6.283); ctx.arc(r * 0.15, -r * 0.26, 2.4, 0, 6.283); ctx.fill();
    ctx.globalAlpha = 1;

    // 武器
    ctx.strokeStyle = '#6a5a5a';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    if (st.weapon === 'sickle') {
      var wx = Math.cos(h.dir) * r, wy = Math.sin(h.dir) * r;
      ctx.moveTo(0, 0); ctx.lineTo(wx + Math.cos(h.dir) * 12, wy + Math.sin(h.dir) * 12);
      ctx.stroke();
      ctx.strokeStyle = '#b8b8c8';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(wx + Math.cos(h.dir) * 16, wy + Math.sin(h.dir) * 16, 9, h.dir + 1.4, h.dir + 3.6); ctx.stroke();
    } else if (st.weapon === 'claw') {
      // 三根爪刃
      ctx.strokeStyle = '#d8d8e8'; ctx.lineWidth = 2.5;
      for (var ci = -1; ci <= 1; ci++) {
        var ca = h.dir + ci * 0.28;
        ctx.beginPath();
        ctx.moveTo(Math.cos(h.dir) * 8, Math.sin(h.dir) * 8);
        ctx.lineTo(Math.cos(ca) * 34, Math.sin(ca) * 34);
        ctx.stroke();
      }
      ctx.fillStyle = st.glow;
      ctx.globalAlpha = 0.8 + 0.2 * Math.sin(frame * 0.12);
      ctx.beginPath(); ctx.arc(Math.cos(h.dir) * 30, Math.sin(h.dir) * 30, 4, 0, 6.283); ctx.fill();
      ctx.globalAlpha = 1;
    } else if (st.weapon === 'hammer') {
      // 重锤
      ctx.strokeStyle = '#8a6a4a'; ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(Math.cos(h.dir) * 24, Math.sin(h.dir) * 24); ctx.stroke();
      ctx.fillStyle = '#6a5a4a';
      var hmx = Math.cos(h.dir) * 28, hmy = Math.sin(h.dir) * 28;
      ctx.save();
      ctx.translate(hmx, hmy); ctx.rotate(h.dir);
      ctx.fillRect(-7, -5, 14, 10);
      ctx.restore();
      ctx.fillStyle = 'rgba(255,122,80,0.85)';
      ctx.beginPath(); ctx.arc(hmx, hmy, 3.2, 0, 6.283); ctx.fill();
    } else {
      ctx.moveTo(-r * 0.5, r * 0.4); ctx.lineTo(r * 0.9, -r * 0.8);
      ctx.stroke();
      ctx.fillStyle = st.glow;
      ctx.globalAlpha = 0.8 + 0.2 * Math.sin(frame * 0.12);
      ctx.beginPath(); ctx.arc(r * 0.95, -r * 0.85, 4, 0, 6.283); ctx.fill();
      ctx.globalAlpha = 1;
    }

    // 攻击挥击
    if (h.attacking > 0) {
      var sw2 = h.attacking / 0.35;
      var ang = h.dir + (1 - sw2) * 2.2 - 1.1;
      ctx.strokeStyle = 'rgba(255,220,180,0.85)';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(0, 0, r + 22, ang, ang + 1.2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,240,220,0.25)';
      ctx.beginPath();
      ctx.arc(0, 0, r + 22, ang, ang + 1.2);
      ctx.lineTo(0, 0); ctx.closePath(); ctx.fill();
    }

    // 眩晕
    if (h.stunT > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = 'bold 14px serif'; ctx.textAlign = 'center';
      ctx.fillText('✶', 0, -r - 6);
      for (var s2 = 0; s2 < 3; s2++) {
        ctx.fillStyle = 'rgba(255,220,120,' + (0.4 + 0.4 * Math.sin(frame * 0.3 + s2)).toFixed(2) + ')';
        ctx.beginPath();
        ctx.arc(-10 + s2 * 10, -r - 12 + Math.sin(frame * 0.4 + s2) * 2, 1.5, 0, 6.283); ctx.fill();
      }
    }

    // 牵制的求生者
    if (h.carrying) {
      var cs = h.carrying;
      var cst = cs.char.style;
      ctx.translate(Math.cos(h.dir) * 20, Math.sin(h.dir) * 20);
      ctx.fillStyle = cst.cloak;
      ctx.beginPath(); ctx.moveTo(-8, 8); ctx.lineTo(8, 8); ctx.lineTo(10, -6); ctx.lineTo(-10, -6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = cst.skin;
      ctx.beginPath(); ctx.arc(0, -10, 6, 0, 6.283); ctx.fill();
      ctx.fillStyle = cst.hair;
      ctx.beginPath(); ctx.arc(0, -11, 6, Math.PI, 0); ctx.fill();
      // 挣扎进度
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(-12, -22, 24, 4);
      ctx.fillStyle = '#ffd25a';
      ctx.fillRect(-12, -22, 24 * (cs.carryStruggle / 100), 4);
    }

    ctx.restore();

    if (h.isPlayer) {
      ctx.fillStyle = 'rgba(255,150,150,0.9)';
      ctx.font = 'bold 11px serif'; ctx.textAlign = 'center';
      ctx.fillText(h.name, sx, sy - r - 14);
    }
  }

  /* ================= 光照/雾 ================= */
  function drawLighting() {
    // 冷蓝月光(左上)
    var g = ctx.createRadialGradient(cw * 0.2, ch * 0.1, 10, cw * 0.2, ch * 0.1, cw * 0.7);
    g.addColorStop(0, 'rgba(130,160,240,0.05)');
    g.addColorStop(1, 'rgba(130,160,240,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cw, ch);
    // 暗角
    var v = ctx.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.35, cw / 2, ch / 2, Math.max(cw, ch) * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,10,0.22)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, cw, ch);
  }

  /* ================= HUD ================= */
  function roundRect(cx, x, y, w, h, r) {
    cx.beginPath();
    cx.moveTo(x + r, y);
    cx.arcTo(x + w, y, x + w, y + h, r);
    cx.arcTo(x + w, y + h, x, y + h, r);
    cx.arcTo(x, y + h, x, y, r);
    cx.arcTo(x, y, x + w, y, r);
    cx.closePath();
  }

  function drawHUD() {
    var p = G.player;
    // 顶部信息条（加高 + 高对比底 + 描边）
    ctx.save();
    ctx.fillStyle = 'rgba(10,10,22,0.88)';
    ctx.fillRect(0, 0, cw, 46);
    ctx.fillStyle = 'rgba(70,220,255,0.35)';
    ctx.fillRect(0, 45, cw, 1);
    ctx.shadowColor = 'rgba(0,0,0,0.95)';
    ctx.shadowBlur = 5;
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 15px serif';
    ctx.textAlign = 'left';
    ctx.fillText(G.map.name + ' · ' + DIFF[G.difficulty].name, 14, 28);

    // 右上：剩余密码机 + 大门
    var remain = G.machinesNeededRemaining();
    var completed = MACHINES_NEEDED - remain;
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffd25a';
    ctx.font = 'bold 16px serif';
    ctx.fillText('密码机 ' + completed + '/' + MACHINES_NEEDED + ' 剩余 ' + remain, cw - 14, 28);
    var powered = G.gates[0] && G.gates[0].powered;
    ctx.fillStyle = powered ? '#9ad8ff' : '#b0b8c8';
    ctx.font = 'bold 13px serif';
    ctx.fillText('大门:' + (powered ? '已通电' : '未通电'), cw - 14, 42);
    ctx.restore();

    // 小地图
    drawMinimap();

    if (p) {
      if (p.kind === 'survivor') drawSurvivorHUD(p);
      else drawHunterHUD(p);
    }

    drawPrompt();

    // 心跳
    if (G.heartRate > 0) drawHeartbeat();

    // 校准
    if (G.check && G.player && G.player.kind === 'survivor') drawSkillCheck();

    // 蹲伏/隐身提示
    if (G.input && G.input.crouch) {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.95)';
      ctx.shadowBlur = 6;
      ctx.fillStyle = 'rgba(180,200,255,0.95)';
      ctx.font = 'bold 14px serif';
      ctx.textAlign = 'center';
      ctx.fillText('蹲伏 · 心跳降低', cw / 2, ch - 16);
      ctx.restore();
    }
  }

  function dist2(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); }

  /* 底部即时操作提示：按当前可用动作显示，减少记忆负担 */
  function drawPrompt() {
    var p = G.player;
    if (!p || G.state !== 'playing') return;
    var txt = null;
    if (p.kind === 'survivor') {
      if (p.hp === 0 && !p.channel) txt = '空格 自愈';
      else if (p.hp > 0 && !p.decoding && G.standingOnPallet(p)) txt = 'E 放下木板';
      else if (!p.decoding && !p.channel) {
        var m = G.nearestMachine(p.x, p.y, true);
        if (m && G.canDecode(p, m)) txt = (m.decoders > 0 ? 'E 合力破译密码机' : 'E 破译密码机');
        else {
          var chair = G.nearChairWithOccupant(p);
          if (chair && chair.occupant !== p) txt = 'E 救援队友';
          else {
            var ally = G.nearestHealableAlly(p);
            if (ally) txt = ally.hp === 0 ? 'E 扶起队友' : 'E 治疗队友';
            else {
              var gate = G.nearestGate(p);
              if (gate && G.canOpenGate(p, gate)) txt = 'E 开启大门';
            }
          }
        }
      }
    } else {
      if (p.wipeT > 0) txt = '擦刀…';
      else if (p.vaultT > 0) txt = '翻越中…';
      else if (p.breakingPallet) txt = '破坏木板…';
      else if (p.carrying) txt = G.nearChair(p) ? 'E 挂上处刑架' : 'E 放下';
      else {
        var downed = null;
        for (var i = 0; i < G.survivors.length; i++) {
          var s = G.survivors[i];
          if (s.alive && !s.escaped && s.hp === 0 && !s.carriedBy && !s.chair && dist2(p.x, p.y, s.x, s.y) <= 60) { downed = s; break; }
        }
        if (downed) txt = 'E 牵制';
        else if (G.nearDownPallet(p)) txt = 'E 破坏木板';
      }
    }
    if (!txt) return;
    ctx.save();
    ctx.font = 'bold 14px serif';
    var bw = txt.length * 15 + 26;
    var bx = cw / 2 - bw / 2, by = ch - 118;
    ctx.fillStyle = 'rgba(8,8,18,0.82)';
    roundRect(ctx, bx, by, bw, 26, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#ffe9b0';
    ctx.textAlign = 'center';
    ctx.fillText(txt, cw / 2, by + 18);
    ctx.restore();
  }

  function drawSurvivorHUD(s) {
    var ax = 14, ay = 52;
    // 左侧信息底板（提高对比）
    ctx.save();
    ctx.fillStyle = 'rgba(8,8,18,0.72)';
    roundRect(ctx, ax - 4, ay - 26, 210, 112, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // 头像 + 名字
    drawMiniPortrait(s.char, ax + 20, ay - 4, 20);
    ctx.shadowColor = 'rgba(0,0,0,0.95)';
    ctx.shadowBlur = 4;
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px serif';
    ctx.textAlign = 'left';
    ctx.fillText(s.name, ax + 46, ay - 10);
    ctx.fillStyle = '#cfd6e0';
    ctx.font = 'bold 11px serif';
    ctx.fillText(s.title, ax + 46, ay + 6);
    // 血量（更醒目）
    for (var i = 0; i < 2; i++) {
      ctx.beginPath();
      ctx.arc(ax + 18 + i * 20, ay + 22, 8, 0, 6.283);
      ctx.fillStyle = (s.hp > i) ? '#ff4a4a' : 'rgba(255,255,255,0.16)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.stroke();
    }
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px serif';
    ctx.fillText('HP ' + Math.max(0, s.hp), ax + 48, ay + 26);
    if (s.chair && s.hookTotal > 0) {
      ctx.fillStyle = '#ff8a8a';
      ctx.font = 'bold 15px serif';
      ctx.fillText('处刑中 ' + Math.ceil(Math.max(0, s.hookTotal - s.hookTimer)) + 's', ax + 130, ay + 26);
    } else if (s.hp === 0) {
      ctx.fillStyle = '#ff6a6a';
      ctx.font = 'bold 15px serif';
      ctx.fillText('倒地!', ax + 130, ay + 26);
    }
    if (s.hitBoostT > 0) {
      ctx.fillStyle = '#ffb06a';
      ctx.font = 'bold 12px serif';
      ctx.fillText('受击加速', ax + 130, ay + 26);
    }
    // 技能（加大加高）
    var cd = s.skillCd, max = s.char.active.cd;
    var bw = 194;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(ax, ay + 38, bw, 20);
    ctx.fillStyle = cd > 0 ? 'rgba(100,100,140,0.95)' : 'rgba(120,235,160,0.95)';
    ctx.fillRect(ax, ay + 38, bw * (1 - cd / max), 20);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 2;
    ctx.strokeRect(ax, ay + 38, bw, 20);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 13px serif';
    ctx.textAlign = 'center';
    ctx.fillText(s.char.active.name + (cd > 0 ? ' ' + Math.ceil(cd) + 's' : ' 就绪'), ax + bw / 2, ay + 53);
    ctx.restore();

    // 修机进度(左下，加大加亮)
    if (s.decoding) {
      var m = s.decoding;
      var bw2 = 260, bh2 = 22;
      var bx = cw / 2 - bw2 / 2, by = ch - 72;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur = 8;
      ctx.fillStyle = 'rgba(8,8,18,0.8)';
      ctx.fillRect(bx - 6, by - 4, bw2 + 12, bh2 + 26);
      ctx.fillStyle = '#ffd25a';
      ctx.fillRect(bx, by, bw2 * (m.progress / m.max), bh2);
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(bx, by, bw2, bh2);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 2;
      ctx.strokeRect(bx, by, bw2, bh2);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 14px serif';
      ctx.textAlign = 'center';
      ctx.fillText('破译中 ' + Math.floor(m.progress) + '% (按 交互 停止)', cw / 2, by + bh2 + 18);
      ctx.restore();
    } else if (s.channel) {
      var labels = { revive: '正在扶起队友', rescue: '正在救援', heal_other: '正在治疗队友', heal_self: '正在自疗', heal_self_down: '正在自救', gate: '正在开启大门' };
      var label = labels[s.channel.type];
      if (label) {
        var progress = Math.min(1, s.channel.progress / Math.max(0.01, s.channel.dur));
        var cbw = 260, cbh = 20;
        var cbx = cw / 2 - cbw / 2, cby = ch - 70;
        ctx.save();
        ctx.fillStyle = 'rgba(8,8,18,0.86)';
        ctx.fillRect(cbx - 6, cby - 4, cbw + 12, cbh + 28);
        ctx.fillStyle = '#7dffb0';
        ctx.fillRect(cbx, cby, cbw * progress, cbh);
        ctx.strokeStyle = 'rgba(255,255,255,0.65)';
        ctx.lineWidth = 2;
        ctx.strokeRect(cbx, cby, cbw, cbh);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 14px serif';
        ctx.textAlign = 'center';
        ctx.fillText(label + ' ' + Math.floor(progress * 100) + '%', cw / 2, cby + cbh + 19);
        ctx.restore();
      }
    }
  }

  function drawHunterHUD(h) {
    var ax = 14, ay = 52;
    ctx.save();
    ctx.fillStyle = 'rgba(8,8,18,0.72)';
    roundRect(ctx, ax - 4, ay - 26, 210, 112, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.stroke();
    drawMiniPortraitH(h.char, ax + 20, ay - 4, 20);
    ctx.shadowColor = 'rgba(0,0,0,0.95)';
    ctx.shadowBlur = 4;
    ctx.fillStyle = '#ffb0b0';
    ctx.font = 'bold 16px serif';
    ctx.textAlign = 'left';
    ctx.fillText(h.name, ax + 46, ay - 10);
    ctx.fillStyle = '#dfd0d8';
    ctx.font = 'bold 11px serif';
    ctx.fillText(h.title, ax + 46, ay + 6);
    if (h.wipeT > 0) {
      ctx.fillStyle = '#ffb0b0';
      ctx.font = 'bold 12px serif';
      ctx.textAlign = 'right';
      ctx.fillText('擦刀中…', ax + 202, ay - 10);
      ctx.textAlign = 'left';
    }
    // 技能1（加大加高）
    var cd = h.skillCd, max = h.char.active.cd;
    var bw = 194;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(ax, ay + 18, bw, 20);
    ctx.fillStyle = cd > 0 ? 'rgba(100,100,140,0.95)' : 'rgba(255,150,150,0.95)';
    ctx.fillRect(ax, ay + 18, bw * (1 - cd / max), 20);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 2;
    ctx.strokeRect(ax, ay + 18, bw, 20);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 13px serif';
    ctx.textAlign = 'center';
    ctx.fillText(h.char.active.name + (cd > 0 ? ' ' + Math.ceil(cd) + 's' : ' 就绪'), ax + bw / 2, ay + 33);
    // 技能2
    if (h.char.active2) {
      var cd2 = h.skill2Cd, max2 = h.char.active2.cd;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(ax, ay + 42, bw, 20);
      ctx.fillStyle = cd2 > 0 ? 'rgba(100,100,140,0.95)' : 'rgba(190,150,255,0.95)';
      ctx.fillRect(ax, ay + 42, bw * (1 - cd2 / max2), 20);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.strokeRect(ax, ay + 42, bw, 20);
      ctx.fillStyle = '#fff';
      var activeText = (h.smashT > 0 && h.char.active2.type === 'smash_stance') ? '生效 ' + Math.ceil(h.smashT) + 's' : (cd2 > 0 ? Math.ceil(cd2) + 's' : '就绪');
      ctx.fillText(h.char.active2.name + ' ' + activeText, ax + bw / 2, ay + 57);
    }
    // 存活求生者
    var alive = 0;
    for (var i = 0; i < G.survivors.length; i++) if (G.survivors[i].alive || G.survivors[i].escaped) alive++;
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 13px serif';
    ctx.textAlign = 'left';
    ctx.fillText('求生者剩余 ' + alive + '/3', ax + 4, ay + 80);
    ctx.restore();

    if (h.breakingPallet) {
      var p = h.breakingPallet;
      var progress = Math.min(1, h.breakT / Math.max(0.01, p.breakDur || 1.8));
      var bw2 = 260, bh2 = 20;
      var bx = cw / 2 - bw2 / 2, by = ch - 70;
      ctx.save();
      ctx.fillStyle = 'rgba(8,8,18,0.86)';
      ctx.fillRect(bx - 6, by - 4, bw2 + 12, bh2 + 28);
      ctx.fillStyle = '#ff9a6a';
      ctx.fillRect(bx, by, bw2 * progress, bh2);
      ctx.strokeStyle = 'rgba(255,255,255,0.65)';
      ctx.lineWidth = 2;
      ctx.strokeRect(bx, by, bw2, bh2);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 14px serif';
      ctx.textAlign = 'center';
      ctx.fillText('正在破坏木板 ' + Math.floor(progress * 100) + '%', cw / 2, by + bh2 + 19);
      ctx.restore();
    }
  }

  function drawMiniPortrait(ch, x, y, r) {
    var cv = document.createElement('canvas');
    cv.width = 48; cv.height = 48;
    var c = cv.getContext('2d');
    drawPortrait(c, ch, 24, 28, 22, false);
    ctx.drawImage(cv, x - r, y - r, r * 2, r * 2);
  }
  function drawMiniPortraitH(ch, x, y, r) {
    var cv = document.createElement('canvas');
    cv.width = 48; cv.height = 48;
    var c = cv.getContext('2d');
    drawPortrait(c, ch, 24, 28, 22, true);
    ctx.drawImage(cv, x - r, y - r, r * 2, r * 2);
  }

  function drawMinimap() {
    var w = 140, h = Math.round(w * G.rows / G.cols);
    if (h > 120) { h = 120; w = Math.round(120 * G.cols / G.rows); }
    var mx = cw - w - 12, my = 52;
    ctx.fillStyle = 'rgba(6,7,14,0.85)';
    ctx.fillRect(mx - 2, my - 2, w + 4, h + 4);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(mx - 2.5, my - 2.5, w + 5, h + 5);
    var cw2 = w / G.cols, ch2 = h / G.rows;
    for (var y = 0; y < G.rows; y++) {
      for (var x = 0; x < G.cols; x++) {
        var c = G.grid[y][x];
        if (c === '#') ctx.fillStyle = 'rgba(120,120,150,0.6)';
        else ctx.fillStyle = 'rgba(60,60,90,0.25)';
        ctx.fillRect(mx + x * cw2, my + y * ch2, cw2 + 0.5, ch2 + 0.5);
      }
    }
    // 迷雾禁区：与世界坐标同源，双方都能读到范围
    if (G.fogZones && G.fogZones.length) {
      for (var f = 0; f < G.fogZones.length; f++) {
        var zone = G.fogZones[f], za = zoneAlpha(zone);
        if (za <= 0) continue;
        ctx.save();
        ctx.globalAlpha = za * 0.72;
        ctx.fillStyle = 'rgba(132,102,170,0.34)';
        ctx.beginPath();
        ctx.arc(mx + zone.x / G.ts * cw2, my + zone.y / G.ts * ch2, zone.radius / G.ts * cw2, 0, 6.283);
        ctx.fill();
        ctx.strokeStyle = 'rgba(196,157,220,0.72)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
      }
    }
    // 密码机
    for (var i = 0; i < G.machines.length; i++) {
      var m = G.machines[i];
      ctx.fillStyle = m.decoded ? '#7dffb0' : '#ffd25a';
      ctx.fillRect(mx + m.tx * cw2, my + m.ty * ch2, Math.max(2, cw2), Math.max(2, ch2));
    }
    for (var j = 0; j < G.chairs.length; j++) {
      var c2 = G.chairs[j];
      if (c2.broken) continue;
      ctx.fillStyle = c2.occupant ? '#ff4040' : '#a04a4a';
      ctx.fillRect(mx + c2.tx * cw2, my + c2.ty * ch2, Math.max(2, cw2), Math.max(2, ch2));
    }
    for (var g = 0; g < G.gates.length; g++) {
      var gg = G.gates[g];
      ctx.fillStyle = gg.open ? '#9affb0' : (gg.powered ? '#9ad8ff' : '#4a6a8a');
      ctx.fillRect(mx + gg.tx * cw2, my + gg.ty * ch2, Math.max(3, cw2), Math.max(3, ch2));
    }
    // 求生者
    for (var s = 0; s < G.survivors.length; s++) {
      var sv = G.survivors[s];
      if (!sv.alive || sv.escaped || (sv.invisible > 0 && sv.hp > 0)) continue;
      ctx.fillStyle = sv.isPlayer ? '#ffffff' : '#6ab4ff';
      ctx.beginPath(); ctx.arc(mx + sv.x / G.ts * cw2, my + sv.y / G.ts * ch2, 2.5, 0, 6.283); ctx.fill();
    }
    // 监管者
    ctx.fillStyle = '#ff4040';
    ctx.beginPath(); ctx.arc(mx + G.hunter.x / G.ts * cw2, my + G.hunter.y / G.ts * ch2, 3, 0, 6.283); ctx.fill();
  }

  function drawHeartbeat() {
    var rate = G.heartRate;
    var a = Math.min(1, (rate - 40) / 120);
    var pulse = 0.5 + 0.5 * Math.sin(frame * 0.25);
    var rg = ctx.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.2, cw / 2, ch / 2, Math.max(cw, ch) * 0.6);
    rg.addColorStop(0, 'rgba(200,20,20,0)');
    rg.addColorStop(1, 'rgba(200,20,20,' + (a * 0.35 * (0.6 + 0.4 * pulse)).toFixed(3) + ')');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, cw, ch);
    // 心跳波纹
    ctx.strokeStyle = 'rgba(255,60,60,' + (a * 0.6).toFixed(2) + ')';
    ctx.lineWidth = 2;
    var pr = (frame % 60) / 60;
    ctx.beginPath(); ctx.arc(cw / 2, ch / 2, 40 + pr * 160, 0, 6.283); ctx.stroke();
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.95)';
    ctx.shadowBlur = 6;
    ctx.fillStyle = 'rgba(255,80,80,1)';
    ctx.font = 'bold 17px serif';
    ctx.textAlign = 'center';
    ctx.fillText('❤ 心跳 ' + rate, cw / 2, 60);
    ctx.restore();
  }

  function drawSkillCheck() {
    var c = G.check;
    var bw = 420, bh = 58;
    var bx = cw / 2 - bw / 2, by = ch / 2 - bh / 2;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 10;
    ctx.fillStyle = 'rgba(6,7,14,0.92)';
    roundRect(ctx, bx - 8, by - 8, bw + 16, bh + 44, 10);
    ctx.fill();
    // 轨道
    ctx.fillStyle = '#1c1c2c';
    ctx.fillRect(bx, by, bw, bh);
    // 完美区
    var zc = bx + c.zoneC * bw, zw = c.zoneW * bw;
    ctx.fillStyle = 'rgba(120,255,160,0.55)';
    ctx.fillRect(zc - zw, by, zw * 2, bh);
    // 好区
    ctx.fillStyle = 'rgba(255,220,120,0.35)';
    ctx.fillRect(zc - zw - 0.16 * bw, by, (zw * 2 + 0.32 * bw), bh);
    // 轨道描边
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 2;
    ctx.strokeRect(bx, by, bw, bh);
    // 指针
    var pos = 0.5 + Math.sin((c.t / c.period) * Math.PI * 2) * 0.42;
    var nx = bx + pos * bw;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(nx - 2, by - 8, 5, bh + 16);
    // 文本
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px serif';
    ctx.textAlign = 'center';
    ctx.fillText('校准! 按 交互(E/空格)', cw / 2, by + bh + 24);
    ctx.restore();
  }

  function drawPauseDim() {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, cw, ch);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.95)';
    ctx.shadowBlur = 6;
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font = 'bold 20px serif';
    ctx.textAlign = 'center';
    ctx.fillText('已暂停', cw / 2, 70);
    ctx.restore();
  }

  /* ================= 粒子/浮字 ================= */
  function drawParticles(ox, oy) {
    for (var i = 0; i < G.particles.length; i++) {
      var p = G.particles[i];
      var a = Math.max(0, 1 - p.t / p.life);
      var sx = p.x - ox, sy = p.y - oy;
      if (p.type === 'spark') { ctx.fillStyle = 'rgba(255,210,120,' + a.toFixed(2) + ')'; }
      else if (p.type === 'blood') { ctx.fillStyle = 'rgba(200,30,30,' + a.toFixed(2) + ')'; }
      else if (p.type === 'dust') { ctx.fillStyle = 'rgba(150,140,160,' + (a * 0.5).toFixed(2) + ')'; }
      else if (p.type === 'boom') { ctx.fillStyle = 'rgba(255,120,60,' + a.toFixed(2) + ')'; }
      else if (p.type === 'shield') { ctx.fillStyle = 'rgba(120,200,255,' + a.toFixed(2) + ')'; }
      else { ctx.fillStyle = 'rgba(255,255,255,' + a.toFixed(2) + ')'; }
      ctx.beginPath(); ctx.arc(sx, sy, p.size * a + 0.5, 0, 6.283); ctx.fill();
    }
  }

  function drawFloaters(ox, oy) {
    for (var i = 0; i < G.floaters.length; i++) {
      var f = G.floaters[i];
      var a = Math.max(0, 1 - f.t / f.life);
      ctx.globalAlpha = a;
      ctx.fillStyle = f.color;
      ctx.font = 'bold 13px serif';
      ctx.textAlign = 'center';
      ctx.fillText(f.txt, f.x - ox, f.y - oy);
    }
    ctx.globalAlpha = 1;
  }

  /* ================= 流程 ================= */
  var selectedSurvivor = 'med';
  var selectedHunter = 'hun_chase';
  var selectedMap = 0;

  UI.start = function (game) {
    G = game;
    currentSave = loadSave();
    if (currentSave.map != null) selectedMap = currentSave.map;
    UI.init();
    // 超时兜底：初始化异常时，若所有面板均不可见才强制回主菜单，避免卡在加载界面；
    // 不打断用户已打开的子面板
    setTimeout(function () {
      try {
        var menuEl = document.getElementById('menu');
        if (G && G.state === 'menu' && menuEl && menuEl.style.display !== 'flex') {
          var subVisible = false;
          var sps = ['charsel', 'huntersel', 'mapsel', 'settings', 'tutorial', 'stats'];
          for (var q = 0; q < sps.length; q++) {
            var pe2 = document.getElementById(sps[q]);
            if (pe2 && pe2.style.display === 'flex') { subVisible = true; break; }
          }
          if (!subVisible) showPanel('menu');
        }
      } catch (e) {}
    }, 1500);
  };

  function startAsSurvivor(charId) {
    if (AudioSys.startAmbience) AudioSys.startAmbience();
    // 求生者对局：AI 监管者从全部监管者中随机
    var rndHunter = HUNTERS[Math.floor(Math.random() * HUNTERS.length)].id;
    G.startMatch({
      asHunter: false, charId: charId, hunterId: rndHunter,
      mapIdx: selectedMap, difficulty: currentSave.settings.difficulty || 'normal'
    });
    setTouchRole(false);
    hideAllPanels();
  }

  function startAsHunter(hunterId) {
    if (AudioSys.startAmbience) AudioSys.startAmbience();
    G.startMatch({
      asHunter: true, charId: selectedSurvivor, hunterId: hunterId,
      mapIdx: selectedMap, difficulty: currentSave.settings.difficulty || 'normal'
    });
    setTouchRole(true);
    hideAllPanels();
  }

  function hideAllPanels() {
    var panels = ['menu', 'charsel', 'huntersel', 'mapsel', 'settings', 'tutorial', 'stats', 'pause', 'result'];
    for (var i = 0; i < panels.length; i++) { var el = $(panels[i]); if (el) el.style.display = 'none'; }
    var home = $('btn-home');
    if (home) home.style.display = 'none';
  }

  function restart() {
    var opts = G._lastOpts || {};
    G.startMatch(opts);
    setTouchRole(!!opts.asHunter);
    hideAllPanels();
  }

  function quitToMenu() {
    if (AudioSys) { AudioSys.stopChase(); AudioSys.stopHeart(); AudioSys.stopAmbience(); }
    G.state = 'menu';
    showPanel('menu');
  }

  UI.onMatchOver = function () {
    var r = G.result;
    if (!r) return;
    var d = r.detail || {};
    var titleEl = $('result-title');
    var isWin = r.winner === 'survivor_win';
    if (G.playerIsHunter) isWin = r.winner === 'hunter_win';
    titleEl.textContent = isWin ? '胜利 ✦ 逃脱黎明' : '败北 ✦ 永坠迷雾';
    titleEl.style.color = isWin ? '#ffd25a' : '#ff5050';
    $('result-score').textContent = '得分 ' + (r.score || 0);
    var lines = [];
    if (G.playerIsHunter) {
      lines.push('淘汰 ' + (d.eliminations || 0) + ' 人');
      lines.push('命中 ' + (d.hits || 0) + ' 次');
      lines.push('对手破译 ' + (d.machinesDecoded || 0) + ' 台');
      lines.push('用时 ' + (d.time || 0) + ' 秒');
    } else {
      lines.push((d.escaped ? '成功逃脱' : '未能逃脱'));
      lines.push('破译 ' + (d.decoded || 0) + ' 台 · 总进度 ' + Math.floor((G.machines ? G.machines.reduce(function (a, m) { return a + m.progress; }, 0) : 0)) + '%');
      lines.push('被追击 ' + (d.chaseT || 0) + ' 秒');
      lines.push('救援 ' + (d.rescueScore || 0) + ' 次 · 治疗 ' + (d.healScore || 0) + ' 次');
    }
    $('result-lines').innerHTML = lines.map(function (l) { return '<div>' + l + '</div>'; }).join('');
    // 存档
    currentSave.stats.games++;
    if (isWin) currentSave.stats.wins++; else currentSave.stats.losses++;
    if (r.score > currentSave.stats.best) currentSave.stats.best = r.score;
    save();
    showPanel('result');
  };

  UI.refreshResult = UI.onMatchOver;

  /* 颜色工具 */
  function hexA(hex, a) {
    var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  global.UI = UI;
  global._uiInternals = { loop: loop, render: render, sampleInput: sampleInput, drawPortrait: drawPortrait };
})(typeof window !== 'undefined' ? window : globalThis);
