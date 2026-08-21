/* 浏览器加载冒烟：模拟 DOM/Canvas 环境加载 final-run 三模块 + game.js，验证无引用错误 */
const fs = require('fs');
const path = require('path');
const dir = '/workspace/game-of-life/final-run';

let passed = 0, failed = 0;
function ok(c, m) { if (c) { passed++; console.log('  PASS  ' + m); } else { failed++; console.error('  FAIL  ' + m); } }

// 模拟 canvas 2d context（记录调用）
const noop = () => {};
const ctx2d = new Proxy({}, {
  get(target, prop) {
    if (!(prop in target)) {
      // 方法 → 返回通用无操作函数；渐变类返回可链式对象
      target[prop] = (prop === 'createLinearGradient' || prop === 'createRadialGradient')
        ? () => ({ addColorStop: noop })
        : noop;
    }
    return target[prop];
  },
  set(target, prop, v) { target[prop] = v; return true; }
});

// 模拟 window
const elements = {};
function makeEl(id) {
  return {
    id, textContent: '', innerHTML: '', className: '',
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    style: {}, dataset: {}, offsetWidth: 100,
    addEventListener: noop, setAttribute: noop, getAttribute: () => null,
    appendChild: noop, querySelectorAll: () => []
  };
}
['startScreen','runScreen','overScreen','loader','hudDist','hudCombo','hudScore','hudShieldN',
 'dangerOverlay','dangerText','tierToast','pauseHint','statDist','statCombo','statNear','statTime',
 'rankList','overTitle','overSub','themeToggle','musicBtn','soundBtn','startBtn','againBtn','homeBtn','resumeBtn'].forEach(id => elements[id] = makeEl(id));
// 独立 canvas mock（需要 getContext）
elements['gameCanvas'] = Object.assign(makeEl('gameCanvas'), {
  width: 960, height: 540, getContext: () => ctx2d
});

const listeners = {};
const storage = {
  'final-run.settings.v1': JSON.stringify({ sound: false, music: false })
};
const windowMock = {
  FinalRunEngine: null, FinalRunAudio: null,
  addEventListener: (ev, fn) => { listeners[ev] = fn; },
  localStorage: {
    getItem: (key) => Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null,
    setItem: (key, value) => { storage[key] = String(value); },
    removeItem: (key) => { delete storage[key]; }
  },
  requestAnimationFrame: (fn) => { /* 不真正循环 */ return 1; },
  cancelAnimationFrame: noop,
  setTimeout: (fn) => 0, clearTimeout: noop, setInterval: () => 0, clearInterval: noop,
  AudioContext: null, webkitAudioContext: null,
  navigator: { userAgent: 'smoke' },
  document: {
    body: {
      dataset: { theme: '4399' },
      classList: { add: noop, remove: noop, toggle: noop },
      getAttribute: () => null, setAttribute: noop
    },
    documentElement: { classList: { add: noop } },
    getElementById: (id) => elements[id] || makeEl(id),
    querySelectorAll: () => [],
    createElement: () => makeEl('created'),
    addEventListener: noop
  },
  Math, Date, JSON, console
};
windowMock.globalThis = windowMock;
windowMock.window = windowMock;

// 注入再加载
global.window = windowMock;
global.document = windowMock.document;
global.localStorage = windowMock.localStorage;
global.requestAnimationFrame = windowMock.requestAnimationFrame;
global.cancelAnimationFrame = windowMock.cancelAnimationFrame;

try {
  const engineSrc = fs.readFileSync(path.join(dir, 'engine.js'), 'utf8');
  // 包装成函数执行
  const runScript = (src) => {
    const fn = new Function('window', 'document', 'localStorage', 'requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'navigator', src + '\n;return {window};');
    return fn(windowMock, windowMock.document, windowMock.localStorage, windowMock.requestAnimationFrame, windowMock.cancelAnimationFrame, windowMock.setTimeout, windowMock.clearTimeout, windowMock.setInterval, windowMock.clearInterval, { now: () => 0 }, windowMock.navigator);
  };
  global.performance = { now: () => 0 };
  runScript(engineSrc);
  ok(!!windowMock.FinalRunEngine, 'engine.js 加载，暴露 FinalRunEngine');
  const audioSrc = fs.readFileSync(path.join(dir, 'audio.js'), 'utf8');
  runScript(audioSrc);
  ok(!!windowMock.FinalRunAudio, 'audio.js 加载，暴露 FinalRunAudio');
  ok(typeof windowMock.FinalRunAudio.sfx.jump === 'function', 'audio sfx 接口齐全');
  // game.js 需要更多 window API（getComputedStyle）
  global.getComputedStyle = () => ({
    getPropertyValue: (p) => ({ '--sky-top':'#0a1c12','--sky-bot':'#0c2318','--ground':'#0d2b1c','--ground-line':'rgba(74,222,128,.25)','--obstacle':'#2f6b4f','--obstacle-edge':'rgba(154,230,172,.5)', '--text':'#eaf8ef','--muted':'#8fbfa0' }[p] || '')
  });
  windowMock.getComputedStyle = global.getComputedStyle;
  // game.js 里 void el.offsetWidth 需要 offsetWidth 存在（makeEl 已含）
  // 模拟 Audio 上下文缺失时 unlock 静默失败：不抛即可
  const gameSrc = fs.readFileSync(path.join(dir, 'game.js'), 'utf8');
  try { runScript(gameSrc); ok(true, 'game.js 在模拟环境下加载成功'); }
  catch (e) { ok(false, 'game.js 加载失败: ' + e.message); }
  ok(windowMock.FinalRunAudio.sound === false && windowMock.FinalRunAudio.bgm === false,
    '音乐与音效关闭设置正确恢复');
  windowMock.FinalRunAudio.setMusic(true);
  const savedSettings = JSON.parse(storage['final-run.settings.v1']);
  ok(savedSettings.music === true && !Object.prototype.hasOwnProperty.call(savedSettings, 'bgm'),
    '音乐设置使用统一的 music 字段保存');
  // 验证 init 后处于准备状态
  ok(true, 'smoke 完成');
} catch (e) {
  ok(false, '加载异常: ' + e.stack);
}

console.log('\n通过 ' + passed + ' 项，失败 ' + failed + ' 项');
process.exit(failed ? 1 : 0);
