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

test('胜负同帧优先级为 Boss、玩家、超时', function () {
  assert.strictEqual(api.resolveOutcome({bossDead: true, playerDead: true, timeUp: true}), 'win');
  assert.strictEqual(api.resolveOutcome({bossDead: false, playerDead: true, timeUp: true}), 'dead');
  assert.strictEqual(api.resolveOutcome({bossDead: false, playerDead: false, timeUp: true}), 'timeout');
  assert.strictEqual(api.resolveOutcome({bossDead: false, playerDead: false, timeUp: false}), null);
});

test('Boss 在半血切换第二阶段', function () {
  assert.strictEqual(api.bossPhase(5400), 1);
  assert.strictEqual(api.bossPhase(2701), 1);
  assert.strictEqual(api.bossPhase(2700), 2);
});

test('被动升级采用锁定数值', function () {
  assert.strictEqual(api.passiveValue('power', 3), 0.36);
  assert.strictEqual(api.passiveValue('cycle', 2), 0.16);
  assert.strictEqual(api.passiveValue('speed', 1), 0.08);
  assert.strictEqual(api.passiveValue('magnet', 3), 230);
  assert.strictEqual(api.passiveValue('frame', 2), 145);
  assert.strictEqual(api.passiveValue('repair', 3), 1.05);
});

test('升级三选一不重复且保留新武器', function () {
  const build = {
    weapons: {needle: 1, orbit: 0, arc: 0, beacon: 0},
    passives: {power: 0, cycle: 0, speed: 0, magnet: 0, frame: 0, repair: 0}
  };
  const options = api.generateUpgradeOptions(build, api.createRng(7));
  assert.strictEqual(options.length, 3);
  assert.strictEqual(new Set(options.map(o => o.kind + ':' + o.key)).size, 3);
  assert.strictEqual(options.filter(o => o.kind === 'weapon' && build.weapons[o.key] === 0).length, 1);
});

test('满级项目不会进入升级候选', function () {
  const build = {
    weapons: {needle: 4, orbit: 1, arc: 4, beacon: 4},
    passives: {power: 3, cycle: 3, speed: 3, magnet: 3, frame: 3, repair: 0}
  };
  const options = api.generateUpgradeOptions(build, api.createRng(9));
  assert.ok(!options.some(o => o.key === 'needle' || o.key === 'arc' || o.key === 'beacon' || o.key === 'power'));
});

test('升级应用不会超过等级上限', function () {
  const build = {weapons: {needle: 3}, passives: {power: 2}};
  api.applyUpgradeToBuild(build, {kind: 'weapon', key: 'needle'});
  api.applyUpgradeToBuild(build, {kind: 'weapon', key: 'needle'});
  api.applyUpgradeToBuild(build, {kind: 'passive', key: 'power'});
  api.applyUpgradeToBuild(build, {kind: 'passive', key: 'power'});
  assert.strictEqual(build.weapons.needle, 4);
  assert.strictEqual(build.passives.power, 3);
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
    assert.strictEqual(elements.timeText.textContent, '06:00');
    game.gainXp(10);
    assert.strictEqual(game.state, 'LEVEL_UP');
    assert.strictEqual(elements.upgradeGrid.children.length, 3);
    elements.upgradeGrid.children[0].listeners.click();
    assert.strictEqual(game.state, 'PLAYING');
    game.time = 299.99;
    game.update(0.02);
    assert.ok(game.boss, '5:00 未生成最终 Boss');
    game.boss.hp = 2700;
    game.update(1 / 60);
    assert.strictEqual(game.boss.phase, 2);
    game.boss.hp = 0;
    game.update(1 / 60);
    assert.strictEqual(game.state, 'RESULT');
    assert.strictEqual(elements.resultTitle.textContent, '任务完成');
  } finally {
    for (const key of Object.keys(old)) {
      if (old[key] === undefined) delete global[key];
      else global[key] = old[key];
    }
  }
});

console.log('幸存者计划：' + passed + ' 项逻辑自测全部通过');
