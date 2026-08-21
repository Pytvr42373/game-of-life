/* =====================================================================
 * tools/engine-test.js —— 《暗巷潜行》v3 引擎测试（无 DOM 依赖）
 * 运行：node tools/engine-test.js
 * 覆盖：速度关系 / 六关唯一 P/E/K 与结构 / 出生安全 / 固定视锥与门遮挡 /
 *       短露头不追·持续看见追捕 / 抓捕规则(无墙后抓·隔墙不抓·两格不抓) /
 *       钥匙进入 escape 且守卫目标钥匙 / 听觉(行走无声·冲刺一格一声·
 *       BFS 隔墙距离·猎犬更远) / 开关开门并发声 / 丢视线 search 后脱逃 /
 *       出口钥匙前锁·钥匙后胜 / 关键点静态可达与双路线 / 长时间无异常。
 * ===================================================================== */
'use strict';

var path = require('path');
var E = require(path.join(__dirname, '..', 'engine.js'));
var C = E.cfg;

var passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('  PASS  ' + msg); }
  else { failed++; console.error('  FAIL  ' + msg); }
}
function section(title) { console.log('\n== ' + title + ' =='); }

/* 测试用摆设：把守卫放到指定格子并彻底复位状态。 */
function placeGuard(s, gi, r, c, dir, pat) {
  var g = s.guards[gi];
  g.r = r; g.c = c; g.pr = r; g.pc = c;
  g.dir = dir; g.mdir = null; g.t = 0; g.moving = false;
  g.state = 'patrol';
  g.pat = pat || [{ r: r, c: c }];
  g.patIdx = 0; g.patDir = 1; g.patStart = 0;
  g.spawnTarget = null;
  g.notice = 0;
  g.lastSeen = null; g.lastHeard = null;
  g.huntTarget = null; g.returnTarget = null;
  g.tgt = null; g.investigateT = 0;
  g.searchT = 0; g.searchTargets = []; g.searchIdx = 0;
  g.los = false;
  return g;
}

/* ============ 一、速度关系 ============ */
section('速度关系');
(function () {
  ok(C.playerSprint > C.guardChase, '冲刺 > 追捕（跑可甩开）');
  ok(C.guardChase > C.playerWalk, '追捕 > 行走（不跑必被抓）');
  ok(C.guardChase > C.guardHunt, '追捕 > 猎捕');
  ok(C.guardHunt > C.guardInvestigate, '猎捕 > 警戒');
  ok(C.guardInvestigate > C.guardReturn, '警戒 > 回岗');
  ok(C.guardReturn > C.guardPatrol, '回岗 > 巡逻');
  ok(C.fovDist === 5, '固定视距 5');
})();

/* ============ 二、关卡结构 ============ */
section('关卡结构（六关唯一 P/E/K、S/D、边界全墙）');
(function () {
  ok(E.LEVELS.length === 6, '共 6 关');
  E.LEVELS.forEach(function (lv, i) {
    ok(lv.map.every(function (r) { return r.length === lv.map[0].length; }),
      'L' + (i + 1) + ' 行长一致(' + lv.map[0].length + ')');
    var h = lv.map.length, w = lv.map[0].length, borderOk = true;
    for (var r = 0; r < h; r++) {
      if (lv.map[r][0] !== '#' || lv.map[r][w - 1] !== '#') borderOk = false;
    }
    for (var c = 0; c < w; c++) {
      if (lv.map[0][c] !== '#' || lv.map[h - 1][c] !== '#') borderOk = false;
    }
    ok(borderOk, 'L' + (i + 1) + ' 边界全墙（无假出口）');
    var cnt = { P: 0, E: 0, K: 0, S: 0, D: 0, G: 0, g: 0 };
    lv.map.forEach(function (row) {
      row.split('').forEach(function (ch) { if (ch in cnt) cnt[ch]++; });
    });
    ok(cnt.P === 1, 'L' + (i + 1) + ' 唯一 P');
    ok(cnt.E === 1, 'L' + (i + 1) + ' 唯一 E');
    ok(cnt.K === 1, 'L' + (i + 1) + ' 唯一 K');
    ok(cnt.G + cnt.g >= 1, 'L' + (i + 1) + ' 至少 1 守卫');
    var s = E.newGame(i);
    ok(s.guards.length === cnt.G + cnt.g, 'L' + (i + 1) + ' 守卫解析一致');
    if (i === 3 || i === 5) {
      ok(cnt.S === 1 && cnt.D >= 1, 'L' + (i + 1) + ' 有 S/D（' + cnt.S + ' 开关 / ' + cnt.D + ' 门）');
      ok(!!s.switch && s.gates.length === cnt.D, 'L' + (i + 1) + ' 开关与门解析');
    } else {
      ok(cnt.S === 0 && cnt.D === 0, 'L' + (i + 1) + ' 无 S/D');
      ok(!s.switch && s.gates.length === 0, 'L' + (i + 1) + ' 无开关门');
    }
  });
})();

