const path = require('path');
const E = require(path.join(__dirname, '..', 'engine.js'));
let passed = 0, failed = 0;
function ok(c, m) { if (c) { passed++; console.log('  PASS  ' + m); } else { failed++; console.error('  FAIL  ' + m); } }

// 基础：跳跃物理
{
  const s = E.newGame();
  let ev = E.update(s, { jump: true }, 1 / 60);
  console.log('== 跳跃 ==');
  ok(s.player.airborne, '按下跳跃后进入空中');
  ok(ev.some(e => e.type === 'jump'), '发出 jump 事件');
  let landed = false;
  for (let i = 0; i < 300 && !s.player.airborne; i++) { if (i===0) continue; E.update(s, {}, 1/60); }
  // 继续模拟直到落地
  for (let i = 0; i < 200; i++) { E.update(s, {}, 1 / 60); }
  ok(!s.player.airborne && Math.abs(s.player.y - (E.cfg.groundY - E.cfg.actorH)) < 0.5, '跳起后自然落地');
}
// 二段跳
{
  const s = E.newGame();
  E.update(s, { jump: true }, 1/60);
  E.update(s, {}, 5/60);
  const ev = E.update(s, { jump: true }, 1/60);
  ok(ev.some(e => e.type === 'jump' && e.dbl), '空中二段跳发出 dbl 事件');
  E.update(s, { jump: true }, 1/60); // 第三次不会连续
  ok(s.player.jumps === 0, '二段跳后 jumps 归零');
}
// 滑铲
{
  const s = E.newGame();
  const ev = E.update(s, { slide: true }, 1/60);
  ok(ev.some(e => e.type === 'slide'), '滑铲事件');
  ok(s.player.sliding > 0, '滑铲状态开启');
  E.update(s, {}, 1); // 1秒后
  ok(s.player.sliding <= 0, '滑铲结束后恢复');
}
// 滑铲冷却：跳后立即滑不可行
{
  const s = E.newGame();
  E.update(s, { jump: true }, 1/60);
  const ev = E.update(s, { slide: true }, 1/60);
  ok(!ev.some(e => e.type === 'slide'), '空中不能滑铲（双键约束：跳与滑互斥）');
}
// 滑铲碰撞盒贴地，可从悬空横梁下方通过
{
  const s = E.newGame();
  s.obstacles.push({ x: E.cfg.playerX + 5, type: 'high', w: 36,
    solidTop: E.cfg.groundY - 92, solidBottom: E.cfg.groundY - E.cfg.slideH,
    passed: false, hit: false });
  const ev = E.update(s, { slide: true }, 1 / 60);
  ok(!ev.some(e => e.type === 'hit'), '滑铲可通过高障碍');
}
// 撞障碍掉速
{
  const s = E.newGame();
  s.player.y = E.cfg.groundY - E.cfg.actorH;
  // 手动放置一个障碍在玩家正前方
  s.obstacles.push({ x: E.cfg.playerX, type: 'low', w: 36, solidTop: E.cfg.groundY - 46, solidBottom: E.cfg.groundY, passed: false });
  const ev = E.update(s, {}, 1/60);
  ok(ev.some(e => e.type === 'hit'), '正前方低坎碰撞发出 hit 事件');
  ok(s.speed < E.cfg.baseSpeed, '被撞后速度下降');
  ok(s.player.invuln > 0, '被撞后进入无敌帧');
}
// 高速帧也不能从障碍中穿过
{
  const s = E.newGame();
  s.speed = E.cfg.maxSpeed;
  s.obstacles.push({ x: E.cfg.playerX + 60, type: 'low', w: 36,
    solidTop: E.cfg.groundY - 46, solidBottom: E.cfg.groundY,
    passed: false, hit: false });
  const ev = E.update(s, {}, 0.05);
  ok(ev.some(e => e.type === 'hit'), '高速移动仍能检测水平重叠');
}
// 护盾抵消
{
  const s = E.newGame();
  s.player.shield = 1;
  s.obstacles.push({ x: E.cfg.playerX, type: 'low', w: 36, solidTop: E.cfg.groundY - 46, solidBottom: E.cfg.groundY, passed: false });
  const ev = E.update(s, {}, 1/60);
  ok(ev.some(e => e.type === 'shieldBreak'), '护盾消耗发出 shieldBreak 事件');
  ok(s.player.shield === 0 && s.speed === E.cfg.baseSpeed, '护盾抵消不掉速');
}
// 极限闪避：跳过时擦顶（障碍从前方自然滚动至经过玩家）
{
  const s = E.newGame();
  // 玩家空中浮在低坎顶高度（跃起状态跨越障碍）
  s.player.y = E.cfg.groundY - 46 - E.cfg.actorH - 8;
  s.player.airborne = true;
  s.player.vy = -100;
  s.obstacles.push({ x: E.cfg.playerX + 10, type: 'low', w: 36, solidTop: E.cfg.groundY - 46, solidBottom: E.cfg.groundY, passed: false, hit: false });
  let near = false;
  for (let f = 0; f < 60 && !near; f++) {
    const ev = E.update(s, {}, 1 / 60);
    near = ev.some(e => e.type === 'nearMiss');
  }
  ok(near, '擦身通过发出 nearMiss 事件');
  ok(s.combo === 1, '连击累计 1');
}
// 撞过的障碍不能在离开画面时补算极限闪避
{
  const s = E.newGame();
  s.obstacles.push({ x: E.cfg.playerX, type: 'low', w: 36,
    solidTop: E.cfg.groundY - 46, solidBottom: E.cfg.groundY,
    passed: false, hit: false });
  let near = false;
  for (let i = 0; i < 30; i++) {
    const ev = E.update(s, {}, 1 / 60);
    near = near || ev.some(e => e.type === 'nearMiss');
  }
  ok(!near && s.nearMiss === 0, '碰撞后不误算极限闪避');
}
// 距离本身计入分数
{
  const s = E.newGame();
  E.update(s, {}, 0.2);
  ok(s.score === Math.floor(s.dist) && s.score > 0, '跑动距离持续增加分数');
}
// 提速分档
{
  const s = E.newGame();
  s.dist = 500; // 250m 一档 → 2 档
  const t = E.tierFor(s);
  ok(t.tier === 2 && t.speed === E.cfg.baseSpeed + 2 * E.cfg.accelPer100m, '500m 分档：tier=2, 提速2次');
}
// 时间同样推动难度，且高难度障碍间隔更短
{
  const timed = E.newGame();
  timed.time = 48;
  ok(E.tierFor(timed).tier === 2, '存活48秒提升到 tier=2');
  const easy = E.newGame();
  const hard = E.newGame();
  easy.speed = hard.speed = 500;
  hard.time = 144;
  const oldRandom = Math.random;
  Math.random = () => 0.5;
  const easyGap = E.intervalFor(easy), hardGap = E.intervalFor(hard);
  Math.random = oldRandom;
  ok(hardGap < easyGap, '难度提升后障碍生成间隔缩短');
  ok(E.dangerTimeFor(8) < E.dangerTimeFor(0), '难度提升后逃脱窗口缩短');
}
// 追击按周期启动，不依赖逐帧随机命中
{
  const s = E.newGame();
  s.chaser.nextBurst = 0.01;
  const before = s.chaser.gap;
  const ev = E.update(s, {}, 0.02);
  ok(s.chaser.burst > 0 && s.chaser.gap < before, '追击计时结束后必定启动并逼近');
  ok(ev.some(e => e.type === 'chase' && e.burst), '周期追击发出 burst chase 事件');
}
// 远距离普通动作不能提前终止追击
{
  const s = E.newGame();
  s.chaser.gap = E.cfg.gapDanger + 200;
  s.chaser.burst = 3;
  s.chaser.burstMax = 4;
  const ev = E.update(s, { jump: true }, 1 / 60);
  ok(s.chaser.burst > 0, '危险区外跳跃不会终止追击爆发');
  ok(!ev.some(e => e.type === 'escape'), '危险区外动作不触发 escape');
}
// 追击者：爆发逼近触发 danger，3秒内无动作被抓
{
  const s = E.newGame();
  s.chaser.gap = E.cfg.gapDanger + 10;
  s.chaser.burst = 5;
  s.speed = E.cfg.baseSpeed;
  s.dist = 0;
  // 用真实随机旺——但保证会爆发逼近；直接手动让 gap 低于阈值
  s.chaser.gap = E.cfg.gapDanger - 5;
  let caught = false;
  for (let i = 0; i < 400; i++) { // 4秒
    const ev = E.update(s, {}, 1/60);
    if (ev.some(e => e.type === 'caught')) { caught = true; break; }
  }
  ok(caught, '贴脸持续3秒后被捕获');
  ok(s.over === 'caught', 'gameover 原因为 caught');
}
// 动作推回：跳跃可挣脱
{
  const s = E.newGame();
  s.chaser.gap = E.cfg.gapDanger - 5;
  s.chaser.burst = 5; // 保持爆发
  s.dangerLeft = E.cfg.dangerTime;
  const ev = E.update(s, { jump: true }, 1/60);
  ok(ev.some(e => e.type === 'escape'), '贴脸时跳跃可触发 escape');
  ok(s.chaser.gap > E.cfg.gapDanger, '跳跃后 gap 回到安全区');
  ok(!s.gameOver, '未被捕获');
}
// 无效第三跳不能刷新危险倒计时或甩开追击者
{
  const s = E.newGame();
  s.player.airborne = true;
  s.player.jumps = 0;
  s.chaser.gap = E.cfg.gapDanger - 5;
  s.chaser.burst = 5;
  const ev = E.update(s, { jump: true }, 1 / 60);
  ok(!ev.some(e => e.type === 'escape'), '无效第三跳不触发 escape');
  ok(s.chaser.dangerLeft < E.cfg.dangerTime, '无效动作不重置危险倒计时');
}
// endGame
{
  const s = E.newGame();
  E.endGame(s, 'quit');
  ok(s.gameOver && s.over === 'quit', 'endGame 可主动结算');
}
// 道具
{
  const s = E.newGame();
  s.pickups.push({ x: E.cfg.playerX, y: E.cfg.groundY - 34, kind: 'magnet' });
  let got = false;
  for (let f = 0; f < 30 && !got; f++) {
    const ev = E.update(s, {}, 1 / 60);
    got = ev.some(e => e.type === 'magnet');
  }
  ok(got, '拾取磁石发 magnet 事件');
  ok(s.player.magnet > 0, '磁石状态开启');
}
// 正常跑动会生成规则中承诺的道具
{
  const s = E.newGame();
  s.chaser.gap = 10000;
  let spawned = false;
  for (let f = 0; f < 600 && !spawned; f++) {
    const ev = E.update(s, {}, 1 / 60);
    spawned = s.pickups.length > 0 || ev.some(e => e.type === 'magnet' || e.type === 'shield');
  }
  ok(spawned, '跑动过程中会自然生成道具');
}

