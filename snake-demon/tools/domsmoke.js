/* =====================================================================
 * tools/domsmoke.js —— 《恶魔追逐·队友模式》规则引擎冒烟测试（无 DOM 依赖）
 * 运行：node tools/domsmoke.js
 * 覆盖：正常前进 / 恰好到达 / 超出原地不动 / 命运格6种效果 /
 *       连锁触发(前·后) / 护盾抵消 / 恶魔晚2回合 / 抓捕判定 /
 *       队友羁绊(含恶魔不带动) / 胜负判定(单胜·羁绊胜·双死恶魔胜) /
 *       单方被捕后继续 / 再掷守卫防死循环 / 随机整局终止。
 * ===================================================================== */
'use strict';

var path = require('path');
var createEngine = require(path.join(__dirname, '..', 'engine.js'));
var E = createEngine(); // 默认 48 格官方地图

var passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('  PASS  ' + msg); }
  else { failed++; console.error('  FAIL  ' + msg); }
}
function section(title) { console.log('\n== ' + title + ' =='); }

/* 顺序骰子：按序返回数组中的【骰面值1-6】，耗尽后返回 last。
 * d6(rng)=1+floor(rng()*6)；要骰出 k，需 rng()∈[(k-1)/6, k/6)。
 */
function seqDice(values) {
  var i = 0;
  var last = values.length ? values[values.length - 1] : 1;
  return function () {
    var v = (i < values.length) ? values[i] : last;
    i++;
    return Math.min(0.999999, (v - 1) / 6 + 0.05);
  };
}
function seqInfDie(v) {
  var x = Math.min(0.999999, (v - 1) / 6 + 0.05);
  return function () { return x; };
}
function find(evs, type) { return evs.filter(function (e) { return e.type === type; }); }
function count(evs, type) { return find(evs, type).length; }

/* ============ 一、双骰差前进规则 ============ */
section('双骰差前进规则');
ok(E.diceMove(5, 2, 'player') === 3, '人类：|5-2|=3');
ok(E.diceMove(6, 1, 'mate') === 5, '队友：|6-1|=5');
ok(E.diceMove(3, 3, 'player') === 0, '人类同骰：|3-3|=0 → 原地不动');
ok(E.diceMove(3, 3, 'demon') === 2, '恶魔同骰加成：差0 → 前进2格');
ok(E.diceMove(1, 1, 'demon') === 2, '恶魔同骰(1,1) → 前进2');
ok(E.diceMove(6, 6, 'demon') === 2, '恶魔同骰(6,6) → 前进2');
ok(E.diceMove(4, 6, 'demon') === 2, '恶魔不同骰：|4-6|=2');
ok(E.diceMove(2, 2, 'mate') === 0, '队友同骰：0 → 原地不动');
ok(typeof E.diceMove === 'function', 'diceMove 已导出');

/* ============ 二、移动 ============ */
section('移动规则');
ok(E.moveOnce(10, 4) === 14, '正常前进：10+4=14');
ok(E.moveOnce(42, 6) === 48, '恰好到达：42+6=48');
ok(E.moveOnce(45, 6) === 45, '超出原地不动：45+6=51>48 → 45');
ok(E.moveOnce(47, 3) === 47, '超出一格不动：47+3=50>48 → 47');
ok(E.moveOnce(1, 6) === 7, '起点前进：1+6=7');

