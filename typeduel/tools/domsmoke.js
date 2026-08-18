/* =====================================================================
 * tools/domsmoke.js —— 轻量 DOM 桩 + 游戏集成冒烟自测（无 jsdom 依赖）
 * 运行：node tools/domsmoke.js
 * 用自定义 DOM 桩替换 jsdom（本沙箱 jsdom 加载过慢），手动驱动帧循环，
 * 验证：启动、锁定/逐字母判定、击杀计分、错误三连、护盾、技能、
 *      触底扣心、Boss 流程、限时、生存、暂停、结算、localStorage 键。
 * ===================================================================== */
'use strict';

/* ================= 极简 DOM 桩 ================= */
function ctx2d() {
  return new Proxy({}, {
    get(t, k) {
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
      if (k === 'measureText') return () => ({ width: 10 });
      return () => undefined;
    },
    set() { return true; }
  });
}

const IDS = ['themeToggle','loader','menuScreen','modeCampaign','modeSprint','modeSurvival',
  'modeDesc','diffGroup','diffNormal','diffHard','diffInferno','sprintGroup','sprintShort',
  'sprintStandard','sprintLong','startBtn','menuBestWpm','menuGames','menuMaxCombo','menuStage',
  'menuLbList','lbBtn','statsBtn','settingsBtn','battleStage','hud','hudWpm','hudAcc','hudCombo',
  'hudHearts','hudHpWrap','hpFill','hpText','hudWord','hudTime','hudSub','arena','bossBanner',
  'bossName','bossCountdown','bossSub','bossHud','bossPips','combatToast','touchGate','touchGateClose',
  'pauseScreen','resumeBtn','restartBtn','pauseMenuBtn','resultScreen','resultTitle','resultCode',
  'resultReason','resultExtra','resultStats','resultSkills','retryBtn','resultMenuBtn','statsScreen',
  'closeStats','trendCanvas','historyList','lbScreen','closeLb','lbList','settingsScreen',
  'closeSettings','setSound','setBgm','setShake','setReduced','history-filter'];

function makeEl(id) {
  var el = {
    id: id || '', _cls: {}, style: {}, dataset: {}, children: [], _listeners: {},
    width: id === 'arena' ? 960 : 0, height: id === 'arena' ? 640 : 0,
    _inner: '', _text: '',
    classList: {
      add: function (c) { el._cls[c] = 1; },
      remove: function (c) { delete el._cls[c]; },
      toggle: function (c, force) {
        if (force === undefined) { if (el._cls[c]) { delete el._cls[c]; return false; } el._cls[c] = 1; return true; }
        if (force) el._cls[c] = 1; else delete el._cls[c];
        return !!force;
      },
      contains: function (c) { return !!el._cls[c]; }
    },
    set innerHTML(v) { el._inner = String(v); },
    get innerHTML() { return el._inner; },
    set textContent(v) { el._text = String(v); },
    get textContent() { return el._text; },
    setAttribute: function (k, v) { el.dataset[k] = String(v); },
    getAttribute: function (k) { return el.dataset[k]; },
    removeAttribute: function (k) { delete el.dataset[k]; },
    addEventListener: function (ev, fn, opts) { (el._listeners[ev] = el._listeners[ev] || []).push(fn); },
    appendChild: function (c) { el.children.push(c); return c; },
    getContext: function () { return ctx2d(); },
    querySelectorAll: function () { return []; },
    focus: function () {}, blur: function () {}
  };
  return el;
}

const elements = {};
IDS.forEach(function (i) { elements[i] = makeEl(i); });

function audioEl() {
  var a = makeEl('audio-stub');
  a.loop = false; a.preload = 'auto'; a.volume = 1; a.paused = true; a.src = '';
  a.play = function () { a.paused = false; return Promise.resolve(); };
  a.pause = function () { a.paused = true; };
  return a;
}
var theAudio = audioEl();

const listeners = {};
const documentStub = {
  readyState: 'complete',
  body: makeEl('body'),
  documentElement: makeEl('html'),
  getElementById: function (id) { return elements[id] || null; },
  createElement: function (tag) { return tag === 'audio' ? theAudio : makeEl(tag); },
  addEventListener: function (ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
  querySelectorAll: function () { return []; },
  querySelector: function () { return null; }
};
function fire(ev, obj) {
  (listeners[ev] || []).forEach(function (fn) { fn(obj); });
}

const store = {};
const localStorageStub = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem: function (k, v) { store[k] = String(v); },
  removeItem: function (k) { delete store[k]; }
};

