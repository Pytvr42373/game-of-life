'use strict';

var assert = require('assert');
var Terrain = require('./maps.js');
var GameAPI = require('./game.js');
var AI = require('./ai.js');

var Game = GameAPI.Game;
var CONST = GameAPI.CONST;

var failures = 0;
var passed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (e) {
    failures++;
    console.error('  FAIL ' + name);
    console.error('       ' + (e && e.message));
  }
}

function makeMap(seed) {
  return Terrain.generateTerrain(seed || 'test-seed');
}

function makeGame(seed, options) {
  var map = makeMap(seed);
  var game = new Game(map, options || {});
  game.start();
  return game;
}

function findTreasure(game) {
  return game.treasures[0];
}

function findOxygen(game) {
  return game.oxygenPickups[0];
}

function findGear(game) {
  return game.gear[0];
}

function findVortex(game) {
  return game.vortices[0];
}

function findSeaweed(game) {
  return game.seaweed[0];
}

function findMine(game) {
  return game.mines[0];
}

function placePlayer(game, x, y) {
  game.player.x = x;
  game.player.y = y;
  game.player.trapped = 0;
  game.player.slowed = 0;
  game.player.suffocating = 0;
}

// A small deterministic map with a vertical wall at x=wallX (rows 0..4) that
// blocks direct line of sight but leaves a clear corridor around it.
function wallMap(wallX) {
  wallX = wallX == null ? 5 : wallX;
  var cols = 10;
  var rows = 10;
  var grid = [];
  for (var y = 0; y < rows; y++) {
    var row = [];
    for (var x = 0; x < cols; x++) row.push(1); // water
    grid.push(row);
  }
  for (var yy = 0; yy < 5; yy++) grid[yy][wallX] = 0; // rock wall
  return {
    seed: 'wall', seedValue: 424242, cols: cols, rows: rows, tileSize: 42,
    grid: grid,
    anchors: {},
    entities: {
      boat: { x: 0, y: 0 },
      spawn: { x: 0, y: 0 },
      oxygen: [], treasures: [], seaweed: [], vortices: [], mines: [],
      habitats: [{ name: 'h', x: 0, y: 0, radius: 5, aggression: 0.5 }],
      shortcut: { x: 0, y: 0 }
    }
  };
}

// ---------------------------------------------------------------------------

console.log('Deep Salvage gameplay tests');

test('deterministic setup: same seed produces identical snapshots', function () {
  var a = makeGame('det', { sharks: false, teammates: false });
  var b = makeGame('det', { sharks: false, teammates: false });
  assert.strictEqual(JSON.stringify(a.getSnapshot()), JSON.stringify(b.getSnapshot()));
  assert.strictEqual(a.treasures.length, b.treasures.length);
  assert.strictEqual(a.gear.length, b.gear.length);
});

test('oxygen grace: drains, then fails with reason oxygen after grace', function () {
  var game = makeGame('ox1', { sharks: false, teammates: false });
  game.player.oxygen = 0;
  game.update(1.0);
  assert.strictEqual(game.state, 'playing', 'should still be playing during grace');
  assert.ok(game.player.suffocating > 0, 'suffocation countdown should accumulate');
  game.update(2.1);
  assert.strictEqual(game.state, 'failed');
  assert.strictEqual(game.reason, 'oxygen');
});

test('oxygen recovery: refill resets grace and prevents failure', function () {
  var game = makeGame('ox2', { sharks: false, teammates: false });
  game.player.oxygen = 0;
  game.update(1.0);
  assert.strictEqual(game.state, 'playing');
  // place player on an oxygen pickup and refill
  var o = findOxygen(game);
  placePlayer(game, o.x, o.y);
  game.update(0.1);
  assert.ok(game.player.oxygen > 0, 'oxygen should be refilled');
  assert.strictEqual(game.player.suffocating, 0, 'grace should reset after refill');
  game.update(3.0);
  assert.strictEqual(game.state, 'playing', 'should not fail after recovery');
});

