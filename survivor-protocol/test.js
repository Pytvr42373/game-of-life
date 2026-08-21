'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const api = require('./game.js');

let passed = 0;

function test(name, fn) {
  fn();
  passed++;
  console.log('PASS  ' + name);
}

test('经验需求按等级线性增长', function () {
  assert.strictEqual(api.xpRequired(1), 10);
  assert.strictEqual(api.xpRequired(5), 38);
  assert.strictEqual(api.xpRequired(10), 73);
});

test('六段波次边界准确', function () {
  assert.strictEqual(api.waveAt(0).rate, 1.05);
  assert.strictEqual(api.waveAt(44.999).rate, 1.05);
  assert.strictEqual(api.waveAt(45).rate, 1.6);
  assert.strictEqual(api.waveAt(90).rate, 2);
  assert.strictEqual(api.waveAt(180).rate, 2.9);
  assert.strictEqual(api.waveAt(299.999).rate, 3.6);
  assert.strictEqual(api.waveAt(300), null);
});

test('固定种子随机数可复现', function () {
  const a = api.createRng(42373);
  const b = api.createRng(42373);
  for (let i = 0; i < 20; i++) assert.strictEqual(a(), b());
});

test('胜负同帧优先级为最终 Boss、玩家、超时', function () {
  assert.strictEqual(api.resolveOutcome({bossDead: true, finalBoss: true, playerDead: true, timeUp: true}), 'win');
  assert.strictEqual(api.resolveOutcome({bossDead: true, finalBoss: false, playerDead: false, timeUp: false}), null);
  assert.strictEqual(api.resolveOutcome({bossDead: false, playerDead: true, timeUp: true}), 'dead');
  assert.strictEqual(api.resolveOutcome({bossDead: false, playerDead: false, timeUp: true}), 'timeout');
  assert.strictEqual(api.resolveOutcome({bossDead: false, playerDead: false, timeUp: false}), null);
});

test('Boss 在半血切换第二阶段', function () {
  const adj = {hp: 5400, phaseHp: 2700};
  const exec = {hp: 12500, phaseHp: 6500};
  assert.strictEqual(api.bossPhase(adj), 1);
  adj.hp = 2701; assert.strictEqual(api.bossPhase(adj), 1);
  adj.hp = 2700; assert.strictEqual(api.bossPhase(adj), 2);
  assert.strictEqual(api.bossPhase(exec), 1);
  exec.hp = 6500; assert.strictEqual(api.bossPhase(exec), 2);
});

test('两个 Boss 定义与数值存在', function () {
  const adj = api.bossDefFor(0);
  const exec = api.bossDefFor(1);
  assert.strictEqual(adj.name, '零号裁定机');
  assert.strictEqual(exec.name, '终焉执行者');
  assert.ok(exec.hp > adj.hp, '第二 Boss 数值应更高');
  assert.ok(exec.r > adj.r);
  assert.strictEqual(api.bossDefFor(0), api.constants.bosses.adjudicator);
});

test('两阶段波次表存在且第二阶段更密', function () {
  assert.strictEqual(api.constants.stageLength, 300);
  assert.strictEqual(api.waveAt(0, 0).rate, 1.05);
  assert.strictEqual(api.waveAt(0, 1).rate, 1.6);
  assert.ok(api.waveAt(0, 1).rate > api.waveAt(0, 0).rate);
  assert.strictEqual(api.constants.stage2Waves.length, 6);
});

test('被动升级采用锁定数值', function () {
  assert.strictEqual(api.passiveValue('power', 3), 0.36);
  assert.strictEqual(api.passiveValue('power', 4), 0.48);
  assert.strictEqual(api.passiveValue('cycle', 2), 0.16);
  assert.strictEqual(api.passiveValue('cycle', 4), 0.32);
  assert.strictEqual(api.passiveValue('speed', 1), 0.08);
  assert.strictEqual(api.passiveValue('magnet', 3), 230);
  assert.strictEqual(api.passiveValue('magnet', 4), 300);
  assert.strictEqual(api.passiveValue('frame', 2), 145);
  assert.strictEqual(api.passiveValue('frame', 4), 210);
  assert.strictEqual(api.passiveValue('repair', 3), 1.05);
  assert.strictEqual(api.passiveValue('repair', 4), 1.4);
});

