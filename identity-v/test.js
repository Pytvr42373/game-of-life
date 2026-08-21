/* ============================================================
 * test.js - 关键逻辑自测 (node headless)
 * 覆盖：地图连通 / 寻路 / 移动碰撞 / 修机 / 校准 / 攻击伤害 /
 *       护盾 / 倒地-牵制-处刑-救援-淘汰 / 挣扎 / 翻窗 / 板子 /
 *       逃生门 / 技能 / 技能CD / AI状态机 / 胜负判定
 * 运行：node test.js
 * ============================================================ */
'use strict';
const assert = require('assert');

// ---------- 装载模块并挂载到 globalThis ----------
const mapsMod = require('./maps.js');
const charsMod = require('./chars.js');
const audioMod = require('./audio.js');
Object.assign(globalThis, {
  MAPS: mapsMod.MAPS, parseMap: mapsMod.parseMap, tileSolid: mapsMod.tileSolid,
  TILE: mapsMod.TILE, mapConnectivity: mapsMod.mapConnectivity
});
Object.assign(globalThis, {
  SURVIVORS: charsMod.SURVIVORS, HUNTERS: charsMod.HUNTERS,
  getSurvivor: charsMod.getSurvivor, getHunter: charsMod.getHunter
});
globalThis.AudioSys = audioMod.AudioSys;
require('./game.js');
require('./ai.js');

const { Game, DIFF, GAME_HELPERS } = globalThis;
const dist = GAME_HELPERS.dist;

// ---------- 工具 ----------
let passed = 0, failed = 0;
const results = [];
function test(name, fn) {
  try { fn(); passed++; results.push('PASS  ' + name); }
  catch (e) { failed++; results.push('FAIL  ' + name + ' :: ' + e.message); }
}
function fresh(mapIdx, opts) {
  const g = new Game();
  opts = opts || {};
  g.startMatch({ mapIdx: mapIdx || 0, difficulty: opts.difficulty || 'normal', asHunter: !!opts.asHunter, charId: opts.charId || 'med', hunterId: opts.hunterId || 'hun_chase' });
  return g;
}
const NONE = { x: 0, y: 0, attack: false, interact: false, skill: false, skill2: false, crouch: false, pause: false };
function step(g, dt, inp) {
  const i = Object.assign({}, NONE, inp || {});
  g.updateInput(i);
  g.update(dt || 1 / 30);
}
function findMachine(g, idx) { return g.machines[idx % g.machines.length]; }
function putAt(ent, x, y) { ent.x = x; ent.y = y; }
function faceTo(a, b) { a.dir = Math.atan2(b.y - a.y, b.x - a.x); }
function survivorOf(g, i) { return g.survivors[i % g.survivors.length]; }
function passableAt(g, x, y) { const tx = Math.floor(x / g.ts), ty = Math.floor(y / g.ts); return !g.tileIsSolid(tx, ty) && !g.tileIsDownPallet(tx, ty); }
// 自定义地图开局：窗/板作为唯一通道，便于确定性验证 AI 翻越
function freshCustom(grid, opts) {
  const g = new Game();
  const def = { name: 'custom', en: 'Custom', desc: '', ts: 42, grid: grid };
  MAPS.push(def);
  opts = opts || {};
  g.startMatch({ mapIdx: MAPS.length - 1, difficulty: opts.difficulty || 'normal', asHunter: !!opts.asHunter, charId: opts.charId || 'med', hunterId: opts.hunterId || 'hun_chase' });
  return g;
}

// ============================================================
// 1. 地图完整性
// ============================================================
test('地图: 三张地图连通且实体齐备', function () {
  for (const def of MAPS) {
    const m = parseMap(def);
    assert.ok(mapConnectivity(m).ok, def.name + ' 不连通');
    assert.ok(m.entities.machines.length >= 3, def.name + ' 密码机不足');
    assert.ok(m.entities.chairs.length >= 2, def.name + ' 处刑架不足');
    assert.ok(m.entities.gates.length >= 1, def.name + ' 逃生门缺失');
    assert.ok(m.entities.pallets.length >= 3, def.name + ' 板子不足');
    for (const pallet of m.entities.pallets) {
      assert.ok(mapsMod.palletChokepointAxis(m.grid, pallet.tx, pallet.ty), def.name + ' 板子未位于窄道: ' + pallet.tx + ',' + pallet.ty);
    }
    assert.ok(m.entities.windows.length >= 1, def.name + ' 窗户缺失');
    assert.ok(m.entities.hunterSpawn, def.name + ' 监管者出生点缺失');
    assert.ok(m.entities.spawns.length >= 1, def.name + ' 求生者出生点缺失');
  }
});

// ============================================================
// 2. 寻路
// ============================================================
test('寻路: 出生点可到达密码机', function () {
  const g = fresh(0);
  const p = g.player;
  const m = findMachine(g, 0);
  const path = g.pathTo(p.x, p.y, m.x, m.y);
  assert.ok(path && path.length > 1, '路径为空');
  const last = path[path.length - 1];
  assert.ok(dist(last.x, last.y, m.x, m.y) < g.ts * 2, '路径终点未接近目标');
  // 所有路点可行走
  for (const w of path) {
    assert.ok(passableAt(g, w.x, w.y), '路径经过障碍: ' + w.x + ',' + w.y);
  }
});

// ============================================================
// 3. 移动与碰撞
// ============================================================
test('碰撞: 撞墙不能穿墙，开放地带正常移动', function () {
  const g = fresh(0);
  g.hunter.ai.active = false; putAt(g.hunter, g.ts, g.ts);
  const p = g.player;
  // 找一个左侧是墙的可行走格
  let cell = null;
  outer:
  for (let y = 1; y < g.rows - 1; y++) for (let x = 1; x < g.cols - 1; x++) {
    if (passableAt(g, x * g.ts + g.ts / 2, y * g.ts + g.ts / 2) && g.tileIsSolid(x - 1, y)) { cell = { x, y }; break outer; }
  }
  assert.ok(cell, '找不到临墙格');
  const cx = cell.x * g.ts + g.ts / 2, cy = cell.y * g.ts + g.ts / 2;
  putAt(p, cx, cy);
  const before = p.x;
  for (let i = 0; i < 30; i++) step(g, 1 / 30, { x: -1, y: 0 });
  // 向左撞墙后位置不应越过墙
  const wallX = cell.x * g.ts;
  assert.ok(p.x >= wallX - 2, '穿墙了 x=' + p.x + ' wallX=' + wallX);
  // 开放移动
  putAt(p, g.cols * g.ts / 2, 3 * g.ts + g.ts / 2);
  const x0 = p.x, y0 = p.y;
  for (let i = 0; i < 20; i++) step(g, 1 / 30, { x: 1, y: 0 });
  assert.ok(p.x > x0, '未向右移动');
});