/* ============ 二、命运格六种效果 ============ */
section('命运格 · 六种效果');
(function () {
  // 效果1 后退2：玩家置3 掷2 → 5(命运)，命运骰=1 → 退2 → 3
  var s = E.newGame();
  s.player.pos = 3;
  var ev = E.stepActor(s, 'player', 2, seqDice([1]));
  ok(s.player.pos === 3, '效果1 后退2格：5 → 3');
  ok(count(ev, 'move') >= 2 && ev.some(function (e) { return e.cause === 'fate-back'; }), '效果1 产生 fate-back 移动事件');

  // 效果2 暂停：命运骰=2
  s = E.newGame(); s.player.pos = 3;
  ev = E.stepActor(s, 'player', 2, seqDice([2]));
  ok(s.player.pos === 5 && s.player.paused === true, '效果2 暂停下回合（paused=true）');

  // 效果3 有护盾：失去1枚护盾，位置不变
  s = E.newGame(); s.player.pos = 3;
  s.player.shield = 1;
  ev = E.stepActor(s, 'player', 2, seqDice([3]));
  ok(s.player.shield === 0 && s.player.pos === 5, '效果3 有护盾：失去1枚护盾，原地');
  ok(count(ev, 'loseShield') === 1, '效果3 产生 loseShield 事件');

  // 效果3 无护盾：后退1格
  s = E.newGame(); s.player.pos = 3;
  ev = E.stepActor(s, 'player', 2, seqDice([3]));
  ok(s.player.pos === 4, '效果3 无护盾：后退1格 → 4');

  // 效果4 玩家触发羁绊：自身+1，队友+1
  s = E.newGame(); s.player.pos = 3;
  ev = E.stepActor(s, 'player', 2, seqDice([4]));
  ok(s.player.pos === 6, '效果4 自身前进1格 → 6');
  ok(s.mate.pos === 2, '效果4 队友也前进1格 → 2');
  ok(ev.some(function (e) { return e.actor === 'mate' && e.cause === 'bond'; }), '效果4 产生队友 bond 移动事件');

  // 效果4 恶魔触发：仅恶魔自身+1，不带队友
  s = E.newGame();
  s.round = 3; s.demon.pos = 3;
  ev = E.stepActor(s, 'demon', 2, seqDice([4]));
  ok(s.demon.pos === 6, '效果4 恶魔自身+1 → 6');
  ok(s.player.pos === 1 && s.mate.pos === 1, '效果4 恶魔不带动玩家/队友');

  // 效果5 重掷：终止命运链，交由上层重掷前进骰（此次掷 = 前进骰结果）
  s = E.newGame(); s.player.pos = 3;
  ev = E.stepActor(s, 'player', 2, seqDice([5, 5, 6]));
  ok(s.player.pos === 5, '效果5 重掷：停在命运格5，交由上层重掷【前进骰】');
  ok(count(ev, 'reroll') === 1, '效果5 仅产生 1 次 reroll 事件（不再连锁转盘）');

  // 效果6 获得护盾
  s = E.newGame(); s.player.pos = 3;
  ev = E.stepActor(s, 'player', 2, seqDice([6]));
  ok(s.player.shield === 1 && s.player.pos === 5, '效果6 获得1枚护盾');
})();

/* ============ 三、连锁触发 ============ */
section('连锁触发（前进/后退落到另一命运格）');
(function () {
  // 自定义地图 {4,5,7}：4→5 相邻，可验证 效果4(+1) 连锁
  var Ec = createEngine({ fateMap: { 4: 1, 5: 1, 7: 1 } });
  var s = Ec.newGame(); s.player.pos = 3;
  var ev = Ec.stepActor(s, 'player', 1, seqDice([4, 1])); // 3→4(命运), 效果4→5(命运,连锁), 效果1→退2→3
  ok(count(ev, 'fate') === 2, '前向连锁：落在4(效果4→5)→5(效果1) 共触发2次命运');
  ok(s.player.pos === 3, '前向连锁终态：4→5→3');
  ok(s.mate.pos === 2, '前向连锁中羁绊：队友随每次+1前进到2');

  // 自定义地图 {3,5,7}：5→3 可验证 效果1(-2) 连锁
  var Eb = createEngine({ fateMap: { 3: 1, 5: 1, 7: 1 } });
  s = Eb.newGame(); s.player.pos = 4;
  ev = Eb.stepActor(s, 'player', 1, seqDice([1, 6])); // 4→5(命运), 效果1→退2→3(命运,连锁), 效果6→得盾
  ok(count(ev, 'fate') === 2, '后向连锁：落在5(效果1→3)→3(效果6) 共触发2次命运');
  ok(s.player.pos === 3 && s.player.shield === 1, '后向连锁终态：5→3，得1盾');

  // 再掷守卫：掷出连续5不会死循环
  var s2 = E.newGame(); s2.player.pos = 3;
  E.stepActor(s2, 'player', 2, seqInfDie(5)); // 永远5
  ok(s2.player.pos === 5, '再掷守卫：连续5仍终止（守卫防死循环）');
})();

