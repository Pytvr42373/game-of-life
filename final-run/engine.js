/* =====================================================================
 * engine.js —— 《终局狂奔》核心逻辑（纯计算，无 DOM 依赖）
 * 横版无尽跑酷：跳跃/滑铲躲障碍；追击者贴脸 3 秒内必做动作挣脱，
 * 否则被捕获；提速分档；极限闪避连击；冲刺磁石/护盾道具。
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
    baseSpeed: 340, maxSpeed: 980, accelPer100m: 42,
    pxPerM: 40,                // 距离换算：px → m（100m ≈ 12s 一档节奏）
    gapStart: 620, gapDanger: 260, gapBack: 720, dangerTime: 3.0,
    stun: 0.42, invuln: 0.9,
    magnetDur: 2.4, magnetBoost: 0.45,
    evadeGap: 16,             // 极限闪避：竖直缝隙 < 16px 视为擦身
    spawnLead: 1500,          // 前方预生成距离
    coinScore: 30
  };

  function newGame() {
    return {
      dist: 0, speed: cfg.baseSpeed, time: 0,
      player: { y: cfg.groundY - cfg.actorH, vy: 0, airborne: false, jumps: 0,
                sliding: 0, slideCd: 0, stun: 0, invuln: 0, shield: 0, magnet: 0 },
      chaser: { gap: cfg.gapStart, burst: 0, burstMax: 0, nextBurst: 6.5,
                dangerLeft: cfg.dangerTime, dangerMax: cfg.dangerTime, escaped: 0 },
      obstacles: [], coins: [], pickups: [], spawnCount: 0,
      score: 0, combo: 0, bestCombo: 0, nearMiss: 0,
      speedTier: 0, gameOver: false, over: null
    };
  }

  /* —— 难度档位：每 250m 或每 24 秒提升，取进度更快的一项 —— */
  function tierFor(s) {
    var distTier = Math.floor(s.dist / 250);
    var timeTier = Math.floor((s.time || 0) / 24);
    var tier = Math.max(distTier, timeTier);
    return { speed: Math.min(cfg.maxSpeed, cfg.baseSpeed + tier * cfg.accelPer100m),
              tier: tier };
  }

  function dangerTimeFor(tier) {
    return Math.max(1.5, cfg.dangerTime - tier * 0.12);
  }

  function nextBurstDelay(tier) {
    return Math.max(3.8, 7.2 - tier * 0.28) + Math.random() * 1.2;
  }

  /* —— 障碍生成 —— */
  function spawnObstacle(s, x) {
    var t = tierFor(s).tier;
    var keep = s.obstacles[s.obstacles.length - 1];
    var type;
    // 难度提高后更频繁交替跳跃/滑铲，避免只靠单一动作通过
    var switchChance = Math.min(0.82, 0.42 + t * 0.05);
    if (keep && Math.random() < switchChance) type = keep.type === 'low' ? 'high' : 'low';
    else type = Math.random() < 0.58 ? 'low' : 'high';
    var h = (type === 'low') ? 46 : 92;
    // 实心矩形：顶部 solidTop、底部 solidBottom（玩家与它做 AABB）
    var solidTop = cfg.groundY - h, solidBottom = cfg.groundY;
    if (type === 'high') solidBottom = cfg.groundY - cfg.slideH; // 梁底悬空，可滑过
    s.obstacles.push({ x: x, type: type, w: 36, h: h, solidTop: solidTop, solidBottom: solidBottom,
                       passed: false, near: false, hit: false });
    s.spawnCount++;
    if (s.spawnCount % 5 === 0) {
      var pickupNo = s.spawnCount / 5;
      s.pickups.push({ x: x - 280, y: cfg.groundY - 34,
                       kind: pickupNo % 2 ? 'magnet' : 'shield' });
    }
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

  /* —— 主更新 ——
   * actions: { jump / slide / drop } (边沿触发)
   * 返回本帧事件数组
   */
  function update(s, actions, dt) {
    var ev = [];
    if (s.gameOver) return ev;
    actions = actions || {};
    s.time += dt;

    var t = tierFor(s);
    if (t.tier > s.speedTier) { s.speedTier = t.tier; ev.push({ type: 'tierUp', tier: t.tier }); }
    s.speed += (t.speed - s.speed) * Math.min(1, dt * 1.6);
    if (s.player.magnet > 0) s.player.magnet = Math.max(0, s.player.magnet - dt);

    var p = s.player;
    if (p.stun > 0) p.stun -= dt;
    if (p.invuln > 0) p.invuln -= dt;
    if (p.slideCd > 0) p.slideCd -= dt;
    var evadeAction = false;

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
    if (actions.drop && p.airborne) { p.vy = Math.max(p.vy, 780); evadeAction = true; } // 下坠（可用来甩开追击者时机）
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
    s.dist += moved / cfg.pxPerM;   // 以米累计
    s.score += Math.max(0, Math.floor(s.dist) - oldMeters);

    // —— 世界滚动：所有实体向左移动 ——
    for (var mi = 0; mi < s.obstacles.length; mi++) s.obstacles[mi].x -= moved;
    for (mi = 0; mi < s.coins.length; mi++) s.coins[mi].x -= moved;
    for (mi = 0; mi < s.pickups.length; mi++) s.pickups[mi].x -= moved;

    // —— 障碍/金币/道具生成与回收 ——
    var lastX = s.obstacles.length ? s.obstacles[s.obstacles.length - 1].x : -999;
    while (lastX < cfg.playerX + cfg.spawnLead) {
      lastX = (lastX < -800) ? cfg.playerX + 700 : lastX + intervalFor(s);
      spawnObstacle(s, lastX);
    }
    while (s.obstacles.length && s.obstacles[0].x < cfg.playerX - 320) s.obstacles.shift();
    while (s.coins.length && s.coins[0].x < cfg.playerX - 160) s.coins.shift();
    while (s.pickups.length && s.pickups[0].x < cfg.playerX - 160) s.pickups.shift();
    // 金币列：挂在每个障碍前缘，弧线排列（简单起见：障碍略前方一排三个）
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
        // 极限闪避：贴着固体边缘通过
        if (p.sliding > 0 && o.type === 'high' && box.top <= o.solidBottom + cfg.evadeGap) {
          // 滑铲擦梁底
        } else if (!p.sliding && o.type === 'low' && box.bottom >= o.solidTop - cfg.evadeGap) {
          // 跳过擦坎顶
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
        s.score += cfg.coinScore; s.combo++;
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
        else if (pk.kind === 'shield') { p.shield = Math.min(2, p.shield + 1); ev.push({ type: 'shield' }); }
      }
    }

    // —— 追击者 ——
    var c2 = s.chaser;
    var dangerMax = dangerTimeFor(t.tier);
    c2.dangerMax = dangerMax;
    c2.dangerLeft = Math.min(c2.dangerLeft, dangerMax);

    // 周期性爆发取代逐帧随机：开局即有压力，难度越高间隔越短、推进越快
    var burstActive = c2.burst > 0;
    if (!burstActive) {
      c2.nextBurst -= dt;
      if (c2.nextBurst <= 0) {
        c2.burst = Math.max(3.1, 4.4 - t.tier * 0.07);
        c2.burstMax = c2.burst;
        c2.nextBurst = nextBurstDelay(t.tier);
        burstActive = true;
      }
    }
    if (c2.burst > 0) {
      c2.burst -= dt;
      if (!c2.burstMax) c2.burstMax = Math.max(1, c2.burst + dt);
      var progress = 1 - Math.max(0, c2.burst) / c2.burstMax;
      var squeeze = 72 + t.tier * 10 + progress * 32;
      c2.gap -= squeeze * dt;
    } else if (s.time > 3) {
      c2.gap -= (2.5 + t.tier * 0.8) * dt;
    }
    if (p.stun > 0) c2.gap -= s.speed * dt * 0.5; // 被撞掉速 → 追击者逼近
    if (burstActive || c2.gap < cfg.gapDanger + 160) {
      ev.push({ type: 'chase', gap: Math.round(c2.gap), burst: burstActive });
    }

    // 只有危险区内的有效动作能挣脱；远处普通动作不再中断追击爆发
    var gapBeforeAction = c2.gap;
    if (evadeAction && c2.gap < cfg.gapDanger) {
      c2.gap += (cfg.gapBack - c2.gap) * 0.52;
      c2.dangerLeft = dangerMax;
      c2.escaped++;
      var leftDanger = gapBeforeAction < cfg.gapDanger && c2.gap >= cfg.gapDanger;
      if (leftDanger) {
        c2.burst = 0;
        c2.burstMax = 0;
        c2.nextBurst = nextBurstDelay(t.tier);
        ev.push({ type: 'escape', escaped: c2.escaped });
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
    tierFor: tierFor, intervalFor: intervalFor, dangerTimeFor: dangerTimeFor
  };
  global.FinalRunEngine = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