// ============================================================
// 4. 修机进度
// ============================================================
test('修机: 靠近密码机交互后进度增加', function () {
  const g = fresh(0);
  g.hunter.ai.active = false; putAt(g.hunter, g.ts, g.ts);
  const p = g.player;
  const m = findMachine(g, 0);
  putAt(p, m.x - 20, m.y);
  g.survivorInteract(p);
  assert.strictEqual(p.decoding, m, '未开始修机');
  const before = m.progress;
  for (let i = 0; i < 90; i++) step(g, 1 / 30); // 3s
  assert.ok(m.progress > before, '修机无进度');
  // 再次交互停止
  g.survivorInteract(p);
  assert.strictEqual(p.decoding, null, '未停止修机');
});

// ============================================================
// 5. 校准系统
// ============================================================
test('校准: 完美命中+4%, 失败-2%(破译专家不损失)', function () {
  // 完美
  let g = fresh(0);
  let p = g.player, m = findMachine(g, 0);
  putAt(p, m.x - 20, m.y);
  g.survivorInteract(p);
  g.spawnCheck(p, m);
  g.check.zoneC = 0.5; g.check.zoneW = 0.4; // 几乎必中
  const b0 = m.progress;
  g.pressCheck();
  assert.ok(m.progress >= b0 + 3, '完美未加进度');
  // 失败(普通角色扣2%)
  g = fresh(0);
  p = g.player; m = findMachine(g, 1);
  putAt(p, m.x - 20, m.y);
  g.survivorInteract(p);
  g.spawnCheck(p, m);
  g.check.zoneC = 0.5; g.check.zoneW = 0.001;
  g.check.t = g.check.timeout - 0.001;
  const b1 = m.progress;
  g.updateCheck(0.01);
  assert.strictEqual(m.progress, Math.max(0, b1 - 2), '失败应-2%');
  // 破译专家不损失
  g = fresh(0, { charId: 'dec' });
  p = g.player; m = findMachine(g, 2);
  putAt(p, m.x - 20, m.y);
  g.survivorInteract(p);
  g.spawnCheck(p, m);
  g.check.zoneC = 0.5; g.check.zoneW = 0.001;
  g.check.t = g.check.timeout - 0.001;
  const b2 = m.progress;
  g.updateCheck(0.01);
  assert.strictEqual(m.progress, b2, '破译专家失败不应扣进度');
});

// ============================================================
// 6. 攻击与伤害
// ============================================================
test('攻击: 两次命中倒地, 第三次不再扣(护盾/倒地处理)', function () {
  const g = fresh(0);
  const p = g.player;
  const h = g.hunter;
  putAt(p, h.x + 30, h.y);
  faceTo(h, p);
  g.hunterAttack(h);
  assert.strictEqual(p.hp, 1, '第一击应受伤');
  assert.strictEqual(h.wipeT > 0, true, '命中后应进入擦刀');
  g.hunterAttack(h); // atkCd 挡
  assert.strictEqual(p.hp, 1, 'CD未到不应再次命中');
  // 强制冷却并结束擦刀
  h.atkCd = 0; h.wipeT = 0;
  g.hunterAttack(h);
  assert.strictEqual(p.hp, 0, '第二击应倒地');
  // 已倒地者不再重复计分/触发擦刀
  h.atkCd = 0; h.wipeT = 0;
  const hits0 = h.scoreHit;
  assert.strictEqual(g.hunterAttack(h), false, '倒地者不应再被有效命中');
  assert.strictEqual(h.scoreHit, hits0, '倒地者不应重复计分');
  assert.strictEqual(h.wipeT, 0, '命中倒地者不应触发擦刀');
});

test('攻击: 护盾抵挡一次攻击', function () {
  const g = fresh(0, { charId: 'gua' });
  putAt(g.survivors[1], 9999, 9999); putAt(g.survivors[2], 9999, 9999);
  const p = g.player;
  g.useSurvivorSkill(p);
  assert.ok(p.shield > 0, '未套盾');
  const h = g.hunter;
  putAt(p, h.x + 30, h.y); faceTo(h, p);
  g.hunterAttack(h);
  assert.strictEqual(p.shield, 0, '护盾应被消耗');
  assert.strictEqual(p.hp, 2, '护盾应完全格挡');
});

test('冲刺监管者: 冲刺中命中直接击倒', function () {
  const g = fresh(0, { hunterId: 'hun_chase' });
  const p = g.player;
  const h = g.hunter;
  h.dashT = 1.0;
  putAt(p, h.x + 30, h.y); faceTo(h, p);
  g.hunterAttack(h);
  assert.strictEqual(p.hp, 0, '冲刺应直接击倒');
});

// ============================================================
// 7. 倒地-牵制-处刑-救援-淘汰
// ============================================================
test('处刑流程: 倒地→牵制→挂椅→救援→淘汰', function () {
  const g = fresh(0);
  const p = g.player;
  const ally = g.survivors[1];
  const h = g.hunter;
  // 打倒
  putAt(p, h.x + 26, h.y); faceTo(h, p);
  h.atkCd = 0; g.hunterAttack(h);
  h.atkCd = 0; h.wipeT = 0; g.hunterAttack(h);
  assert.strictEqual(p.hp, 0, '应倒地');
  // 牵制
  putAt(h, p.x + 10, p.y);
  h.wipeT = 0; // 结束擦刀
  g.hunterInteract(h);
  assert.strictEqual(h.carrying, p, '应被牵制');
  // 挂椅
  const chair = g.chairs[0];
  putAt(h, chair.x, chair.y);
  g.hunterInteract(h);
  assert.strictEqual(chair.occupant, p, '应被挂上');
  assert.strictEqual(p.chair, chair, '求生者应记录处刑架');
  // 救援(禁用监管者AI并移开，避免干扰)
  g.hunter.ai.active = false; putAt(g.hunter, g.ts, g.ts);
  ally.ai = null; putAt(g.survivors[2], 9999, 9999);
  putAt(ally, chair.x - 10, chair.y);
  g.startChannel(ally, { type: 'rescue', target: chair, progress: 0, dur: 1.8 });
  for (let i = 0; i < 70; i++) step(g, 1 / 30);
  assert.strictEqual(chair.occupant, null, '救援后应清空处刑架');
  assert.strictEqual(p.hp, 1, '救援后应处于受伤');
  assert.strictEqual(p.chair, null, '救援后应脱离处刑架');
  // 淘汰
  putAt(h, chair.x, chair.y);
  putAt(p, h.x + 26, h.y); faceTo(h, p);
  h.atkCd = 0; g.hunterAttack(h); h.atkCd = 0; h.wipeT = 0; g.hunterAttack(h);
  assert.strictEqual(p.hp, 0, '再次倒地');
  putAt(h, p.x + 10, p.y); g.hunterInteract(h);
  assert.strictEqual(h.carrying, p, '再次牵制');
  putAt(h, chair.x, chair.y); g.hunterInteract(h);
  assert.strictEqual(chair.occupant, p, '再次挂椅');
  chair.timer = chair.total - 0.4;
  for (let i = 0; i < 20; i++) step(g, 1 / 30);
  assert.strictEqual(p.alive, false, '倒计时结束应被淘汰');
});