/* ============ 三、出生安全 ============ */
section('出生安全');
(function () {
  E.LEVELS.forEach(function (lv, i) {
    var s = E.newGame(i);
    ok(E.spawnSafe(s), 'L' + (i + 1) + ' 出生点不在任何守卫视野/近身');
    var s2 = E.newGame(i);
    var dead = false;
    for (var f = 0; f < 90; f++) {
      if (E.update(s2, {}, 1 / 30).some(function (e) { return e.type === 'caught'; })) { dead = true; break; }
    }
    ok(!dead, 'L' + (i + 1) + ' 出生后傻站 3 秒不死');
  });
})();

/* ============ 四、运动学与方向处理 ============ */
section('运动学（格间补间 + lastDir）');
(function () {
  var s = E.newGame(0);
  var p = s.player;
  E.update(s, { right: true }, 0.1);
  E.update(s, { right: true }, 0.3);
  E.update(s, { right: true }, 0.2);
  ok(p.c > p.pc || p.moving, '玩家补间坐标推进（pc=' + p.pc.toFixed(2) + '）');
  var a = E.newGame(0), b = E.newGame(0);
  for (var i = 0; i < 30; i++) {
    E.update(a, { right: true, sprint: true }, 1 / 30);
    E.update(b, { right: true }, 1 / 30);
  }
  ok(a.player.pc >= b.player.pc, '冲刺位移 ≥ 行走位移');
  var c = E.newGame(0);
  for (i = 0; i < 60; i++) E.update(c, { left: true }, 1 / 30);
  ok(!E.isSolid(c, c.player.r, c.player.c), '玩家永不进墙');
  // 多键：lastDir 优先于固定上下左右
  var d = E.newGame(0);
  E.update(d, { up: true, right: true, lastDir: 'r' }, 1 / 30);
  ok(d.player.mdir && d.player.mdir.dc === 1, '多键时 lastDir=r 向右');
  var e2 = E.newGame(0);
  E.update(e2, { up: true, right: true, lastDir: 'u' }, 1 / 30);
  ok(e2.player.mdir && e2.player.mdir.dr === -1, '多键时 lastDir=u 向上');
})();

/* ============ 五、固定视锥与门遮挡 ============ */
section('固定视锥与门遮挡');
(function () {
  var s = E.newGame(0); s.solid = {};
  var g = s.guards[0];
  g.r = 1; g.c = 1; g.dir = 0;
  ok(E.canSee(s, g, 1, 1), '同格目标无视朝向可见');
  ok(E.canSee(s, g, 1, 3), '正前方直线可见');
  ok(!E.canSee(s, g, 1, 8), '超视距不可见');
  ok(E.canSee(s, g, 3, 3), '视锥内斜向可见');
  ok(!E.canSee(s, g, 4, 3), '视锥外不可见');
  ok(E.fovDist(s, g, 1, 1) === 5, 'fovDist 固定 5（猎犬不加视距）');
  var s2 = E.newGame(0);
  var g2 = s2.guards[0];
  g2.r = 4; g2.c = 3; g2.dir = 0;
  s2.player.r = 4; s2.player.c = 8;
  s2.solid['4,5'] = true;
  ok(!E.canSee(s2, g2, 4, 8), '墙遮挡视线');
  ok(E.lineOfSight(s2, 4, 3, 4, 4), '无墙射线畅通');
  // 关闭的卷帘门遮挡
  var s3 = E.newGame(3); // L4
  var gate = s3.gates[0];
  ok(E.isSolid(s3, gate.r, gate.c), 'L4 卷帘门关闭时 solid');
  ok(!E.lineOfSight(s3, gate.r, gate.c - 2, gate.r, gate.c + 1), '关闭的卷帘门遮挡视线');
  // 开门后不遮挡
  s3.player.r = s3.switch.r; s3.player.c = s3.switch.c;
  s3.player.pr = s3.switch.r; s3.player.pc = s3.switch.c;
  E.update(s3, { interact: true }, 1 / 30);
  ok(!E.isSolid(s3, gate.r, gate.c), '开门后卷帘门非 solid');
  ok(E.lineOfSight(s3, gate.r, gate.c - 2, gate.r, gate.c + 1), '开门后视线畅通');
})();