test('treasure collection: picking up adds to inventory and emits loot', function () {
  var game = makeGame('tr1', { sharks: false, teammates: false });
  var t = findTreasure(game);
  placePlayer(game, t.x, t.y);
  game.update(0.1);
  assert.strictEqual(game.player.inventory.length, 1);
  assert.strictEqual(game.player.inventory[0].rarity, t.rarity);
  assert.ok(t.collected);
  var events = game.drainEvents();
  assert.ok(events.some(function (e) { return e.type === 'loot'; }));
});

test('treasure collection: six-slot cap blocks further pickup', function () {
  var game = makeGame('tr2', { sharks: false, teammates: false });
  // fill inventory to cap
  for (var i = 0; i < CONST.INVENTORY_SLOTS; i++) {
    game.player.inventory.push({ rarity: 'common', value: 1 });
  }
  var t = findTreasure(game);
  placePlayer(game, t.x, t.y);
  game.update(0.1);
  assert.strictEqual(game.player.inventory.length, CONST.INVENTORY_SLOTS, 'inventory should stay capped');
  assert.ok(!t.collected, 'treasure should not be collected when full');
  var events = game.drainEvents();
  assert.ok(events.some(function (e) { return e.type === 'inventoryFull'; }));
});

test('gear extraction: gear goes into result.gearFound and emits gear event', function () {
  var game = makeGame('gear1', { sharks: false, teammates: false });
  var g = findGear(game);
  placePlayer(game, g.x, g.y);
  game.update(0.1);
  assert.strictEqual(game.result.gearFound.length, 1);
  assert.strictEqual(game.result.gearFound[0].name, g.name);
  assert.ok(g.collected);
  var events = game.drainEvents();
  assert.ok(events.some(function (e) { return e.type === 'gear'; }));
});

test('boat success: interact at boat with treasure wins and scores', function () {
  var game = makeGame('win1', { sharks: false, teammates: false });
  game.player.inventory.push({ rarity: 'rare', value: 3 });
  placePlayer(game, game.boat.x, game.boat.y);
  game.setInput({ interact: true });
  game.update(0.1);
  assert.strictEqual(game.state, 'won');
  assert.ok(game.result.score > 0, 'score should be positive');
  assert.strictEqual(game.result.treasureValue, 3);
  assert.ok(game.result.gearFound instanceof Array);
});

test('boat success: interacting at boat without treasure does not win', function () {
  var game = makeGame('win2', { sharks: false, teammates: false });
  placePlayer(game, game.boat.x, game.boat.y);
  game.setInput({ interact: true });
  game.update(0.1);
  assert.strictEqual(game.state, 'playing');
});

test('boat success: E only extracts inside the cabin interaction radius', function () {
  var game = makeGame('win-radius', { sharks: false, teammates: false });
  game.player.inventory.push({ rarity: 'common', value: 1 });
  placePlayer(game, game.boat.x + CONST.BOAT_INTERACT_RADIUS + 0.1, game.boat.y);
  game.setInput({ interact: true });
  game.update(0.1);
  assert.strictEqual(game.state, 'playing');
  placePlayer(game, game.boat.x + CONST.BOAT_INTERACT_RADIUS - 0.1, game.boat.y);
  game.update(0.1);
  assert.strictEqual(game.state, 'won');
});

test('vortex: slows movement by distance to center without reversing input', function () {
  var game = makeGame('vx1', { sharks: false, teammates: false });
  var v = findVortex(game);
  placePlayer(game, v.x, v.y);
  var startX = game.player.x;
  game.setInput({ x: 1, y: 0 });
  game.update(0.1);
  var centerDistance = game.player.x - startX;
  assert.ok(centerDistance > 0, 'vortex must not reverse movement');
  assert.ok(centerDistance < CONST.PLAYER_SPEED * 0.1, 'vortex center should slow movement');
  placePlayer(game, v.x + v.radius * 0.9, v.y);
  startX = game.player.x;
  game.update(0.1);
  assert.ok(game.player.x - startX > centerDistance, 'slowdown should weaken toward the edge');
});