test('牵制挣扎: 满进度挣脱', function () {
  const g = fresh(0);
  const p = g.player;
  const h = g.hunter;
  p.hp = 0;
  putAt(h, p.x + 10, p.y);
  g.hunterInteract(h);
  assert.strictEqual(h.carrying, p, '应被牵制');
  p.carryStruggle = 95;
  for (let i = 0; i < 20; i++) step(g, 1 / 30);
  assert.strictEqual(h.carrying, null, '应挣脱');
  assert.strictEqual(p.hp, 1, '挣脱后受伤');
});

test('倒地救援: 玩家可持续扶起队友且监管者仍能感知倒地者', function () {
  const g = fresh(0);
  const p = g.player;
  const ally = g.survivors[1];
  g.hunter.ai.active = false;
  ally.ai = null;
  g.survivors[2].ai = null;
  putAt(g.survivors[2], 9999, 9999);
  ally.hp = 0;
  ally.invisible = 0;
  putAt(ally, 10 * g.ts + g.ts / 2, 4 * g.ts + g.ts / 2);
  putAt(p, ally.x + 12, ally.y);
  putAt(g.hunter, ally.x + 80, ally.y);
  assert.ok(g.perceiveSurvivors(g.hunter).some(function (v) { return v.s === ally; }), '监管者应能感知倒地者');
  g.survivorInteract(p);
  assert.ok(p.channel && p.channel.type === 'revive', '应开始扶起通道');
  for (let i = 0; i < 180; i++) g.updateChannels(1 / 30);
  assert.strictEqual(ally.hp, 1, '扶起后应恢复为受伤状态');
  assert.strictEqual(p.channel, null, '扶起完成应结束通道');
});

test('倒地救援: AI会靠近并扶起安全区域内的队友', function () {
  const g = fresh(0);
  const downed = g.survivors[0];
  const rescuer = g.survivors[1];
  downed.ai = null;
  g.survivors[2].ai = null;
  g.hunter.ai.active = false;
  downed.hp = 0;
  putAt(rescuer, downed.x + 12, downed.y);
  putAt(g.hunter, downed.x + 600, downed.y);
  rescuer.ai.update(0.1);
  assert.ok(rescuer.channel && rescuer.channel.type === 'revive', 'AI应开始扶起倒地队友');
  for (let i = 0; i < 180; i++) g.updateChannels(1 / 30);
  assert.strictEqual(downed.hp, 1, 'AI应完成扶起');
});

// ============================================================
// 8. 翻窗 / 板子
// ============================================================
test('翻窗: 朝窗户移动自动翻越到对侧', function () {
  const g = fresh(1); // 庄园有窗户
  g.hunter.ai.active = false; putAt(g.hunter, g.ts, g.ts);
  const p = g.player;
  // 找一个两侧都可行走的窗
  let w = null, side = null;
  const checks = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const cand of g.windows) {
    for (const c of checks) {
      const tx = cand.tx + c[0], ty = cand.ty + c[1];
      if (tx >= 0 && ty >= 0 && tx < g.cols && ty < g.rows && !g.tileIsSolid(tx, ty)) {
        const btx = cand.tx - c[0], bty = cand.ty - c[1];
        if (btx >= 0 && bty >= 0 && btx < g.cols && bty < g.rows && !g.tileIsSolid(btx, bty)) {
          w = cand; side = c; break;
        }
      }
    }
    if (w) break;
  }
  assert.ok(w, '找不到两侧可行的窗户');
  const ts = g.ts;
  putAt(p, w.x - side[0] * ts, w.y - side[1] * ts);
  const startX = p.x;
  let vaulted = false;
  for (let i = 0; i < 10; i++) {
    step(g, 1 / 30, { x: side[0], y: side[1] });
    if (p.vaultT > 0 || dist(p.x, p.y, w.x, w.y) > 25) { vaulted = true; break; }
  }
  assert.ok(vaulted, '未翻越窗户');
});

test('板子: 窄道放倒后一次性阻挡，监管者耗时破坏且期间不能移动攻击', function () {
  const g = fresh(0);
  const p = g.player;
  const h = g.hunter;
  h.ai.active = false;
  const pal = g.pallets[0];
  putAt(p, pal.x, pal.y);
  putAt(h, pal.x - 6, pal.y);
  g.survivorInteract(p);
  assert.strictEqual(pal.down, true, '板子应放下');
  assert.strictEqual(pal.used, true, '板子放下后应标记为已使用');
  assert.strictEqual(g.tileIsDownPallet(pal.tx, pal.ty), true, '倒板应阻挡通道');
  assert.ok(h.stunT > 0, '板下监管者应被砸晕');

  // 破坏不是瞬时完成
  h.stunT = 0;
  g.hunterInteract(h);
  assert.strictEqual(h.breakingPallet, pal, '监管者应开始破坏木板');
  const hx = h.x, hy = h.y;
  h.moveX = 1; h.moveY = 0;
  g.moveEntity(h, 0.5);
  assert.strictEqual(h.x, hx, '破坏期间监管者不能移动');
  assert.strictEqual(h.y, hy, '破坏期间监管者不能移动');
  const target = g.survivors[1];
  target.ai = null; target.hp = 2; putAt(target, h.x + 20, h.y); faceTo(h, target); h.atkCd = 0;
  assert.strictEqual(g.hunterAttack(h), false, '破坏期间监管者不能攻击');
  g.updatePalletBreak(1.0);
  assert.strictEqual(pal.down, true, '破坏时间未满时板子不能消失');
  g.updatePalletBreak(0.9);
  assert.strictEqual(pal.destroyed, true, '破坏完成后应永久销毁');
  assert.strictEqual(pal.down, false, '销毁后通道应恢复');
  assert.strictEqual(g.tileIsDownPallet(pal.tx, pal.ty), false, '销毁后不再阻挡');

  // 一次性资源：销毁后不能再次放下
  putAt(p, pal.x, pal.y);
  g.dropPallet(p);
  assert.strictEqual(pal.down, false, '已销毁板子不能重复使用');
  assert.strictEqual(pal.destroyed, true, '已销毁状态必须保留');
});

