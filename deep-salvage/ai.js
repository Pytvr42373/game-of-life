(function (global, factory) {
  'use strict';
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.DeepSalvageAI = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

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

  function nearestSharkTo(world, entity) {
    var best = null;
    var bestDist = Infinity;
    for (var i = 0; i < world.sharks.length; i++) {
      var s = world.sharks[i];
      if (!s.alive) continue;
      var d = world.distance(entity, s);
      if (d < bestDist) { best = s; bestDist = d; }
    }
    return best;
  }

  function nearestOxygen(world, entity) {
    var best = null;
    var bestDist = Infinity;
    for (var i = 0; i < world.oxygenPickups.length; i++) {
      var o = world.oxygenPickups[i];
      if (o.collected) continue;
      var d = world.distance(entity, o);
      if (d < bestDist) { best = o; bestDist = d; }
    }
    return best;
  }

  function nearestTreasure(world, entity) {
    var best = null;
    var bestDist = Infinity;
    for (var i = 0; i < world.treasures.length; i++) {
      var t = world.treasures[i];
      if (t.collected) continue;
      var d = world.distance(entity, t);
      if (d < bestDist) { best = t; bestDist = d; }
    }
    return best;
  }

  function nearestCaptive(world, entity) {
    var actors = [world.player].concat(world.teammates);
    var best = null;
    var bestDist = Infinity;
    for (var i = 0; i < actors.length; i++) {
      var actor = actors[i];
      if (!actor || actor === entity || !actor.alive || (!actor.draggedBy && !actor.inNest)) continue;
      var d = world.distance(entity, actor);
      if (d < bestDist) { best = actor; bestDist = d; }
    }
    return best;
  }

  function moveToward(world, entity, target, speed, dt, stateKey) {
    if (entity.trapped > 0) return;
    if (world.navigate) {
      world.navigate(entity, target, speed, dt, stateKey);
      return;
    }
    // Fallback direct steering when no navigation helper is available.
    var mult = entity.slowed > 0 ? 0.4 : 1;
    var dx = target.x - entity.x;
    var dy = target.y - entity.y;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var step = speed * mult * dt;
    world.moveEntity(entity, dx / len * step, dy / len * step, dt);
    if (world.turnEntity) world.turnEntity(entity, dx, dy, dt);
  }

  // ---- Shark controller ----
  // No fixed patrol route/path. Roams to random points inside its habitat,
  // detects targets by distance + line of sight / noise, tracks last known
  // position, chases, searches, and returns toward home if it leaves range.
  function createSharkAI(shark, habitat, opts) {
    opts = opts || {};
    var rng = mulberry32(opts.seed != null ? opts.seed : 1);
    var home = { x: habitat.x, y: habitat.y };
    var radius = habitat.radius;
    var speed = opts.speed != null ? opts.speed : 3.0;
    var detectRange = opts.detectRange != null ? opts.detectRange : 8.0;
    var catchRadius = opts.catchRadius != null ? opts.catchRadius : 0.7;
    var noiseRange = opts.noiseRange != null ? opts.noiseRange : 3.5;
    var searchTime = opts.searchTime != null ? opts.searchTime : 4.0;

    var state = 'roam';
    var roamTarget = null;
    var lastKnown = null;
    var searchTimer = 0;

    shark.path = null; // explicitly no fixed path
    shark.home = home;
    shark.radius = radius;

    function sync() {
      shark.aiState = state;
      shark.lastKnown = lastKnown;
      shark.roamTarget = roamTarget;
    }

    function pickRoamTarget(world) {
      for (var i = 0; i < 24; i++) {
        var ang = rng() * Math.PI * 2;
        var dist = rng() * radius;
        var tx = home.x + Math.cos(ang) * dist;
        var ty = home.y + Math.sin(ang) * dist;
        if (world.isPassable(tx, ty)) return { x: tx, y: ty };
      }
      return { x: home.x, y: home.y };
    }

    function detectTargets(world) {
      var candidates = [world.player].concat(world.teammates);
      var best = null;
      var bestDist = Infinity;
      for (var i = 0; i < candidates.length; i++) {
        var c = candidates[i];
        if (!c || c.alive === false || c.draggedBy || c.inNest || c.rescueImmunity > 0) continue;
        var d = world.distance(shark, c);
        var range = c.bleeding > 0 ? detectRange * 1.55 : detectRange;
        if (d > range) continue;
        var visible = world.lineOfSight(shark, c);
        var noisy = d <= (c.bleeding > 0 ? noiseRange * 2 : noiseRange);
        if (visible || noisy) {
          if (d < bestDist) { best = c; bestDist = d; }
        }
      }
      return best;
    }

    return {
      update: function (world, dt) {
        if (shark.dragTarget) {
          if (!shark.dragTarget.alive) {
            shark.dragTarget = null;
          } else {
            state = 'drag';
            world.navigate(shark, home, speed * 0.82, dt, 'drag');
            world.syncDraggedTarget(shark, shark.dragTarget);
            if (world.distance(shark, home) <= 0.55) world.onSharkNest(shark, shark.dragTarget);
            sync();
            return;
          }
        }
        var target = detectTargets(world);

        if (target) {
          state = 'chase';
          lastKnown = { x: target.x, y: target.y };
          searchTimer = 0;
        } else if (state === 'chase') {
          state = 'search';
          searchTimer = searchTime;
        }

        if (state === 'chase') {
          if (world.distance(shark, target) <= catchRadius) {
            world.onSharkCatch(shark, target);
            sync();
            return;
          }
          world.navigate(shark, target, speed, dt, 'chase');
          if (world.distance(shark, target) <= catchRadius) {
            world.onSharkCatch(shark, target);
            sync();
            return;
          }
        } else if (state === 'search') {
          searchTimer -= dt;
          if (lastKnown) {
            if (world.distance(shark, lastKnown) > 0.3) {
              world.navigate(shark, lastKnown, speed, dt, 'search');
            } else {
              lastKnown = null;
            }
          }
          if (searchTimer <= 0) {
            state = 'roam';
            roamTarget = null;
          }
        } else if (state === 'return') {
          world.navigate(shark, home, speed, dt, 'return');
          if (world.distance(shark, home) <= 0.5) state = 'roam';
        } else {
          if (!roamTarget || world.distance(shark, roamTarget) < 0.4) {
            roamTarget = pickRoamTarget(world);
          }
          world.navigate(shark, roamTarget, speed, dt, 'roam');
        }

        var fromHome = world.distance(shark, home);
        if (fromHome > radius && state !== 'chase') {
          state = 'return';
        }

        sync();
      }
    };
  }

  // ---- Guard controller ----
  // Follows the player, balances rescue and oxygen needs, and retreats when a
  // shark is too close to approach safely.
  function createGuardAI(teammate, opts) {
    opts = opts || {};
    var speed = opts.speed != null ? opts.speed : 4.5;
    var lowOxygen = opts.lowOxygen != null ? opts.lowOxygen : 30;
    var dangerDist = opts.dangerDist != null ? opts.dangerDist : 2.6;

    teammate.aiState = 'follow';

    return {
      update: function (world, dt) {
        var player = world.player;
        var nearestShark = nearestSharkTo(world, teammate);
        var danger = nearestShark && world.distance(teammate, nearestShark) < dangerDist;
        var captive = nearestCaptive(world, teammate);

        if (captive && (!danger || world.distance(teammate, captive) < 2.4)) {
          teammate.aiState = 'rescue';
          moveToward(world, teammate, captive, speed * 1.08, dt, 'rescue');
          return;
        }

        if (danger) {
          teammate.aiState = 'selfPreserve';
          var dx = teammate.x - nearestShark.x;
          var dy = teammate.y - nearestShark.y;
          var len = Math.sqrt(dx * dx + dy * dy) || 1;
          var step = speed * dt;
          world.moveEntity(teammate, dx / len * step, dy / len * step, dt);
          if (world.turnEntity) world.turnEntity(teammate, dx, dy, dt);
          world.emit('teammate', { id: teammate.id, role: 'guard', intent: 'selfPreserve' });
          return;
        }

        if (teammate.oxygen < lowOxygen) {
          teammate.aiState = 'oxygen';
          var pickup = nearestOxygen(world, teammate);
          if (pickup) {
            moveToward(world, teammate, pickup, speed, dt, 'oxygen');
            if (world.distance(teammate, pickup) < 0.6) {
              teammate.oxygen = Math.min(100, teammate.oxygen + pickup.amount);
              pickup.collected = true;
              world.emit('oxygen', { target: 'guard', id: teammate.id });
            }
          } else {
            moveToward(world, teammate, player, speed, dt, 'follow');
          }
          return;
        }

        teammate.aiState = 'follow';
        moveToward(world, teammate, player, speed, dt, 'follow');
      }
    };
  }

  // ---- Salvager controller ----
  // Seeks nearby loot and carries it, returns toward the boat when oxygen or
  // inventory pressure is high, and retreats independently when danger is
  // severe (selfPreserve).
  function createSalvagerAI(teammate, opts) {
    opts = opts || {};
    var speed = opts.speed != null ? opts.speed : 4.0;
    var lowOxygen = opts.lowOxygen != null ? opts.lowOxygen : 30;
    var dangerDist = opts.dangerDist != null ? opts.dangerDist : 3.0;
    var inventoryPressure = opts.inventoryPressure != null ? opts.inventoryPressure : 3;

    teammate.aiState = 'seek';

    return {
      update: function (world, dt) {
        var nearestShark = nearestSharkTo(world, teammate);
        var danger = nearestShark && world.distance(teammate, nearestShark) < dangerDist;
        var captive = nearestCaptive(world, teammate);

        if (captive && (!danger || world.distance(teammate, captive) < 2)) {
          teammate.aiState = 'rescue';
          moveToward(world, teammate, captive, speed, dt, 'rescue');
          return;
        }

        if (danger) {
          teammate.aiState = 'selfPreserve';
          var dx = teammate.x - nearestShark.x;
          var dy = teammate.y - nearestShark.y;
          var len = Math.sqrt(dx * dx + dy * dy) || 1;
          var step = speed * dt;
          world.moveEntity(teammate, dx / len * step, dy / len * step, dt);
          if (world.turnEntity) world.turnEntity(teammate, dx, dy, dt);
          world.emit('teammate', { id: teammate.id, role: 'salvager', intent: 'selfPreserve' });
          return;
        }

        if (teammate.oxygen < lowOxygen) {
          teammate.aiState = 'oxygen';
          var pickup = nearestOxygen(world, teammate);
          if (pickup) {
            moveToward(world, teammate, pickup, speed, dt, 'oxygen');
            if (world.distance(teammate, pickup) < 0.6) {
              teammate.oxygen = Math.min(100, teammate.oxygen + pickup.amount);
              pickup.collected = true;
              world.emit('oxygen', { target: 'salvager', id: teammate.id });
            }
          } else {
            moveToward(world, teammate, world.boat, speed, dt, 'return');
          }
          return;
        }

        if (teammate.inventory.length >= inventoryPressure) {
          teammate.aiState = 'return';
          moveToward(world, teammate, world.boat, speed, dt, 'return');
          return;
        }

        var loot = nearestTreasure(world, teammate);
        if (loot) {
          teammate.aiState = 'seek';
          moveToward(world, teammate, loot, speed, dt, 'seek');
          if (world.distance(teammate, loot) < 0.6) {
            teammate.inventory.push(loot);
            loot.collected = true;
            world.emit('loot', { id: teammate.id, role: 'salvager', rarity: loot.rarity });
          }
        } else {
          teammate.aiState = 'follow';
          moveToward(world, teammate, world.player, speed, dt, 'follow');
        }
      }
    };
  }

  return {
    createSharkAI: createSharkAI,
    createGuardAI: createGuardAI,
    createSalvagerAI: createSalvagerAI
  };
});
