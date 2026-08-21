(function (global, factory) {
  'use strict';
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.DeepSalvageTerrain = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var TILE = {
    ROCK: 0,
    WATER: 1,
    WRECK: 2,
    GATE: 3
  };

  var COLS = 56;
  var ROWS = 68;
  var TILE_SIZE = 42;

  function hashSeed(value) {
    var text = String(value == null ? '' : value);
    var hash = 2166136261;
    for (var i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function mulberry32(seed) {
    return function () {
      seed |= 0;
      seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function coordNoise(seed, x, y) {
    var n = Math.imul(x + 101, 374761393) ^ Math.imul(y + 313, 668265263) ^ seed;
    n = Math.imul(n ^ n >>> 13, 1274126177);
    return ((n ^ n >>> 16) >>> 0) / 4294967295;
  }

  function makeGrid(value) {
    var grid = [];
    for (var y = 0; y < ROWS; y++) {
      var row = [];
      for (var x = 0; x < COLS; x++) row.push(value);
      grid.push(row);
    }
    return grid;
  }

  function clamp(value, min, max) {
    return value < min ? min : (value > max ? max : value);
  }

  function distance(a, b) {
    var dx = a.x - b.x;
    var dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function inside(map, x, y) {
    return x >= 0 && y >= 0 && x < map.cols && y < map.rows;
  }

  function tilePassable(tile, gatesOpen) {
    return tile === TILE.WATER || tile === TILE.WRECK || (gatesOpen && tile === TILE.GATE);
  }

  function isPassable(map, x, y, gatesOpen) {
    return inside(map, x, y) && tilePassable(map.grid[y][x], gatesOpen !== false);
  }

  function carveCell(grid, x, y, tile) {
    if (x <= 0 || y <= 0 || x >= COLS - 1 || y >= ROWS - 1) return;
    grid[y][x] = tile == null ? TILE.WATER : tile;
  }

  function carveBrush(grid, cx, cy, radius, tile, seed) {
    var minX = Math.floor(cx - radius - 1);
    var maxX = Math.ceil(cx + radius + 1);
    var minY = Math.floor(cy - radius - 1);
    var maxY = Math.ceil(cy + radius + 1);
    for (var y = minY; y <= maxY; y++) {
      for (var x = minX; x <= maxX; x++) {
        var noise = (coordNoise(seed, x, y) - 0.5) * 0.55;
        var dx = x - cx;
        var dy = y - cy;
        if (Math.sqrt(dx * dx + dy * dy) <= radius + noise) carveCell(grid, x, y, tile);
      }
    }
  }

  function carveEllipse(grid, cx, cy, rx, ry, tile, seed) {
    for (var y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
      for (var x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
        var nx = (x - cx) / rx;
        var ny = (y - cy) / ry;
        var noise = (coordNoise(seed + 19, x, y) - 0.5) * 0.22;
        if (nx * nx + ny * ny <= 1 + noise) carveCell(grid, x, y, tile);
      }
    }
  }

  function carvePath(grid, points, width, tile, seed) {
    for (var i = 0; i < points.length - 1; i++) {
      var a = points[i];
      var b = points[i + 1];
      var steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) * 3;
      for (var step = 0; step <= steps; step++) {
        var t = step / steps;
        var wave = Math.sin((step + i * 7) * 0.73) * 0.28;
        var x = a.x + (b.x - a.x) * t + wave;
        var y = a.y + (b.y - a.y) * t + Math.cos((step + i * 5) * 0.61) * 0.22;
        carveBrush(grid, x, y, width, tile, seed + i * 37 + step);
      }
    }
  }

  function jitterPoint(base, random, amountX, amountY) {
    return {
      x: clamp(Math.round(base.x + (random() * 2 - 1) * amountX), 2, COLS - 3),
      y: clamp(Math.round(base.y + (random() * 2 - 1) * amountY), 2, ROWS - 3)
    };
  }

  function nearestPassable(map, point, gatesOpen) {
    var px = Math.round(point.x);
    var py = Math.round(point.y);
    if (isPassable(map, px, py, gatesOpen)) return { x: px, y: py };
    for (var radius = 1; radius < 9; radius++) {
      for (var oy = -radius; oy <= radius; oy++) {
        for (var ox = -radius; ox <= radius; ox++) {
          if (Math.abs(ox) !== radius && Math.abs(oy) !== radius) continue;
          var x = px + ox;
          var y = py + oy;
          if (isPassable(map, x, y, gatesOpen)) return { x: x, y: y };
        }
      }
    }
    return { x: px, y: py };
  }

  function placeNear(map, base, random, radius) {
    for (var attempt = 0; attempt < 40; attempt++) {
      var angle = random() * Math.PI * 2;
      var length = random() * radius;
      var point = {
        x: Math.round(base.x + Math.cos(angle) * length),
        y: Math.round(base.y + Math.sin(angle) * length)
      };
      if (isPassable(map, point.x, point.y, true)) return point;
    }
    return nearestPassable(map, base, true);
  }

  function hasPassableNeighbor(map, x, y) {
    return isPassable(map, x + 1, y, true) || isPassable(map, x - 1, y, true) ||
      isPassable(map, x, y + 1, true) || isPassable(map, x, y - 1, true);
  }

  function isRockEdge(map, x, y) {
    return inside(map, x, y) && map.grid[y][x] === TILE.ROCK && hasPassableNeighbor(map, x, y);
  }

  function hasRockNeighbor(map, x, y) {
    return inside(map, x + 1, y) && map.grid[y][x + 1] === TILE.ROCK ||
      inside(map, x - 1, y) && map.grid[y][x - 1] === TILE.ROCK ||
      inside(map, x, y + 1) && map.grid[y + 1][x] === TILE.ROCK ||
      inside(map, x, y - 1) && map.grid[y - 1][x] === TILE.ROCK;
  }

  function placePassableEdgeNear(map, base, random, radius) {
    for (var attempt = 0; attempt < 120; attempt++) {
      var x = clamp(Math.round(base.x + (random() * 2 - 1) * radius), 1, map.cols - 2);
      var y = clamp(Math.round(base.y + (random() * 2 - 1) * radius), 1, map.rows - 2);
      if (isPassable(map, x, y, true) && hasRockNeighbor(map, x, y)) return { x: x, y: y };
    }
    var maxRadius = Math.max(map.cols, map.rows);
    for (var r = 1; r < maxRadius; r++) {
      for (var oy = -r; oy <= r; oy++) {
        for (var ox = -r; ox <= r; ox++) {
          if (Math.abs(ox) !== r && Math.abs(oy) !== r) continue;
          var px = Math.round(base.x) + ox;
          var py = Math.round(base.y) + oy;
          if (inside(map, px, py) && isPassable(map, px, py, true) && hasRockNeighbor(map, px, py)) return { x: px, y: py };
        }
      }
    }
    return nearestPassable(map, base, true);
  }

  function placeRockEdgeNear(map, base, random, radius, avoid, minDistance) {
    function usable(x, y) {
      return isRockEdge(map, x, y) && (!avoid || distance({ x: x, y: y }, avoid) >= minDistance);
    }
    for (var attempt = 0; attempt < 120; attempt++) {
      var x = clamp(Math.round(base.x + (random() * 2 - 1) * radius), 1, map.cols - 2);
      var y = clamp(Math.round(base.y + (random() * 2 - 1) * radius), 1, map.rows - 2);
      if (usable(x, y)) return { x: x, y: y };
    }
    for (var r = 1; r < Math.max(map.cols, map.rows); r++) {
      for (var oy = -r; oy <= r; oy++) {
        for (var ox = -r; ox <= r; ox++) {
          if (Math.abs(ox) !== r && Math.abs(oy) !== r) continue;
          var px = Math.round(base.x) + ox;
          var py = Math.round(base.y) + oy;
          if (usable(px, py)) return { x: px, y: py };
        }
      }
    }
    return { x: Math.round(base.x), y: Math.round(base.y) };
  }

  function convertWreckTiles(map) {
    for (var y = 12; y < 54; y++) {
      for (var x = 32; x < COLS - 2; x++) {
        if (map.grid[y][x] !== TILE.WATER) continue;
        if (coordNoise(map.seedValue + 71, x, y) > 0.23) map.grid[y][x] = TILE.WRECK;
      }
    }
  }

  function createEntities(map, anchors, random) {
    var entities = {
      boat: nearestPassable(map, anchors.boat, true),
      spawn: nearestPassable(map, { x: anchors.boat.x, y: anchors.boat.y + 2 }, true),
      oxygen: [],
      treasures: [],
      seaweed: [],
      vortices: [],
      mines: [],
      habitats: [],
      shortcut: nearestPassable(map, anchors.shortcut, true)
    };

    var oxygenBases = [anchors.shallow, anchors.leftB, anchors.rightB, anchors.leftC, anchors.rightC, anchors.deep];
    for (var i = 0; i < oxygenBases.length; i++) {
      entities.oxygen.push(placeNear(map, oxygenBases[i], random, i === 3 ? 2 : 3));
    }

    var treasureBases = [
      anchors.leftA, anchors.rightA, anchors.leftB, anchors.rightB, anchors.mid,
      anchors.leftC, anchors.rightC, anchors.shortcut, anchors.deep, anchors.core
    ];
    var rarities = ['common', 'fine', 'fine', 'rare', 'rare', 'rare', 'epic', 'epic', 'epic', 'legendary'];
    for (var t = 0; t < treasureBases.length; t++) {
      var treasure = placeNear(map, treasureBases[t], random, t === treasureBases.length - 1 ? 1 : 3);
      treasure.rarity = rarities[t];
      entities.treasures.push(treasure);
    }

    var weedBases = [anchors.leftA, anchors.leftC, anchors.rightA, anchors.rightC];
    for (var w = 0; w < weedBases.length; w++) {
      var weed = placeRockEdgeNear(map, weedBases[w], random, 5, entities.spawn, 6.5);
      weed.radius = 1.05 + random() * 0.25;
      entities.seaweed.push(weed);
    }

    var vortexBases = [anchors.leftB, anchors.deep];
    for (var v = 0; v < vortexBases.length; v++) {
      var vortex = placeNear(map, vortexBases[v], random, 2);
      vortex.radius = v === 0 ? 2.3 : 2.8;
      vortex.spin = random() > 0.5 ? 1 : -1;
      entities.vortices.push(vortex);
    }

    var mine = placeNear(map, { x: anchors.rightB.x + 2, y: anchors.rightB.y + 2 }, random, 2);
    mine.radius = 0.85;
    entities.mines.push(mine);

    var habitatDefs = [
      { name: '沉船巢穴', base: anchors.rightB, radius: 8.2, aggression: 0.72 },
      { name: '深渊巢穴', base: anchors.core, radius: 10.0, aggression: 1.0 }
    ];
    for (var h = 0; h < habitatDefs.length; h++) {
      var def = habitatDefs[h];
      var home = placePassableEdgeNear(map, def.base, random, 5);
      entities.habitats.push({
        name: def.name,
        x: home.x,
        y: home.y,
        radius: def.radius,
        aggression: def.aggression
      });
    }

    return entities;
  }

  function generateTerrain(seed) {
    var seedText = seed == null ? Date.now().toString(36) : String(seed);
    var seedValue = hashSeed(seedText);
    var random = mulberry32(seedValue);
    var grid = makeGrid(TILE.ROCK);

    var anchors = {
      boat: jitterPoint({ x: 28, y: 2 }, random, 1, 0),
      shallow: jitterPoint({ x: 28, y: 10 }, random, 3, 1),
      leftA: jitterPoint({ x: 14, y: 18 }, random, 3, 2),
      leftB: jitterPoint({ x: 10, y: 32 }, random, 2, 2),
      leftC: jitterPoint({ x: 16, y: 47 }, random, 3, 2),
      rightA: jitterPoint({ x: 42, y: 18 }, random, 3, 2),
      rightB: jitterPoint({ x: 46, y: 32 }, random, 2, 2),
      rightC: jitterPoint({ x: 40, y: 47 }, random, 3, 2),
      mid: jitterPoint({ x: 28, y: 32 }, random, 3, 2),
      deep: jitterPoint({ x: 28, y: 58 }, random, 3, 1),
      core: jitterPoint({ x: 28, y: 65 }, random, 2, 0),
      shortcut: jitterPoint({ x: 28, y: 46 }, random, 2, 1)
    };

    carveEllipse(grid, anchors.boat.x, anchors.boat.y + 1, 6.4, 3.6, TILE.WATER, seedValue);
    carveEllipse(grid, anchors.shallow.x, anchors.shallow.y, 8.0, 5.0, TILE.WATER, seedValue + 1);
    carveEllipse(grid, anchors.leftA.x, anchors.leftA.y, 7.0, 5.1, TILE.WATER, seedValue + 2);
    carveEllipse(grid, anchors.leftB.x, anchors.leftB.y, 8.0, 6.2, TILE.WATER, seedValue + 3);
    carveEllipse(grid, anchors.leftC.x, anchors.leftC.y, 7.2, 5.8, TILE.WATER, seedValue + 4);
    carveEllipse(grid, anchors.rightA.x, anchors.rightA.y, 8.0, 5.2, TILE.WRECK, seedValue + 5);
    carveEllipse(grid, anchors.rightB.x, anchors.rightB.y, 8.0, 6.2, TILE.WRECK, seedValue + 6);
    carveEllipse(grid, anchors.rightC.x, anchors.rightC.y, 7.2, 5.8, TILE.WRECK, seedValue + 7);
    carveEllipse(grid, anchors.mid.x, anchors.mid.y, 7.2, 5.2, TILE.WATER, seedValue + 8);
    carveEllipse(grid, anchors.deep.x, anchors.deep.y, 9.0, 5.8, TILE.WATER, seedValue + 9);
    carveEllipse(grid, anchors.core.x, anchors.core.y, 9.2, 3.2, TILE.WATER, seedValue + 10);

    carvePath(grid, [anchors.boat, anchors.shallow], 2.5, TILE.WATER, seedValue + 20);
    carvePath(grid, [anchors.shallow, anchors.leftA, anchors.leftB, anchors.leftC, anchors.deep, anchors.core], 2.35, TILE.WATER, seedValue + 21);
    carvePath(grid, [anchors.shallow, anchors.rightA, anchors.rightB, anchors.rightC, anchors.deep, anchors.core], 2.4, TILE.WRECK, seedValue + 22);
    carvePath(grid, [anchors.leftA, anchors.mid, anchors.rightA], 2.0, TILE.WATER, seedValue + 23);
    carvePath(grid, [anchors.leftB, anchors.mid, anchors.rightB], 1.9, TILE.WATER, seedValue + 24);
    carvePath(grid, [anchors.leftC, anchors.shortcut, anchors.rightC], 1.8, TILE.WATER, seedValue + 25);

    var map = {
      seed: seedText,
      seedValue: seedValue,
      cols: COLS,
      rows: ROWS,
      tileSize: TILE_SIZE,
      grid: grid,
      anchors: anchors,
      entities: null
    };

    convertWreckTiles(map);

    var gate = nearestPassable(map, anchors.shortcut, true);
    grid[gate.y][gate.x] = TILE.GATE;
    anchors.shortcut = gate;

    map.entities = createEntities(map, anchors, random);
    map.entities.shortcut = gate;
    map.validation = validateTerrain(map);
    return map;
  }

  function findPath(map, start, goal, options) {
    options = options || {};
    var gatesOpen = options.gatesOpen !== false;
    var blocked = options.blocked || null;
    var queue = [{ x: start.x, y: start.y }];
    var visited = makeGrid(false);
    var prev = makeGrid(null);
    visited[start.y][start.x] = true;
    var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    while (queue.length) {
      var current = queue.shift();
      if (current.x === goal.x && current.y === goal.y) {
        var path = [];
        var node = current;
        while (node) {
          path.push(node);
          node = prev[node.y][node.x];
        }
        path.reverse();
        return path;
      }
      for (var i = 0; i < dirs.length; i++) {
        var nx = current.x + dirs[i][0];
        var ny = current.y + dirs[i][1];
        if (!inside(map, nx, ny) || visited[ny][nx]) continue;
        if (blocked && blocked(nx, ny)) continue;
        if (!isPassable(map, nx, ny, gatesOpen)) continue;
        visited[ny][nx] = true;
        prev[ny][nx] = current;
        queue.push({ x: nx, y: ny });
      }
    }
    return [];
  }

  function validateTerrain(map) {
    var errors = [];
    var e = map.entities;
    if (!e) return { ok: false, errors: ['实体尚未生成'] };

    var mainPath = findPath(map, e.spawn, map.anchors.core, { gatesOpen: false });
    if (!mainPath.length) errors.push('出生点无法抵达深渊核心');

    var leftPath = findPath(map, map.anchors.shallow, map.anchors.deep, {
      gatesOpen: false,
      blocked: function (x, y) { return x > Math.floor(map.cols / 2) + 3 && y > 7; }
    });
    if (!leftPath.length) errors.push('左侧开放海床路线不连通');

    var rightPath = findPath(map, map.anchors.shallow, map.anchors.deep, {
      gatesOpen: false,
      blocked: function (x, y) { return x < Math.floor(map.cols / 2) - 3 && y > 7; }
    });
    if (!rightPath.length) errors.push('右侧沉船路线不连通');

    var pointGroups = [e.oxygen, e.treasures, e.vortices, e.mines];
    for (var g = 0; g < pointGroups.length; g++) {
      for (var p = 0; p < pointGroups[g].length; p++) {
        var point = pointGroups[g][p];
        if (!isPassable(map, point.x, point.y, true)) errors.push('实体落在不可通行格 ' + point.x + ',' + point.y);
      }
    }

    for (var w = 0; w < e.seaweed.length; w++) {
      if (!isRockEdge(map, e.seaweed[w].x, e.seaweed[w].y)) errors.push('海草没有生长在岩壁边缘');
    }

    var hazards = e.seaweed.concat(e.vortices);
    for (var h = 0; h < hazards.length; h++) {
      if (distance(hazards[h], e.spawn) < 6) errors.push('危险物离出生点过近');
    }
    for (var z = 0; z < e.habitats.length; z++) {
      if (distance(e.habitats[z], e.spawn) <= e.habitats[z].radius + 2) errors.push('鲨鱼栖息区覆盖出生安全区');
    }

    if (e.oxygen.length < 5) errors.push('氧气补给点不足');
    if (e.treasures.length < 9) errors.push('宝物候选点不足');
    if (e.habitats.length !== 2) errors.push('鲨鱼栖息区数量错误');
    for (var n = 0; n < e.habitats.length; n++) {
      if (!hasRockNeighbor(map, e.habitats[n].x, e.habitats[n].y)) errors.push('鲨鱼巢穴没有贴近岩壁');
    }

    return {
      ok: errors.length === 0,
      errors: errors,
      mainPathLength: mainPath.length,
      leftPathLength: leftPath.length,
      rightPathLength: rightPath.length
    };
  }

  function terrainFingerprint(map) {
    var rows = [];
    for (var y = 0; y < map.rows; y++) rows.push(map.grid[y].join(''));
    var points = map.entities.treasures.concat(map.entities.oxygen).map(function (p) {
      return p.x + ',' + p.y + (p.rarity || '');
    });
    return hashSeed(rows.join('|') + '|' + points.join('|'));
  }

  return {
    TILE: TILE,
    COLS: COLS,
    ROWS: ROWS,
    TILE_SIZE: TILE_SIZE,
    generateTerrain: generateTerrain,
    validateTerrain: validateTerrain,
    findPath: findPath,
    isPassable: isPassable,
    terrainFingerprint: terrainFingerprint,
    hashSeed: hashSeed
  };
});