test('新被动锁定数值（暴击/吸血/偏转/过载/荆棘）', function () {
  assert.strictEqual(api.passiveValue('crit', 1), 0.1);
  assert.strictEqual(api.passiveValue('crit', 3), 0.3);
  assert.strictEqual(api.passiveValue('leech', 2), 0.1);
  assert.strictEqual(api.passiveValue('leech', 3), 0.15);
  assert.strictEqual(api.passiveValue('reflect', 1), 0.3);
  assert.strictEqual(api.passiveValue('reflect', 3), 0.6);
  assert.strictEqual(api.passiveValue('overload', 2), 0.3);
  assert.strictEqual(api.passiveValue('overload', 4), 0.6);
  assert.strictEqual(api.passiveValue('thorns', 3), 10);
  assert.strictEqual(api.passiveValue('thorns', 4), 14);
});

test('升级三选一不重复且保留新武器', function () {
  const build = {
    weapons: {needle: 1, orbit: 0, arc: 0, beacon: 0, nova: 0, drone: 0, mine: 0, tesla: 0, beam: 0},
    passives: {power: 0, cycle: 0, speed: 0, magnet: 0, frame: 0, repair: 0, crit: 0, leech: 0, reflect: 0, overload: 0, thorns: 0}
  };
  const options = api.generateUpgradeOptions(build, api.createRng(7));
  assert.strictEqual(options.length, 3);
  assert.strictEqual(new Set(options.map(o => o.kind + ':' + o.key)).size, 3);
  assert.strictEqual(options.filter(o => o.kind === 'weapon' && build.weapons[o.key] === 0).length, 1);
});

test('新武器纳入升级候选与满级排除', function () {
  const build = {
    weapons: {needle: 1, orbit: 0, arc: 0, beacon: 0, nova: 0, drone: 0, mine: 0, tesla: 0, beam: 0},
    passives: {power: 0, cycle: 0, speed: 0, magnet: 0, frame: 0, repair: 0, crit: 0, leech: 0, reflect: 0, overload: 0, thorns: 0}
  };
  const options = api.generateUpgradeOptions(build, api.createRng(3));
  assert.strictEqual(options.length, 3);
  assert.ok(options.some(o => o.kind === 'weapon' && build.weapons[o.key] === 0), '应保留一个未拥有的新武器');
  const full = {
    weapons: {needle: 4, orbit: 4, arc: 4, beacon: 4, nova: 4, drone: 4, mine: 4, tesla: 4, beam: 4},
    passives: {power: 4, cycle: 4, speed: 4, magnet: 4, frame: 4, repair: 4, crit: 4, leech: 4, reflect: 4, overload: 4, thorns: 4}
  };
  const opts2 = api.generateUpgradeOptions(full, api.createRng(9));
  assert.ok(!opts2.some(o => o.key === 'nova' || o.key === 'drone' || o.key === 'mine' || o.key === 'crit' || o.key === 'tesla' || o.key === 'beam' || o.key === 'overload' || o.key === 'thorns'));
});

test('升级应用不会超过等级上限', function () {
  const build = {weapons: {needle: 3}, passives: {power: 3}};
  api.applyUpgradeToBuild(build, {kind: 'weapon', key: 'needle'});
  api.applyUpgradeToBuild(build, {kind: 'weapon', key: 'needle'});
  api.applyUpgradeToBuild(build, {kind: 'passive', key: 'power'});
  api.applyUpgradeToBuild(build, {kind: 'passive', key: 'power'});
  assert.strictEqual(build.weapons.needle, 4);
  assert.strictEqual(build.passives.power, 4);
});

