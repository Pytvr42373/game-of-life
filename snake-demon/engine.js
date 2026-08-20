/* =====================================================================
 * engine.js —— 《恶魔追逐·队友模式》蛇梯棋变体 纯规则引擎（无 DOM 依赖）
 * 浏览器 + Node 双环境可用。核心规则：
 *   · 48 格 4×12 蛇形棋盘；命运格 5/10/15/25/35/44
 *   · 全员双骰：前进 = |骰1 - 骰2|；恶魔同骰(差0) → 前进 2 格（晚 2 回合出发）
 *   · 到达 48 必须恰好，超出则原地不动
 *   · 命运格 6 种效果 + 连锁触发 + 护盾免疫负面
 *   · 恶魔每轮移动后立即检查抓捕（位置 >= 即追上）
 *   · 人类任一成员到达 48 即胜；恶魔抓捕全部成员则胜
 * 事件流驱动：stepActor/stepRound 返回事件数组，UI 据此逐帧播放动画。
 * 支持 createEngine(cfg) 工厂（可注入自定义棋盘/命运格，供测试验证连锁）。
 * ===================================================================== */
(function (global) {
  'use strict';

  function createEngine(cfg) {
    var size = (cfg && cfg.boardSize) || 48;
    var fates = (cfg && cfg.fateMap) || { 5: 1, 10: 1, 15: 1, 25: 1, 35: 1, 44: 1 };
    var fateList = Object.keys(fates).map(Number).sort(function (a, b) { return a - b; });

    function isFate(p) { return !!fates[p]; }

    /* 位置 → 蛇形行列（0 起）。row0=最远/最高，row3=最近/最低 */
    function rowCol(pos) {
      var idx = pos - 1;
      var row = Math.floor(idx / 12);
      var c = idx % 12;
      return { row: row, col: (row % 2 === 0) ? c : 11 - c };
    }
    /* 蛇形行列 → 位置（1 起），供 UI 复用 */
    function colRowToPos(row, col) {
      var c = (row % 2 === 0) ? col : 11 - col;
      return row * 12 + c + 1;
    }
    /* 单步移动：到达终点必须恰好，超出则原地不动（不回退） */
    function moveOnce(from, roll) {
      var t = from + roll;
      return t > size ? from : t;
    }

    function newGame() {
      return {
        round: 1,
        player: { pos: 1, alive: true, shield: 0, paused: false },
        mate: { pos: 1, alive: true, shield: 0, paused: false },
        demon: { pos: 1, alive: true, shield: 0, paused: false },
        winner: null,
        winReason: null
      };
    }

    function d6(rng) { return 1 + Math.floor((rng || Math.random)() * 6); }

    /* 双骰前进规则：前进 = |骰1 - 骰2|；恶魔同骰(差0) → 前进 2 格 */
    function diceMove(d1, d2, actor) {
      var diff = Math.abs(d1 - d2);
      if (diff === 0 && actor === 'demon') return 2;
      return diff;
    }

    function cloneState(s) {
      return {
        round: s.round,
        player: { pos: s.player.pos, alive: s.player.alive, shield: s.player.shield, paused: s.player.paused },
        mate: { pos: s.mate.pos, alive: s.mate.alive, shield: s.mate.shield, paused: s.mate.paused },
        demon: { pos: s.demon.pos, alive: s.demon.alive, shield: s.demon.shield, paused: s.demon.paused },
        winner: s.winner,
        winReason: s.winReason
      };
    }

    /* —— 命运格连锁解析（就地修改 state，事件追加到 ev）——
     * 触发规则：
     *   1) 落在命运格 → 掷命运骰 1d6 应用效果
     *   2) 效果5「再掷一次」：留本格立即重掷命运骰，直到掷出非5
     *   3) 效果1/3/4 若发生移动且落到另一 ❓ → 继续连锁，直到落普通格
     *   4) 护盾可主动消耗 1 枚完全免疫「后退/暂停」等负面
     */
    function resolveFate(state, actor, ev, rng) {
      var a = state[actor];
      var guard = 0;
      while (guard++ < 80) {
        if (!isFate(a.pos)) break;
        var fr = d6(rng);
        ev.push({ type: 'fate', actor: actor, cell: a.pos, roll: fr });
        var moved = false;
        if (fr === 5) {
          ev.push({ type: 'reroll', actor: actor, cell: a.pos });
          continue; // 再掷一次
        } else if (fr === 1) {
          if (a.shield > 0) {
            a.shield -= 1;
            ev.push({ type: 'shieldBlock', actor: actor, blocked: 'back2', cell: a.pos });
          } else {
            var to1 = Math.max(1, a.pos - 2);
            if (to1 !== a.pos) { ev.push({ type: 'move', actor: actor, from: a.pos, to: to1, cause: 'fate-back' }); a.pos = to1; moved = true; }
          }
        } else if (fr === 2) {
          if (a.shield > 0) {
            a.shield -= 1;
            ev.push({ type: 'shieldBlock', actor: actor, blocked: 'pause', cell: a.pos });
          } else {
            a.paused = true;
            ev.push({ type: 'pause', actor: actor, cell: a.pos });
          }
        } else if (fr === 3) {
          if (a.shield > 0) {
            a.shield -= 1;
            ev.push({ type: 'loseShield', actor: actor, cell: a.pos });
          } else {
            var to3 = Math.max(1, a.pos - 1);
            if (to3 !== a.pos) { ev.push({ type: 'move', actor: actor, from: a.pos, to: to3, cause: 'fate-noshield' }); a.pos = to3; moved = true; }
          }
        } else if (fr === 4) {
          var partnerId = (actor === 'player') ? 'mate' : (actor === 'mate' ? 'player' : null);
          var self = a.pos + 1;
          if (self <= size && self !== a.pos) {
            ev.push({ type: 'move', actor: actor, from: a.pos, to: self, cause: 'fate-bond' });
            a.pos = self; moved = true;
          }
          if (actor !== 'demon' && partnerId) {
            var partner = state[partnerId];
            if (partner.alive) {
              var pt = Math.min(size, partner.pos + 1);
              if (pt !== partner.pos) {
                ev.push({ type: 'move', actor: partnerId, from: partner.pos, to: pt, cause: 'bond' });
                partner.pos = pt;
              }
              if (pt === size) { state.winner = 'human'; state.winReason = '队友羁绊到达终点'; ev.push({ type: 'win', actor: partnerId, via: 'bond' }); }
            }
          }
          if (self === size && actor !== 'demon') { state.winner = 'human'; state.winReason = actor + '命运效果到达终点'; ev.push({ type: 'win', actor: actor, via: 'fate' }); }
        } else if (fr === 6) {
          a.shield += 1;
          ev.push({ type: 'gainShield', actor: actor, cell: a.pos });
        }
        if (state.winner) break;
        if (moved && isFate(a.pos)) continue; // 前进/后退落到另一命运格 → 连锁
        break;
      }
    }

    /* —— 恶魔抓捕判定：恶魔每轮移动后立即检查，位置 >= 即追上 —— */
    function captureCheck(state, ev) {
      var d = state.demon;
      if (!d.alive) return;
      ['player', 'mate'].forEach(function (vid) {
        var v = state[vid];
        if (v.alive && d.pos >= v.pos) {
          v.alive = false;
          ev.push({ type: 'capture', victim: vid, at: d.pos });
        }
      });
      if (!state.player.alive && !state.mate.alive) {
        state.winner = 'demon';
        state.winReason = '人类两名成员均被恶魔抓捕';
        ev.push({ type: 'lose', reason: 'captured' });
      }
    }

    /* —— 单个角色执行一次行动（返回事件数组）——
     * roll：本次掷骰点数（玩家来自点击；队友/恶魔由调用方提供）
     * 被暂停/已死亡/恶魔晚出发 → 产生 skip 事件
     */
    function stepActor(state, actor, roll, rng) {
      var ev = [];
      var a = state[actor];
      if (!a.alive) { ev.push({ type: 'skip', actor: actor, reason: 'dead' }); return ev; }
      if (actor === 'demon' && state.round < 3) { ev.push({ type: 'skip', actor: actor, reason: 'late' }); return ev; }
      if (a.paused) { a.paused = false; ev.push({ type: 'skip', actor: actor, reason: 'paused' }); return ev; }
      ev.push({ type: 'roll', actor: actor, roll: roll });
      var from = a.pos;
      var to = moveOnce(from, roll);
      if (to !== from) { ev.push({ type: 'move', actor: actor, from: from, to: to, cause: 'roll' }); a.pos = to; }
      if (to === size && actor !== 'demon') { state.winner = 'human'; state.winReason = actor + '到达终点 48'; ev.push({ type: 'win', actor: actor, via: 'move' }); return ev; }
      if (isFate(a.pos)) resolveFate(state, actor, ev, rng);
      if (actor === 'demon' && !state.winner) captureCheck(state, ev);
      return ev;
    }

    /* —— 完整一轮：玩家 → 队友 → 恶魔 ——（测试/无交互场景用）
     * rolls: {player, mate, demon} 可指定，缺省由 rng 生成
     */
    function stepRound(state, rolls, rng) {
      var ev = [{ type: 'round', round: state.round }];
      var p = rolls && typeof rolls.player === 'number' ? rolls.player : diceMove(d6(rng), d6(rng), 'player');
      var m = rolls && typeof rolls.mate === 'number' ? rolls.mate : diceMove(d6(rng), d6(rng), 'mate');
      var d = rolls && typeof rolls.demon === 'number' ? rolls.demon : diceMove(d6(rng), d6(rng), 'demon');
      ev = ev.concat(stepActor(state, 'player', p, rng));
      if (!state.winner) ev = ev.concat(stepActor(state, 'mate', m, rng));
      if (!state.winner) ev = ev.concat(stepActor(state, 'demon', d, rng));
      if (!state.winner) state.round += 1;
      return ev;
    }

    return {
      BOARD_SIZE: size,
      FATE_CELLS: fateList,
      isFate: isFate,
      rowCol: rowCol,
      colRowToPos: colRowToPos,
      moveOnce: moveOnce,
      newGame: newGame,
      d6: d6,
      diceMove: diceMove,
      cloneState: cloneState,
      resolveFate: resolveFate,
      captureCheck: captureCheck,
      stepActor: stepActor,
      stepRound: stepRound
    };
  }

  var defaultEngine = createEngine();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = createEngine;
    module.exports.createEngine = createEngine;
    module.exports.default = defaultEngine;
  } else {
    global.SnakeEngine = defaultEngine;
    global.SnakeEngine.createEngine = createEngine;
  }
})(typeof window !== 'undefined' ? window : globalThis);