let rafCb = null;
let vtime = 0;
global.window = {
  document: documentStub,
  localStorage: localStorageStub,
  performance: { now: function () { return vtime; } },
  requestAnimationFrame: function (cb) { rafCb = cb; return 1; },
  matchMedia: function () { return { matches: false }; },
  AudioContext: undefined,
  webkitAudioContext: undefined
};
global.document = documentStub;
global.localStorage = localStorageStub;
global.performance = global.window.performance;
global.requestAnimationFrame = global.window.requestAnimationFrame;

/* ================= 注入脚本（按序） ================= */
['../words.js', '../stats.js', '../audio.js', '../game.js'].forEach(function (f) {
  require(f);
});
function runFrame(dt) {
  var cb = rafCb;
  if (!cb) return;
  rafCb = null;
  vtime += (dt || 16);
  cb(vtime);
}

/* ================= 断言 ================= */
var pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✔ ' + name); }
  catch (e) { fail++; console.log('  ✘ ' + name + ' :: ' + e.message); }
}
function assert(x, m) { if (!x) throw new Error(m || 'assertion failed'); }
var game = global.window.__typeduel;

console.log('== 启动 ==');
t('全局对象与游戏实例', function () {
  assert(global.window.WORDS && global.window.TDCORE && global.window.TypeDuelStats && global.window.TypeDuelAudio);
  assert(game && game.state === 'MENU');
});
t('渲染帧可执行（render 不抛错）', function () {
  game.mode = 'campaign'; game.start();
  runFrame(16); runFrame(16);
  assert(game.state === 'PLAYING');
});

console.log('== 经典玩法链 ==');
t('锁定+逐字母判定+整词击杀计分', function () {
  game.enemies = []; game.score = 0; game.combo = 0; game.kills = 0; game.correctKeys = 0;
  var e = { id: 't1', type: 'common', col: 0, row: 0, rowT: 0, speedBase: 1, errorBoost: 0,
            progress: 0, spawnT: 0, shakeT: 0, errorFlashT: 0, lastErrorChar: '', shieldBroken: false, outerWord: '', word: 'cat' };
  game.enemies.push(e);
  game.handleKey('c'); assert(e.progress === 1 && game.target === e, '锁定失败');
  game.handleKey('a'); game.handleKey('t');
  assert(game.bullets.length === 1, '未发射子弹');
  runFrame(60); runFrame(60); runFrame(60); runFrame(60);
  assert(game.enemies.length === 0 && game.kills === 1 && game.combo === 1, '击杀结算失败');
  assert(game.score >= 30 && game.correctKeys === 3);
});
t('错误三连：标红/连击清零/-5分/敌速+15%', function () {
  game.enemies = []; game.score = 100; game.combo = 5; game.errorKeys = 0;
  var e = { id: 't2', type: 'common', col: 1, row: 0, rowT: 0, speedBase: 1, errorBoost: 0,
            progress: 0, spawnT: 0, shakeT: 0, errorFlashT: 0, lastErrorChar: '', shieldBroken: false, outerWord: '', word: 'dog' };
  game.enemies.push(e);
  game.handleKey('d'); /* 先锁定目标，前缀命中 */
  assert(game.target === e && e.progress === 1);
  game.handleKey('x'); /* 错误击键 */
  assert(game.errorKeys === 1 && game.combo === 0 && game.score === 95, 'errorKeys=' + game.errorKeys + ' combo=' + game.combo + ' score=' + game.score);
  assert(Math.abs(e.errorBoost - 0.15) < 1e-9 && e.errorFlashT > 0 && e.shakeT > 0);
  /* 再错一次：敌速叠加至 +30% */
  game.handleKey('x');
  assert(Math.abs(e.errorBoost - 0.30) < 1e-9, '敌速应叠加');
  assert(game.score === 90);
});
t('退格删除前缀 / 删到 0 解除锁定', function () {
  game.enemies = []; 
  var e = { id: 't6', type: 'common', col: 3, row: 0, rowT: 0, speedBase: 1, errorBoost: 0,
            progress: 0, spawnT: 0, shakeT: 0, errorFlashT: 0, lastErrorChar: '', shieldBroken: false, outerWord: '', word: 'win' };
  game.enemies.push(e);
  game.handleKey('w'); game.handleKey('i');
  assert(e.progress === 2);
  game.handleBackspace(); assert(e.progress === 1);
  game.handleBackspace(); assert(e.progress === 0);
  game.handleBackspace(); assert(game.target === null, '应解除锁定');
});
t('护盾破盾 +50 后再击内词', function () {
  game.enemies = []; game.score = 0; game.kills = 0;
  var e = { id: 't3', type: 'shield', col: 2, row: 0, rowT: 0, speedBase: 0.9, errorBoost: 0,
            progress: 0, spawnT: 0, shakeT: 0, errorFlashT: 0, lastErrorChar: '', shieldBroken: false, outerWord: 'red', word: 'planet' };
  game.enemies.push(e);
  'red'.split('').forEach(function (c) { game.handleKey(c); });
  assert(e.shieldBroken && e.progress === 0 && game.score === 50);
  'planet'.split('').forEach(function (c) { game.handleKey(c); });
  runFrame(60); runFrame(60); runFrame(60); runFrame(60);
  assert(game.enemies.length === 0 && game.kills === 1);
});
t('技能 HEAL 回心 / BOMB 清屏按原分结算', function () {
  game.enemies = []; game.hearts = 3; game.maxHearts = 7; game.score = 0; game.kills = 0;
  game.skillsUsed = { heal: 0, bomb: 0, freeze: 0, slow: 0 };
  var h = { id: 't4', type: 'skill', col: 4, row: 0, rowT: 0, speedBase: 0.8, errorBoost: 0,
            progress: 0, spawnT: 0, shakeT: 0, errorFlashT: 0, lastErrorChar: '', shieldBroken: false, outerWord: '', word: 'heal' };
  game.enemies.push(h);
  'heal'.split('').forEach(function (c) { game.handleKey(c); });
  runFrame(60); runFrame(60); runFrame(60); runFrame(60);
  assert(game.skillsUsed.heal === 1 && game.hearts === 4, 'HEAL 失败');
  game.skillsUsed = { heal: 0, bomb: 0, freeze: 0, slow: 0 }; game.enemies = []; game.kills = 0; game.score = 0;
  [['bomb', 0], ['cat', 1], ['sun', 2]].forEach(function (p) {
    game.enemies.push({ id: 'b' + p[1], type: p[0] === 'bomb' ? 'skill' : 'common', col: p[1], row: 0, rowT: 0,
      speedBase: 1, errorBoost: 0, progress: 0, spawnT: 0, shakeT: 0, errorFlashT: 0, lastErrorChar: '', shieldBroken: false, outerWord: '', word: p[0] });
  });
  'bomb'.split('').forEach(function (c) { game.handleKey(c); });
  runFrame(60); runFrame(60); runFrame(60); runFrame(60);
  assert(game.skillsUsed.bomb === 1 && game.enemies.length === 0 && game.kills === 2);
});
t('触底扣心（奖励词 -2）', function () {
  game.mode = 'campaign'; game.hearts = 5; game.beatMs = 1000;
  game.enemies = [];
  var e = { id: 't5', type: 'common', col: 5, row: 7, rowT: 0.99, speedBase: 1, errorBoost: 0,
            progress: 0, spawnT: 0, shakeT: 0, errorFlashT: 0, lastErrorChar: '', shieldBroken: false, outerWord: '', word: 'zzz' };
  game.enemies.push(e);
  game.updateEnemies(0.1);
  assert(game.enemies.length === 0 && game.hearts === 4, '普通触底 -1 心失败');
  var b = { id: 't7', type: 'bonus', col: 6, row: 7, rowT: 0.99, speedBase: 0.7, errorBoost: 0,
            progress: 0, spawnT: 0, shakeT: 0, errorFlashT: 0, lastErrorChar: '', shieldBroken: false, outerWord: '', word: 'WOW' };
  game.enemies.push(b);
  game.updateEnemies(0.1);
  assert(game.hearts === 2, '奖励词触底应 -2 心 hearts=' + game.hearts);
});

