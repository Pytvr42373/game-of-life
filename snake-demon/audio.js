/* =====================================================================
 * audio.js —— 《恶魔追逐·队友模式》WebAudio 程序化音效 + 压迫感 BGM
 * 全部声音由 WebAudio 实时合成，无任何外部音频文件，完全自包含。
 * BGM：低沉黑暗的无人机 + 稀疏低频旋律；恶魔逼近时 (tension) 递进：
 *   tension 0=常规  1=节奏加快+心跳脉冲  2=更急促+不和谐高频颤音
 * 音效：掷骰 / 移动 / 命运 / 护盾 / 捕捉 / 胜利 / 失败。
 * 开关与音量持久化到 localStorage['snake-demon.settings.v1']。
 * 暴露全局 window.SnakeAudio；node 环境自动跳过（不抛错）。
 * ===================================================================== */
(function (global) {
  'use strict';

  var Audio = { sound: true, bgm: true };
  var ctx = null;
  var master = null;
  var sfxGain = null;
  var musicGain = null;
  var bgmTimer = null;
  var step = 0;
  var tension = 0;
  var beatOffset = 0;

  /* —— 设置持久化 —— */
  function loadSettings() {
    try {
      var s = JSON.parse(localStorage.getItem('snake-demon.settings.v1') || 'null');
      if (s) {
        if (typeof s.sound === 'boolean') Audio.sound = s.sound;
        if (typeof s.bgm === 'boolean') Audio.bgm = s.bgm;
      }
    } catch (e) { /* 静默 */ }
  }
  function saveSettings() {
    try {
      localStorage.setItem('snake-demon.settings.v1', JSON.stringify({ sound: Audio.sound, bgm: Audio.bgm }));
    } catch (e) { /* 静默 */ }
  }

  function ensure() {
    if (ctx) return;
    try {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
      sfxGain = ctx.createGain();
      sfxGain.gain.value = 0.9;
      sfxGain.connect(master);
      musicGain = ctx.createGain();
      musicGain.gain.value = 0.5;
      musicGain.connect(master);
    } catch (e) { ctx = null; }
  }

  function unlock() {
    ensure();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }
  function ready() { ensure(); return !!(ctx && Audio.sound); }
  function musicReady() { ensure(); return !!(ctx && Audio.bgm); }

  /* —— 合成原语 —— */
  function osc(type, f0, f1, dur, gain, when) {
    if (!ctx) return;
    var t0 = ctx.currentTime + (when || 0);
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(1, f0), t0);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(sfxGain);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function noise(dur, gain, when, cutoff) {
    if (!ctx) return;
    var t0 = ctx.currentTime + (when || 0);
    var len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    var src = ctx.createBufferSource();
    src.buffer = buf;
    var g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    if (cutoff) {
      var f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = cutoff;
      src.connect(f); f.connect(g);
    } else {
      src.connect(g);
    }
    g.connect(sfxGain);
    src.start(t0); src.stop(t0 + dur + 0.05);
  }

  /* —— 音效 —— */
  Audio.sfx = {
    dice: function () { // 骰子翻滚撞击
      if (!ready()) return;
      noise(0.22, 0.3, 0, 5000);
      for (var i = 0; i < 7; i++) osc('square', 360 + Math.random() * 560, 160, 0.035, 0.07, i * 0.045);
      osc('sine', 200, 85, 0.16, 0.5, 0.3); // 落地闷响
    },
    step: function () { // 走格子
      if (!ready()) return;
      osc('triangle', 420 + Math.random() * 80, 300, 0.07, 0.09);
    },
    fate: function () { // 命运金光
      if (!ready()) return;
      osc('sine', 880, 1760, 0.2, 0.14);
      osc('sine', 1318, 2217, 0.26, 0.1, 0.06);
      osc('triangle', 1760, 2637, 0.3, 0.07, 0.12);
    },
    shield: function () { // 获得护盾
      if (!ready()) return;
      osc('sine', 1046, 1568, 0.13, 0.11);
      osc('sine', 1568, 2093, 0.18, 0.09, 0.05);
    },
    block: function () { // 护盾抵消
      if (!ready()) return;
      osc('square', 240, 90, 0.18, 0.22);
      noise(0.12, 0.18, 0, 2400);
    },
    pause: function () { // 被暂停
      if (!ready()) return;
      osc('sine', 440, 220, 0.18, 0.12);
      osc('sine', 330, 165, 0.22, 0.09, 0.05);
    },
    capture: function () { // 抓捕大爆炸
      if (!ready()) return;
      noise(0.5, 0.55, 0, 3200);
      osc('sawtooth', 180, 38, 0.5, 0.5);
      osc('sawtooth', 96, 30, 0.62, 0.4, 0.05);
      osc('square', 60, 28, 0.66, 0.3, 0.1);
    },
    win: function () { // 人类胜利号角
      if (!ready()) return;
      [523, 659, 784, 1046].forEach(function (f, i) { osc('triangle', f, f, 0.32, 0.2, i * 0.11); });
      [1046, 1318, 1568, 2093].forEach(function (f, i) { osc('triangle', f, f, 0.5, 0.16, 0.55 + i * 0.14); });
    },
    lose: function () { // 恶魔胜利黑暗沉降
      if (!ready()) return;
      [392, 330, 262, 196, 147].forEach(function (f, i) { osc('sawtooth', f, f * 0.97, 0.4, 0.15, i * 0.18); });
      osc('sine', 55, 38, 1.5, 0.24, 0.1);
    }
  };

  /* —— BGM：黑暗无人机序列 ——
   * 低音持续 + 每拍低音律动 + 稀疏暗黑旋律，tension 递进压迫感
   */
  var DRONES = [55, 58.27, 65.41, 73.42, 82.41, 110, 123.47]; // A1 A#1 C2 D2 E2 A2 B2
  var MELODY = [110, 0, 130.81, 0, 98, 0, 130.81, 146.83];    // A2 静 C3 静 G2 静 C3 D3

  function drone(freq, dur, gain) {
    if (!ctx || !musicGain) return;
    var t0 = ctx.currentTime;
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    var fl = ctx.createBiquadFilter();
    fl.type = 'lowpass';
    fl.frequency.value = 260;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.05);
    g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    o.connect(fl); fl.connect(g); g.connect(musicGain);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function beat() { // 心跳
    if (!ctx || !musicGain) return;
    var t0 = ctx.currentTime;
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = 70;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.32, t0 + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14);
    o.connect(g); g.connect(musicGain);
    o.start(t0); o.stop(t0 + 0.18);
  }
  function tick() {
    if (!musicReady()) { stopBGM(); return; }
    var i = step % DRONES.length;
    // 基础：低音持续 + 每拍律动 + 稀疏旋律
    drone(DRONES[i] / 2, 1.6, 0.13);
    drone(DRONES[(i + 3) % DRONES.length], 0.9, 0.08);
    var m = MELODY[step % MELODY.length];
    if (m > 0) osc2(m, 0.5, 0.05);
    if (tension >= 1) { // 逼近：心跳 + 更高频低音
      beat();
      beatOffset = (beatOffset + 1) % 2;
      if (beatOffset === 0) beat();
    }
    if (tension >= 2) { // 极度危险：不和谐高频颤音
      osc2(DRONES[(i + 2) % DRONES.length] * 4 + Math.sin(step * 0.7) * 30, 0.4, 0.035);
    }
    step++;
  }
  function osc2(freq, dur, gain) { // 走音乐总线（BGM）
    if (!ctx || !musicGain) return;
    var t0 = ctx.currentTime;
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.04);
    g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(musicGain);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  function startBGM() {
    if (!musicReady() || bgmTimer) return;
    step = 0;
    tick(); // 立即起拍，避免空窗
    bgmTimer = setInterval(tick, tension >= 2 ? 300 : (tension >= 1 ? 360 : 470));
  }
  function restartBGM() {
    stopBGM();
    if (Audio.bgm) startBGM();
  }
  function stopBGM() {
    if (bgmTimer) { clearInterval(bgmTimer); bgmTimer = null; }
  }

  /* —— 对外接口 —— */
  Audio.setTension = function (v) {
    var nt = Math.max(0, Math.min(2, Math.round(v || 0)));
    if (nt !== tension) { tension = nt; if (bgmTimer) restartBGM(); }
  };
  Audio.startMusic = function () {
    unlock();
    if (Audio.bgm && !bgmTimer) startBGM();
  };
  Audio.stopMusic = function () { stopBGM(); };
  Audio.setSound = function (v) {
    Audio.sound = !!v;
    if (!Audio.sound && master) master.gain.value = 0.0;
    else if (master) master.gain.value = 0.9;
    saveSettings();
  };
  Audio.setMusic = function (v) {
    Audio.bgm = !!v;
    if (Audio.bgm) { unlock(); startBGM(); } else stopBGM();
    saveSettings();
  };
  Audio.unlock = unlock;
  Audio.init = function () { loadSettings(); if (master) master.gain.value = Audio.sound ? 0.9 : 0; };

  global.SnakeAudio = Audio;
  if (typeof module !== 'undefined' && module.exports) module.exports = Audio;
})(typeof window !== 'undefined' ? window : globalThis);