/* ============ 六、察觉：短露头不追 / 持续看见追捕 ============ */
section('察觉（notice 阈值）');
(function () {
  // 短露头（<0.45s）不追
  var s = E.newGame(0); s.solid = {};
  placeGuard(s, 0, 5, 1, 0);
  s.player.r = 5; s.player.c = 3; s.player.pr = 5; s.player.pc = 3;
  var spotted = false;
  for (var i = 0; i < 8; i++) { // 0.267s < 0.45s
    if (E.update(s, {}, 1 / 30).some(function (e) { return e.type === 'spotted'; })) spotted = true;
  }
  ok(!spotted, '短露头(<0.45s)不触发 spotted');
  s.player.r = 4; s.player.c = 10; s.player.pr = 4; s.player.pc = 10; // 移出视野
  for (i = 0; i < 30; i++) E.update(s, {}, 1 / 30);
  ok(s.guards[0].state !== 'chase', '短露头后守卫不进入 chase');
  // 持续看见（≥0.45s）追捕
  var s2 = E.newGame(0); s2.solid = {};
  placeGuard(s2, 0, 5, 1, 0);
  s2.player.r = 5; s2.player.c = 3; s2.player.pr = 5; s2.player.pc = 3;
  var spotted2 = false;
  for (i = 0; i < 20 && !spotted2; i++) { // 0.667s > 0.45s
    spotted2 = E.update(s2, {}, 1 / 30).some(function (e) { return e.type === 'spotted'; });
  }
  ok(spotted2, '持续看见(≥0.45s)触发 spotted');
  ok(s2.guards[0].state === 'chase', '持续看见后进入 chase');
  ok(s2.player.detections === 1, 'detections 计数 +1');
  ok(s2.player.preKeyDetections === 1, 'preKeyDetections 计数 +1（取钥匙前）');
})();

/* ============ 七、抓捕规则 ============ */
section('抓捕（插值欧氏 + LOS，仅 chase）');
(function () {
  // 无墙后抓捕
  var s = E.newGame(0); s.solid = {};
  placeGuard(s, 0, 5, 2, 0);
  s.guards[0].state = 'chase';
  s.player.r = 5; s.player.c = 3; s.player.pr = 5; s.player.pc = 3;
  var caught = false;
  for (var i = 0; i < 30 && !caught; i++) {
    caught = E.update(s, {}, 1 / 30).some(function (e) { return e.type === 'caught'; });
  }
  ok(caught, 'chase 近身（插值欧氏≤0.48）触发 caught');
  ok(s.done && s.result === 'caught', '状态结束·被抓');
  // 隔墙不抓（整行墙隔断，守卫绕不过去）
  var s2 = E.newGame(1); s2.solid = {};
  for (var wc = 0; wc < 14; wc++) s2.solid['5,' + wc] = true;
  placeGuard(s2, 0, 4, 2, 0);
  var g2 = s2.guards[0];
  g2.state = 'chase';
  g2.lastSeen = { r: 6, c: 4 };
  s2.player.r = 6; s2.player.c = 4; s2.player.pr = 6; s2.player.pc = 4;
  var caught2 = false;
  for (i = 0; i < 90 && !caught2; i++) {
    caught2 = E.update(s2, {}, 1 / 30).some(function (e) { return e.type === 'caught'; });
  }
  ok(!caught2, '隔墙不抓');
  // 两格不抓（旧版曼哈顿≤2 会误抓）
  var s3 = E.newGame(0); s3.solid = {};
  placeGuard(s3, 0, 5, 2, 0);
  s3.guards[0].state = 'chase';
  s3.player.r = 5; s3.player.c = 4; s3.player.pr = 5; s3.player.pc = 4;
  var caught3 = false;
  for (i = 0; i < 5 && !caught3; i++) {
    caught3 = E.update(s3, {}, 1 / 30).some(function (e) { return e.type === 'caught'; });
  }
  ok(!caught3, '两格不抓');
  // hunt 不隔空抓（面朝西，玩家在身后）
  var s4 = E.newGame(0); s4.solid = {};
  placeGuard(s4, 0, 5, 2, Math.PI);
  var g4 = s4.guards[0];
  g4.state = 'hunt';
  g4.huntTarget = { r: 5, c: 2 };
  s4.player.r = 5; s4.player.c = 3; s4.player.pr = 5; s4.player.pc = 3;
  var caught4 = false;
  for (i = 0; i < 30 && !caught4; i++) {
    caught4 = E.update(s4, {}, 1 / 30).some(function (e) { return e.type === 'caught'; });
  }
  ok(!caught4, 'hunt 状态不隔空抓');
})();

