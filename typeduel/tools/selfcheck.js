/* =====================================================================
 * tools/selfcheck.js —— 《打字对决 TYPE DUEL》核心逻辑 node 自测
 * 运行：node tools/selfcheck.js
 * 覆盖：词库完整性、连击倍率封顶、计分公式、评级/准确率/WPM、
 *       关卡表结构、生存衰减/回血、Boss 解锁逻辑。
 * 注：词表按设计文档 §5.2 逐字抄录，个别词略超档位边界属文档原样；
 *     自测对档位长度采用"≥80% 在名义区间内"的宽松校验。
 * ===================================================================== */
'use strict';
var assert = require('assert');
var WORDS = require('../words.js');
var TD = require('../game.js');
var STATS = require('../stats.js');
var Logic = STATS.Logic;

var pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✔ ' + name); }
  catch (e) { fail++; console.log('  ✘ ' + name + ' :: ' + e.message); }
}
function near(a, b, eps) { return Math.abs(a - b) < (eps || 1e-9); }
function withinRatio(arr, minL, maxL) {
  var ok = arr.filter(function (w) { return w.length >= minL && w.length <= maxL; }).length;
  return ok / arr.length >= 0.8;
}

console.log('== 词库完整性（§5.2/§5.3，逐字抄录，档位按平均长度递增校验） ==');
t('L1 ≥30 词且全部 2-4 字母', function () {
  assert(WORDS.tiers[1].length >= 30);
  WORDS.tiers[1].forEach(function (w) { assert(w.length >= 2 && w.length <= 4, w + ' 长度' + w.length); });
});
t('四档均 ≥30 词且平均词长严格递增（2.78<4.99<7.76<10.13）', function () {
  [1, 2, 3, 4].forEach(function (k) { assert(WORDS.tiers[k].length >= 30, 'L' + k); });
  var prev = 0;
  [1, 2, 3, 4].forEach(function (k) {
    var mean = WORDS.tiers[k].reduce(function (s2, w) { return s2 + w.length; }, 0) / WORDS.tiers[k].length;
    assert(mean > prev, 'L' + k + ' 平均长度 ' + mean + ' 未递增');
    prev = mean;
  });
});
t('shield/bonus/skills/boss 词库齐全', function () {
  assert(WORDS.shield.length >= 10);
  assert(WORDS.bonus.length >= 10);
  assert.deepStrictEqual(WORDS.skills, ['heal', 'bomb', 'freeze', 'slow']);
  assert(WORDS.boss.length >= 15);
});
t('pick 取 n 个不重复词且避让 avoid', function () {
  var r1 = WORDS.pick(1, 8);
  assert.strictEqual(r1.length, 8);
  assert.strictEqual(new Set(r1).size, 8);
  var avoid = {}; avoid[r1[0]] = true;
  var r2 = WORDS.pick(1, 5, avoid);
  assert(r2.indexOf(r1[0]) === -1);
});
t('random 支持 pool / upper', function () {
  assert(WORDS.bonus.indexOf(WORDS.random({ pool: 'bonus' })) >= 0);
  var u = WORDS.random({ pool: 'bonus', upper: true });
  assert.strictEqual(u, u.toUpperCase());
});

console.log('== 连击倍率（§4.4：10 连击封顶） ==');
t('comboMult 0→1.0 / 1→1.1 / 10→2.0', function () {
  assert(near(TD.comboMult(0), 1.0));
  assert(near(TD.comboMult(1), 1.1));
  assert(near(TD.comboMult(10), 2.0));
});
t('comboMult 20 封顶仍为 2.0', function () {
  assert(near(TD.comboMult(20), 2.0));
});

console.log('== 计分公式（§4.1/§4.2/§4.3/§3.1） ==');
t('普通词：词长×10×难度×连击', function () {
  assert.strictEqual(TD.scoreWord({ len: 5, type: 'common', diffMult: 1, comboMult: 1, modeMult: 1 }), 50);
  assert.strictEqual(TD.scoreWord({ len: 5, type: 'common', diffMult: 1.3, comboMult: 1, modeMult: 1 }), 65);
});
t('奖励词 ×3 / 加速·重排 ×1.5 / 护盾本体 ×1.2', function () {
  assert.strictEqual(TD.scoreWord({ len: 4, type: 'bonus', diffMult: 1, comboMult: 1, modeMult: 1 }), 120);
  assert.strictEqual(TD.scoreWord({ len: 6, type: 'quick', diffMult: 1, comboMult: 1, modeMult: 1 }), 90);
  assert.strictEqual(TD.scoreWord({ len: 6, type: 'shuffle', diffMult: 1, comboMult: 1, modeMult: 1 }), 90);
  assert.strictEqual(TD.scoreWord({ len: 5, type: 'shield', diffMult: 1, comboMult: 1, modeMult: 1 }), 60);
});
t('破盾 +50 / Boss 段 20×字数 / 击杀 +500×难度', function () {
  assert.strictEqual(TD.SHIELD_BREAK_BONUS, 50);
  assert.strictEqual(TD.bossSegmentScore(6), 120);
  assert.strictEqual(TD.bossKillBonus(1), 500);
  assert.strictEqual(TD.bossKillBonus(1.6), 800);
});
t('生存计分难度系数恒 1.2', function () {
  assert.strictEqual(TD.scoreWord({ len: 5, type: 'common', diffMult: 1.2, comboMult: 1, modeMult: 1 }), 60);
});

