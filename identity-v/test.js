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
const NONE = { x: 0, y: 0, interact: false, skill: false, skill2: false, crouch: false, pause: false };
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
  g.hunterAttack(h); // atkCd 挡
  assert.strictEqual(p.hp, 1, 'CD未到不应再次命中');
  // 强制冷却
  h.atkCd = 0;
  g.hunterAttack(h);
  assert.strictEqual(p.hp, 0, '第二击应倒地');
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
  h.atkCd = 0; g.hunterAttack(h);
  assert.strictEqual(p.hp, 0, '应倒地');
  // 牵制
  putAt(h, p.x + 10, p.y);
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
  h.atkCd = 0; g.hunterAttack(h); h.atkCd = 0; g.hunterAttack(h);
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

test('板子: 放倒阻挡+砸晕, 监管者可破坏', function () {
  const g = fresh(0);
  const p = g.player;
  const h = g.hunter;
  const pal = g.pallets[0];
  putAt(p, pal.x, pal.y);
  putAt(h, pal.x - 6, pal.y);
  g.survivorInteract(p);
  assert.strictEqual(pal.down, true, '板子应放下');
  assert.ok(h.stunT > 0, '板下监管者应被砸晕');
  // 破坏
  h.stunT = 0;
  g.hunterInteract(h);
  assert.strictEqual(pal.down, false, '板子应被破坏');
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

// ============================================================
// 12. 全局模拟：AI 对 AI 完整对局不崩溃
// ============================================================
test('模拟: 扮演监管者 60s 全AI对局不崩溃', function () {
  const g = fresh(0, { asHunter: true, difficulty: 'normal' });
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
