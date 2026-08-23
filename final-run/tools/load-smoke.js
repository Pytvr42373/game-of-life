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
  'hudDist','hudCombo','hudScore','hudShieldN','hudCoins',
  'dangerOverlay','dangerText','tierToast','pauseHint',
  'statDist','statCombo','statNear','statTime','statCoins','statRage','statTotalDist',
  'rankList','overTitle','overSub',
  'rageHud','rageWaveN',
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
ok(global.FinalRunMeta.ZONES.length === 3, 'meta 三幕场景配色 = 3');
ok(global.FinalRunMeta.ACTS.length === 3, 'meta 三幕场景 = 3');
ok(global.FinalRunMeta.SKINS.every(sk => typeof sk.unlockRuns === 'number'), '皮肤带累计开局解锁门槛');
ok(global.FinalRunEngine.cfg.finishDist === 1000, '引擎总程 1000m');
ok(global.FinalRunEngine.cfg.actStep === 333, '三幕阈值 333m');
ok(global.FinalRunEngine.cfg.speedLow === 0.78 && global.FinalRunEngine.cfg.speedHigh === 1.8, '速度档 0.78x → 1.8x');
ok(typeof global.FinalRunEngine.applyPassive === 'undefined', '引擎无 Rogue 被动接口');

console.log('\n' + (failed === 0 ? '通过 ' + passed + ' 项，全部通过' : '通过 ' + passed + ' 项，失败 ' + failed + ' 项'));
process.exit(failed === 0 ? 0 : 1);
