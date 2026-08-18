/* PAC-MAN 完整版 - 迷宫数据 (maps.js) */
'use strict';
(function(win){
var PAC = win.PAC = win.PAC || {};

// 字符说明: #墙 .豆 o大力丸 P出生点 =鬼屋 -鬼屋门(仅鬼可通过)
PAC.MAPS = [
  { id:'classic', name:'经典迷宫', desc:'传统吃豆布局，均衡耐玩', rows:[
    '#####################',
    '#.........#.........#',
    '#o##.###.#.#.###.##o#',
    '#...................#',
    '#.##.#.#.....#.#.##.#',
    '#....#...#.#...#....#',
    '####.#.###.###.#.####',
    '#....#.........#....#',
    '####.#.##---##.#.####',
    '#......#=====#......#',
    '#......#=====#......#',
    '####.#.##---##.#.####',
    '#.......#...#.......#',
    '#.##.#.#.....#.#.##.#',
    '#.##.#.#.....#.#.##.#',
    '#....#.#.....#.#....#',
    '#o##.###.....###.##o#',
    '#.........P.........#',
    '#####################',
  ]},
  { id:'ring', name:'环线竞速', desc:'环形赛道为主，节奏飞快', rows:[
    '#####################',
    '#.o...............o.#',
    '#.########.########.#',
    '#.########.########.#',
    '#.##.............##.#',
    '#.##.#####.#####.##.#',
    '#.##.#####.#####.##.#',
    '#.##.#####.#####.##.#',
    '#.##.#####-#####.##.#',
    '#.##.###=====###.##.#',
    '#.##.###=====###.##.#',
    '#.##.#####-#####.##.#',
    '#.##.#####.#####.##.#',
    '#.##.#####.#####.##.#',
    '#.##.............##.#',
    '#.########.########.#',
    '#.########.########.#',
    '#.o.......P.......o.#',
    '#####################',
  ]},
  { id:'cross', name:'十字交汇', desc:'十字路口密布，幽灵易围堵', rows:[
    '#####################',
    '#.o...............o.#',
    '#.###.####.####.###.#',
    '#.###.####.####.###.#',
    '#...................#',
    '#.###.####.####.###.#',
    '#.###.####.####.###.#',
    '#.###.####.####.###.#',
    '#.###.###---###.###.#',
    '#.###.##=====##.###.#',
    '#.###.##=====##.###.#',
    '#.###.###---###.###.#',
    '#.###.####.####.###.#',
    '#.###.####.####.###.#',
    '#...................#',
    '#.###.####.####.###.#',
    '#.###.####.####.###.#',
    '#.o.......P.......o.#',
    '#####################',
  ]},
  { id:'alleys', name:'窄巷迷阵', desc:'窄巷与转角众多，步步惊心', rows:[
    '#####################',
    '#o....#.....#......o#',
    '#####.###.###.#####.#',
    '#...#...#.....#.....#',
    '#.#.###.#.#####.###.#',
    '#.#...#.#...#.#.....#',
    '#.###.#.###.#.#.#.###',
    '#.#...#.......#.#...#',
    '#.#####.#---#.#.###.#',
    '#.#.....=====.....#.#',
    '#.#.####=====##.#.###',
    '#.#...#..---..#.#...#',
    '#.###.##......#####.#',
    '#...#...#...#.......#',
    '#.#.###.#.#######.#.#',
    '#.#...#...#.....#...#',
    '#.###.#.#.#.#####.###',
    '#o..#.....P........o#',
    '#####################',
  ]},
];

/* ---------- Maze: 解析字符网格 ---------- */
PAC.Maze = function(rows){
  this.rows = rows;
  this.H = rows.length; this.W = rows[0].length;
  this.grid = [];
  this.pacSpawn = null; this.houseCells = []; this.doorCells = [];
  this.dotCount = 0; this.pelletCount = 0; this.fruitCell = null;
  var bestD = 1e9;
  for (var r=0;r<this.H;r++){ var row=[];
    for (var c=0;c<this.W;c++){
      var ch = rows[r][c], t = 'wall';
      if (ch==='#') t='wall';
      else if (ch==='.'){ t='dot'; this.dotCount++; }
      else if (ch==='o'){ t='pellet'; this.pelletCount++; }
      else if (ch==='P'){ t='spawn'; this.pacSpawn={r:r,c:c}; }
      else if (ch==='='){ t='house'; this.houseCells.push({r:r,c:c}); }
      else if (ch==='-'){ t='door'; this.doorCells.push({r:r,c:c}); }
      else { t='floor'; }
      row.push({t:t, ch:ch});
      // 水果位置: 偏向中心下方、可通行空地
      if (t==='floor'||t==='dot'||t==='pellet'){
        var d = Math.abs(r-9)+Math.abs(c-10);
        if (d<bestD && r>7){ bestD=d; this.fruitCell={r:r,c:c}; }
      }
    } this.grid.push(row);
  }
};
PAC.Maze.prototype = {
  inBounds:function(r,c){ return r>=0&&r<this.H&&c>=0&&c<this.W; },
  cell:function(r,c){ return this.inBounds(r,c)?this.grid[r][c]:null; },
  isWall:function(r,c){ var x=this.cell(r,c); return !x||x.t==='wall'||x.t==='door'; },
  // pacman 可通行 (墙/门/鬼屋不可)
  pacOk:function(r,c){ var x=this.cell(r,c); return x&&(x.t==='dot'||x.t==='pellet'||x.t==='spawn'||x.t==='floor'); },
  // 幽灵可通行 (鬼屋/门也可)
  ghostOk:function(r,c){ var x=this.cell(r,c); return x&&(x.t!=='wall'); },
  isDot:function(r,c){ var x=this.cell(r,c); return x&&x.t==='dot'; },
  isPellet:function(r,c){ var x=this.cell(r,c); return x&&x.t==='pellet'; },
  isHouse:function(r,c){ var x=this.cell(r,c); return x&&x.t==='house'; },
  hasDots:function(){ for(var r=0;r<this.H;r++)for(var c=0;c<this.W;c++){var x=this.grid[r][c]; if(x.t==='dot'||x.t==='pellet')return true;} return false; },
  eat:function(r,c){ var x=this.cell(r,c); if(!x) return null;
    if(x.t==='dot'){ x.t='floor'; x.ch=' '; return 10; }
    if(x.t==='pellet'){ x.t='floor'; x.ch=' '; return 50; }
    return null; },
};
})(typeof window!=='undefined'?window:this);