test('seaweed: traps once, disappears, and cannot retrigger', function () {
  var game = makeGame('sw1', { sharks: false, teammates: false });
  var w = findSeaweed(game);
  placePlayer(game, w.x, w.y);
  game.setInput({ x: 1, y: 0 });
  game.update(0.1);
  assert.ok(game.player.trapped > 0, 'player should be trapped');
  assert.strictEqual(w.consumed, true, 'triggered seaweed should be consumed');
  assert.ok(game.player.trapped <= CONST.SEAWEED_TRAP_MAX);
  var trappedX = game.player.x;
  game.update(0.5);
  assert.strictEqual(game.player.x, trappedX, 'player should not move while trapped');
  game.update(CONST.SEAWEED_TRAP_MAX + 0.5);
  assert.ok(game.player.trapped <= 0, 'trap should expire');
  placePlayer(game, w.x + w.radius + 1, w.y);
  game.update(0.1);
  placePlayer(game, w.x, w.y);
  game.update(0.1);
  assert.ok(game.player.trapped <= 0, 'consumed seaweed should not trap again');
});

test('collectibles: generated gear uses passable tile centers', function () {
  var game = makeGame('gear-safe', { sharks: false, teammates: false });
  for (var i = 0; i < game.gear.length; i++) {
    var gear = game.gear[i];
    assert.strictEqual(gear.x % 1, 0.5);
    assert.strictEqual(gear.y % 1, 0.5);
    assert.strictEqual(game._isPassable(gear.x, gear.y), true);
  }
});

test('coordinates: static game entities use passable cell centers', function () {
  var game = makeGame('centered-entities', { sharks: false, teammates: false });
  var points = game.treasures.concat(game.oxygenPickups, game.gear, game.vortices, game.mines);
  for (var i = 0; i < points.length; i++) {
    assert.strictEqual(points[i].x % 1, 0.5);
    assert.strictEqual(points[i].y % 1, 0.5);
    assert.strictEqual(game._isPassable(points[i].x, points[i].y), true);
  }
});

test('balance: one fixed mine replaces projectile torpedoes', function () {
  var game = makeGame('balance', { sharks: false, teammates: false });
  assert.strictEqual(game.mines.length, 1);
  assert.strictEqual(CONST.SHARK_SPEED, 2.35);
  var mine = game.mines[0];
  var x = mine.x, y = mine.y;
  game.update(10);
  assert.strictEqual(mine.x, x);
  assert.strictEqual(mine.y, y);
  assert.strictEqual(mine.triggered, false);
});

test('mine: contact consumes mine and applies mild 2-second slow', function () {
  var game = makeGame('mine1', { sharks: false, teammates: false });
  var mine = findMine(game);
  placePlayer(game, mine.x, mine.y);
  game.update(0.1);
  assert.strictEqual(mine.triggered, true);
  assert.strictEqual(game.player.slowed, CONST.MINE_SLOW);
  assert.strictEqual(CONST.MINE_SLOW_FACTOR, 0.72);
  var events = game.drainEvents();
  assert.ok(events.some(function (e) { return e.type === 'hazard' && e.data.type === 'mine'; }));
});

test('shark: no fixed path property', function () {
  var game = makeGame('sh1', { teammates: false });
  for (var i = 0; i < game.sharks.length; i++) {
    assert.strictEqual(game.sharks[i].path, null, 'shark should have no fixed path');
  }
  var snap = game.getSnapshot();
  for (var j = 0; j < snap.sharks.length; j++) {
    assert.strictEqual(snap.sharks[j].path, null);
  }
});