test('对象硬上限与设计一致', function () {
  assert.deepStrictEqual(api.constants.max, {
    enemies: 140,
    playerBullets: 220,
    enemyBullets: 100,
    drops: 200,
    repairs: 12,
    hazards: 32,
    effects: 240
  });
});

test('页面资源与返回链接完整', function () {
  const dir = __dirname;
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.ok(html.includes('href="style.css"'));
  assert.ok(html.includes('src="game.js"'));
  assert.ok(html.includes('href="../action-games/index.html"'));
  assert.ok(fs.existsSync(path.join(dir, 'style.css')));
  assert.ok(fs.existsSync(path.join(dir, 'game.js')));
});

test('浏览器启动壳可绑定并开始任务', function () {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]);
  function classList() {
    const values = new Set();
    return {
      add: (...names) => names.forEach(name => values.add(name)),
      remove: (...names) => names.forEach(name => values.delete(name)),
      toggle: (name, force) => force ? values.add(name) : values.delete(name),
      contains: name => values.has(name)
    };
  }
  const context = new Proxy({}, {get: (target, key) => target[key] || function () {}, set: (target, key, value) => (target[key] = value, true)});
  function element(id) {
    return {
      id,
      style: {},
      dataset: {},
      children: [],
      listeners: {},
      classList: classList(),
      setAttribute() {},
      addEventListener(type, handler) { this.listeners[type] = handler; },
      appendChild(child) { this.children.push(child); },
      getBoundingClientRect() { return {left: 0, top: 0, width: 112, height: 112}; },
      setPointerCapture() {},
      getContext() { return context; }
    };
  }
  const elements = Object.fromEntries(ids.map(id => [id, element(id)]));
  const body = element('body');
  body.dataset.theme = '4399';
  const fakeDocument = {
    body,
    hidden: false,
    getElementById(id) { return elements[id]; },
    addEventListener() {},
    createElement(tag) { return element(tag); }
  };
  const old = {};
  for (const key of ['document', 'innerWidth', 'innerHeight', 'devicePixelRatio', 'matchMedia', 'addEventListener', 'requestAnimationFrame', 'localStorage', 'setTimeout', 'clearTimeout']) old[key] = global[key];
  try {
    global.document = fakeDocument;
    global.innerWidth = 1024;
    global.innerHeight = 768;
    global.devicePixelRatio = 1;
    global.matchMedia = () => ({matches: false});
    global.addEventListener = () => {};
    global.requestAnimationFrame = () => 1;
    global.localStorage = {getItem: () => null, setItem: () => {}};
    global.setTimeout = () => 1;
    global.clearTimeout = () => {};
    const game = api.boot();
    assert.ok(elements.startBtn.listeners.click, '开始按钮未绑定');
    elements.startBtn.listeners.click();
    assert.ok(body.classList.contains('playing'), '开始任务后未进入战斗状态');
    assert.strictEqual(elements.timeText.textContent, '05:00');
    game.gainXp(10);
    assert.strictEqual(game.state, 'LEVEL_UP');
    assert.strictEqual(elements.upgradeGrid.children.length, 3);
    elements.upgradeGrid.children[0].listeners.click();
    assert.strictEqual(game.state, 'PLAYING');
    game.time = 299.99;
    game.update(0.02);
    assert.ok(game.boss, '5:00 未生成第一 Boss');
    game.boss.hp = 2700;
    game.update(1 / 60);
    assert.strictEqual(game.boss.phase, 2);
    game.boss.hp = 0;
    game.update(1 / 60);
    assert.strictEqual(game.state, 'PLAYING', '第一 Boss 击败后应进入第二阶段而非结算');
    assert.strictEqual(game.stage, 1, '应进入第二阶段');
    assert.ok(!game.boss, '第一 Boss 应被清除');
    assert.strictEqual(elements.stageText.textContent, '阶段 二');
    game.time = 299.99;
    game.update(0.02);
    assert.ok(game.boss, '第二阶段 5:00 未生成最终 Boss');
    assert.strictEqual(game.finalBoss, true);
    game.boss.hp = 6500;
    game.update(1 / 60);
    assert.strictEqual(game.boss.phase, 2);
    game.boss.hp = 0;
    game.update(1 / 60);
    assert.strictEqual(game.state, 'RESULT');
    assert.strictEqual(elements.resultTitle.textContent, '任务完成');
    game.start();
    game.player.passives.repair = 1;
    game.player.hp = 1;
    game.damagePlayer(1);
    game.update(1 / 60);
    assert.strictEqual(game.player.hp, 0, '自修复层不应从零生命复活玩家');
    assert.strictEqual(game.state, 'RESULT', '致命伤应立即结束任务');
    assert.strictEqual(elements.resultTitle.textContent, '任务失败');
  } finally {
    for (const key of Object.keys(old)) {
      if (old[key] === undefined) delete global[key];
      else global[key] = old[key];
    }
  }
});