console.log('== Boss ==');
t('Boss 关：预警→入场→三段击杀→过关', function () {
  game.mode = 'campaign'; game.difficulty = 'normal'; game.setupStage(3);
  game.spawned = game.quota; game.enemies = [];
  game.checkStage();
  assert(game.phase === 'BOSS_WAIT', '应进入 BOSS_WAIT');
  game.bossWaitT = 0; game.update(0.05);
  assert(game.phase === 'BOSS' && game.boss, 'Boss 未入场');
  game.boss.segments.slice().forEach(function (w) {
    w.split('').forEach(function (c) { game.handleKey(c); });
    runFrame(60); runFrame(60); runFrame(60); runFrame(60);
  });
  assert(game.boss === null && game.stage === 4, 'Boss 击杀后未过关');
});
t('第 12 关通关 → 胜利结算', function () {
  game.mode = 'campaign'; game.difficulty = 'normal'; game.setupStage(12);
  game.spawned = game.quota; game.enemies = [];
  game.checkStage(); game.bossWaitT = 0; game.update(0.05);
  game.boss.segments.slice().forEach(function (w) {
    w.split('').forEach(function (c) { game.handleKey(c); });
    runFrame(60); runFrame(60); runFrame(60); runFrame(60);
  });
  assert(game.state === 'OVER' && game.win, '未胜利结算');
  assert(elements.resultScreen.classList.contains('show'));
});

