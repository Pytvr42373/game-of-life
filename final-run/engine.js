/* =====================================================================
 * engine.js —— 《终局狂奔》核心逻辑（纯计算，无 DOM 依赖）
 * 横版终局跑酷：跳跃/滑铲躲障碍；追击者贴脸时做动作挣脱，
 * 否则被捕获；提速分档；极限闪避连击；冲刺磁石/护盾道具。
  * v0.4：800m 三幕终局、两次狂怒、非线性提速 0.6x→1.8x，跑完即结算。
 * 事件型 update(state, actions, dt)：返回本帧事件，供 UI 与测试消费。
 * 暴露全局 window.FinalRunEngine；支持 Node require 自检。
 * ===================================================================== */
(function (global) {
  'use strict';

  var cfg = {
    groundY: 460,            // 地面基准线（世界坐标 y）
    playerX: 180,            // 玩家屏幕固定 x
    w: 960, h: 540,
    actorW: 34, actorH: 66, slideH: 28,
    jumpV: 620, jumpV2: 540, gravity: 1900,
    slideDur: 0.75, slideCd: 0.22,
    baseSpeed: 340,            // 旧基准速度：非线性速度曲线的参考值
    gearStep: 100,             // 每 100m 一档
    gearTime: 15,              // 每 15s 一档（时间兜底）
    maxTier: 7,                // 800m 共 8 档（0..7）
    speedLow: 0.6,             // 起始档：旧基准 ×0.6
    speedHigh: 1.8,            // 终局档：旧基准 ×1.8
    pxPerM: 36,                // 距离换算：压缩里程，完整一局约 2 分钟
    finishDist: 800,           // 终点：跑完三幕即胜利
    gapStart: 620, gapDanger: 260, gapBack: 720, dangerTime: 3.0,
    stun: 0.42, invuln: 0.9,
    magnetDur: 2.4, magnetBoost: 0.45,
    evadeGap: 16,             // 极限闪避：竖直缝隙 < 16px 视为擦身
    spawnLead: 1500,          // 前方预生成距离
    coinScore: 30,
    /* —— 三幕终局参数 —— */
    actStep: 300,             // 每 300m 一幕：0/300/600 切换三幕场景
    rageStep: 300,            // 每 300m 一次巨兽狂怒
    rageWaves: 2,             // 狂怒需连续挣脱 2 次
    rageBonus: 300,           // 击退狂怒奖励分
    obstUnlocks: [            // 障碍类型按里程逐步解锁
      { at: 0,   types: [] },
      { at: 100, types: ['moving'] },
      { at: 200, types: ['gap'] },
      { at: 300, types: ['double'] },
      { at: 450, types: ['spike'] },
      { at: 600, types: ['combo'] }
    ],
    chaserKinds: {            // 追击者三形态参数（按距离解锁）
      beast:    { unlock: 0,   burstMin: 3.1, burstMax: 4.4, burstTier: 0.07,
                  danger: 0, dangerMin: 1.5, dangerStep: 0.12,
                  delayMin: 3.8, delayBase: 7.2, delayTier: 0.28,
                  squeeze: 72, gapSpeed: 2.5, scale: 1.0,  label: '暗影巨兽' },
      pack:     { unlock: 160, burstMin: 1.8, burstMax: 2.6, burstTier: 0.05,
                  danger: 2.0,
                  delayMin: 2.2, delayBase: 5.0, delayTier: 0.2,
                  squeeze: 88, gapSpeed: 3.1, scale: 0.5,  label: '猎犬群' },
      colossus: { unlock: 360, burstMin: 5.0, burstMax: 6.4, burstTier: 0.04,
                  danger: 1.2,
                  delayMin: 4.2, delayBase: 8.0, delayTier: 0.2,
                  squeeze: 78, gapSpeed: 2.0, scale: 1.55, label: '战争巨像' }
    }
  };

  /* —— 障碍定义（low 坎/ high 梁 / moving 移动梁 / gap 裂缝 /
   *     spike 空翻倒刺；double/combo 由生成函数展开为多实体） —— */
  var OBST = {
    low:    { w: 36, h: 46 },
    high:   { w: 36, h: 92 },
    moving: { w: 40, h: 58, amp: 20, freq: 2.0 },
    gap:    { w: 70, h: 8 },
    spike:  { w: 34, h: 96 }
  };

  function newGame() {
    return {
      dist: 0, speed: Math.round(cfg.baseSpeed * cfg.speedLow), time: 0,
      player: { y: cfg.groundY - cfg.actorH, vy: 0, airborne: false, jumps: 0,
                sliding: 0, slideCd: 0, stun: 0, invuln: 0, shield: 0, magnet: 0,
                shieldsMax: 2 },
      chaser: { gap: cfg.gapStart, burst: 0, burstMax: 0, nextBurst: 6.5,
                dangerLeft: cfg.dangerTime, dangerMax: cfg.dangerTime, escaped: 0,
                kind: 'beast' },
      obstacles: [], coins: [], pickups: [], spawnCount: 0,
      score: 0, combo: 0, bestCombo: 0, nearMiss: 0,
      coinsGot: 0, rageCleared: 0, act: 0,
      speedTier: 0, gameOver: false, over: null,
      rage: null, nextRageAt: cfg.rageStep
    };
  }

  /* —— 难度档位：非线性提速，每 100m 或每 15s 提升，取进度更快的一项 ——
   * 速度曲线：旧基准 ×(0.6 → 1.8)，幂曲线 1.7 让后段陡升。 */
  function speedMultFor(tier) {
    var p = Math.min(1, tier / cfg.maxTier);
    return cfg.speedLow + (cfg.speedHigh - cfg.speedLow) * Math.pow(p, 1.7);
  }
  function tierFor(s) {
    var distTier = Math.floor(s.dist / cfg.gearStep);
    var timeTier = Math.floor((s.time || 0) / cfg.gearTime);
    var tier = Math.min(cfg.maxTier, Math.max(distTier, timeTier));
    return { speed: Math.round(cfg.baseSpeed * speedMultFor(tier)), tier: tier };
  }

  function dangerTimeFor(tier) {
    return Math.max(1.5, cfg.dangerTime - tier * 0.12);
  }

  function nextBurstDelay(tier) {
    return Math.max(3.8, 7.2 - tier * 0.28) + Math.random() * 1.2;
  }

  /* —— 追击者形态：按距离解锁 —— */
  function chaserKindAt(dist) {
    if (dist >= cfg.chaserKinds.colossus.unlock) return 'colossus';
    if (dist >= cfg.chaserKinds.pack.unlock) return 'pack';
    return 'beast';
  }
  function profileOf(kind, tier) {
    var k = cfg.chaserKinds[kind] || cfg.chaserKinds.beast;
    var danger = k.danger || dangerTimeFor(tier);
    return { burst: Math.max(k.burstMin, k.burstMax - tier * k.burstTier),
             danger: danger,
             delay: Math.max(k.delayMin, k.delayBase - tier * k.delayTier) + Math.random() * 1.2,
             squeeze: k.squeeze, gapSpeed: k.gapSpeed, scale: k.scale };
  }

  /* —— 三幕场景：0 / 300 / 600m —— */
  function actFor(dist) {
    return Math.min(2, Math.floor(dist / cfg.actStep));
  }

  /* —— 障碍解锁：里程增加逐步开放更多类型 —— */
  function unlockedObstacles(dist) {
    var out = [];
    for (var i = 0; i < cfg.obstUnlocks.length; i++) {
      if (dist >= cfg.obstUnlocks[i].at) out = out.concat(cfg.obstUnlocks[i].types);
    }
    return out;
  }

  /* —— 障碍生成 —— */
  function makeObstacle(x, type) {
    var d = OBST[type];
    var o = { x: x, type: type, w: d.w, h: d.h, passed: false, near: false, hit: false };
    if (type === 'low') { o.solidTop = cfg.groundY - 46; o.solidBottom = cfg.groundY; }
    else if (type === 'high') { o.solidTop = cfg.groundY - 92; o.solidBottom = cfg.groundY - cfg.slideH; }
    else if (type === 'moving') { o.phase = Math.random() * Math.PI * 2; o.freq = d.freq; o.amp = d.amp; updateMovingBox(o, 0); }
    else if (type === 'gap') { o.solidTop = cfg.groundY - 8; o.solidBottom = cfg.groundY + 60; }
    else if (type === 'spike') { o.solidTop = cfg.groundY - 96; o.solidBottom = cfg.groundY; }
    return o;
  }
  /* 移动梁：上下浮动，梁底围绕滑铲高度摆动 → 滑铲需等梁浮起，跳跃恒可越 */
  function updateMovingBox(o, t) {
    var lift = Math.sin(t * o.freq + o.phase) * o.amp;   // ±20
    o.solidBottom = cfg.groundY - cfg.slideH + lift;
    o.solidTop = o.solidBottom - o.h;
  }
  function pickType(s) {
    var dist = s.dist, t = tierFor(s).tier;
    var r = Math.random();
    // 新类型按里程逐步解锁：前 100m 保持原 2 种为主
    var extra = unlockedObstacles(dist);
    if (extra.length && r < 0.38 + Math.min(0.22, t * 0.02)) {
      return extra[Math.floor(Math.random() * extra.length)];
    }
    var keep = s.obstacles[s.obstacles.length - 1];
    var switchChance = Math.min(0.82, 0.42 + t * 0.05);
    if (keep && (keep.type === 'low' || keep.type === 'high') && Math.random() < switchChance) {
      return keep.type === 'low' ? 'high' : 'low';
    }
    return Math.random() < 0.58 ? 'low' : 'high';
  }
  function spawnObstacle(s, x) {
    var type = pickType(s);
    if (type === 'double') {
      pushObstacle(s, makeObstacle(x, 'low'));
      pushObstacle(s, makeObstacle(x + 120, 'low'));
    } else if (type === 'combo') {
      pushObstacle(s, makeObstacle(x, 'low'));
      pushObstacle(s, makeObstacle(x + 200, 'high'));
    } else {
      pushObstacle(s, makeObstacle(x, type));
    }
    s.spawnCount++;
    if (s.spawnCount % 5 === 0) {
      var pickupNo = s.spawnCount / 5;
      s.pickups.push({ x: x - 280, y: cfg.groundY - 34,
                       kind: pickupNo % 2 ? 'magnet' : 'shield' });
    }
  }
  function pushObstacle(s, o) {
    s.obstacles.push(o);
  }

  /* —— 间距：随速度缩短但保留反应时间 —— */
  function intervalFor(s) {
    var t = tierFor(s).tier;
    var base = 300 + Math.min(340, s.speed * 0.55);
    var pressure = Math.max(0.72, 1 - t * 0.025);
    return base * pressure * (0.78 + Math.random() * 0.44);
  }

  /* —— 玩家碰撞盒 —— */
  function playerBox(p) {
    var h = (p.sliding > 0) ? cfg.slideH : cfg.actorH;
    var top = (p.sliding > 0) ? cfg.groundY - cfg.slideH : p.y;
    return { l: cfg.playerX - cfg.actorW / 2, r: cfg.playerX + cfg.actorW / 2,
             top: top, bottom: top + h };
  }

  /* —— 主更新 —— */
  function update(s, actions, dt) {
    var ev = [];
    if (s.gameOver) return ev;
    actions = actions || {};
    s.time += dt;

    var t = tierFor(s);
    if (t.tier > s.speedTier) { s.speedTier = t.tier; ev.push({ type: 'tierUp', tier: t.tier }); }
    var speedTarget = t.speed;
    s.speed += (speedTarget - s.speed) * Math.min(1, dt * 1.6);   // 平滑逼近当前档目标速度（碰撞减速后自动恢复）
    if (s.player.magnet > 0) s.player.magnet = Math.max(0, s.player.magnet - dt);

    var p = s.player;
    if (p.stun > 0) p.stun -= dt;
    if (p.invuln > 0) p.invuln -= dt;
    if (p.slideCd > 0) p.slideCd -= dt;
    var evadeAction = false;

    // —— 追击者形态切换 ——
    var wantKind = chaserKindAt(s.dist);
    if (wantKind !== s.chaser.kind) {
      s.chaser.kind = wantKind;
      ev.push({ type: 'chaserSwitch', kind: wantKind, label: cfg.chaserKinds[wantKind].label });
    }

    // —— 输入 ——
    if (actions.jump) {
      if (p.airborne) {
        if (p.jumps > 0) { p.vy = -cfg.jumpV2; p.jumps = 0; evadeAction = true; ev.push({ type: 'jump', dbl: true }); }
      } else {
        p.vy = -cfg.jumpV; p.airborne = true; p.jumps = 1; p.sliding = 0; evadeAction = true; ev.push({ type: 'jump', dbl: false });
      }
    }
    if (actions.slide && !p.airborne && p.slideCd <= 0) {
      p.sliding = cfg.slideDur; p.slideCd = cfg.slideDur + cfg.slideCd; evadeAction = true; ev.push({ type: 'slide' });
    }
    if (actions.drop && p.airborne) { p.vy = Math.max(p.vy, 780); evadeAction = true; }
    if (p.sliding > 0) p.sliding = Math.max(0, p.sliding - dt);

    // —— 垂直物理 ——
    if (p.airborne) {
      p.vy += cfg.gravity * dt;
      p.y += p.vy * dt;
      var floorY = cfg.groundY - cfg.actorH;
      if (p.y >= floorY) { p.y = floorY; p.vy = 0; p.airborne = false; p.jumps = 1; if (p.sliding <= 0) ev.push({ type: 'land' }); }
    }

    // —— 前进（冲刺磁石加速） ——
    var moved = s.speed * dt * (p.magnet > 0 ? (1 + cfg.magnetBoost) : 1);
    var oldMeters = Math.floor(s.dist);
    s.dist = Math.min(cfg.finishDist, s.dist + moved / cfg.pxPerM);   // 以米累计，到终点封顶
    s.score += Math.max(0, Math.floor(s.dist) - oldMeters);

    // —— 世界滚动：所有实体向左移动 ——
    for (var mi = 0; mi < s.obstacles.length; mi++) s.obstacles[mi].x -= moved;
    for (mi = 0; mi < s.coins.length; mi++) s.coins[mi].x -= moved;
    for (mi = 0; mi < s.pickups.length; mi++) s.pickups[mi].x -= moved;

    // —— 三幕场景切换 ——
    var newAct = actFor(s.dist);
    if (newAct !== s.act) { s.act = newAct; ev.push({ type: 'act', act: newAct }); }

    var reachedFinish = s.dist >= cfg.finishDist;

    // —— 巨兽狂怒触发（每 300m，连续 2 波挣脱） ——
    if (!reachedFinish && !s.rage && s.dist >= s.nextRageAt) {
      s.rage = { wave: 0, wavesNeeded: cfg.rageWaves };
      s.nextRageAt += cfg.rageStep;
      s.chaser.burst = 1; s.chaser.burstMax = 1; s.chaser.nextBurst = 999;
      ev.push({ type: 'rageStart', wave: 1 });
    }

    if (reachedFinish) {
      s.gameOver = true;
      s.over = 'finish';
      ev.push({ type: 'finish', dist: cfg.finishDist });
      return ev;
    }

    // —— 移动梁碰撞盒随相位刷新 ——
    for (var mb = 0; mb < s.obstacles.length; mb++) {
      if (s.obstacles[mb].type === 'moving') updateMovingBox(s.obstacles[mb], s.time);
    }

    // —— 障碍/金币/道具生成与回收 ——
    var lastX = s.obstacles.length ? s.obstacles[s.obstacles.length - 1].x : -999;
    while (lastX < cfg.playerX + cfg.spawnLead) {
      lastX = (lastX < -800) ? cfg.playerX + 700 : lastX + intervalFor(s);
      spawnObstacle(s, lastX);
    }
    while (s.obstacles.length && s.obstacles[0].x < cfg.playerX - 320) s.obstacles.shift();
    while (s.coins.length && s.coins[0].x < cfg.playerX - 160) s.coins.shift();
    while (s.pickups.length && s.pickups[0].x < cfg.playerX - 160) s.pickups.shift();
    if (s.obstacles.length) {
      var head = s.obstacles[s.obstacles.length - 1];
      if (!head.money && head.x - 140 > (s.coins.length ? s.coins[s.coins.length - 1].x : -999)) {
        for (var k = 0; k < 3; k++) {
          s.coins.push({ x: head.x - 200 + k * 34, y: cfg.groundY - 70 - Math.abs(k - 1) * 30 });
        }
        head.money = true;
      }
    }

    // —— 玩家 vs 障碍碰撞（AABB） ——
    var box = playerBox(p);
    for (var i = s.obstacles.length - 1; i >= 0; i--) {
      var o = s.obstacles[i];
      var oL = o.x - o.w / 2, oR = o.x + o.w / 2;
      if (oR < cfg.playerX - cfg.actorW / 2 && !o.passed) {
        o.passed = true;
        if (o.hit) continue;
        if (p.sliding > 0 && o.type === 'high' && box.top <= o.solidBottom + cfg.evadeGap) {
          // 滑铲擦梁底
        } else if (!p.sliding && o.type === 'low' && box.bottom >= o.solidTop - cfg.evadeGap) {
          // 跳过擦坎顶
        } else if (p.sliding > 0 && o.type === 'moving' && box.top <= o.solidBottom + cfg.evadeGap) {
          // 移动梁滑铲擦底
        } else if (!p.sliding && o.type === 'moving' && box.bottom >= o.solidTop - cfg.evadeGap) {
          // 移动梁跳跃擦顶
        } else {
          s.combo = 0; ev.push({ type: 'comboBreak', dist: Math.round(s.dist) });
          continue;
        }
        s.combo++; s.bestCombo = Math.max(s.bestCombo, s.combo);
        s.score += 15 * s.combo; s.nearMiss++;
        ev.push({ type: 'nearMiss', combo: s.combo });
        continue;
      }
      if (oR <= box.l || oL >= box.r) continue;
      var hitTop = Math.max(box.top, o.solidTop), hitBot = Math.min(box.bottom, o.solidBottom);
      if (hitTop < hitBot && p.invuln <= 0) { // 实心重叠
        o.hit = true;
        if (p.shield > 0) {
          p.shield--; p.invuln = cfg.invuln; s.combo = 0;
          ev.push({ type: 'shieldBreak' });
        } else {
          s.speed *= 0.55; p.stun = cfg.stun; p.invuln = cfg.invuln; s.combo = 0;
          ev.push({ type: 'hit' });
          return ev; // 本帧不再继续
        }
      }
    }

    // —— 金币 ——
    for (i = s.coins.length - 1; i >= 0; i--) {
      var c = s.coins[i];
      if (c.x > cfg.playerX - 30 && c.x < cfg.playerX + 30 &&
          c.y > box.top - 24 && c.y < box.bottom + 24) {
        s.coins.splice(i, 1);
        var coinVal = cfg.coinScore * (s.rage ? 2 : 1);
        s.score += coinVal; s.combo++; s.coinsGot++;
        s.bestCombo = Math.max(s.bestCombo, s.combo);
        ev.push({ type: 'coin' });
      }
    }
    // —— 道具 ——
    for (i = s.pickups.length - 1; i >= 0; i--) {
      var pk = s.pickups[i];
      if (pk.x > cfg.playerX - 34 && pk.x < cfg.playerX + 34 &&
          pk.y > box.top - 30 && pk.y < box.bottom + 30) {
        s.pickups.splice(i, 1);
        if (pk.kind === 'magnet') { p.magnet = cfg.magnetDur; ev.push({ type: 'magnet' }); }
        else if (pk.kind === 'shield') { p.shield = Math.min(p.shieldsMax, p.shield + 1); ev.push({ type: 'shield' }); }
      }
    }

    // —— 追击者 ——
    var c2 = s.chaser;
    if (s.rage) { c2.burst = 1; c2.burstMax = 1; c2.nextBurst = 999; }  // 狂怒期强制高压
    var prof = profileOf(c2.kind, t.tier);
    var dangerMax = prof.danger;
    c2.dangerMax = dangerMax;
    c2.dangerLeft = Math.min(c2.dangerLeft, dangerMax);

    var burstActive = c2.burst > 0;
    if (!burstActive) {
      c2.nextBurst -= dt;
      if (c2.nextBurst <= 0) {
        c2.burst = prof.burst;
        c2.burstMax = prof.burst;
        c2.nextBurst = prof.delay;
        burstActive = true;
      }
    }
    if (c2.burst > 0) {
      c2.burst -= dt;
      if (!c2.burstMax) c2.burstMax = Math.max(1, c2.burst + dt);
      var progress = 1 - Math.max(0, c2.burst) / c2.burstMax;
      var squeeze = prof.squeeze + t.tier * 10 + progress * 32;
      c2.gap -= squeeze * dt;
      if (s.rage) c2.gap -= 60 * dt;   // 狂怒期额外强推进
    } else if (s.time > 3) {
      c2.gap -= (prof.gapSpeed + t.tier * 0.8) * dt;
    }
    if (p.stun > 0) c2.gap -= s.speed * dt * 0.5; // 被撞掉速 → 追击者逼近
    if (burstActive || c2.gap < cfg.gapDanger + 160) {
      ev.push({ type: 'chase', gap: Math.round(c2.gap), burst: burstActive });
    }

    // 只有危险区内的有效动作能挣脱
    var gapBeforeAction = c2.gap;
    if (evadeAction && c2.gap < cfg.gapDanger) {
      c2.gap += (cfg.gapBack - c2.gap) * 0.52;
      c2.dangerLeft = dangerMax;
      c2.escaped++;
      var leftDanger = gapBeforeAction < cfg.gapDanger && c2.gap >= cfg.gapDanger;
      if (leftDanger) {
        c2.burst = 0;
        c2.burstMax = 0;
        c2.nextBurst = prof.delay;
        ev.push({ type: 'escape', escaped: c2.escaped });
        // 狂怒进度：每挣脱一次推进一波
        if (s.rage) {
          s.rage.wave++;
          if (s.rage.wave >= s.rage.wavesNeeded) {
            s.rage = null;
            c2.nextBurst = 6.5;      // 击退后喘息
            s.score += cfg.rageBonus; s.rageCleared++;
            ev.push({ type: 'rageClear' });
          } else {
            ev.push({ type: 'rageWave', wave: s.rage.wave });
          }
        }
      }
    }

    // —— 贴脸危险窗口：gap 低于阈值即持续倒计时 ——
    if (c2.gap < cfg.gapDanger) {
      c2.dangerLeft -= dt;
      if (c2.dangerLeft <= 0) { s.gameOver = true; s.over = 'caught'; ev.push({ type: 'caught' }); return ev; }
      ev.push({ type: 'danger', left: Math.max(0, c2.dangerLeft) });
    } else {
      c2.dangerLeft = dangerMax;
    }
    c2.gap = Math.max(90, c2.gap);

    return ev;
  }

  function endGame(s, reason) {
    if (s.gameOver) return s.over;
    s.gameOver = true; s.over = reason || 'quit';
    return s.over;
  }

  var API = {
    cfg: cfg, newGame: newGame, update: update, endGame: endGame,
    tierFor: tierFor, intervalFor: intervalFor, dangerTimeFor: dangerTimeFor,
    chaserKindAt: chaserKindAt, profileOf: profileOf,
    actFor: actFor, unlockedObstacles: unlockedObstacles, speedMultFor: speedMultFor
  };
  global.FinalRunEngine = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