test('板子: 横/竖板放下双方脱困(放板者与监管者分居两侧)', function () {
  // 遍历所有地图的所有板子，验证放下后放板者与监管者都不被卡在倒板格内
  for (let mi = 0; mi < MAPS.length; mi++) {
    const g = fresh(mi);
    g.hunter.ai.active = false;
    const p = g.player;
    for (const pal of g.pallets) {
      // 放板者站在板格上
      putAt(p, pal.x, pal.y);
      // 监管者与板重叠
      putAt(g.hunter, pal.x, pal.y);
      g.survivorInteract(p);
      assert.strictEqual(pal.down, true, '板子应放下');
      // 双方都不应位于倒板格内(脱困)
      assert.strictEqual(g.tileIsDownPallet(Math.floor(p.x / g.ts), Math.floor(p.y / g.ts)), false, '放板者被卡在倒板格');
      assert.strictEqual(g.tileIsDownPallet(Math.floor(g.hunter.x / g.ts), Math.floor(g.hunter.y / g.ts)), false, '监管者被卡在倒板格');
      // 双方应分居板的两侧(不同侧)
      const sSide = g._whichSide(p, pal, pal.axis === 'vertical' ? 'vertical' : 'horizontal');
      const hSide = g._whichSide(g.hunter, pal, pal.axis === 'vertical' ? 'vertical' : 'horizontal');
      assert.notStrictEqual(sSide, hSide, '放板者与监管者应分居两侧');
      // 重置板子供下一轮
      pal.down = false; pal.used = false; pal.destroyed = false;
      g.grid[pal.ty][pal.tx] = mapsMod.TILE.PAL;
    }
  }
});

test('板子: 求生者朝倒板移动自动翻越到对侧', function () {
  const g = fresh(0);
  g.hunter.ai.active = false; putAt(g.hunter, g.ts, g.ts);
  const p = g.player;
  const pal = g.pallets[0];
  // 放下板子
  putAt(p, pal.x, pal.y);
  g.survivorInteract(p);
  assert.strictEqual(pal.down, true, '板子应放下');
  // 把求生者放到板的一侧，朝板移动应翻越
  const axis = pal.axis === 'vertical' ? 'vertical' : 'horizontal';
  const ts = g.ts;
  const start = g._palletSide(p, pal, axis);
  putAt(p, start.x, start.y);
  const dir = axis === 'vertical' ? { x: Math.sign(pal.x - p.x) || 1, y: 0 } : { x: 0, y: Math.sign(pal.y - p.y) || 1 };
  let vaulted = false;
  for (let i = 0; i < 12; i++) {
    step(g, 1 / 30, dir);
    if (p.vaultT > 0) { vaulted = true; break; }
  }
  assert.ok(vaulted, '求生者应翻越倒板');
  // 翻越后应位于对侧
  const afterSide = g._whichSide(p, pal, axis);
  assert.notStrictEqual(afterSide, g._whichSide({ x: start.x, y: start.y }, pal, axis), '翻越后应到对侧');
});

test('板子: 监管者E破板且不卡(重叠时先移到合法侧)', function () {
  const g = fresh(0);
  const p = g.player;
  const h = g.hunter;
  h.ai.active = false;
  const pal = g.pallets[0];
  putAt(p, pal.x, pal.y);
  putAt(h, pal.x, pal.y); // 监管者与板重叠
  g.survivorInteract(p);
  assert.strictEqual(pal.down, true, '板子应放下');
  // 监管者被推到合法侧
  assert.strictEqual(g.tileIsDownPallet(Math.floor(h.x / g.ts), Math.floor(h.y / g.ts)), false, '监管者不应卡在倒板格');
  h.stunT = 0;
  // E 破板
  g.hunterInteract(h);
  assert.strictEqual(h.breakingPallet, pal, '监管者应开始破坏');
  g.updatePalletBreak(1.0);
  g.updatePalletBreak(0.9);
  assert.strictEqual(pal.destroyed, true, '板子应被破坏');
  assert.strictEqual(h.breakingPallet, null, '破坏完成后监管者应解除破坏状态');
  // 破坏后通道可通过且监管者不卡
  assert.strictEqual(g.tileIsDownPallet(pal.tx, pal.ty), false, '破坏后通道应恢复');
  assert.strictEqual(g.collidesAt(h, h.x, h.y), false, '监管者不应被卡住');
});

test('翻窗: 求生者与监管者均翻窗且 vaultT 归零、监管者更慢', function () {
  const g = fresh(1); // 庄园有窗户
  g.hunter.ai.active = false;
  const p = g.player;
  // 找一个两侧都可行的窗
  let w = null, side = null;
  const checks = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const cand of g.windows) {
    for (const c of checks) {
      const tx = cand.tx + c[0], ty = cand.ty + c[1];
      if (tx >= 0 && ty >= 0 && tx < g.cols && ty < g.rows && !g.tileIsSolid(tx, ty)) {
        const btx = cand.tx - c[0], bty = cand.ty - c[1];
        if (btx >= 0 && bty >= 0 && btx < g.cols && bty < g.rows && !g.tileIsSolid(btx, bty)) {
          w = cand; side = c; break;
        }
      }
    }
    if (w) break;
  }
  assert.ok(w, '找不到两侧可行的窗户');
  const ts = g.ts;
  // 求生者翻窗
  putAt(p, w.x - side[0] * ts, w.y - side[1] * ts);
  let sv = null;
  for (let i = 0; i < 10; i++) {
    step(g, 1 / 30, { x: side[0], y: side[1] });
    if (p.vaultT > 0) { sv = p.vaultT; break; }
  }
  assert.ok(sv !== null, '求生者应翻窗');
  // 求生者 vaultT 归零
  for (let i = 0; i < 40; i++) step(g, 1 / 30);
  assert.strictEqual(p.vaultT <= 0, true, '求生者 vaultT 应归零');
  // 监管者翻窗(玩家是求生者，监管者AI已关，手动设移动方向)
  const h = g.hunter;
  putAt(h, w.x - side[0] * ts, w.y - side[1] * ts);
  let hv = null;
  for (let i = 0; i < 10; i++) {
    h.moveX = side[0]; h.moveY = side[1];
    step(g, 1 / 30);
    if (h.vaultT > 0) { hv = h.vaultT; break; }
  }
  assert.ok(hv !== null, '监管者应翻窗');
  // 监管者更慢(时长更长)
  assert.ok(hv > sv, '监管者翻窗应比普通求生者慢');
  // 监管者 vaultT 归零
  for (let i = 0; i < 60; i++) step(g, 1 / 30);
  assert.strictEqual(h.vaultT <= 0, true, '监管者 vaultT 应归零');
});

