'use strict';
const fs = require('fs');
const path = require('path');
const dir = path.resolve(__dirname, '..');
let passed = 0, failed = 0;
function ok(c, m) { if (c) { passed++; } else { failed++; console.error('  FAIL  ' + m); } }
const noop = () => {};
const ctx2d = new Proxy({}, {
  get(t, p) {
    if (!(p in t)) t[p] = (p === 'createLinearGradient' || p === 'createRadialGradient') ? () => ({ addColorStop: noop }) : noop;
    return t[p];
  },
  set(t, p, v) { t[p] = v; return true; }
});
function makeEl(id) {
  const classes = new Set();
  const listeners = {};
  const attrs = {};
  return { id, textContent: '', innerHTML: '', className: '', style: {}, listeners,
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      toggle: (name, force) => {
        const on = force === undefined ? !classes.has(name) : !!force;
        if (on) classes.add(name); else classes.delete(name);
        return on;
      },
      contains: name => classes.has(name)
    },
    addEventListener: (type, fn) => { (listeners[type] || (listeners[type] = [])).push(fn); },
    dispatch: (type, event = {}) => (listeners[type] || []).forEach(fn => fn(Object.assign({ preventDefault: noop }, event))),
    setAttribute: (name, value) => { attrs[name] = String(value); },
    getAttribute: name => attrs[name] || null,
    appendChild: noop, focus: noop, disabled: false, hidden: false, inert: false, offsetWidth: 100, dataset: {} };
}
const ids = ['themeToggle','musicBtn','soundBtn','loader','startScreen','startBtn','runScreen',
  'hudLevel','hudTime','hudPhase','hudKey','hudStatus','pauseBtn','gameCanvas',
  'rulesBtn','rulesModal','rulesCloseBtn','rulesConfirmBtn','rulesLead',
  'dangerOverlay','dangerText','pauseHint','quitBtn','resumeBtn','hintToast',
  'tzUp','tzLeft','tzDown','tzRight','tzSprint','tzInteract',
  'overScreen','overTitle','overSub','statStars','statTime','statDetections',
  'nextBtn','againBtn','homeBtn','levelSelect'];
const elements = {};
ids.forEach(id => elements[id] = makeEl(id));
elements.gameCanvas = Object.assign(makeEl('gameCanvas'), { width: 960, height: 540, getContext: () => ctx2d });
const windowMock = {
  AlleyEngine: null, AlleyAudio: null,
  addEventListener: noop,
  localStorage: { getItem: () => null, setItem: noop },
  requestAnimationFrame: () => 1, cancelAnimationFrame: noop,
  setTimeout: () => 0, clearTimeout: noop,
  AudioContext: null, webkitAudioContext: null,
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  navigator: { userAgent: 'smoke' },
  document: {
    body: { dataset: { theme: '4399' }, classList: { add: noop, remove: noop, toggle: noop } },
    documentElement: { classList: { add: noop } },
    getElementById: id => elements[id] || makeEl(id),
    querySelectorAll: () => [],
    createElement: () => makeEl('created'),
    addEventListener: noop
  },
  Math, Date, JSON, console
};
global.window = windowMock;
global.document = windowMock.document;
global.localStorage = windowMock.localStorage;
global.requestAnimationFrame = windowMock.requestAnimationFrame;
global.cancelAnimationFrame = windowMock.cancelAnimationFrame;
global.getComputedStyle = windowMock.getComputedStyle;
try {
  const run = (src) => new Function('window','document','localStorage','requestAnimationFrame','cancelAnimationFrame','setTimeout','clearTimeout','performance','navigator','getComputedStyle', src)(windowMock, windowMock.document, windowMock.localStorage, windowMock.requestAnimationFrame, windowMock.cancelAnimationFrame, windowMock.setTimeout, windowMock.clearTimeout, { now: () => 0 }, windowMock.navigator, windowMock.getComputedStyle);
  run(fs.readFileSync(path.join(dir,'engine.js'),'utf8'));
  ok(!!windowMock.AlleyEngine, 'engine 暴露 AlleyEngine');
  const E = windowMock.AlleyEngine;
  ok(!!E.cfg && E.cfg.fovDist === 5, 'cfg.fovDist 固定 5');
  ok(Array.isArray(E.LEVELS) && E.LEVELS.length === 6, 'LEVELS 共 6 关');
  ok(typeof E.newGame === 'function' && typeof E.update === 'function', '引擎 newGame/update API');
  ok(typeof E.canSee === 'function' && typeof E.isSolid === 'function' && typeof E.lineOfSight === 'function', '引擎 canSee/isSolid/lineOfSight API');
  run(fs.readFileSync(path.join(dir,'audio.js'),'utf8'));
  ok(!!windowMock.AlleyAudio, 'audio 暴露 AlleyAudio');
  ok(!!windowMock.AlleyAudio.sfx && typeof windowMock.AlleyAudio.sfx.heard === 'function', 'audio.sfx.heard 存在');
  run(fs.readFileSync(path.join(dir,'game.js'),'utf8'));
  ok(true, 'game.js 加载无异常');
  ['hudPhase','hudKey','hudStatus','pauseBtn','rulesBtn','rulesModal','rulesConfirmBtn','quitBtn','tzSprint','tzInteract','statDetections'].forEach(id => {
    ok(!!elements[id], '元素存在: ' + id);
  });
  elements.startBtn.dispatch('click');
  ok(elements.rulesModal.classList.contains('show'), '点击开始先显示规则弹窗');
  ok(!elements.runScreen.classList.contains('active'), '确认规则前不启动关卡');
  elements.rulesConfirmBtn.dispatch('click');
  ok(elements.runScreen.classList.contains('active'), '点击开始进入游戏屏');
  elements.rulesBtn.dispatch('click');
  ok(elements.rulesModal.classList.contains('show'), 'HUD 规则按钮复用同一弹窗');
  ok(elements.rulesConfirmBtn.textContent === '继续当前任务', '游戏内弹窗显示继续文案');
  elements.rulesConfirmBtn.dispatch('click');
  ok(!elements.rulesModal.classList.contains('show'), '确认后关闭游戏内规则弹窗');
  elements.pauseBtn.dispatch('click');
  ok(elements.pauseHint.classList.contains('show'), 'HUD 暂停按钮生效');
  elements.resumeBtn.dispatch('click');
  ok(!elements.pauseHint.classList.contains('show'), '继续按钮恢复游戏');
  elements.tzSprint.dispatch('pointerdown');
  ok(elements.tzSprint.classList.contains('active'), '触屏冲刺按下反馈');
  elements.tzSprint.dispatch('pointerup');
  ok(!elements.tzSprint.classList.contains('active'), '触屏冲刺松开复位');
  elements.pauseBtn.dispatch('click');
  elements.quitBtn.dispatch('click');
  ok(elements.startScreen.classList.contains('active'), '放弃本关返回开始屏');
} catch (e) { ok(false, '加载异常: ' + e.stack); }
console.log('通过 ' + passed + '/' + (passed + failed));
process.exit(failed ? 1 : 0);
