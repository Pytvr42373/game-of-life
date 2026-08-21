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

console.log('\n' + (failed === 0 ? '通过 ' + passed + ' 项，全部通过' : '通过 ' + passed + ' 项，失败 ' + failed + ' 项'));
process.exit(failed === 0 ? 0 : 1);