/* ============ 四、护盾抵消 ============ */
section('护盾抵消负面');
(function () {
  var s = E.newGame(); s.player.pos = 3;
  s.player.shield = 1;
  var ev = E.stepActor(s, 'player', 2, seqDice([1])); // 效果1 后退2 → 被护盾抵消
  ok(s.player.pos === 5 && s.player.shield === 0, '护盾抵消「后退2」：原地，扣1盾');
  ok(ev.some(function (e) { return e.type === 'shieldBlock' && e.blocked === 'back2'; }), '护盾抵消产生 shieldBlock(back2) 事件');

  s = E.newGame(); s.player.pos = 3;
  s.player.shield = 1;
  ev = E.stepActor(s, 'player', 2, seqDice([2])); // 效果2 暂停 → 被护盾抵消
  ok(s.player.paused === false && s.player.shield === 0, '护盾抵消「暂停」：不暂停，扣1盾');

  // 护盾累计后连续抵消：2盾 → 后退2被抵消后剩1盾（无移动则无连锁，合规则）
  var Ec = createEngine({ fateMap: { 3: 1, 5: 1, 7: 1 } });
  s = Ec.newGame(); s.player.pos = 4;
  s.player.shield = 2;
  ev = Ec.stepActor(s, 'player', 1, seqDice([1]));
  ok(s.player.pos === 5 && s.player.shield === 1, '护盾累计并抵消：2盾-1盾=1盾，后退被免疫');
})();

/* ============ 五、恶魔晚 2 回合 ============ */
section('恶魔晚 2 回合出发');
(function () {
  var s = E.newGame();
  var ev = E.stepActor(s, 'demon', 12, Math.random);
  ok(count(ev, 'skip') === 1 && ev[0].reason === 'late' && s.demon.pos === 1, '第1轮：恶魔跳过(晚出发)，位置不变');
  s.round = 2;
  ev = E.stepActor(s, 'demon', 12, Math.random);
  ok(ev[0].reason === 'late' && s.demon.pos === 1, '第2轮：恶魔仍跳过');
  s.round = 3;
  ev = E.stepActor(s, 'demon', 7, Math.random); // 2d6=7
  ok(s.demon.pos === 8, '第3轮：恶魔正常行动 1+7=8');
  ok(count(ev, 'skip') === 0, '第3轮：无 skip');
})();

/* ============ 六、抓捕判定 ============ */
section('抓捕判定（>= 即追上）');
(function () {
  var s = E.newGame();
  s.round = 3;
  s.player.pos = 5; s.mate.pos = 8; s.demon.pos = 1;
  var ev = E.stepActor(s, 'demon', 9, Math.random); // 1+9=10
  ok(s.player.alive === false && s.mate.alive === false, '恶魔 10 >= 5/8 → 双捕');
  ok(s.winner === 'demon' && s.winReason.indexOf('抓捕') >= 0, '双捕 → 恶魔胜');
  ok(count(ev, 'capture') === 2, '产生2次 capture 事件');

  // 恰好相等也抓捕
  s = E.newGame(); s.round = 3;
  s.player.pos = 7; s.mate.pos = 20; s.demon.pos = 1;
  ev = E.stepActor(s, 'demon', 6, Math.random); // 1+6=7
  ok(s.player.alive === false, '恶魔恰好落在玩家格(7==7) → 抓捕');
  ok(s.mate.alive === true && s.winner === null, '仅捕1人：游戏继续');

  // 未追上不抓捕
  s = E.newGame(); s.round = 3;
  s.player.pos = 20; s.mate.pos = 22; s.demon.pos = 1;
  ev = E.stepActor(s, 'demon', 5, Math.random); // 6
  ok(s.player.alive === true && s.mate.alive === true, '恶魔 6 < 20/22 → 未追上');
})();

/* ============ 七、队友羁绊（队友死亡时） ============ */
section('队友羁绊（含队友已死亡）');
(function () {
  var s = E.newGame(); s.player.pos = 3;
  s.mate.alive = false;
  var ev = E.stepActor(s, 'player', 2, seqDice([4])); // 5(命运), 效果4
  ok(s.player.pos === 6, '队友死亡时：存活者自身+1 → 6');
  ok(s.mate.pos === 1, '队友死亡时：死亡队友不移动');
})();

