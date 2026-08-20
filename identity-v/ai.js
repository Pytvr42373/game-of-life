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

    /* 感知 */
    var vis = game.perceiveSurvivors(h);
    if (vis.length) {
      var t = vis[0].s;
      h.target = t;
      h.lastSeen = { x: t.x, y: t.y };
      h.lostT = 0;
      h.state = 'chase';
    } else if (h.state === 'chase') {
      h.lostT += dt;
      if (h.lostT > diff.chaseGiveup) { h.state = 'search'; h.target = null; }
    }

    /* 全视之眼 / 追击技能释放 */
    if (h.state === 'chase') {
      if (h.char.id === 'hun_tele') {
        if (h.skillCd <= 0 && (h.lostT > 1.2 || (h.lastSeen && dist(h.x, h.y, h.lastSeen.x, h.lastSeen.y) > 300))) {
          game.useHunterSkill(h, 1);
        }
        if (h.skill2Cd <= 0 && h.target) game.useHunterSkill(h, 2);
      }
      if (h.char.id === 'hun_chase' && h.skillCd <= 0 && h.target && dist(h.x, h.y, h.target.x, h.target.y) > 180) {
        game.useHunterSkill(h, 1);
      }
    }

    /* 抱起倒地者优先(保证能完成淘汰) */
    var downedT = this.nearestDowned();
    if (downedT && dist(h.x, h.y, downedT.x, downedT.y) < 320) {
      h.target = downedT;
      h.lastSeen = { x: downedT.x, y: downedT.y };
      h.state = 'chase';
    }

    /* 状态执行 */
    if (h.state === 'chase') {
      var target = h.target;
      if (target && target.alive && !target.escaped && target.hp >= 0) {
        h.lastSeen = { x: target.x, y: target.y };
        var d = dist(h.x, h.y, target.x, target.y);
        // 目标已倒地且近身：牵制
        if (target.hp === 0 && d < RANGE + 22) { game.hunterInteract(h); return; }
        if (d < h.char.stats.atkRange + 10 && h.atkCd <= 0) {
          if (!game.hunterAttack(h)) {
            // 没打中，破坏挡路的板子
            this.tryBreakPallet();
          }
        } else if (this.pathBroken()) {
          this.tryBreakPallet();
        }
        this.moveToward(h, target.x, target.y, dt);
      } else {
        h.state = 'search';
      }
      return;
    }

    if (h.state === 'search') {
      if (h.lastSeen) {
        this.moveToward(h, h.lastSeen.x, h.lastSeen.y, dt);
        if (dist(h.x, h.y, h.lastSeen.x, h.lastSeen.y) < 28) { h.state = 'patrol'; h.lastSeen = null; }
      } else h.state = 'patrol';
      return;
    }

    if (h.state === 'guard') {
      h.guardT -= dt;
      // 守尸：在椅子附近巡逻
      var guardChair = this.nearestOccupiedChair();
      if (guardChair) {
        if (dist(h.x, h.y, guardChair.x, guardChair.y) > 60) this.moveToward(h, guardChair.x, guardChair.y, dt);
        else { h.moveX = 0; h.moveY = 0; this.thinkT -= dt; }
      }
      if (h.guardT <= 0) h.state = 'patrol';
      return;
    }

    /* 巡逻 */
    this.patrol(h, dt);
  };

  HunterAI.prototype.nearestFreeChair = function () {
    var g = this.game, best = null, bd = 1e9;
    for (var i = 0; i < g.chairs.length; i++) {
      var c = g.chairs[i];
      if (c.occupant) continue;
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
      var candidates = [];
      for (var i = 0; i < g.machines.length; i++) candidates.push(g.machines[i]);
      for (var j = 0; j < g.chairs.length; j++) candidates.push(g.chairs[j]);
      for (var k = 0; k < g.gates.length; k++) candidates.push(g.gates[k]);
      var c = candidates[Math.floor(Math.random() * candidates.length)];
      if (c) {
        h.path = g.pathTo(h.x, h.y, c.x, c.y, { win: true });
        h.pathIdx = 0;
      }
    }
    this.followPath(h, dt);
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
      // 保命技能
      if (s.skillCd <= 0) {
        if (s.char.id === 'run' || s.char.id === 'gho' || s.char.id === 'gua') game.useSurvivorSkill(s);
      }
      // 板子旁下板
      var pal = game.standingOnPallet(s);
      if (pal && !pal.down) game.dropPallet(s);
      this.flee(s, h, dt);
      return;
    }
    if (s.dangerT > 0) s.dangerT -= dt;

    /* 救人(优先) */
    var rescueTarget = this.findRescueTarget(s);
    if (rescueTarget && d < 620 && s.dangerT <= 0) {
      this.goToAction(s, rescueTarget, dt);
      return;
    }

    /* 破译剩余机 */
    var remain = game.machinesRemaining ? game.machinesRemaining() : this.countRemain();
    if (remain > 0) {
      var m = game.nearestMachine(s.x, s.y, true);
      if (m && dist(s.x, s.y, m.x, m.y) <= RANGE + 18 && !m.occupiedBy) {
        if (s.decoding !== m) game.toggleDecode(s);
        if (s.skillCd <= 0 && (s.char.id === 'eng' || s.char.id === 'dec')) game.useSurvivorSkill(s);
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
          if (!s.channel || s.channel.type !== 'gate') game.startChannel(s, { type: 'gate', target: g, progress: 0, dur: 2.5 });
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
    var best = null, bestScore = -1e9;
    for (var i = 0; i < g.gates.length; i++) {
      var gate = g.gates[i];
      if (gate.powered && !gate.open) {
        // 离监管者越远越好(绕开守门)
        var score = dist(gate.x, gate.y, h.x, h.y) - dist(s.x, s.y, gate.x, gate.y) * 0.5;
        if (score > bestScore) { bestScore = score; best = gate; }
      }
    }
    if (best) return best;
    // 兜底：最近的已开启大门
    for (var j = 0; j < g.gates.length; j++) {
      if (g.gates[j].open) { if (!best || dist(s.x, s.y, g.gates[j].x, g.gates[j].y) < dist(s.x, s.y, best.x, best.y)) best = g.gates[j]; }
    }
    return best;
  };

  SurvivorAI.prototype.countRemain = function () {
    var n = 0;
    for (var i = 0; i < this.game.machines.length; i++) if (!this.game.machines[i].decoded) n++;
    return n;
  };

  SurvivorAI.prototype.findRescueTarget = function (s) {
    var g = this.game, best = null, bd = 1e9;
    var remain = g.machinesRemaining ? g.machinesRemaining() : this.countRemain();
    for (var i = 0; i < g.survivors.length; i++) {
      var o = g.survivors[i];
      if (o === s || !o.alive || o.escaped) continue;
      if (o.chair && !o.carriedBy) {
        // 椅子救援仅当：密码机还多(>1台) 且 距离较近，或 椅子即将淘汰(紧急)
        var d1 = dist(s.x, s.y, o.chair.x, o.chair.y);
        var urgent = (o.chair.total - o.chair.timer) < 22;
        if (remain > 1 && (d1 < 380 || urgent)) {
          if (d1 < bd) { bd = d1; best = { x: o.chair.x, y: o.chair.y, kind: 'chair', target: o.chair }; }
        }
      } else if (o.hp === 0 && !o.carriedBy && !o.chair) {
        // 倒地队友治疗：距离内且相对安全
        var d2 = dist(s.x, s.y, o.x, o.y);
        if (d2 < 420 && d2 < bd) { bd = d2; best = { x: o.x, y: o.y, kind: 'down', target: o }; }
      }
    }
    return best;
  };

  SurvivorAI.prototype.goToAction = function (s, t, dt) {
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
      }
    }
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

  global.HunterAI = HunterAI;
  global.SurvivorAI = SurvivorAI;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { HunterAI: HunterAI, SurvivorAI: SurvivorAI };
  }
})(typeof window !== 'undefined' ? window : globalThis);