test('无人机数量严格等于武器等级配置', function () {
  const context = new Proxy({}, {get: (target, key) => target[key] || function () {}, set: (target, key, value) => (target[key] = value, true)});
  function element(id) {
    return {
      id, style: {}, dataset: {}, children: [], listeners: {},
      classList: {add() {}, remove() {}, toggle() {}, contains() { return false; }},
      setAttribute() {},
      addEventListener() {},
      appendChild() {},
      getBoundingClientRect() { return {left: 0, top: 0, width: 112, height: 112}; },
      setPointerCapture() {},
      getContext() { return context; }
    };
  }
  const ids = ['game', 'menuScreen', 'upgradeScreen', 'pauseScreen', 'resultScreen', 'startBtn', 'resumeBtn', 'restartBtn', 'againBtn', 'pauseBtn', 'settingsBtn', 'themeToggle', 'themeSubtitle', 'upgradeGrid', 'pauseReason', 'hpFill', 'hpText', 'timeText', 'levelText', 'killText', 'xpFill', 'xpText', 'bossHud', 'bossName', 'bossFill', 'bossPhase', 'combatToast', 'resultTitle', 'resultCode', 'resultReason', 'resultStats', 'buildSummary', 'recordRuns', 'recordWins', 'recordLevel', 'recordKills', 'stickZone', 'stickKnob', 'dashBtn', 'dashText', 'staminaFill', 'staminaText', 'dashRing', 'stageText', 'pauseThemeBtn', 'pauseThemeText'];
  const elements = Object.fromEntries(ids.map(id => [id, element(id)]));
  const body = element('body');
  body.dataset.theme = '4399';
  const fakeDocument = {body, hidden: false, getElementById(id) { return elements[id]; }, addEventListener() {}, createElement(tag) { return element(tag); }};
  const old = {};
  for (const key of ['document', 'innerWidth', 'innerHeight', 'devicePixelRatio', 'matchMedia', 'addEventListener', 'requestAnimationFrame', 'localStorage', 'setTimeout', 'clearTimeout']) old[key] = global[key];
  try {
    global.document = fakeDocument;
    global.innerWidth = 1024;
    global.innerHeight = 768;
    global.devicePixelRatio = 1;
    global.matchMedia = () => ({matches: false});
    global.addEventListener = () => {};
    global.requestAnimationFrame = () => 1;
    global.localStorage = {getItem: () => null, setItem: () => {}};
    global.setTimeout = () => 1;
    global.clearTimeout = () => {};
    const game = api.boot();
    game.start();
    game.update(1 / 60);
    function droneCount() { return game.playerBullets.filter(b => b.drone).length; }
    function driveWeapons(seconds) {
      let t = 0;
      while (t < seconds) { game.update(1 / 30); t += 1 / 30; }
    }
    game.player.weapons.drone = 1;
    game.player.cooldowns.drone = 0;
    game.update(1 / 60);
    driveWeapons(5);
    assert.strictEqual(droneCount(), 2, 'L1 应有 2 架无人机');
    game.player.weapons.drone = 2;
    game.player.cooldowns.drone = 0;
    game.update(1 / 60);
    driveWeapons(5);
    assert.strictEqual(droneCount(), 3, 'L2 应有 3 架无人机');
    game.player.weapons.drone = 3;
    game.player.cooldowns.drone = 0;
    game.update(1 / 60);
    driveWeapons(5);
    assert.strictEqual(droneCount(), 4, 'L3 应有 4 架无人机');
    game.player.weapons.drone = 4;
    game.player.cooldowns.drone = 0;
    game.update(1 / 60);
    driveWeapons(7);
    assert.strictEqual(droneCount(), 5, 'L4 应有 5 架无人机');
  } finally {
    for (const key of Object.keys(old)) {
      if (old[key] === undefined) delete global[key];
      else global[key] = old[key];
    }
  }
});

