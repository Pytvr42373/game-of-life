/* ============================================================
 * maps.js - 地图数据 (黎明迷局 / 暗夜追逃)
 * 网格地图：字符画定义 + 运行时解析
 * 图例：#墙 .地板 x地板变体 W窗 P板子 M密码机 R处刑架 G逃生门 S求生者出生 H监管者出生
 * ============================================================ */

var TILE = {
  WALL: '#', FLOOR: '.', FLOOR2: 'x',
  WIN: 'W', PAL: 'P',
  MACH: 'M', CHAIR: 'R', GATE: 'G',
  SPAWN_S: 'S', SPAWN_H: 'H'
};

function tileSolid(c) {
  return c === TILE.WALL || c === TILE.WIN;
}

function parseMap(def) {
  var rows = def.grid;
  var ts = def.ts || 42;
  var grid = [];
  var E = { machines: [], chairs: [], gates: [], pallets: [], windows: [], spawns: [], hunterSpawn: null };
  var cols = 0;
  for (var y = 0; y < rows.length; y++) {
    var line = rows[y];
    if (line.length > cols) cols = line.length;
    grid[y] = [];
    for (var x = 0; x < line.length; x++) {
      var c = line[x];
      grid[y][x] = c;
      var px = x * ts + ts / 2;
      var py = y * ts + ts / 2;
      if (c === TILE.MACH) E.machines.push({ x: px, y: py, tx: x, ty: y, progress: 0, max: 100, decoded: false, occupiedBy: null, ghost: 0, decoders: 0 });
      else if (c === TILE.CHAIR) E.chairs.push({ x: px, y: py, tx: x, ty: y, occupant: null, timer: 0, total: 55, broken: false });
      else if (c === TILE.GATE) E.gates.push({ x: px, y: py, tx: x, ty: y, progress: 0, powered: false, open: false, leverBy: null });
      else if (c === TILE.PAL) E.pallets.push({ x: px, y: py, tx: x, ty: y, down: false, breakT: 0, stun: 0 });
      else if (c === TILE.WIN) E.windows.push({ x: px, y: py, tx: x, ty: y, cd: 0 });
      else if (c === TILE.SPAWN_S) E.spawns.push({ x: px, y: py });
      else if (c === TILE.SPAWN_H) E.hunterSpawn = { x: px, y: py };
    }
  }
  for (var yy = 0; yy < rows.length; yy++) {
    while (grid[yy].length < cols) grid[yy].push(TILE.WALL);
  }
  return {
    name: def.name, en: def.en, desc: def.desc, vibe: def.vibe || {},
    ts: ts, grid: grid, entities: E,
    cols: cols, rows: rows.length
  };
}

/* 1. 雾夜教堂 */
var MAP_CHAPEL = {
  name: '雾夜教堂', en: 'Chapel of Mists',
  desc: '废弃多年的哥特教堂，烛火在雾中摇曳。长殿被三排石柱与隔墙分成墓室与告解间，地下通道连通两扇大门。',
  vibe: { fog: 0.85, warm: [255, 200, 120], cool: [120, 160, 255] },
  ts: 42,
  grid: [
    "##############################",
    "#......#.......#......#......#",
    "#...M..#....M..#......#..M...#",
    "#......#.......H......#......#",
    "#............................#",
    "#......#.......#......#......#",
    "#......#.......#......#......#",
    "#.R....#...R...#....R.#......#",
    "########.###.###.##.###.######",
    "#......#.P.....P......#......#",
    "#......W...##..#..##..W......#",
    "#....P.#...##..#..##..#.P....#",
    "#......#.......#......#......#",
    "##R.####.##R####.##.###.###R##",
    "#.G....#.......#......#....G.#",
    "#............................#",
    "#.##...#.P.....P......#..##..#",
    "#.##S..#.......#......#.S##..#",
    "#......#.......#......#......#",
    "#......#.....S.#......#......#",
    "##############################"
  ]
};

