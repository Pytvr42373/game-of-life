(function (global) {
  'use strict';

  var AudioContextClass = global.AudioContext || global.webkitAudioContext;
  var ctx = null;
  var master = null;
  var ambience = null;
  var muted = false;
  var threat = 0;

  function ensure() {
    if (!AudioContextClass) return false;
    if (!ctx) {
      ctx = new AudioContextClass();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.24;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  }

  function start() {
    if (!ensure() || ambience) return;
    var low = ctx.createOscillator();
    var low2 = ctx.createOscillator();
    var filter = ctx.createBiquadFilter();
    var gain = ctx.createGain();
    low.type = 'sine'; low.frequency.value = 37;
    low2.type = 'triangle'; low2.frequency.value = 55.4;
    filter.type = 'lowpass'; filter.frequency.value = 160; filter.Q.value = 5;
    gain.gain.value = 0.16;
    low.connect(filter); low2.connect(filter); filter.connect(gain); gain.connect(master);
    low.start(); low2.start();
    ambience = { low: low, low2: low2, filter: filter, gain: gain };
  }

  function stop() {
    if (!ambience) return;
    try { ambience.low.stop(); ambience.low2.stop(); } catch (e) {}
    ambience = null;
  }

  function setThreat(value, oxygenRatio) {
    threat = Math.max(0, Math.min(1, value || 0));
    if (!ambience || !ctx) return;
    var now = ctx.currentTime;
    var oxygenStress = 1 - Math.max(0, Math.min(1, oxygenRatio == null ? 1 : oxygenRatio));
    ambience.filter.frequency.setTargetAtTime(150 + threat * 310 + oxygenStress * 120, now, 0.18);
    ambience.gain.gain.setTargetAtTime(0.13 + threat * 0.2 + oxygenStress * 0.09, now, 0.2);
    ambience.low2.frequency.setTargetAtTime(55.4 + threat * 13, now, 0.2);
  }

  function tone(frequency, duration, volume, type, delay) {
    if (!ensure()) return;
    var at = ctx.currentTime + (delay || 0);
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(frequency, at);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, volume || 0.1), at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(gain); gain.connect(master);
    osc.start(at); osc.stop(at + duration + 0.03);
  }

  function noise(duration, volume, highpass) {
    if (!ensure()) return;
    var length = Math.max(1, Math.floor(ctx.sampleRate * duration));
    var buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    var source = ctx.createBufferSource();
    var filter = ctx.createBiquadFilter();
    var gain = ctx.createGain();
    source.buffer = buffer;
    filter.type = 'highpass'; filter.frequency.value = highpass || 350;
    gain.gain.value = volume || 0.08;
    source.connect(filter); filter.connect(gain); gain.connect(master);
    source.start();
  }

  function play(event) {
    if (!event) return;
    var data = event.data || {};
    if (event.type === 'loot') {
      var notes = { common: 420, fine: 520, rare: 650, epic: 780, legendary: 980 };
      tone(notes[data.rarity] || 420, 0.22, 0.11, 'sine');
    } else if (event.type === 'gear') {
      tone(440, 0.34, 0.1, 'sine'); tone(660, 0.38, 0.09, 'sine', 0.08); tone(880, 0.42, 0.08, 'sine', 0.16);
    } else if (event.type === 'oxygen') {
      tone(540, 0.16, 0.07, 'sine'); tone(720, 0.2, 0.05, 'sine', 0.08);
    } else if (event.type === 'sharkGrab') {
      tone(46, 0.55, 0.2, 'sawtooth'); tone(38, 0.7, 0.13, 'sine', 0.13);
    } else if (event.type === 'sharkNest') {
      noise(0.35, 0.12, 110); tone(42, 0.9, 0.16, 'sawtooth');
    } else if (event.type === 'rescue') {
      tone(360, 0.18, 0.08, 'sine'); tone(540, 0.28, 0.07, 'sine', 0.1);
    } else if (event.type === 'hazard') {
      noise(0.24, 0.12, 150); tone(data.type === 'mine' ? 58 : 78, 0.42, 0.13, 'square');
    } else if (event.type === 'teammateLost') {
      tone(180, 0.35, 0.12, 'triangle'); tone(92, 0.7, 0.12, 'sine', 0.23);
    } else if (event.type === 'win') {
      tone(330, 0.3, 0.12, 'sine'); tone(495, 0.35, 0.11, 'sine', 0.14); tone(660, 0.5, 0.1, 'sine', 0.28);
    } else if (event.type === 'fail') {
      tone(180, 0.35, 0.14, 'sawtooth'); tone(90, 0.8, 0.15, 'sine', 0.22);
    }
  }

  function toggle() {
    muted = !muted;
    if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : 0.24, ctx.currentTime, 0.04);
    return !muted;
  }

  global.DeepSalvageAudio = {
    start: start,
    stop: stop,
    play: play,
    setThreat: setThreat,
    toggle: toggle,
    isEnabled: function () { return !muted; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