test('shark: returns toward habitat when it leaves its range', function () {
  var game = makeGame('sh2', { teammates: false });
  var shark = game.sharks[0];
  var home = shark.home;
  var radius = shark.radius;
  game.player.alive = false;
  game.teammates.forEach(function (teammate) { teammate.alive = false; });
  for (var attempt = 0; attempt < 100; attempt++) {
    var point = game._randomPassablePoint(1);
    if (game._distance(point, home) > radius + 2) { shark.x = point.x; shark.y = point.y; break; }
  }
  var distBefore = Math.sqrt(Math.pow(shark.x - home.x, 2) + Math.pow(shark.y - home.y, 2));
  game.update(0.5);
  assert.strictEqual(shark.aiState, 'return', 'shark should enter return state');
  var distAfter = Math.sqrt(Math.pow(shark.x - home.x, 2) + Math.pow(shark.y - home.y, 2));
  assert.ok(distAfter < distBefore, 'shark should move toward home');
});

test('shark: tracks last known position when chasing', function () {
  var game = makeGame('sh3', { teammates: false });
  var shark = game.sharks[0];
  // place player within detect range and clear line of sight
  var px = shark.x + 3;
  var py = shark.y;
  placePlayer(game, px, py);
  game.update(0.1);
  assert.strictEqual(shark.aiState, 'chase', 'shark should chase detected player');
  assert.ok(shark.lastKnown, 'shark should track last known position');
  assert.ok(Math.abs(shark.lastKnown.x - px) < 0.01 && Math.abs(shark.lastKnown.y - py) < 0.01);
});

test('shark: bleeding target is detected through a larger noise radius', function () {
  var shark = { id: 'bleed-shark', x: 0, y: 0, faceAngle: 0, alive: true };
  var target = { x: 6, y: 0, alive: true, bleeding: 10, rescueImmunity: 0, draggedBy: null, inNest: false };
  var ai = AI.createSharkAI(shark, { x: 0, y: 0, radius: 10 }, { speed: 1, detectRange: 8, noiseRange: 3.5 });
  var world = {
    player: target, teammates: [], sharks: [shark],
    distance: function (a, b) { var dx=a.x-b.x,dy=a.y-b.y;return Math.sqrt(dx*dx+dy*dy); },
    lineOfSight: function () { return false; },
    isPassable: function () { return true; },
    navigate: function () {},
    onSharkCatch: function () {},
    syncDraggedTarget: function () {},
    onSharkNest: function () {}
  };
  ai.update(world, 0.1);
  assert.strictEqual(shark.aiState, 'chase');
});

test('shark: catch starts dragging instead of immediate failure', function () {
  var game = makeGame('sh4', { teammates: false });
  var shark = game.sharks[0];
  placePlayer(game, shark.x, shark.y);
  game.update(0.1);
  assert.strictEqual(game.state, 'playing');
  assert.strictEqual(game.player.draggedBy, shark.id);
  assert.strictEqual(shark.dragTarget, game.player);
});

test('shark nest: first arrival causes bleeding and can be rescued', function () {
  var game = makeGame('nest1', { sharks: false, teammates: false });
  var shark = game.sharks[0];
  game._onSharkCatch(shark, game.player);
  game._onSharkNest(shark, game.player);
  assert.strictEqual(game.player.captureCount, 1);
  assert.strictEqual(game.player.inNest, true);
  assert.strictEqual(game.player.bleeding, CONST.BLEED_DURATION);
  var guard = game.teammates[0];
  guard.x = game.player.x;
  guard.y = game.player.y;
  game._updateRescues();
  assert.strictEqual(game.player.inNest, false);
  assert.ok(game.player.rescueImmunity > 0);
});

test('shark nest: second arrival eliminates the player', function () {
  var game = makeGame('nest2', { sharks: false, teammates: false });
  var shark = game.sharks[0];
  game.player.captureCount = 1;
  game._onSharkCatch(shark, game.player);
  game._onSharkNest(shark, game.player);
  assert.strictEqual(game.state, 'failed');
  assert.strictEqual(game.reason, 'shark');
});

test('teammate: guard prioritizes a reachable rescue', function () {
  var game = makeGame('tm1', { sharks: false, teammates: true });
  var guard = game.teammates[0];
  game.player.inNest = true;
  game.player.x = guard.x + 4;
  game.player.y = guard.y;
  var before = game._distance(guard, game.player);
  game.update(0.1);
  assert.strictEqual(guard.aiState, 'rescue');
  assert.ok(game._distance(guard, game.player) < before);
});