test('冲刺消耗耐力并平滑恢复', function () {
  const context = new Proxy({}, {get: (target, key) => target[key] || function () {}, set: (target, key, value) => (target[key] = value, true)});
  function element(id) {
    return {
      id, style: {}, dataset: {}, children: [], listeners: {},
      classList: {add() {}, remove() {}, toggle() {}, contains() { return false; }},
      setAttribute() {},
      addEventListener() {},
      appendChild() {},
      getBoundingClientRect() { return {left: 0, top: 0, width: 112, height: 112}; },
      setPointerCapture() {},
      getContext() { return context; }
    };
  }
  const ids = ['game', 'menuScreen', 'upgradeScreen', 'pauseScreen', 'resultScreen', 'startBtn', 'resumeBtn', 'restartBtn', 'againBtn', 'pauseBtn', 'settingsBtn', 'themeToggle', 'themeSubtitle', 'upgradeGrid', 'pauseReason', 'hpFill', 'hpText', 'timeText', 'levelText', 'killText', 'xpFill', 'xpText', 'bossHud', 'bossName', 'bossFill', 'bossPhase', 'combatToast', 'resultTitle', 'resultCode', 'resultReason', 'resultStats', 'buildSummary', 'recordRuns', 'recordWins', 'recordLevel', 'recordKills', 'stickZone', 'stickKnob', 'dashBtn', 'dashText', 'staminaFill', 'staminaText', 'dashRing', 'stageText', 'pauseThemeBtn', 'pauseThemeText'];
  const elements = Object.fromEntries(ids.map(id => [id, element(id)]));
  const body = element('body');
  body.dataset.theme = '4399';
  const fakeDocument = {body, hidden: false, getElementById(id) { return elements[id]; }, addEventListener() {}, createElement(tag) { return element(tag); }};
  const old = {};
  for (const key of ['document', 'innerWidth', 'innerHeight', 'devicePixelRatio', 'matchMedia', 'addEventListener', 'requestAnimationFrame', 'localStorage', 'setTimeout', 'clearTimeout']) old[key] = global[key];
  try {
    global.document = fakeDocument;
    global.innerWidth = 1024;
    global.innerHeight = 768;
    global.devicePixelRatio = 1;
    global.matchMedia = () => ({matches: false});
    global.addEventListener = () => {};
    global.requestAnimationFrame = () => 1;
    global.localStorage = {getItem: () => null, setItem: () => {}};
    global.setTimeout = () => 1;
    global.clearTimeout = () => {};
    const game = api.boot();
    game.start();
    assert.strictEqual(game.player.stamina, 100, '开局耐力应为满');
    game.tryDash();
    assert.strictEqual(game.player.stamina, 50, '冲刺应消耗 50 耐力');
    assert.ok(game.player.dashTimer > 0, '冲刺应处于进行中');
    const before = game.player.stamina;
    game.update(0.5);
    assert.ok(game.player.stamina > before, '耐力应随时间恢复');
    game.tryDash();
    const afterSecond = game.player.stamina;
    assert.ok(afterSecond <= 50, '再次冲刺应继续消耗耐力');
    for (let i = 0; i < 120; i++) game.update(1 / 30);
    assert.strictEqual(game.player.stamina, 100, '耐力应恢复至满');
    game.player.stamina = 49;
    game.tryDash();
    assert.ok(game.player.dashTimer === 0, '耐力不足时不应冲刺');
  } finally {
    for (const key of Object.keys(old)) {
      if (old[key] === undefined) delete global[key];
      else global[key] = old[key];
    }
  }
});