/* ==================== 丰富版新增测试 ==================== */
const M = require(path.join(__dirname, '..', 'meta.js'));
const P2 = Math.PI / 2;
const NY = E.cfg.groundY - E.cfg.actorH;

// ---- 新障碍：移动梁（lift<0 梁高可滑铲，lift>0 梁低须跳跃） ----
{
  console.log('== 移动梁 moving ==');
  const s = E.newGame();
  s.obstacles.push({ x: E.cfg.playerX, type: 'moving', w: 40, phase: -P2, freq: 2.0, amp: 20, h: 58, passed: false, hit: false });
  E.update(s, {}, 0); // 触发相位刷新
  ok(s.obstacles[0].solidBottom <= E.cfg.groundY - E.cfg.slideH, '梁高相位下滑铲高度可通过(lift<0)');
  const s2 = E.newGame();
  s2.obstacles.push({ x: E.cfg.playerX, type: 'moving', w: 40, phase: -P2, freq: 2.0, amp: 20, h: 58, passed: false, hit: false });
  const ev2 = E.update(s2, { slide: true }, 1 / 60);
  ok(!ev2.some(e => e.type === 'hit'), '梁高时滑铲可通过移动梁');
  const s3 = E.newGame();
  s3.obstacles.push({ x: E.cfg.playerX, type: 'moving', w: 40, phase: -P2, freq: 2.0, amp: 20, h: 58, passed: false, hit: false });
  const ev3 = E.update(s3, {}, 1 / 60);
  ok(ev3.some(e => e.type === 'hit'), '梁高时站立撞移动梁');
  const s4 = E.newGame();
  s4.player.y = NY - 90; s4.player.airborne = true; // 提前跳至空中
  s4.obstacles.push({ x: E.cfg.playerX, type: 'moving', w: 40, phase: P2, freq: 2.0, amp: 20, h: 58, passed: false, hit: false });
  const ev4 = E.update(s4, {}, 1 / 60);
  ok(!ev4.some(e => e.type === 'hit'), '梁低时跳跃可通过移动梁');
}

