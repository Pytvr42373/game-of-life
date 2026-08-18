/* ============================================================
 * game.js - 核心逻辑引擎 (黎明迷局)
 * 移动碰撞 / BFS寻路 / 修机+校准 / 攻击 / 倒地-牵制-处刑 / 治疗 / 逃生门 / 胜负
 * 纯逻辑，不依赖 DOM，可在 node 中直接驱动测试。
 * ============================================================ */
(function (global) {
  'use strict';

  /* ---------- 常量 ---------- */
  var TILE = 42;
  var BASE_SPEED = 142;         // 求生者基准移速 px/s
  var RANGE = 46;               // 交互距离
  var MACHINES_NEEDED = 3;      // 需破译的密码机数量
  var CHAIR_TOTAL = 66;         // 处刑倒计时秒
  var DECODE_RATE = 14;         // 单人基础修机速率 /s

  var DIFF = {
    easy:      { name: '休闲', hunterSpeed: 0.92, vision: 250, atkCdMul: 1.20, chaseGiveup: 6, guardTime: 6,  carrySlow: 0.74, struggle: 0.95, huntDecode: 0.0 },
    normal:    { name: '普通', hunterSpeed: 0.96, vision: 270, atkCdMul: 1.00, chaseGiveup: 4, guardTime: 7,  carrySlow: 0.70, struggle: 0.70, huntDecode: 0.0 },
    nightmare: { name: '噩梦', hunterSpeed: 1.08, vision: 345, atkCdMul: 0.82, chaseGiveup: 4, guardTime: 10, carrySlow: 0.66, struggle: 0.50, huntDecode: 0.0 }
  };

  /* ---------- 工具 ---------- */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function dist(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); }
  function normAng(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
  function angDiff(a, b) { return Math.abs(normAng(a - b)); }

  /* ---------- Game ---------- */
  function Game() {
    this.state = 'menu';
    this.difficulty = 'normal';
    this.map = null;
    this.grid = null;
    this.ts = TILE;
    this.cols = 0; this.rows = 0;
    this.machines = []; this.chairs = []; this.gates = []; this.pallets = []; this.windows = [];
    this.survivors = [];
    this.hunter = null;
    this.player = null;
    this.playerIsHunter = false;
    this.cam = { x: 0, y: 0, shake: 0 };
    this.time = 0;
    this.check = null;            // 校准事件
    this.particles = [];
    this.floaters = [];
    this.result = null;
    this.fogSeed = Math.random() * 100;
    this.reveal = 0;              // 监管者全视倒计时
    this.input = { x: 0, y: 0, attack: false, interact: false, skill: false, skill2: false, crouch: false, pause: false };
    this._attackQueued = false;
    this._interactQueued = false;
    this._skillQueued = false;
    this._skill2Queued = false;
    this.heartRate = 0;
    this._tick = 0;
    this._matchId = 0;
    this.vignette = 0;
    this._checkTimer = 0;
    this.settings = { volume: 0.7, muted: false, reducedMotion: false };
  }

  Game.prototype = {
    constructor: Game,

    /* ---------- 地图与开局 ---------- */
    loadMap: function (mapIdx) {
      var def = MAPS[mapIdx % MAPS.length];
      var m = parseMap(def);
      this.map = m;
      this.grid = m.grid;
      this.ts = m.ts;
      this.cols = m.cols; this.rows = m.rows;
      this.machines = m.entities.machines;
      this.chairs = m.entities.chairs;
      this.gates = m.entities.gates;
      this.pallets = m.entities.pallets;
      this.windows = m.entities.windows;
      return m;
    },

    startMatch: function (opts) {
      opts = opts || {};
      this.difficulty = opts.difficulty || 'normal';
      this.settings.volume = opts.volume != null ? opts.volume : this.settings.volume;
      var diff = DIFF[this.difficulty] || DIFF.normal;
      this.loadMap(opts.mapIdx || 0);
      this.time = 0;
      this.state = 'playing';
      this.result = null;
      this.check = null;
      this.particles = [];
      this.floaters = [];
      this._matchId++;
      this._lastOpts = opts;
      this.playerIsHunter = !!opts.asHunter;
      this.reveal = 0;
      this.input = { x: 0, y: 0, attack: false, interact: false, skill: false, skill2: false, crouch: false, pause: false };
      this._attackQueued = false;
      this._interactQueued = false;
      this._skillQueued = false;
      this._skill2Queued = false;

      var E = this.map.entities;
      var spawns = E.spawns.slice();
      var hs = E.hunterSpawn || { x: this.ts * 3, y: this.ts * 3 };

      this.survivors = [];
      var chosenId = opts.charId || 'med';
      var others = SURVIVORS.filter(function (c) { return c.id !== chosenId; });
      var comps = [getSurvivor(chosenId)];
      for (var i = 0; i < 2; i++) comps.push(others[i % others.length]);

      for (var s = 0; s < 3; s++) {
        var sp = spawns[s % spawns.length];
        var sv = this._makeSurvivor(comps[s], sp.x, sp.y, (opts.asHunter ? false : (s === 0)));
        if (s === 0) { sv.isPlayer = !opts.asHunter; }
        else sv.isPlayer = false;
        this.survivors.push(sv);
      }
      if (!opts.asHunter) this.player = this.survivors[0];
      else this.player = null;

      var hchar = getHunter(opts.hunterId || 'hun_chase');
      this.hunter = this._makeHunter(hchar, hs.x, hs.y);
      this.hunter.isPlayer = this.playerIsHunter;
      this.hunter.isAI = !this.playerIsHunter;
      if (opts.asHunter) this.player = this.hunter;

      // AI 初始化
      for (var k = 0; k < this.survivors.length; k++) {
        var s2 = this.survivors[k];
        if (!s2.isPlayer) s2.ai = new SurvivorAI(s2, this);
        s2.isAI = !s2.isPlayer;
      }
      this.hunter.ai = new HunterAI(this.hunter, this);
      this.hunter.ai.active = this.hunter.isAI;

      this.cam.x = this.player ? this.player.x : this.hunter.x;
      this.cam.y = this.player ? this.player.y : this.hunter.y;
      this._resetHeart();
    },

    _makeSurvivor: function (ch, x, y, isPlayer) {
      var st = ch.stats;
      return {
        kind: 'survivor', char: ch, id: ch.id, name: ch.name, title: ch.title,
        isPlayer: !!isPlayer, isAI: false, isHunter: false,
        x: x, y: y, r: 13, dir: 0,
        hp: 2, alive: true, escaped: false,
        shield: 0, invisible: 0, sprintT: 0, decodeBoostT: 0, ironwallT: 0,
        skillCd: 0, skillOn: 0, skillActive: false,
        decoding: null,
        carriedBy: null, carryStruggle: 0,
        chair: null,
        vaultT: 0, stunT: 0, hurtFlash: 0,
        channel: null,           // {type, target, progress, dur}
        healTarget: null,
        path: [], pathIdx: 0, repathT: 0,
        moveX: 0, moveY: 0,
        dangerT: 0, fleeing: false,
        ai: null,
        stats: { speed: st.speed, decode: st.decode, heal: st.heal, selfHeal: st.selfHeal, vault: st.vault },
        scoreT: 0, decodeScore: 0, chaseT: 0,
        aura: ch.color
      };
    },

    _makeHunter: function (ch, x, y) {
      return {
        kind: 'hunter', char: ch, id: ch.id, name: ch.name, title: ch.title,
        isPlayer: false, isAI: false, isHunter: true,
        x: x, y: y, r: 15, dir: 0,
        attacking: 0, atkT: 0, atkCd: 0,
        carrying: null, carryDropCd: 0,
        stunT: 0, hurtFlash: 0, dashT: 0, dashDir: 0, chaseBoostT: 0,
        skillCd: 0, skill2Cd: 0,
        state: 'patrol', target: null, lastSeen: null, lostT: 0, guardT: 0,
        path: [], pathIdx: 0, repathT: 0,
        moveX: 0, moveY: 0,
        ai: null,
        visionBase: ch.stats.vision,
        scoreT: 0, scoreElim: 0, scoreHit: 0,
        aura: ch.color
      };
    },

    /* ---------- 网格辅助 ---------- */
    tileAt: function (px, py) {
      var tx = Math.floor(px / this.ts), ty = Math.floor(py / this.ts);
      if (tx < 0 || ty < 0 || tx >= this.cols || ty >= this.rows) return TILE.WALL;
      return this.grid[ty][tx];
    },
    tileIsSolid: function (tx, ty) {
      if (tx < 0 || ty < 0 || tx >= this.cols || ty >= this.rows) return true;
      return tileSolid(this.grid[ty][tx]);
    },
    tileIsDownPallet: function (tx, ty) {
      if (tx < 0 || ty < 0 || tx >= this.cols || ty >= this.rows) return false;
      if (this.grid[ty][tx] === TILE.PAL) {
        for (var i = 0; i < this.pallets.length; i++) {
          if (this.pallets[i].tx === tx && this.pallets[i].ty === ty && this.pallets[i].down) return true;
        }
      }
      return false;
    },
    collidesAt: function (ent, nx, ny) {
      var r = ent.r, ts = this.ts;
      var corners = [[nx - r, ny - r], [nx + r, ny - r], [nx - r, ny + r], [nx + r, ny + r]];
      for (var i = 0; i < 4; i++) {
        var tx = Math.floor(corners[i][0] / ts), ty = Math.floor(corners[i][1] / ts);
        if (this.tileIsSolid(tx, ty)) return true;
        if (this.tileIsDownPallet(tx, ty)) return true;
      }
      return false;
    },

    /* ---------- 移动 ---------- */
    moveEntity: function (ent, dt) {
      if (ent.vaultT > 0 || ent.stunT > 0) return;
      var sp = ent.kind === 'survivor' ? this.survivorSpeed(ent) : this.hunterSpeed();
      if (ent.carriedBy) return; // 被牵制无法移动

      // 先尝试翻窗
      if (ent.kind === 'survivor' || ent.kind === 'hunter') {
        if (this._tryVault(ent)) return;
      }

      var dx = ent.moveX * sp * dt;
      var dy = ent.moveY * sp * dt;
      if (!ent.isHunter) {
        // 求生者被牵制时不能动
      }
      // X 轴
      var nx = ent.x + dx;
      if (!this.collidesAt(ent, nx, ent.y)) ent.x = nx;
      // Y 轴
      var ny = ent.y + dy;
      if (!this.collidesAt(ent, ent.x, ny)) ent.y = ny;
      if (dx !== 0 || dy !== 0) {
        ent.dir = Math.atan2(dy, dx);
      }
    },

    _tryVault: function (ent) {
      // 若即将踏入窗户格，触发翻窗
      var ts = this.ts;
      var mvx = ent.moveX, mvy = ent.moveY;
      var aheadX = ent.x + Math.sign(mvx) * (ent.r + this.ts * 0.55);
      var aheadY = ent.y + Math.sign(mvy) * (ent.r + this.ts * 0.55);
      if (mvx === 0 && mvy === 0) return false;
      var checkX = Math.abs(mvx) >= Math.abs(mvy) ? aheadX : ent.x;
      var checkY = Math.abs(mvy) > Math.abs(mvx) ? aheadY : ent.y;
      var tx = Math.floor(checkX / ts), ty = Math.floor(checkY / ts);
      if (tx < 0 || ty < 0 || tx >= this.cols || ty >= this.rows) return false;
      if (this.grid[ty][tx] !== TILE.WIN) return false;

      var dirX = Math.sign(mvx) || 0, dirY = Math.sign(mvy) || 0;
      // 朝移动方向的窗户对面
      if (Math.abs(mvx) >= Math.abs(mvy)) {
        var ntx = tx + dirX;
        if (ntx < 0 || ntx >= this.cols || this.tileIsSolid(ntx, ty) || this.tileIsDownPallet(ntx, ty)) return false;
        var dur = ent.kind === 'survivor' ? (0.45 / (ent.stats ? ent.stats.vault : 1)) : 0.8;
        ent.x = ntx * ts + ts / 2;
        ent.y = ty * ts + ts / 2;
        ent.vaultT = dur;
        return true;
      } else {
        var nty = ty + dirY;
        if (nty < 0 || nty >= this.rows || this.tileIsSolid(tx, nty) || this.tileIsDownPallet(tx, nty)) return false;
        var dur2 = ent.kind === 'survivor' ? (0.45 / (ent.stats ? ent.stats.vault : 1)) : 0.8;
        ent.x = tx * ts + ts / 2;
        ent.y = nty * ts + ts / 2;
        ent.vaultT = dur2;
        return true;
      }
    },

    survivorSpeed: function (s) {
      var diff = DIFF[this.difficulty];
      var sp = BASE_SPEED * s.stats.speed;
      if (s.hp === 1) sp *= 0.85;
      if (s.hp === 0) sp *= 0.35;
      if (s.sprintT > 0) sp *= 1.65;
      return sp;
    },

    hunterSpeed: function () {
      var h = this.hunter;
      var diff = DIFF[this.difficulty];
      var sp = BASE_SPEED * h.char.stats.speed * diff.hunterSpeed;
      if (h.dashT > 0) sp *= 2.3;
      if (h.carrying) sp *= diff.carrySlow;
      if (h.chaseBoostT > 0) sp *= 1.15;
      if (h.stunT > 0) sp = 0;
      return sp;
    },

    /* ---------- BFS 寻路 ---------- */
    pathTo: function (sx, sy, gx, gy, allowWin) {
      var ts = this.ts;
      var stx = clamp(Math.floor(sx / ts), 0, this.cols - 1);
      var sty = clamp(Math.floor(sy / ts), 0, this.rows - 1);
      var gtx = clamp(Math.floor(gx / ts), 0, this.cols - 1);
      var gty = clamp(Math.floor(gy / ts), 0, this.rows - 1);
      if (this.tileIsSolid(gtx, gty) || this.tileIsDownPallet(gtx, gty)) {
        // 找邻近可行走格
        var found = null;
        outer:
        for (var rr = 1; rr < 6; rr++) {
          for (var oy = -rr; oy <= rr; oy++) for (var ox = -rr; ox <= rr; ox++) {
            var nx = gtx + ox, ny = gty + oy;
            if (nx < 0 || ny < 0 || nx >= this.cols || ny >= this.rows) continue;
            if (this.tileIsSolid(nx, ny) || this.tileIsDownPallet(nx, ny)) continue;
            found = [nx, ny]; break outer;
          }
        }
        if (!found) return [];
        gtx = found[0]; gty = found[1];
      }
      var key = function (x, y) { return x + ',' + y; };
      var startKey = key(stx, sty);
      if (startKey === key(gtx, gty)) return [{ x: sx, y: sy }];
      var prev = {};
      prev[startKey] = null;
      var queue = [[stx, sty]];
      var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      var foundEnd = null;
      while (queue.length) {
        var cur = queue.shift();
        if (cur[0] === gtx && cur[1] === gty) { foundEnd = cur; break; }
        for (var i = 0; i < 4; i++) {
          var nx2 = cur[0] + dirs[i][0], ny2 = cur[1] + dirs[i][1];
          if (nx2 < 0 || ny2 < 0 || nx2 >= this.cols || ny2 >= this.rows) continue;
          if (this.tileIsSolid(nx2, ny2) || this.tileIsDownPallet(nx2, ny2)) continue;
          var k2 = key(nx2, ny2);
          if (prev[k2] === undefined) { prev[k2] = cur; queue.push([nx2, ny2]); }
        }
      }
      if (!foundEnd) return [];
      var path = [];
      var node = foundEnd;
      while (node) { path.push({ x: node[0] * ts + ts / 2, y: node[1] * ts + ts / 2 }); node = prev[key(node[0], node[1])]; }
      path.reverse();
      return path;
    },

    /* ---------- 感知 / 视线 ---------- */
    lineOfSight: function (x1, y1, x2, y2) {
      var d = dist(x1, y1, x2, y2);
      var steps = Math.ceil(d / 14);
      for (var i = 1; i < steps; i++) {
        var t = i / steps;
        var px = lerp(x1, x2, t), py = lerp(y1, y2, t);
        var c = this.tileAt(px, py);
        if (c === TILE.WALL || c === TILE.WIN) return false;
        if (this.tileIsDownPallet(Math.floor(px / this.ts), Math.floor(py / this.ts))) return false;
      }
      return true;
    },

    perceiveSurvivors: function (hunter) {
      var diff = DIFF[this.difficulty];
      var out = [];
      for (var i = 0; i < this.survivors.length; i++) {
        var s = this.survivors[i];
        if (!s.alive || s.escaped) continue;
        if (s.chair) continue; // 已在处刑架上，不再追击
        if (s.invisible > 0) continue;
        var vis = hunter.visionBase * diff.vision / 300;
        // 隐匿者被动：被发现距离降低
        if (s.char && s.char.id === 'gho') vis *= 0.65;
        if (s.isPlayer && this.input.crouch) vis *= 0.85;
        if (s.char && s.char.id === 'gho' && this.input.crouch) vis *= 0.8;
        var d = dist(hunter.x, hunter.y, s.x, s.y);
        if (d < vis && this.lineOfSight(hunter.x, hunter.y, s.x, s.y)) {
          out.push({ s: s, d: d });
        }
      }
      out.sort(function (a, b) { return a.d - b.d; });
      return out;
    },

    /* ---------- 玩家输入 ---------- */
    updateInput: function (inp) {
      var prev = this.input;
      this.input = inp || { x: 0, y: 0, attack: false, interact: false, skill: false, skill2: false, crouch: false, pause: false };
      if (this.input.attack && !prev.attack) this._attackQueued = true;
      if (this.input.interact && !prev.interact) this._interactQueued = true;
      if (this.input.skill && !prev.skill) this._skillQueued = true;
      if (this.input.skill2 && !prev.skill2) this._skill2Queued = true;
      if (this.input.pause && !prev.pause && this.state === 'playing') this.state = 'paused';
    },

    /* ---------- 主循环 ---------- */
    update: function (dt) {
      if (this.state !== 'playing') return;
      dt = Math.min(dt, 0.05);
      this.time += dt;
      this._tick++;

      var diff = DIFF[this.difficulty];
      var h = this.hunter;
      var p = this.player;

      /* 通用计时 */
      if (h.atkCd > 0) h.atkCd -= dt;
      if (h.attacking > 0) h.attacking -= dt;
      if (h.stunT > 0) h.stunT -= dt;
      if (h.dashT > 0) h.dashT -= dt;
      if (h.chaseBoostT > 0) h.chaseBoostT -= dt;
      if (h.skillCd > 0) h.skillCd -= dt;
      if (h.skill2Cd > 0) h.skill2Cd -= dt;
      if (this.reveal > 0) this.reveal -= dt;
      if (h.carrying) h.carryDropCd = (h.carryDropCd || 0) - dt;

      for (var i = 0; i < this.survivors.length; i++) {
        var s = this.survivors[i];
        if (!s.alive) continue;
        if (s.skillCd > 0) s.skillCd -= dt;
        if (s.vaultT > 0) s.vaultT -= dt;
        if (s.stunT > 0) s.stunT -= dt;
        if (s.hurtFlash > 0) s.hurtFlash -= dt;
        if (s.shield > 0) s.shield -= dt;
        if (s.invisible > 0) { s.invisible -= (this.input.crouch && s.isPlayer ? dt * 0.6 : dt); if (s.invisible < 0) s.invisible = 0; }
        if (s.sprintT > 0) s.sprintT -= dt;
        if (s.decodeBoostT > 0) s.decodeBoostT -= dt;
        if (s.ironwallT > 0) s.ironwallT -= dt;
        s.moveX = 0; s.moveY = 0;
        if (s.escaped) { s.moveX = 0; s.moveY = 0; }
      }

      /* 玩家控制 */
      if (p) {
        if (p.kind === 'survivor') {
          p.moveX = this.input.x;
          p.moveY = this.input.y;
          if (p.hp === 0) { p.moveX *= 0.5; p.moveY *= 0.5; }
          if (p.carriedBy || p.chair) { p.moveX = 0; p.moveY = 0; }
        } else {
          h.moveX = this.input.x;
          h.moveY = this.input.y;
        }
      }

      /* 玩家交互 / 技能事件 */
      if (this._attackQueued) {
        if (p && p.kind === 'hunter') this.hunterAttack(h);
        this._attackQueued = false;
      }
      if (this._interactQueued) {
        if (p) {
          if (p.kind === 'survivor') this.survivorInteract(p);
          else this.hunterInteract(h);
        }
        this._interactQueued = false;
      }
      if (this._skillQueued) {
        if (p) {
          if (p.kind === 'survivor') this.useSurvivorSkill(p);
          else this.useHunterSkill(h, 1);
        }
        this._skillQueued = false;
      }
      if (this._skill2Queued) {
        if (p && p.kind === 'hunter') this.useHunterSkill(h, 2);
        this._skill2Queued = false;
      }

      /* AI */
      if (h.ai && h.isAI) h.ai.update(dt);
      for (var a = 0; a < this.survivors.length; a++) {
        if (this.survivors[a].ai) this.survivors[a].ai.update(dt);
      }

      /* 移动 */
      if (h.alive !== false) this.moveEntity(h, dt);
      if (h.carrying && h.alive !== false) {
        h.carrying.x = h.x + Math.cos(h.dir) * 20;
        h.carrying.y = h.y + Math.sin(h.dir) * 20;
        this.updateStruggle(h.carrying, dt);
      }
      for (var m = 0; m < this.survivors.length; m++) {
        var sm = this.survivors[m];
        if (!sm.alive || sm.escaped) continue;
        if (sm.carriedBy) continue;
        if (sm.chair) continue;
        this.moveEntity(sm, dt);
        sm.scoreT += dt;
        if (sm.hp === 1) sm.chaseT += dt;
      }

      /* 修机 / 校准 */
      this.updateDecoding(dt);
      this.updateCheck(dt);

      /* 战斗 / 攻击命中窗口 */
      if (h.attacking > 0 && h.atkT > 0) {
        h.atkT -= dt;
        if (h.atkT <= 0) h.atkT = 0;
      }

      /* 处刑架倒计时 / 通道(治疗/救援/开门) / 牵制挣扎 */
      this.updateChairs(dt);
      this.updateChannels(dt);
      this.updateGates(dt);

      /* 受伤的出血/眩晕等效果 */
      this.updateEffects(dt);

      /* 心跳 */
      this.updateHeartbeat(dt);

      /* 胜负判定 */
      this.checkWin();

      /* 相机 */
      if (p) {
        this.cam.x = lerp(this.cam.x, p.x, Math.min(1, dt * 6));
        this.cam.y = lerp(this.cam.y, p.y, Math.min(1, dt * 6));
      }
      if (this.cam.shake > 0) this.cam.shake -= dt;
      var mx = this.cols * this.ts, my = this.rows * this.ts;
      this.cam.x = clamp(this.cam.x, 320, mx - 320);
      this.cam.y = clamp(this.cam.y, 240, my - 240);
      if (mx < 640) this.cam.x = mx / 2;
      if (my < 480) this.cam.y = my / 2;
    },

    /* ---------- 修机 ---------- */
    canDecode: function (s, m) {
      if (!m || m.decoded) return false;
      if (m.occupiedBy && m.occupiedBy !== s.id) return false;
      if (s.hp === 0 || s.carriedBy || s.chair || s.escaped || !s.alive) return false;
      return true;
    },

    toggleDecode: function (s) {
      var m = this.nearestMachine(s.x, s.y, true);
      if (!m || dist(s.x, s.y, m.x, m.y) > RANGE + 18) { this.stopDecode(s); return; }
      if (s.decoding === m) { this.stopDecode(s); return; }
      this.stopDecode(s);
      s.decoding = m;
      m.occupiedBy = s.id;
      m.decoders = (m.decoders || 0) + 1;
    },

    stopDecode: function (s) {
      if (s.decoding) {
        var m = s.decoding;
        s.decoding = null;
        m.occupiedBy = null;
        m.decoders = Math.max(0, (m.decoders || 1) - 1);
      }
      if (this.check && this.check.decoder === s) this.check = null;
    },

    machinesRemaining: function () {
      var n = 0;
      for (var i = 0; i < this.machines.length; i++) if (!this.machines[i].decoded) n++;
      return n;
    },

    nearestMachine: function (x, y, uncomplete) {
      var best = null, bd = 1e9;
      for (var i = 0; i < this.machines.length; i++) {
        var m = this.machines[i];
        if (uncomplete && m.decoded) continue;
        var d = dist(x, y, m.x, m.y);
        if (d < bd) { bd = d; best = m; }
      }
      return best;
    },

    updateDecoding: function (dt) {
      for (var i = 0; i < this.machines.length; i++) {
        var m = this.machines[i];
        if (m.decoded) continue;
        var added = 0;
        // 真人解码
        for (var s = 0; s < this.survivors.length; s++) {
          var sv = this.survivors[s];
          if (!sv.alive || sv.escaped) continue;
          if (sv.decoding === m && !sv.carriedBy && !sv.chair && sv.hp > 0) {
            if (this.check && this.check.decoder === sv) continue; // 校准中暂停
            var rate = DECODE_RATE * sv.stats.decode * (sv.decodeBoostT > 0 ? 2 : 1);
            if (sv.char.id === 'eng' && sv.hp === 1) rate *= 0.75;
            added += rate * dt;
          }
        }
        if (m.ghost > 0) added += 6 * m.ghost * dt;
        if (added > 0) {
          m.progress = Math.min(m.max, m.progress + added);
          if (m.progress >= m.max) {
            m.decoded = true;
            m.occupiedBy = null;
            this.spawnParticle(m.x, m.y, 'spark', 40);
            if (AudioSys && AudioSys.machineDone) AudioSys.machineDone();
            this.addFloater(m.x, m.y - 20, '破译完成!', '#ffe29a');
            this.checkGatePower();
          }
        }
      }
      // 校准事件生成
      if (this.player && this.player.kind === 'survivor' && this.player.decoding && !this.check) {
        var pm = this.player.decoding;
        if (pm && !pm.decoded) {
          this._checkTimer = (this._checkTimer || 0) - dt;
          if (this._checkTimer <= 0) {
            this._checkTimer = 2.6 + Math.random() * 2.4;
            this.spawnCheck(this.player, pm);
          }
        }
      } else if (this.player && this.player.kind === 'survivor' && !this.player.decoding) {
        this._checkTimer = 0;
      }
    },

    spawnCheck: function (sv, m) {
      var zoneC = 0.25 + Math.random() * 0.5;
      var zoneW = sv.char.id === 'dec' ? 0.13 : 0.08;
      this.check = {
        machine: m, decoder: sv, t: 0, timeout: 2.6,
        period: 1.3 + Math.random() * 0.5,
        zoneC: zoneC, zoneW: zoneW, hit: false, done: false
      };
    },

    updateCheck: function (dt) {
      var c = this.check;
      if (!c) return;
      c.t += dt;
      // 如果解码者离开/倒地/机完成，取消
      var sv = c.decoder;
      if (!sv || !sv.alive || sv.escaped || sv.decoding !== c.machine || sv.hp === 0 || sv.carriedBy || c.machine.decoded) {
        this.check = null;
        return;
      }
      if (c.t >= c.timeout) {
        this.resolveCheck(false);
      }
    },

    pressCheck: function () {
      var c = this.check;
      if (!c) return;
      var pos = 0.5 + Math.sin((c.t / c.period) * Math.PI * 2) * 0.42;
      var good = Math.abs(pos - c.zoneC) <= c.zoneW + 0.16;
      var perfect = Math.abs(pos - c.zoneC) <= c.zoneW;
      this.resolveCheck(perfect || good);
    },

    resolveCheck: function (good) {
      var c = this.check;
      if (!c || c.done) return;
      c.done = true;
      var m = c.machine;
      if (good) {
        if (Math.abs((0.5 + Math.sin((c.t / c.period) * Math.PI * 2) * 0.42) - c.zoneC) <= c.zoneW) {
          m.progress = Math.min(m.max, m.progress + 4);
          this.addFloater(m.x, m.y - 30, '完美! +4%', '#7dffb0');
          if (AudioSys.checkPerfect) AudioSys.checkPerfect();
          this.spawnParticle(m.x, m.y, 'spark', 16);
        } else {
          m.progress = Math.min(m.max, m.progress + 1.2);
          this.addFloater(m.x, m.y - 30, '校准 +1.2%', '#ffe29a');
          if (AudioSys.checkGood) AudioSys.checkGood();
        }
      } else {
        var dec = c.decoder;
        if (!(dec && dec.char.id === 'dec')) {
          m.progress = Math.max(0, m.progress - 2);
        }
        this.addFloater(m.x, m.y - 30, '校准失败!', '#ff6a6a');
        if (AudioSys.checkFail) AudioSys.checkFail();
        this.spawnParticle(m.x, m.y, 'boom', 20);
        // 炸机暴露：若监管者附近则被吸引
        var h = this.hunter;
        if (h && dist(h.x, h.y, m.x, m.y) < 420) {
          h.lastSeen = { x: m.x, y: m.y };
          if (h.state === 'patrol' || h.state === 'search') h.state = 'search';
        }
      }
      this.check = null;
    },

    /* ---------- 攻击 / 战斗 ---------- */
    hunterAttack: function (h) {
      if (h.atkCd > 0 || h.stunT > 0 || h.carrying) return false;
      h.atkCd = h.char.stats.atkCd * DIFF[this.difficulty].atkCdMul;
      h.attacking = 0.35;
      h.atkT = 0.12;
      if (AudioSys.hit) AudioSys.hit();
      var hitAny = false;
      for (var i = 0; i < this.survivors.length; i++) {
        var s = this.survivors[i];
        if (!s.alive || s.escaped) continue;
        if (s.chair) continue;
        if (s.invisible > 0) continue;
        var d = dist(h.x, h.y, s.x, s.y);
        if (d > h.char.stats.atkRange + s.r) continue;
        var ang = angDiff(h.dir, Math.atan2(s.y - h.y, s.x - h.x));
        if (ang > 1.0) continue;
        this.applyDamage(s, h);
        hitAny = true;
        if (h.char.id === 'hun_chase') h.chaseBoostT = 2;
      }
      return hitAny;
    },

    applyDamage: function (s, h) {
      if (!s.alive || s.escaped) return;
      if (s.carriedBy) return;
      // 护盾
      if (s.shield > 0) {
        s.shield = 0;
        s.stunT = 0.4;
        if (AudioSys.shield) AudioSys.shield();
        this.addFloater(s.x, s.y - 24, '护盾格挡!', '#9ad8ff');
        this.spawnParticle(s.x, s.y, 'shield', 14);
        return;
      }
      // 铁壁减伤(守护者被动)
      var dmg = h.dashT > 0 ? 2 : 1;
      if (s.ironwallT > 0 && dmg === 1) {
        s.ironwallT = 0;
        this.addFloater(s.x, s.y - 24, '铁壁减伤!', '#c8d8ff');
        if (AudioSys.shield) AudioSys.shield();
        return;
      }
      if (s.char.id === 'gua') s.ironwallT = 1.5;

      s.hp -= dmg;
      s.hurtFlash = 0.5;
      this.cam.shake = 0.25;
      if (s.isPlayer) this.vignette = 0.7;
      this.stopDecode(s);
      if (s.hp <= 0) {
        s.hp = 0;
        this.addFloater(s.x, s.y - 26, '倒地!', '#ff5050');
        if (AudioSys.downed) AudioSys.downed();
        this.spawnParticle(s.x, s.y, 'blood', 24);
        h.scoreHit++;
      } else {
        if (AudioSys.hurt) AudioSys.hurt();
        this.addFloater(s.x, s.y - 24, '受伤!', '#ff9a6a');
        this.spawnParticle(s.x, s.y, 'blood', 14);
        h.scoreHit++;
      }
    },

    /* ---------- 求生者交互 ---------- */
    survivorInteract: function (s) {
      // 校准中：按下即为打点
      if (this.check && this.check.decoder === s) { this.pressCheck(); return; }
      if (s.carriedBy) { /* 被牵制时挣扎由系统处理 */ return; }
      if (s.chair) { /* 处刑中，按下挣扎 */ return; }
      if (s.hp === 0) {
        // 倒地自疗
        this.startChannel(s, { type: 'heal_self_down', progress: 0, dur: 8 / s.stats.selfHeal });
        return;
      }
      if (s.decoding) { this.stopDecode(s); return; }

      // 救人(处刑架)
      var chairRescue = this.nearChairWithOccupant(s);
      if (chairRescue && chairRescue.occupant !== s) {
        this.startChannel(s, { type: 'rescue', target: chairRescue, progress: 0, dur: 1.8 });
        return;
      }
      // 治疗倒地/受伤队友
      var ally = this.nearestHealableAlly(s);
      if (ally) {
        var dur = ally.hp === 0 ? 4 / s.stats.heal : 2.5 / s.stats.heal;
        this.startChannel(s, { type: 'heal_other', target: ally, progress: 0, dur: dur });
        return;
      }
      // 修机
      var m = this.nearestMachine(s.x, s.y, true);
      if (m && dist(s.x, s.y, m.x, m.y) <= RANGE + 18 && m.occupiedBy === null) {
        this.toggleDecode(s);
        return;
      }
      // 逃生门
      var gate = this.nearestGate(s);
      if (gate && gate.powered && !gate.open && dist(s.x, s.y, gate.x, gate.y) <= RANGE + 18) {
        this.startChannel(s, { type: 'gate', target: gate, progress: 0, dur: 2.5 });
        return;
      }
      // 放板
      if (this.standingOnPallet(s)) {
        this.dropPallet(s);
        return;
      }
      // 受伤自疗
      if (s.hp === 1) {
        this.startChannel(s, { type: 'heal_self', progress: 0, dur: 6 / s.stats.selfHeal });
        return;
      }
    },

    startChannel: function (s, ch) {
      if (s.carriedBy || s.chair) return;
      s.channel = ch;
    },

    nearChairWithOccupant: function (s) {
      for (var i = 0; i < this.chairs.length; i++) {
        var c = this.chairs[i];
        if (c.occupant && dist(s.x, s.y, c.x, c.y) <= RANGE + 20) return c;
      }
      return null;
    },

    nearestHealableAlly: function (s) {
      var best = null, bd = RANGE + 20;
      for (var i = 0; i < this.survivors.length; i++) {
        var o = this.survivors[i];
        if (o === s || !o.alive || o.escaped) continue;
        if (o.carriedBy || o.chair) continue;
        if (o.hp < 2 && dist(s.x, s.y, o.x, o.y) <= bd) { bd = dist(s.x, s.y, o.x, o.y); best = o; }
      }
      return best;
    },

    standingOnPallet: function (s) {
      var tx = Math.floor(s.x / this.ts), ty = Math.floor(s.y / this.ts);
      for (var i = 0; i < this.pallets.length; i++) {
        var p = this.pallets[i];
        if (p.tx === tx && p.ty === ty && !p.down) return p;
      }
      return null;
    },

    dropPallet: function (s) {
      var p = this.standingOnPallet(s);
      if (!p) return;
      p.down = true;
      p.breakT = 0;
      if (AudioSys.palletDrop) AudioSys.palletDrop();
      this.cam.shake = 0.18;
      this.spawnParticle(p.x, p.y, 'dust', 20);
      // 若监管者在板下则眩晕
      var h = this.hunter;
      if (h && dist(h.x, h.y, p.x, p.y) < 34) {
        h.stunT = 1.6;
        if (AudioSys.stun) AudioSys.stun();
        this.addFloater(p.x, p.y - 20, '板子砸晕!', '#ffd94a');
      }
    },

    nearestGate: function (s) {
      var best = null, bd = 1e9;
      for (var i = 0; i < this.gates.length; i++) {
        var d = dist(s.x, s.y, this.gates[i].x, this.gates[i].y);
        if (d < bd) { bd = d; best = this.gates[i]; }
      }
      return best;
    },

    /* ---------- 通道系统(治疗/救援/开门) ---------- */
    updateChannels: function (dt) {
      for (var i = 0; i < this.survivors.length; i++) {
        var s = this.survivors[i];
        if (!s.alive || s.escaped) continue;
        var ch = s.channel;
        if (!ch) continue;
        // 被打断条件
        if (s.carriedBy || s.chair || s.vaultT > 0 || s.hurtFlash > 0 || (ch.type === 'rescue' && !(ch.target && ch.target.occupant && dist(s.x, s.y, ch.target.x, ch.target.y) <= RANGE + 26))) {
          s.channel = null; continue;
        }
        if (ch.type.indexOf('heal_other') === 0) {
          var ally = ch.target;
          if (!ally || !ally.alive || ally.escaped || ally.hp >= 2 || dist(s.x, s.y, ally.x, ally.y) > RANGE + 26) { s.channel = null; continue; }
          ch.progress += dt;
          if (s.char.id === 'med') ch.progress += dt * 0.6;
          if (ch.progress >= ch.dur) {
            ally.hp = 2;
            ally.hurtFlash = 0;
            this.addFloater(ally.x, ally.y - 24, '已治愈!', '#7dffb0');
            if (AudioSys.heal) AudioSys.heal();
            s.channel = null;
            s.healScore = (s.healScore || 0) + 1;
          }
        } else if (ch.type === 'heal_self' || ch.type === 'heal_self_down') {
          if (s.hp >= (ch.type === 'heal_self' ? 2 : 1)) { s.channel = null; continue; }
          ch.progress += dt;
          if (s.char.id === 'med') ch.progress += dt * 0.6;
          if (ch.progress >= ch.dur) {
            if (ch.type === 'heal_self') { s.hp = 2; }
            else { s.hp = 1; }
            this.addFloater(s.x, s.y - 24, '自愈完成!', '#7dffb0');
            if (AudioSys.heal) AudioSys.heal();
            s.channel = null;
          }
        } else if (ch.type === 'rescue') {
          ch.progress += dt;
          if (ch.progress >= ch.dur) {
            var occ = ch.target.occupant;
            if (occ) {
              occ.hp = 1;
              occ.chair = null;
              occ.vaultT = 0.5;
              ch.target.occupant = null;
              ch.target.timer = 0;
              this.addFloater(ch.target.x, ch.target.y - 24, '救援成功!', '#7dffb0');
              if (AudioSys.rescue) AudioSys.rescue();
              s.rescueScore = (s.rescueScore || 0) + 1;
            }
            s.channel = null;
          }
        } else if (ch.type === 'gate') {
          var g = ch.target;
          if (!g || g.open) { s.channel = null; continue; }
          if (dist(s.x, s.y, g.x, g.y) > RANGE + 26) { s.channel = null; continue; }
          ch.progress += dt;
          g.progress = Math.min(100, ch.progress / ch.dur * 100);
          if (ch.progress >= ch.dur) {
            g.open = true;
            g.leverBy = null;
            if (AudioSys.gateOpen) AudioSys.gateOpen();
            this.addFloater(g.x, g.y - 24, '逃生门已开启!', '#7dffb0');
            this.spawnParticle(g.x, g.y, 'spark', 40);
            s.channel = null;
          }
        }
      }
      // 处刑架上的求生者小挣扎(简化：不改变倒计时)
    },

    /* ---------- 处刑架 ---------- */
    updateChairs: function (dt) {
      for (var i = 0; i < this.chairs.length; i++) {
        var c = this.chairs[i];
        if (!c.occupant) continue;
        var s = c.occupant;
        if (!s.alive || s.escaped || s.carriedBy) { c.occupant = null; c.timer = 0; continue; }
        c.timer += dt;
        if (AudioSys && c.timer > 0 && Math.floor(c.timer) !== Math.floor(c.timer - dt)) {
          if (AudioSys.chairTick && Math.floor(c.timer) % 3 === 0) AudioSys.chairTick();
        }
        if (c.timer >= c.total) {
          // 淘汰
          s.alive = false;
          s.hp = -1;
          c.occupant = null;
          c.timer = 0;
          this.addFloater(c.x, c.y - 30, '已被淘汰', '#ff4040');
          this.spawnParticle(c.x, c.y, 'boom', 30);
          if (AudioSys.lose) AudioSys.lose();
        }
      }
    },

    updateStruggle: function (s, dt) {
      // 被牵制挣扎
      if (!s.carriedBy) return;
      var diff = DIFF[this.difficulty];
      s.carryStruggle += dt * 14 * diff.struggle;
      if (s.carryStruggle >= 100) {
        var h = s.carriedBy;
        h.carrying = null;
        s.carriedBy = null;
        s.carryStruggle = 0;
        s.hp = 1;
        h.stunT = 1.0;
        this.addFloater(s.x, s.y - 24, '挣脱成功!', '#7dffb0');
        if (AudioSys.rescue) AudioSys.rescue();
      }
    },

    /* ---------- 逃生门 ---------- */
    checkGatePower: function () {
      var done = 0;
      for (var i = 0; i < this.machines.length; i++) if (this.machines[i].decoded) done++;
      if (done >= MACHINES_NEEDED) {
        var any = false;
        for (var g = 0; g < this.gates.length; g++) if (!this.gates[g].powered) any = true;
        if (any) {
          for (var gg = 0; gg < this.gates.length; gg++) this.gates[gg].powered = true;
          if (AudioSys.gatePower) AudioSys.gatePower();
          this.addFloater(this.gates[0].x, this.gates[0].y - 30, '大门通电!', '#9ad8ff');
        }
      }
    },

    updateGates: function (dt) {
      // 走到已开启的大门即逃脱
      for (var i = 0; i < this.survivors.length; i++) {
        var s = this.survivors[i];
        if (!s.alive || s.escaped || s.carriedBy || s.chair) continue;
        for (var g = 0; g < this.gates.length; g++) {
          if (this.gates[g].open && dist(s.x, s.y, this.gates[g].x, this.gates[g].y) < 24) {
            s.escaped = true;
            s.decoding = null;
            this.addFloater(this.gates[g].x, this.gates[g].y - 30, s.name + ' 逃脱!', '#7dffb0');
            if (AudioSys.win && !this.playerIsHunter) AudioSys.win();
          }
        }
      }
    },

    /* ---------- 技能 ---------- */
    useSurvivorSkill: function (s) {
      if (s.skillCd > 0 || s.hp === 0 || s.carriedBy || s.chair) return;
      var ac = s.char.active;
      var type = ac.type;
      if (type === 'heal') {
        var ally = this.nearestHealableAlly(s);
        var target = ally || s;
        if (target.hp === 0) target.hp = 1; else if (target.hp === 1) target.hp = 2;
        this.addFloater(target.x, target.y - 26, '急救!', '#7dffb0');
        if (AudioSys.heal) AudioSys.heal();
      } else if (type === 'ghost_decode') {
        var m = this.nearestMachine(s.x, s.y, true);
        if (m) { s.skillActive = true; s.skillOn = ac.duration; m.ghost = (m.ghost || 0) + 1; s._ghostMachine = m; }
      } else if (type === 'decode_boost') {
        s.decodeBoostT = ac.duration;
      } else if (type === 'sprint') {
        s.sprintT = ac.duration;
      } else if (type === 'shield') {
        var al2 = this.nearestAlly(s);
        var t2 = al2 || s;
        t2.shield = 2.5; // 盾持续 2.5s，期间抵挡一次
        this.addFloater(t2.x, t2.y - 26, '守护屏障!', '#9ad8ff');
        if (AudioSys.shield) AudioSys.shield();
        this.spawnParticle(t2.x, t2.y, 'shield', 16);
      } else if (type === 'invisible') {
        s.invisible = ac.duration;
        if (AudioSys.invis) AudioSys.invis();
        this.addFloater(s.x, s.y - 26, '遁形!', '#b8c8ff');
      }
      s.skillCd = ac.cd;
    },

    nearestAlly: function (s) {
      var best = null, bd = 280;
      for (var i = 0; i < this.survivors.length; i++) {
        var o = this.survivors[i];
        if (o === s || !o.alive || o.escaped) continue;
        var d = dist(s.x, s.y, o.x, o.y);
        if (d < bd) { bd = d; best = o; }
      }
      return best;
    },

    useHunterSkill: function (h, slot) {
      if (h.stunT > 0) return;
      var ch = h.char;
      if (slot === 1) {
        var ac = ch.active;
        if (h.skillCd > 0) return;
        if (ac.type === 'dash') {
          h.dashT = ac.duration;
          h.dashDir = h.dir;
          if (AudioSys.dash) AudioSys.dash();
        } else if (ac.type === 'teleport') {
          var m = this.nearestMachine(0, 0, true);
          var tx = m ? m.x + 20 : h.x;
          var ty = m ? m.y + 20 : h.y;
          h.x = clamp(tx, this.ts, this.cols * this.ts - this.ts);
          h.y = clamp(ty, this.ts, this.rows * this.ts - this.ts);
          h.stunT = 0.3;
          if (AudioSys.teleport) AudioSys.teleport();
          this.spawnParticle(h.x, h.y, 'spark', 30);
          this.addFloater(h.x, h.y - 26, '传送!', '#c0a8ff');
        }
        h.skillCd = ac.cd;
      } else if (slot === 2) {
        var ac2 = ch.active2;
        if (!ac2 || h.skill2Cd > 0) return;
        this.reveal = ac2.duration;
        h.skill2Cd = ac2.cd;
        if (AudioSys.reveal) AudioSys.reveal();
        this.addFloater(h.x, h.y - 26, '全视之眼!', '#c0a8ff');
      }
    },

    /* ---------- 监管者交互 ---------- */
    hunterInteract: function (h) {
      if (h.stunT > 0) return;
      if (h.carrying) {
        // 放下/上椅
        var chair = this.nearChair(h);
        if (chair) this.placeOnChair(h, chair);
        else {
          var sv = h.carrying;
          h.carrying = null;
          sv.carriedBy = null;
          sv.carryStruggle = 0;
          this.addFloater(sv.x, sv.y - 24, '被放下', '#ffd0d0');
        }
        return;
      }
      // 抱起倒地者
      for (var i = 0; i < this.survivors.length; i++) {
        var s = this.survivors[i];
        if (s.alive && !s.escaped && s.hp === 0 && !s.carriedBy && !s.chair && dist(h.x, h.y, s.x, s.y) <= RANGE + 14) {
          h.carrying = s;
          s.carriedBy = h;
          s.carryStruggle = 0;
          s.channel = null;
          if (AudioSys.chairPlace) AudioSys.chairPlace();
          this.addFloater(s.x, s.y - 26, '被牵制!', '#ff9a6a');
          return;
        }
      }
      // 攻击破坏倒板
      var pal = this.nearDownPallet(h);
      if (pal) { this.breakPallet(h, pal); return; }
    },

    nearChair: function (h) {
      var best = null, bd = RANGE + 20;
      for (var i = 0; i < this.chairs.length; i++) {
        var c = this.chairs[i];
        if (c.occupant) continue;
        var d = dist(h.x, h.y, c.x, c.y);
        if (d < bd) { bd = d; best = c; }
      }
      return best;
    },

    nearDownPallet: function (h) {
      var best = null, bd = RANGE + 10;
      for (var i = 0; i < this.pallets.length; i++) {
        var p = this.pallets[i];
        if (!p.down) continue;
        var d = dist(h.x, h.y, p.x, p.y);
        if (d < bd) { bd = d; best = p; }
      }
      return best;
    },

    breakPallet: function (h, p) {
      p.down = false;
      // 将格变为地板
      var tx = p.tx, ty = p.ty;
      if (tx >= 0 && ty >= 0 && tx < this.cols && ty < this.rows) this.grid[ty][tx] = TILE.FLOOR;
      if (AudioSys.palletBreak) AudioSys.palletBreak();
      this.cam.shake = 0.2;
      this.spawnParticle(p.x, p.y, 'dust', 26);
      h.atkCd = Math.max(h.atkCd, 0.6);
    },

    placeOnChair: function (h, chair) {
      var s = h.carrying;
      if (!s) return;
      h.carrying = null;
      s.carriedBy = null;
      s.carryStruggle = 0;
      chair.occupant = s;
      s.chair = chair;
      chair.timer = 0;
      s.hp = 0;
      if (AudioSys.chairPlace) AudioSys.chairPlace();
      this.addFloater(chair.x, chair.y - 26, '挂上处刑架!', '#ff6a6a');
      this.spawnParticle(chair.x, chair.y, 'spark', 20);
      h.state = 'guard';
      h.guardT = DIFF[this.difficulty].guardTime;
    },

    /* ---------- 心跳 ---------- */
    updateHeartbeat: function (dt) {
      var rate = 0;
      if (this.player && this.player.kind === 'survivor' && this.player.alive && !this.player.escaped) {
        var s = this.player;
        var d = dist(s.x, s.y, this.hunter.x, this.hunter.y);
        var detect = 300;
        if (s.char.id === 'gho') detect *= 0.65;
        if (s.invisible > 0) detect = 0;
        if (this.input.crouch) detect *= 0.8;
        if (d < detect) {
          rate = Math.round(lerp(160, 45, d / detect));
        }
      }
      this.heartRate = rate;
      if (AudioSys) AudioSys.setHeartRate(rate);
    },

    _resetHeart: function () {
      this.heartRate = 0;
      if (AudioSys) AudioSys.setHeartRate(0);
    },

    /* ---------- 效果 ---------- */
    spawnParticle: function (x, y, type, n) {
      for (var i = 0; i < n; i++) {
        this.particles.push({
          x: x, y: y, type: type,
          vx: (Math.random() - 0.5) * 90, vy: (Math.random() - 0.5) * 90 - 30,
          life: 0.5 + Math.random() * 0.6, t: 0, size: 2 + Math.random() * 3
        });
      }
      if (this.particles.length > 400) this.particles.splice(0, this.particles.length - 400);
    },
    addFloater: function (x, y, txt, color) {
      this.floaters.push({ x: x, y: y, txt: txt, color: color || '#fff', t: 0, life: 1.4 });
    },
    updateEffects: function (dt) {
      for (var i = this.particles.length - 1; i >= 0; i--) {
        var p = this.particles[i];
        p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt;
        p.vy += 60 * dt;
        if (p.t >= p.life) this.particles.splice(i, 1);
      }
      for (var f = this.floaters.length - 1; f >= 0; f--) {
        var fl = this.floaters[f];
        fl.t += dt; fl.y -= 28 * dt;
        if (fl.t >= fl.life) this.floaters.splice(f, 1);
      }
      if (this.vignette > 0) this.vignette -= dt * 1.2;
      // 机械师傀儡计时
      for (var m = 0; m < this.survivors.length; m++) {
        var sv = this.survivors[m];
        if (sv.char.id === 'eng' && sv.skillActive) {
          sv.skillOn -= dt;
          if (sv.skillOn <= 0) {
            sv.skillActive = false;
            if (sv._ghostMachine) { sv._ghostMachine.ghost = Math.max(0, (sv._ghostMachine.ghost || 1) - 1); sv._ghostMachine = null; }
          }
        }
      }
    },

    /* ---------- 胜负判定 ---------- */
    checkWin: function () {
      if (this.state !== 'playing') return;
      var done = 0;
      for (var i = 0; i < this.machines.length; i++) if (this.machines[i].decoded) done++;
      var aliveCount = 0, escapedCount = 0;
      for (var j = 0; j < this.survivors.length; j++) {
        if (this.survivors[j].alive) aliveCount++;
        if (this.survivors[j].escaped) escapedCount++;
      }
      var anyAliveOrEscaped = aliveCount > 0 || escapedCount > 0;
      // 求生者胜：全部机器破译 且 至少一人逃脱
      if (done >= MACHINES_NEEDED && escapedCount >= 1) {
        this.endMatch('survivor_win');
        return;
      }
      // 监管者胜：所有求生者被淘汰(非存活且非逃脱)
      if (!anyAliveOrEscaped) {
        this.endMatch('hunter_win');
        return;
      }
      // 玩家被淘汰且是唯一求生者
      if (this.player && this.player.kind === 'survivor' && !this.player.alive) {
        var othersAlive = false;
        for (var k = 0; k < this.survivors.length; k++) {
          var o = this.survivors[k];
          if (o !== this.player && (o.alive || o.escaped)) othersAlive = true;
        }
        if (!othersAlive) this.endMatch('hunter_win');
      }
    },

    endMatch: function (winner) {
      this.state = 'over';
      this.result = { winner: winner, time: this.time };
      var p = this.player;
      if (p && p.kind === 'survivor') {
        var decodeTotal = 0;
        for (var i = 0; i < this.machines.length; i++) decodeTotal += Math.round(this.machines[i].progress);
        var decoded = 0;
        for (var j = 0; j < this.machines.length; j++) if (this.machines[j].decoded) decoded++;
        var score = 300 + decoded * 400 + Math.round(decodeTotal / 10) * 3 + (p.escaped ? 1000 : 0) + Math.round(p.chaseT * 2) + p.rescueScore * 200 + p.healScore * 120;
        this.result.score = score;
        this.result.detail = {
          winner: winner, escaped: p.escaped, decoded: decoded,
          chaseT: Math.round(p.chaseT), rescueScore: p.rescueScore || 0, healScore: p.healScore || 0,
          time: Math.round(this.time)
        };
      } else if (p && p.kind === 'hunter') {
        var elim = 0;
        for (var k = 0; k < this.survivors.length; k++) if (!this.survivors[k].alive) elim++;
        var score = 300 + elim * 800 + this.hunter.scoreHit * 120 + Math.round(this.time);
        this.result.score = score;
        this.result.detail = {
          winner: winner, eliminations: elim, hits: this.hunter.scoreHit,
          machinesDecoded: (function (g) { var n = 0; for (var z = 0; z < g.machines.length; z++) if (g.machines[z].decoded) n++; return n; })(this),
          time: Math.round(this.time)
        };
      }
      if (AudioSys) {
        if (winner === 'survivor_win') AudioSys.win(); else AudioSys.lose();
        AudioSys.stopChase(); AudioSys.stopHeart(); AudioSys.stopAmbience();
      }
    },

    /* ---------- 暂停 ---------- */
    togglePause: function () {
      if (this.state === 'playing') this.state = 'paused';
      else if (this.state === 'paused') this.state = 'playing';
    }
  };

  global.Game = Game;
  global.DIFF = DIFF;
  global.BASE_SPEED = BASE_SPEED;
  global.MACHINES_NEEDED = MACHINES_NEEDED;
  global.GAME_HELPERS = {
    clamp: clamp, lerp: lerp, dist: dist, normAng: normAng, angDiff: angDiff,
    tileSolid: tileSolid, TILE: TILE, RANGE: RANGE
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Game: Game, DIFF: DIFF, BASE_SPEED: BASE_SPEED, MACHINES_NEEDED: MACHINES_NEEDED, GAME_HELPERS: GAME_HELPERS, TILE: TILE, RANGE: RANGE };
  }
})(typeof window !== 'undefined' ? window : globalThis);