/* ============ 八、钥匙与警报 ============ */
section('钥匙与警报（escape 阶段）');
(function () {
  var s = E.newGame(0);
  s.player.r = s.key.r; s.player.c = s.key.c;
  s.player.pr = s.key.r; s.player.pc = s.key.c;
  var ev = E.update(s, {}, 1 / 30);
  ok(ev.some(function (e) { return e.type === 'key'; }), '拾取钥匙触发 key');
  ok(ev.some(function (e) { return e.type === 'alarm'; }), '拾取钥匙触发 alarm');
  ok(s.key.got && s.player.keys === 1, 'key.got 且 keys=1');
  ok(s.phase === 'escape', 'phase 进入 escape');
  ok(s.guards.every(function (g) { return g.state === 'hunt'; }), '所有非 chase 守卫进入 hunt');
  ok(s.guards.every(function (g) {
    return g.huntTarget && g.huntTarget.r === s.key.r && g.huntTarget.c === s.key.c;
  }), 'hunt 目标为钥匙格');
  // 守卫目标钥匙而非玩家：把玩家传走，守卫仍朝钥匙格移动
  s.player.r = 4; s.player.c = 1; s.player.pr = 4; s.player.pc = 1;
  var dBefore = Math.abs(s.guards[0].r - s.key.r) + Math.abs(s.guards[0].c - s.key.c);
  var spotted = false;
  for (var i = 0; i < 60; i++) { // 2s（含 0.8s 警报预热）
    if (E.update(s, {}, 1 / 30).some(function (e) { return e.type === 'spotted'; })) spotted = true;
  }
  var g0 = s.guards[0];
  var dAfter = Math.abs(g0.r - s.key.r) + Math.abs(g0.c - s.key.c);
  ok(!spotted, '守卫不因玩家位置触发 spotted');
  ok(dAfter < dBefore, '守卫朝钥匙格移动（而非玩家）');
  ok(g0.huntTarget && g0.huntTarget.r === s.key.r, 'huntTarget 仍是钥匙格');

  // 警报预热结束后，hunt 只因玩家主动冲刺声更新目标，不获得无声实时位置
  var s3 = E.newGame(0);
  placeGuard(s3, 0, 1, 7, Math.PI / 2);
  s3.key.got = true; s3.player.keys = 1; s3.phase = 'escape'; s3.alarmT = 0;
  s3.guards[0].state = 'hunt';
  s3.guards[0].huntTarget = { r: s3.key.r, c: s3.key.c };
  s3.player.r = 1; s3.player.c = 4; s3.player.pr = 1; s3.player.pc = 4;
  var heard = false;
  for (i = 0; i < 8 && !heard; i++) {
    heard = E.update(s3, { right: true, sprint: true }, 1 / 30).some(function (e) { return e.type === 'heard'; });
  }
  ok(heard, '警报搜索能听见范围内冲刺声');
  ok(s3.guards[0].huntTarget.r === s3.player.r && s3.guards[0].huntTarget.c === s3.player.c,
    'hunt 目标只推进到玩家留下的声源格');
})();

