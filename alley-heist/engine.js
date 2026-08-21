/* =====================================================================
 * engine.js —— 《暗巷潜行》核心逻辑 v3（纯计算，无 DOM 依赖）
 *
 * 设计契约：
 *   - 移动模型：所有单位（玩家/守卫）共用格间补间运动学。
 *     actor 持有 { r, c, pr, pc, mdir:{dr,dc}, t(0→1), moving }
 *     speed 单位：格/秒；每帧 t 增 speed*dt；t≥1 完成换格。
 *   - 速度平衡：冲刺 5.4 格/s（完成一格发一声）· 行走 2.8 格/s（无声）·
 *     守卫巡逻 1.4 · 警戒 2.1 · 猎捕 3.4 · 追捕 4.6 · 回岗 1.8。
 *     追捕 > 行走（不跑必被抓）且 < 冲刺（跑可甩开）。
 *   - 目标：一把钥匙。拾取钥匙 → phase='escape'（强制撤离警报），
 *     所有非追捕守卫进入 hunt，目标仅为钥匙格，绝不直接知道玩家位置。
 *   - 视野：固定视距 5 + 视锥半角 0.9 + 布雷森汉姆遮挡（墙与关闭的
 *     卷帘门都遮挡）。canSee 不依赖亮暗。
 *   - 察觉：守卫 notice 持续看见玩家约 0.45s 才进入 chase（触发
 *     spotted）；短暂露头不追；丢失视线 notice 快速衰减，可调查最后
 *     瞥见位置。
 *   - 听觉：冲刺为离散声脉冲（每完成一格冲刺发一次），普通守卫 BFS
 *     半径 4、猎犬 6；开关巨响普通 7、猎犬 9。听到 → heard + 去声源
 *     investigate；chase 守卫把声源当 lastHeard。
 *   - 追捕：chase 有 LOS 追当前格；丢 LOS 去 lastSeen/lastHeard；
 *     到达后 search 约 3 秒（搜索附近可达格）；无新线索 return。
 *     escape 阶段回岗后以较快 patrol 继续，不永远知道玩家。
 *   - 抓捕：仅 chase 状态，插值 pr/pc 欧氏距离 ≤ 0.48 且 lineOfSight；
 *     无隔墙抓、无曼哈顿 2 格抓；hunt/search 不能隔空抓。
 *   - 卷帘门：D 关闭时 solid；在 S 上按 interact 打开全部 D（永久），
 *     触发 switch/gateOpen 并发出巨响。
 *   - 出口：取钥匙前 lockedExit，取钥匙后 goal。
 *   - 出生安全：任何守卫初始朝向不得看见出生点（spawnSafe 校验）。
 *
 * 事件型 update(state, actions, dt)：actions={up,down,left,right,
 * sprint,interact,lastDir}，返回本帧事件数组 [noticed, spotted, heard,
 * key, alarm, switch, gateOpen, lost, calm, lockedExit, caught, goal]。
 * 暴露全局 window.AlleyEngine；支持 Node require 自检。
 * ===================================================================== */