// ---- 新障碍：地面裂缝（必须跳） ----
{
  console.log('== 地面裂缝 gap ==');
  const s = E.newGame();
  s.obstacles.push({ x: E.cfg.playerX, type: 'gap', w: 70, solidTop: E.cfg.groundY - 8, solidBottom: E.cfg.groundY + 60, passed: false, hit: false });
  const ev = E.update(s, {}, 1 / 60);
  ok(ev.some(e => e.type === 'hit'), '站立滑过裂缝被判定坠入(hit)');
  const s2 = E.newGame();
  s2.obstacles.push({ x: E.cfg.playerX, type: 'gap', w: 70, solidTop: E.cfg.groundY - 8, solidBottom: E.cfg.groundY + 60, passed: false, hit: false });
  const ev2 = E.update(s2, { jump: true }, 1 / 60);
  ok(!ev2.some(e => e.type === 'hit'), '跳跃可越过裂缝');
}

// ---- 新障碍：空翻倒刺（需精确高跳，站立/滑铲必撞） ----
{
  console.log('== 空翻倒刺 spike ==');
  const s = E.newGame();
  s.obstacles.push({ x: E.cfg.playerX, type: 'spike', w: 34, solidTop: E.cfg.groundY - 96, solidBottom: E.cfg.groundY, passed: false, hit: false });
  const ev = E.update(s, {}, 1 / 60);
  ok(ev.some(e => e.type === 'hit'), '站立撞倒刺');
  const s2 = E.newGame();
  s2.obstacles.push({ x: E.cfg.playerX, type: 'spike', w: 34, solidTop: E.cfg.groundY - 96, solidBottom: E.cfg.groundY, passed: false, hit: false });
  const ev2 = E.update(s2, { slide: true }, 1 / 60);
  ok(ev2.some(e => e.type === 'hit'), '滑铲撞倒刺');
  const s3 = E.newGame();
  s3.player.y = NY - 100; s3.player.airborne = true; // 高空中
  s3.obstacles.push({ x: E.cfg.playerX, type: 'spike', w: 34, solidTop: E.cfg.groundY - 96, solidBottom: E.cfg.groundY, passed: false, hit: false });
  const ev3 = E.update(s3, {}, 1 / 60);
  ok(!ev3.some(e => e.type === 'hit'), '跳至足够高可从倒刺上方通过');
}