/* ============ 九、听觉 ============ */
section('听觉（离散声脉冲 + BFS 距离）');
(function () {
  // 行走无声
  var s = E.newGame(0); s.solid = {};
  placeGuard(s, 0, 5, 5, -Math.PI / 2); // 面北，不看玩家
  s.player.r = 5; s.player.c = 2; s.player.pr = 5; s.player.pc = 2;
  var heard = false;
  for (var i = 0; i < 20 && !heard; i++) {
    heard = E.update(s, { right: true }, 1 / 30).some(function (e) { return e.type === 'heard'; });
  }
  ok(!heard, '行走无声');
  // 冲刺完成一格才发声
  var s2 = E.newGame(0); s2.solid = {};
  placeGuard(s2, 0, 5, 5, -Math.PI / 2);
  s2.player.r = 5; s2.player.c = 2; s2.player.pr = 5; s2.player.pc = 2;
  var heard2 = false;
  for (i = 0; i < 40 && !heard2; i++) {
    heard2 = E.update(s2, { right: true, sprint: true }, 1 / 30).some(function (e) { return e.type === 'heard'; });
  }
  ok(heard2, '冲刺完成一格触发 heard');
  // 冲刺途中松开也必须保留本格声响，不能靠末帧松键消音
  var s2b = E.newGame(0); s2b.solid = {};
  placeGuard(s2b, 0, 5, 5, -Math.PI / 2);
  s2b.player.r = 5; s2b.player.c = 2; s2b.player.pr = 5; s2b.player.pc = 2;
  var heard2b = false;
  for (i = 0; i < 4; i++) E.update(s2b, { right: true, sprint: true }, 1 / 30);
  for (i = 0; i < 20 && !heard2b; i++) {
    heard2b = E.update(s2b, { right: true }, 1 / 30).some(function (e) { return e.type === 'heard'; });
  }
  ok(heard2b, '冲刺途中松键仍在完成该格时发声');
  // 未完成一格不发声
  var s3 = E.newGame(0); s3.solid = {};
  placeGuard(s3, 0, 5, 5, -Math.PI / 2);
  s3.player.r = 5; s3.player.c = 2; s3.player.pr = 5; s3.player.pc = 2;
  var heard3 = false;
  for (i = 0; i < 3; i++) { // 0.1s = 0.54 格 < 1 格
    heard3 = heard3 || E.update(s3, { right: true, sprint: true }, 1 / 30).some(function (e) { return e.type === 'heard'; });
  }
  ok(!heard3, '未完成一格冲刺不发声');
  // BFS 隔墙距离：墙后一格冲刺听不见（欧氏 3 格但 BFS 5 > 4）
  var s4 = E.newGame(0); s4.solid = {};
  placeGuard(s4, 0, 5, 5, -Math.PI / 2);
  s4.solid['5,4'] = true;
  s4.player.r = 5; s4.player.c = 1; s4.player.pr = 5; s4.player.pc = 1;
  var heard4 = false;
  for (i = 0; i < 7 && !heard4; i++) { // 0.233s = 1.26 格 → 完成一格
    heard4 = E.update(s4, { right: true, sprint: true }, 1 / 30).some(function (e) { return e.type === 'heard'; });
  }
  ok(!heard4, 'BFS 隔墙距离：墙后一格冲刺听不见');
  // 无墙时同距离可听见
  var s5 = E.newGame(0); s5.solid = {};
  placeGuard(s5, 0, 5, 5, -Math.PI / 2);
  s5.player.r = 5; s5.player.c = 1; s5.player.pr = 5; s5.player.pc = 1;
  var heard5 = false;
  for (i = 0; i < 7 && !heard5; i++) {
    heard5 = E.update(s5, { right: true, sprint: true }, 1 / 30).some(function (e) { return e.type === 'heard'; });
  }
  ok(heard5, '无墙时同距离冲刺可听见');
  // 猎犬听觉更远（BFS 5：普通听不见，猎犬听得见）
  var s6 = E.newGame(0); s6.solid = {};
  placeGuard(s6, 0, 5, 5, -Math.PI / 2);
  s6.solid['5,4'] = true;
  s6.guards[0].hound = true;
  s6.player.r = 5; s6.player.c = 1; s6.player.pr = 5; s6.player.pc = 1;
  var heard6 = false;
  for (i = 0; i < 7 && !heard6; i++) {
    heard6 = E.update(s6, { right: true, sprint: true }, 1 / 30).some(function (e) { return e.type === 'heard'; });
  }
  ok(heard6, '猎犬听觉更远（BFS 5 ≤ 6 可听见）');
})();