/* ============ 八、胜负判定 ============ */
section('胜负判定');
(function () {
  // 单胜：玩家恰好到达48
  var s = E.newGame();
  s.player.pos = 42;
  var ev = E.stepActor(s, 'player', 6, Math.random);
  ok(s.winner === 'human' && s.player.pos === 48, '玩家到达48 → 人类胜');
  ok(ev.some(function (e) { return e.type === 'win'; }), '产生 win 事件');

  // 队友单胜
  s = E.newGame();
  s.mate.pos = 42;
  ev = E.stepActor(s, 'mate', 6, Math.random);
  ok(s.winner === 'human', '队友到达48 → 人类胜');

  // 羁绊到达48胜利
  s = E.newGame(); s.player.pos = 43;
  s.mate.pos = 47;
  ev = E.stepActor(s, 'player', 1, seqDice([4])); // 43+1=44(命运), 效果4: 玩家45 + 队友48
  ok(s.winner === 'human' && ev.some(function (e) { return e.type === 'win' && e.via === 'bond'; }), '羁绊把队友送到48 → 人类胜');

  // 双死 → 恶魔胜
  s = E.newGame();
  s.round = 3;
  s.player.pos = 3; s.mate.pos = 4; s.demon.pos = 1;
  ev = E.stepActor(s, 'demon', 10, Math.random); // 11
  ok(s.winner === 'demon', '双死 → 恶魔胜');

  // 一人被抓后，剩余一人继续并最终胜利
  s = E.newGame();
  s.round = 3;
  s.player.pos = 45; s.mate.pos = 4; s.demon.pos = 1;
  ev = E.stepActor(s, 'demon', 6, Math.random); // 7 抓捕队友
  ok(s.mate.alive === false && s.player.alive === true && s.winner === null, '只捕队友：游戏继续');
  ev = E.stepActor(s, 'player', 3, Math.random); // 45+3=48
  ok(s.winner === 'human', '剩余玩家继续到达48 → 人类胜');
})();

/* ============ 九、暂停后跳过 ============ */
section('暂停跳过');
(function () {
  var s = E.newGame();
  s.player.paused = true;
  var ev = E.stepActor(s, 'player', 5, Math.random);
  ok(ev[0].reason === 'paused' && s.player.pos === 1 && s.player.paused === false, '被暂停角色：本轮跳过，暂停状态复位');
})();

/* ============ 十、整轮与随机整局 ============ */
section('整轮推进与随机整局');
(function () {
  // 骰点刻意避开命运格(5/10/15/25/35/44)
  var s = E.newGame();
  var ev = E.stepRound(s, { player: 3, mate: 2, demon: 7 }, Math.random);
  ok(s.player.pos === 4 && s.mate.pos === 3 && s.demon.pos === 1, '第1轮：人类移动，恶魔仍待机(晚出发)');
  ok(s.round === 2, '第1轮结束 → round=2');
  ev = E.stepRound(s, { player: 2, mate: 1, demon: 6 }, Math.random);
  ok(s.player.pos === 6 && s.mate.pos === 4 && s.demon.pos === 1 && s.round === 3, '第2轮：恶魔继续待机');
  ev = E.stepRound(s, { player: 2, mate: 2, demon: 6 }, Math.random);
  ok(s.player.pos === 8 && s.mate.pos === 6 && s.demon.pos === 7, '第3轮：恶魔出动 1+6=7');
  ok(s.round === 4, '第3轮结束 → round=4');

  // 随机整局：必在有限轮内终结
  var s2 = E.newGame();
  var guard = 0;
  while (!s2.winner && guard < 400) { E.stepRound(s2, null, Math.random); guard++; }
  ok(s2.winner === 'human' || s2.winner === 'demon', '随机整局在有限轮内终结，winner=' + s2.winner);
  ok(guard < 400, '随机整局轮数合理(' + guard + ')');
})();


/* =====================================================================
 * 二、整包引导冒烟：极简 DOM 桩 + 加载 engine/audio/game 三模块，
 *     验证无引用错误、棋盘构建 48 格、骰子初始化、屏幕切换正常。
 * ===================================================================== */