test('teammate: guard self-preserves when danger is severe', function () {
  var game = makeGame('tm1b', { sharks: true });
  var guard = game.teammates[0];
  var shark = game.sharks[0];
  shark.x = guard.x + 2;
  shark.y = guard.y;
  game.update(0.1);
  assert.strictEqual(guard.aiState, 'selfPreserve');
});

test('teammate: second nest arrival eliminates only that teammate', function () {
  var game = makeGame('tm2', { sharks: false, teammates: false });
  var guard = game.teammates[0];
  var shark = game.sharks[0];
  guard.captureCount = 1;
  game._onSharkCatch(shark, guard);
  game._onSharkNest(shark, guard);
  assert.strictEqual(guard.alive, false, 'guard should be lost');
  assert.strictEqual(game.state, 'playing', 'run should continue after teammate loss');
  var events = game.drainEvents();
  assert.ok(events.some(function (e) { return e.type === 'teammateLost'; }));
});

test('teammate: carried treasure is lost with the teammate', function () {
  var game = makeGame('tm3', { sharks: false, teammates: false });
  var guard = game.teammates[0];
  guard.inventory.push({ rarity: 'epic', value: 4 });
  var shark = game.sharks[0];
  guard.captureCount = 1;
  game._onSharkCatch(shark, guard);
  game._onSharkNest(shark, guard);
  assert.strictEqual(guard.alive, false);
  assert.strictEqual(guard.inventory.length, 0, 'carried treasure should be lost');
});

test('exposed API: browser globals and constants', function () {
  assert.strictEqual(typeof Game, 'function');
  assert.strictEqual(typeof AI.createSharkAI, 'function');
  assert.strictEqual(typeof AI.createGuardAI, 'function');
  assert.strictEqual(typeof AI.createSalvagerAI, 'function');
  assert.ok(CONST.INVENTORY_SLOTS === 6);
  assert.ok(CONST.SUFFOCATION_GRACE === 3.0);
  assert.ok(CONST.SEAWEED_TRAP_MAX === 2.0);
  assert.ok(CONST.MINE_SLOW === 2.0);
});

test('state machine: ready -> playing -> won', function () {
  var map = makeMap('sm1');
  var game = new Game(map, { sharks: false, teammates: false });
  assert.strictEqual(game.state, 'ready');
  game.start();
  assert.strictEqual(game.state, 'playing');
  game.player.inventory.push({ rarity: 'common', value: 1 });
  placePlayer(game, game.boat.x, game.boat.y);
  game.setInput({ interact: true });
  game.update(0.1);
  assert.strictEqual(game.state, 'won');
});

test('navigation: world.navigate routes around a wall', function () {
  var map = wallMap();
  var game = new Game(map, { sharks: false, teammates: false });
  game.start();
  var mover = { x: 0.5, y: 4.5, faceAngle: 0, alive: true, _nav: null };
  var target = { x: 8.5, y: 4.5 };
  assert.strictEqual(game._lineOfSight(mover, target), false, 'LOS should be blocked by the wall');
  for (var i = 0; i < 300; i++) {
    game.world.navigate(mover, target, 3.0, 0.1, 'test');
  }
  var d = game._distance(mover, target);
  assert.ok(d < 1.0, 'mover should reach target around the wall, got ' + d);
});

test('navigation: shark routes around a wall to reach the player', function () {
  // Wall at x=2 separates shark (left) from player (right); the player is
  // within the shark's noise range so it is detected despite blocked LOS.
  var map = wallMap(2);
  var game = new Game(map, { sharks: true, teammates: false });
  game.start();
  var shark = game.sharks[0];
  shark.x = 0.5; shark.y = 4.5; shark._nav = null;
  placePlayer(game, 3.5, 4.5);
  assert.strictEqual(game._lineOfSight(shark, game.player), false, 'LOS should be blocked');
  var startDist = game._distance(shark, game.player);
  for (var i = 0; i < 400; i++) {
    game.update(0.1);
    if (game.state === 'failed') break;
  }
  var endDist = game._distance(shark, game.player);
  assert.ok(endDist < startDist, 'shark should close distance around the wall');
  assert.ok(endDist < 1.5 || game.reason === 'shark', 'shark should reach the player, got ' + endDist);
  // No authored fixed patrol route even after navigating.
  assert.strictEqual(shark.path, null, 'shark must not expose a fixed patrol path');
});

