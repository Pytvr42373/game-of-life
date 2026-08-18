/* =====================================================================
 * audio.js —— 《打字对决 TYPE DUEL》WebAudio 程序化音效 + BGM 播放管理
 * 音效：正/误分离（正确=短促方波 660→880Hz；错误=锯齿波 180Hz + 轻微失真感）。
 * BGM：本地音频文件（assets/audio/bgm_*.mp3，命名对齐设计文档 §8.5），
 *       文件缺失 / 加载失败 / 浏览器拦截时静默降级为无 BGM，不报错。
 * 暴露全局 window.TypeDuelAudio；兼容 node（module.exports）便于自测。
 * ===================================================================== */
(function (global) {
  'use strict';

  var AudioEngine = { sound: true };
  var ctx = null;
  var master = null;
  var muted = false;
  var bgmEnabled = true;
  var bgmEl = null;
  var currentBgm = null;

  /* —— 设置读取：typeduel.settings.v1 —— */
  function loadSettings() {
    try {
      var s = JSON.parse(localStorage.getItem('typeduel.settings.v1') || 'null');
      if (s) {
        if (typeof s.sound === 'boolean') AudioEngine.sound = s.sound;
        if (typeof s.bgm === 'boolean') bgmEnabled = s.bgm;
      }
    } catch (e) { /* 静默 */ }
  }

  function ensure() {
    if (ctx) return;
    try {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.9;
      master.connect(ctx.destination);
    } catch (e) { ctx = null; }
  }

  function ready() {
    if (muted || !AudioEngine.sound) return false;
    ensure();
    return !!ctx;
  }

  /* —— 基础合成原语 —— */
  function osc(type, f0, f1, dur, gainV, delay) {
    if (!ctx) return;
    var t0 = ctx.currentTime + (delay || 0);
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(1, f0), t0);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gainV, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  function noise(dur, gainV, delay, freq) {
    if (!ctx) return;
    var t0 = ctx.currentTime + (delay || 0);
    var len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    var src = ctx.createBufferSource();
    src.buffer = buf;
    var g = ctx.createGain();
    g.gain.setValueAtTime(gainV, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    var f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freq || 1800;
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0); src.stop(t0 + dur + 0.02);
  }

  /* —— 解锁：AudioContext 首次用户交互后创建（对齐自动播放策略） —— */
  AudioEngine.unlock = function () {
    ensure();
    if (ctx && ctx.state === 'suspended') { ctx.resume().catch(function () {}); }
  };

  AudioEngine.setMuted = function (m) {
    muted = !!m;
    if (master) master.gain.value = muted ? 0 : 0.9;
  };
  AudioEngine.toggleMute = function () { AudioEngine.setMuted(!muted); return muted; };
  AudioEngine.isMuted = function () { return muted; };
  AudioEngine.setSoundEnabled = function (v) { AudioEngine.sound = !!v; };

  /* ================= 音效清单（§7.3） ================= */
  AudioEngine.keyHit = function () { if (!ready()) return; osc('square', 660, 880, 0.03, 0.10); };
  AudioEngine.keyMiss = function () { if (!ready()) return; osc('sawtooth', 180, 120, 0.08, 0.16); noise(0.05, 0.05, 0, 900); };
  AudioEngine.fire = function () { if (!ready()) return; noise(0.10, 0.10, 0, 2600); osc('square', 240, 900, 0.15, 0.08); };
  AudioEngine.explode = function () { if (!ready()) return; noise(0.25, 0.22, 0, 1400); osc('sine', 140, 40, 0.25, 0.18); };
  AudioEngine.shieldBreak = function () { if (!ready()) return; osc('square', 400, 1200, 0.18, 0.12); noise(0.08, 0.08, 0, 3200); };
  AudioEngine.heal = function () { if (!ready()) return; osc('sine', 520, 880, 0.14, 0.12); osc('sine', 780, 1180, 0.18, 0.10, 0.08); };
  AudioEngine.bomb = function () { if (!ready()) return; noise(0.40, 0.25, 0, 700); osc('sine', 90, 30, 0.40, 0.20); };
  AudioEngine.freeze = function () { if (!ready()) return; osc('triangle', 1200, 300, 0.35, 0.12); };
  AudioEngine.slow = function () { if (!ready()) return; osc('triangle', 300, 120, 0.35, 0.12); };
  AudioEngine.loseHeart = function () { if (!ready()) return; osc('sine', 220, 60, 0.35, 0.18); noise(0.20, 0.12, 0, 500); };
  AudioEngine.comboUp = function (n) { if (!ready()) return; var f = 440 * Math.pow(1.12, Math.min(n || 5, 12)); osc('square', f, f * 1.5, 0.09, 0.10); };
  AudioEngine.warning = function () { if (!ready()) return; osc('square', 620, 620, 0.09, 0.12); osc('square', 620, 620, 0.09, 0.12, 0.14); };
  AudioEngine.bossAlert = function () { if (!ready()) return; osc('sawtooth', 240, 240, 0.12, 0.14); osc('sawtooth', 300, 300, 0.12, 0.14, 0.16); osc('sawtooth', 380, 380, 0.14, 0.14, 0.32); };
  AudioEngine.bossSegment = function () { if (!ready()) return; osc('square', 700, 1300, 0.16, 0.10); };
  AudioEngine.stageClear = function () { if (!ready()) return; osc('sine', 523, 523, 0.12, 0.14); osc('sine', 659, 659, 0.12, 0.14, 0.12); osc('sine', 784, 784, 0.20, 0.16, 0.24); };

  /* ================= BGM 管理（§8.5） ================= */
  var BGM_FILES = {
    menu: 'assets/audio/bgm_menu.mp3',
    battle: 'assets/audio/bgm_battle.mp3',
    result: 'assets/audio/bgm_result.mp3',
    boss: 'assets/audio/bgm_boss.mp3'
  };

  function ensureBgmEl() {
    if (bgmEl) return bgmEl;
    try {
      bgmEl = document.createElement('audio');
      bgmEl.loop = true;
      bgmEl.preload = 'auto';
      /* 文件缺失 / 加载失败 → 静默降级为无 BGM，不报错 */
      bgmEl.addEventListener('error', function () { bgmEnabled = false; });
      document.body.appendChild(bgmEl);
    } catch (e) { bgmEl = null; }
    return bgmEl;
  }

  AudioEngine.playBgm = function (scene) {
    if (!bgmEnabled) return;
    if (typeof document === 'undefined') return;
    var el = ensureBgmEl();
    if (!el) return;
    var file = BGM_FILES[scene] || BGM_FILES.menu;
    if (currentBgm === file) {
      if (el.paused) el.play().catch(function () {});
      return;
    }
    currentBgm = file;
    el.src = file;
    el.volume = 0.5;
    el.play().catch(function () { /* 静默降级 */ });
  };

  AudioEngine.stopBgm = function () {
    currentBgm = null;
    if (bgmEl) { bgmEl.pause(); bgmEl.removeAttribute('src'); }
  };

  AudioEngine.setBgmEnabled = function (v) {
    bgmEnabled = !!v;
    if (!bgmEnabled) AudioEngine.stopBgm();
  };
  AudioEngine.isBgmEnabled = function () { return bgmEnabled; };
  AudioEngine.bgmFiles = BGM_FILES;

  loadSettings();

  if (typeof window !== 'undefined') { window.TypeDuelAudio = AudioEngine; }
  if (typeof module !== 'undefined' && module.exports) { module.exports = AudioEngine; }
})(typeof window !== 'undefined' ? window : globalThis);