(function bootSmoke() {
  function elStub(id) {
    var el = {
      id: id || '', _cls: {}, style: {}, dataset: {}, children: [],
      _listeners: {}, _inner: '', _text: '', _disabled: false,
      offsetLeft: 0, offsetTop: 0, offsetWidth: 0, offsetHeight: 0,
      scrollTop: 0, scrollHeight: 0, firstChild: null,
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
      addEventListener: function (ev, fn) { (el._listeners[ev] = el._listeners[ev] || []).push(fn); },
      appendChild: function (c) { el.children.push(c); el.firstChild = el.children[0] || null; return c; },
      removeChild: function (c) {
        var i = el.children.indexOf(c);
        if (i >= 0) el.children.splice(i, 1);
        el.firstChild = el.children[0] || null;
        return c;
      },
      getContext: function () {
        return new Proxy({}, { get: function (t, k) {
          if (k === 'setTransform') return function () {};
          if (k === 'createLinearGradient' || k === 'createRadialGradient') return function () { return { addColorStop: function () {} }; };
          if (k === 'measureText') return function () { return { width: 10 }; };
          return function () {};
        }, set: function () { return true; } });
      },
      getBoundingClientRect: function () { return { left: 0, top: 0, width: 40, height: 40 }; },
      focus: function () {}, blur: function () {}
    };
    return el;
  }
  var cache = {};
  function gEl(id) {
    if (!cache[id]) cache[id] = elStub(id);
    return cache[id];
  }
  var docListeners = {};
  global.window = globalThis;
  global.document = {
    readyState: 'complete',
    body: gEl('body'),
    documentElement: gEl('html'),
    getElementById: function (id) { return gEl(id); },
    createElement: function (tag) { return elStub(tag); },
    addEventListener: function (ev, fn) { (docListeners[ev] = docListeners[ev] || []).push(fn); },
    querySelectorAll: function () { return []; },
    querySelector: function () { return null; }
  };
  global.localStorage = {
    store: {},
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(this.store, k) ? this.store[k] : null; },
    setItem: function (k, v) { this.store[k] = String(v); },
    removeItem: function (k) { delete this.store[k]; }
  };
  global.requestAnimationFrame = function () { return 0; };
  global.cancelAnimationFrame = function () {};
  global.devicePixelRatio = 1;
  global.innerWidth = 390;
  global.innerHeight = 844;
  global.addEventListener = function () {};
  global.removeEventListener = function () {};
  global.scrollTo = function () {};

  var E2 = require('../engine.js');
  var bootEngine = E2.default;
  bootEngine.createEngine = E2.createEngine;
  global.SnakeEngine = bootEngine;

  var audio = require('../audio.js');
  var boardLib = require('../board.js');
  var game = require('../game.js');

  // 棋盘改为 Canvas 等距渲染：验证 SnakeBoard 挂载 + 几何正确（48 格映射）
  ok(typeof global.SnakeBoard === 'object' && typeof global.SnakeBoard.createBoard === 'function', 'boot：SnakeBoard 渲染模块已挂载');
  var b = global.SnakeBoard.createBoard({ width: 640 });
  b.layout();
  var mapped = 0;
  for (var p = 1; p <= 48; p++) {
    var rc = b.posToRC(p);
    if (b.rcToPos(rc.row, rc.col) === p) mapped++;
  }
  ok(mapped === 48, 'boot：棋盘 48 格行列映射正确（' + mapped + '/48）');
  ok(b.cellCenter(1).row === 0 && b.cellCenter(48).row === 3, 'boot：起点第1行 / 终点第4行');
  // 棋子精确落格：48 格棋子中心均在对应格子矩形内
  var allIn = true;
  for (var pp = 1; pp <= 48; pp++) {
    var cp = b.cellCenter(pp);
    var pwp = Math.max(22, cp.w * 0.7);
    var php = Math.round(pwp * 1.6);
    var lx = cp.x - pwp / 2, ty = cp.y + cp.h / 2 - php + 6;
    var pxx = lx + pwp / 2, pyy = ty + php / 2;
    if (!(pxx >= cp.x - cp.w / 2 && pxx <= cp.x + cp.w / 2 && pyy >= cp.y - cp.h / 2 && pyy <= cp.y + cp.h / 2)) allIn = false;
  }
  ok(allIn, 'boot：48 格棋子精确落格验证');
  var dice = gEl('diceCubes');
  ok(dice.children.length >= 1, 'boot：骰子立方体已初始化');
  ok(gEl('startScreen').classList.contains('hidden') === false, 'boot：默认显示开始界面');
  ok(typeof global.SnakeAudio === 'object', 'boot：SnakeAudio 已挂载');
  ok(typeof global.SnakeEngine.createEngine === 'function', 'boot：SnakeEngine 可再创建(连锁测试用)');
  console.log('  boot smoke OK（engine/audio/game 三模块加载无引用错误）');
})();

/* =====================================================================
 * 汇总（第一部分已计数，此处共用 passed/failed）
 * ===================================================================== */

/* ============ 汇总 ============ */
console.log('\n====================');
console.log('通过 ' + passed + ' 项，失败 ' + failed + ' 项');
if (failed > 0) { process.exit(1); }
console.log('ALL ENGINE TESTS PASSED');