// ---- 新障碍：尖刺双联（连续跳，只跳一次撞第二个） ----
{
  console.log('== 尖刺双联 double ==');
  const s = E.newGame();
  s.obstacles.push({ x: E.cfg.playerX + 150, type: 'low', w: 36, solidTop: E.cfg.groundY - 46, solidBottom: E.cfg.groundY, passed: false, hit: false });
  s.obstacles.push({ x: E.cfg.playerX + 270, type: 'low', w: 36, solidTop: E.cfg.groundY - 46, solidBottom: E.cfg.groundY, passed: false, hit: false });
  E.update(s, { jump: true }, 1 / 60); // 提前跳，跳过第一个
  let secondHit = false;
  for (let f = 0; f < 50 && !secondHit; f++) {
    const e2 = E.update(s, {}, 1 / 60);
    secondHit = e2.some(e => e.type === 'hit');
  }
  ok(secondHit, '只跳一次会撞上第二个低坎');
  const s2 = E.newGame();
  s2.obstacles.push({ x: E.cfg.playerX, type: 'low', w: 36, solidTop: E.cfg.groundY - 46, solidBottom: E.cfg.groundY, passed: false, hit: false });
  s2.obstacles.push({ x: E.cfg.playerX + 120, type: 'low', w: 36, solidTop: E.cfg.groundY - 46, solidBottom: E.cfg.groundY, passed: false, hit: false });
  let firstHit = false;
  for (let f = 0; f < 30 && !firstHit; f++) {
    const e2 = E.update(s2, {}, 1 / 60);
    firstHit = e2.some(e => e.type === 'hit');
  }
  ok(firstHit, '站立时尖刺双联必撞');
}

