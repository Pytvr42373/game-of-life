/* =====================================================================
 * audio.js —— 《暗巷潜行》WebAudio 程序化音效 + 压迫感 BGM
 * 全部声音由 WebAudio 实时合成，无任何外部音频文件，完全自包含。
 * BGM：低频打底 drone + 稀疏暗黑旋律；紧张度 (tension) 递进：
 *   tension 0=潜入（稀疏低频脉冲） 1=警报搜索（心跳加速） 2=直接追捕（急促心跳+不和谐高频）
 * 音效：潜行脚步 / 奔跑 / 微动 / 起疑 / 警觉 / 发现 / 被抓 / 拿钥匙 / 按钮开关 / 卷帘门 / 丢失目标 / 过关 / 失败。
 * 开关与音量持久化到 localStorage['alley-heist.settings.v1']。
 * 暴露全局 window.AlleyAudio；node 环境自动跳过（不抛错）。
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
      var s = JSON.parse(localStorage.getItem('alley-heist.settings.v1') || 'null');
      if (s) {
        if (typeof s.sound === 'boolean') Audio.sound = s.sound;
        if (typeof s.bgm === 'boolean') Audio.bgm = s.bgm;
      }
    } catch (e) { /* 静默 */ }
  }
  function saveSettings() {
    try {
      localStorage.setItem('alley-heist.settings.v1', JSON.stringify({ sound: Audio.sound, bgm: Audio.bgm }));
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
      musicGain.gain.value = 0.42;
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
    step: function () { // 潜行脚步：轻微、低频、短促
      if (!ready()) return;
      osc('sine', 60 + Math.random() * 30, 38, 0.07, 0.13);
      noise(0.05, 0.04, 0, 900); // 地面摩擦质感
    },
    run: function () { // 奔跑脚步：更大声更急促，两个低频脉冲
      if (!ready()) return;
      osc('sine', 75 + Math.random() * 25, 42, 0.08, 0.22, 0);
      osc('sine', 70 + Math.random() * 25, 40, 0.08, 0.2, 0.11);
      noise(0.06, 0.08, 0, 1200);
      noise(0.06, 0.07, 0.11, 1200);
    },
    rustle: function () { // 转身/微动：白噪声极短
      if (!ready()) return;
      noise(0.08, 0.1, 0, 3200);
    },
    noticed: function () { // 守卫起疑：短促上扬疑问音
      if (!ready()) return;
      osc('sine', 440, 660, 0.14, 0.1);
    },
    heard: function () { // 警觉：高音渐强警示
      if (!ready()) return;
      osc('sine', 800, 1200, 0.2, 0.16);
      osc('sine', 1600, 2400, 0.2, 0.06, 0.02); // 泛音增强压迫
    },
    spotted: function () { // 发现玩家：尖锐警报快速下滑 + 噪声
      if (!ready()) return;
      osc('square', 880, 440, 0.28, 0.3);
      osc('square', 440, 220, 0.32, 0.22, 0.06);
      noise(0.3, 0.25, 0, 2600);
    },
    caught: function () { // 被抓：黑暗低频沉降 + 噪声爆破
      if (!ready()) return;
      noise(0.5, 0.5, 0, 3000);
      osc('sawtooth', 160, 36, 0.5, 0.48);
      osc('sawtooth', 90, 28, 0.62, 0.38, 0.05);
      osc('square', 55, 26, 0.66, 0.28, 0.1);
    },
    key: function () { // 拿钥匙：清脆金属提示
      if (!ready()) return;
      osc('triangle', 1318, 1318, 0.1, 0.14);
      osc('square', 1975, 1975, 0.08, 0.06, 0.01);
      osc('sine', 2637, 2637, 0.12, 0.04, 0.04);
    },
    switch: function () { // 按钮/开关：短促机械咔哒
      if (!ready()) return;
      noise(0.03, 0.22, 0, 4200);
      osc('square', 240, 160, 0.05, 0.16);
    },
    gateOpen: function () { // 卷帘门：电机低鸣 + 帘片咔哒连响
      if (!ready()) return;
      osc('sawtooth', 55, 95, 0.9, 0.22);
      for (var i = 0; i < 7; i++) noise(0.04, 0.14, 0.08 + i * 0.11, 2600);
      noise(0.12, 0.2, 0.85, 1800); // 落定闷响
    },
    lost: function () { // 丢失目标：松弛下滑音
      if (!ready()) return;
      osc('sine', 660, 330, 0.3, 0.12);
      osc('sine', 330, 220, 0.35, 0.08, 0.08);
    },
    goal: function () { // 过关胜利：短号角
      if (!ready()) return;
      [523, 659, 784].forEach(function (f, i) { osc('triangle', f, f, 0.22, 0.2, i * 0.09); });
      [784, 1046, 1318].forEach(function (f, i) { osc('triangle', f, f, 0.3, 0.16, 0.4 + i * 0.1); });
    },
    lose: function () { // 关卡失败重试：下行三音
      if (!ready()) return;
      [330, 262, 196].forEach(function (f, i) { osc('sawtooth', f, f * 0.96, 0.3, 0.16, i * 0.16); });
      osc('sine', 60, 40, 0.8, 0.2, 0.1);
    }
  };

  /* —— BGM：暗巷追逃序列 ——
   * 低频打底 drone + 每拍律动 + 稀疏暗黑旋律，tension 递进压迫感
   */
  var DRONES = [55, 58.27, 61.74, 65.41, 73.42, 82.41, 98]; // A1 Bb1 B1 C2 D2 E2 G2
  var MELODY = [110, 0, 98, 0, 130.81, 0, 82.41, 0];        // A2 静 G2 静 C3 静 E2 静

  function drone(freq, dur, gain) {
    if (!ctx || !musicGain) return;
    var t0 = ctx.currentTime;
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    var fl = ctx.createBiquadFilter();
    fl.type = 'lowpass';
    fl.frequency.value = 240;
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
    o.frequency.value = 65;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.3, t0 + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.13);
    o.connect(g); g.connect(musicGain);
    o.start(t0); o.stop(t0 + 0.17);
  }
  function tick() {
    if (!musicReady()) { stopBGM(); return; }
    var i = step % DRONES.length;
    // 基础：低频打底 + 每拍律动 + 稀疏旋律
    drone(DRONES[i] / 2, 1.8, 0.11);
    drone(DRONES[(i + 3) % DRONES.length], 1.0, 0.07);
    var m = MELODY[step % MELODY.length];
    if (m > 0) osc2(m, 0.5, 0.045);
    if (tension >= 1) { // 警报搜索：心跳加速
      beat();
      beatOffset = (beatOffset + 1) % 2;
      if (beatOffset === 0) beat();
    }
    if (tension >= 2) { // 直接追捕：不和谐高频颤音
      osc2(DRONES[(i + 2) % DRONES.length] * 4 + Math.sin(step * 0.7) * 30, 0.4, 0.03);
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

  function intervalFor(t) { return t >= 2 ? 220 : (t >= 1 ? 320 : 500); }
  function startBGM() {
    if (!musicReady() || bgmTimer) return;
    step = 0;
    tick(); // 立即起拍，避免空窗
    bgmTimer = setInterval(tick, intervalFor(tension));
  }
  function stopBGM() {
    if (bgmTimer) { clearInterval(bgmTimer); bgmTimer = null; }
  }

  /* —— 对外接口 —— */
  Audio.setTension = function (v) {
    var nt = Math.max(0, Math.min(2, Math.round(v || 0)));
    if (nt === tension) return;
    tension = nt;
    if (bgmTimer) { // 仅调整节拍间隔，不打断已启用的音乐
      clearInterval(bgmTimer);
      bgmTimer = setInterval(tick, intervalFor(tension));
    }
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

  global.AlleyAudio = Audio;
  if (typeof module !== 'undefined' && module.exports) module.exports = Audio;
})(typeof window !== 'undefined' ? window : globalThis);