/* 2. 荒芜庄园 */
var MAP_MANOR = {
  name: '荒芜庄园', en: 'Withered Manor',
  desc: '爬满枯藤的维多利亚庄园。前庭花园、长廊、舞厅与地窖连成迷宫，藤蔓遮蔽了视线。',
  vibe: { fog: 0.7, warm: [255, 170, 100], cool: [110, 140, 250] },
  ts: 42,
  grid: [
    "################################",
    "#........#............#........#",
    "#........#..##..H.....#........#",
    "#...M....#..##M.......#....M...#",
    "#........#............#........#",
    "#..............................#",
    "#........#............#..##....#",
    "#.R......#....R.......#..##.R..#",
    "#........#............#........#",
    "#....P...#............#...P....#",
    "##########.##.####.####.###.####",
    "#........#.P........P.#........#",
    "#...##...W............W........#",
    "#...##...#............#........#",
    "#........#............#........#",
    "#####.####.##.####.####.########",
    "#........#............#........#",
    "#..............................#",
    "#.G......#.P........P.#...##.G.#",
    "#.....M..#......##....#...##...#",
    "#...S....#......##....#.....S..#",
    "#........#....S.......#........#",
    "################################"
  ]
};

/* 3. 废弃医院 */
var MAP_ASYLUM = {
  name: '废弃医院', en: 'Abandoned Asylum',
  desc: '早已废弃的精神病院，走廊昏暗、病床蒙尘。病房区与手术室被铁栅隔开。',
  vibe: { fog: 0.9, warm: [255, 180, 110], cool: [100, 170, 250] },
  ts: 42,
  grid: [
    "###############################",
    "#.......#......#......#.......#",
    "#..M....#...M..#......#....M..#",
    "#.......#......H......#.......#",
    "#.............................#",
    "#.......#......#......#.......#",
    "#.......W......#......W.......#",
    "#.......#......#......#.......#",
    "#.R.....#...R..#......#...R...#",
    "#########.##.###.##.###.#######",
    "#.......#.P....#....P.#.......#",
    "#.......#..##..#..##..#.......#",
    "#....P..#..##..#..##..#..P....#",
    "#.G.....#......#......#.....G.#",
    "#####.###.######.##.###.#######",
    "#.......#......#......#.......#",
    "#.............................#",
    "#..##...#.P....#....P.#...##..#",
    "#..##...#......#......#...##..#",
    "#..S....#......#......#....S..#",
    "#.......#......S......#.......#",
    "###############################"
  ]
};

var MAPS = [MAP_CHAPEL, MAP_MANOR, MAP_ASYLUM];

/* 连通性校验(供测试用)：从首个可行走格 BFS(不穿过墙) */
function mapConnectivity(map) {
  var g = map.grid, R = map.rows, C = map.cols;
  var seen = {};
  var start = null;
  outer:
  for (var y = 0; y < R; y++) for (var x = 0; x < C; x++) {
    if (!tileSolid(g[y][x])) { start = [x, y]; break outer; }
  }
  if (!start) return { reachable: 0, total: 0, ok: false };
  var queue = [start];
  seen[start[0] + ',' + start[1]] = true;
  var reachable = 0, total = 0;
  while (queue.length) {
    var cur = queue.shift();
    var cx = cur[0], cy = cur[1];
    if (!tileSolid(g[cy][cx])) reachable++;
    var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (var i = 0; i < 4; i++) {
      var nx = cx + dirs[i][0], ny = cy + dirs[i][1];
      if (nx < 0 || ny < 0 || nx >= C || ny >= R) continue;
      if (tileSolid(g[ny][nx])) continue;
      var key = nx + ',' + ny;
      if (!seen[key]) { seen[key] = true; queue.push([nx, ny]); }
    }
  }
  for (var y2 = 0; y2 < R; y2++) for (var x2 = 0; x2 < C; x2++) {
    if (!tileSolid(g[y2][x2])) total++;
  }
  return { reachable: reachable, total: total, ok: reachable === total };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TILE: TILE, tileSolid: tileSolid, parseMap: parseMap, MAPS: MAPS, mapConnectivity: mapConnectivity };
}