test('navigation: teammate routes around a wall to follow the player', function () {
  var map = wallMap();
  var game = new Game(map, { sharks: false, teammates: true });
  game.start();
  var guard = game.teammates[0];
  guard.x = 0.5; guard.y = 4.5; guard._nav = null;
  placePlayer(game, 7.5, 4.5);
  assert.strictEqual(game._lineOfSight(guard, game.player), false, 'LOS should be blocked');
  var startDist = game._distance(guard, game.player);
  for (var i = 0; i < 400; i++) {
    game.update(0.1);
  }
  var endDist = game._distance(guard, game.player);
  assert.ok(endDist < startDist, 'teammate should close distance around the wall');
  assert.ok(endDist < 1.5, 'teammate should reach the player, got ' + endDist);
});

test('navigation: AI facing turns gradually instead of snapping', function () {
  var map = wallMap();
  var game = new Game(map, { sharks: false, teammates: false });
  var mover = { x: 8.5, y: 8.5, faceAngle: 0, alive: true, _nav: null };
  game.world.navigate(mover, { x: 6.5, y: 8.5 }, 3, 0.1, 'turn');
  assert.ok(mover.faceAngle > 0);
  assert.ok(mover.faceAngle <= CONST.AI_TURN_SPEED * 0.1 + 0.0001);
});

test('navigation: shark still has no authored fixed patrol route', function () {
  var game = makeGame('nav1', { teammates: false });
  var shark = game.sharks[0];
  // Let the shark roam for a while.
  for (var i = 0; i < 100; i++) game.update(0.1);
  assert.strictEqual(shark.path, null, 'shark.path must remain null');
  var snap = game.getSnapshot();
  for (var j = 0; j < snap.sharks.length; j++) {
    assert.strictEqual(snap.sharks[j].path, null);
  }
  // The transient nav cache is private and not exposed as a patrol loop.
  assert.ok(!('path' in shark) || shark.path === null);
});

test('sprint: drains stamina without increasing oxygen drain', function () {
  var game = makeGame('sp1', { sharks: false, teammates: false });
  placePlayer(game, 10, 10);
  game.player.oxygen = 100;
  game.setInput({ x: 1, y: 0, sprint: true });
  game.update(1.0);
  var sprintOxygen = game.player.oxygen;
  var sprintStamina = game.player.stamina;
  game.player.oxygen = 100;
  game.setInput({ x: 1, y: 0, sprint: false });
  game.update(1.0);
  var normalOxygen = game.player.oxygen;
  assert.strictEqual(sprintOxygen, normalOxygen);
  assert.ok(sprintStamina < CONST.STAMINA_MAX);
});

test('sprint: exhausted stamina disables boost then regenerates', function () {
  var game = makeGame('sp2', { sharks: false, teammates: false });
  placePlayer(game, 10, 10);
  game.player.stamina = 0;
  game.setInput({ x: 1, y: 0, sprint: true });
  game.update(0.1);
  assert.strictEqual(game.player.sprinting, false);
  game.setInput({});
  game.update(CONST.STAMINA_RECOVERY_DELAY + 0.1);
  game.update(0.5);
  assert.ok(game.player.stamina > 0);
  var snap = game.getSnapshot();
  assert.ok('stamina' in snap.player);
  assert.ok(!('harpoonCooldown' in snap.player));
});

