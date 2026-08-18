/* ============================================================
 * smoke.js - 浏览器运行时冒烟测试 (DOM/canvas stub)
 * 验证 UI 初始化、菜单渲染、对局渲染、结算不抛异常
 * 运行：node smoke.js
 * ============================================================ */
'use strict';

// ---------- 极简 DOM / canvas stub ----------
function makeGradient() { return { addColorStop: function () {} }; }
function makeCtx() {
  const ctx = {};
  return new Proxy(ctx, {
    get(t, p) {
      if (p === 'canvas') return canvasEl;
      if (typeof p === 'string') {
        return function () { return makeGradient(); };
      }
      return undefined;
    },
    set() { return true; }
  });
}
let canvasEl = { width: 960, height: 540, getContext: function () { return ctx; }, style: {} };
const ctx = makeCtx();

function makeEl(id) {
  return {
    id: id, style: {}, className: '', textContent: '', innerHTML: '', value: '', checked: false,
    display: '', width: 0, height: 0,
    listeners: {},
    addEventListener: function (ev, fn) { this.listeners[ev] = fn; },
    appendChild: function () {}, append: function () {},
    setPointerCapture: function () {},
    getContext: function () { return makeCtx(); }
  };
}
const els = {};
const doc = {
  getElementById: function (id) { if (!els[id]) els[id] = makeEl(id); return els[id]; },
  createElement: function (tag) { if (tag === 'canvas') { const c = makeEl('c'); c.getContext = function () { return makeCtx(); }; return c; } return makeEl(tag); },
  addEventListener: function () {},
  body: { appendChild: function () {} }
};

globalThis.window = globalThis;
globalThis.document = doc;
globalThis.localStorage = {
  _d: {},
  getItem: function (k) { return this._d[k] !== undefined ? this._d[k] : null; },
  setItem: function (k, v) { this._d[k] = String(v); },
  removeItem: function (k) { delete this._d[k]; }
};
globalThis.performance = { now: function () { return Date.now(); } };
Object.defineProperty(globalThis, 'navigator', { value: { maxTouchPoints: 0 }, configurable: true });
let rafCb = null;
globalThis.requestAnimationFrame = function (cb) { rafCb = cb; return 1; };
globalThis.innerWidth = 1280;
globalThis.innerHeight = 720;
globalThis.window.addEventListener = function () {};
globalThis.window.innerWidth = 1280;
globalThis.window.innerHeight = 720;

// ---------- 装载(先挂载全局，再加载引擎) ----------
const mapsMod = require('./maps.js');
const charsMod = require('./chars.js');
const audioMod = require('./audio.js');
Object.assign(globalThis, {
  MAPS: mapsMod.MAPS, parseMap: mapsMod.parseMap, tileSolid: mapsMod.tileSolid,
  TILE: mapsMod.TILE, mapConnectivity: mapsMod.mapConnectivity
});
Object.assign(globalThis, {
  SURVIVORS: charsMod.SURVIVORS, HUNTERS: charsMod.HUNTERS,
  getSurvivor: charsMod.getSurvivor, getHunter: charsMod.getHunter
});
globalThis.AudioSys = audioMod.AudioSys;
require('./game.js');
require('./ai.js');
require('./ui.js');

const Game = globalThis.Game;
const UI = globalThis.UI;

function pump(n) {
  for (let i = 0; i < n; i++) {
    if (!rafCb) throw new Error('no raf callback');
    const cb = rafCb; rafCb = null;
    cb(performance.now() + i * 16);
    if (!rafCb) break;
  }
}

let ok = true;
function check(name, cond) {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name);
  if (!cond) ok = false;
}

try {
  const game = new Game();
  UI.start(game);
  pump(5); // 主菜单渲染
  check('主菜单渲染无异常', true);

  // 开始一局求生者
  game.startMatch({ mapIdx: 0, difficulty: 'normal', asHunter: false, charId: 'run', hunterId: 'hun_chase' });
  // 隐藏面板
  UI._uiInternals && null;
  pump(120); // 渲染约 2s 对局
  check('求生者对局渲染无异常', true);

  // 玩家移动输入
  const loop = globalThis._uiInternals.loop;
  // 通过键盘事件模拟：直接操纵 keys
  // ui.js 内部 keys 不可直接访问；改用给 game 设输入
  game.updateInput({ x: 0.7, y: 0.5, interact: false, skill: true, skill2: false, crouch: false, pause: false });
  game.update(1 / 30);
  pump(60);
  check('技能触发+渲染无异常', true);

  // 扮演监管者
  game.startMatch({ mapIdx: 1, difficulty: 'nightmare', asHunter: true, hunterId: 'hun_tele', charId: 'med' });
  pump(90);
  check('监管者对局渲染无异常', true);

  // 强制结算
  game.endMatch('survivor_win');
  pump(3);
  check('结算面板渲染无异常', true);
} catch (e) {
  console.log('CRASH: ' + e.stack);
  ok = false;
}

console.log(ok ? 'SMOKE OK' : 'SMOKE FAILED');
if (!ok) process.exit(1);
