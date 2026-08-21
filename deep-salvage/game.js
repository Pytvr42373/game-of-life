(function (global, factory) {
  'use strict';
  var api = factory(global);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.DeepSalvageGame = api;
})(typeof window !== 'undefined' ? window : globalThis, function (global) {
  'use strict';

  var AI = (typeof module !== 'undefined' && module.exports)
    ? require('./ai.js')
    : (global.DeepSalvageAI || {});

  // Centralized gameplay constants.
  var CONST = {
    OXYGEN_MAX: 100,
    OXYGEN_DRAIN: 3.0,          // per second
    OXYGEN_REFILL: 40,          // per pickup
    SUFFOCATION_GRACE: 3.0,     // seconds at zero before failing
    INVENTORY_SLOTS: 6,
    PLAYER_SPEED: 6.0,
    SPRINT_MULT: 1.6,
    STAMINA_MAX: 100,
    STAMINA_DRAIN: 34,          // per second while sprinting
    STAMINA_REGEN: 23,          // per second after recovery delay
    STAMINA_RECOVERY_DELAY: 0.65,
    PICKUP_RADIUS: 0.8,
    BOAT_INTERACT_RADIUS: 2.1,
    SEAWEED_TRAP_MAX: 2.0,
    MINE_SLOW: 2.0,
    MINE_SLOW_FACTOR: 0.72,
    MINE_HIT_RADIUS: 0.85,
    VORTEX_MIN_SPEED_FACTOR: 0.38,
    AI_TURN_SPEED: 3.2,
    RESCUE_RADIUS: 1.15,
    RESCUE_IMMUNITY: 4.0,
    BLEED_DURATION: 45.0,
    SHARK_SPEED: 2.35,
    SHARK_DETECT_RANGE: 8.0,
    SHARK_CATCH_RADIUS: 0.7,
    NAV_REFRESH: 1.5,       // seconds before recomputing a dynamic nav path
    GEAR_COUNT: 5,
    SCORE_TREASURE_MULT: 100,
    SCORE_TEAMMATE_BONUS: 250,
    SCORE_OXYGEN_MULT: 2
  };

  var RARITY = {
    common: 1,
    fine: 2,
    rare: 3,
    epic: 4,
    legendary: 5
  };

  var GEAR_NAMES = ['增压阀', '声呐模块', '抓钩', '探照灯', '推进器'];
  var GEAR_RARITIES = ['common', 'fine', 'rare', 'epic', 'legendary'];

  // Persistent unlocked-gear effects keyed by gear id.
  var GEAR_EFFECTS = {
    gear0: { oxygenBonus: 20 },                 // 增压阀: +20 oxygenMax/start
    gear1: { sonar: true },                     // 声呐模块: sonar reveal pulse
    gear2: { seaweedTrap: 1.0 },                // 抓钩: shorter seaweed trap
    gear3: { lampRangeBonus: 80 },              // 探照灯: lamp range bonus
    gear4: { speedBonus: 0.15, staminaDrain: 0.72 } // 推进器: speed +15%, cheaper sprint
  };

  var INTENT_TEXT = {
    follow: '跟随玩家',
    protect: '护卫',
    oxygen: '寻找氧气',
    selfPreserve: '各自飞·撤退',
    rescue: '救援队友',
    seek: '搜寻宝物',
    carry: '携带宝物',
    return: '返回船只'
  };

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0;
      a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function hashSeed(value) {
    var text = String(value == null ? '' : value);
    var hash = 2166136261;
    for (var i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function Game(map, options) {
    options = options || {};
    this.map = map;
    this.options = options;
    this.rng = mulberry32(options.seed != null ? options.seed : (map.seedValue || 1));
    this._init();
  }

  Game.prototype._init = function () {
    var map = this.map;
    this.state = 'ready';
    this.time = 0;
    this.events = [];
    this.reason = null;
    this.result = { gearFound: [] };
    this.input = {};
    this.sharkAIs = [];

    this.unlockedGear = this._computeUnlockedGear();

    this.boat = { x: map.entities.boat.x + 0.5, y: map.entities.boat.y + 0.5 };

    var oxygenMax = CONST.OXYGEN_MAX + (this.unlockedGear.gear0 ? GEAR_EFFECTS.gear0.oxygenBonus : 0);
    this.player = {
      x: map.entities.spawn.x + 0.5,
      y: map.entities.spawn.y + 0.5,
      faceAngle: Math.PI / 2,
      oxygenMax: oxygenMax,
      oxygen: oxygenMax,
      inventory: [],
      trapped: 0,
      slowed: 0,
      suffocating: 0,
      staminaMax: CONST.STAMINA_MAX,
      stamina: CONST.STAMINA_MAX,
      staminaDelay: 0,
      sprinting: false,
      draggedBy: null,
      inNest: false,
      captureCount: 0,
      bleeding: 0,
      rescueImmunity: 0,
      sonarUnlocked: !!this.unlockedGear.gear1,
      lampRangeBonus: this.unlockedGear.gear3 ? GEAR_EFFECTS.gear3.lampRangeBonus : 0,
      alive: true
    };
    this._initCollectibles();
    this._initHazards();
    this._initMines();
    this._initTeammates();
    this._initSharks();
    this._initWorld();
  };

  // Resolve which gear ids are unlocked into a lookup map.
  Game.prototype._computeUnlockedGear = function () {
    var list = this.options.unlockedGear || [];
    var map = {};
    for (var i = 0; i < list.length; i++) {
      if (GEAR_EFFECTS[list[i]]) map[list[i]] = true;
    }
    return map;
  };

  // Player movement speed multiplier from unlocked gear.
  Game.prototype._playerSpeedMult = function () {
    return this.unlockedGear.gear4 ? (1 + GEAR_EFFECTS.gear4.speedBonus) : 1;
  };

  Game.prototype._staminaDrainMult = function () {
    return this.unlockedGear.gear4 ? GEAR_EFFECTS.gear4.staminaDrain : 1;
  };

  // Seaweed trap duration from unlocked gear.
  Game.prototype._seaweedTrapDuration = function () {
    return this.unlockedGear.gear2 ? GEAR_EFFECTS.gear2.seaweedTrap : CONST.SEAWEED_TRAP_MAX;
  };

  Game.prototype._initCollectibles = function () {
    var map = this.map;
    var i;

    this.treasures = [];
    for (i = 0; i < map.entities.treasures.length; i++) {
      var t = map.entities.treasures[i];
      this.treasures.push({
        x: t.x + 0.5, y: t.y + 0.5,
        rarity: t.rarity,
        value: RARITY[t.rarity] != null ? RARITY[t.rarity] : 1,
        collected: false,
        kind: 'treasure'
      });
    }

    this.oxygenPickups = [];
    for (i = 0; i < map.entities.oxygen.length; i++) {
      var o = map.entities.oxygen[i];
      this.oxygenPickups.push({
        x: o.x + 0.5, y: o.y + 0.5,
        amount: CONST.OXYGEN_REFILL,
        collected: false,
        kind: 'oxygen'
      });
    }

    this.gear = [];
    var gearDepths = [10, 22, 35, 49, 61];
    for (i = 0; i < CONST.GEAR_COUNT; i++) {
      var gp = this._randomPassablePoint(gearDepths[i] || 1);
      this.gear.push({
        id: 'gear' + i,
        x: gp.x, y: gp.y,
        name: GEAR_NAMES[i % GEAR_NAMES.length],
        rarity: GEAR_RARITIES[i % GEAR_RARITIES.length],
        value: 10 + i * 5,
        collected: false,
        kind: 'gear'
      });
    }
  };

  Game.prototype._initHazards = function () {
    var map = this.map;
    var i;

    this.seaweed = [];
    for (i = 0; i < map.entities.seaweed.length; i++) {
      var w = map.entities.seaweed[i];
      this.seaweed.push({ x: w.x + 0.5, y: w.y + 0.5, radius: w.radius, consumed: false });
    }

    this.vortices = [];
    for (i = 0; i < map.entities.vortices.length; i++) {
      var v = map.entities.vortices[i];
      this.vortices.push({ x: v.x + 0.5, y: v.y + 0.5, radius: v.radius, spin: v.spin });
    }
  };

  Game.prototype._initMines = function () {
    var map = this.map;
    this.mines = [];
    for (var i = 0; i < map.entities.mines.length; i++) {
      var mine = map.entities.mines[i];
      this.mines.push({
        x: mine.x + 0.5,
        y: mine.y + 0.5,
        radius: mine.radius || CONST.MINE_HIT_RADIUS,
        triggered: false
      });
    }
  };

  Game.prototype._initTeammates = function () {
    var map = this.map;
    this.teammates = [];

    var guard = {
      id: 'guard', role: 'guard',
      x: map.entities.spawn.x + 1.5, y: map.entities.spawn.y + 0.5,
      faceAngle: 0, oxygen: CONST.OXYGEN_MAX,
      inventory: [], alive: true, slowed: 0, trapped: 0, suffocating: 0,
      draggedBy: null, inNest: false, captureCount: 0, bleeding: 0, rescueImmunity: 0,
      aiState: 'follow', intent: '跟随玩家'
    };
    var salvager = {
      id: 'salvager', role: 'salvager',
      x: map.entities.spawn.x - 0.5, y: map.entities.spawn.y + 0.5,
      faceAngle: 0, oxygen: CONST.OXYGEN_MAX,
      inventory: [], alive: true, slowed: 0, trapped: 0, suffocating: 0,
      draggedBy: null, inNest: false, captureCount: 0, bleeding: 0, rescueImmunity: 0,
      aiState: 'seek', intent: '搜寻宝物'
    };

    this.teammates.push(guard, salvager);
    this.guardAI = AI.createGuardAI(guard, { seed: this._seedFor('guard') });
    this.salvagerAI = AI.createSalvagerAI(salvager, { seed: this._seedFor('salvager') });
  };

  Game.prototype._initSharks = function () {
    var map = this.map;
    this.sharks = [];
    var habitats = map.entities.habitats;
    for (var i = 0; i < habitats.length; i++) {
      var h = habitats[i];
      var shark = {
        id: 'shark' + i,
        x: h.x + 0.5, y: h.y + 0.5,
        faceAngle: 0,
        alive: true,
        aiState: 'roam',
        dragTarget: null,
        path: null
      };
      this.sharks.push(shark);
      this.sharkAIs.push(AI.createSharkAI(shark, {
        x: h.x + 0.5,
        y: h.y + 0.5,
        radius: h.radius
      }, {
        seed: this._seedFor('shark' + i),
        speed: CONST.SHARK_SPEED,
        detectRange: CONST.SHARK_DETECT_RANGE,
        catchRadius: CONST.SHARK_CATCH_RADIUS
      }));
    }
  };

  Game.prototype._initWorld = function () {
    var self = this;
    this.world = {
      map: this.map,
      player: this.player,
      teammates: this.teammates,
      sharks: this.sharks,
      boat: this.boat,
      oxygenPickups: this.oxygenPickups,
      treasures: this.treasures,
      gear: this.gear,
      mines: this.mines,
      time: 0,
      distance: function (a, b) { return self._distance(a, b); },
      lineOfSight: function (a, b) { return self._lineOfSight(a, b); },
      isPassable: function (x, y) { return self._isPassable(x, y); },
      moveEntity: function (e, dx, dy, dt) { return self._moveEntity(e, dx, dy, dt); },
      navigate: function (e, target, speed, dt, stateKey) { return self._navigate(e, target, speed, dt, stateKey); },
      turnEntity: function (e, dx, dy, dt) { self._turnEntity(e, dx, dy, dt); },
      emit: function (t, d) { self._emit(t, d); },
      onSharkCatch: function (shark, target) { self._onSharkCatch(shark, target); },
      onSharkNest: function (shark, target) { self._onSharkNest(shark, target); },
      syncDraggedTarget: function (shark, target) { self._syncDraggedTarget(shark, target); },
      random: function () { return self.rng(); }
    };
  };

  Game.prototype._seedFor = function (name) {
    return hashSeed(String(name) + ':' + (this.map.seedValue || 0));
  };

  Game.prototype._randomPassablePoint = function (minY) {
    minY = minY || 1;
    for (var i = 0; i < 60; i++) {
      var x = 1 + Math.floor(this.rng() * (this.map.cols - 2));
      var y = minY + Math.floor(this.rng() * Math.max(1, this.map.rows - minY - 1));
      if (this._isPassable(x, y)) return { x: x + 0.5, y: y + 0.5 };
    }
    return { x: this.map.entities.spawn.x + 0.5, y: this.map.entities.spawn.y + 0.5 };
  };

  Game.prototype._distance = function (a, b) {
    var dx = a.x - b.x;
    var dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  };

  Game.prototype._isPassable = function (x, y) {
    var gx = Math.floor(x);
    var gy = Math.floor(y);
    if (gx < 0 || gy < 0 || gx >= this.map.cols || gy >= this.map.rows) return false;
    var tile = this.map.grid[gy][gx];
    return tile === 1 || tile === 2 || tile === 3; // WATER, WRECK, GATE
  };

  Game.prototype._lineOfSight = function (a, b) {
    var dx = b.x - a.x;
    var dy = b.y - a.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var steps = Math.ceil(dist * 2);
    for (var i = 1; i < steps; i++) {
      var t = i / steps;
      if (!this._isPassable(a.x + dx * t, a.y + dy * t)) return false;
    }
    return true;
  };

  Game.prototype._moveEntity = function (e, dx, dy, dt) {
    var movedX = 0;
    var movedY = 0;
    var nx = e.x + dx;
    if (this._isPassable(nx, e.y)) { e.x = nx; movedX = dx; }
    var ny = e.y + dy;
    if (this._isPassable(e.x, ny)) { e.y = ny; movedY = dy; }
    return { movedX: movedX, movedY: movedY };
  };

  Game.prototype._cell = function (p) {
    return { x: Math.floor(p.x), y: Math.floor(p.y) };
  };

  Game.prototype._turnEntity = function (entity, dx, dy, dt) {
    if (dx === 0 && dy === 0) return;
    var targetAngle = Math.atan2(dy, dx);
    var diff = this._angleDiff(targetAngle, entity.faceAngle || 0);
    var limit = CONST.AI_TURN_SPEED * dt;
    entity.faceAngle += Math.max(-limit, Math.min(limit, diff));
  };

  Game.prototype._steer = function (entity, target, step, dt) {
    var dx = target.x - entity.x;
    var dy = target.y - entity.y;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    this._moveEntity(entity, dx / len * step, dy / len * step, 1);
    this._turnEntity(entity, dx, dy, dt);
  };

  Game.prototype._clearNav = function (entity) {
    if (entity._nav) entity._nav = null;
  };

  Game.prototype._nearestPassableCell = function (cell) {
    var cols = this.map.cols;
    var rows = this.map.rows;
    for (var r = 0; r < 9; r++) {
      for (var oy = -r; oy <= r; oy++) {
        for (var ox = -r; ox <= r; ox++) {
          if (Math.abs(ox) !== r && Math.abs(oy) !== r) continue;
          var x = cell.x + ox;
          var y = cell.y + oy;
          if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
          if (this._isPassable(x, y)) return { x: x, y: y };
        }
      }
    }
    return null;
  };

  // Deterministic dynamic grid navigation. Computes a temporary BFS path over
  // the current map grid toward the target, follows tile centers, and
  // invalidates the cached path when the target/state changes or periodically.
  // Uses direct steering whenever line of sight is clear.
  Game.prototype._navigate = function (entity, target, speed, dt, stateKey) {
    if (entity.trapped > 0) return;
    var mult = entity.slowed > 0 ? CONST.MINE_SLOW_FACTOR : 1;
    mult *= this._vortexSpeedFactor(entity);
    var step = speed * mult * dt;

    if (this._lineOfSight(entity, target)) {
      this._clearNav(entity);
      this._steer(entity, target, step, dt);
      return;
    }

    var nav = entity._nav;
    var targetCell = this._cell(target);
    var key = stateKey != null ? stateKey : entity.aiState;

    if (!nav || nav.key !== key ||
        nav.targetCell.x !== targetCell.x || nav.targetCell.y !== targetCell.y ||
        (nav.age != null && nav.age > CONST.NAV_REFRESH)) {
      nav = this._computePath(entity, target);
      if (!nav) {
        this._steer(entity, target, step, dt);
        return;
      }
      nav.key = key;
      nav.targetCell = targetCell;
      nav.age = 0;
      entity._nav = nav;
    }
    nav.age += dt;

    // Advance past waypoints already reached.
    while (nav.index < nav.path.length) {
      var wp = nav.path[nav.index];
      if (this._distance(entity, { x: wp.x + 0.5, y: wp.y + 0.5 }) < 0.35) {
        nav.index++;
      } else {
        break;
      }
    }

    if (nav.index >= nav.path.length) {
      this._steer(entity, target, step, dt);
      return;
    }

    var next = nav.path[nav.index];
    var nx = next.x + 0.5;
    var ny = next.y + 0.5;
    var dx = nx - entity.x;
    var dy = ny - entity.y;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    this._moveEntity(entity, dx / len * step, dy / len * step, dt);
    this._turnEntity(entity, dx, dy, dt);
  };

  Game.prototype._computePath = function (entity, target) {
    var map = this.map;
    var cols = map.cols;
    var rows = map.rows;
    var start = this._cell(entity);
    var goal = this._cell(target);

    if (!this._isPassable(goal.x, goal.y)) {
      goal = this._nearestPassableCell(goal);
      if (!goal) return null;
    }

    var visited = [];
    var prev = [];
    for (var y = 0; y < rows; y++) {
      var vrow = [];
      var prow = [];
      for (var x = 0; x < cols; x++) { vrow.push(false); prow.push(null); }
      visited.push(vrow);
      prev.push(prow);
    }

    var queue = [{ x: start.x, y: start.y }];
    visited[start.y][start.x] = true;
    var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    while (queue.length) {
      var cur = queue.shift();
      if (cur.x === goal.x && cur.y === goal.y) {
        var path = [];
        var node = cur;
        while (node) {
          path.push(node);
          node = prev[node.y][node.x];
        }
        path.reverse();
        path.shift(); // drop the start cell
        return { path: path, index: 0 };
      }
      for (var i = 0; i < dirs.length; i++) {
        var nx = cur.x + dirs[i][0];
        var ny = cur.y + dirs[i][1];
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        if (visited[ny][nx]) continue;
        if (!this._isPassable(nx, ny)) continue;
        visited[ny][nx] = true;
        prev[ny][nx] = cur;
        queue.push({ x: nx, y: ny });
      }
    }
    return null;
  };

  Game.prototype._emit = function (type, data) {
    this.events.push({ type: type, data: data || {}, time: this.time });
  };

  Game.prototype._onSharkCatch = function (shark, target) {
    if (!target.alive || target.draggedBy || target.inNest || target.rescueImmunity > 0) return;
    target.draggedBy = shark.id;
    target.sprinting = false;
    shark.dragTarget = target;
    this._clearNav(shark);
    this._emit('sharkGrab', { target: target === this.player ? 'player' : target.role, shark: shark.id });
  };

  Game.prototype._syncDraggedTarget = function (shark, target) {
    if (!target || target.draggedBy !== shark.id) return;
    target.x = shark.x - Math.cos(shark.faceAngle || 0) * 0.62;
    target.y = shark.y - Math.sin(shark.faceAngle || 0) * 0.62;
    target.faceAngle = shark.faceAngle || target.faceAngle;
  };

  Game.prototype._onSharkNest = function (shark, target) {
    if (!target || target.draggedBy !== shark.id) return;
    target.draggedBy = null;
    target.inNest = true;
    target.captureCount++;
    target.x = shark.home.x;
    target.y = shark.home.y;
    shark.dragTarget = null;
    if (target.captureCount >= 2) {
      this._eliminateTarget(target, 'shark');
      return;
    }
    target.bleeding = CONST.BLEED_DURATION;
    this._emit('sharkNest', { target: target === this.player ? 'player' : target.role, count: target.captureCount });
  };

  Game.prototype._eliminateTarget = function (target, reason) {
    if (target === this.player) {
      this._fail(reason || 'shark');
      return;
    }
    if (target.draggedBy) {
      for (var i = 0; i < this.sharks.length; i++) {
        if (this.sharks[i].id === target.draggedBy) this.sharks[i].dragTarget = null;
      }
    }
    target.alive = false;
    target.lost = true;
    target.draggedBy = null;
    target.inNest = false;
    var lost = target.inventory.length;
    target.inventory = [];
    this._emit('teammateLost', { id: target.id, role: target.role, reason: reason || 'shark', lostTreasures: lost });
  };

  Game.prototype._releaseCaptive = function (target, rescuer) {
    if (!target.draggedBy && !target.inNest) return;
    if (target.draggedBy) {
      for (var i = 0; i < this.sharks.length; i++) {
        if (this.sharks[i].id === target.draggedBy) {
          this.sharks[i].dragTarget = null;
          this._clearNav(this.sharks[i]);
          break;
        }
      }
    }
    target.draggedBy = null;
    target.inNest = false;
    target.rescueImmunity = CONST.RESCUE_IMMUNITY;
    target.x = rescuer.x;
    target.y = rescuer.y;
    this._emit('rescue', {
      target: target === this.player ? 'player' : target.role,
      rescuer: rescuer === this.player ? 'player' : rescuer.role
    });
  };

  Game.prototype._updateRescues = function () {
    var actors = [this.player].concat(this.teammates);
    for (var i = 0; i < actors.length; i++) {
      var target = actors[i];
      if (!target.alive || (!target.draggedBy && !target.inNest)) continue;
      for (var r = 0; r < actors.length; r++) {
        var rescuer = actors[r];
        if (rescuer === target || !rescuer.alive || rescuer.draggedBy || rescuer.inNest || rescuer.trapped > 0) continue;
        if (this._distance(target, rescuer) <= CONST.RESCUE_RADIUS) {
          this._releaseCaptive(target, rescuer);
          break;
        }
      }
    }
  };

  Game.prototype._vortexSpeedFactor = function (p) {
    var factor = 1;
    for (var i = 0; i < this.vortices.length; i++) {
      var v = this.vortices[i];
      var distance = this._distance(p, v);
      if (distance >= v.radius) continue;
      var ratio = Math.max(0, distance / v.radius);
      var local = CONST.VORTEX_MIN_SPEED_FACTOR + (1 - CONST.VORTEX_MIN_SPEED_FACTOR) * Math.pow(ratio, 1.35);
      factor = Math.min(factor, local);
    }
    return factor;
  };

  Game.prototype._checkSeaweedEnter = function (p) {
    if (p.trapped > 0) return;
    for (var i = 0; i < this.seaweed.length; i++) {
      var w = this.seaweed[i];
      if (w.consumed) continue;
      if (this._distance(p, w) <= w.radius) {
        w.consumed = true;
        p.trapped = this._seaweedTrapDuration();
        this._emit('hazard', { type: 'seaweed', target: 'player' });
        return;
      }
    }
  };

  Game.prototype._nearBoat = function (p) {
    return this._distance(p, this.boat) <= CONST.BOAT_INTERACT_RADIUS;
  };

  Game.prototype._collectPickups = function (p) {
    var i;
    for (i = 0; i < this.oxygenPickups.length; i++) {
      var o = this.oxygenPickups[i];
      if (o.collected) continue;
      if (this._distance(p, o) <= CONST.PICKUP_RADIUS) {
        o.collected = true;
        p.oxygen = Math.min(p.oxygenMax, p.oxygen + o.amount);
        this._emit('oxygen', { target: 'player', amount: o.amount });
      }
    }
    for (i = 0; i < this.treasures.length; i++) {
      var t = this.treasures[i];
      if (t.collected) continue;
      if (this._distance(p, t) <= CONST.PICKUP_RADIUS) {
        if (p.inventory.length >= CONST.INVENTORY_SLOTS) {
          this._emit('inventoryFull', { rarity: t.rarity });
          continue;
        }
        t.collected = true;
        p.inventory.push(t);
        this._emit('loot', { target: 'player', rarity: t.rarity, value: t.value });
      }
    }
    for (i = 0; i < this.gear.length; i++) {
      var g = this.gear[i];
      if (g.collected) continue;
      if (this._distance(p, g) <= CONST.PICKUP_RADIUS) {
        g.collected = true;
        this.result.gearFound.push(g);
        this._emit('gear', { id: g.id, name: g.name, rarity: g.rarity, value: g.value });
      }
    }
  };

  Game.prototype._updateActorStatus = function (actor, dt) {
    if (actor.bleeding > 0) actor.bleeding = Math.max(0, actor.bleeding - dt);
    if (actor.rescueImmunity > 0) actor.rescueImmunity = Math.max(0, actor.rescueImmunity - dt);
  };

  Game.prototype._updatePlayer = function (dt) {
    var p = this.player;
    var input = this.input || {};
    this._updateActorStatus(p, dt);
    if (p.slowed > 0) p.slowed = Math.max(0, p.slowed - dt);
    var ix = input.x || 0;
    var iy = input.y || 0;
    if (p.draggedBy || p.inNest) { ix = 0; iy = 0; }
    var len = Math.sqrt(ix * ix + iy * iy);
    if (len > 1) { ix /= len; iy /= len; }
    var moving = ix !== 0 || iy !== 0;
    var sprint = !!input.sprint && moving && p.stamina > 0 && !p.draggedBy && !p.inNest;

    if (sprint) {
      p.stamina = Math.max(0, p.stamina - CONST.STAMINA_DRAIN * this._staminaDrainMult() * dt);
      p.staminaDelay = CONST.STAMINA_RECOVERY_DELAY;
    } else if (p.staminaDelay > 0) {
      p.staminaDelay = Math.max(0, p.staminaDelay - dt);
    } else {
      p.stamina = Math.min(p.staminaMax, p.stamina + CONST.STAMINA_REGEN * dt);
    }
    p.sprinting = sprint;

    var speed = CONST.PLAYER_SPEED * this._playerSpeedMult() * (sprint ? CONST.SPRINT_MULT : 1);
    if (p.slowed > 0) speed *= CONST.MINE_SLOW_FACTOR;
    speed *= this._vortexSpeedFactor(p);

    if (p.trapped > 0) {
      p.trapped -= dt;
      ix = 0; iy = 0;
    }

    if (ix !== 0 || iy !== 0) {
      this._moveEntity(p, ix * speed * dt, iy * speed * dt, dt);
      p.faceAngle = Math.atan2(iy, ix);
    }

    p.oxygen -= CONST.OXYGEN_DRAIN * dt;
    if (p.oxygen < 0) p.oxygen = 0;

    if (!p.draggedBy && !p.inNest) this._collectPickups(p);

    if (p.oxygen <= 0) {
      p.suffocating += dt;
      if (p.suffocating >= CONST.SUFFOCATION_GRACE) {
        this._fail('oxygen');
        return;
      }
    } else {
      p.suffocating = 0;
    }

    if (!p.draggedBy && !p.inNest && input.interact && this._nearBoat(p) && p.inventory.length > 0) {
      this._win();
      return;
    }

    if (!p.draggedBy && !p.inNest) this._checkSeaweedEnter(p);
  };

  Game.prototype._angleDiff = function (a, b) {
    var d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  };

  Game.prototype._updateTeammates = function (dt) {
    for (var i = 0; i < this.teammates.length; i++) {
      var tm = this.teammates[i];
      if (!tm.alive) continue;
      this._updateActorStatus(tm, dt);
      tm.oxygen -= CONST.OXYGEN_DRAIN * dt;
      if (tm.oxygen < 0) tm.oxygen = 0;
      if (tm.slowed > 0) tm.slowed -= dt;
      if (tm.trapped > 0) tm.trapped -= dt;

      // Teammate suffocation grace: at zero oxygen, 3s grace then lost.
      if (tm.oxygen <= 0) {
        tm.suffocating += dt;
        if (tm.suffocating >= CONST.SUFFOCATION_GRACE) {
          this._eliminateTarget(tm, 'oxygen');
          continue;
        }
      } else {
        tm.suffocating = 0;
      }

      if (tm.draggedBy || tm.inNest) {
        tm.aiState = 'captured';
        tm.intent = '等待救援';
        continue;
      }

      var ctrl = tm.role === 'guard' ? this.guardAI : this.salvagerAI;
      ctrl.update(this.world, dt);
      tm.intent = INTENT_TEXT[tm.aiState] || tm.aiState;
    }
  };

  Game.prototype._updateSharks = function (dt) {
    for (var i = 0; i < this.sharks.length; i++) {
      var shark = this.sharks[i];
      if (!shark.alive) continue;
      this.sharkAIs[i].update(this.world, dt);
    }
  };

  Game.prototype._updateMines = function () {
    var targets = [this.player].concat(this.teammates);
    for (var i = 0; i < this.mines.length; i++) {
      var mine = this.mines[i];
      if (mine.triggered) continue;
      for (var t = 0; t < targets.length; t++) {
        var target = targets[t];
        if (!target.alive || target.draggedBy || target.inNest) continue;
        if (this._distance(mine, target) > mine.radius) continue;
        mine.triggered = true;
        target.slowed = CONST.MINE_SLOW;
        this._emit('hazard', { type: 'mine', target: target === this.player ? 'player' : target.role });
        break;
      }
    }
  };

  Game.prototype._win = function () {
    if (this.state === 'won' || this.state === 'failed') return;
    this.state = 'won';
    var p = this.player;

    // Player's carried treasures are always extracted.
    var extracted = p.inventory.slice();
    var extractedTeammates = 0;
    for (var j = 0; j < this.teammates.length; j++) {
      var tm = this.teammates[j];
      // Only alive teammates actually within boat extraction radius are
      // extracted and provide the survival bonus.
      if (tm.alive && this._distance(tm, this.boat) <= CONST.BOAT_INTERACT_RADIUS) {
        extractedTeammates++;
        extracted = extracted.concat(tm.inventory);
      }
    }

    var treasureValue = 0;
    for (var i = 0; i < extracted.length; i++) treasureValue += extracted[i].value;

    var score = treasureValue * CONST.SCORE_TREASURE_MULT
      + extractedTeammates * CONST.SCORE_TEAMMATE_BONUS
      + Math.round(p.oxygen) * CONST.SCORE_OXYGEN_MULT;
    this.result = {
      state: 'won',
      score: Math.round(score),
      treasures: extracted.map(function (t) { return { rarity: t.rarity, value: t.value }; }),
      treasureValue: treasureValue,
      survivingTeammates: extractedTeammates,
      extractedTeammates: extractedTeammates,
      remainingOxygen: Math.round(p.oxygen),
      gearFound: this.result.gearFound
    };
    this._emit('win', { score: this.result.score });
  };

  Game.prototype._fail = function (reason) {
    if (this.state === 'won' || this.state === 'failed') return;
    this.state = 'failed';
    this.reason = reason;
    this.result = {
      state: 'failed',
      reason: reason,
      gearFound: this.result.gearFound
    };
    this._emit('fail', { reason: reason });
  };

  Game.prototype.start = function () {
    if (this.state !== 'ready') return;
    this.state = 'playing';
    this._emit('start', {});
  };

  Game.prototype.setInput = function (input) {
    this.input = input || {};
  };

  Game.prototype.update = function (dt) {
    if (this.state !== 'playing') return;
    if (dt <= 0) return;
    this.time += dt;
    this.world.time = this.time;
    this._updatePlayer(dt);
    if (this.state !== 'playing') return;
    if (this.options.teammates !== false) this._updateTeammates(dt);
    if (this.options.sharks !== false) this._updateSharks(dt);
    if (this.state !== 'playing') return;
    this._updateRescues();
    this._updateMines();
  };

  Game.prototype.drainEvents = function () {
    var out = this.events;
    this.events = [];
    return out;
  };

  Game.prototype.getSnapshot = function () {
    return {
      state: this.state,
      reason: this.reason,
      time: this.time,
      player: {
        x: this.player.x, y: this.player.y,
        faceAngle: this.player.faceAngle,
        oxygen: this.player.oxygen,
        oxygenMax: this.player.oxygenMax,
        sonarUnlocked: this.player.sonarUnlocked,
        lampRangeBonus: this.player.lampRangeBonus,
        inventory: this.player.inventory.map(function (t) { return { rarity: t.rarity, value: t.value }; }),
        trapped: this.player.trapped,
        slowed: this.player.slowed,
        suffocating: this.player.suffocating,
        stamina: this.player.stamina,
        staminaMax: this.player.staminaMax,
        sprinting: this.player.sprinting,
        draggedBy: this.player.draggedBy,
        inNest: this.player.inNest,
        captureCount: this.player.captureCount,
        bleeding: this.player.bleeding
      },
      teammates: this.teammates.map(function (t) {
        return {
          id: t.id, role: t.role, x: t.x, y: t.y, alive: t.alive,
          oxygen: t.oxygen, aiState: t.aiState, intent: t.intent,
          suffocating: t.suffocating, draggedBy: t.draggedBy, inNest: t.inNest,
          captureCount: t.captureCount, bleeding: t.bleeding,
          inventory: t.inventory.map(function (x) { return x.rarity; })
        };
      }),
      sharks: this.sharks.map(function (s) {
        return { id: s.id, x: s.x, y: s.y, aiState: s.aiState, path: s.path, lastKnown: s.lastKnown, dragging: s.dragTarget ? s.dragTarget.id || 'player' : null };
      }),
      collectibles: {
        treasures: this.treasures.map(function (t) { return { x: t.x, y: t.y, rarity: t.rarity, collected: t.collected }; }),
        oxygen: this.oxygenPickups.map(function (o) { return { x: o.x, y: o.y, collected: o.collected }; }),
        gear: this.gear.map(function (g) { return { id: g.id, x: g.x, y: g.y, name: g.name, rarity: g.rarity, collected: g.collected }; })
      },
      mines: this.mines.map(function (m) { return { x: m.x, y: m.y, triggered: m.triggered }; }),
      result: this.result
    };
  };

  return {
    Game: Game,
    CONST: CONST,
    RARITY: RARITY
  };
});
