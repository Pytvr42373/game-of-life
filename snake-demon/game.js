/* =====================================================================
 * game.js —— 《恶魔追逐·队友模式》主逻辑：界面 + 回合编排 + 动画 + 特效
 * 依赖：engine.js（规则引擎）、audio.js（WebAudio BGM/音效）
 * 回合：玩家掷骰(交互) → 队友自动 → 恶魔自动(晚2回合) → 恶魔抓捕检查
 * 视觉：CSS 3D 2.5D 阶梯棋盘 + SVG 建模棋子 + CSS3D 骰子立方体
 *       + Canvas 粒子特效（抓捕爆炸 / 胜利礼花 / 护盾火花）
 * ===================================================================== */
(function () {
  'use strict';

  var E = window.SnakeEngine;
  var A = window.SnakeAudio;

  /* ---------------- 工具 ---------------- */
  function $(id) { return document.getElementById(id); }
  function make(tag, cls, html) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (html !== undefined) el.innerHTML = html;
    return el;
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /* ---------------- 常量 ---------------- */
  var BOARD_SIZE = E.BOARD_SIZE;
  var ACTOR_META = {
    player: { name: '你', role: '剑士', color: 'player' },
    mate: { name: '队友', role: '法师', color: 'mate' },
    demon: { name: '恶魔', role: '角魔', color: 'demon' }
  };
  var FATE_NAMES = {
    1: '😈 后退 2 格', 2: '😈 暂停下回合', 3: '😈 失去 1 枚护盾',
    4: '😇 队友羁绊 +1', 5: '😇 再掷一次', 6: '😇 获得 1 枚护盾'
  };
  var ACTOR_IDS = ['player', 'mate', 'demon'];

  function actorName(a) {
    var m = ACTOR_META[a];
    return m ? m.name + '·' + m.role : a;
  }
  function fateName(n) { return FATE_NAMES[n] || ('命运 ' + n); }

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
    var next = document.body.dataset.theme === 'arcade' ? '4399' : 'arcade';
    applyTheme(next, true);
  });

  /* ---------------- 音效/音乐开关 ---------------- */
  var musicBtn = $('musicBtn'), soundBtn = $('soundBtn');
  var settings = { sound: true, music: true };
  try {
    var _s = JSON.parse(localStorage.getItem('snake-demon.settings.v1') || 'null');
    if (_s) { if (typeof _s.sound === 'boolean') settings.sound = _s.sound; if (typeof _s.music === 'boolean') settings.music = _s.music; }
  } catch (e) {}
  function saveSettings() {
    try { localStorage.setItem('snake-demon.settings.v1', JSON.stringify(settings)); } catch (e) {}
  }
  function paintAudioBtns() {
    musicBtn.textContent = settings.music ? '♪' : '✕';
    soundBtn.textContent = settings.sound ? '♪' : '✕';
    musicBtn.classList.toggle('off', !settings.music);
    soundBtn.classList.toggle('off', !settings.sound);
    musicBtn.setAttribute('aria-label', settings.music ? '关闭音乐' : '开启音乐');
    soundBtn.setAttribute('aria-label', settings.sound ? '关闭音效' : '开启音效');
  }
  musicBtn.addEventListener('click', function () {
    settings.music = !settings.music;
    A.setMusic(settings.music);
    saveSettings(); paintAudioBtns();
  });
  soundBtn.addEventListener('click', function () {
    settings.sound = !settings.sound;
    A.setSound(settings.sound);
    saveSettings(); paintAudioBtns();
  });

  /* ---------------- 屏幕切换 ---------------- */
  var screens = {
    start: $('startScreen'), battle: $('battleScreen'), result: $('resultScreen')
  };
  function show(name) {
    Object.keys(screens).forEach(function (k) {
      screens[k].classList.toggle('hidden', k !== name);
    });
    window.scrollTo(0, 0);
  }

  /* ---------------- 棋子的 SVG 建模（uid 保证渐变 id 全局唯一） ---------------- */
  function pieceSvg(actor, uid) {
    var u = uid || actor;
    if (actor === 'player') {
      return '<svg viewBox="0 0 64 96">' +
        '<defs><linearGradient id="' + u + '-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#67e8f9"/><stop offset="1" stop-color="#0284c7"/></linearGradient></defs>' +
        '<path d="M32 34 L17 86 L47 86 Z" fill="#0c4a6e" opacity=".95"/>' +
        '<rect x="21" y="70" width="9" height="16" rx="3" fill="#155e75"/>' +
        '<rect x="34" y="70" width="9" height="16" rx="3" fill="#155e75"/>' +
        '<rect x="18" y="83" width="13" height="8" rx="3" fill="#38bdf8"/>' +
        '<rect x="33" y="83" width="13" height="8" rx="3" fill="#38bdf8"/>' +
        '<path d="M20 40 Q20 29 32 29 Q44 29 44 40 L45 63 Q45 70 32 70 Q19 70 19 63 Z" fill="url(#' + u + '-body)"/>' +
        '<rect x="19" y="57" width="26" height="5" rx="2" fill="#082f49"/>' +
        '<circle cx="32" cy="22" r="10" fill="#e0f2fe"/>' +
        '<path d="M21 22 A11 10 0 0 1 43 22 L43 20 Q43 12 32 12 Q21 12 21 20 Z" fill="#22d3ee"/>' +
        '<path d="M21 22 L43 22 L43 26 Q32 29 21 26 Z" fill="#0e7490"/>' +
        '<circle cx="27" cy="24" r="1.7" fill="#fef08a"/><circle cx="37" cy="24" r="1.7" fill="#fef08a"/>' +
        '<g transform="rotate(-28 56 22)"><rect x="54" y="4" width="4.5" height="30" rx="2" fill="#e0f2fe"/><rect x="52.5" y="33" width="7.5" height="4.5" rx="1" fill="#f59e0b"/><rect x="55" y="32" width="7" height="3" fill="#c084fc" transform="rotate(-45 55 32)"/></g>' +
        '<path d="M12 44 Q7 52 13 62 L17 66 L21 62 Q26 52 21 44 Z" fill="#0284c7"/>' +
        '<path d="M14 46 Q10 53 15 61 L17 63 L19 61 Q24 53 19 46 Z" fill="#bae6fd" opacity=".5"/>' +
        '<ellipse cx="32" cy="90" rx="19" ry="4" fill="#22d3ee" opacity=".32"/></svg>';
    }
    if (actor === 'mate') {
      return '<svg viewBox="0 0 64 96">' +
        '<defs><linearGradient id="' + u + '-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4ade80"/><stop offset="1" stop-color="#15803d"/></linearGradient></defs>' +
        '<path d="M20 44 L16 88 L48 88 L44 44 Q32 34 20 44 Z" fill="url(#' + u + '-body)"/>' +
        '<path d="M16 80 L48 80 L48 88 L16 88 Z" fill="#14532d"/>' +
        '<path d="M16 82 L19 82 L19 88 L16 88 Z" fill="#bbf7d0"/><path d="M28 82 L31 82 L31 88 L28 88 Z" fill="#bbf7d0"/><path d="M40 82 L43 82 L43 88 L40 88 Z" fill="#bbf7d0"/>' +
        '<rect x="40" y="38" width="8" height="24" rx="4" fill="#166534"/>' +
        '<rect x="47" y="4" width="4" height="66" rx="2" fill="#78350f"/>' +
        '<circle cx="49" cy="8" r="7.5" fill="#4ade80"/><circle cx="49" cy="8" r="3.5" fill="#bbf7d0"/>' +
        '<circle cx="32" cy="28" r="10" fill="#dcfce7"/>' +
        '<path d="M20 26 Q32 2 46 24 L20 26 Z" fill="#16a34a"/>' +
        '<circle cx="30" cy="12" r="2" fill="#fde047"/><circle cx="34" cy="12" r="1.3" fill="#fef08a"/>' +
        '<circle cx="27" cy="30" r="1.7" fill="#14532d"/><circle cx="37" cy="30" r="1.7" fill="#14532d"/>' +
        '<ellipse cx="32" cy="90" rx="17" ry="4" fill="#22c55e" opacity=".32"/></svg>';
    }
    return '<svg viewBox="0 0 72 96">' +
      '<defs><linearGradient id="' + u + '-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ef4444"/><stop offset="1" stop-color="#991b1b"/></linearGradient></defs>' +
      '<path d="M14 40 Q0 30 4 16 Q14 26 16 38 Z" fill="#7f1d1d"/>' +
      '<path d="M58 40 Q72 30 68 16 Q58 26 56 38 Z" fill="#7f1d1d"/>' +
      '<path d="M36 74 Q52 84 62 76 L64 70" stroke="#991b1b" stroke-width="5" fill="none" stroke-linecap="round"/>' +
      '<path d="M22 42 Q22 30 36 28 Q50 30 50 42 L52 70 Q52 78 36 78 Q20 78 20 70 Z" fill="url(#' + u + '-body)"/>' +
      '<path d="M36 44 L42 56 L36 66 L30 56 Z" fill="#f87171" opacity=".65"/>' +
      '<rect x="16" y="44" width="9" height="24" rx="4" fill="#7f1d1d"/>' +
      '<rect x="47" y="44" width="9" height="24" rx="4" fill="#7f1d1d"/>' +
      '<path d="M14 68 L11 74 M20 68 L19 74 M52 68 L55 74 M58 68 L61 74" stroke="#fca5a5" stroke-width="3" stroke-linecap="round"/>' +
      '<path d="M24 28 Q24 12 36 12 Q48 12 48 28 L48 34 Q42 38 36 38 Q30 38 24 34 Z" fill="#dc2626"/>' +
      '<path d="M25 16 Q18 3 11 5 Q20 12 25 13 Z" fill="#fbbf24"/>' +
      '<path d="M47 16 Q54 3 61 5 Q52 12 47 13 Z" fill="#fbbf24"/>' +
      '<ellipse cx="30" cy="24" rx="3" ry="4.2" fill="#fde047"/><circle cx="30" cy="24" r="1.5" fill="#7c2d12"/>' +
      '<ellipse cx="42" cy="24" rx="3" ry="4.2" fill="#fde047"/><circle cx="42" cy="24" r="1.5" fill="#7c2d12"/>' +
      '<path d="M30 32 L42 32 L38 35 Q36 36 34 35 Z" fill="#450a0a"/>' +
      '<ellipse cx="36" cy="90" rx="21" ry="5" fill="#ef4444" opacity=".45"/></svg>';
  }

  /* ---------------- 棋盘构建 ---------------- */
  var board = $('board');
  var cellCache = {};
  function buildBoard() {
    board.innerHTML = '';
    cellCache = {};
    for (var r = 0; r < 4; r++) {
      var row = make('div', 'row row-' + r);
      for (var c = 0; c < 12; c++) {
        var pos = E.colRowToPos(r, c);
        var cell = make('div', 'cell');
        cell.dataset.pos = pos;
        var arrow = (r % 2 === 0) ? '→' : '←';
        if (E.isFate(pos)) {
          cell.classList.add('fate');
          cell.innerHTML = '<span class="num">' + pos + '</span><span class="fk">❓</span>';
        } else if (c === 11) {
          cell.innerHTML = '<span class="num">' + pos + '</span><span class="turn">↙</span>';
        } else {
          cell.innerHTML = '<span class="num">' + pos + '</span><span class="arrow">' + arrow + '</span>';
        }
        if (pos === 1) { cell.classList.add('start'); cell.innerHTML = '<span class="num">' + pos + '</span><span class="mark">起</span>'; }
        if (pos === 48) { cell.classList.add('end'); cell.innerHTML = '<span class="num">48</span><span class="mark">终</span>'; }
        row.appendChild(cell);
        cellCache[pos] = cell;
      }
      board.appendChild(row);
    }
  }
  function cellPos(pos) {
    var c = cellCache[pos];
    if (!c) return { x: 0, y: 0, w: 40, h: 28 };
    // 单元格 offsetParent 是所在行（行是 positioned），需累加行相对棋盘的偏移
    var op = c.offsetParent;
    var bx = c.offsetLeft, by = c.offsetTop;
    if (op) { bx += op.offsetLeft || 0; by += op.offsetTop || 0; }
    return { x: bx, y: by, w: c.offsetWidth, h: c.offsetHeight };
  }
  function cellAt(pos) { return cellCache[pos]; }

  /* ---------------- 棋子 ---------------- */
  var pieceEls = {};
  var pieceSizes = {};
  function createPieces() {
    ACTOR_IDS.forEach(function (a) {
      var cp = cellPos(1);
      var pw = Math.max(30, cp.w * 0.74);
      var ph = Math.round(pw * 1.85);
      var wrap = make('div', 'piece piece-' + a);
      wrap.id = 'piece-' + a;
      var body = make('div', 'piece-body');
      body.innerHTML = pieceSvg(a, 'bd-' + a);
      wrap.appendChild(body);
      var shadow = make('div', 'piece-shadow');
      wrap.appendChild(shadow);
      wrap.style.width = pw + 'px';
      wrap.style.height = ph + 'px';
      wrap.style.left = (cp.x + cp.w / 2 - pw / 2) + 'px';
      wrap.style.top = (cp.y) + 'px';
      board.appendChild(wrap);
      pieceEls[a] = wrap;
      pieceSizes[a] = { pw: pw, ph: ph };
    });
  }
  function placePiece(actor, pos, hop) {
    var p = pieceEls[actor];
    if (!p) return;
    var cp = cellPos(pos);
    var sz = pieceSizes[actor];
    p.style.left = (cp.x + cp.w / 2 - sz.pw / 2) + 'px';
    p.style.top = (cp.y) + 'px';
    if (hop) {
      p.classList.remove('hop');
      void p.offsetWidth;
      p.classList.add('hop');
    }
    p.classList.toggle('dead', false);
  }
  function resetPieces() {
    ACTOR_IDS.forEach(function (a) {
      var p = pieceEls[a];
      p.style.display = '';
      p.classList.remove('shatter', 'dead', 'hop');
      placePiece(a, 1, false);
    });
  }

  /* ---------------- 3D 骰子 ---------------- */
  var diceCubes = $('diceCubes');
  var diceLabel = $('diceLabel');
  var lastDice = {};
  var SETTLE = {
    1: 'rotateX(0deg) rotateY(0deg)',
    2: 'rotateX(-90deg) rotateY(0deg)',
    3: 'rotateX(0deg) rotateY(-90deg)',
    4: 'rotateX(0deg) rotateY(90deg)',
    5: 'rotateX(90deg) rotateY(0deg)',
    6: 'rotateX(0deg) rotateY(180deg)'
  };
  var PIPS = {
    1: [[1, 1]], 2: [[0, 0], [2, 2]], 3: [[0, 0], [1, 1], [2, 2]],
    4: [[0, 0], [0, 2], [2, 0], [2, 2]],
    5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]],
    6: [[0, 0], [0, 2], [1, 0], [1, 2], [2, 0], [2, 2]]
  };
  function buildCube(extra) {
    var cube = make('div', 'dice-cube' + (extra ? ' ' + extra : ''));
    for (var n = 1; n <= 6; n++) {
      var face = make('div', 'face f' + n);
      var dots = PIPS[n].map(function (p) {
        return '<i class="pip" style="--px:' + p[0] + ';--py:' + p[1] + '"></i>';
      }).join('');
      face.innerHTML = dots;
      cube.appendChild(face);
    }
    return cube;
  }
  var cube1 = null, cube2 = null;
  function ensureCubes(n, fate) {
    while (diceCubes.children.length > 0) diceCubes.removeChild(diceCubes.firstChild);
    cube1 = buildCube(fate ? 'fate' : '');
    diceCubes.appendChild(cube1);
    if (n === 2) { cube2 = buildCube(fate ? 'fate' : ''); diceCubes.appendChild(cube2); } else cube2 = null;
  }
  function rollCube(cube, val, dur) {
    if (!cube) return;
    cube.style.transition = 'none';
    cube.style.transform = 'rotateX(' + (540 + Math.random() * 720) + 'deg) rotateY(' + (540 + Math.random() * 720) + 'deg)';
    void cube.offsetWidth;
    cube.style.transition = 'transform ' + (dur || 750) + 'ms cubic-bezier(.16,.84,.3,1.08)';
    cube.style.transform = SETTLE[val] || SETTLE[1];
  }
  function setCubeInstant(cube, val) {
    if (!cube) return;
    cube.style.transition = 'none';
    cube.style.transform = SETTLE[val] || SETTLE[1];
  }
  function animateDice(vals, label, opts) {
    opts = opts || {};
    return new Promise(function (res) {
      ensureCubes(vals.length, !!opts.fate);
      diceLabel.textContent = label;
      diceLabel.classList.toggle('fate', !!opts.fate);
      lastDice[opts.actor || '?'] = vals.slice();
      if (opts.sound && A.sfx.dice) A.sfx.dice();
      vals.forEach(function (v, i) {
        var cube = (i === 0) ? cube1 : cube2;
        setTimeout(function () { rollCube(cube, v, opts.dur || 750); }, i * 90);
      });
      setTimeout(res, (opts.dur || 750) + vals.length * 90 + 60);
    });
  }
  function showDiceInstant(actor) {
    var vals = lastDice[actor];
    if (!vals) return;
    ensureCubes(vals.length, false);
    diceLabel.textContent = actorName(actor) + ' 掷出 ' + vals.join(' + ');
    vals.forEach(function (v, i) { setCubeInstant(i === 0 ? cube1 : cube2, v); });
  }
  /* 轻量更新：复用已渲染的骰子，避免动画后重建造成闪烁 */
  function updateDiceDisplay(actor) {
    var vals = lastDice[actor];
    if (!vals) return;
    diceLabel.textContent = actorName(actor) + ' 掷出 ' + vals.join(' + ');
    var cubes = diceCubes.children;
    for (var i = 0; i < vals.length; i++) {
      if (cubes[i]) setCubeInstant(cubes[i], vals[i]);
    }
  }
  function showFateDice(val) {
    ensureCubes(1, true);
    diceLabel.textContent = '命运之骰 ❓';
    diceLabel.classList.add('fate');
    lastDice.fate = [val];
    setCubeInstant(cube1, val);
  }

  /* ---------------- HUD ---------------- */
  function setTurn(actor) {
    ACTOR_IDS.forEach(function (a) {
      $( 'card-' + a).classList.toggle('active', a === actor);
      $( 'acStatus-' + a).classList.toggle('turn-on', a === actor);
    });
    var txt = actor === 'player' ? '你的回合' : (actor === 'mate' ? '队友回合' : '恶魔回合');
    $('hudTurn').textContent = txt;
    $('hudTurn').className = 'hud-turn turn-' + actor;
  }
  function updateRound() {
    $('hudRound').textContent = S.round;
  }
  function actorStatus(a) {
    var st = S[a];
    if (!st.alive) return '被捕';
    if (st.paused) return '暂停';
    if (a === 'demon' && S.round < 3) return '沉睡';
    return '存活';
  }
  function updateActors() {
    ACTOR_IDS.forEach(function (a) {
      var st = S[a];
      var card = $('card-' + a);
      card.classList.toggle('dead', !st.alive);
      card.classList.toggle('paused', st.paused && st.alive);
      $('acShield-' + a).textContent = (a === 'demon') ? '—' : ('🛡' + st.shield);
      if (a === 'demon' && S.round < 3) {
        $('acPos-' + a).textContent = '待机';
      } else {
        $('acPos-' + a).textContent = st.pos + ' 格';
      }
      var s = actorStatus(a);
      $('acStatus-' + a).textContent = s;
      if (a === 'demon' && S.round >= 3 && st.alive) {
        card.classList.add('hunting');
      } else {
        card.classList.remove('hunting');
      }
      if (!st.alive) {
        pieceEls[a].style.display = 'none';
      } else {
        pieceEls[a].style.display = '';
      }
    });
  }
  function updateDanger() {
    var d = S.demon;
    var level = 0, dist = null;
    if (S.round >= 3 && d.alive) {
      var min = null;
      ['player', 'mate'].forEach(function (a) {
        if (S[a].alive) {
          var dd = d.pos - S[a].pos;
          if (min === null || dd < min) min = dd;
        }
      });
      if (min !== null) {
        dist = Math.max(0, min);
        if (dist <= 6) level = 2;
        else if (dist <= 12) level = 1;
      }
    }
    A.setTension(level);
    $('hudDist').textContent = (dist === null) ? '--' : String(dist);
    $('hudDanger').classList.toggle('hot', level === 2);
    $('hudDanger').classList.toggle('warm', level === 1);
    $('dangerVignette').classList.toggle('lvl1', level === 1);
    $('dangerVignette').classList.toggle('lvl2', level === 2);
    if (pieceEls.demon) pieceEls.demon.classList.toggle('hunting', level >= 1);
  }

  /* ---------------- 日志 / 提示 ---------------- */
  var logFeed = $('logFeed');
  function say(html, cls) {
    var div = make('div', 'log-item' + (cls ? ' ' + cls : ''));
    div.innerHTML = html;
    logFeed.appendChild(div);
    while (logFeed.children.length > 80) logFeed.removeChild(logFeed.firstChild);
    logFeed.scrollTop = logFeed.scrollHeight;
  }
  var toastEl = $('toast');
  var toastTimer = null;
  function toast(html, cls) {
    toastEl.innerHTML = html;
    toastEl.className = 'toast show ' + (cls || '');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.className = 'toast'; }, 1600);
  }
  function clearLog() { logFeed.innerHTML = ''; }

  /* ---------------- Canvas 粒子特效 ---------------- */
  var fx = { c: null, x: null, parts: [], raf: 0 };
  function fxInit() {
    fx.c = $('fxCanvas');
    fx.x = fx.c.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    (function loop() {
      fx.raf = requestAnimationFrame(loop);
      update();
    })();
  }
  function resize() {
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    fx.c.width = window.innerWidth * dpr;
    fx.c.height = window.innerHeight * dpr;
    fx.c.style.width = window.innerWidth + 'px';
    fx.c.style.height = window.innerHeight + 'px';
    fx.x.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function burst(x, y, colors, n, power) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2;
      var sp = (0.3 + Math.random() * 0.9) * power;
      fx.parts.push({
        x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - power * 0.25,
        g: 0.12, life: 1, decay: 0.014 + Math.random() * 0.02,
        size: 2 + Math.random() * 4.5,
        color: colors[(Math.random() * colors.length) | 0]
      });
    }
  }
  function confettiRain() {
    for (var i = 0; i < 140; i++) {
      fx.parts.push({
        x: Math.random() * window.innerWidth,
        y: -10 - Math.random() * window.innerHeight * 0.4,
        vx: (Math.random() - 0.5) * 1.6, vy: 0.6 + Math.random() * 1.8,
        g: 0.06, life: 1, decay: 0.004 + Math.random() * 0.005,
        size: 2.5 + Math.random() * 4,
        color: ['#f5c518', '#fde047', '#fbbf24', '#f59e0b', '#fef08a', '#f8fafc', '#fca5a5'][(Math.random() * 7) | 0],
        rot: Math.random() * Math.PI * 2, vr: (Math.random() - 0.5) * 0.3, rect: true
      });
    }
  }
  function update() {
    var x = fx.x;
    x.clearRect(0, 0, window.innerWidth, window.innerHeight);
    for (var i = fx.parts.length - 1; i >= 0; i--) {
      var p = fx.parts[i];
      p.vy += p.g;
      p.x += p.vx;
      p.y += p.vy;
      p.life -= p.decay;
      if (p.rot !== undefined) p.rot += p.vr;
      if (p.life <= 0 || p.y > window.innerHeight + 20) { fx.parts.splice(i, 1); continue; }
      x.globalAlpha = Math.max(0, p.life);
      if (p.rect) {
        x.save();
        x.translate(p.x, p.y);
        x.rotate(p.rot);
        x.fillStyle = p.color;
        x.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        x.restore();
      } else {
        x.fillStyle = p.color;
        x.beginPath();
        x.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
        x.fill();
      }
    }
    x.globalAlpha = 1;
  }
  function shake() {
    var b = $('battleScreen');
    b.classList.remove('shake');
    void b.offsetWidth;
    b.classList.add('shake');
  }
  function redFlash() {
    var r = $('redFlash');
    r.classList.remove('flash');
    void r.offsetWidth;
    r.classList.add('flash');
  }
  function fateFlash(pos) {
    var c = cellAt(pos);
    if (!c) return;
    c.classList.remove('active');
    void c.offsetWidth;
    c.classList.add('active');
    setTimeout(function () { c.classList.remove('active'); }, 900);
  }
  function shieldFX(actor, kind) {
    var card = $('card-' + actor);
    card.classList.remove('fx-shield', 'fx-lose', 'fx-block');
    void card.offsetWidth;
    card.classList.add(kind === 'gain' ? 'fx-shield' : (kind === 'block' ? 'fx-block' : 'fx-lose'));
    var cp = cellPos(S[actor].pos);
    var rect = pieceEls[actor] ? pieceEls[actor].getBoundingClientRect() : null;
    if (rect) burst(rect.left + rect.width / 2, rect.top + rect.height * 0.4, ['#4ade80', '#bbf7d0', '#fde047', '#fef08a'], 26, 4.5);
  }
  function cardPulse(actor, kind) {
    var card = $('card-' + actor);
    card.classList.remove('fx-pause');
    void card.offsetWidth;
    card.classList.add('fx-pause');
  }
  function captureFX(victim) {
    var p = pieceEls[victim];
    var rect = p.getBoundingClientRect();
    var x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    shake();
    redFlash();
    burst(x, y, ['#ef4444', '#f87171', '#fca5a5', '#fbbf24', '#7f1d1d', '#fecaca'], 70, 9);
    p.classList.add('shatter');
    A.sfx.capture();
    toast('💀 ' + actorName(victim) + ' 被恶魔撕碎！', 'danger-toast');
    return sleep(900);
  }
  function victoryFX() {
    shake();
    confettiRain();
    burst(window.innerWidth / 2, window.innerHeight * 0.4, ['#f5c518', '#fde047', '#fbbf24', '#fff7c0'], 60, 7);
    $('victoryPillar').classList.add('on');
    A.sfx.win();
  }

  /* ---------------- 移动动画 ---------------- */
  function moveMsg(e) {
    var nm = actorName(e.actor);
    var stepN = Math.abs(e.to - e.from);
    if (e.cause === 'roll') return nm + ' 前进 ' + stepN + ' 格 → 第 ' + e.to + ' 格';
    if (e.cause === 'fate-back') return nm + ' 被命运拉回 ' + stepN + ' 格 → 第 ' + e.to + ' 格';
    if (e.cause === 'fate-noshield') return nm + ' 失去护盾后退 1 格 → 第 ' + e.to + ' 格';
    if (e.cause === 'fate-bond') return '😇 ' + nm + ' 羁绊前进 1 格 → 第 ' + e.to + ' 格';
    if (e.cause === 'bond') return '😇 羁绊：' + nm + ' 连带前进 1 格 → 第 ' + e.to + ' 格';
    return nm + ' 移动 → 第 ' + e.to + ' 格';
  }
  function skipMsg(e) {
    if (e.reason === 'late') return '👹 恶魔仍在沉睡，未出发…';
    if (e.reason === 'paused') return actorName(e.actor) + ' 被暂停，本轮跳过';
    return actorName(e.actor) + ' 已离开棋盘';
  }
  async function animateMove(actor, from, to, cause) {
    var dir = to > from ? 1 : -1;
    var cur = from;
    var guard = 0;
    while (cur !== to && guard++ < 64) {
      cur += dir;
      placePiece(actor, cur, true);
      if (A.sfx.step) A.sfx.step();
      await sleep(168);
    }
  }

  /* ---------------- 事件播放 ---------------- */
  async function playEvents(evs) {
    for (var i = 0; i < evs.length; i++) {
      var e = evs[i];
      if (e.type === 'round') { continue; }
      if (e.type === 'roll') {
        updateDiceDisplay(e.actor);
        say(actorName(e.actor) + ' 掷出 <b>' + e.roll + '</b>');
      } else if (e.type === 'move') {
        await animateMove(e.actor, e.from, e.to, e.cause);
        say(moveMsg(e));
      } else if (e.type === 'fate') {
        fateFlash(e.cell);
        showFateDice(e.roll);
        if (A.sfx.fate) A.sfx.fate();
        say('❓ 落在命运格 ' + e.cell + '，命运之骰：<b>' + e.roll + '</b>（' + fateName(e.roll) + '）');
        await sleep(640);
      } else if (e.type === 'reroll') {
        say('✨ 再掷一次！');
        if (A.sfx.shield) A.sfx.shield();
        await sleep(430);
      } else if (e.type === 'gainShield') {
        shieldFX(e.actor, 'gain');
        if (A.sfx.shield) A.sfx.shield();
        say('🛡 ' + actorName(e.actor) + ' 获得 1 枚护盾');
      } else if (e.type === 'loseShield') {
        shieldFX(e.actor, 'lose');
        if (A.sfx.block) A.sfx.block();
        say(actorName(e.actor) + ' 失去 1 枚护盾');
      } else if (e.type === 'shieldBlock') {
        shieldFX(e.actor, 'block');
        if (A.sfx.block) A.sfx.block();
        var blk = e.blocked === 'back2' ? '😈 后退 2 格' : '😈 暂停下回合';
        say('🛡 护盾完全免疫「' + blk + '」！');
      } else if (e.type === 'pause') {
        cardPulse(e.actor, 'pause');
        if (A.sfx.pause) A.sfx.pause();
        say('⏸ ' + actorName(e.actor) + ' 被暂停，下回合跳过');
      } else if (e.type === 'skip') {
        say(skipMsg(e));
        await sleep(420);
      } else if (e.type === 'capture') {
        await captureFX(e.victim);
        say('💀 ' + actorName(e.victim) + ' 被恶魔抓捕，撕碎了！');
      } else if (e.type === 'win' || e.type === 'lose') {
        // 结算统一在 endGame 处理
      }
      updateActors();
      updateDanger();
      await sleep(230);
    }
    updateActors();
    updateDanger();
  }

  /* ---------------- 游戏流程 ---------------- */
  var S = null;
  var rollBtn = $('rollBtn');
  var rollWait = null;
  var busy = false;
  function enableRoll() { rollBtn.disabled = false; rollBtn.classList.add('on'); }
  function disableRoll() { rollBtn.disabled = true; rollBtn.classList.remove('on'); }
  rollBtn.addEventListener('click', function () {
    if (!rollWait || busy) return;
    A.unlock(); // 在用户手势内恢复 AudioContext，保证掷骰音效可播放
    var r = rollWait; rollWait = null;
    r();
  });
  function waitRoll() { return new Promise(function (res) { rollWait = res; }); }

  function startGame() {
    S = E.newGame();
    busy = false;
    rollWait = null;
    clearLog();
    resetPieces();
    updateRound();
    updateActors();
    updateDanger();
    show('battle');
    disableRoll();
    $('victoryPillar').classList.remove('on');
    A.startMusic();
    toast('🔥 恶魔已苏醒，快跑！', 'info-toast');
    say('第 1 回合开始：你与队友先手，恶魔晚 2 回合出发。');
    performActorTurn('player');
  }

  async function performActorTurn(actor) {
    if (S.winner) return finish();
    setTurn(actor);
    if (actor === 'player') {
      if (!S.player.alive || S.player.paused) {
        var ev0 = E.stepActor(S, 'player', 0, Math.random);
        await playEvents(ev0);
        await sleep(320);
        return performActorTurn('mate');
      }
      enableRoll();
      A.unlock();
      await waitRoll();
      disableRoll();
      var roll = E.d6();
      await animateDice([roll], '你的回合 · 掷骰', { actor: 'player', sound: true });
      var evs = E.stepActor(S, 'player', roll, Math.random);
      await playEvents(evs);
      await sleep(330);
      if (S.winner) return finish();
      return performActorTurn('mate');
    }
    if (actor === 'mate') {
      await sleep(520);
      if (!S.mate.alive || S.mate.paused) {
        var evm = E.stepActor(S, 'mate', 0, Math.random);
        await playEvents(evm);
        await sleep(300);
        if (S.winner) return finish();
        return performActorTurn('demon');
      }
      var mr = E.d6();
      await animateDice([mr], '队友回合 · 掷骰', { actor: 'mate', sound: true });
      var evsM = E.stepActor(S, 'mate', mr, Math.random);
      await playEvents(evsM);
      await sleep(300);
      if (S.winner) return finish();
      return performActorTurn('demon');
    }
    /* demon */
    await sleep(560);
    if (S.round < 3) {
      var evd0 = E.stepActor(S, 'demon', 0, Math.random);
      await playEvents(evd0);
    } else {
      var d1 = E.d6(), d2 = E.d6();
      await animateDice([d1, d2], '恶魔回合 · 2d6', { actor: 'demon', sound: true });
      var evsD = E.stepActor(S, 'demon', d1 + d2, Math.random);
      await playEvents(evsD);
    }
    await sleep(360);
    if (S.winner) return finish();
    S.round += 1;
    updateRound();
    return performActorTurn('player');
  }

  function finish() {
    busy = true;
    disableRoll();
    A.stopMusic();
    A.setTension(0);
    var win = S.winner === 'human';
    if (win) {
      victoryFX();
      setTimeout(function () { showResult(true); }, 1900);
    } else {
      shake(); redFlash();
      if (A.sfx.lose) A.sfx.lose();
      setTimeout(function () { showResult(false); }, 1500);
    }
  }
  function showResult(win) {
    $('rKicker').textContent = win ? 'VICTORY' : 'DEFEAT';
    $('rTitle').textContent = win ? '人类胜利' : '恶魔胜利';
    $('rTitle').className = win ? 'win-title' : 'lose-title';
    $('rReason').textContent = S.winReason || (win ? '你与队友成功逃离炼狱' : '人类全军覆没');
    var stats = [
      ['回合数', S.round],
      ['玩家位置', S.player.alive ? S.player.pos + ' 格' : '被捕'],
      ['队友位置', S.mate.alive ? S.mate.pos + ' 格' : '被捕'],
      ['恶魔位置', S.demon.pos + ' 格'],
      ['玩家护盾', S.player.shield],
      ['队友护盾', S.mate.shield]
    ];
    $('rStats').innerHTML = stats.map(function (s) {
      return '<div class="r-stat"><span>' + s[0] + '</span><b>' + s[1] + '</b></div>';
    }).join('');
    $('resultInner').classList.toggle('win', win);
    show('result');
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    A.init();
    applyTheme((function () { try { return localStorage.getItem('gh-theme') === 'arcade' ? 'arcade' : '4399'; } catch (e) { return '4399'; } })(), false);
    paintAudioBtns();
    buildBoard();
    createPieces();
    ensureCubes(1, false);
    fxInit();
    // 开始界面图例棋子 + 对局 HUD 头像
    ACTOR_IDS.forEach(function (a) {
      var el = $('leg' + (a === 'player' ? 'Player' : a === 'mate' ? 'Mate' : 'Demon'));
      if (el) el.innerHTML = pieceSvg(a, 'leg-' + a);
      var ico = $('acIco-' + a);
      if (ico) ico.innerHTML = pieceSvg(a, 'ico-' + a);
    });
    $('startBtn').addEventListener('click', function () { A.unlock(); startGame(); });
    $('againBtn').addEventListener('click', function () { startGame(); });
    $('resultHomeBtn').addEventListener('click', function () {
      window.location.href = '../action-games/index.html';
    });
    show('start');
    // loader 淡出
    var loader = $('loader');
    setTimeout(function () {
      loader.classList.add('done');
      setTimeout(function () { loader.style.display = 'none'; }, 500);
    }, 450);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
