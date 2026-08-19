/* =====================================================================
 * game.js —— 《打字对决 TYPE DUEL》核心游戏引擎
 * 上层：TDCORE 纯逻辑层（可 node 自测，module.exports）。
 * 下层：浏览器游戏引擎（状态机 + 玩法 + canvas 霓虹矩阵战场渲染）。
 * 依赖：words.js (window.WORDS)、stats.js (window.TypeDuelStats)、audio.js (window.TypeDuelAudio)。
 * ===================================================================== */
(function () {
  'use strict';

  /* ================================================================
   * TDCORE —— 纯逻辑层（与 DOM 无关，供 node 自测 / 浏览器共用）
   * ================================================================ */
  var TDCORE = (function () {

    /* —— 经典关卡表（§5.4） —— */
    var LEVELS = [
      { tier: 1, beat: 1200, spawn: 2400, cap: 4 },
      { tier: 1, beat: 1150, spawn: 2200, cap: 5 },
      { tier: 1, beat: 1100, spawn: 2000, cap: 6, boss: 'A' },
      { tier: 2, beat: 1050, spawn: 1900, cap: 6 },
      { tier: 2, beat: 1000, spawn: 1800, cap: 7 },
      { tier: 2, beat: 950, spawn: 1700, cap: 8, boss: 'B' },
      { tier: 3, beat: 900, spawn: 1600, cap: 8 },
      { tier: 3, beat: 850, spawn: 1500, cap: 9 },
      { tier: 3, beat: 800, spawn: 1400, cap: 9, boss: 'C' },
      { tier: 4, beat: 750, spawn: 1300, cap: 10 },
      { tier: 4, beat: 700, spawn: 1200, cap: 10 },
      { tier: 4, beat: 650, spawn: 1100, cap: 10, boss: 'D' }
    ];

    /* —— 难度档（§4.1） —— */
    var DIFFS = {
      normal:  { scoreMult: 1.0, speedAdd: 0.00, beatMult: 1.0, hearts: 5 },
      hard:    { scoreMult: 1.3, speedAdd: 0.15, beatMult: 0.9, hearts: 4 },
      inferno: { scoreMult: 1.6, speedAdd: 0.30, beatMult: 0.8, hearts: 3 }
    };
    var DIFF_ORDER = ['normal', 'hard', 'inferno'];

    /* —— 限时档位（§4.2） —— */
    var SPRINT_TIERS = {
      short:    { tiers: [1, 2], mult: 1.0, beat: 900,  spawn: 1700, cap: 8 },
      standard: { tiers: [2, 3], mult: 1.2, beat: 800,  spawn: 1500, cap: 8 },
      long:     { tiers: [3, 4], mult: 1.4, beat: 700,  spawn: 1300, cap: 9 }
    };

    /* —— 敌人基础速度倍率（§3.1） —— */
    var ENEMY_SPEED = {
      common: 1.0, shield: 0.9, quick: 1.6, shuffle: 0.9,
      bonus: 0.7, skill: 0.8, boss: 0
    };

    function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

    /* 连击倍率：1 + 0.1×min(combo,10)，10 连击封顶（§4.4） */
    function comboMult(combo) { return 1 + 0.1 * Math.min(combo, 10); }

    /* 单敌得分（§4.1/§4.3/§3.1） */
    /* opts: {len, type, diffMult, comboMult, modeMult} */
    function scoreWord(opts) {
      var base = opts.len * 10 * (opts.diffMult || 1) * (opts.comboMult || 1) * (opts.modeMult || 1);
      if (opts.type === 'bonus') base *= 3;
      if (opts.type === 'quick' || opts.type === 'shuffle') base *= 1.5;
      if (opts.type === 'shield') base *= 1.2; /* 本体词 */
      return Math.round(base);
    }
    var SHIELD_BREAK_BONUS = 50;
    function bossSegmentScore(len) { return 20 * len; }
    function bossKillBonus(diffMult) { return Math.round(500 * (diffMult || 1)); }

    /* 生存衰减：基础 3 HP/s，每 30s +1，上限 8（§4.3） */
    function survivalDecay(t) { return Math.min(8, 3 + Math.floor(t / 30)); }
    /* 生存回血：2-4字+1、5-7字+2、8字以上+3（§4.3） */
    function survivalHeal(len) { return len >= 8 ? 3 : (len >= 5 ? 2 : 1); }
    /* 生存刷怪间隔分级（§4.3） */
    function survivalSpawnMs(t) { return t >= 90 ? 1200 : (t >= 60 ? 1400 : (t >= 30 ? 1700 : 2000)); }
    /* 生存词长档（§4.3） */
    function survivalTiers(t) { return t >= 90 ? [3, 4] : (t >= 60 ? [2, 3] : [1, 2]); }
    /* 生存触底掉血：重排/加速 -15，其余 -10（§4.3） */
    function survivalBreachDmg(type) { return (type === 'quick' || type === 'shuffle') ? 15 : 10; }

    function levelConfig(stage) { return LEVELS[clamp(stage, 1, 12) - 1]; }
    function difficulty(name) { return DIFFS[name] || DIFFS.normal; }
    function sprintTier(name) { return SPRINT_TIERS[name] || SPRINT_TIERS.standard; }
    function enemySpeed(type) { return ENEMY_SPEED[type] || 1.0; }

    /* 通关解锁下一难度（§4.1） */
    function nextDifficulty(cur) {
      var i = DIFF_ORDER.indexOf(cur);
      return (i >= 0 && i < DIFF_ORDER.length - 1) ? DIFF_ORDER[i + 1] : null;
    }

    /* Boss 段长区间（§5.4） */
    function bossSegLen(letter) {
      return { A: [5, 6], B: [6, 7], C: [7, 8], D: [8, 10] }[letter] || [5, 6];
    }

    /* 模式解锁（任务2）：初始仅开放「经典闯关」；通关经典第 4 关解锁「限时冲刺」、
     * 通关第 8 关解锁「无尽生存」。基于经典闯关跨难度最高关卡进度推导（stage 记录为
     * 下一关，通关第 N 关 → stage = N+1，故阈值 = N+1）。 */
    var MODE_UNLOCK_STAGE = { campaign: 1, sprint: 5, survival: 9 };
    function modeUnlockStage(mode) { return MODE_UNLOCK_STAGE[mode] || 1; }
    function isModeUnlocked(mode, prog) {
      if (mode === 'campaign') return true;
      var p = prog || {};
      var stage = p.stage || {};
      var maxStage = Math.max(stage.normal || 1, stage.hard || 1, stage.inferno || 1);
      return maxStage >= modeUnlockStage(mode);
    }

    return {
      LEVELS: LEVELS, DIFFS: DIFFS, SPRINT_TIERS: SPRINT_TIERS, DIFF_ORDER: DIFF_ORDER,
      clamp: clamp, comboMult: comboMult, scoreWord: scoreWord,
      SHIELD_BREAK_BONUS: SHIELD_BREAK_BONUS,
      bossSegmentScore: bossSegmentScore, bossKillBonus: bossKillBonus,
      survivalDecay: survivalDecay, survivalHeal: survivalHeal,
      survivalSpawnMs: survivalSpawnMs, survivalTiers: survivalTiers,
      survivalBreachDmg: survivalBreachDmg,
      levelConfig: levelConfig, difficulty: difficulty, sprintTier: sprintTier,
      enemySpeed: enemySpeed, nextDifficulty: nextDifficulty, bossSegLen: bossSegLen,
      modeUnlockStage: modeUnlockStage, isModeUnlocked: isModeUnlocked
    };
  })();

  if (typeof module !== 'undefined' && module.exports) { module.exports = TDCORE; }
  if (typeof window !== 'undefined') { window.TDCORE = TDCORE; }

  /* ================================================================
   * 浏览器游戏引擎
   * ================================================================ */
  if (typeof window === 'undefined' || typeof document === 'undefined') { return; }

  (function () {
    var WORDS = window.WORDS;
    var AUDIO = window.TypeDuelAudio;
    var STATS = window.TypeDuelStats;
    var C = TDCORE;

    /* —— 画布常量（§2.1） —— */
    var COLS = 9, ROWS = 8, CELL_W = 100, CELL_H = 72;
    var CW = 960, CH = 640;
    var GRID_OX = (CW - COLS * CELL_W) / 2;       /* 30 */
    var DEF_Y = 568;                               /* 防线带顶部 */
    var DEF_H = CH - DEF_Y;                        /* 72 */

    function colX(c) { return GRID_OX + c * CELL_W + CELL_W / 2; }
    function rowY(r) { return r * CELL_H + CELL_H / 2; }

    var NEON = {
      bg1: '#050a14', bg2: '#0a1428',
      grid: 'rgba(70,215,232,.12)',
      common: '#e6f7ff', commonB: 'rgba(70,215,232,.55)',
      lock: 'rgba(70,215,232,.9)',
      ok: '#7ef0ff', err: '#ff4757',
      shield: '#ffd166', quick: '#ff5d5d', shuffle: '#c792ea',
      bonus: '#ffd700', skill: '#4ade80',
      bullet: '#c9f4ff', band: '#46d7e8', danger: 'rgba(255,71,87,.35)'
    };

    var el = function (id) { return document.getElementById(id); };
    var rand = function (a, b) { return a + Math.random() * (b - a); };
    function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

    /* ================= Game 类 ================= */
    function Game() {
      this.doc = document;
      this.canvas = el('arena');
      this.ctx = this.canvas.getContext('2d');
      this.state = 'MENU';
      this.mode = 'campaign';
      this.difficulty = 'normal';
      this.sprintTier = 'standard';
      this.settings = STATS.getSettings();
      this.running = false;
      this.audioUnlocked = false;
      this.keysLocked = false; /* 防止平台组合键触发 */

      this.themeEl = el('themeToggle');
      this.initTheme();
      this.initMenu();
      this.initPanels();
      this.initInput();
      this.updateModeUI();
      this.refreshMenuData();
      this.showMenu();

      AUDIO.playBgm('menu');
      this.lastFrame = performance.now();
      var self = this;
      requestAnimationFrame(function (n) { self.frame(n); });
    }

    /* ---------------- 主题（频道双主题，§STYLE_GUIDE） ---------------- */
    Game.prototype.initTheme = function () {
      var self = this;
      this.applyTheme(localStorage.getItem('gh-theme') === 'arcade' ? 'arcade' : '4399', false);
      if (this.themeEl) {
        this.themeEl.addEventListener('click', function () {
          var next = self.doc.body.dataset.theme === 'arcade' ? '4399' : 'arcade';
          var loader = el('loader');
          if (loader && !self.settings.reducedFx) {
            loader.classList.add('on');
            setTimeout(function () { self.applyTheme(next, true); loader.classList.remove('on'); }, 350);
          } else {
            self.applyTheme(next, true);
          }
        });
      }
    };
    Game.prototype.themeIcon = function (arcade) {
      if (arcade) {
        return '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M12 12 L21 6 A10 10 0 1 0 21 18 Z"/><circle cx="13.5" cy="7.5" r="1.1" fill="#ffffff"/></svg>';
      }
      return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3C9.8 3 8 4.8 8 7c0 .6.1 1.2.4 1.7C6.5 9.4 5.2 11 5.2 13c0 2.2 1.8 4 4 4h5.6c2.2 0 4-1.8 4-4 0-2-1.3-3.6-3.2-4.3.3-.5.4-1.1.4-1.7 0-2.2-1.8-4-4-4z"/><path d="M12 17v4"/><path d="M12 21l-3 2M12 21l3 2"/></svg>';
    };
    Game.prototype.applyTheme = function (theme, persist) {
      this.doc.body.dataset.theme = theme;
      if (persist !== false) { try { localStorage.setItem('gh-theme', theme); } catch (e) {} }
      if (this.themeEl) {
        var target = theme === 'arcade' ? '4399' : 'arcade';
        this.themeEl.innerHTML = this.themeIcon(target === 'arcade');
        var label = target === 'arcade' ? '切换到街机主题' : '切换到清新主题';
        this.themeEl.setAttribute('aria-label', label);
        this.themeEl.title = label;
      }
    };

    /* ---------------- 菜单 ---------------- */
    Game.prototype.initMenu = function () {
      var self = this;
      var on = function (id, fn) { var n = el(id); if (n) n.addEventListener('click', fn); };

      on('modeCampaign', function () { self.mode = 'campaign'; self.updateModeUI(); });
      on('modeSprint', function () {
        if (!C.isModeUnlocked('sprint', STATS.getProgress())) {
          self.showMenuToast('🔒 通关经典第 4 关解锁「限时冲刺」');
          return;
        }
        self.mode = 'sprint'; self.updateModeUI();
      });
      on('modeSurvival', function () {
        if (!C.isModeUnlocked('survival', STATS.getProgress())) {
          self.showMenuToast('🔒 通关经典第 8 关解锁「无尽生存」');
          return;
        }
        self.mode = 'survival'; self.updateModeUI();
      });

      on('diffNormal', function () { self.difficulty = 'normal'; self.updateModeUI(); });
      on('diffHard', function () { self.difficulty = 'hard'; self.updateModeUI(); });
      on('diffInferno', function () { self.difficulty = 'inferno'; self.updateModeUI(); });

      on('sprintShort', function () { self.sprintTier = 'short'; self.updateModeUI(); });
      on('sprintStandard', function () { self.sprintTier = 'standard'; self.updateModeUI(); });
      on('sprintLong', function () { self.sprintTier = 'long'; self.updateModeUI(); });

      on('startBtn', function () { self.start(); });

      on('statsBtn', function () { STATS.renderStatsPanel(); STATS.openPanel('statsScreen'); });
      on('lbBtn', function () { STATS.renderLeaderboard(); STATS.openPanel('lbScreen'); });
      on('settingsBtn', function () { self.renderSettingsPanel(); STATS.openPanel('settingsScreen'); });
      on('closeStats', function () { STATS.closePanel('statsScreen'); });
      on('closeLb', function () { STATS.closePanel('lbScreen'); });
      on('closeSettings', function () { STATS.closePanel('settingsScreen'); });

      var filters = document.querySelectorAll('.history-filter button');
      filters.forEach(function (b) {
        b.addEventListener('click', function () {
          filters.forEach(function (x) { x.classList.remove('on'); });
          b.classList.add('on');
          STATS.renderHistory(STATS.getHistory(), b.dataset.filter);
        });
      });

      on('resumeBtn', function () { self.resume(); });
      on('restartBtn', function () { self.restart(); });
      on('pauseMenuBtn', function () { self.toMenu(); });

      on('touchGateClose', function () { var t = el('touchGate'); if (t) t.style.display = 'none'; });
    };

    Game.prototype.initPanels = function () {
      var self = this;
      var set = this.settings;
      this.bindToggle('setSound', set.sound, function (v) { self.settings.sound = v; STATS.saveSettings(self.settings); AUDIO.setSoundEnabled(v); });
      this.bindToggle('setBgm', set.bgm, function (v) { self.settings.bgm = v; STATS.saveSettings(self.settings); AUDIO.setBgmEnabled(v); if (v) AUDIO.playBgm(self.state === 'MENU' ? 'menu' : 'battle'); });
      this.bindToggle('setShake', set.shake, function (v) { self.settings.shake = v; STATS.saveSettings(self.settings); });
      this.bindToggle('setReduced', set.reducedFx, function (v) { self.settings.reducedFx = v; STATS.saveSettings(self.settings); });
    };
    Game.prototype.bindToggle = function (id, initial, onChange) {
      var n = el(id);
      if (!n) return;
      var state = !!initial;
      var sync = function () { n.classList.toggle('on', state); n.setAttribute('aria-pressed', String(state)); };
      n.addEventListener('click', function () { state = !state; sync(); onChange(state); });
      sync();
    };
    Game.prototype.renderSettingsPanel = function () {
      var s = this.settings;
      var sync = function (id, v) { var n = el(id); if (n) { n.classList.toggle('on', !!v); n.setAttribute('aria-pressed', String(!!v)); } };
      sync('setSound', s.sound); sync('setBgm', s.bgm); sync('setShake', s.shake); sync('setReduced', s.reducedFx);
    };

    Game.prototype.updateModeUI = function () {
      var m = this.mode;
      var set = function (id, on) { var n = el(id); if (n) n.classList.toggle('on', on); };

      /* 模式解锁（任务2）：初始仅「经典闯关」；通关第 4 关解锁「限时冲刺」、第 8 关解锁「无尽生存」 */
      var prog = STATS.getProgress();
      var MODE_DESC = { sprint: '60s · Top10 榜', survival: 'HP 衰减 · 连击回血' };
      var lockMode = function (mode, id, needStage) {
        var locked = !C.isModeUnlocked(mode, prog);
        var card = el(id);
        if (card) {
          card.classList.toggle('locked', locked);
          var span = card.querySelector ? card.querySelector('span') : null;
          if (span) span.textContent = locked ? '🔒 通关第 ' + (needStage - 1) + ' 关解锁' : MODE_DESC[mode];
        }
      };
      lockMode('sprint', 'modeSprint', 5);
      lockMode('survival', 'modeSurvival', 9);
      /* 当前所选模式若被锁定 → 回退经典闯关 */
      if (m !== 'campaign' && !C.isModeUnlocked(m, prog)) { m = 'campaign'; this.mode = 'campaign'; }

      set('modeCampaign', m === 'campaign');
      set('modeSprint', m === 'sprint');
      set('modeSurvival', m === 'survival');

      var diffGroup = el('diffGroup'), sprintGroup = el('sprintGroup');
      if (diffGroup) diffGroup.style.display = m === 'campaign' ? '' : 'none';
      if (sprintGroup) sprintGroup.style.display = m === 'sprint' ? '' : 'none';

      /* 难度解锁状态 */
      var unlocked = prog.unlockedDifficulty || 'normal';
      var lockedHard = unlocked !== 'hard' && unlocked !== 'inferno';
      var lockedInferno = unlocked !== 'inferno';
      var setLock = function (id, locked) { var n = el(id); if (n) n.classList.toggle('locked', locked); };
      setLock('diffHard', lockedHard);
      setLock('diffInferno', lockedInferno);
      if (lockedHard && this.difficulty === 'hard') this.difficulty = 'normal';
      if (lockedInferno && this.difficulty === 'inferno') this.difficulty = lockedHard ? 'normal' : 'hard';

      var d = this.difficulty;
      set('diffNormal', d === 'normal'); set('diffHard', d === 'hard'); set('diffInferno', d === 'inferno');
      var t = this.sprintTier;
      set('sprintShort', t === 'short'); set('sprintStandard', t === 'standard'); set('sprintLong', t === 'long');

      var modeDesc = el('modeDesc');
      if (modeDesc) {
        var txt = {
          campaign: '5 心起步 · 12 关主线 · 每 3 关词长升档 + Boss 战',
          sprint: '60 秒冲榜 · 无扣命 · 触底断连击 · Top10 本地榜',
          survival: 'HP 100 持续衰减（3→8 HP/s）· 连击回血 · 硬核持久'
        }[m];
        modeDesc.textContent = txt;
      }
    };

    Game.prototype.refreshMenuData = function () {
      STATS.renderLeaderboard();
      var st = STATS.getStats();
      var menuBest = el('menuBestWpm'), menuGames = el('menuGames'), menuCombo = el('menuMaxCombo');
      if (menuBest) menuBest.textContent = Math.max(st.bestWpm.campaign || 0, st.bestWpm.sprint || 0, st.bestWpm.survival || 0);
      if (menuGames) menuGames.textContent = st.totalGames;
      if (menuCombo) menuCombo.textContent = st.maxCombo;
      var prog = STATS.getProgress();
      var stageEl = el('menuStage');
      if (stageEl) stageEl.textContent = '第 ' + Math.min(prog.stage[this.difficulty] || 1, 12) + ' 关';
    };

    /* ---------------- 开新局 ---------------- */
    Game.prototype.start = function () {
      this.unlockAudio();
      var prog = STATS.getProgress();
      var unlocked = prog.unlockedDifficulty || 'normal';
      if (this.mode === 'campaign' &&
          ((this.difficulty === 'hard' && unlocked !== 'hard' && unlocked !== 'inferno') ||
           (this.difficulty === 'inferno' && unlocked !== 'inferno'))) {
        this.difficulty = 'normal';
      }
      /* 模式解锁防呆：锁定模式不允许开局（正常由 UI 拦截，这里兜底） */
      if (this.mode !== 'campaign' && !C.isModeUnlocked(this.mode, prog)) this.mode = 'campaign';
      this.updateModeUI();

      this.state = 'PLAYING';
      this.elapsed = 0;
      this.timeLeft = this.mode === 'sprint' ? 60 : 0;
      this.score = 0;
      this.combo = 0;
      this.maxCombo = 0;
      this.comboBroken = false;
      this.nextHeartAt = 10;
      this.nextHpAt = 5;
      this.kills = 0;
      this.correctKeys = 0;
      this.errorKeys = 0;
      this.partialWords = 0;
      this.peakWpm = 0;
      this.rollingKeys = [];
      this.skillsUsed = { heal: 0, bomb: 0, freeze: 0, slow: 0 };
      this.enemies = [];
      this.bullets = [];
      this.particles = [];
      this.floaters = [];
      this.target = null;
      this.lastError = null;
      this.freezeTimer = 0;
      this.slowTimer = 0;
      this.defenseFlash = 0;
      this.shakeT = 0;
      this.hudTimer = 0;
      this.warnTimer = 0;
      this.win = false;
      this.boss = null;
      this.bossPhase = '';
      this.bossWaitT = 0;
      this.spawnAcc = 0;
      this.spawned = 0;
      this.quota = 0;
      this.stage = Math.min(prog.stage[this.difficulty] || 1, 12);

      if (this.mode === 'campaign') {
        this.hearts = C.difficulty(this.difficulty).hearts;   /* 每局初始心（§4.1） */
        this.maxHearts = 7;
        this.hp = 100; this.maxHp = 100;
        this.setupStage(this.stage);
      } else this.setupArcade();

      this.hideOverlays();
      this.doc.body.classList.add('in-battle');
      el('menuScreen').classList.remove('show');
      el('battleStage').classList.add('show');

      var gate = el('touchGate');
      if (gate) gate.style.display = 'none';

      AUDIO.playBgm(this.mode === 'campaign' && C.levelConfig(this.stage).boss ? 'boss' : 'battle');
      this.updateHud();
    };

    Game.prototype.setupStage = function (stage) {
      var conf = C.levelConfig(stage);
      var diff = C.difficulty(this.difficulty);
      this.stage = stage;
      this.phase = 'STAGE';
      this.beatMs = conf.beat * diff.beatMult;
      this.spawnMs = conf.spawn;
      this.cap = conf.cap;
      this.tier = conf.tier;
      this.quota = 8 + stage;
      this.spawned = 0;
      /* 修复（任务1）：开局立即出首怪，避免进入战场后约 2.4s 空场被误判为“没有怪物” */
      this.spawnAcc = this.spawnMs;
      this.boss = null;
      this.bossPhase = '';
    };

    Game.prototype.setupArcade = function () {
      if (this.mode === 'sprint') {
        var t = C.sprintTier(this.sprintTier);
        this.beatMs = t.beat; this.spawnMs = t.spawn; this.cap = t.cap;
        this.tier = pick(t.tiers);
        this.quota = Infinity; this.spawned = 0;
        /* 开局立即刷出首怪（与经典一致），避免进入战场 1.5s 空场被误判“没有怪物” */
        this.spawnAcc = this.spawnMs;
        this.phase = 'ARCADE';
        this.hearts = 5; this.maxHearts = 5;
        this.hp = 100; this.maxHp = 100;
      } else { /* survival */
        this.beatMs = 750; this.spawnMs = 2000; this.cap = 8;
        this.tier = 1;
        this.quota = Infinity; this.spawned = 0;
        /* 开局立即刷出首怪 */
        this.spawnAcc = this.spawnMs;
        this.phase = 'ARCADE';
        this.hearts = 5; this.maxHearts = 5;
        this.hp = 100; this.maxHp = 100;
      }
    };

    Game.prototype.hideOverlays = function () {
      ['pauseScreen', 'resultScreen', 'statsScreen', 'lbScreen', 'settingsScreen'].forEach(function (id) {
        var n = el(id); if (n) { n.classList.remove('show'); n.setAttribute('aria-hidden', 'true'); }
      });
      this.setBossBanner(false);
    };

    /* ---------------- 主循环 ---------------- */
    Game.prototype.frame = function (now) {
      var dt = Math.min(0.25, (now - this.lastFrame) / 1000);
      this.lastFrame = now;
      if (this.state === 'PLAYING') this.update(dt);
      this.render();
      requestAnimationFrame(function (n) { this.frame(n); }.bind(this));
    };

    Game.prototype.update = function (dt) {
      var g = this;
      g.elapsed += dt;

      /* 限时倒计时 */
      if (g.mode === 'sprint') {
        g.timeLeft -= dt;
        if (g.timeLeft <= 0) { g.timeLeft = 0; this.finish('time'); return; }
      }

      /* 生存血量持续衰减（§4.3） */
      if (g.mode === 'survival' && !g.boss) {
        g.hp -= C.survivalDecay(g.elapsed) * dt;
        if (g.hp <= 0) { g.hp = 0; this.finish('lose'); return; }
      }

      /* 计时器 */
      g.freezeTimer = Math.max(0, g.freezeTimer - dt);
      g.slowTimer = Math.max(0, g.slowTimer - dt);
      g.defenseFlash = Math.max(0, g.defenseFlash - dt);
      g.shakeT = Math.max(0, g.shakeT - dt);

      /* Boss 入场倒计时 */
      if (g.phase === 'BOSS_WAIT') {
        g.bossWaitT -= dt;
        var bc = el('bossCountdown');
        if (bc) bc.textContent = Math.max(0, Math.ceil(g.bossWaitT));
        if (g.bossWaitT <= 0) this.spawnBoss();
      }

      /* 刷怪 */
      this.updateSpawn(dt);

      /* 敌人推进 */
      this.updateEnemies(dt);

      /* 子弹/粒子/浮动字 */
      this.updateBullets(dt);
      this.updateParticles(dt);
      this.updateFloaters(dt);

      /* 经典关卡进度检查 */
      if (g.mode === 'campaign' && g.phase === 'STAGE') this.checkStage();

      /* 濒死警告 */
      this.updateWarnings(dt);

      /* HUD 刷新 */
      g.hudTimer -= dt;
      if (g.hudTimer <= 0) { g.hudTimer = 0.1; this.updateHud(); }
    };

    Game.prototype.updateSpawn = function (dt) {
      var g = this;
      if (g.freezeTimer > 0 || g.phase === 'BOSS_WAIT' || g.phase === 'BOSS') return;
      /* 生存模式：刷怪间隔随时间收紧（§4.3：2000→1700→1400→1200ms） */
      if (g.mode === 'survival') g.spawnMs = C.survivalSpawnMs(g.elapsed);
      var cap = g.cap;
      var count = g.enemies.length;
      if (count >= cap) return;
      g.spawnAcc += dt * 1000;
      while (g.spawnAcc >= g.spawnMs && g.enemies.length < cap) {
        g.spawnAcc -= g.spawnMs;
        if (g.mode === 'campaign' && g.spawned >= g.quota) continue;
        var made = this.spawnEnemy();
        if (made) g.spawned++;
        if (g.mode !== 'campaign') break;
      }
    };

    Game.prototype.freeCols = function (row) {
      var used = {};
      this.enemies.forEach(function (e) { if (e.row <= row + 1) used[e.col] = true; });
      var free = [];
      for (var c = 0; c < COLS; c++) if (!used[c]) free.push(c);
      return free;
    };

    Game.prototype.spawnEnemy = function () {
      var g = this;
      var free = g.freeCols(0);
      if (free.length === 0) return false;
      var col = pick(free);
      var type = this.pickEnemyType();
      var tier = this.pickTier();
      var enemy = {
        id: 'e' + (g.enemies.length) + '_' + Math.floor(Math.random() * 1e6),
        type: type,
        col: col,
        row: 0,
        rowT: 0,
        speedBase: C.enemySpeed(type),
        errorBoost: 0,
        progress: 0,
        spawnT: 0.15,
        shakeT: 0,
        errorFlashT: 0,
        lastErrorChar: '',
        shieldBroken: false,
        outerWord: '',
        word: ''
      };
      if (type === 'shield') {
        enemy.outerWord = WORDS.random({ pool: 'shield' });
        enemy.word = WORDS.random({ tier: tier });
      } else if (type === 'quick') {
        enemy.word = WORDS.random({ tier: Math.max(1, tier - 1) });
      } else if (type === 'bonus') {
        enemy.word = WORDS.random({ pool: 'bonus' });
      } else if (type === 'skill') {
        enemy.word = WORDS.random({ pool: 'skills' });
      } else {
        enemy.word = WORDS.random({ tier: tier });
      }
      g.enemies.push(enemy);
      return true;
    };

    Game.prototype.pickTier = function () {
      var g = this;
      if (g.mode === 'campaign') return g.tier;
      if (g.mode === 'sprint') return pick(C.sprintTier(g.sprintTier).tiers);
      return pick(C.survivalTiers(g.elapsed));
    };

    Game.prototype.pickEnemyType = function () {
      var g = this;
      var table = [['common', 1]];
      if (g.mode === 'campaign') {
        if (g.stage >= 2) table.push(['shield', 0.12]);
        if (g.stage >= 4) table.push(['quick', 0.10]);
        if (g.stage >= 5) table.push(['shuffle', 0.08]);
        if (g.stage >= 3) table.push(['bonus', 0.05]);
        if (g.stage >= 3) table.push(['skill', g.comboBroken ? 0.13 : 0.06]);
      } else if (g.mode === 'sprint') {
        table.push(['skill', 0.05], ['bonus', 0.04], ['quick', 0.08], ['shield', 0.08]);
      } else {
        if (g.elapsed >= 30) table.push(['shield', 0.10]);
        if (g.elapsed >= 40) table.push(['quick', 0.10]);
        if (g.elapsed >= 50) table.push(['shuffle', 0.08]);
        if (g.elapsed >= 30) table.push(['bonus', 0.05]);
        table.push(['skill', 0.06]);
      }
      var total = 0;
      table.forEach(function (t) { total += t[1]; });
      var r = Math.random() * total, acc = 0;
      for (var i = 0; i < table.length; i++) {
        acc += table[i][1];
        if (r < acc) return table[i][0];
      }
      return 'common';
    };

    Game.prototype.updateEnemies = function (dt) {
      var g = this;
      var beatSec = g.beatMs / 1000;
      var slowFactor = g.slowTimer > 0 ? 0.5 : 1;
      var frozen = g.freezeTimer > 0;
      var toRemove = [];
      g.enemies.forEach(function (e) {
        if (e.spawnT > 0) { e.spawnT = Math.max(0, e.spawnT - dt); }
        if (e.shakeT > 0) e.shakeT = Math.max(0, e.shakeT - dt);
        if (e.errorFlashT > 0) e.errorFlashT = Math.max(0, e.errorFlashT - dt);
        if (e.type === 'boss') return;
        if (frozen) return;
        /* 重排词：每 1.5s 随机重排剩余未敲字母（§3.1） */
        if (e.type === 'shuffle' && e.progress > 0) {
          e.shuffleT = (e.shuffleT || 1.5) - dt;
          if (e.shuffleT <= 0) {
            e.shuffleT = 1.5;
            var rest = e.word.slice(e.progress).split('');
            for (var si = rest.length - 1; si > 0; si--) {
              var sj = Math.floor(Math.random() * (si + 1));
              var tmp = rest[si]; rest[si] = rest[sj]; rest[sj] = tmp;
            }
            e.word = e.word.slice(0, e.progress) + rest.join('');
          }
        }
        var speed = e.speedBase * (1 + e.errorBoost) * slowFactor;
        var rowsPerSec = (1 / beatSec) * speed;
        e.rowT += rowsPerSec * dt;
        while (e.rowT >= 1) {
          e.rowT -= 1;
          e.row += 1;
          if (e.row >= ROWS) { /* 触底 */
            toRemove.push(e);
            g.breach(e);
            break;
          }
        }
      });
    };

    Game.prototype.breach = function (enemy) {
      var g = this;
      if (enemy.progress > 0) g.partialWords++;
      g.removeEnemy(enemy);
      if (g.target === enemy) g.target = null;
      g.combo = 0;
      g.comboBroken = true;
      g.defenseFlash = 0.45;
      if (g.mode === 'sprint') {
        /* 无扣命，仅断连击（§4.2） */
        this.addFloater(colX(enemy.col), DEF_Y - 14, 'BREACH', '#ff5d5d');
        AUDIO.loseHeart();
      } else if (g.mode === 'campaign') {
        var dmg = enemy.type === 'bonus' ? 2 : 1;
        g.hearts -= dmg;
        this.addFloater(colX(enemy.col), DEF_Y - 14, '-' + dmg + ' ♥', '#ff4757');
        AUDIO.loseHeart();
        if (g.hearts <= 0) { g.hearts = 0; this.finish('lose'); }
      } else {
        var d = C.survivalBreachDmg(enemy.type);
        g.hp -= d;
        this.addFloater(colX(enemy.col), DEF_Y - 14, '-' + d, '#ff4757');
        AUDIO.loseHeart();
        if (g.hp <= 0) { g.hp = 0; this.finish('lose'); }
      }
    };

    Game.prototype.removeEnemy = function (enemy) {
      var i = this.enemies.indexOf(enemy);
      if (i >= 0) this.enemies.splice(i, 1);
    };
    /* 目标是否仍存活（场上普通敌 或 Boss） */
    Game.prototype.isLive = function (e) {
      return !!e && (this.enemies.indexOf(e) >= 0 || e === this.boss);
    };

    /* ---------------- 输入：逐字母判定（§2.2③/⑤） ---------------- */
    Game.prototype.handleKey = function (ch) {
      var g = this;
      var tgt = g.target;
      if (tgt && g.isLive(tgt) && tgt.progress < this.currentWord(tgt).length) {
        this.advanceTarget(tgt, ch);
        return;
      }
      /* 锁定最近敌人/ Boss（前缀匹配，行号最大者） */
      var cand = null, bestRow = -1, bestCol = COLS;
      var pool = g.enemies.slice();
      if (g.boss) pool.push(g.boss);
      pool.forEach(function (e) {
        if (e === tgt) return;
        var w = g.currentWord(e);
        if (w[0].toLowerCase() !== ch) return;
        var r = e.row + e.rowT;
        if (r > bestRow || (r === bestRow && e.col < bestCol)) {
          bestRow = r; bestCol = e.col; cand = e;
        }
      });
      if (cand) {
        cand.progress = 0;
        g.target = cand;
        this.advanceTarget(cand, ch);
      }
    };

    Game.prototype.advanceTarget = function (e, ch) {
      var g = this;
      var word = this.currentWord(e);
      if (e.progress >= word.length) return;
      var expected = word[e.progress].toLowerCase();
      if (ch === expected) {
        e.progress++;
        g.correctKeys++;
        g.rollingKeys.push(g.elapsed);
        AUDIO.keyHit();
        this.burst(colX(e.col), this.enemyY(e), 6, NEON.ok);
        this.updateWordWord();
        if (e.progress >= word.length) this.onLayerComplete(e);
      } else {
        this.onError(e, ch);
      }
    };

    Game.prototype.onError = function (e, ch) {
      var g = this;
      g.errorKeys++;
      g.combo = 0;
      g.comboBroken = true;
      g.score = Math.max(0, g.score - 5);
      e.errorBoost = Math.min(0.6, (e.errorBoost || 0) + 0.15);
      e.shakeT = 0.12;
      e.errorFlashT = 0.2;
      e.lastErrorChar = ch;
      g.lastError = { char: ch, t: 0.2 };
      AUDIO.keyMiss();
    };

    Game.prototype.currentWord = function (e) {
      if (e.type === 'shield' && !e.shieldBroken) return e.outerWord;
      if (e.type === 'boss') return e.segments[e.segIndex];
      return e.word;
    };

    Game.prototype.enemyY = function (e) {
      if (e.type === 'boss') return 252;
      return e.row * CELL_H + e.rowT * CELL_H + CELL_H / 2;
    };

    Game.prototype.onLayerComplete = function (e) {
      var g = this;
      if (e.type === 'shield' && !e.shieldBroken) {
        /* 破盾：+50、金色爆闪、露出内层本体（§3.1） */
        e.shieldBroken = true;
        e.progress = 0;
        g.score += C.SHIELD_BREAK_BONUS;
        AUDIO.shieldBreak();
        this.burst(colX(e.col), this.enemyY(e), 18, NEON.shield);
        this.addFloater(colX(e.col), this.enemyY(e) - 20, 'SHIELD DOWN', NEON.shield);
        this.updateWordWord();
        return;
      }
      if (e.type === 'boss') {
        /* Boss 分段完成（§5.4） */
        g.score += C.bossSegmentScore(e.segments[e.segIndex].length);
        AUDIO.bossSegment();
        this.burst(colX(e.col), this.enemyY(e), 20, NEON.bonus);
        e.segIndex++;
        e.progress = 0;
        this.updateBossHud();
        if (e.segIndex >= e.segments.length) { this.onBossKilled(e); }
        return;
      }
      /* 整词敲完 → 发射子弹 → 爆炸（§2.2④） */
      this.fireBullet(e);
    };

    Game.prototype.fireBullet = function (e) {
      this.bullets.push({
        x0: colX(e.col), y0: DEF_Y - 8,
        tx: colX(e.col), ty: this.enemyY(e),
        t: 0, dur: 0.08, target: e
      });
      AUDIO.fire();
    };

    Game.prototype.updateBullets = function (dt) {
      var g = this;
      var done = [];
      this.bullets.forEach(function (b) {
        b.t += dt;
        if (b.t >= b.dur) done.push(b);
      });
      done.forEach(function (b) {
        var i = g.bullets.indexOf(b);
        if (i >= 0) g.bullets.splice(i, 1);
        if (g.enemies.indexOf(b.target) >= 0) g.resolveKill(b.target);
      });
    };

    Game.prototype.resolveKill = function (e) {
      var g = this;
      g.removeEnemy(e);
      if (g.target === e) g.target = null;

      var isSkill = e.type === 'skill';
      if (!isSkill) {
        var cm = C.comboMult(g.combo + 1);
        g.combo++;
        g.maxCombo = Math.max(g.maxCombo, g.combo);
        var diffMult = g.mode === 'campaign' ? C.difficulty(g.difficulty).scoreMult : (g.mode === 'survival' ? 1.2 : 1);
        var modeMult = g.mode === 'sprint' ? C.sprintTier(g.sprintTier).mult : 1;
        var sc = C.scoreWord({
          len: e.word.length,
          type: e.type,
          diffMult: diffMult,
          comboMult: cm,
          modeMult: modeMult
        });
        g.score += sc;
        g.kills++;
        this.addFloater(colX(e.col), this.enemyY(e) - 18, '+' + sc, e.type === 'bonus' ? NEON.bonus : (e.type === 'quick' ? NEON.quick : NEON.bullet));
        this.comboMilestones();
      } else {
        /* 技能词：不积分，触发防御协议（§3.3） */
        g.combo++;
        g.maxCombo = Math.max(g.maxCombo, g.combo);
        this.applySkill(e.word);
        this.comboMilestones();
      }

      /* 生存回血（§4.3） */
      if (g.mode === 'survival') {
        var heal = C.survivalHeal(e.word.length);
        if (heal > 0) {
          g.hp = Math.min(100, g.hp + heal);
          this.addFloater(colX(e.col), this.enemyY(e) - 34, '+' + heal + ' HP', NEON.skill);
        }
      }

      this.burst(colX(e.col), this.enemyY(e), 24, e.type === 'bonus' ? NEON.bonus : (e.type === 'skill' ? NEON.skill : NEON.bullet));
      if (g.settings.shake) g.shakeT = 0.1;
      AUDIO.explode();
      this.updateWordWord();
    };

    Game.prototype.comboMilestones = function () {
      var g = this;
      if (g.combo >= g.nextHeartAt) {
        if (g.mode === 'campaign' && g.hearts < g.maxHearts) {
          g.hearts++;
          this.addFloater(CW / 2, 120, '+1 ♥', '#ff6b81');
          AUDIO.heal();
        }
        g.nextHeartAt += 10;
      }
      if (g.combo >= g.nextHpAt) {
        if (g.mode === 'survival') {
          g.hp = Math.min(100, g.hp + 2);
          this.addFloater(CW / 2, 140, '+2 HP', NEON.skill);
        }
        g.nextHpAt += 5;
      }
      if (g.combo >= 5 && g.combo % 5 === 0) {
        AUDIO.comboUp(g.combo);
      }
      if (g.combo >= 3) g.comboBroken = false;
    };

    Game.prototype.applySkill = function (word) {
      var g = this;
      g.skillsUsed[word] = (g.skillsUsed[word] || 0) + 1;
      if (word === 'heal') {
        if (g.mode === 'survival') {
          g.hp = Math.min(100, g.hp + 15);
          this.addFloater(CW / 2, 150, 'HEAL +15', NEON.skill);
        } else if (g.mode === 'campaign') {
          if (g.hearts < g.maxHearts) {
            g.hearts++;
            this.addFloater(CW / 2, 150, 'HEAL +1 ♥', NEON.skill);
          }
        }
        AUDIO.heal();
      } else if (word === 'bomb') {
        var victims = g.enemies.filter(function (e) { return e.type !== 'boss'; });
        victims.slice().forEach(function (e) { g.resolveKill(e); });
        this.addFloater(CW / 2, 170, 'BOMB CLEAR', NEON.shield);
        AUDIO.bomb();
        if (g.settings.shake) g.shakeT = 0.22;
      } else if (word === 'freeze') {
        g.freezeTimer = 5;
        this.addFloater(CW / 2, 150, 'FREEZE 5s', '#8be9fd');
        AUDIO.freeze();
      } else if (word === 'slow') {
        g.slowTimer = 5;
        this.addFloater(CW / 2, 150, 'SLOW ×0.5', '#a3e2ff');
        AUDIO.slow();
      }
    };

    Game.prototype.handleBackspace = function () {
      var g = this;
      var tgt = g.target;
      if (!g.isLive(tgt)) return;
      if (tgt.progress > 0) {
        tgt.progress--;
        g.correctKeys = Math.max(0, g.correctKeys - 1);
        AUDIO.keyHit();
        this.updateWordWord();
      } else {
        /* 删除到 0 → 解除锁定，允许重新选词（§2.2③） */
        g.target = null;
        this.updateWordWord();
      }
    };

    Game.prototype.switchTarget = function () {
      var g = this;
      var tgt = g.target;
      if (!g.isLive(tgt)) return;
      var first = this.currentWord(tgt)[0].toLowerCase();
      var cand = null, bestRow = -1;
      g.enemies.forEach(function (e) {
        if (e === tgt) return;
        if (g.currentWord(e)[0].toLowerCase() !== first) return;
        var r = e.row + e.rowT;
        if (r > bestRow) { bestRow = r; cand = e; }
      });
      if (cand) {
        if (tgt.progress > 0) g.partialWords++;
        tgt.progress = 0;
        g.target = cand;
        cand.progress = 0;
        this.updateWordWord();
      }
    };

    /* ---------------- Boss（§5.4 / §7.2） ---------------- */
    Game.prototype.checkStage = function () {
      var g = this;
      var conf = C.levelConfig(g.stage);
      if (g.spawned >= g.quota && g.enemies.length === 0) {
        if (conf.boss) {
          g.phase = 'BOSS_WAIT';
          g.bossWaitT = 3;
          g.spawnAcc = 0;
          this.setBossBanner(true, '⚠ BOSS INCOMING', '');
          AUDIO.bossAlert();
        } else {
          this.clearStage();
        }
      }
    };

    Game.prototype.spawnBoss = function () {
      var g = this;
      var letter = C.levelConfig(g.stage).boss;
      var range = C.bossSegLen(letter);
      var segs = this.pickBossSegments(range);
      g.boss = {
        type: 'boss',
        segments: segs,
        segIndex: 0,
        progress: 0,
        col: 4,
        row: 3,
        rowT: 0,
        speedBase: 0,
        errorBoost: 0,
        spawnT: 0,
        shakeT: 0,
        errorFlashT: 0,
        lastErrorChar: '',
        shieldBroken: false,
        outerWord: '',
        word: ''
      };
      g.phase = 'BOSS';
      var bc = el('bossCountdown');
      if (bc) bc.style.display = 'none';
      this.setBossBanner(true, '⚠ DATA CORE', letter);
      this.updateBossHud();
    };

    Game.prototype.pickBossSegments = function (range) {
      var minL = range[0], maxL = range[1];
      var pool = [];
      var seen = {};
      WORDS.boss.forEach(function (w) {
        if (w.length >= minL && w.length <= maxL && !seen[w]) { seen[w] = true; pool.push(w); }
      });
      /* 若 Boss 池不足（长段），从 L3/L4 补足 */
      if (pool.length < 3) {
        [4, 3].forEach(function (t) {
          (WORDS.tiers[t] || []).forEach(function (w) {
            if (w.length >= minL && w.length <= maxL && !seen[w]) { seen[w] = true; pool.push(w); }
          });
        });
      }
      if (pool.length < 3) pool = WORDS.boss.slice();
      var out = [];
      while (out.length < 3 && pool.length > 0) {
        var i = Math.floor(Math.random() * pool.length);
        out.push(pool[i]);
        pool.splice(i, 1);
      }
      return out;
    };

    Game.prototype.onBossKilled = function (e) {
      var g = this;
      var diffMult = C.difficulty(g.difficulty).scoreMult;
      g.score += C.bossKillBonus(diffMult);
      g.kills++;
      g.combo++;
      g.maxCombo = Math.max(g.maxCombo, g.combo);
      this.addFloater(CW / 2, 200, 'BOSS DOWN +' + C.bossKillBonus(diffMult), NEON.bonus);
      this.burst(CW / 2, 252, 40, NEON.bonus);
      if (g.settings.shake) g.shakeT = 0.3;
      AUDIO.explode();
      AUDIO.bossSegment();
      g.boss = null;
      this.setBossBanner(false);
      this.clearStage();
    };

    Game.prototype.clearStage = function () {
      var g = this;
      AUDIO.stageClear();
      if (g.stage >= 12) {
        g.win = true;
        this.finish('win');
        return;
      }
      g.hearts = Math.min(g.maxHearts, g.hearts + 1);
      this.addFloater(CW / 2, 180, 'STAGE ' + g.stage + ' CLEAR  +1 ♥', NEON.ok);
      g.stage++;
      /* 保存进度（§6.3） */
      var prog = STATS.getProgress();
      prog.stage = prog.stage || { normal: 1, hard: 1, inferno: 1 };
      prog.stage[g.difficulty] = Math.max(prog.stage[g.difficulty] || 1, Math.min(g.stage, 12));
      STATS.saveProgress(prog);
      this.setupStage(g.stage);
      AUDIO.playBgm(C.levelConfig(g.stage).boss ? 'boss' : 'battle');
      this.updateHud();
    };

    Game.prototype.setBossBanner = function (show, title, sub) {
      var b = el('bossBanner');
      if (b) {
        b.classList.toggle('show', show);
        var t = el('bossName'), s = el('bossSub');
        if (t) t.textContent = title || '';
        if (s) s.textContent = sub || '';
      }
      var hud = el('bossHud');
      if (hud) hud.classList.toggle('show', !!this.boss);
    };

    Game.prototype.updateBossHud = function () {
      var hud = el('bossHud'), pips = el('bossPips');
      if (!hud || !pips || !this.boss) return;
      var seg = this.boss.segments;
      var html = '';
      for (var i = 0; i < seg.length; i++) {
        html += '<span class="boss-pip' + (i < this.boss.segIndex ? ' done' : (i === this.boss.segIndex ? ' cur' : '')) + '">' + seg[i] + '</span>';
      }
      pips.innerHTML = html;
    };

    /* ---------------- 粒子 / 浮动字 ---------------- */
    Game.prototype.burst = function (x, y, n, color) {
      if (this.settings.reducedFx) n = Math.max(4, Math.floor(n / 2));
      for (var i = 0; i < n; i++) {
        this.particles.push({
          x: x, y: y,
          vx: rand(-140, 140), vy: rand(-180, 40),
          life: rand(0.3, 0.6), t: 0,
          size: rand(2, 4.5), color: color
        });
      }
    };
    Game.prototype.updateParticles = function (dt) {
      var g = this;
      for (var i = g.particles.length - 1; i >= 0; i--) {
        var p = g.particles[i];
        p.t += dt;
        if (p.t >= p.life) { g.particles.splice(i, 1); continue; }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 380 * dt;
        p.vx *= 0.97;
      }
    };
    Game.prototype.addFloater = function (x, y, text, color) {
      if (this.settings.reducedFx) return;
      this.floaters.push({ x: x, y: y, text: text, color: color, t: 0, life: 0.9 });
    };
    Game.prototype.updateFloaters = function (dt) {
      var g = this;
      for (var i = g.floaters.length - 1; i >= 0; i--) {
        var f = g.floaters[i];
        f.t += dt;
        if (f.t >= f.life) { g.floaters.splice(i, 1); continue; }
        f.y -= 34 * dt;
      }
    };

    Game.prototype.updateWarnings = function (dt) {
      var g = this;
      var critical = (g.mode === 'survival' && g.hp <= 25) || (g.mode === 'campaign' && g.hearts <= 2);
      g.critical = critical;
      if (critical) {
        g.warnTimer -= dt;
        if (g.warnTimer <= 0) { g.warnTimer = 3; AUDIO.warning(); }
      }
    };

    /* ---------------- HUD ---------------- */
    Game.prototype.updateHud = function () {
      var g = this;
      var acc = C.clamp(Math.round(g.correctKeys * 100 / Math.max(1, g.correctKeys + g.errorKeys)), 0, 100);
      /* 滚动 WPM：最近 15s（§6.1） */
      var cutoff = g.elapsed - 15;
      while (g.rollingKeys.length && g.rollingKeys[0] < cutoff) g.rollingKeys.shift();
      var winWpm = (g.rollingKeys.length / 5) / (15 / 60);
      if (winWpm > g.peakWpm) g.peakWpm = winWpm;

      var wordTyped = '', wordUnt = '', errChar = '', hasTarget = false;
      var tgt = g.target;
      if (g.isLive(tgt)) {
        var w = this.currentWord(tgt);
        hasTarget = true;
        wordTyped = w.slice(0, tgt.progress);
        wordUnt = w.slice(tgt.progress);
        if (g.lastError && g.lastError.t > 0) errChar = g.lastError.char;
      }
      if (g.lastError && g.lastError.t > 0) { g.lastError.t -= 0.05; } /* 粗略衰减 */

      var timeLabel, subLabel;
      if (g.mode === 'sprint') {
        var sec = Math.max(0, Math.ceil(g.timeLeft));
        timeLabel = sec < 10 ? '0' + sec : String(sec);
        subLabel = 'SCORE ' + Math.round(g.score);
      } else if (g.mode === 'survival') {
        timeLabel = STATS.fmtTime(g.elapsed);
        subLabel = 'SURVIVED';
      } else {
        timeLabel = STATS.fmtTime(g.elapsed);
        subLabel = (g.phase === 'BOSS' || g.phase === 'BOSS_WAIT') ? 'STAGE ' + g.stage + ' · BOSS' : 'STAGE ' + g.stage;
      }

      STATS.updateHud({
        wpm: winWpm, acc: acc, combo: g.combo,
        mode: g.mode,
        hearts: g.hearts, maxHearts: g.maxHearts,
        hp: g.hp, maxHp: g.maxHp,
        wordTyped: wordTyped, wordUntyped: wordUnt, errorChar: errChar, hasTarget: hasTarget,
        timeLabel: timeLabel, subLabel: subLabel
      });
      this.updateBossHud();
    };

    Game.prototype.updateWordWord = function () {
      this.updateHud();
    };

    /* ---------------- 结算 ---------------- */
    Game.prototype.finish = function (reason) {
      if (this.state !== 'PLAYING') return;
      var g = this;
      g.state = 'OVER';
      var acc = g.correctKeys + g.errorKeys > 0 ? (g.correctKeys / (g.correctKeys + g.errorKeys)) * 100 : 100;
      var avgWpm = g.elapsed > 0 ? (g.correctKeys / 5) / (g.elapsed / 60) : 0;
      var result = {
        mode: g.mode,
        difficulty: g.mode === 'sprint' ? g.sprintTier : g.difficulty,
        score: g.score,
        kills: g.kills,
        peakWpm: g.peakWpm,
        avgWpm: avgWpm,
        acc: acc,
        maxCombo: g.maxCombo,
        wrongWords: g.partialWords,
        errorKeys: g.errorKeys,
        durationSec: g.elapsed,
        skillsUsed: g.skillsUsed,
        win: !!g.win
      };
      /* 难度解锁（原逻辑只读不写，困难/地狱永远锁死）：通关当前难度 12 关 → 解锁下一档，只升不降 */
      if (g.mode === 'campaign' && g.win) {
        var prog = STATS.getProgress();
        var cur = prog.unlockedDifficulty || 'normal';
        var nd = C.nextDifficulty(g.difficulty);
        if (nd && C.DIFF_ORDER.indexOf(nd) > C.DIFF_ORDER.indexOf(cur)) {
          prog.unlockedDifficulty = nd;
          STATS.saveProgress(prog);
        }
      }
      var rec = STATS.record(result);
      AUDIO.playBgm('result');
      STATS.showResult(result, rec, {
        retry: function () { g.start(); },
        menu: function () { g.toMenu(); }
      });
      this.refreshMenuData();
    };

    Game.prototype.toMenu = function () {
      this.state = 'MENU';
      this.doc.body.classList.remove('in-battle');
      el('battleStage').classList.remove('show');
      el('menuScreen').classList.add('show');
      this.hideOverlays();
      this.refreshMenuData();
      this.updateModeUI();
      AUDIO.playBgm('menu');
    };

    Game.prototype.showMenu = function () {
      this.state = 'MENU';
      el('menuScreen').classList.add('show');
      var gate = el('touchGate');
      if (gate && window.matchMedia && window.matchMedia('(pointer:coarse)').matches) {
        gate.style.display = 'flex';
      }
    };

    /* ---------------- 暂停 ---------------- */
    Game.prototype.togglePause = function () {
      if (this.state === 'PLAYING') {
        this.state = 'PAUSED';
        el('pauseScreen').classList.add('show');
        el('pauseScreen').setAttribute('aria-hidden', 'false');
      } else if (this.state === 'PAUSED') {
        this.resume();
      }
    };
    Game.prototype.resume = function () {
      if (this.state !== 'PAUSED') return;
      this.state = 'PLAYING';
      el('pauseScreen').classList.remove('show');
      el('pauseScreen').setAttribute('aria-hidden', 'true');
      this.lastFrame = performance.now();
    };
    Game.prototype.restart = function () {
      this.start();
    };

    Game.prototype.unlockAudio = function () {
      if (!this.audioUnlocked) {
        AUDIO.unlock();
        this.audioUnlocked = true;
      }
    };

    /* ---------------- 输入绑定 ---------------- */
    Game.prototype.initInput = function () {
      var self = this;
      this.doc.addEventListener('keydown', function (ev) {
        self.unlockAudio();
        var k = ev.key;
        if (k === '1' || k === '2' || k === '3') {
          if (self.state === 'MENU') {
            var map = { '1': 'campaign', '2': 'sprint', '3': 'survival' };
            var want = map[k];
            if (want !== 'campaign' && !C.isModeUnlocked(want, STATS.getProgress())) {
              self.showMenuToast(want === 'sprint' ? '🔒 通关经典第 4 关解锁「限时冲刺」' : '🔒 通关经典第 8 关解锁「无尽生存」');
              return;
            }
            self.mode = want;
            self.updateModeUI();
            return;
          }
        }
        if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
        /* 静音：Shift+M 始终可用；小写 m 仅非战斗状态（战斗中作打字字母） */
        if (k === 'M' || (k === 'm' && self.state !== 'PLAYING')) {
          var muted = AUDIO.toggleMute();
          self.addToast(muted ? '已静音' : '已开启声音');
          return;
        }
        if (k.length === 1 && /[a-zA-Z]/.test(k)) {
          if (self.state === 'PLAYING') { ev.preventDefault(); self.handleKey(k.toLowerCase()); }
          return;
        }
        if (k === 'Backspace') {
          if (self.state === 'PLAYING') { ev.preventDefault(); self.handleBackspace(); }
          return;
        }
        if (k === 'Tab') {
          if (self.state === 'PLAYING') { ev.preventDefault(); self.switchTarget(); }
          return;
        }
        if (k === 'Enter') {
          if (self.state === 'PLAYING') return;
          if (self.state === 'OVER') { self.start(); return; }
          if (self.state === 'MENU') { self.start(); return; }
          if (self.state === 'PAUSED') { self.resume(); return; }
          return;
        }
        if (k === 'Escape' || k === 'p' || k === 'P') {
          if (self.state === 'PLAYING' || self.state === 'PAUSED') { ev.preventDefault(); self.togglePause(); }
          return;
        }
      });
      /* 首次交互解锁音频 */
      this.doc.addEventListener('click', function () { self.unlockAudio(); }, { once: true });
      this.doc.addEventListener('keydown', function () { self.unlockAudio(); }, { once: true });
    };

    Game.prototype.addToast = function (text) {
      var t = el('combatToast');
      if (!t) return;
      t.textContent = text;
      t.classList.add('show');
      clearTimeout(this._toastT);
      this._toastT = setTimeout(function () { t.classList.remove('show'); }, 900);
    };

    /* 菜单内提示（战斗舞台未显示时 combatToast 不可见，菜单锁定提示走这里） */
    Game.prototype.showMenuToast = function (text) {
      var t = el('menuToast');
      if (!t) return;
      t.textContent = text;
      t.classList.add('show');
      clearTimeout(this._menuToastT);
      this._menuToastT = setTimeout(function () { t.classList.remove('show'); }, 1600);
    };

    /* ================= canvas 渲染（霓虹矩阵固定主题 §7.1） ================= */
    Game.prototype.render = function () {
      var ctx = this.ctx;
      ctx.save();
      /* 震屏 */
      if (this.shakeT > 0 && this.settings.shake) {
        ctx.translate(rand(-3, 3), rand(-3, 3));
      }
      this.drawBackground(ctx);
      this.drawDefense(ctx);
      this.drawEnemies(ctx);
      this.drawBoss(ctx);
      this.drawBullets(ctx);
      this.drawParticles(ctx);
      this.drawFloaters(ctx);
      this.drawOverlayFx(ctx);
      ctx.restore();
    };

    Game.prototype.drawBackground = function (ctx) {
      var g = ctx.createLinearGradient(0, 0, 0, CH);
      g.addColorStop(0, NEON.bg1);
      g.addColorStop(1, NEON.bg2);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, CW, CH);

      /* 霓虹网格 */
      ctx.strokeStyle = NEON.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (var c = 0; c <= COLS; c++) {
        var x = GRID_OX + c * CELL_W;
        ctx.moveTo(x, 0); ctx.lineTo(x, DEF_Y);
      }
      for (var r = 0; r <= ROWS; r++) {
        var y = r * CELL_H;
        ctx.moveTo(GRID_OX, y); ctx.lineTo(GRID_OX + COLS * CELL_W, y);
      }
      ctx.stroke();
    };

    Game.prototype.drawDefense = function (ctx) {
      /* 防线带 */
      var g = ctx.createLinearGradient(0, DEF_Y, 0, CH);
      g.addColorStop(0, 'rgba(70,215,232,.16)');
      g.addColorStop(1, 'rgba(5,10,20,.9)');
      ctx.fillStyle = g;
      ctx.fillRect(0, DEF_Y, CW, DEF_H);
      /* 顶部发光横条 */
      ctx.save();
      ctx.shadowColor = NEON.band;
      ctx.shadowBlur = this.defenseFlash > 0 ? 18 : 10;
      ctx.strokeStyle = this.defenseFlash > 0 ? '#ff4757' : NEON.band;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(0, DEF_Y); ctx.lineTo(CW, DEF_Y);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = 'rgba(180,240,255,.5)';
      ctx.font = '700 11px "Consolas",monospace';
      ctx.textAlign = 'center';
      ctx.fillText('▸ FIREWALL ▸', CW / 2, DEF_Y + 20);
      ctx.fillStyle = 'rgba(180,240,255,.25)';
      ctx.font = '10px "Consolas",monospace';
      ctx.fillText('S E R V E R   C O R E', CW / 2, DEF_Y + 38);
    };

    Game.prototype.enemyColors = function (e) {
      switch (e.type) {
        case 'shield': return NEON.shield;
        case 'quick': return NEON.quick;
        case 'shuffle': return NEON.shuffle;
        case 'bonus': return NEON.bonus;
        case 'skill': return NEON.skill;
        default: return NEON.common;
      }
    };

    Game.prototype.drawEnemies = function (ctx) {
      var g = this;
      this.enemies.forEach(function (e) {
        var x = colX(e.col);
        var y = g.enemyY(e);
        if (e.spawnT > 0) {
          var s = 1 - (e.spawnT / 0.15) * 0.6;
          ctx.save();
          ctx.globalAlpha = Math.max(0.55, 1 - (e.spawnT / 0.15) * 0.45);
          ctx.translate(x, y);
          ctx.scale(s, s);
          ctx.translate(-x, -y);
        }
        var color = g.enemyColors(e);
        var w = e.type === 'shield' && !e.shieldBroken ? e.outerWord : e.word;
        var prog = e.progress;
        var isTarget = g.target === e;
        /* 锁定高亮（§7.1） */
        if (isTarget) {
          ctx.save();
          ctx.shadowColor = NEON.lock;
          ctx.shadowBlur = 16;
        }
        /* 容器 */
        var rw = Math.max(86, 18 + w.length * 13);
        var rh = 44;
        var rx = x - rw / 2, ry = y - rh / 2;
        ctx.fillStyle = 'rgba(4,12,26,.55)';
        ctx.strokeStyle = color;
        ctx.lineWidth = isTarget ? 2 : 1.5;
        ctx.beginPath();
        if (e.type === 'shield' && !e.shieldBroken) {
          /* 护盾：外框 + 内板 */
          ctx.rect(rx - 4, ry - 4, rw + 8, rh + 8);
          ctx.stroke();
          ctx.strokeStyle = 'rgba(255,209,102,.35)';
          ctx.strokeRect(rx - 2, ry - 2, rw + 4, rh + 4);
        } else {
          ctx.rect(rx, ry, rw, rh);
          ctx.stroke();
        }
        if (isTarget) ctx.restore();
        /* 类型标记 */
        var mark = '';
        if (e.type === 'quick') mark = '»';
        else if (e.type === 'shuffle') mark = '⇄';
        else if (e.type === 'bonus') mark = '★';
        else if (e.type === 'skill') mark = '◆';
        if (mark) {
          ctx.fillStyle = color;
          ctx.font = '12px "Consolas",monospace';
          ctx.textAlign = 'left';
          ctx.fillText(mark, rx + 5, ry + 12);
        }
        /* 逐字母渲染 */
        ctx.font = '600 19px "Consolas",monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        var total = w.length;
        var lw = 13;
        var startX = x - ((total - 1) * lw) / 2;
        for (var i = 0; i < total; i++) {
          var lx = startX + i * lw;
          ctx.fillStyle = i < prog ? NEON.ok : color;
          if (i === prog && e.errorFlashT > 0) ctx.fillStyle = NEON.err;
          ctx.fillText(w[i], lx, y);
        }
        ctx.textBaseline = 'alphabetic';
        if (e.spawnT > 0) ctx.restore();
        /* 抖动（错误时整词横向抖动 §7.2） */
        if (e.shakeT > 0) {
          ctx.save();
          ctx.globalAlpha = 1;
          ctx.strokeStyle = 'rgba(255,71,87,.6)';
          ctx.lineWidth = 1;
          ctx.strokeRect(x - rw / 2 - 2, y - rh / 2 - 2, rw + 4, rh + 4);
          ctx.restore();
        }
        /* 护盾未破时上方提示 */
        if (e.type === 'shield' && !e.shieldBroken) {
          ctx.fillStyle = 'rgba(255,209,102,.6)';
          ctx.font = '10px "Consolas",monospace';
          ctx.textAlign = 'center';
          ctx.fillText('SHIELD', x, ry - 9);
        }
      });
    };

    Game.prototype.drawBoss = function (ctx) {
      var b = this.boss;
      if (!b) return;
      var x = CW / 2, y = 252;
      var seg = b.segments[b.segIndex];
      var w = 380, h = 96;
      ctx.save();
      ctx.shadowColor = NEON.err;
      ctx.shadowBlur = 22;
      var g = ctx.createLinearGradient(0, y - h / 2, 0, y + h / 2);
      g.addColorStop(0, 'rgba(20,6,14,.9)');
      g.addColorStop(1, 'rgba(5,10,20,.9)');
      ctx.fillStyle = g;
      ctx.strokeStyle = NEON.err;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(x - w / 2, y - h / 2, w, h, 12) : ctx.rect(x - w / 2, y - h / 2, w, h);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = 'rgba(255,150,150,.75)';
      ctx.font = '700 12px "Consolas",monospace';
      ctx.textAlign = 'center';
      ctx.fillText('⚠ DATA CORE  MK-' + C.levelConfig(this.stage).boss, x, y - h / 2 + 16);
      /* 当前段文字 */
      ctx.font = '700 24px "Consolas",monospace';
      var total = seg.length, lw = 17;
      var startX = x - ((total - 1) * lw) / 2;
      for (var i = 0; i < total; i++) {
        ctx.fillStyle = i < b.progress ? NEON.ok : '#ff9aa2';
        ctx.fillText(seg[i], startX + i * lw, y + 2);
      }
      /* 三段式进度条（§7.2） */
      var pw = 260, px = x - pw / 2, py = y + h / 2 + 16;
      for (var s = 0; s < b.segments.length; s++) {
        var segW = pw / b.segments.length - 6;
        ctx.fillStyle = s < b.segIndex ? 'rgba(255,215,0,.85)' : (s === b.segIndex ? 'rgba(255,71,87,.85)' : 'rgba(255,255,255,.15)');
        ctx.fillRect(px + s * (segW + 6), py, segW, 6);
      }
      ctx.fillStyle = 'rgba(200,220,255,.4)';
      ctx.font = '10px "Consolas",monospace';
      ctx.fillText('SEGMENT ' + (b.segIndex + 1) + ' / ' + b.segments.length, x, py + 18);
    };

    Game.prototype.drawBullets = function (ctx) {
      var g = this;
      this.bullets.forEach(function (b) {
        var k = b.t / b.dur;
        var x = b.x0 + (b.tx - b.x0) * k;
        var y = b.y0 + (b.ty - b.y0) * k;
        ctx.save();
        ctx.shadowColor = NEON.bullet;
        ctx.shadowBlur = 8;
        ctx.fillStyle = NEON.bullet;
        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, Math.PI * 2);
        ctx.fill();
        /* 拖尾 */
        ctx.strokeStyle = 'rgba(201,244,255,.4)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(b.x0, b.y0);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.restore();
      });
    };

    Game.prototype.drawParticles = function (ctx) {
      this.particles.forEach(function (p) {
        var a = 1 - p.t / p.life;
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      });
      ctx.globalAlpha = 1;
    };

    Game.prototype.drawFloaters = function (ctx) {
      this.floaters.forEach(function (f) {
        var a = 1 - f.t / f.life;
        ctx.globalAlpha = a;
        ctx.fillStyle = f.color;
        ctx.font = '700 15px "Consolas",monospace';
        ctx.textAlign = 'center';
        ctx.fillText(f.text, f.x, f.y);
      });
      ctx.globalAlpha = 1;
    };

    Game.prototype.drawOverlayFx = function (ctx) {
      /* 连击金身描边（10+）/ 升级泛光（5+） */
      if (this.combo >= 10) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,215,0,.5)';
        ctx.lineWidth = 3;
        ctx.shadowColor = 'rgba(255,215,0,.8)';
        ctx.shadowBlur = 10;
        ctx.strokeRect(3, 3, CW - 6, CH - 6);
        ctx.restore();
      }
      /* 濒死红色呼吸边框（§7.1） */
      if (this.critical) {
        var p = 0.5 + 0.5 * Math.sin(performance.now() / 260);
        ctx.save();
        ctx.strokeStyle = 'rgba(255,71,87,' + (0.25 + p * 0.25) + ')';
        ctx.lineWidth = 4;
        ctx.strokeRect(2, 2, CW - 4, CH - 4);
        ctx.restore();
      }
      /* 暗角 */
      var v = ctx.createRadialGradient(CW / 2, CH / 2, CH * 0.55, CW / 2, CH / 2, CH * 0.95);
      v.addColorStop(0, 'rgba(0,0,0,0)');
      v.addColorStop(1, 'rgba(0,0,0,.32)');
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, CW, CH);
      /* 顶部渐隐（网格入屏） */
      var t = ctx.createLinearGradient(0, 0, 0, 40);
      t.addColorStop(0, 'rgba(5,10,20,.9)');
      t.addColorStop(1, 'rgba(5,10,20,0)');
      ctx.fillStyle = t;
      ctx.fillRect(0, 0, CW, 40);
    };

    /* ================= 启动 ================= */
    var game;
    function boot() {
      game = new Game();
      /* 调试/自测钩子（不影响正常使用） */
      if (typeof window !== 'undefined') { window.__typeduel = game; }
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
  })();
})();