test('自愈: hp1 不可自愈, hp0 仅 selfHeal 动作可自愈', function () {
  const g = fresh(0);
  g.hunter.ai.active = false; putAt(g.hunter, g.ts, g.ts);
  const p = g.player;
  // hp1 时 survivorInteract 不自愈
  p.hp = 1;
  g.survivorInteract(p);
  assert.strictEqual(p.channel, null, 'hp1 交互不应自愈');
  // hp1 时 selfHeal 动作也不自愈
  g.selfHeal(p);
  assert.strictEqual(p.channel, null, 'hp1 selfHeal 不应自愈');
  // hp0 时 survivorInteract 不自愈(需独立 selfHeal 动作)
  p.hp = 0;
  g.survivorInteract(p);
  assert.strictEqual(p.channel, null, 'hp0 交互不应自愈');
  // hp0 时 selfHeal 动作可自愈
  g.selfHeal(p);
  assert.ok(p.channel && p.channel.type === 'heal_self_down', 'hp0 selfHeal 应开始自愈');
  // 自愈完成恢复为受伤
  for (let i = 0; i < 300; i++) g.updateChannels(1 / 30);
  assert.strictEqual(p.hp, 1, '自愈完成后应恢复为受伤');
});

test('速度: 健康/受伤等速, 受击2秒30%加速后恢复', function () {
  const g = fresh(0);
  const p = g.player;
  const h = g.hunter;
  h.ai.active = false;
  // 健康与受伤基础移速一致
  const sp2 = g.survivorSpeed(p);
  p.hp = 1;
  const sp1 = g.survivorSpeed(p);
  assert.strictEqual(sp1, sp2, 'hp1 与 hp2 基础移速应一致');
  // 受击后获得 30% 加速
  p.hp = 2; // 恢复健康再受击，确保只受伤不倒
  putAt(p, h.x + 30, h.y); faceTo(h, p);
  h.atkCd = 0; g.hunterAttack(h);
  assert.strictEqual(p.hp, 1, '应受伤');
  assert.ok(p.hitBoostT > 0, '受击应获得 hitBoostT');
  const boosted = g.survivorSpeed(p);
  assert.ok(Math.abs(boosted - sp1 * 1.3) < 0.001, '受击后应 30% 加速');
  // 2 秒后恢复
  for (let i = 0; i < 70; i++) step(g, 1 / 30); // ~2.3s
  assert.strictEqual(p.hitBoostT <= 0, true, 'hitBoostT 应归零');
  assert.strictEqual(g.survivorSpeed(p), sp1, '加速结束后应恢复基础移速');
});

test('擦刀: 监管者命中后1秒不能移动/攻击/交互/技能', function () {
  const g = fresh(0);
  const p = g.player;
  const h = g.hunter;
  h.ai.active = false;
  putAt(p, h.x + 30, h.y); faceTo(h, p);
  h.atkCd = 0; g.hunterAttack(h);
  assert.ok(h.wipeT > 0, '命中后应进入擦刀');
  // 不能移动
  const hx = h.x, hy = h.y;
  h.moveX = 1; h.moveY = 0;
  g.moveEntity(h, 0.5);
  assert.strictEqual(h.x, hx, '擦刀期间不能移动');
  assert.strictEqual(h.y, hy, '擦刀期间不能移动');
  // 不能攻击
  h.atkCd = 0;
  assert.strictEqual(g.hunterAttack(h), false, '擦刀期间不能攻击');
  // 不能交互
  const s2 = g.survivors[1]; s2.ai = null; s2.hp = 0; putAt(s2, h.x + 20, h.y);
  g.hunterInteract(h);
  assert.strictEqual(h.carrying, null, '擦刀期间不能交互');
  // 不能放技能
  g.useHunterSkill(h, 1);
  assert.strictEqual(h.dashT, 0, '擦刀期间不能放技能');
  // 1 秒后恢复
  for (let i = 0; i < 35; i++) step(g, 1 / 30); // ~1.2s
  assert.strictEqual(h.wipeT <= 0, true, '擦刀应结束');
});

test('修机: 离开密码机范围立即停止且进度不再增加/占用释放', function () {
  const g = fresh(0);
  g.hunter.ai.active = false; putAt(g.hunter, g.ts, g.ts);
  const p = g.player;
  const m = findMachine(g, 0);
  // 距机器 >64px 不能开始破译
  putAt(p, m.x - 80, m.y);
  g.survivorInteract(p);
  assert.strictEqual(p.decoding, null, '距机器过远不应开始破译');
  // 靠近开始破译
  putAt(p, m.x - 20, m.y);
  g.survivorInteract(p);
  assert.strictEqual(p.decoding, m, '应开始修机');
  assert.strictEqual(m.occupiedBy, p.id, '机器应被占用');
  const before = m.progress;
  for (let i = 0; i < 30; i++) step(g, 1 / 30); // 1s
  assert.ok(m.progress > before, '修机应有进度');
  // 离开范围(>72px)立即停止
  putAt(p, m.x - 100, m.y);
  step(g, 1 / 30);
  assert.strictEqual(p.decoding, null, '离开范围应立即停止破译');
  assert.strictEqual(m.occupiedBy, null, '离开范围应释放占用');
  const after = m.progress;
  for (let i = 0; i < 30; i++) step(g, 1 / 30); // 1s
  assert.strictEqual(m.progress, after, '停止后进度不应再增加');
});

test('修机: 机器完成清理所有指向它的 decoding', function () {
  const g = fresh(0);
  g.hunter.ai.active = false; putAt(g.hunter, g.ts, g.ts);
  const p = g.player;
  const m = findMachine(g, 0);
  putAt(p, m.x - 20, m.y);
  g.survivorInteract(p);
  assert.strictEqual(p.decoding, m, '应开始修机');
  g._checkTimer = 999; // 避免校准事件打断
  // 直接完成机器
  m.progress = m.max - 1;
  for (let i = 0; i < 30; i++) step(g, 1 / 30);
  assert.strictEqual(m.decoded, true, '机器应完成');
  assert.strictEqual(p.decoding, null, '机器完成后应清理 decoding');
  assert.strictEqual(m.occupiedBy, null, '机器完成后应释放占用');
  assert.strictEqual(m.decoders, 0, '机器完成后应清零 decoders');
});

// ============================================================
// 9. 逃生门
// ============================================================
test('逃生门: 全部破译→通电→开门→逃脱→求生者胜', function () {
  const g = fresh(0);
  // 直接完成所有密码机
  for (const m of g.machines) { m.progress = m.max; m.decoded = true; }
  g.checkGatePower();
  const gate = g.gates[0];
  assert.strictEqual(gate.powered, true, '大门应通电');
  const p = g.player;
  putAt(p, gate.x - 15, gate.y);
  g.startChannel(p, { type: 'gate', target: gate, progress: 0, dur: 3 });
  for (let i = 0; i < 120; i++) step(g, 1 / 30);
  assert.strictEqual(gate.open, true, '大门应开启');
  putAt(p, gate.x, gate.y);
  step(g, 1 / 30);
  assert.strictEqual(p.escaped, true, '应逃脱');
  assert.strictEqual(g.state, 'over', '应结束对局');
  assert.strictEqual(g.result.winner, 'survivor_win', '求生者应获胜');
});