// ---- 新障碍：复合墙（跳-滑连招） ----
{
  console.log('== 复合墙 combo ==');
  const s = E.newGame();
  s.obstacles.push({ x: E.cfg.playerX + 100, type: 'low', w: 36, solidTop: E.cfg.groundY - 46, solidBottom: E.cfg.groundY, passed: false, hit: false });
  s.obstacles.push({ x: E.cfg.playerX + 300, type: 'high', w: 36, solidTop: E.cfg.groundY - 92, solidBottom: E.cfg.groundY - E.cfg.slideH, passed: false, hit: false });
  E.update(s, { jump: true }, 1 / 60); // 提前跳低坎
  let landed = false;
  for (let f = 0; f < 80 && !landed; f++) { const e2 = E.update(s, {}, 1 / 60); landed = e2.some(e => e.type === 'land'); }
  const ev = E.update(s, { slide: true }, 1 / 60); // 落地后滑铲过梁
  ok(!ev.some(e => e.type === 'hit'), '跳-滑连招可全过复合墙');
  const s2 = E.newGame();
  s2.obstacles.push({ x: E.cfg.playerX + 100, type: 'low', w: 36, solidTop: E.cfg.groundY - 46, solidBottom: E.cfg.groundY, passed: false, hit: false });
  s2.obstacles.push({ x: E.cfg.playerX + 300, type: 'high', w: 36, solidTop: E.cfg.groundY - 92, solidBottom: E.cfg.groundY - E.cfg.slideH, passed: false, hit: false });
  E.update(s2, { jump: true }, 1 / 60);
  let hit2 = false;
  for (let f = 0; f < 90 && !hit2; f++) { const e2 = E.update(s2, {}, 1 / 60); hit2 = e2.some(e => e.type === 'hit'); }
  ok(hit2, '只跳不滑铲会撞上复合墙的梁');
}

// ---- 追击者形态解锁 ----
{
  console.log('== 追击者形态 ==');
  ok(E.chaserKindAt(0) === 'beast', '0m 为暗影巨兽');
  ok(E.chaserKindAt(299) === 'beast', '299m 仍为巨兽');
  ok(E.chaserKindAt(300) === 'pack', '300m 解锁猎犬群');
  ok(E.chaserKindAt(699) === 'pack', '699m 仍为猎犬群');
  ok(E.chaserKindAt(700) === 'colossus', '700m 解锁战争巨像');
  const pk = E.profileOf('pack', 0), co = E.profileOf('colossus', 0);
  ok(pk.danger === 2.0, '猎犬群挣脱窗口固定 2.0s');
  ok(co.danger === 1.2, '巨像挣脱窗口固定 1.2s');
  ok(pk.burst < E.profileOf('beast', 0).burst, '猎犬群爆发更短更频繁');
  const s = E.newGame();
  s.dist = 299;
  let switched = null;
  for (let f = 0; f < 200 && !switched; f++) {
    const ev = E.update(s, {}, 1 / 60);
    const sw = ev.find(e => e.type === 'chaserSwitch');
    if (sw) switched = sw;
  }
  ok(switched && switched.kind === 'pack' && s.chaser.kind === 'pack', '跨 300m 发 chaserSwitch 并切换形态');
}

// ---- 巨兽狂怒 ----
{
  console.log('== 巨兽狂怒 ==');
  const s = E.newGame();
  s.dist = 499;
  let rageStart = null;
  for (let f = 0; f < 200 && !rageStart; f++) {
    const ev = E.update(s, {}, 1 / 60);
    const rs = ev.find(e => e.type === 'rageStart');
    if (rs) rageStart = rs;
  }
  ok(rageStart && s.rage && s.rage.wavesNeeded === 3, '跨 500m 触发 rageStart(3 波)');
  ok(s.nextRageAt === 1000, '下一次狂怒在 1000m');
  // 三连挣脱（真实玩法：跳 → 二段跳 → 滑铲；这里重置到地面逐次挣脱，验证状态机）
  let cleared = false, scoreBefore = s.score;
  const ground = E.cfg.groundY - E.cfg.actorH;
  for (let w = 0; w < 3 && !cleared; w++) {
    s.player.y = ground; s.player.vy = 0; s.player.airborne = false; s.player.jumps = 1; s.player.sliding = 0;
    s.chaser.gap = E.cfg.gapDanger - 5;
    const ev = E.update(s, { jump: true }, 1 / 60);
    cleared = ev.some(e => e.type === 'rageClear');
    if (w < 2) ok(ev.some(e => e.type === 'rageWave'), '前两波发 rageWave');
  }
  ok(cleared, '连续挣脱 3 次触发 rageClear');
  ok(s.rage === null && s.rageCleared === 1, '狂怒清除且计数 +1');
  ok(s.score >= scoreBefore + E.cfg.rageBonus, '击退狂怒 +500 分');
}

