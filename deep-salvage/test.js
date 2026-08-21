'use strict';

var assert = require('assert');
var Terrain = require('./maps.js');
var passed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (error) {
    error.message = name + ': ' + error.message;
    throw error;
  }
}

function distance(a, b) {
  var dx = a.x - b.x;
  var dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

var reference = Terrain.generateTerrain('DS-REFERENCE');

test('固定尺寸与 tile size', function () {
  assert.strictEqual(reference.cols, 56);
  assert.strictEqual(reference.rows, 68);
  assert.strictEqual(reference.tileSize, 42);
});

test('同一种子结果稳定', function () {
  var second = Terrain.generateTerrain('DS-REFERENCE');
  assert.strictEqual(Terrain.terrainFingerprint(reference), Terrain.terrainFingerprint(second));
});

test('不同种子产生不同地形', function () {
  var fingerprints = {};
  for (var i = 0; i < 12; i++) {
    fingerprints[Terrain.terrainFingerprint(Terrain.generateTerrain('DS-DIVERSE-' + i))] = true;
  }
  assert.ok(Object.keys(fingerprints).length >= 10);
});

test('返程捷径默认封闭', function () {
  var gate = reference.entities.shortcut;
  assert.strictEqual(reference.grid[gate.y][gate.x], Terrain.TILE.GATE);
  assert.strictEqual(Terrain.isPassable(reference, gate.x, gate.y, false), false);
  assert.strictEqual(Terrain.isPassable(reference, gate.x, gate.y, true), true);
});

test('生成内容数量符合原型要求', function () {
  assert.strictEqual(reference.entities.oxygen.length, 6);
  assert.strictEqual(reference.entities.treasures.length, 10);
  assert.strictEqual(reference.entities.habitats.length, 2);
  assert.strictEqual(reference.entities.vortices.length, 2);
  assert.strictEqual(reference.entities.mines.length, 1);
});

test('扩大地图保持足够开放水域', function () {
  var rock = 0;
  for (var y = 0; y < reference.rows; y++) {
    for (var x = 0; x < reference.cols; x++) if (reference.grid[y][x] === Terrain.TILE.ROCK) rock++;
  }
  assert.ok(rock / (reference.cols * reference.rows) < 0.6);
});

test('深渊核心固定包含传奇宝物', function () {
  var legendary = reference.entities.treasures.filter(function (item) { return item.rarity === 'legendary'; });
  assert.strictEqual(legendary.length, 1);
  assert.ok(distance(legendary[0], reference.anchors.core) <= 2);
});

test('鲨鱼只有栖息范围数据，不含固定巡逻环', function () {
  reference.entities.habitats.forEach(function (habitat) {
    assert.ok(habitat.radius > 0);
    assert.strictEqual(habitat.path, undefined);
    assert.strictEqual(habitat.patrol, undefined);
  });
});

test('海草长在岩壁边缘，鲨鱼巢穴贴近岩壁', function () {
  function hasNeighbor(point, predicate) {
    var dirs = [[1,0],[-1,0],[0,1],[0,-1]];
    return dirs.some(function (dir) { return predicate(point.x + dir[0], point.y + dir[1]); });
  }
  reference.entities.seaweed.forEach(function (weed) {
    assert.strictEqual(reference.grid[weed.y][weed.x], Terrain.TILE.ROCK);
    assert.ok(hasNeighbor(weed, function (x, y) { return Terrain.isPassable(reference, x, y, true); }));
  });
  reference.entities.habitats.forEach(function (nest) {
    assert.ok(Terrain.isPassable(reference, nest.x, nest.y, true));
    assert.ok(hasNeighbor(nest, function (x, y) {
      return y >= 0 && x >= 0 && y < reference.rows && x < reference.cols && reference.grid[y][x] === Terrain.TILE.ROCK;
    }));
  });
});

test('出生区不会被鲨鱼栖息范围覆盖', function () {
  reference.entities.habitats.forEach(function (habitat) {
    assert.ok(distance(habitat, reference.entities.spawn) > habitat.radius + 2);
  });
});

test('宝物和氧气均落在可通行区域', function () {
  reference.entities.treasures.concat(reference.entities.oxygen).forEach(function (point) {
    assert.strictEqual(Terrain.isPassable(reference, point.x, point.y, true), true);
  });
});

test('批量种子全部通过地形校验', function () {
  for (var i = 0; i < 80; i++) {
    var map = Terrain.generateTerrain('DS-BATCH-' + i);
    assert.ok(map.validation.ok, 'seed=' + map.seed + ' errors=' + map.validation.errors.join(','));
    assert.ok(map.validation.leftPathLength > 0);
    assert.ok(map.validation.rightPathLength > 0);
  }
});

console.log('deep-salvage terrain tests: ' + passed + ' passed');