test('胜负: 全部淘汰→监管者胜', function () {
  const g = fresh(0);
  for (const s of g.survivors) { s.alive = false; s.hp = -1; }
  g.checkWin();
  assert.strictEqual(g.state, 'over', '应结束');
  assert.strictEqual(g.result.winner, 'hunter_win', '监管者应获胜');
});

// ============================================================
// 10. 角色技能
// ============================================================
test('技能: 疾风冲刺提升移速', function () {
  const g = fresh(0, { charId: 'run' });
  const p = g.player;
  g.useSurvivorSkill(p);
  assert.ok(p.sprintT > 0, '冲刺未激活');
  assert.ok(g.survivorSpeed(p) > BASE_SPEED * 1.3, '速度未提升');
});

test('技能: 隐匿隐身, 监管者无法感知', function () {
  const g = fresh(0, { charId: 'gho' });
  const p = g.player;
  g.useSurvivorSkill(p);
  assert.ok(p.invisible > 0, '未隐身');
  const vis = g.perceiveSurvivors(g.hunter);
  assert.strictEqual(vis.length, 0, '隐身不应被发现');
});

test('技能: 机械师傀儡远程修机', function () {
  const g = fresh(0, { charId: 'eng' });
  const p = g.player;
  const m = findMachine(g, 0);
  putAt(p, p.x, p.y); // 玩家远距离(出生点)
  g.useSurvivorSkill(p);
  assert.ok(p.skillActive, '傀儡未激活');
  const before = m.progress;
  for (let i = 0; i < 30; i++) step(g, 1 / 30); // 1s
  assert.ok(m.progress > before, '傀儡未增加进度');
});

test('技能: 医生急救立即治疗队友', function () {
  const g = fresh(0, { charId: 'med' });
  const p = g.player;
  const ally = g.survivors[1];
  ally.hp = 1;
  putAt(ally, p.x + 40, p.y);
  g.useSurvivorSkill(p);
  assert.strictEqual(ally.hp, 2, '队友应被治愈');
});

test('技能: 守护者护盾+冲刺监管者+传送监管者', function () {
  let g = fresh(0, { charId: 'gua' });
  let p = g.player;
  g.useSurvivorSkill(p);
  assert.ok(p.shield > 0, '守护者未套盾');
  // 冲刺监管者
  g = fresh(0, { hunterId: 'hun_chase' });
  g.useHunterSkill(g.hunter, 1);
  assert.ok(g.hunter.dashT > 0, '冲刺未激活');
  // 传送监管者
  g = fresh(0, { hunterId: 'hun_tele' });
  const hx0 = g.hunter.x, hy0 = g.hunter.y;
  g.useHunterSkill(g.hunter, 1);
  assert.ok(dist(g.hunter.x, g.hunter.y, hx0, hy0) > 100, '传送未生效');
  g.hunter.stunT = 0; // 传送后眩晕会挡技能，先清空
  g.useHunterSkill(g.hunter, 2);
  assert.ok(g.reveal > 0, '全视之眼未生效');
});

test('技能CD: 使用后进入冷却并递减', function () {
  const g = fresh(0, { charId: 'run' });
  const p = g.player;
  g.useSurvivorSkill(p);
  assert.ok(p.skillCd > 0, '应进入CD');
  const cd0 = p.skillCd;
  for (let i = 0; i < 30; i++) step(g, 1 / 30); // 1s
  assert.ok(p.skillCd < cd0 - 0.8, 'CD未递减');
});

// ============================================================
// 10.5 新角色 / 新地图 / 随机监管者 / AI优化
// ============================================================
test('角色: 求生者8名+监管者4名, 新角色数据齐备', function () {
  assert.strictEqual(SURVIVORS.length, 8, '求生者应8名');
  assert.strictEqual(HUNTERS.length, 4, '监管者应4名');
  const quo = getSurvivor('quo');
  assert.ok(quo && quo.active.type === 'warp', '占卜师技能缺失');
  const art = getSurvivor('art');
  assert.ok(art && art.active.type === 'repair', '工匠技能缺失');
  const cage = getHunter('hun_cage');
  assert.ok(cage && cage.active.type === 'trap' && cage.active2, '陷阱师技能缺失');
  const heavy = getHunter('hun_heavy');
  assert.ok(heavy && heavy.active.type === 'quake' && heavy.active2, '重锤技能缺失');
});

test('地图: 共6张地图且全部连通', function () {
  assert.strictEqual(MAPS.length, 6, '应6张地图');
  for (let i = 0; i < MAPS.length; i++) {
    const m = parseMap(MAPS[i]);
    assert.ok(mapConnectivity(m).ok, MAPS[i].name + ' 不连通');
  }
});

test('技能: 星语占卜师命运闪回(warp)闪现', function () {
  const g = fresh(0, { charId: 'quo' });
  const p = g.player;
  p.moveX = 1; p.moveY = 0;
  const x0 = p.x, y0 = p.y;
  g.useSurvivorSkill(p);
  assert.ok(Math.abs(p.x - x0) + Math.abs(p.y - y0) > 60, '未闪现距离不足');
  assert.ok(p.skillCd > 0, '未进入CD');
});

test('技能: 钟楼工匠应急零件(repair)注入进度', function () {
  const g = fresh(0, { charId: 'art' });
  const p = g.player;
  const m = findMachine(g, 0);
  const before = m.progress;
  g.useSurvivorSkill(p);
  assert.ok(m.progress > before, '未增加进度');
});

test('技能: 缚骨陷阱师铁笼陷阱(trap)踩中定身', function () {
  const g = fresh(0, { hunterId: 'hun_cage' });
  const h = g.hunter;
  putAt(h, 400, 400); h.dir = 0; h.stunT = 0;
  g.useHunterSkill(h, 1);
  assert.strictEqual(h.traps.length, 1, '未放置陷阱');
  const tp = h.traps[0];
  const s = g.survivors[0];
  putAt(s, tp.x + 4, tp.y);
  for (let i = 0; i < 6; i++) step(g, 1 / 30);
  assert.ok(s.stunT > 0, '踩中未定身');
});

test('技能: 碎骨重锤震荡波(quake)击晕面前求生者', function () {
  const g = fresh(0, { hunterId: 'hun_heavy' });
  const h = g.hunter, s = g.survivors[0];
  putAt(h, 400, 400); putAt(s, 400 + 60, 400);
  h.dir = 0; h.stunT = 0;
  g.useHunterSkill(h, 1);
  assert.ok(s.stunT > 0, '未击晕');
});

