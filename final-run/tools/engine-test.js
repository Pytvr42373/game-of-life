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
  s.speed = E.cfg.baseSpeed * E.cfg.speedHigh;
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
  ok(s.player.shield === 0 && s.speed === E.newGame().speed, '护盾抵消不掉速');
}
// 极限闪避：跳过时擦顶（障碍从前方自然滚动至经过玩家）
{
  const s = E.newGame();
  // 玩家悬停在低坎顶上方 8px（擦身窗口内），每帧钉住高度模拟擦身
  s.player.y = E.cfg.groundY - 46 - E.cfg.actorH - 8;
  s.player.airborne = true;
  s.player.vy = 0;
  s.obstacles.push({ x: E.cfg.playerX + 10, type: 'low', w: 36, solidTop: E.cfg.groundY - 46, solidBottom: E.cfg.groundY, passed: false, hit: false });
  let near = false;
  for (let f = 0; f < 60 && !near; f++) {
    s.player.y = E.cfg.groundY - 46 - E.cfg.actorH - 8;
    s.player.vy = 0;
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
// 提速分档（非线性：0.78x → 1.8x，终点速度不变）
{
  const s = E.newGame();
  s.dist = 500; // 100m 一档 → 5 档
  const t = E.tierFor(s);
  ok(t.tier === 5, '500m 分档：tier=5');
  ok(Math.abs(t.speed / E.cfg.baseSpeed - E.speedMultFor(5)) < 0.01, '档位速度 = 基准 × 非线性倍率');
  ok(E.speedMultFor(0) === E.cfg.speedLow, '起始档倍率 = 0.78');
  ok(Math.abs(E.speedMultFor(E.cfg.maxTier) - E.cfg.speedHigh) < 1e-9, '终局档倍率 = 1.8');
  ok(E.speedMultFor(4) - E.speedMultFor(3) > E.speedMultFor(3) - E.speedMultFor(2), '非线性：后段增速更快');
  ok(E.newGame().speed === Math.round(E.cfg.baseSpeed * E.cfg.speedLow), '开局速度 = 旧基准 ×0.78');
  ok(E.cfg.speedLow === 0.6 * 1.3, '初始速度 = 原 0.6 ×1.3');
  ok(E.cfg.speedHigh === 1.8, '终点速度保持 1.8 不变');
}
// 时间同样推动难度，且高难度障碍间隔更短
{
  const timed = E.newGame();
  timed.time = 30;
  ok(E.tierFor(timed).tier === 2, '存活30秒提升到 tier=2');
  const easy = E.newGame();
  const hard = E.newGame();
  easy.speed = hard.speed = 500;
  hard.time = 60;
  const oldRandom = Math.random;
  Math.random = () => 0.5;
  const easyGap = E.intervalFor(easy), hardGap = E.intervalFor(hard);
  Math.random = oldRandom;
  ok(hardGap < easyGap, '难度提升后障碍生成间隔缩短');
  ok(E.dangerTimeFor(8) < E.dangerTimeFor(0), '难度提升后逃脱窗口缩短');
}
// 失误逼近：撞障碍一次追击者靠近
{
  const s = E.newGame();
  s.chaser.gap = 600;
  const before = s.chaser.gap;
  E.registerMistake(s);
  ok(s.chaser.gap < before, '一次失误追击者逼近（gap 减小）');
  ok(s.chaser.gap === before - E.cfg.mistakePush, '逼近距离 = mistakePush');
}
// 近距离再失误 → 进入读条状态
{
  const s = E.newGame();
  s.chaser.gap = E.cfg.gapDanger + 20;
  E.registerMistake(s);
  ok(s.chaser.gap < E.cfg.gapDanger, '失误后进入贴脸区');
  ok(s.readout && s.readout.max === E.cfg.readoutTime, '贴脸区内失误触发读条');
}
// 读条填满 → 被捕获；读条内动作 → 挣脱
{
  const s = E.newGame();
  s.chaser.gap = E.cfg.gapDanger + 20;
  E.registerMistake(s);
  ok(s.readout, '进入读条');
  // 读条填满（不动）
  let caught = false;
  for (let i = 0; i < 400; i++) {
    const ev = E.update(s, {}, 1 / 60);
    if (ev.some(e => e.type === 'caught')) { caught = true; break; }
  }
  ok(caught, '读条填满被捕获');
  ok(s.over === 'caught', 'gameover 原因为 caught');
  // 读条内做动作挣脱
  const s2 = E.newGame();
  s2.chaser.gap = E.cfg.gapDanger + 20;
  E.registerMistake(s2);
  const ev = E.update(s2, { jump: true }, 1 / 60);
  ok(ev.some(e => e.type === 'escape'), '读条内跳跃触发 escape');
  ok(s2.readout === null, '挣脱后读条清空');
  ok(s2.chaser.gap > E.cfg.gapDanger, '挣脱后追击者被推回安全区');
}
// 读条推进：不做动作读条进度持续增加（填满即被捕获）
{
  const s = E.newGame();
  s.chaser.gap = E.cfg.gapDanger + 20;
  E.registerMistake(s);
  const initLeft = s.readout.left;
  E.update(s, {}, 1); // 1秒不动
  ok(s.readout.left > initLeft, '读条不动作会持续推进');
}
// 读条中再失误：读条进度 +50%
{
  const s = E.newGame();
  s.chaser.gap = E.cfg.gapDanger + 20;
  E.registerMistake(s);
  const l0 = s.readout.left;
  E.registerMistake(s);
  ok(s.readout.left > l0, '读条中再失误进度增加');
}
// endGame
{
  const s = E.newGame();
  E.endGame(s, 'quit');
  ok(s.gameOver && s.over === 'quit', 'endGame 可主动结算');
}
// 终点：跑完三幕后自动结算，不再无限延长
{
  const s = E.newGame();
  s.chaser.gap = 10000;
  s.speed = E.cfg.baseSpeed * E.cfg.speedHigh;
  s.dist = E.cfg.finishDist - 0.1;
  let finished = false;
  for (let f = 0; f < 10 && !finished; f++) {
    const ev = E.update(s, {}, 1 / 60);
    finished = ev.some(e => e.type === 'finish');
  }
  ok(finished, '跨过终点发出 finish 事件');
  ok(s.gameOver && s.over === 'finish', '终点结算原因为 finish');
  ok(s.dist === E.cfg.finishDist, '终点距离封顶为 1000m');
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
  ok(E.chaserKindAt(249) === 'beast', '249m 仍为巨兽');
  ok(E.chaserKindAt(250) === 'pack', '250m 解锁猎犬群');
  ok(E.chaserKindAt(599) === 'pack', '599m 仍为猎犬群');
  ok(E.chaserKindAt(600) === 'colossus', '600m 解锁战争巨像');
  ok(E.profileOf('pack', 0).gapSpeed > 0 && E.profileOf('beast', 0).gapSpeed > 0, '形态带跟随速度');
  const s = E.newGame();
  s.dist = 249;
  let switched = null;
  for (let f = 0; f < 200 && !switched; f++) {
    const ev = E.update(s, {}, 1 / 60);
    const sw = ev.find(e => e.type === 'chaserSwitch');
    if (sw) switched = sw;
  }
  ok(switched && switched.kind === 'pack' && s.chaser.kind === 'pack', '跨 250m 发 chaserSwitch 并切换形态');
}

// ---- 巨兽狂怒 ----
{
  console.log('== 巨兽狂怒 ==');
  const s = E.newGame();
  s.dist = 332;
  let rageStart = null;
  for (let f = 0; f < 200 && !rageStart; f++) {
    const ev = E.update(s, {}, 1 / 60);
    const rs = ev.find(e => e.type === 'rageStart');
    if (rs) rageStart = rs;
  }
  ok(rageStart && s.rage && s.rage.wavesNeeded === 2, '跨 333m 触发 rageStart(2 波)');
  ok(s.nextRageAt === 666, '下一次狂怒在 666m');
  ok(s.readout && s.readout.max === E.cfg.readoutTime, '狂怒开启立即进入读条');
  // 两连挣脱（读条内连续动作挣脱，验证状态机）
  let cleared = false, scoreBefore = s.score;
  for (let w = 0; w < 4 && !cleared; w++) {
    if (!s.rage) break;
    const ev = E.update(s, { jump: true }, 1 / 60);
    cleared = ev.some(e => e.type === 'rageClear');
    if (!cleared && s.rage && ev.some(e => e.type === 'rageWave')) { /* wave 1 done */ }
  }
  // 若未直接清空，再触发一次读条并挣脱
  if (s.rage) {
    s.readout = { left: 0, max: E.cfg.readoutTime };
    for (let w = 0; w < 4 && s.rage; w++) {
      const ev = E.update(s, { jump: true }, 1 / 60);
      if (ev.some(e => e.type === 'rageClear')) { cleared = true; break; }
    }
  }
  ok(cleared || s.rageCleared === 1, '连续挣脱 2 次触发 rageClear');
  ok(s.rage === null && s.rageCleared === 1, '狂怒清除且计数 +1');
  ok(s.score >= scoreBefore, '击退狂怒结算分数不倒退');
}

// ---- 狂怒期间金币双倍 ----
{
  const s = E.newGame();
  s.rage = { wave: 0, wavesNeeded: 2 };
  s.coins.push({ x: E.cfg.playerX, y: E.cfg.groundY - 70 });
  const before = s.score;
  E.update(s, {}, 1 / 60);
  ok(s.score - before >= E.cfg.coinScore * 2, '狂怒期间金币分值翻倍');
}

// ---- 无 Rogue 契约：局内被动三选一已完全移除 ----
{
  console.log('== 无 Rogue 契约 ==');
  const s = E.newGame();
  ok(!('passivePending' in s) && !('passiveList' in s) && !('nextPassiveAt' in s), '状态无被动字段');
  ok(!('passive' in s.player), '玩家无被动字段');
  ok(!('passiveStep' in E.cfg), '配置无 passiveStep');
  ok(typeof E.applyPassive === 'undefined', '引擎不再暴露 applyPassive');
  let passiveEv = false;
  for (let f = 0; f < 900; f++) {
    const ev = E.update(s, {}, 1 / 60);
    if (ev.some(e => e.type === 'passiveChoice')) { passiveEv = true; break; }
  }
  ok(!passiveEv, '跑动全程不再发出 passiveChoice 事件');
  const s2 = E.newGame();
  s2.chaser.gap = 10000;
  s2.dist = 399;
  let passiveEv2 = false;
  for (let f = 0; f < 300 && !s2.gameOver; f++) {
    const ev = E.update(s2, {}, 1 / 60);
    if (ev.some(e => e.type === 'passiveChoice')) { passiveEv2 = true; break; }
  }
  ok(!passiveEv2, '跨 400m 不再触发被动选择');
}

// ---- 三幕场景阈值 ----
{
  console.log('== 三幕场景 ==');
  ok(E.cfg.finishDist === 1000, '总程 1000m');
  ok(E.cfg.actStep === 333, '幕距 333m');
  ok(E.actFor(0) === 0 && E.actFor(332) === 0, '0-332m 为第一幕');
  ok(E.actFor(333) === 1 && E.actFor(665) === 1, '333-665m 为第二幕');
  ok(E.actFor(666) === 2 && E.actFor(999) === 2, '666-999m 为第三幕');
  const s = E.newGame();
  s.chaser.gap = 10000;
  s.dist = 332;
  let actEv = null;
  for (let f = 0; f < 400 && !actEv; f++) {
    const ev = E.update(s, {}, 1 / 60);
    const a = ev.find(e => e.type === 'act');
    if (a) actEv = a;
  }
  ok(actEv && actEv.act === 1 && s.act === 1, '跨 333m 发 act 事件进入第二幕');
}

// ---- 碰撞减速平滑恢复 ----
{
  console.log('== 碰撞减速恢复 ==');
  const s = E.newGame();
  s.chaser.gap = 10000;
  s.dist = 500; // tier 5，目标速度较高
  s.nextRageAt = 99999; // 避免测试中触发狂怒
  const target = E.tierFor(s).speed;
  for (let f = 0; f < 150; f++) { s.obstacles = []; s.pickups = []; s.coins = []; E.update(s, {}, 1 / 60); }
  ok(Math.abs(s.speed - target) < 5, '正常跑动速度平滑逼近当前档目标');
  s.player.shield = 0;
  s.obstacles.push({ x: E.cfg.playerX, type: 'low', w: 36, solidTop: E.cfg.groundY - 46, solidBottom: E.cfg.groundY, passed: false, hit: false });
  const ev = E.update(s, {}, 1 / 60);
  ok(ev.some(e => e.type === 'hit'), '碰撞触发 hit');
  const afterHit = s.speed;
  ok(afterHit < target * 0.7, '碰撞后速度骤降');
  let recovered = false;
  for (let f = 0; f < 300 && !recovered; f++) {
    s.obstacles = []; s.pickups = []; s.coins = [];
    E.update(s, {}, 1 / 60);
    if (s.speed >= target - 2) recovered = true;
  }
  ok(recovered, '碰撞减速后平滑恢复到当前档目标速度');
}

// ---- 障碍类型按里程解锁 ----
{
  console.log('== 障碍解锁 ==');
  ok(E.unlockedObstacles(0).length === 0, '0m 无额外障碍');
  ok(E.unlockedObstacles(99).length === 0, '99m 仍无额外障碍');
  ok(E.unlockedObstacles(100).indexOf('moving') >= 0, '100m 解锁移动梁');
  ok(E.unlockedObstacles(200).indexOf('gap') >= 0, '200m 解锁裂缝');
  ok(E.unlockedObstacles(300).indexOf('double') >= 0, '300m 解锁尖刺双联');
  ok(E.unlockedObstacles(500).indexOf('spike') >= 0, '500m 解锁空翻倒刺');
  ok(E.unlockedObstacles(700).indexOf('combo') >= 0, '700m 解锁复合墙');
  ok(E.unlockedObstacles(1000).length === 5, '1000m 全部 5 种额外障碍开放');
  // 生成验证：低里程不出现新类型
  const s = E.newGame();
  s.chaser.gap = 10000;
  const oldRandom = Math.random;
  Math.random = () => 0.05; // 命中 extra 分支
  const types = new Set();
  for (let f = 0; f < 300; f++) { E.update(s, {}, 1 / 60); s.obstacles.forEach(o => types.add(o.type)); }
  Math.random = oldRandom;
  ok(![...types].some(t => ['moving', 'gap', 'double', 'spike', 'combo'].includes(t)), '前 100m 只生成基础障碍');
}

// ---- meta：成就判定 ----
{
  console.log('== 成就判定 ==');
  const byId = {};
  M.ACHS.forEach(a => { byId[a.id] = a; });
  ok(byId.first_run.test({ finished: true }), 'first_run 完成一局');
  ok(byId.dist_500.test({ dist: 300 }) && !byId.dist_500.test({ dist: 299 }), 'dist_500 阈值');
  ok(byId.dist_1000.test({ dist: 600 }), 'dist_1000');
  ok(byId.dist_3000.test({ dist: 1000 }) && !byId.dist_3000.test({ dist: 999 }), 'dist_3000 阈值 1000m');
  ok(byId.combo_10.test({ bestCombo: 10 }), 'combo_10');
  ok(byId.combo_30.test({ bestCombo: 30 }), 'combo_30');
  ok(byId.near_100.test({}, { near: 100 }), 'near_100 累计');
  ok(byId.coin_1000.test({}, { coins: 1000 }), 'coin_1000 累计');
  ok(byId.all_zones.test({ act: 2 }), 'all_zones 抵最终防线');
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

// ---- meta：皮肤按累计开局解锁 ----
{
  console.log('== 皮肤解锁 ==');
  ok(M.SKINS[0].unlockRuns === 0, '默认皮肤 0 局解锁');
  ok(M.SKINS.every(sk => typeof sk.unlockRuns === 'number'), '全部皮肤带解锁门槛');
  ok(M.SKINS[1].unlockRuns > 0 && M.SKINS[2].unlockRuns > M.SKINS[1].unlockRuns, '解锁门槛递增');
  ok(M.SKINS.every(sk => !('price' in sk)), '皮肤不再按金币购买');
  ok(M.ACTS.length === 3, '三幕场景定义');
  ok(M.ACTS[0].name && M.ACTS[1].name && M.ACTS[2].name, '三幕均有名称');
}

console.log('\n' + (failed === 0 ? '通过 ' + passed + ' 项，全部通过' : '通过 ' + passed + ' 项，失败 ' + failed + ' 项'));
process.exit(failed === 0 ? 0 : 1);