(function (global) {
  'use strict';

  /* ================= 配置（单位注释） ================= */
  var cfg = {
    playerWalk: 2.8,            // 玩家行走 格/秒（无声）
    playerSprint: 5.4,          // 玩家冲刺 格/秒（完成一格发一声）
    guardPatrol: 1.4,           // 守卫巡逻 格/秒
    guardInvestigate: 2.1,      // 守卫警戒查点 格/秒
    guardHunt: 3.4,             // 守卫猎捕（警报后奔钥匙格） 格/秒
    guardChase: 4.6,            // 守卫追捕 格/秒（> 行走 2.8，< 冲刺 5.4）
    guardReturn: 1.8,           // 守卫回岗 格/秒

    fovDist: 5,                 // 固定视距（格）
    fovHalfAngle: 0.9,          // 视锥半角（弧度）≈51.6°

    noticeTime: 0.45,           // 持续看见多久才进入 chase（秒）
    noticeDecay: 3.0,           // 丢失视线 notice 衰减速率 /秒

    alarmLead: 0.8,             // 取钥匙后警报预热/守卫延迟（秒）

    hearRadius: 4,              // 普通守卫听觉 BFS 半径（格）
    houndHearRadius: 6,         // 猎犬听觉 BFS 半径（格）
    switchHearRadius: 7,        // 开关巨响 普通守卫半径（格）
    switchHoundHearRadius: 9,   // 开关巨响 猎犬半径（格）

    investigateLook: 1.5,       // 警戒到达后原地张望时长（秒）
    searchTime: 3.0,            // 追捕丢视野后搜索时长（秒）
    huntSearchTime: 2.0,        // 猎捕到达钥匙格后搜索时长（秒）

    catchDist: 0.48             // 抓捕欧氏距离（插值 pr/pc，格）
  };

  /* ================= 关卡数据 =================
   * 图例：# 墙  . 路  P 玩家  E 出口  K 钥匙
   *       G 守卫  g 猎犬(听觉更远)  S 开关  D 卷帘门(关闭时 solid)
   * facing: 守卫出生朝向 n/s/e/w
   * patrols: 显式巡逻路径点数组（按 guards 索引一一对应）
   */
  var LEVELS = [
    { // 1 教学：移动 + 视野 + 钥匙
      name: '巷口 · ALLEY GATE',
      hint: '出口就在身后——等守卫转身，潜入深处拿钥匙再冲回来',
      map: [
        '###############',
        '#...........K.#',
        '#......G......#',
        '#.............#',
        '#PE...........#',
        '###############'
      ],
      facing: ['e'],
      patrols: [[{ r: 2, c: 7 }, { r: 2, c: 11 }]]
    },
    { // 2 听觉：行走无声、冲刺有声
      name: '中巷 · BACK LANE',
      hint: '潜入时慢走无声；拿到钥匙后冲刺撤离，再用转角断掉声音线索',
      map: [
        '##############',
        '#............#',
        '#..........K.#',
        '#.G..........#',
        '#............#',
        '#............#',
        '#............#',
        '#PE..........#',
        '##############'
      ],
      facing: ['e'],
      patrols: [[{ r: 3, c: 2 }, { r: 3, c: 10 }]]
    },
    { // 3 视野交叉：视锥盲区
      name: '十字 · CROSSINGS',
      hint: '穿过交叉视锥取钥匙；警报后从另一条巷道撤回出口',
      map: [
        '###############',
        '#...........K.#',
        '#..G..........#',
        '#....#....#...#',
        '#......G......#',
        '#....#....#...#',
        '#.............#',
        '#.............#',
        '#PE...........#',
        '###############'
      ],
      facing: ['e', 'w'],
      patrols: [
        [{ r: 2, c: 3 }, { r: 2, c: 11 }],
        [{ r: 4, c: 7 }, { r: 4, c: 3 }]
      ]
    },
    { // 4 卷帘门：开关开捷径
      name: '卷帘 · ROLLER DOOR',
      hint: '卷帘门是危险捷径——按 E 开门会引来守卫，也可绕远路',
      map: [
        '###############',
        '#.............#',
        '#......#......#',
        '#.K.G..#......#',
        '#......#......#',
        '#..S...D......#',
        '#......#......#',
        '#......#......#',
        '#P.....#....E.#',
        '###############'
      ],
      facing: ['e'],
      patrols: [[{ r: 3, c: 4 }, { r: 3, c: 6 }]]
    },
    { // 5 猎犬：听觉更远
      name: '猎犬 · HOUND',
      hint: '猎犬听觉更远——别在它附近冲刺',
      map: [
        '##############',
        '#....K.......#',
        '#....#.......#',
        '#....#..g....#',
        '#....#.......#',
        '#....#.......#',
        '#....#.......#',
        '#P..........E#',
        '##############'
      ],
      facing: ['e'],
      patrols: [[{ r: 3, c: 8 }, { r: 3, c: 11 }]]
    },
    { // 6 金库：综合（卷帘门 + 猎犬 + 守卫）
      name: '金库 · VAULT',
      hint: '取钥匙即拉响警报——冒险开捷径，或绕路甩开追兵',
      map: [
        '###############',
        '#.............#',
        '#......#......#',
        '#..G...#..g...#',
        '#......#......#',
        '#..K...D....E.#',
        '#..S...#......#',
        '#......#..G...#',
        '#P............#',
        '###############'
      ],
      facing: ['e', 'w', 'e'],
      patrols: [
        [{ r: 3, c: 3 }, { r: 3, c: 6 }],
        [{ r: 3, c: 10 }, { r: 3, c: 12 }],
        [{ r: 7, c: 10 }, { r: 7, c: 12 }]
      ]
    }
  ];

  /* ================= 方向常量 ================= */
  var DIRS = {
    n: { dr: -1, dc: 0, d: -Math.PI / 2 },
    s: { dr: 1, dc: 0, d: Math.PI / 2 },
    w: { dr: 0, dc: -1, d: Math.PI },
    e: { dr: 0, dc: 1, d: 0 }
  };
  var DIR_LIST = [
    { dr: -1, dc: 0 }, { dr: 1, dc: 0 }, { dr: 0, dc: -1 }, { dr: 0, dc: 1 }
  ];

  /* ================= 工具 ================= */
  function inB(s, r, c) { return r >= 0 && c >= 0 && r < s.h && c < s.w; }
  function isSolid(s, r, c) { return !inB(s, r, c) || !!s.solid[r + ',' + c]; }
  function dist2(a, b) { var dr = a.r - b.r, dc = a.c - b.c; return dr * dr + dc * dc; }
  function manh(a, b) { return Math.abs(a.r - b.r) + Math.abs(a.c - b.c); }
  function normAngle(a) {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
  }

  /* 布雷森汉姆格子射线（墙与关闭的卷帘门遮挡） */
  function lineOfSight(s, r0, c0, r1, c1) {
    var dr = Math.abs(r1 - r0), dc = Math.abs(c1 - c0);
    var sr = r0 < r1 ? 1 : -1, sc = c0 < c1 ? 1 : -1;
    var err = dr - dc, r = r0, c = c0, guard = 0;
    while (guard++ < 400) {
      if (r === r1 && c === c1) break;
      var e2 = 2 * err;
      if (e2 > -dc) { err -= dc; r += sr; }
      if (e2 < dr) { err += dr; c += sc; }
      if (r === r1 && c === c1) break;
      if (isSolid(s, r, c)) return false;
    }
    return true;
  }

  /* 固定视距：猎犬不加视距（身份改成听觉更强） */
  function fovDist(s, g, atR, atC) {
    return cfg.fovDist;
  }
  /* 朝向视锥可见性（不依赖亮暗） */
  function canSee(s, g, pr, pc) {
    if (g.r === pr && g.c === pc) return true;
    if (dist2(g, { r: pr, c: pc }) > cfg.fovDist * cfg.fovDist) return false;
    var ang = Math.atan2(pr - g.r, pc - g.c);
    if (Math.abs(normAngle(ang - g.dir)) > cfg.fovHalfAngle) return false;
    return lineOfSight(s, g.r, g.c, pr, pc);
  }

  /* BFS 首步方向（同 bfsPath 但只返回第一步的 dr/dc） */
  function bfsFirstStep(s, from, to, maxLen) {
    var path = bfsPath(s, from, to, maxLen);
    if (!path || !path.length) return null;
    return { dr: path[0].r - from.r, dc: path[0].c - from.c };
  }

  /* 完整 BFS 路径（供测试与回岗用） */
  function bfsPath(s, from, to, maxLen) {
    if (from.r === to.r && from.c === to.c) return [];
    maxLen = maxLen || 300;
    var prev = {}, seen = {};
    var q = [{ r: from.r, c: from.c }];
    seen[from.r + ',' + from.c] = 1;
    var head = 0;
    while (head < q.length && q.length < maxLen) {
      var cur = q[head++];
      for (var i = 0; i < 4; i++) {
        var nr = cur.r + DIR_LIST[i].dr, nc = cur.c + DIR_LIST[i].dc;
        if (isSolid(s, nr, nc)) continue;
        var k = nr + ',' + nc;
        if (seen[k]) continue;
        seen[k] = 1;
        prev[k] = { r: cur.r, c: cur.c };
        if (nr === to.r && nc === to.c) {
          var path = [], node = { r: to.r, c: to.c };
          while (prev[node.r + ',' + node.c]) {
            path.unshift(node);
            node = prev[node.r + ',' + node.c];
          }
          return path;
        }
        q.push({ r: nr, c: nc });
      }
    }
    return null;
  }

  /* BFS 距离（步数）；不可达返回 null。听觉用此距离，墙不可穿透。 */
  function pathDistance(s, a, b) {
    var path = bfsPath(s, a, b);
    return path ? path.length : null;
  }

  /* ================= 共用运动学：格间补间 ================= */
  function moveActor(a, speed, dt) {
    if (!a.mdir) return;
    a.t += speed * dt;
    a.pr = a.r + a.mdir.dr * Math.min(1, a.t);
    a.pc = a.c + a.mdir.dc * Math.min(1, a.t);
    if (a.t >= 1) {
      a.r += a.mdir.dr; a.c += a.mdir.dc;
      a.pr = a.r; a.pc = a.c;
      a.mdir = null; a.t = 0; a.moving = false;
    } else {
      a.moving = true;
    }
  }
  function beginMove(a, dr, dc, dirFace) {
    a.mdir = { dr: dr, dc: dc };
    a.t = 0; a.moving = true;
    a.dir = (dirFace !== undefined) ? dirFace : Math.atan2(dr, dc);
  }

  /* ================= 构建关卡状态 ================= */
  function newGame(lvi) {
    var lv = LEVELS[lvi] || LEVELS[0];
    var grid = lv.map.map(function (r) { return r.split(''); });
    var s = {
      idx: (lv === LEVELS[lvi]) ? lvi : 0,
      name: lv.name, hint: lv.hint,
      h: grid.length, w: grid[0].length,
      grid: grid, solid: {},
      exit: { r: 0, c: 0 },
      key: { r: 0, c: 0, got: false },
      switch: null, gates: [],
      phase: 'infiltrate', alarmT: 0,
      player: {
        r: 0, c: 0, pr: 0, pc: 0, mdir: null, t: 0, moving: false,
        dir: 0, lastDir: null,
        keys: 0, running: false, sprinting: false, sneaking: false,
        stepSprinted: false,
        detections: 0, preKeyDetections: 0,
        seen: false, caught: false
      },
      guards: [],
      time: 0,
      spots: 0,             // 兼容旧结算：镜像 detections
      done: false, result: null,
      _sprintPulse: null, _loudPulse: null
    };
    var patrols = lv.patrols || [];
    var gi = 0;
    for (var r = 0; r < s.h; r++) {
      for (var c = 0; c < s.w; c++) {
        var ch = grid[r][c];
        if (ch === '#') s.solid[r + ',' + c] = true;
        else if (ch === 'E') s.exit = { r: r, c: c };
        else if (ch === 'K') s.key = { r: r, c: c, got: false };
        else if (ch === 'S') s.switch = { r: r, c: c, used: false };
        else if (ch === 'D') { s.solid[r + ',' + c] = true; s.gates.push({ r: r, c: c }); }
        else if (ch === 'P') {
          s.player.r = r; s.player.c = c; s.player.pr = r; s.player.pc = c;
        } else if (ch === 'G' || ch === 'g') {
          var hound = ch === 'g';
          var facing = (lv.facing && lv.facing[gi]) || autoFacing(grid, r, c, s, s.player);
          var pat = patrols[gi] ? patrols[gi].slice() : [];
          var fStart = { r: r + DIRS[facing].dr, c: c + DIRS[facing].dc };
          if (pat.length === 0 && !isSolid(s, fStart.r, fStart.c)) pat = [fStart];
          var patStartIdx = 0;
          for (var pi2 = 0; pi2 < pat.length; pi2++) {
            if (pat[pi2].r === r && pat[pi2].c === c) { patStartIdx = pi2; break; }
          }
          s.guards.push({
            id: gi,
            r: r, c: c, pr: r, pc: c, mdir: null, t: 0, moving: false,
            dir: DIRS[facing].d,
            facingKey: facing,
            hound: hound,
            state: 'patrol',       // patrol / investigate / hunt / chase / search / return
            pat: pat,
            patIdx: 0, patDir: 1,
            patStart: patStartIdx,
            spawnTarget: (patStartIdx > 0 || isSolid(s, fStart.r, fStart.c)) ? null : fStart,
            notice: 0,
            lastSeen: null, lastHeard: null,
            huntTarget: null, returnTarget: null,
            tgt: null, investigateT: 0,
            searchT: 0, searchTargets: [], searchIdx: 0,
            los: false
          });
          gi++;
        }
      }
    }
    s.player.dir = Math.atan2(s.exit.r - s.player.r, s.exit.c - s.player.c);
    return s;
  }

  /* 自动朝向：朝向离出生点最远的方向 */
  function autoFacing(grid, gr, gc, s, player) {
    var best = 'n', bestD = -1;
    var keys = ['n', 's', 'w', 'e'];
    for (var i = 0; i < 4; i++) {
      var k = keys[i], d = DIRS[k];
      var nr = gr + d.dr, nc = gc + d.dc;
      if (isSolid(s, nr, nc)) continue;
      var dist = (nr - player.r) * (nr - player.r) + (nc - player.c) * (nc - player.c);
      if (dist > bestD) { bestD = dist; best = k; }
    }
    return best;
  }

  /* ================= 出生安全校验（关卡设计契约） ================= */
  function spawnSafe(s) {
    for (var i = 0; i < s.guards.length; i++) {
      if (canSee(s, s.guards[i], s.player.r, s.player.c)) return false;
    }
    for (i = 0; i < s.guards.length; i++) {
      if (manh(s.guards[i], s.player) <= 2) return false;
    }
    return true;
  }

  /* ================= 玩家移动 ================= */
  function playerMove(s, act, dt) {
    var p = s.player;
    var sprint = !!act.sprint;
    p.running = sprint;
    p.sprinting = sprint;
    p.sneaking = !sprint;
    var speed = sprint ? cfg.playerSprint : cfg.playerWalk;

    if (p.moving) {
      if (sprint) p.stepSprinted = true;
      moveActor(p, speed, dt);
      // 完成一格冲刺 → 离散声脉冲（每格一次）
      if (!p.moving && p.stepSprinted) s._sprintPulse = { r: p.r, c: p.c };
      if (!p.moving) p.stepSprinted = false;
      var wish = wishDir(act, p);
      if (!p.moving && wish) tryBeginMove(s, p, wish, speed, act);
      return;
    }
    var w = wishDir(act, p);
    if (w) tryBeginMove(s, p, w, speed, act);
  }
  /* 方向处理：优先外部 lastDir（对应键仍按住），其次内部上次方向，
   * 最后固定优先级回退——多键时不再固定上下左右优先。 */
  function wishDir(act, p) {
    var ld = act.lastDir;
    if (ld === 'u' || ld === 'n' || ld === 'up') { if (act.up) return { dr: -1, dc: 0 }; }
    else if (ld === 'd' || ld === 's' || ld === 'down') { if (act.down) return { dr: 1, dc: 0 }; }
    else if (ld === 'l' || ld === 'w' || ld === 'left') { if (act.left) return { dr: 0, dc: -1 }; }
    else if (ld === 'r' || ld === 'e' || ld === 'right') { if (act.right) return { dr: 0, dc: 1 }; }
    if (p && p.lastDir) {
      if (p.lastDir === 'u' && act.up) return { dr: -1, dc: 0 };
      if (p.lastDir === 'd' && act.down) return { dr: 1, dc: 0 };
      if (p.lastDir === 'l' && act.left) return { dr: 0, dc: -1 };
      if (p.lastDir === 'r' && act.right) return { dr: 0, dc: 1 };
    }
    if (act.up) return { dr: -1, dc: 0 };
    if (act.down) return { dr: 1, dc: 0 };
    if (act.left) return { dr: 0, dc: -1 };
    if (act.right) return { dr: 0, dc: 1 };
    return null;
  }
  function tryBeginMove(s, a, w, speed, act) {
    var nr = a.r + w.dr, nc = a.c + w.dc;
    if (isSolid(s, nr, nc)) { a.running = false; return; }
    beginMove(a, w.dr, w.dc);
    moveActor(a, speed, 0);
    a.running = !!(act && act.sprint);
    a.stepSprinted = !!(act && act.sprint);
    a.lastDir = w.dr < 0 ? 'u' : w.dr > 0 ? 'd' : w.dc < 0 ? 'l' : 'r';
  }

  /* ================= 守卫 AI ================= */
  function guardThink(s, g, p, dt, ev) {
    var prevState = g.state;
    var losPrev = g.los;

    /* —— 视野：固定视距 + 视锥 + 遮挡；notice 累积 —— */
    var seen = !p.caught && canSee(s, g, p.r, p.c);
    if (seen) {
      g.los = true;
      g.lastSeen = { r: p.r, c: p.c };
      var wasNoticing = g.notice > 0;
      g.notice = Math.min(cfg.noticeTime, g.notice + dt);
      if (!wasNoticing) ev.push({ type: 'noticed', g: g.id });
      if (g.state !== 'chase' && g.notice >= cfg.noticeTime) {
        g.state = 'chase';
        g.searchT = 0;
        g.tgt = null;
        g.huntTarget = null;
        g.searchTargets = [];
        g.searchIdx = 0;
        p.detections++;
        if (s.phase === 'infiltrate') p.preKeyDetections++;
        s.spots++;
        ev.push({ type: 'spotted', g: g.id });
      }
    } else {
      g.los = false;
      if (g.notice > 0) {
        g.notice = Math.max(0, g.notice - cfg.noticeDecay * dt);
        // 短暂瞥见后丢失视线 → 调查最后瞥见位置（不追）
        if (g.notice === 0 && g.state === 'patrol' && g.lastSeen) {
          g.state = 'investigate';
          g.tgt = { r: g.lastSeen.r, c: g.lastSeen.c };
          g.investigateT = cfg.investigateLook;
          g.searchT = 0;
        }
      }
    }

    /* —— 听觉：离散声脉冲（冲刺完成一格 / 开关巨响） —— */
    if (s._sprintPulse) {
      var hr = g.hound ? cfg.houndHearRadius : cfg.hearRadius;
      var pd = pathDistance(s, { r: g.r, c: g.c }, s._sprintPulse);
      if (pd !== null && pd <= hr) {
        ev.push({ type: 'heard', g: g.id });
        if (g.state === 'chase') {
          g.lastHeard = { r: s._sprintPulse.r, c: s._sprintPulse.c };
        } else if (g.state === 'hunt') {
          // 警报不提供实时位置；玩家主动冲刺才会把猎捕目标推进到声源格。
          if (s.alarmT <= 0) g.huntTarget = { r: s._sprintPulse.r, c: s._sprintPulse.c };
        } else {
          g.state = 'investigate';
          g.tgt = { r: s._sprintPulse.r, c: s._sprintPulse.c };
          g.investigateT = cfg.investigateLook;
          g.searchT = 0;
        }
      }
    }
    if (s._loudPulse) {
      var lr = g.hound ? cfg.switchHoundHearRadius : cfg.switchHearRadius;
      var ld = pathDistance(s, { r: g.r, c: g.c }, s._loudPulse);
      if (ld !== null && ld <= lr) {
        ev.push({ type: 'heard', g: g.id, loud: true });
        if (g.state === 'chase') {
          g.lastHeard = { r: s._loudPulse.r, c: s._loudPulse.c };
        } else if (g.state === 'hunt') {
          if (s.alarmT <= 0) g.huntTarget = { r: s._loudPulse.r, c: s._loudPulse.c };
        } else {
          g.state = 'investigate';
          g.tgt = { r: s._loudPulse.r, c: s._loudPulse.c };
          g.investigateT = cfg.investigateLook;
          g.searchT = 0;
        }
      }
    }

    /* —— 状态机 —— */
    switch (g.state) {
      case 'patrol': patrolThink(s, g, dt); break;
      case 'investigate': investigateThink(s, g, dt); break;
      case 'hunt': huntThink(s, g, dt); break;
      case 'chase': chaseThink(s, g, p, dt); break;
      case 'search': searchThink(s, g, dt); break;
      case 'return': returnThink(s, g, dt); break;
    }

    /* —— 事件：lost / calm —— */
    if (g.state === 'chase' && losPrev && !g.los) {
      ev.push({ type: 'lost', g: g.id });
    }
    if (g.state !== prevState) {
      if ((prevState === 'search' || prevState === 'return') &&
          (g.state === 'patrol' || g.state === 'hunt')) {
        ev.push({ type: 'calm', g: g.id });
      }
    }
  }

  function stateSpeed(s, g) {
    switch (g.state) {
      case 'patrol': return (s.phase === 'escape') ? cfg.guardHunt : cfg.guardPatrol;
      case 'investigate': return cfg.guardInvestigate;
      case 'hunt': return cfg.guardHunt;
      case 'chase': return cfg.guardChase;
      case 'search': return cfg.guardInvestigate;
      case 'return': return cfg.guardReturn;
    }
    return cfg.guardPatrol;
  }

  function patrolThink(s, g, dt) {
    if (g.spawnTarget) {
      var st = g.spawnTarget;
      var stepSt = bfsFirstStep(s, { r: g.r, c: g.c }, st);
      if (stepSt) moveToward(s, g, { r: g.r + stepSt.dr, c: g.c + stepSt.dc }, cfg.guardPatrol * 0.7, dt);
      if (g.r === st.r && g.c === st.c) g.spawnTarget = null;
      return;
    }
    var path = g.pat;
    if (!path.length) { g.state = 'return'; g.returnTarget = { r: g.r, c: g.c }; return; }
    if (g.patStart > 0) { g.patIdx = g.patStart; g.patStart = 0; }
    var target = path[g.patIdx];
    if (target && g.r === target.r && g.c === target.c) {
      g.patIdx += g.patDir;
      if (g.patIdx >= path.length - 1 || g.patIdx <= 0) g.patDir *= -1;
      target = path[g.patIdx];
    }
    if (target) {
      var step = bfsFirstStep(s, { r: g.r, c: g.c }, target);
      if (step) moveToward(s, g, { r: g.r + step.dr, c: g.c + step.dc }, stateSpeed(s, g), dt);
    }
  }

  function investigateThink(s, g, dt) {
    var reached = g.tgt && g.r === g.tgt.r && g.c === g.tgt.c;
    if (!reached && g.tgt) {
      var step = bfsFirstStep(s, { r: g.r, c: g.c }, g.tgt);
      if (step) moveToward(s, g, { r: g.r + step.dr, c: g.c + step.dc }, cfg.guardInvestigate, dt);
      else g.investigateT -= dt; // 目标不可达：原地等待后放弃
    } else {
      g.investigateT -= dt; // 到达后原地张望
    }
    if (g.investigateT <= 0) {
      g.state = 'return';
      g.returnTarget = nearestPatrolPoint(s, g);
    }
  }

  function huntThink(s, g, dt) {
    if (s.alarmT > 0) return; // 警报预热：守卫延迟
    var ht = g.huntTarget;
    if (ht) {
      if (g.r === ht.r && g.c === ht.c) {
        g.searchT += dt;
        if (g.searchT > cfg.huntSearchTime) {
          g.state = 'return';
          g.returnTarget = nearestPatrolPoint(s, g);
        }
      } else {
        var step = bfsFirstStep(s, { r: g.r, c: g.c }, ht);
        if (step) moveToward(s, g, { r: g.r + step.dr, c: g.c + step.dc }, cfg.guardHunt, dt);
        else {
          g.searchT += dt;
          if (g.searchT > cfg.huntSearchTime) {
            g.state = 'return';
            g.returnTarget = nearestPatrolPoint(s, g);
          }
        }
      }
    } else {
      g.state = 'return';
      g.returnTarget = nearestPatrolPoint(s, g);
    }
  }

  function chaseThink(s, g, p, dt) {
    if (g.los) {
      g.searchT = 0;
      var step = bfsFirstStep(s, { r: g.r, c: g.c }, { r: p.r, c: p.c });
      if (step) moveToward(s, g, { r: g.r + step.dr, c: g.c + step.dc }, cfg.guardChase, dt);
      return;
    }
    // 丢 LOS：先查声源（lastHeard），再查最后看见位置（lastSeen）
    var anchor = g.lastHeard || g.lastSeen;
    if (anchor) {
      if (g.r === anchor.r && g.c === anchor.c) {
        if (g.lastHeard) {
          g.lastHeard = null; // 声源已查，回退到 lastSeen
        } else {
          enterSearch(s, g);
        }
      } else {
        var step2 = bfsFirstStep(s, { r: g.r, c: g.c }, anchor);
        if (step2) moveToward(s, g, { r: g.r + step2.dr, c: g.c + step2.dc }, cfg.guardChase, dt);
        else enterSearch(s, g);
      }
    } else {
      enterSearch(s, g);
    }
  }

  function enterSearch(s, g) {
    g.state = 'search';
    g.searchT = 0;
    g.searchTargets = buildSearchTargets(s, g);
    g.searchIdx = 0;
  }

  function buildSearchTargets(s, g) {
    var base = g.lastSeen || { r: g.r, c: g.c };
    var out = [];
    for (var i = 0; i < 4; i++) {
      var nr = base.r + DIR_LIST[i].dr, nc = base.c + DIR_LIST[i].dc;
      if (!isSolid(s, nr, nc)) out.push({ r: nr, c: nc });
    }
    return out;
  }

  function searchThink(s, g, dt) {
    g.searchT += dt;
    var targets = g.searchTargets;
    if (targets && targets.length) {
      var t = targets[g.searchIdx];
      if (t) {
        if (g.r === t.r && g.c === t.c) {
          g.searchIdx++;
        } else {
          var step = bfsFirstStep(s, { r: g.r, c: g.c }, t);
          if (step) moveToward(s, g, { r: g.r + step.dr, c: g.c + step.dc }, cfg.guardInvestigate, dt);
          else g.searchIdx++;
        }
      } else {
        g.searchIdx++;
      }
    }
    if (g.searchT > cfg.searchTime) {
      g.state = 'return';
      g.returnTarget = nearestPatrolPoint(s, g);
    }
  }

  function returnThink(s, g, dt) {
    var rt = g.returnTarget;
    if (rt) {
      if (g.r === rt.r && g.c === rt.c) {
        backToPatrol(s, g);
      } else {
        var step = bfsFirstStep(s, { r: g.r, c: g.c }, rt);
        if (step) moveToward(s, g, { r: g.r + step.dr, c: g.c + step.dc }, cfg.guardReturn, dt);
        else backToPatrol(s, g);
      }
    } else {
      backToPatrol(s, g);
    }
  }

  function backToPatrol(s, g) {
    g.state = 'patrol';
    g.patIdx = nearestPatIdx(s, g);
    g.patDir = 1;
    g.lastHeard = null;
  }

  function nearestPatrolPoint(s, g) {
    var pat = g.pat;
    if (!pat || !pat.length) return { r: g.r, c: g.c };
    var best = pat[0], bestD = 1e9;
    for (var i = 0; i < pat.length; i++) {
      var d = pathDistance(s, { r: g.r, c: g.c }, pat[i]);
      if (d !== null && d < bestD) { bestD = d; best = pat[i]; }
    }
    return best;
  }

  function nearestPatIdx(s, g) {
    var pat = g.pat;
    if (!pat || !pat.length) return 0;
    var best = 0, bestD = 1e9;
    for (var i = 0; i < pat.length; i++) {
      var d = pathDistance(s, { r: g.r, c: g.c }, pat[i]);
      if (d !== null && d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  /* 朝目标格移动（共用运动学；目标为相邻格） */
  function moveToward(s, a, target, speed, dt) {
    var dr = target.r - a.r, dc = target.c - a.c;
    if (dr === 0 && dc === 0) { a.moving = false; return; }
    if (a.moving) { moveActor(a, speed, dt); return; }
    if (Math.abs(dr) + Math.abs(dc) !== 1) return;
    if (isSolid(s, target.r, target.c)) return;
    beginMove(a, dr, dc);
    moveActor(a, speed, dt);
  }

  /* 抓捕：仅 chase 状态，插值欧氏距离 + LOS（无隔墙、无曼哈顿2格） */
  function catchCheck(s, g, p) {
    var dr = g.pr - p.pr, dc = g.pc - p.pc;
    if (dr * dr + dc * dc > cfg.catchDist * cfg.catchDist) return false;
    return lineOfSight(s, g.r, g.c, p.r, p.c);
  }

  /* ================= 主更新 ================= */
  function update(s, act, dt) {
    var ev = [];
    if (s.done) return ev;
    act = act || {};
    s.time += dt;
    var p = s.player;
    s._sprintPulse = null;
    s._loudPulse = null;

    /* —— 玩家移动 —— */
    if (!p.caught) playerMove(s, act, dt);

    /* —— 钥匙拾取（自动）→ 强制撤离警报 —— */
    if (!s.key.got && p.r === s.key.r && p.c === s.key.c) {
      s.key.got = true;
      p.keys = 1;
      s.phase = 'escape';
      s.alarmT = cfg.alarmLead;
      ev.push({ type: 'key' });
      ev.push({ type: 'alarm' });
      for (var ki = 0; ki < s.guards.length; ki++) {
        var kg = s.guards[ki];
        if (kg.state !== 'chase') {
          kg.state = 'hunt';
          kg.huntTarget = { r: s.key.r, c: s.key.c };
          kg.tgt = null;
          kg.notice = 0;
          kg.searchT = 0;
          kg.searchTargets = [];
          kg.searchIdx = 0;
        }
      }
    }

    /* —— 出口：取钥匙前锁，取钥匙后胜 —— */
    if (p.r === s.exit.r && p.c === s.exit.c && !p.caught) {
      if (p.keys >= 1) {
        s.done = true; s.result = 'win';
        ev.push({ type: 'goal', time: s.time, detections: p.detections });
        return ev;
      }
      ev.push({ type: 'lockedExit' });
    }

    /* —— 开关：S 上按 interact 打开全部卷帘门 + 巨响 —— */
    if (act.interact && s.switch && !s.switch.used && p.r === s.switch.r && p.c === s.switch.c) {
      s.switch.used = true;
      for (var di = 0; di < s.gates.length; di++) {
        delete s.solid[s.gates[di].r + ',' + s.gates[di].c];
      }
      ev.push({ type: 'switch' });
      ev.push({ type: 'gateOpen' });
      s._loudPulse = { r: s.switch.r, c: s.switch.c };
    }

    /* —— 警报预热倒计时 —— */
    if (s.alarmT > 0) s.alarmT = Math.max(0, s.alarmT - dt);

    /* —— 守卫 —— */
    for (var gi = 0; gi < s.guards.length; gi++) {
      var g = s.guards[gi];
      guardThink(s, g, p, dt, ev);
      if (!p.caught && g.state === 'chase' && catchCheck(s, g, p)) {
        p.caught = true;
        s.done = true; s.result = 'caught';
        ev.push({ type: 'caught', g: g.id });
        return ev;
      }
    }

    /* —— 玩家是否正被看见（供 UI） —— */
    p.seen = false;
    for (var si = 0; si < s.guards.length; si++) {
      if (canSee(s, s.guards[si], p.r, p.c)) { p.seen = true; break; }
    }

    return ev;
  }

  /* ================= API ================= */
  var API = {
    cfg: cfg, LEVELS: LEVELS,
    newGame: newGame, update: update,
    isSolid: isSolid, canSee: canSee,
    lineOfSight: lineOfSight, bfsPath: bfsPath,
    fovDist: fovDist, spawnSafe: spawnSafe,
    pathDistance: pathDistance
  };
  global.AlleyEngine = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