/* ============ 十、开关：开门 + 巨响 ============ */
section('开关（interact 开门并发声）');
(function () {
  var s = E.newGame(3); // L4
  ok(!!s.switch && s.gates.length >= 1, 'L4 有开关与卷帘门');
  ok(E.isSolid(s, s.gates[0].r, s.gates[0].c), '卷帘门初始 solid');
  s.player.r = s.switch.r; s.player.c = s.switch.c;
  s.player.pr = s.switch.r; s.player.pc = s.switch.c;
  var ev = E.update(s, { interact: true }, 1 / 30);
  ok(ev.some(function (e) { return e.type === 'switch'; }), 'interact 触发 switch');
  ok(ev.some(function (e) { return e.type === 'gateOpen'; }), '触发 gateOpen');
  ok(s.switch.used, '开关已使用');
  ok(s.gates.every(function (g) { return !E.isSolid(s, g.r, g.c); }), '全部卷帘门打开');
  var g0 = s.guards[0];
  ok(g0.state === 'investigate' && g0.tgt && g0.tgt.r === s.switch.r && g0.tgt.c === s.switch.c,
    '守卫听到巨响前往开关格');
  // 猎犬听到更远的开关巨响（BFS 9），普通守卫听不到（BFS 9 > 7）
  var s7 = E.newGame(5); // L6
  s7.player.r = s7.switch.r; s7.player.c = s7.switch.c;
  s7.player.pr = s7.switch.r; s7.player.pc = s7.switch.c;
  placeGuard(s7, 0, 1, 7, 0); // 猎犬放到 BFS 9 处
  s7.guards[0].hound = true;
  var ev7 = E.update(s7, { interact: true }, 1 / 30);
  ok(ev7.some(function (e) { return e.type === 'heard' && e.g === 0; }), '猎犬听到 BFS 9 的开关巨响');
  var s8 = E.newGame(5);
  s8.player.r = s8.switch.r; s8.player.c = s8.switch.c;
  s8.player.pr = s8.switch.r; s8.player.pc = s8.switch.c;
  placeGuard(s8, 0, 1, 7, 0); // 普通守卫放到 BFS 9 处
  s8.guards[0].hound = false;
  var ev8 = E.update(s8, { interact: true }, 1 / 30);
  ok(!ev8.some(function (e) { return e.type === 'heard' && e.g === 0; }), '普通守卫听不到 BFS 9 的开关巨响');
})();

/* ============ 十一、追逃：丢视线 → search → 脱逃 ============ */
section('追逃（丢视线可 search 并最终脱逃）');
(function () {
  var s = E.newGame(0); s.solid = {};
  placeGuard(s, 0, 5, 1, 0);
  s.player.r = 5; s.player.c = 3; s.player.pr = 5; s.player.pc = 3;
  var spotted = false;
  for (var i = 0; i < 20 && !spotted; i++) {
    spotted = E.update(s, {}, 1 / 30).some(function (e) { return e.type === 'spotted'; });
  }
  ok(spotted, '追逃：先触发 spotted');
  s.player.r = 4; s.player.c = 10; s.player.pr = 4; s.player.pc = 10; // 玩家传送走
  var lost = false, calm = false, caught = false, sawSearch = false;
  for (i = 0; i < 400 && !caught; i++) {
    var ev = E.update(s, {}, 1 / 30);
    for (var k = 0; k < ev.length; k++) {
      if (ev[k].type === 'lost') lost = true;
      if (ev[k].type === 'calm') calm = true;
      if (ev[k].type === 'caught') caught = true;
    }
    if (s.guards[0].state === 'search') sawSearch = true;
  }
  ok(lost, '丢视线触发 lost');
  ok(sawSearch, '守卫进入 search 搜索');
  ok(!caught, '玩家脱逃未被抓');
  ok(calm, '守卫最终 calm 回岗');
  ok(s.guards[0].state === 'patrol' || s.guards[0].state === 'investigate', '守卫回到巡逻/警戒');
})();

/* ============ 十二、出口：钥匙前锁 / 钥匙后胜 ============ */
section('出口（lockedExit / goal）');
(function () {
  var s = E.newGame(0);
  placeGuard(s, 0, 4, 1, -Math.PI / 2);
  s.player.r = s.exit.r; s.player.c = s.exit.c;
  s.player.pr = s.exit.r; s.player.pc = s.exit.c;
  var ev = E.update(s, {}, 1 / 30);
  ok(!s.done && ev.some(function (e) { return e.type === 'lockedExit'; }), '取钥匙前出口 lockedExit');
  var s2 = E.newGame(0);
  s2.key.got = true; s2.player.keys = 1; s2.phase = 'escape';
  placeGuard(s2, 0, 4, 1, -Math.PI / 2);
  s2.player.r = s2.exit.r; s2.player.c = s2.exit.c;
  s2.player.pr = s2.exit.r; s2.player.pc = s2.exit.c;
  var ev2 = E.update(s2, {}, 1 / 30);
  ok(ev2.some(function (e) { return e.type === 'goal'; }), '取钥匙后到达出口触发 goal');
  ok(s2.done && s2.result === 'win', '状态结束·胜利');
})();