console.log('== 限时 / 生存 ==');
t('限时倒计时归零 → 结算并写 Top10', function () {
  game.mode = 'sprint'; game.sprintTier = 'standard'; game.start();
  game.timeLeft = 0.3; game.update(0.5);
  assert(game.state === 'OVER');
  assert(global.window.TypeDuelStats.getLeaderboard().length >= 1, 'Top10 未写入');
});
t('生存 HP 衰减归零 → 结算', function () {
  game.mode = 'survival'; game.start(); game.hp = 1; game.update(0.6);
  assert(game.state === 'OVER');
});

console.log('== 暂停 / 键盘 / BGM 挂载点 ==');
t('P/Esc 暂停与恢复', function () {
  game.mode = 'campaign'; game.start();
  fire('keydown', { key: 'Escape', preventDefault: function () {} });
  assert(game.state === 'PAUSED' && elements.pauseScreen.classList.contains('show'));
  fire('keydown', { key: 'Escape', preventDefault: function () {} });
  assert(game.state === 'PLAYING');
});
t('M（Shift+m）静音切换 / 战斗中 m 用于打字', function () {
  game.mode = 'campaign'; game.start();
  fire('keydown', { key: 'M', preventDefault: function () {} });
  assert(global.window.TypeDuelAudio.isMuted() === true, 'Shift+M 未静音');
  fire('keydown', { key: 'M', preventDefault: function () {} });
  assert(global.window.TypeDuelAudio.isMuted() === false);
  /* 战斗中小写 m 作为打字字母，不应静音 */
  game.enemies = []; game.combo = 0; game.errorKeys = 0; game.score = 10;
  var e = { id: 'm1', type: 'common', col: 0, row: 0, rowT: 0, speedBase: 1, errorBoost: 0,
            progress: 0, spawnT: 0, shakeT: 0, errorFlashT: 0, lastErrorChar: '', shieldBroken: false, outerWord: '', word: 'magic' };
  game.enemies.push(e);
  fire('keydown', { key: 'm', preventDefault: function () {} });
  assert(global.window.TypeDuelAudio.isMuted() === false, '战斗中 m 不应静音');
  assert(game.target === e && e.progress === 1, 'm 应作为打字字母');
});
t('BGM 挂载点：菜单→battle→boss→result 依次加载 mp3', function () {
  global.window.TypeDuelAudio.setBgmEnabled(true);
  global.window.TypeDuelAudio.playBgm('menu');
  assert(theAudio.src.indexOf('bgm_menu.mp3') >= 0, 'menu: ' + theAudio.src);
  global.window.TypeDuelAudio.playBgm('battle');
  assert(theAudio.src.indexOf('bgm_battle.mp3') >= 0);
  global.window.TypeDuelAudio.playBgm('boss');
  assert(theAudio.src.indexOf('bgm_boss.mp3') >= 0);
  global.window.TypeDuelAudio.playBgm('result');
  assert(theAudio.src.indexOf('bgm_result.mp3') >= 0);
});
t('audio.js 暴露 4 个 BGM 文件名（§8.5）', function () {
  var f = global.window.TypeDuelAudio.bgmFiles;
  assert(f.menu === 'assets/audio/bgm_menu.mp3');
  assert(f.battle === 'assets/audio/bgm_battle.mp3');
  assert(f.result === 'assets/audio/bgm_result.mp3');
  assert(f.boss === 'assets/audio/bgm_boss.mp3');
});
t('localStorage 键名写入正确（§6.3/§8.4）', function () {
  game.mode = 'campaign'; game.difficulty = 'normal'; game.start();
  /* 清关 1 → 2 触发 progress 写入 */
  game.enemies = []; game.clearStage();
  assert(store['typeduel.progress.v1'], 'progress 未写');
  var prog = JSON.parse(store['typeduel.progress.v1']);
  assert(prog.stage.normal >= 2, 'stage 未推进');
  /* 结算 → history / stats */
  game.score = 100; game.peakWpm = 30; game.correctKeys = 20; game.errorKeys = 2; game.maxCombo = 5;
  game.elapsed = 60; game.kills = 3; game.partialWords = 1; game.skillsUsed = { heal: 1, bomb: 0, freeze: 0, slow: 0 };
  game.finish('lose');
  assert(store['typeduel.history.v1'], 'history 未写');
  assert(store['typeduel.stats.v1'], 'stats 未写');
  var hist = JSON.parse(store['typeduel.history.v1']);
  assert(hist.length >= 1 && hist[hist.length - 1].rating >= 0 && hist[hist.length - 1].grade, '历史条目字段缺失');
  var st = JSON.parse(store['typeduel.stats.v1']);
  assert(st.totalGames >= 1 && st.skillUse.heal >= 1, '聚合统计字段缺失');
});

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail > 0 ? 1 : 0);