test('gear: drops have stable id, name, and rarity', function () {
  var game = makeGame('gr1', { sharks: false, teammates: false });
  var rarities = ['common', 'fine', 'rare', 'epic', 'legendary'];
  for (var i = 0; i < game.gear.length; i++) {
    var g = game.gear[i];
    assert.ok(g.id, 'gear should have an id');
    assert.ok(g.name, 'gear should have a name');
    assert.ok(rarities.indexOf(g.rarity) !== -1, 'gear rarity should be valid, got ' + g.rarity);
  }
  // Collect one and verify result.gearFound preserves the fields.
  var g0 = game.gear[0];
  placePlayer(game, g0.x, g0.y);
  game.update(0.1);
  assert.strictEqual(game.result.gearFound.length, 1);
  assert.strictEqual(game.result.gearFound[0].id, g0.id);
  assert.strictEqual(game.result.gearFound[0].name, g0.name);
  assert.strictEqual(game.result.gearFound[0].rarity, g0.rarity);
});

test('win: only teammates within boat extraction radius count and contribute treasure', function () {
  var game = makeGame('win3', { sharks: false, teammates: true });
  // Player carries one treasure.
  game.player.inventory.push({ rarity: 'rare', value: 3 });
  // Guard is at the boat (extracted), salvager is far away (not extracted).
  var guard = game.teammates[0];
  var salvager = game.teammates[1];
  guard.x = game.boat.x; guard.y = game.boat.y;
  guard.inventory.push({ rarity: 'epic', value: 4 });
  salvager.x = game.boat.x + 20; salvager.y = game.boat.y + 20;
  salvager.inventory.push({ rarity: 'legendary', value: 5 });
  placePlayer(game, game.boat.x, game.boat.y);
  game.setInput({ interact: true });
  game.update(0.1);
  assert.strictEqual(game.state, 'won');
  assert.strictEqual(game.result.extractedTeammates, 1, 'only guard should be extracted');
  assert.strictEqual(game.result.survivingTeammates, 1);
  // Combined treasure value: player(3) + guard(4) = 7; salvager's legendary not counted.
  assert.strictEqual(game.result.treasureValue, 7);
  assert.strictEqual(game.result.treasures.length, 2);
});

test('teammate: zero oxygen gets 3s grace then lost with reason oxygen', function () {
  var game = makeGame('tm4', { sharks: false, teammates: true });
  var guard = game.teammates[0];
  game.oxygenPickups.forEach(function (pickup) { pickup.collected = true; });
  guard.oxygen = 0;
  game.update(1.0);
  assert.strictEqual(guard.alive, true, 'should survive during grace');
  assert.ok(guard.suffocating > 0);
  game.update(2.1);
  assert.strictEqual(guard.alive, false, 'guard should be lost after grace');
  assert.strictEqual(game.state, 'playing', 'run should continue');
  var events = game.drainEvents();
  var lost = events.filter(function (e) { return e.type === 'teammateLost'; });
  assert.strictEqual(lost.length, 1);
  assert.strictEqual(lost[0].data.reason, 'oxygen');
});

test('gear0 增压阀: oxygenMax and starting oxygen +20, refill clamps to oxygenMax', function () {
  var game = makeGame('g0', { sharks: false, teammates: false, unlockedGear: ['gear0'] });
  assert.strictEqual(game.player.oxygenMax, CONST.OXYGEN_MAX + 20);
  assert.strictEqual(game.player.oxygen, CONST.OXYGEN_MAX + 20, 'starting oxygen should match oxygenMax');
  // Refill clamps to the boosted oxygenMax (never exceeds it).
  game.player.oxygen = game.player.oxygenMax - 10;
  var o = findOxygen(game);
  placePlayer(game, o.x, o.y);
  game.update(0.1);
  assert.ok(game.player.oxygen <= game.player.oxygenMax, 'refill should never exceed oxygenMax');
  assert.strictEqual(game.player.oxygen, game.player.oxygenMax, 'refill should clamp to oxygenMax');
  var snap = game.getSnapshot();
  assert.strictEqual(snap.player.oxygenMax, CONST.OXYGEN_MAX + 20, 'snapshot should expose oxygenMax');
});