/* ============ 十三、关键点静态可达与双路线 ============ */
section('静态可达与双路线');
(function () {
  function hasTwoRoutes(s, from, to) {
    var path = E.bfsPath(s, from, to);
    if (!path || path.length < 2) return false;
    for (var i = 0; i < path.length; i++) {
      var cell = path[i];
      if (cell.r === to.r && cell.c === to.c) continue;
      var key = cell.r + ',' + cell.c;
      var wasSolid = !!s.solid[key];
      s.solid[key] = true;
      var alt = E.bfsPath(s, from, to);
      if (wasSolid) s.solid[key] = true; else delete s.solid[key];
      if (alt) return true;
    }
    return false;
  }
  E.LEVELS.forEach(function (lv, i) {
    var s = E.newGame(i);
    var P = { r: s.player.r, c: s.player.c };
    var K = { r: s.key.r, c: s.key.c };
    var Ex = { r: s.exit.r, c: s.exit.c };
    var s2 = E.newGame(i);
    s2.gates.forEach(function (g) { delete s2.solid[g.r + ',' + g.c]; }); // 模拟开门
    if (s.switch) {
      var Sw = { r: s.switch.r, c: s.switch.c };
      ok(!!E.bfsPath(s, P, Sw), 'L' + (i + 1) + ' P→S 可达');
      ok(!!E.bfsPath(s, P, K), 'L' + (i + 1) + ' 不开门也能 P→K');
      ok(!!E.bfsPath(s, K, Ex), 'L' + (i + 1) + ' 不开门也能 K→E');
      ok(!!E.bfsPath(s2, P, Ex), 'L' + (i + 1) + ' P→E 可达（开门后）');
      ok(!!E.bfsPath(s2, P, K), 'L' + (i + 1) + ' P→K 可达（开门后）');
      ok(!!E.bfsPath(s2, Sw, K), 'L' + (i + 1) + ' S→K 可达（开门后）');
      ok(!!E.bfsPath(s2, Sw, Ex), 'L' + (i + 1) + ' S→E 可达（开门后）');
      ok(E.bfsPath(s2, K, Ex).length < E.bfsPath(s, K, Ex).length,
        'L' + (i + 1) + ' 开门后 K→E 路线更短');
    } else {
      ok(!!E.bfsPath(s, P, K), 'L' + (i + 1) + ' P→K 可达');
      ok(!!E.bfsPath(s, P, Ex), 'L' + (i + 1) + ' P→E 可达');
    }
    ok(!!E.bfsPath(s2, K, Ex), 'L' + (i + 1) + ' K→E 可达（开门后）');
    ok(E.bfsPath(s2, K, Ex).length >= 8, 'L' + (i + 1) + ' 撤离路线足以形成追逃（≥8 格）');
    ok(hasTwoRoutes(s2, K, Ex), 'L' + (i + 1) + ' K→E 至少两条路线（无单一本道）');
  });
})();

/* ============ 十四、长时间无异常 ============ */
section('耐玩性（六关各 60 秒）');
(function () {
  E.LEVELS.forEach(function (lv, li) {
    var s = E.newGame(li);
    var crashed = false;
    for (var i = 0; i < 1800 && !s.done; i++) {
      try {
        var act = {};
        if (i % 37 === 0) act.up = true;
        if (i % 41 === 0) act.left = true;
        if (i % 53 === 0) act.sprint = true;
        if (i % 61 === 0) act.interact = true;
        E.update(s, act, 1 / 30);
      } catch (e) { crashed = true; break; }
    }
    ok(!crashed, 'L' + (li + 1) + ' 模拟 60 秒无异常');
  });
})();

console.log('\n====================');
console.log('通过 ' + passed + ' 项，失败 ' + failed + ' 项');
if (failed === 0) console.log('ALL ENGINE TESTS PASSED');
process.exit(failed === 0 ? 0 : 1);