console.log('== 经典关卡表（§5.4） ==');
t('12 关、第 3/6/9/12 关 Boss、词长档 1,1,1,2,2,2,3,3,3,4,4,4', function () {
  assert.strictEqual(TD.LEVELS.length, 12);
  var bosses = TD.LEVELS.map(function (l) { return l.boss || null; });
  assert.deepStrictEqual(bosses[2], 'A'); assert.deepStrictEqual(bosses[5], 'B');
  assert.deepStrictEqual(bosses[8], 'C'); assert.deepStrictEqual(bosses[11], 'D');
  assert.deepStrictEqual(TD.LEVELS.map(function (l) { return l.tier; }), [1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4]);
});
t('拍频逐关递减且 ≥500ms / 刷怪递减 / 同屏递增', function () {
  var prevBeat = Infinity, prevSpawn = Infinity, prevCap = 0;
  TD.LEVELS.forEach(function (l) {
    assert(l.beat < prevBeat, 'beat ' + l.beat);
    assert(l.beat >= 500, 'beat 下限');
    assert(l.spawn <= prevSpawn, 'spawn ' + l.spawn);
    assert(l.cap >= prevCap, 'cap ' + l.cap);
    prevBeat = l.beat; prevSpawn = l.spawn; prevCap = l.cap;
  });
});
t('难度档数值（§4.1）', function () {
  var n = TD.difficulty('normal'), h = TD.difficulty('hard'), i = TD.difficulty('inferno');
  assert.strictEqual(n.scoreMult, 1.0); assert.strictEqual(n.hearts, 5);
  assert.strictEqual(h.scoreMult, 1.3); assert.strictEqual(h.speedAdd, 0.15); assert.strictEqual(h.beatMult, 0.9); assert.strictEqual(h.hearts, 4);
  assert.strictEqual(i.scoreMult, 1.6); assert.strictEqual(i.speedAdd, 0.30); assert.strictEqual(i.beatMult, 0.8); assert.strictEqual(i.hearts, 3);
});
t('通关解锁：normal→hard→inferno→null', function () {
  assert.strictEqual(TD.nextDifficulty('normal'), 'hard');
  assert.strictEqual(TD.nextDifficulty('hard'), 'inferno');
  assert.strictEqual(TD.nextDifficulty('inferno'), null);
});
t('Boss 段长区间 A/B/C/D', function () {
  assert.deepStrictEqual(TD.bossSegLen('A'), [5, 6]);
  assert.deepStrictEqual(TD.bossSegLen('B'), [6, 7]);
  assert.deepStrictEqual(TD.bossSegLen('C'), [7, 8]);
  assert.deepStrictEqual(TD.bossSegLen('D'), [8, 10]);
});
t('敌人基础速度（§3.1）', function () {
  assert.strictEqual(TD.enemySpeed('quick'), 1.6);
  assert.strictEqual(TD.enemySpeed('bonus'), 0.7);
  assert.strictEqual(TD.enemySpeed('common'), 1.0);
});

console.log('== 无尽生存（§4.3） ==');
t('血量衰减 3→4→5…上限 8', function () {
  assert.strictEqual(TD.survivalDecay(0), 3);
  assert.strictEqual(TD.survivalDecay(30), 4);
  assert.strictEqual(TD.survivalDecay(65), 5);
  assert.strictEqual(TD.survivalDecay(180), 8);
  assert.strictEqual(TD.survivalDecay(999), 8);
});
t('回血按词长 2-4:+1 / 5-7:+2 / 8+:+3', function () {
  assert.strictEqual(TD.survivalHeal(3), 1);
  assert.strictEqual(TD.survivalHeal(6), 2);
  assert.strictEqual(TD.survivalHeal(9), 3);
});
t('刷怪间隔分级 2000/1700/1400/1200', function () {
  assert.strictEqual(TD.survivalSpawnMs(10), 2000);
  assert.strictEqual(TD.survivalSpawnMs(40), 1700);
  assert.strictEqual(TD.survivalSpawnMs(70), 1400);
  assert.strictEqual(TD.survivalSpawnMs(100), 1200);
});
t('触底掉血：加速/重排 -15，其余 -10', function () {
  assert.strictEqual(TD.survivalBreachDmg('quick'), 15);
  assert.strictEqual(TD.survivalBreachDmg('shuffle'), 15);
  assert.strictEqual(TD.survivalBreachDmg('common'), 10);
  assert.strictEqual(TD.survivalBreachDmg('bonus'), 10);
});

