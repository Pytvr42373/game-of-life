/* 浏览器加载冒烟：模拟 DOM/Canvas/localStorage 环境加载 final-run 全部脚本
 * （audio.js / engine.js / meta.js / game.js），验证无引用错误、可初始化。 */
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..');
let passed = 0, failed = 0;
function ok(c, m) { if (c) { passed++; console.log('  PASS  ' + m); } else { failed++; console.error('  FAIL  ' + m); } }

const noop = () => {};
const ctx2d = new Proxy({}, {
  get(target, prop) {
    if (!(prop in target)) {
      target[prop] = (prop === 'createLinearGradient' || prop === 'createRadialGradient')
        ? () => ({ addColorStop: noop })
        : noop;
    }
    return target[prop];
  },
  set(target, prop, v) { target[prop] = v; return true; }
});

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
const ALL_IDS = [
  'startScreen','runScreen','overScreen','loader',
  'hudDist','hudCombo','hudScore','hudShieldN','hudCoins','hudPassiveN',
  'dangerOverlay','dangerText','tierToast','pauseHint',
  'statDist','statCombo','statNear','statTime','statCoins','statRage','statPassive','statTotalDist',
  'rankList','overTitle','overSub',
  'rageHud','rageWaveN','passiveModal',
  'shopModal','shopCoin','skinGrid','itemGrid','shopBtn','shopClose',
  'dailyCard','dailyGoal','dailyProg','dailyOver','dailyOverGoal','dailyOverProg',
  'achieveStrip','archiveDist','archiveTime','coinCount','dailyGoalShort',
  'themeToggle','musicBtn','soundBtn','startBtn','againBtn','homeBtn','resumeBtn','shareBtn'
];
ALL_IDS.forEach(id => elements[id] = makeEl(id));
elements['gameCanvas'] = Object.assign(makeEl('gameCanvas'), {
  width: 960, height: 540, getContext: () => ctx2d,
  addEventListener: noop
});
elements['passiveModal'].querySelectorAll = () => [];
elements['shopModal'].addEventListener = noop;

// localStorage mock
const store = {};
const localStorageMock = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};

// 全局 mock
global.localStorage = localStorageMock;
global.navigator = { vibrate: noop, clipboard: undefined };
global.requestAnimationFrame = fn => { setTimeout(fn, 16); return 1; };
global.cancelAnimationFrame = noop;
global.window = global;
global.document = {
  body: { dataset: {} },
  getElementById: id => elements[id] || (elements[id] = makeEl(id)),
  querySelectorAll: () => [],
  createElement: () => makeEl('tmp'),
  addEventListener: noop,
  execCommand: () => true,
  documentElement: { classList: { add: noop } }
};
global.AudioContext = undefined;
global.getComputedStyle = () => ({ getPropertyValue: () => '' });
global.addEventListener = noop;

// 加载脚本
['audio.js', 'engine.js', 'meta.js', 'game.js'].forEach(f => {
  try {
    const code = fs.readFileSync(path.join(dir, f), 'utf-8');
    const fn = new Function('window', 'globalThis', 'document', 'localStorage', 'navigator', 'requestAnimationFrame', 'cancelAnimationFrame', code + '\n//# sourceURL=' + f);
    fn(global, global, global.document, localStorageMock, global.navigator, global.requestAnimationFrame, global.cancelAnimationFrame);
    ok(true, f + ' 加载无异常');
  } catch (e) {
    ok(false, f + ' 加载异常: ' + e.message);
  }
});

// 验证全局对象
ok(!!global.FinalRunEngine, 'FinalRunEngine 已暴露');
ok(!!global.FinalRunAudio, 'FinalRunAudio 已暴露');
ok(!!global.FinalRunMeta, 'FinalRunMeta 已暴露');
ok(global.FinalRunMeta.ACHS.length >= 12, 'meta 成就定义 ≥ 12');
ok(global.FinalRunMeta.ZONES.length === 6, 'meta 生态区 = 6');

console.log('\n' + (failed === 0 ? '通过 ' + passed + ' 项，全部通过' : '通过 ' + passed + ' 项，失败 ' + failed + ' 项'));
process.exit(failed === 0 ? 0 : 1);