test('设置面板内含主题切换', function () {
  const context = new Proxy({}, {get: (target, key) => target[key] || function () {}, set: (target, key, value) => (target[key] = value, true)});
  function element(id) {
    return {
      id, style: {}, dataset: {}, children: [], listeners: {},
      classList: {add() {}, remove() {}, toggle() {}, contains() { return false; }},
      setAttribute() {},
      addEventListener(type, handler) { this.listeners[type] = handler; },
      appendChild() {},
      getBoundingClientRect() { return {left: 0, top: 0, width: 112, height: 112}; },
      setPointerCapture() {},
      getContext() { return context; }
    };
  }
  const ids = ['game', 'menuScreen', 'upgradeScreen', 'pauseScreen', 'resultScreen', 'startBtn', 'resumeBtn', 'restartBtn', 'againBtn', 'pauseBtn', 'settingsBtn', 'themeToggle', 'themeSubtitle', 'upgradeGrid', 'pauseReason', 'hpFill', 'hpText', 'timeText', 'levelText', 'killText', 'xpFill', 'xpText', 'bossHud', 'bossName', 'bossFill', 'bossPhase', 'combatToast', 'resultTitle', 'resultCode', 'resultReason', 'resultStats', 'buildSummary', 'recordRuns', 'recordWins', 'recordLevel', 'recordKills', 'stickZone', 'stickKnob', 'dashBtn', 'dashText', 'staminaFill', 'staminaText', 'dashRing', 'stageText', 'pauseThemeBtn', 'pauseThemeText'];
  const elements = Object.fromEntries(ids.map(id => [id, element(id)]));
  const body = element('body');
  body.dataset.theme = '4399';
  const fakeDocument = {body, hidden: false, getElementById(id) { return elements[id]; }, addEventListener() {}, createElement(tag) { return element(tag); }};
  const old = {};
  for (const key of ['document', 'innerWidth', 'innerHeight', 'devicePixelRatio', 'matchMedia', 'addEventListener', 'requestAnimationFrame', 'localStorage', 'setTimeout', 'clearTimeout']) old[key] = global[key];
  try {
    global.document = fakeDocument;
    global.innerWidth = 1024;
    global.innerHeight = 768;
    global.devicePixelRatio = 1;
    global.matchMedia = () => ({matches: false});
    global.addEventListener = () => {};
    global.requestAnimationFrame = () => 1;
    global.localStorage = {getItem: () => null, setItem: () => {}};
    global.setTimeout = () => 1;
    global.clearTimeout = () => {};
    const game = api.boot();
    game.start();
    assert.strictEqual(body.dataset.theme, '4399');
    assert.strictEqual(elements.pauseThemeText.textContent, '清新训练模拟');
    elements.pauseThemeBtn.listeners.click();
    assert.strictEqual(body.dataset.theme, 'arcade');
    assert.strictEqual(elements.pauseThemeText.textContent, '未来机甲实战');
    elements.pauseThemeBtn.listeners.click();
    assert.strictEqual(body.dataset.theme, '4399');
  } finally {
    for (const key of Object.keys(old)) {
      if (old[key] === undefined) delete global[key];
      else global[key] = old[key];
    }
  }
});

console.log('幸存者计划：' + passed + ' 项逻辑自测全部通过');