test('gear1 声呐模块: snapshot exposes sonarUnlocked=true', function () {
  var game = makeGame('g1', { sharks: false, teammates: false, unlockedGear: ['gear1'] });
  var snap = game.getSnapshot();
  assert.strictEqual(snap.player.sonarUnlocked, true);
  assert.strictEqual(game.player.sonarUnlocked, true);
});

test('gear2 抓钩: seaweed trap duration is 1s instead of 2s', function () {
  var game = makeGame('g2', { sharks: false, teammates: false, unlockedGear: ['gear2'] });
  var w = findSeaweed(game);
  placePlayer(game, w.x, w.y);
  game.update(0.1);
  assert.ok(game.player.trapped > 0, 'player should be trapped');
  assert.ok(game.player.trapped <= 1, 'trap should be 1s with 抓钩, got ' + game.player.trapped);
  var game2 = makeGame('g2b', { sharks: false, teammates: false });
  var w2 = findSeaweed(game2);
  placePlayer(game2, w2.x, w2.y);
  game2.update(0.1);
  assert.ok(game2.player.trapped > 1, 'default trap should be 2s');
});

test('gear3 探照灯: snapshot exposes lampRangeBonus=80', function () {
  var game = makeGame('g3', { sharks: false, teammates: false, unlockedGear: ['gear3'] });
  var snap = game.getSnapshot();
  assert.strictEqual(snap.player.lampRangeBonus, 80);
  assert.strictEqual(game.player.lampRangeBonus, 80);
});

test('gear4 推进器: player speed +15% and sprint stamina drain reduced', function () {
  var game = makeGame('g4', { sharks: false, teammates: false, unlockedGear: ['gear4'] });
  var base = makeGame('g4b', { sharks: false, teammates: false });
  assert.strictEqual(game._playerSpeedMult(), 1.15);
  assert.strictEqual(base._playerSpeedMult(), 1);

  // Sprint stamina: drain with gear4 should be less than default sprint drain.
  var g4sprint = makeGame('g4c', { sharks: false, teammates: false, unlockedGear: ['gear4'] });
  var baseSprint = makeGame('g4d', { sharks: false, teammates: false });
  placePlayer(g4sprint, 10, 10);
  placePlayer(baseSprint, 10, 10);
  g4sprint.player.stamina = 100;
  baseSprint.player.stamina = 100;
  g4sprint.setInput({ x: 1, y: 0, sprint: true });
  baseSprint.setInput({ x: 1, y: 0, sprint: true });
  g4sprint.update(1.0);
  baseSprint.update(1.0);
  var g4Drain = 100 - g4sprint.player.stamina;
  var baseDrain = 100 - baseSprint.player.stamina;
  assert.ok(g4Drain < baseDrain, 'gear4 should reduce sprint stamina drain');
  assert.ok(Math.abs(g4Drain - CONST.STAMINA_DRAIN * 0.72) < 0.01);
});

test('gear: teammate limits unchanged by unlocked gear', function () {
  var game = makeGame('g5', { sharks: false, teammates: true, unlockedGear: ['gear0', 'gear1', 'gear2', 'gear3', 'gear4'] });
  var guard = game.teammates[0];
  var salvager = game.teammates[1];
  assert.strictEqual(guard.oxygenMax, undefined, 'teammates should not gain oxygenMax');
  assert.strictEqual(guard.oxygen, CONST.OXYGEN_MAX, 'teammate oxygen should stay at default max');
  assert.strictEqual(salvager.oxygen, CONST.OXYGEN_MAX);
  assert.strictEqual(guard.sonarUnlocked, undefined, 'teammates should not gain sonar');
  assert.strictEqual(guard.lampRangeBonus, undefined, 'teammates should not gain lamp bonus');
});

// ---------------------------------------------------------------------------

console.log('');
if (failures === 0) {
  console.log('All ' + passed + ' tests passed.');
  process.exit(0);
} else {
  console.error(failures + ' of ' + (passed + failures) + ' tests FAILED.');
  process.exit(1);
}
