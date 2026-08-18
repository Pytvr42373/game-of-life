/* ============================================================
 * audio.js - WebAudio 程序化音效 (零外部依赖)
 * 心跳 / 修机 / 校准 / 攻击 / 板窗 / 传送 / 氛围低鸣 / 追逐压迫
 * ============================================================ */
var AudioSys = (function () {
  var ctx = null, master = null, muted = false, volume = 0.7;
  var heartRate = 0, heartNext = 0, ambienceOn = false, chaseOn = false;
  var ambNodes = [], chaseNodes = [];
  var noiseBuf = null;

  function init() {
    if (ctx) return true;
    var AC = (typeof window !== 'undefined') ? (window.AudioContext || window.webkitAudioContext) : null;
    if (!AC) return false;
    try { ctx = new AC(); } catch (e) { return false; }
    master = ctx.createGain();
    master.gain.value = muted ? 0 : volume;
    master.connect(ctx.destination);
    // 生成噪声缓冲 (用于风、撞击等)
    var len = ctx.sampleRate * 2;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }
  function resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); }
  function setVolume(v) { volume = v; if (master) master.gain.value = muted ? 0 : v; }
  function setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : volume; }

  function now() { return ctx ? ctx.currentTime : 0; }

  function tone(freq, dur, type, vol, slideTo, delay) {
    if (!ctx) return;
    var t0 = now() + (delay || 0);
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.2, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  function noise(dur, vol, filterFreq, filterType, delay, q) {
    if (!ctx || !noiseBuf) return;
    var t0 = now() + (delay || 0);
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    var f = ctx.createBiquadFilter();
    f.type = filterType || 'lowpass';
    f.frequency.value = filterFreq || 800;
    if (q) f.Q.value = q;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.15, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0); src.stop(t0 + dur + 0.05);
  }

  return {
    init: init, resume: resume, setVolume: setVolume, setMuted: setMuted,
    get ready() { return !!ctx; },
    get chaseOn() { return chaseOn; },

    uiClick: function () { tone(660, 0.06, 'square', 0.08); },
    uiOpen: function () { tone(440, 0.1, 'sine', 0.12); tone(660, 0.12, 'sine', 0.1, null, 0.06); },

    decodeTick: function (p) { tone(300 + Math.random() * 40, 0.05, 'square', 0.03); },
    checkGood: function () { tone(520, 0.12, 'triangle', 0.16); },
    checkPerfect: function () { tone(700, 0.1, 'triangle', 0.18); tone(1050, 0.14, 'triangle', 0.14, null, 0.07); },
    checkFail: function () { tone(200, 0.3, 'sawtooth', 0.2, 120); noise(0.3, 0.12, 500, 'highpass'); },
    machineDone: function () { tone(520, 0.2, 'sine', 0.16); tone(780, 0.22, 'sine', 0.16, null, 0.12); tone(1040, 0.3, 'sine', 0.14, null, 0.26); },

    vault: function () { noise(0.22, 0.12, 1400, 'bandpass', 0, 2); tone(220, 0.18, 'sine', 0.08, 320); },
    palletDrop: function () { noise(0.18, 0.3, 300, 'lowpass'); tone(90, 0.2, 'sine', 0.25, 45); noise(0.4, 0.12, 2500, 'highpass', 0.05); },
    palletBreak: function () { noise(0.25, 0.3, 900, 'bandpass', 0, 3); noise(0.3, 0.2, 2400, 'highpass'); },

    hit: function () { noise(0.12, 0.28, 700, 'lowpass'); tone(140, 0.15, 'sawtooth', 0.22, 70); },
    hurt: function () { tone(300, 0.25, 'sawtooth', 0.16, 180); },
    downed: function () { tone(120, 0.5, 'sawtooth', 0.25, 50); noise(0.3, 0.2, 400, 'lowpass'); },
    heal: function () { tone(480, 0.12, 'sine', 0.12); tone(620, 0.12, 'sine', 0.1, null, 0.1); },
    rescue: function () { tone(320, 0.15, 'triangle', 0.14, 520); noise(0.2, 0.1, 2000, 'highpass'); },

    gatePower: function () { tone(160, 1.2, 'sine', 0.16, 240); tone(80, 1.4, 'sine', 0.12, 40, 0.1); },
    gateOpen: function () { noise(1.2, 0.14, 600, 'lowpass'); tone(90, 1.0, 'sawtooth', 0.06, 50); },
    chairPlace: function () { noise(0.15, 0.3, 500, 'lowpass'); tone(110, 0.25, 'square', 0.18, 60); },
    chairTick: function () { tone(300, 0.06, 'square', 0.05, 260); },

    teleport: function () { noise(0.5, 0.2, 3000, 'bandpass', 0, 4); tone(500, 0.4, 'sine', 0.12, 1200); },
    reveal: function () { tone(880, 0.2, 'sine', 0.12); tone(1320, 0.3, 'sine', 0.1, null, 0.12); },
    dash: function () { noise(0.35, 0.18, 1800, 'bandpass', 0, 3); tone(180, 0.3, 'sawtooth', 0.1, 420); },

    invis: function () { tone(240, 0.4, 'sine', 0.08, 120); noise(0.4, 0.06, 1000, 'highpass'); },
    shield: function () { tone(400, 0.3, 'triangle', 0.14, 800); },
    stun: function () { tone(200, 0.25, 'square', 0.14, 100); },

    win: function () { [523, 659, 784, 1046].forEach(function (f, i) { tone(f, 0.3, 'triangle', 0.16, null, i * 0.14); }); },
    lose: function () { [392, 330, 262, 196].forEach(function (f, i) { tone(f, 0.4, 'sawtooth', 0.12, null, i * 0.16); }); },

    /* 心跳：按 bpm 播放心跳脉冲，每帧调用 */
    setHeartRate: function (bpm) { heartRate = bpm; },
    updateHeart: function () {
      if (!ctx || heartRate <= 0) return;
      if (now() >= heartNext) {
        tone(55, 0.12, 'sine', 0.35, 40);
        tone(45, 0.1, 'sine', 0.22, 35, 0.16);
        heartNext = now() + 60 / Math.max(30, heartRate);
      }
    },
    stopHeart: function () { heartRate = 0; heartNext = 0; },

    /* 环境低鸣：潮湿的风 + 低频嗡鸣 */
    startAmbience: function () {
      if (!ctx || ambienceOn) return;
      ambienceOn = true;
      var g = ctx.createGain();
      g.gain.value = 0.06;
      var src = ctx.createBufferSource();
      src.buffer = noiseBuf; src.loop = true;
      var f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 300;
      src.connect(f); f.connect(g); g.connect(master);
      src.start();
      var o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = 48;
      var g1 = ctx.createGain(); g1.gain.value = 0.05;
      o1.connect(g1); g1.connect(master); o1.start();
      var o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 61;
      var g2 = ctx.createGain(); g2.gain.value = 0.03;
      o2.connect(g2); g2.connect(master); o2.start();
      ambNodes = [src, o1, o2];
    },
    stopAmbience: function () {
      ambienceOn = false;
      ambNodes.forEach(function (n) { try { n.stop(); } catch (e) {} });
      ambNodes = [];
    },

    /* 追逐压迫音（低频脉冲 + 持续紧张感） */
    startChase: function () {
      if (!ctx || chaseOn) return;
      chaseOn = true;
      var g = ctx.createGain(); g.gain.value = 0.05;
      var o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 55;
      var f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 220;
      o.connect(f); f.connect(g); g.connect(master); o.start();
      chaseNodes = [o, g];
    },
    stopChase: function () {
      chaseOn = false;
      chaseNodes.forEach(function (n) { try { n.stop(); } catch (e) {} });
      chaseNodes = [];
    }
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AudioSys: AudioSys };
}