test('被动: 枷锁牢笼/碎骨之击命中减速', function () {
  let g = fresh(0, { hunterId: 'hun_cage' });
  let h = g.hunter, s = g.survivors[0];
  putAt(h, 400, 400); putAt(s, 400 + 20, 400);
  h.dir = 0; h.atkCd = 0; h.wipeT = 0;
  g.hunterAttack(h);
  assert.ok(s.hitSlowT > 0 && Math.abs(s.hitSlowMul - 0.75) < 0.01, '枷锁减速未生效');
  g = fresh(0, { hunterId: 'hun_heavy' });
  h = g.hunter; s = g.survivors[0];
  putAt(h, 400, 400); putAt(s, 400 + 20, 400);
  h.dir = 0; h.atkCd = 0; h.wipeT = 0;
  g.hunterAttack(h);
  assert.ok(s.hitSlowT > 0 && Math.abs(s.hitSlowMul - 0.88) < 0.01, '碎骨减速未生效');
});

test('求生者对局: AI监管者从全部监管者中随机', function () {
  const ids = HUNTERS.map(function (x) { return x.id; });
  const seen = {};
  for (let i = 0; i < 60; i++) {
    const g2 = new Game();
    g2.startMatch({ mapIdx: 0, difficulty: 'normal', asHunter: false });
    assert.ok(ids.indexOf(g2.hunter.id) >= 0, '监管者非法: ' + g2.hunter.id);
    seen[g2.hunter.id] = 1;
  }
  assert.ok(Object.keys(seen).length >= 2, '随机性不足, 仅见: ' + Object.keys(seen).join(','));
});

test('AI优化: chooseMachine 跳过已被其他AI占用的机器', function () {
  const g = fresh(0);
  const a1 = g.survivors[1], a2 = g.survivors[2];
  assert.ok(a1.ai && a2.ai, 'AI队友不存在');
  const m1 = g.nearestMachine(a2.x, a2.y, true);
  a2.decoding = m1;
  const chosen = a1.ai.chooseMachine(a1);
  if (g.machines.length > 1) {
    assert.notStrictEqual(chosen, m1, '未避开已占用机器');
  }
  a2.decoding = null;
});

// ============================================================
// 11. AI 状态机
// ============================================================
test('监管者AI: 视野内发现→追击, 丢失→搜索', function () {
  const g = fresh(0);
  const h = g.hunter;
  const s = g.survivors[1];
  putAt(g.survivors[0], 9999, 9999); putAt(g.survivors[2], 9999, 9999);
  // 放在监管者正前方 160px 且无遮挡
  putAt(s, h.x + 160, h.y);
  h.dir = 0;
  h.ai.active = true;
  const vis = g.perceiveSurvivors(h);
  assert.ok(vis.length > 0, '应能感知到求生者');
  h.ai.update(0.1);
  assert.strictEqual(h.state, 'chase', '应进入追击');
  // 丢失目标：所有求生者远离
  putAt(s, 9999, 9999);
  h.state = 'chase'; h.target = null; h.lastSeen = { x: h.x + 500, y: h.y }; h.lostT = 4.6;
  h.ai.update(1.0);
  assert.strictEqual(h.state, 'search', '丢失后应进入搜索');
});

test('求生者AI: 靠近密码机自动修机', function () {
  const g = fresh(0);
  const s = g.survivors[1];
  const m = findMachine(g, 0);
  putAt(s, m.x - 15, m.y);
  s.ai.update(0.1);
  assert.strictEqual(s.decoding, m, 'AI应开始修机');
  const before = m.progress;
  for (let i = 0; i < 30; i++) step(g, 1 / 30);
  assert.ok(m.progress > before, 'AI修机应有进度');
});

test('监管者AI: 搬运中自动前往处刑架挂人', function () {
  const g = fresh(0);
  const p = g.player;
  const h = g.hunter;
  p.hp = 0;
  putAt(h, p.x + 10, p.y);
  g.hunterInteract(h);
  assert.strictEqual(h.carrying, p, '应被牵制');
  h.ai.active = true;
  for (let i = 0; i < 600; i++) step(g, 1 / 30); // 最多20s
  assert.ok(!h.carrying || h.state === 'guard' || p.chair, 'AI应完成挂椅(可能中途被挣脱或上椅)');
});

test('监管者玩家: 关闭AI并按输入方向移动', function () {
  const g = fresh(0, { asHunter: true });
  const h = g.hunter;
  assert.strictEqual(g.player, h, '玩家应指向监管者');
  assert.strictEqual(h.isPlayer, true, '监管者应标记为玩家');
  assert.strictEqual(h.isAI, false, '玩家监管者不应标记为AI');
  assert.strictEqual(h.ai.active, false, '玩家监管者AI应关闭');

  let cell = null;
  outer:
  for (let y = 1; y < g.rows - 1; y++) for (let x = 1; x < g.cols - 2; x++) {
    const cx = x * g.ts + g.ts / 2, cy = y * g.ts + g.ts / 2;
    if (passableAt(g, cx, cy) && passableAt(g, cx + g.ts, cy)) { cell = { x: cx, y: cy }; break outer; }
  }
  assert.ok(cell, '找不到可向右移动的开放格');
  putAt(h, cell.x, cell.y);
  const before = h.x;
  for (let i = 0; i < 10; i++) step(g, 1 / 30, { x: 1 });
  assert.ok(h.x > before, '监管者应按玩家输入向右移动');
});

test('监管者玩家: 攻击与交互输入互不混淆', function () {
  const g = fresh(0, { asHunter: true });
  const h = g.hunter;
  const s = g.survivors[0];
  s.ai = null;
  putAt(s, h.x + 20, h.y);
  h.dir = 0;
  h.atkCd = 0;
  step(g, 1 / 60, { attack: true });
  assert.strictEqual(s.hp, 1, '攻击输入应命中近处求生者');
  step(g, 1 / 60);

  s.hp = 0;
  h.carrying = null;
  h.atkCd = 0;
  h.wipeT = 0; // 结束擦刀
  putAt(s, h.x + 20, h.y);
  step(g, 1 / 60, { interact: true });
  assert.strictEqual(h.carrying, s, '交互输入应牵制倒地求生者');
  assert.strictEqual(s.hp, 0, '交互输入不应触发攻击');
});