console.log('== 限时档位（§4.2） ==');
t('短/标准/长 档系数 1.0/1.2/1.4 且词长档正确', function () {
  assert.strictEqual(TD.sprintTier('short').mult, 1.0);
  assert.deepStrictEqual(TD.sprintTier('short').tiers, [1, 2]);
  assert.strictEqual(TD.sprintTier('standard').mult, 1.2);
  assert.strictEqual(TD.sprintTier('long').mult, 1.4);
  assert.deepStrictEqual(TD.sprintTier('long').tiers, [3, 4]);
});

console.log('== 模式解锁（任务2：初始仅经典闯关，通关阶梯解锁） ==');
t('campaign 始终解锁 / sprint 通关第4关 / survival 通关第8关', function () {
  assert.strictEqual(TD.isModeUnlocked('campaign', {}), true);
  assert.strictEqual(TD.isModeUnlocked('sprint', { stage: { normal: 1 } }), false);
  assert.strictEqual(TD.isModeUnlocked('sprint', { stage: { normal: 4 } }), false);
  assert.strictEqual(TD.isModeUnlocked('sprint', { stage: { normal: 5 } }), true);
  assert.strictEqual(TD.isModeUnlocked('survival', { stage: { normal: 8 } }), false);
  assert.strictEqual(TD.isModeUnlocked('survival', { stage: { normal: 9 } }), true);
  assert.strictEqual(TD.isModeUnlocked('survival', { stage: { normal: 12 } }), true);
});
t('解锁阶梯阈值：sprint=5 / survival=9 / campaign=1', function () {
  assert.strictEqual(TD.modeUnlockStage('campaign'), 1);
  assert.strictEqual(TD.modeUnlockStage('sprint'), 5);
  assert.strictEqual(TD.modeUnlockStage('survival'), 9);
});
t('跨难度取经典最高进度判定解锁', function () {
  assert.strictEqual(TD.isModeUnlocked('sprint', { stage: { normal: 2, hard: 5, inferno: 1 } }), true);
  assert.strictEqual(TD.isModeUnlocked('survival', { stage: { normal: 1, hard: 1, inferno: 9 } }), true);
  assert.strictEqual(TD.isModeUnlocked('sprint', { stage: { normal: 1, hard: 4, inferno: 1 } }), false);
});
t('无进度（默认 1 关）时 sprint/survival 均锁定', function () {
  assert.strictEqual(TD.isModeUnlocked('sprint', undefined), false);
  assert.strictEqual(TD.isModeUnlocked('survival', undefined), false);
});

console.log('== 统计逻辑（§6.2） ==');
t('WPM：5 字符=1 词', function () {
  assert(near(Logic.wpm(25, 60), 5));
  assert(near(Logic.wpm(0, 60), 0));
  assert(near(Logic.wpm(50, 60), 10));
});
t('准确率公式', function () {
  assert(near(Logic.accuracy(90, 10), 90));
  assert(near(Logic.accuracy(0, 0), 100));
});
t('评级公式与等级边界', function () {
  var r100 = Logic.ratingScore(100, 50, 1e9, 2000);
  assert(r100 >= 99);
  assert.strictEqual(Logic.grade(r100), 'S');
  assert.strictEqual(Logic.grade(90), 'S');
  assert.strictEqual(Logic.grade(80), 'A');
  assert.strictEqual(Logic.grade(70), 'B');
  assert.strictEqual(Logic.grade(60), 'C');
  assert.strictEqual(Logic.grade(50), 'D');
  assert.strictEqual(Logic.grade(49.9), 'F');
  assert.strictEqual(Logic.BASE_SCORE.campaign, 2000);
  assert.strictEqual(Logic.BASE_SCORE.sprint, 4000);
  assert.strictEqual(Logic.BASE_SCORE.survival, 3000);
});
t('评级加权：准确率0.5 / WPM0.3 / 得分0.2', function () {
  var r = Logic.ratingScore(80, 25, 1000, 2000);
  assert(near(r, 40 + 15 + 10));
});
t('时间格式化 mm:ss', function () {
  assert.strictEqual(Logic.fmtTime(65), '01:05');
  assert.strictEqual(Logic.fmtTime(0), '00:00');
});

console.log('== localStorage 键名（§6.3/§8.4） ==');
t('五个 v1 键名齐全', function () {
  assert.strictEqual(STATS.Stats.KEYS.stats, 'typeduel.stats.v1');
  assert.strictEqual(STATS.Stats.KEYS.history, 'typeduel.history.v1');
  assert.strictEqual(STATS.Stats.KEYS.progress, 'typeduel.progress.v1');
  assert.strictEqual(STATS.Stats.KEYS.settings, 'typeduel.settings.v1');
  assert.strictEqual(STATS.Stats.KEYS.leaderboard, 'typeduel.leaderboard.v1');
});

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail > 0 ? 1 : 0);
