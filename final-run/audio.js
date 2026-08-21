/* =====================================================================
 * audio.js —— 《终局狂奔》WebAudio 程序化音效 + 追逐感 BGM
 * 全部声音由 WebAudio 实时合成，无外部音频文件，完全自包含。
 * BGM：急促低音脉冲 + 稀疏高音；tension 递进：
 *   0=常规  1=追击者逼近(心跳+加速)  2=贴脸极度危险(高频颤音)
 * 音效：跳跃 / 二段跳 / 滑铲 / 落地 / 拾取 / 极限闪避 / 被撞 / 护盾破碎 /
 *       磁石冲刺 / 被抓 / 胜利 / 档位提升。
 * 开关持久化到 localStorage['final-run.settings.v1']。
 * 暴露全局 window.FinalRunAudio；node 环境自动跳过。
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

  function loadSettings() {
    try {
      var s = JSON.parse(localStorage.getItem('final-run.settings.v1') || 'null');
      if (s) {
        if (typeof s.sound === 'boolean') Audio.sound = s.sound;
        if (typeof s.music === 'boolean') Audio.bgm = s.music;
      }
    } catch (e) { /* 静默 */ }
  }
  function saveSettings() {
    try {
      localStorage.setItem('final-run.settings.v1', JSON.stringify({ sound: Audio.sound, music: Audio.bgm }));
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
      sfxGain.gain.value = Audio.sound ? 0.9 : 0;
      sfxGain.connect(master);
      musicGain = ctx.createGain();
      musicGain.gain.value = Audio.bgm ? 0.45 : 0;
      musicGain.connect(master);
    } catch (e) { ctx = null; }
  }

  function unlock() {
    ensure();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }
  function ready() { ensure(); return !!(ctx && Audio.sound); }
  function musicReady() { ensure(); return !!(ctx && Audio.bgm); }

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
    jump: function (dbl) { // 起跳（二段跳更高音 + 风啸）
      if (!ready()) return;
      if (dbl) {
        osc('triangle', 880, 1568, 0.16, 0.12);
        noise(0.12, 0.08, 0, 2400);
      } else {
        osc('triangle', 392, 784, 0.14, 0.12);
      }
    },
    slide: function () { // 滑铲（地面摩擦）
      if (!ready()) return;
      noise(0.22, 0.14, 0, 900);
      osc('sine', 180, 90, 0.2, 0.06);
    },
    land: function () { // 落地
      if (!ready()) return;
      osc('sine', 140, 70, 0.08, 0.1);
    },
    coin: function () { // 拾取金币
      if (!ready()) return;
      osc('sine', 1174, 1568, 0.09, 0.09);
      osc('sine', 1568, 2093, 0.12, 0.07, 0.05);
    },
    nearMiss: function () { // 极限闪避（短促上升音）
      if (!ready()) return;
      osc('sawtooth', 220, 660, 0.12, 0.08);
      osc('sawtooth', 330, 990, 0.14, 0.06, 0.04);
    },
    hit: function () { // 被撞
      if (!ready()) return;
      osc('square', 160, 60, 0.2, 0.22);
      noise(0.16, 0.2, 0, 1600);
    },
    shieldBreak: function () { // 护盾破碎
      if (!ready()) return;
      osc('square', 900, 300, 0.12, 0.14);
      osc('square', 1200, 380, 0.16, 0.1, 0.03);
      noise(0.1, 0.14, 0, 5200);
    },
    magnet: function () { // 磁石冲刺（引擎轰鸣）
      if (!ready()) return;
      osc('sawtooth', 110, 220, 0.5, 0.14);
      noise(0.5, 0.1, 0, 1200);
      osc('sine', 220, 440, 0.1, 0.08, 0.05);
    },
    shield: function () { // 获得护盾
      if (!ready()) return;
      osc('sine', 784, 1174, 0.12, 0.1);
      osc('sine', 1174, 1568, 0.16, 0.08, 0.05);
    },
    caught: function () { // 被捕获（黑暗沉降）
      if (!ready()) return;
      noise(0.6, 0.6, 0, 2600);
      osc('sawtooth', 220, 30, 0.7, 0.5);
      osc('sawtooth', 110, 26, 0.9, 0.35, 0.08);
      osc('sine', 50, 24, 1.4, 0.3, 0.15);
    },
    tierUp: function () { // 档位提升（短促警示）
      if (!ready()) return;
      osc('square', 523, 523, 0.09, 0.08);
      osc('square', 659, 659, 0.09, 0.08, 0.1);
      osc('square', 784, 784, 0.14, 0.08, 0.2);
    },
    gameover: function () { // 结算
      if (!ready()) return;
      [392, 330, 262, 196].forEach(function (f, i) { osc('triangle', f, f * 0.98, 0.3, 0.1, i * 0.16); });
      osc('sine', 60, 32, 1, 0.2, 0.1);
    }
  };

  /* —— BGM：急促低频脉冲（跑动感）+ 稀疏高音 ——
   * tension 0=常规 1=逼近 2=贴脸
   */
  var PULSE = [110, 123.47, 130.81, 146.83, 164.81]; // A2 B2 C3 D3 E3
  var MELODY = [440, 0, 523.25, 0, 392, 0, 523.25, 587.33];

  function pulse(freq, dur, gain) {
    if (!ctx || !musicGain) return;
    var t0 = ctx.currentTime;
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    var fl = ctx.createBiquadFilter();
    fl.type = 'lowpass';
    fl.frequency.value = 380;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(fl); fl.connect(g); g.connect(musicGain);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function heartbeat(when, gain) { // 双拍心跳（贴脸）
    if (!ctx || !musicGain) return;
    var t0 = ctx.currentTime + (when || 0);
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = 58;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain || 0.38, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
    o.connect(g); g.connect(musicGain);
    o.start(t0); o.stop(t0 + 0.16);
  }
  function melodyNote(freq, dur, gain) {
    if (!ctx || !musicGain) return;
    var t0 = ctx.currentTime;
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.03);
    g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(musicGain);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function tick() {
    if (!musicReady()) { stopBGM(); return; }
    var i = step % PULSE.length;
    // 双低音脉冲：跑动节奏
    pulse(PULSE[i], 0.22, 0.16);
    pulse(PULSE[(i + 2) % PULSE.length] / 2, 0.3, 0.09);
    var m = MELODY[step % MELODY.length];
    if (m > 0) melodyNote(m, 0.4, 0.035);
    if (tension >= 1) { // 逼近：心跳加速穿插
      heartbeat(0, 0.34);
      heartbeat(0.15, 0.24);
    }
    if (tension >= 2) { // 贴脸：高频不和谐颤音
      melodyNote(880 + Math.sin(step * 0.9) * 40, 0.18, 0.05);
    }
    step++;
  }

  function startBGM() {
    if (!musicReady() || bgmTimer) return;
    step = 0;
    tick();
    bgmTimer = setInterval(tick, tension >= 2 ? 240 : (tension >= 1 ? 300 : 420));
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
    if (sfxGain) sfxGain.gain.value = Audio.sound ? 0.9 : 0;
    saveSettings();
  };
  Audio.setMusic = function (v) {
    Audio.bgm = !!v;
    if (musicGain) musicGain.gain.value = Audio.bgm ? 0.45 : 0;
    if (Audio.bgm) { unlock(); startBGM(); } else stopBGM();
    saveSettings();
  };
  Audio.unlock = unlock;
  Audio.init = function () {
    loadSettings();
    if (sfxGain) sfxGain.gain.value = Audio.sound ? 0.9 : 0;
    if (musicGain) musicGain.gain.value = Audio.bgm ? 0.45 : 0;
  };

  global.FinalRunAudio = Audio;
  if (typeof module !== 'undefined' && module.exports) module.exports = Audio;
})(typeof window !== 'undefined' ? window : globalThis);