// ============================================================
// 11b. AI 翻越：窗 / 倒板
// ============================================================
test('AI监管者: 经窗追击翻越到对侧且路径清理', function () {
  // 自定义地图：窗是上下两区唯一通道
  const grid = [
    '##########',
    '#S......H#',
    '#........#',
    '####W#####',
    '#........#',
    '####P#####',
    '#........#',
    '#.......M#',
    '##########'
  ];
  const g = freshCustom(grid);
  const ts = g.ts;
  const h = g.hunter;
  const w = g.windows[0];
  // 求生者全部移开并关闭AI，避免感知/救援干扰
  for (const s of g.survivors) { s.ai = null; putAt(s, 9999, 9999); }
  // 监管者放在窗上方
  putAt(h, w.x, w.y - ts);
  const goal = { x: w.x, y: w.y + ts };
  // 默认 pathTo 不经过窗(窗是唯一通道，应无路)
  const pDefault = g.pathTo(h.x, h.y, goal.x, goal.y);
  assert.ok(!pDefault.some(function (p) { return Math.floor(p.x / ts) === w.tx && Math.floor(p.y / ts) === w.ty; }), '默认路径不应经过窗');
  // 开启 win 后路径应含窗节点
  h.path = g.pathTo(h.x, h.y, goal.x, goal.y, { win: true });
  assert.ok(h.path.length > 1, '路径为空');
  const hasWin = h.path.some(function (p) { return Math.floor(p.x / ts) === w.tx && Math.floor(p.y / ts) === w.ty; });
  assert.ok(hasWin, '路径应包含窗节点');
  // 开启 AI 并推进
  h.ai.active = true;
  h.ai.thinkT = 10; // 保持手动路径，避免巡逻重算
  let sawVault = false;
  for (let i = 0; i < 180; i++) {
    step(g, 1 / 30);
    if (h.vaultT > 0) sawVault = true;
    if (sawVault && h.vaultT <= 0) break;
  }
  assert.ok(sawVault, '监管者应翻窗');
  assert.strictEqual(h.vaultT <= 0, true, 'vaultT 应归零');
  // 位于窗对侧(下方)
  assert.ok(h.y > w.y, '监管者应位于窗对侧');
  // 路径不再含窗节点
  const hasWinAfter = h.path.some(function (p) { return Math.floor(p.x / ts) === w.tx && Math.floor(p.y / ts) === w.ty; });
  assert.strictEqual(hasWinAfter, false, '翻越后路径不应再含窗节点');
});

test('AI求生者: 经倒板翻越到对侧且不回头', function () {
  const grid = [
    '##########',
    '#S......H#',
    '#........#',
    '####W#####',
    '#........#',
    '####P#####',
    '#........#',
    '#.......M#',
    '##########'
  ];
  const g = freshCustom(grid);
  const ts = g.ts;
  const s = g.survivors[1]; // AI 求生者
  const pal = g.pallets[0];
  // 监管者移开并关闭AI，其他求生者移开
  g.hunter.ai.active = false; putAt(g.hunter, 9999, 9999);
  g.survivors[0].ai = null; putAt(g.survivors[0], 9999, 9999);
  g.survivors[2].ai = null; putAt(g.survivors[2], 9999, 9999);
  // 求生者站上板格并放下板(略偏上，确保被推到板上方一侧)
  putAt(s, pal.x, pal.y - 5);
  g.survivorInteract(s);
  assert.strictEqual(pal.down, true, '板子应放下');
  const axis = pal.axis === 'vertical' ? 'vertical' : 'horizontal';
  const start = g._palletSide(s, pal, axis);
  putAt(s, start.x, start.y);
  // 目标：板对侧(下方)的密码机
  const m = g.machines[0];
  assert.ok(m.y > pal.y, '密码机应在板对侧');
  // 默认 pathTo 不经过倒板(倒板是唯一通道，应无路)
  const pDefault = g.pathTo(s.x, s.y, m.x, m.y);
  assert.ok(!pDefault.some(function (p) { return Math.floor(p.x / ts) === pal.tx && Math.floor(p.y / ts) === pal.ty; }), '默认路径不应经过倒板');
  // 开启 win+pal 后路径应含倒板节点
  s.path = g.pathTo(s.x, s.y, m.x, m.y, { win: true, pal: true });
  assert.ok(s.path.length > 1, '路径为空');
  const hasPal = s.path.some(function (p) { return Math.floor(p.x / ts) === pal.tx && Math.floor(p.y / ts) === pal.ty; });
  assert.ok(hasPal, '路径应包含倒板节点');
  // 推进：AI 应沿路径翻越倒板
  let sawVault = false;
  for (let i = 0; i < 180; i++) {
    step(g, 1 / 30);
    if (s.vaultT > 0) sawVault = true;
    if (sawVault && s.vaultT <= 0) break;
  }
  assert.ok(sawVault, '求生者应翻越倒板');
  assert.strictEqual(s.vaultT <= 0, true, 'vaultT 应归零');
  // 位于板对侧
  const afterSide = g._whichSide(s, pal, axis);
  const startSide = g._whichSide({ x: start.x, y: start.y }, pal, axis);
  assert.notStrictEqual(afterSide, startSide, '求生者应位于板对侧');
  // 不会卡在板前/回头：再走若干帧，位置不应回到板另一侧
  for (let i = 0; i < 60; i++) step(g, 1 / 30);
  const curSide = g._whichSide(s, pal, axis);
  assert.strictEqual(curSide, afterSide, '求生者不应回到板另一侧');
});

// ============================================================
// 12. 全局模拟：AI 对 AI 完整对局不崩溃
// ============================================================
test('模拟: 扮演监管者 60s 全AI对局不崩溃', function () {
  const g = fresh(0, { asHunter: true, difficulty: 'normal' });
  g.player = null;
  g.playerIsHunter = false;
  g.hunter.isPlayer = false;
  g.hunter.isAI = true;
  g.hunter.ai.active = true;
  for (let i = 0; i < 60 * 30; i++) {
    step(g, 1 / 30);
    if (g.state !== 'playing') break;
  }
  assert.ok(['playing', 'over', 'paused'].indexOf(g.state) >= 0, '状态异常');
});

test('模拟: 扮演求生者 60s AI监管者追击不崩溃', function () {
  const g = fresh(0, { asHunter: false, charId: 'run', difficulty: 'normal' });
  for (let i = 0; i < 60 * 30; i++) {
    step(g, 1 / 30);
    if (g.state !== 'playing') break;
  }
  assert.ok(['playing', 'over', 'paused'].indexOf(g.state) >= 0, '状态异常');
});

// ============================================================
// 汇总
// ============================================================
console.log('========================================');
console.log('  黎明迷局 · 核心逻辑自测报告');
console.log('========================================');
results.forEach(function (r) { console.log('  ' + r); });
console.log('----------------------------------------');
console.log('通过 ' + passed + ' / ' + (passed + failed) + '  失败 ' + failed);
if (failed > 0) process.exit(1);
else console.log('ALL TESTS PASSED ✓');