// ---- 狂怒期间金币双倍 ----
{
  const s = E.newGame();
  s.rage = { wave: 0, wavesNeeded: 3 };
  s.coins.push({ x: E.cfg.playerX, y: E.cfg.groundY - 70 });
  const before = s.score;
  E.update(s, {}, 1 / 60);
  ok(s.score - before >= E.cfg.coinScore * 2, '狂怒期间金币分值翻倍');
}

// ---- 被动三选一 ----
{
  console.log('== 被动三选一 ==');
  const s = E.newGame();
  s.passivePending = true;
  ok(E.applyPassive(s, 'turbo') === true && s.player.passive.turbo, '涡轮冲刺应用成功');
  ok(s.passivePending === false && s.passiveList.length === 1, '应用后清除待选状态并记录');
  const s2 = E.newGame(); s2.passivePending = true;
  E.applyPassive(s2, 'doubleShield');
  ok(s2.player.shieldsMax === 3, '双层护盾提升上限到 3');
  const s3 = E.newGame(); s3.passivePending = true;
  E.applyPassive(s3, 'coinDouble');
  s3.coins.push({ x: E.cfg.playerX, y: E.cfg.groundY - 70 });
  const b3 = s3.score;
  E.update(s3, {}, 1 / 60);
  ok(s3.score - b3 >= E.cfg.coinScore * 2, '金币翻倍被动生效');
  const s4 = E.newGame(); s4.passivePending = true;
  E.applyPassive(s4, 'evadeTime');
  E.update(s4, {}, 1 / 60);
  ok(s4.chaser.dangerMax >= E.profileOf('beast', 0).danger + 1, '挣脱窗口被动 +1s');
  const s5 = E.newGame();
  ok(E.applyPassive(s5, 'turbo') === false, '无待选状态时 applyPassive 拒绝');
}

// ---- meta：成就判定 ----
{
  console.log('== 成就判定 ==');
  const byId = {};
  M.ACHS.forEach(a => { byId[a.id] = a; });
  ok(byId.first_run.test({ finished: true }), 'first_run 完成一局');
  ok(byId.dist_500.test({ dist: 500 }) && !byId.dist_500.test({ dist: 499 }), 'dist_500 阈值');
  ok(byId.dist_1000.test({ dist: 1000 }), 'dist_1000');
  ok(byId.dist_3000.test({ dist: 3000 }), 'dist_3000');
  ok(byId.combo_10.test({ bestCombo: 10 }), 'combo_10');
  ok(byId.combo_30.test({ bestCombo: 30 }), 'combo_30');
  ok(byId.near_100.test({}, { near: 100 }), 'near_100 累计');
  ok(byId.coin_1000.test({}, { coins: 1000 }), 'coin_1000 累计');
  ok(byId.all_zones.test({ zone: 5 }), 'all_zones 抵最终防线');
  ok(byId.rage_clear.test({ rageCleared: 1 }), 'rage_clear');
  ok(byId.escape_10.test({}, { runs: 10 }), 'escape_10 累计局数');
  ok(byId.daily_win.test({}, {}, { done: true }) && !byId.daily_win.test({}, {}, { done: false }), 'daily_win 今日完成');
  ok(M.ACHS.length >= 12, '成就总数 ≥ 12');
}

// ---- meta：每日挑战 ----
{
  console.log('== 每日挑战判定 ==');
  const d = M.freshDaily('2026-08-23');
  ok(d.goalId && M.DAILY_GOALS.some(g => g.id === d.goalId), 'freshDaily 生成合法目标');
  ok(d.date === '2026-08-23' && d.done === false, '结构含日期与未完成态');
  const g = M.dailyGoalOf(d);
  const d2 = JSON.parse(JSON.stringify(d));
  d2.prog[g.metric] = g.target;
  ok(M.dailyDone(d2) === true, '进度达目标即完成');
  ok(M.dailyDone(d) === false, '进度未达目标未完成');
  ok(M.hashDay('2026-08-23') !== M.hashDay('2026-08-24'), '跨天目标可不同');
}

console.log('\n' + (failed === 0 ? '通过 ' + passed + ' 项，全部通过' : '通过 ' + passed + ' 项，失败 ' + failed + ' 项'));
process.exit(failed === 0 ? 0 : 1);
