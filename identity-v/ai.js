/* ============================================================
 * ai.js - AI 状态机
 * 监管者：巡逻→追击→搜索→守尸/搬运→攻击
 * 求生者：修机→逃跑→救援→治疗→逃生
 * ============================================================ */
(function (global) {
  'use strict';

  var RANGE = 46;

  /* ---------- 监管者 AI ---------- */
  function HunterAI(hunter, game) {
    this.h = hunter;
    this.game = game;
    this.active = true;
    this.repathT = 0;
    this.thinkT = 0;
    this._guardOrbitT = 0;
    this._searchPoint = null;
    this._searchT = 0;
    this._visibleNow = [];   // 本帧唯一可见集合(与 game.perceiveSurvivors 完全一致)
  }

  HunterAI.prototype.update = function (dt) {
    if (!this.active) return;
    var h = this.h;
    var game = this.game;
    var diff = (global.DIFF || {})[game.difficulty] || { chaseGiveup: 5, guardTime: 8 };
    if (h.stunT > 0) { h.moveX = 0; h.moveY = 0; return; }
    if (h.breakingPallet) { h.moveX = 0; h.moveY = 0; return; }
    if (h.wipeT > 0) { h.moveX = 0; h.moveY = 0; return; } // 擦刀期间原地不动
    if (h.vaultT > 0) { h.moveX = 0; h.moveY = 0; return; } // 翻窗期间不动
    if (h.dashT > 0) { h.moveX = Math.cos(h.dashDir); h.moveY = Math.sin(h.dashDir); return; }

    // 传送有短暂后摇；结束后再在落点布置迷雾，避免同帧施法被后摇拦截。
    if (h._fogAfterTeleport) {
      h._fogAfterTeleport = false;
      if (h.char.id === 'hun_tele' && h.skill2Cd <= 0) game.useHunterSkill(h, 2);
    }

    /* 搬运中：找最近的空椅子 */
    if (h.carrying) {
      h.state = 'carry';
      var chair = this.nearestFreeChair();
      if (chair) {
        this.moveToward(h, chair.x, chair.y, dt);
        if (dist(h.x, h.y, chair.x, chair.y) < 32) game.placeOnChair(h, chair);
      } else {
        this.patrol(h, dt);
      }
      return;
    }

    /* 感知：仅当实际看见目标时才更新 lastSeen/追击(修复隔墙透视) */
    var vis = game.perceiveSurvivors(h);
    this._visibleNow = vis;   // 本帧唯一可见集合，后续攻击/技能/lastSeen/追踪只认它
    if (vis.length) {
      var t = this.chooseTarget(vis);
      h.target = t;
      h.lastSeen = { x: t.x, y: t.y };
      h.lostT = 0;
      h.state = 'chase';
    } else if (h.state === 'chase') {
      h.lostT += dt;
      if (h.lostT > diff.chaseGiveup) { h.state = 'search'; h.target = null; this._searchT = 4; this._searchPoint = null; }
    }

    /* 追击技能释放(仅当目标当前可见且未倒地) */
    if (h.state === 'chase') {
      var tgt = h.target;
      var targetVisible = !!(tgt && this._isVisibleNow(tgt));
      if (tgt && targetVisible && tgt.hp > 0) {
        // 攻击/冲刺/陷阱/震荡波/锁链前先朝向目标，减少无故打空
        h.dir = Math.atan2(tgt.y - h.y, tgt.x - h.x);
        if (h.char.id === 'hun_tele') {
          // 目标较远且靠近密码机时传送截击，不为追击随机跳往无关机器。
          var targetMachine = this.nearMachine(tgt.x, tgt.y, 160);
          var teleported = false;
          if (h.skillCd <= 0 && targetMachine && dist(h.x, h.y, targetMachine.x, targetMachine.y) > 300) {
            h._teleportTargetMachine = targetMachine;
            h._fogAfterTeleport = h.skill2Cd <= 0;
            game.useHunterSkill(h, 1);
            teleported = true;
          }
          if (!teleported && h.skill2Cd <= 0) {
            var nearM = this.nearMachine(h.x, h.y, 160) || this.nearMachine(tgt.x, tgt.y, 160);
            if (nearM) game.useHunterSkill(h, 2);
          }
        }
        if (h.char.id === 'hun_chase' && h.skillCd <= 0 && dist(h.x, h.y, tgt.x, tgt.y) > 180) {
          game.useHunterSkill(h, 1);
        }
        // 缚骨陷阱师：追击中接近目标(40~250)时埋下铁笼拦截；目标在锁链合法距离/视野时释放锁链
        if (h.char.id === 'hun_cage') {
          var ctd = dist(h.x, h.y, tgt.x, tgt.y);
          if (h.skillCd <= 0 && ctd > 40 && ctd < 250) game.useHunterSkill(h, 1);
          if (h.skill2Cd <= 0 && ctd <= 240 && ctd > 60) game.useHunterSkill(h, 2);
        }
        // 碎骨重锤：目标进入 150px 内释放震荡波；目标或双方靠近可用/倒下木板时开粉碎姿态
        if (h.char.id === 'hun_heavy') {
          if (h.skillCd <= 0 && dist(h.x, h.y, tgt.x, tgt.y) < 150) game.useHunterSkill(h, 1);
          if (h.skill2Cd <= 0 && this.nearPalletForSmash(tgt)) game.useHunterSkill(h, 2);
        }
      }
    }

    /* 抱起倒地者优先(保证能完成淘汰) - 仅当可见 */
    var downedT = this.nearestDowned();
    if (downedT && dist(h.x, h.y, downedT.x, downedT.y) < 320 && this._isVisibleNow(downedT)) {
      h.target = downedT;
      h.lastSeen = { x: downedT.x, y: downedT.y };
      h.state = 'chase';
    }

    /* 状态执行 */
    if (h.state === 'chase') {
      var target = h.target;
      if (target && target.alive && !target.escaped && target.hp >= 0) {
        var targetVisible = this._isVisibleNow(target);
        if (targetVisible) {
          h.lastSeen = { x: target.x, y: target.y };
          h.lostT = 0;
        }
        var d = dist(h.x, h.y, target.x, target.y);
        var ls = h.lastSeen || { x: target.x, y: target.y };
        // 倒板确实挡住目标(最后目击点)时先拆板，避免隔板攻击或在板前反复寻路
        var blockingPallet = this.blockingPallet(ls.x, ls.y);
        if (blockingPallet && !game.lineOfSight(h.x, h.y, ls.x, ls.y) && game.breakPallet(h, blockingPallet)) return;
        // 目标已倒地且近身：牵制(仅可见)
        if (targetVisible && target.hp === 0 && d < RANGE + 22) { game.hunterInteract(h); return; }
        if (targetVisible && d < h.char.stats.atkRange + 10 && h.atkCd <= 0) {
          if (!game.hunterAttack(h)) {
            // 没打中，破坏挡路的板子
            this.tryBreakPallet();
          }
        } else if (this.pathBroken()) {
          this.tryBreakPallet();
        }
        // 移动：可见→当前坐标；丢失→最后目击点(不隔墙透视)
        var mx = targetVisible ? target.x : ls.x;
        var my = targetVisible ? target.y : ls.y;
        this.moveToward(h, mx, my, dt);
      } else {
        h.state = 'search'; this._searchT = 4; this._searchPoint = null;
      }
      return;
    }

    if (h.state === 'search') {
      // 搜索计时按真实 dt 每帧递减；到期立即回 patrol 并清理
      this._searchT -= dt;
      if (this._searchT <= 0) {
        h.state = 'patrol'; h.lastSeen = null; h.target = null; this._searchPoint = null; this._searchT = 0;
        return;
      }
      if (h.lastSeen) {
        var ls = h.lastSeen;
        if (this._searchPoint) {
          this.moveToward(h, this._searchPoint.x, this._searchPoint.y, dt);
          if (dist(h.x, h.y, this._searchPoint.x, this._searchPoint.y) < 28) {
            this._searchPoint = null;
          }
        } else {
          this.moveToward(h, ls.x, ls.y, dt);
          if (dist(h.x, h.y, ls.x, ls.y) < 28) {
            var sAng = Math.random() * Math.PI * 2;
            this._searchPoint = {
              x: clamp(ls.x + Math.cos(sAng) * 200, 42, this.game.cols * this.game.ts - 42),
              y: clamp(ls.y + Math.sin(sAng) * 200, 42, this.game.rows * this.game.ts - 42)
            };
          }
        }
      } else h.state = 'patrol';
      return;
    }

    if (h.state === 'guard') {
      h.guardT -= dt;
      // 守尸：在椅子周围绕圈巡逻（防贴脸救援/被绕视野）
      var guardChair = this.nearestOccupiedChair();
      if (guardChair) {
        if (dist(h.x, h.y, guardChair.x, guardChair.y) > 85) {
          this.moveToward(h, guardChair.x, guardChair.y, dt);
        } else {
          this._guardOrbitT -= dt;
          var oca = h.dir + 0.9;
          if (this._guardOrbitT <= 0) { this._guardOrbitT = 0.55; h.dir = oca; }
          this.moveToward(h, guardChair.x + Math.cos(h.dir) * 72, guardChair.y + Math.sin(h.dir) * 72, dt);
        }
      }
      if (h.guardT <= 0) { h.state = 'patrol'; this._guardOrbitT = 0; }
      return;
    }

    /* 巡逻 */
    if (h.char.id === 'hun_tele' && h.skillCd <= 0) {
      var pressureMachine = this.farUncompletedMachine();
      if (pressureMachine) {
        h._teleportTargetMachine = pressureMachine;
        h._fogAfterTeleport = h.skill2Cd <= 0;
        game.useHunterSkill(h, 1);
        h.path = [];
        this.thinkT = 0;
        return;
      }
    }
    this.patrol(h, dt);
  };

  HunterAI.prototype.nearestFreeChair = function () {
    var g = this.game, best = null, bd = 1e9;
    for (var i = 0; i < g.chairs.length; i++) {
      var c = g.chairs[i];
      if (c.occupant || c.broken) continue;
      var d = dist(this.h.x, this.h.y, c.x, c.y);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  };

  HunterAI.prototype.nearestDowned = function () {
    var g = this.game, h = this.h, best = null, bd = 1e9;
    for (var i = 0; i < g.survivors.length; i++) {
      var s = g.survivors[i];
      if (!s.alive || s.escaped || s.hp !== 0 || s.carriedBy || s.chair) continue;
      var d = dist(h.x, h.y, s.x, s.y);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  };

  HunterAI.prototype.nearestOccupiedChair = function () {
    var g = this.game, best = null, bd = 1e9;
    for (var i = 0; i < g.chairs.length; i++) {
      var c = g.chairs[i];
      if (!c.occupant) continue;
      var d = dist(this.h.x, this.h.y, c.x, c.y);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  };

  HunterAI.prototype.patrol = function (h, dt) {
    this.thinkT -= dt;
    if (!h.path || h.path.length === 0 || this.thinkT <= 0) {
      this.thinkT = 3 + Math.random() * 2;
      var g = this.game;
      var c = null;
      // 通电后优先巡逻未开启大门
      var powered = g.gates.some(function (gt) { return gt.powered; });
      if (powered) {
        var unopened = [];
        for (var gi = 0; gi < g.gates.length; gi++) if (!g.gates[gi].open) unopened.push(g.gates[gi]);
        if (unopened.length) c = this.pickPatrolTarget(h, unopened);
      }
      // 优先有破译者或高进度的未完成密码机，兼顾距离
      if (!c) {
        var undecoded = [];
        for (var i = 0; i < g.machines.length; i++) if (!g.machines[i].decoded) undecoded.push(g.machines[i]);
        if (undecoded.length) c = this.pickPatrolTarget(h, undecoded);
      }
      // 兜底：随机巡逻椅子/大门
      if (!c) {
        var candidates = [];
        for (var j = 0; j < g.chairs.length; j++) if (!g.chairs[j].broken) candidates.push(g.chairs[j]);
        for (var k = 0; k < g.gates.length; k++) candidates.push(g.gates[k]);
        if (candidates.length) c = candidates[Math.floor(Math.random() * candidates.length)];
      }
      if (c) {
        h.path = g.pathTo(h.x, h.y, c.x, c.y, { win: true });
        h.pathIdx = 0;
      }
    }
    this.followPath(h, dt);
  };

  // 巡逻目标评分：明显优先有破译者，其次高进度，再兼顾距离，保留少量非确定性
  HunterAI.prototype.pickPatrolTarget = function (h, list) {
    var g = this.game;
    var best = null, bestScore = -1e9;
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      var score = -dist(h.x, h.y, t.x, t.y) * 0.35;
      if (t.decoded !== undefined) { // 密码机
        if (t.decoders > 0) score += t.decoders * 400;
        if (t.progress) score += t.progress * 2.5;
      }
      score += Math.random() * 40;
      if (score > bestScore) { bestScore = score; best = t; }
    }
    return best;
  };

  // 可见目标选择：倒地者优先搬运；否则按受伤/破译/救援评分，并对当前目标加黏性避免抖动
  HunterAI.prototype.chooseTarget = function (vis) {
    var h = this.h;
    var downed = null, bd = 1e9;
    for (var i = 0; i < vis.length; i++) {
      if (vis[i].s.hp === 0 && vis[i].d < bd) { bd = vis[i].d; downed = vis[i].s; }
    }
    if (downed) return downed;
    var best = null, bestScore = -1e9;
    for (var j = 0; j < vis.length; j++) {
      var s = vis[j].s;
      var score = -vis[j].d;
      if (s.hp === 1) score += 60;
      if (s.decoding) score += 80;
      if (s.channel && (s.channel.type === 'rescue' || s.channel.type === 'revive')) score += 90;
      if (h.target === s) score += 120; // 追击黏性
      if (score > bestScore) { bestScore = score; best = s; }
    }
    return best;
  };

  // 目标当前是否在本帧可见集合内(与 game.perceiveSurvivors 完全一致)
  HunterAI.prototype._isVisibleNow = function (s) {
    for (var i = 0; i < this._visibleNow.length; i++) {
      if (this._visibleNow[i].s === s) return true;
    }
    return false;
  };

  // 迷雾夫人：较远的未完成密码机中选压力最高者(破译者/进度正权重，距离轻度负权重)
  HunterAI.prototype.farUncompletedMachine = function () {
    var g = this.game, h = this.h;
    var best = null, bestScore = -1e9;
    for (var i = 0; i < g.machines.length; i++) {
      var m = g.machines[i];
      if (m.decoded) continue;
      var d = dist(h.x, h.y, m.x, m.y);
      if (d < 300) continue;
      if (m.decoders <= 0 && m.progress < 20) continue;
      var score = (m.decoders > 0 ? m.decoders * 400 : 0) + m.progress * 2.5 - d * 0.35;
      if (score > bestScore) { bestScore = score; best = m; }
    }
    return best;
  };

  HunterAI.prototype.nearMachine = function (x, y, range) {
    var g = this.game;
    for (var i = 0; i < g.machines.length; i++) {
      var m = g.machines[i];
      if (m.decoded) continue;
      if (dist(x, y, m.x, m.y) < range) return m;
    }
    return null;
  };

  // 格罗姆：目标或双方靠近可用/倒下木板时开粉碎姿态
  HunterAI.prototype.nearPalletForSmash = function (tgt) {
    var g = this.game, h = this.h;
    for (var i = 0; i < g.pallets.length; i++) {
      var p = g.pallets[i];
      if (p.destroyed) continue;
      var dh = dist(h.x, h.y, p.x, p.y);
      var dt = tgt ? dist(tgt.x, tgt.y, p.x, p.y) : 1e9;
      if (dh < 120 || dt < 120) return true;
    }
    return false;
  };

  HunterAI.prototype.pathBroken = function () {
    return !this.h.path || this.h.path.length === 0;
  };

  HunterAI.prototype.tryBreakPallet = function () {
    var g = this.game, h = this.h;
    var pal = g.nearDownPallet(h);
    if (pal) return g.breakPallet(h, pal);
    return false;
  };

  HunterAI.prototype.blockingPallet = function (px, py) {
    var g = this.game, h = this.h, best = null, bd = RANGE + 10;
    for (var i = 0; i < g.pallets.length; i++) {
      var pal = g.pallets[i];
      if (!pal.down || pal.destroyed) continue;
      var d = dist(h.x, h.y, pal.x, pal.y);
      if (d >= bd) continue;
      var axis = pal.axis === 'vertical' ? 'vertical' : 'horizontal';
      if (g._whichSide(h, pal, axis) === g._whichSide({ x: px, y: py }, pal, axis)) continue;
      bd = d;
      best = pal;
    }
    return best;
  };

  HunterAI.prototype.nearestDownPallet = function () {
    var g = this.game, h = this.h, best = null, bd = 1e9;
    for (var i = 0; i < g.pallets.length; i++) {
      var p = g.pallets[i];
      if (!p.down || p.destroyed) continue;
      var d = dist(h.x, h.y, p.x, p.y);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  };

  HunterAI.prototype.pathToPallet = function (p) {
    var g = this.game, ts = g.ts;
    var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    var best = [];
    for (var i = 0; i < dirs.length; i++) {
      var tx = p.tx + dirs[i][0], ty = p.ty + dirs[i][1];
      if (g.tileIsSolid(tx, ty) || g.tileIsDownPallet(tx, ty)) continue;
      var path = g.pathTo(this.h.x, this.h.y, tx * ts + ts / 2, ty * ts + ts / 2);
      if (path.length && (!best.length || path.length < best.length)) best = path;
    }
    return best;
  };

  HunterAI.prototype.moveToward = function (h, tx, ty, dt) {
    this.repathT -= dt;
    if (!h.path || h.path.length === 0 || this.repathT <= 0) {
      this.repathT = 0.45;
      h.path = this.game.pathTo(h.x, h.y, tx, ty, { win: true });
      h.pathIdx = 0;
      if (!h.path.length) {
        var pallet = this.nearestDownPallet();
        if (pallet) h.path = this.pathToPallet(pallet);
      }
    }
    this.followPath(h, dt);
    // 若路径到头且还没到目标，重新寻路
    if (h.path && h.path.length === 0 && dist(h.x, h.y, tx, ty) > 30) {
      h.path = this.game.pathTo(h.x, h.y, tx, ty, { win: true });
      if (!h.path.length) {
        var block = this.nearestDownPallet();
        if (block) h.path = this.pathToPallet(block);
      }
    }
  };

  HunterAI.prototype.followPath = function (h, dt) {
    if (!h.path || h.path.length === 0) { h.moveX = 0; h.moveY = 0; return; }
    // 翻越落地后：跳过已跨过的窗/倒板节点，避免回头再翻
    if (h.vaultT > 0) {
      var g = this.game;
      while (h.path.length) {
        var w0 = h.path[0];
        var wx = Math.floor(w0.x / g.ts), wy = Math.floor(w0.y / g.ts);
        if (g.tileAt(w0.x, w0.y) === global.TILE.WIN || g.tileIsDownPallet(wx, wy)) h.path.shift();
        else break;
      }
      if (!h.path.length) { h.moveX = 0; h.moveY = 0; return; }
    }
    var w = h.path[0];
    if (dist(h.x, h.y, w.x, w.y) < 12) { h.path.shift(); if (!h.path.length) { h.moveX = 0; h.moveY = 0; return; } w = h.path[0]; }
    var dx = w.x - h.x, dy = w.y - h.y;
    var d = Math.sqrt(dx * dx + dy * dy) || 1;
    h.moveX = dx / d; h.moveY = dy / d;
  };

  /* ---------- 求生者 AI ---------- */
  function SurvivorAI(survivor, game) {
    this.s = survivor;
    this.game = game;
    this.repathT = 0;
    this.thinkT = 0;
  }

  SurvivorAI.prototype.update = function (dt) {
    var s = this.s;
    var game = this.game;
    if (!s.alive || s.escaped) { s.moveX = 0; s.moveY = 0; return; }
    if (s.carriedBy || s.chair) { s.moveX = 0; s.moveY = 0; return; }

    if (s.channel && (s.channel.type === 'rescue' || s.channel.type === 'revive')) {
      s.moveX = 0; s.moveY = 0;
      return;
    }

    var h = game.hunter;
    var d = dist(s.x, s.y, h.x, h.y);

    /* 倒地：安全则自疗，否则爬走 */
    if (s.hp === 0) {
      if (d > 380 || !game.lineOfSight(s.x, s.y, h.x, h.y)) {
        if (!s.channel) game.startChannel(s, { type: 'heal_self_down', progress: 0, dur: 8 / s.stats.selfHeal });
        s.moveX = 0; s.moveY = 0;
      } else {
        this.crawlAway(s, h, dt);
      }
      return;
    }

    /* 危险判定 */
    var detect = 260;
    if (s.char.id === 'gho') detect *= 0.65;
    if (s.invisible > 0) detect = 0;
    var danger = d < detect && game.lineOfSight(s.x, s.y, h.x, h.y);

    if (danger) {
      // 正在开门的求生者不再逃离(坚持把门开完)
      if (s.channel && s.channel.type === 'gate') { s.moveX = 0; s.moveY = 0; return; }
      s.dangerT = 2;
      if (s.decoding) game.stopDecode(s);
      if (s.channel && s.channel.type === 'heal_other') s.channel = null;
      // 保命技能
      if (s.skillCd <= 0) {
        if (s.char.id === 'run' || s.char.id === 'gho' || s.char.id === 'gua' || s.char.id === 'quo') game.useSurvivorSkill(s);
      }
      // 板子旁下板
      var pal = game.standingOnPallet(s);
      if (pal && !pal.down) game.dropPallet(s);
      this.flee(s, h, dt);
      return;
    }
    if (s.dangerT > 0) s.dangerT -= dt;

    if (s.channel && s.channel.type === 'heal_other') {
      s.moveX = 0; s.moveY = 0;
      return;
    }

    var remain = game.machinesNeededRemaining ? game.machinesNeededRemaining() : this.countNeeded();
    if (remain <= 0 && s.decoding) game.stopDecode(s);

    /* 逃生(大门已开)：直接逃脱优先于普通救援(门开后不回头救人的死锁) */
    var escOpen = this.escapeGate(s);
    if (escOpen && escOpen.open) {
      var rtU = this.findRescueTarget(s);
      var urgU = !!(rtU && rtU.kind === 'chair' && (rtU.target.total - rtU.target.timer) < 15);
      if (rtU && urgU && s.dangerT <= 0) { this.goToAction(s, rtU, dt); return; }
      if (dist(s.x, s.y, escOpen.x, escOpen.y) < 24) { s.moveX = 0; s.moveY = 0; }
      else this.goTo(s, escOpen.x, escOpen.y, dt);
      return;
    }
    /* 救人(优先于修机)：未被监管者锁定且非守尸死锁时优先 */
    var rescueTarget = this.findRescueTarget(s);
    if (rescueTarget && s.dangerT <= 0) {
      var gd2 = dist(rescueTarget.target.x, rescueTarget.target.y, h.x, h.y);
      var rUrg2 = rescueTarget.kind === 'chair' && (rescueTarget.target.total - rescueTarget.target.timer) < 15;
      // 监管者守在目标旁且救援不紧急 → 放弃本次救援,转修机(避免守尸死锁)
      if (!(gd2 < 180 && !rUrg2)) { this.goToAction(s, rescueTarget, dt); return; }
    }

    /* 安全时治疗受伤队友，优先级低于救援、高于普通破译 */
    var healTarget = this.findHealTarget(s);
    if (healTarget && s.dangerT <= 0 && dist(healTarget.target.x, healTarget.target.y, h.x, h.y) >= 180) {
      this.goToAction(s, healTarget, dt);
      return;
    }

    /* 破译剩余机 */
    if (remain > 0) {
      var m = this.chooseMachine(s);
      if (!m) { s.moveX = 0; s.moveY = 0; return; }
      if (dist(s.x, s.y, m.x, m.y) <= RANGE + 18 && game.canDecode(s, m)) {
        if (s.decoding !== m) game.toggleDecode(s, m);
        if (s.skillCd <= 0 && (s.char.id === 'eng' || s.char.id === 'dec' || s.char.id === 'art')) game.useSurvivorSkill(s);
        s.moveX = 0; s.moveY = 0;
        // 工程师生理上靠近机子才修机，但傀儡技能可远程
      } else {
        if (s.decoding) game.stopDecode(s);
        this.goTo(s, m.x, m.y, dt);
      }
      return;
    }

    /* 逃生：选离监管者最远的通电大门 */
    var g = this.escapeGate(s);
    if (g) {
      if (g.powered && !g.open) {
        if (dist(s.x, s.y, g.x, g.y) <= RANGE + 18) {
          if ((!s.channel || s.channel.type !== 'gate') && game.canOpenGate(s, g)) game.startChannel(s, { type: 'gate', target: g, progress: 0, dur: 2.5 });
          s.moveX = 0; s.moveY = 0;
        } else { if (s.channel) s.channel = null; this.goTo(s, g.x, g.y, dt); }
      } else {
        if (s.channel) s.channel = null;
        this.goTo(s, g.x, g.y, dt);
      }
    }
  };

  SurvivorAI.prototype.escapeGate = function (s) {
    var g = this.game, h = g.hunter;
    var best = null, bestDist = 1e9;
    // 已开启的大门永远优先，避免转去开启另一扇门
    for (var i = 0; i < g.gates.length; i++) {
      var gate = g.gates[i];
      if (!gate.open) continue;
      var openDist = dist(s.x, s.y, gate.x, gate.y);
      if (openDist < bestDist) { bestDist = openDist; best = gate; }
    }
    if (best) return best;
    var bestScore = -1e9;
    for (var j = 0; j < g.gates.length; j++) {
      var closed = g.gates[j];
      if (!closed.powered || closed.open) continue;
      var openers = 0;
      for (var k = 0; k < g.survivors.length; k++) {
        var ch = g.survivors[k].channel;
        if (ch && ch.type === 'gate' && ch.target === closed) openers++;
      }
      // 优先前往队友正在开启的大门；已有两人时在旁等待，避免另开一扇门
      var score = dist(closed.x, closed.y, h.x, h.y) - dist(s.x, s.y, closed.x, closed.y) * 0.5;
      if (openers > 0) score += 10000;
      if (score > bestScore) { bestScore = score; best = closed; }
    }
    return best;
  };

  SurvivorAI.prototype.countRemain = function () {
    var n = 0;
    for (var i = 0; i < this.game.machines.length; i++) if (!this.game.machines[i].decoded) n++;
    return n;
  };

  SurvivorAI.prototype.countNeeded = function () {
    var done = this.game.machines.length - this.countRemain();
    return Math.max(0, (global.MACHINES_NEEDED || 4) - done);
  };

  SurvivorAI.prototype.findRescueTarget = function (s) {
    var g = this.game;
    // 救人优先于修机：先找处刑架(时间紧迫)，再找倒地队友；安全与否由 update 的 dangerT 把关
    var chairTarget = null, cd1 = 1e9;
    for (var i = 0; i < g.survivors.length; i++) {
      var o = g.survivors[i];
      if (o === s || !o.alive || o.escaped || !o.chair || o.carriedBy) continue;
      // 已有其他 AI 正在救援该椅时，避免重复扑救
      var beingRescued = false;
      for (var k = 0; k < g.survivors.length; k++) {
        var other = g.survivors[k];
        if (other === s || !other.alive || other.escaped) continue;
        if (other.channel && other.channel.type === 'rescue' && other.channel.target === o.chair) { beingRescued = true; break; }
      }
      if (beingRescued) continue;
      var d1 = dist(s.x, s.y, o.chair.x, o.chair.y);
      var urgent = (o.chair.total - o.chair.timer) < 22;
      if (d1 < 520 || urgent) { if (d1 < cd1) { cd1 = d1; chairTarget = { x: o.chair.x, y: o.chair.y, kind: 'chair', target: o.chair }; } }
    }
    if (chairTarget) return chairTarget;
    // 倒地队友(次优先)
    var downTarget = null, d2b = 1e9;
    for (var j = 0; j < g.survivors.length; j++) {
      var o2 = g.survivors[j];
      if (o2 === s || !o2.alive || o2.escaped || o2.hp !== 0 || o2.carriedBy || o2.chair) continue;
      var d2 = dist(s.x, s.y, o2.x, o2.y);
      if (d2 < 520 && d2 < d2b) { d2b = d2; downTarget = { x: o2.x, y: o2.y, kind: 'down', target: o2 }; }
    }
    return downTarget;
  };

  SurvivorAI.prototype.findHealTarget = function (s) {
    var g = this.game, best = null, bd = 420;
    for (var i = 0; i < g.survivors.length; i++) {
      var ally = g.survivors[i];
      if (ally === s || !ally.alive || ally.escaped || ally.hp !== 1 || ally.carriedBy || ally.chair) continue;
      var beingHealed = false;
      for (var j = 0; j < g.survivors.length; j++) {
        var other = g.survivors[j];
        if (other === s || !other.channel) continue;
        if (other.channel.type === 'heal_other' && other.channel.target === ally) { beingHealed = true; break; }
      }
      if (beingHealed) continue;
      var d = dist(s.x, s.y, ally.x, ally.y);
      if (d < bd) { bd = d; best = { x: ally.x, y: ally.y, kind: 'heal', target: ally }; }
    }
    return best;
  };

  SurvivorAI.prototype.goToAction = function (s, t, dt) {
    if (s.decoding) this.game.stopDecode(s);
    this.goTo(s, t.x, t.y, dt);
    if (dist(s.x, s.y, t.x, t.y) <= RANGE + 18) {
      if (t.kind === 'chair') {
        if (t.target.occupant && (!s.channel || s.channel.type !== 'rescue')) {
          this.game.startChannel(s, { type: 'rescue', target: t.target, progress: 0, dur: 1.8 });
        }
      } else if (t.kind === 'down') {
        if (t.target.hp === 0 && (!s.channel || s.channel.type !== 'revive')) {
          this.game.startChannel(s, { type: 'revive', target: t.target, progress: 0, dur: 4 / s.stats.heal });
          s.moveX = 0; s.moveY = 0;
        }
      } else if (t.kind === 'heal') {
        if (t.target.hp === 1 && (!s.channel || s.channel.type !== 'heal_other' || s.channel.target !== t.target)) {
          this.game.startChannel(s, { type: 'heal_other', target: t.target, progress: 0, dur: 2.5 / s.stats.heal });
        }
        s.moveX = 0; s.moveY = 0;
      }
    }
  };

  // 多台待完成时分散修机；只差一台时优先合修已有进度的机器
  SurvivorAI.prototype.chooseMachine = function (s) {
    var g = this.game, best = null, bd = 1e9;
    var needed = g.machinesNeededRemaining ? g.machinesNeededRemaining() : this.countNeeded();
    if (needed === 1) {
      var activeBest = null, activeScore = -1e9, hasActive = false;
      for (var w = 0; w < g.machines.length; w++) {
        var staffed = g.machines[w];
        if (staffed.decoded) continue;
        var workers = this.machineWorkers(staffed);
        if (workers <= 0) continue;
        hasActive = true;
        if (this.machineWorkers(staffed, s) >= 2) continue;
        var staffedScore = staffed.progress * 10 - dist(s.x, s.y, staffed.x, staffed.y);
        if (s.decoding === staffed) staffedScore += 100;
        if (staffedScore > activeScore) { activeScore = staffedScore; activeBest = staffed; }
      }
      if (activeBest || hasActive) return activeBest;
      var bestScore = -1e9;
      for (var a = 0; a < g.machines.length; a++) {
        var activeMachine = g.machines[a];
        if (activeMachine.decoded) continue;
        var score = activeMachine.progress * 10 - dist(s.x, s.y, activeMachine.x, activeMachine.y);
        if (score > bestScore) { bestScore = score; best = activeMachine; }
      }
      return best;
    }
    for (var i = 0; i < g.machines.length; i++) {
      var m = g.machines[i];
      if (m.decoded) continue;
      if (this.machineWorkers(m, s) > 0) continue;
      var d = dist(s.x, s.y, m.x, m.y);
      if (d < bd) { bd = d; best = m; }
    }
    if (!best) {
      bd = 1e9;
      for (var j = 0; j < g.machines.length; j++) {
        var fallback = g.machines[j];
        if (fallback.decoded || this.machineWorkers(fallback, s) >= 2) continue;
        var fd = dist(s.x, s.y, fallback.x, fallback.y);
        if (fd < bd) { bd = fd; best = fallback; }
      }
    }
    return best;
  };

  SurvivorAI.prototype.machineWorkers = function (m, exclude) {
    var n = 0;
    for (var i = 0; i < this.game.survivors.length; i++) {
      var s = this.game.survivors[i];
      if (s === exclude || !s.alive || s.escaped || s.carriedBy || s.chair || s.hp <= 0) continue;
      if (s.decoding === m) n++;
    }
    return n;
  };

  SurvivorAI.prototype.goTo = function (s, tx, ty, dt) {
    this.repathT -= dt;
    if (!s.path || s.path.length === 0 || this.repathT <= 0) {
      this.repathT = 0.8;
      s.path = this.game.pathTo(s.x, s.y, tx, ty, { win: true, pal: true });
    }
    this.followPath(s);
  };

  SurvivorAI.prototype.followPath = function (s) {
    if (!s.path || s.path.length === 0) { s.moveX = 0; s.moveY = 0; return; }
    // 翻越落地后：跳过已跨过的窗/倒板节点，避免回头再翻
    if (s.vaultT > 0) {
      var g = this.game;
      while (s.path.length) {
        var w0 = s.path[0];
        var wx = Math.floor(w0.x / g.ts), wy = Math.floor(w0.y / g.ts);
        if (g.tileAt(w0.x, w0.y) === global.TILE.WIN || g.tileIsDownPallet(wx, wy)) s.path.shift();
        else break;
      }
      if (!s.path.length) { s.moveX = 0; s.moveY = 0; return; }
    }
    var w = s.path[0];
    if (dist(s.x, s.y, w.x, w.y) < 10) { s.path.shift(); if (!s.path.length) { s.moveX = 0; s.moveY = 0; return; } w = s.path[0]; }
    var dx = w.x - s.x, dy = w.y - s.y;
    var d = Math.sqrt(dx * dx + dy * dy) || 1;
    s.moveX = dx / d; s.moveY = dy / d;
  };

  SurvivorAI.prototype.flee = function (s, h, dt) {
    this.thinkT -= dt;
    if (!s.path || s.path.length === 0 || this.thinkT <= 0) {
      this.thinkT = 1.1;
      var best = null, bestScore = -1e9;
      for (var i = 0; i < 12; i++) {
        var ang = (i / 12) * Math.PI * 2 + Math.random() * 0.6;
        var tx = s.x + Math.cos(ang) * 260;
        var ty = s.y + Math.sin(ang) * 260;
        var path = this.game.pathTo(s.x, s.y, tx, ty, { win: true, pal: true });
        if (!path || path.length < 3) continue;
        var end = path[path.length - 1];
        var score = dist(end.x, end.y, h.x, h.y) - path.length * 7;
        // 逃跑路线经过窗/倒板可获得地形优势 → 加分(更聪明地利用障碍)
        var g2 = this.game;
        for (var pj = 0; pj < path.length; pj++) {
          var w0 = path[pj];
          var wx = Math.floor(w0.x / g2.ts), wy = Math.floor(w0.y / g2.ts);
          if (g2.tileAt(w0.x, w0.y) === global.TILE.WIN) { score += 42; break; }
          if (g2.tileIsDownPallet(wx, wy)) { score += 90; break; } // 踩板子：大幅加分(高概率看到就翻越,拉开身位)
        }
        if (score > bestScore) { bestScore = score; best = path; }
      }
      s.path = best || [];
    }
    this.followPath(s);
  };

  SurvivorAI.prototype.crawlAway = function (s, h, dt) {
    var dx = s.x - h.x, dy = s.y - h.y;
    var d = Math.sqrt(dx * dx + dy * dy) || 1;
    s.moveX = dx / d; s.moveY = dy / d;
  };

  function dist(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  global.HunterAI = HunterAI;
  global.SurvivorAI = SurvivorAI;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { HunterAI: HunterAI, SurvivorAI: SurvivorAI };
  }
})(typeof window !== 'undefined' ? window : globalThis);
