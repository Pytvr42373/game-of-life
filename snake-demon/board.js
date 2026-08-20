/* =====================================================================
 * board.js —— 《恶魔追逐·队友模式》平面 2D 棋盘渲染
 * 4 行 × 12 列矩形网格，蛇形路径。格子为带立体感的平面方块
 * （顶部高光 + 底部阴影），命运格金色发光，起点/终点高亮。
 * 暴露 window.SnakeBoard；兼容 node（module.exports）便于几何自测。
 * ===================================================================== */
(function (global) {
  'use strict';

  function createBoard(opts) {
    opts = opts || {};
    var canvas = opts.canvas;
    var ctx = canvas ? canvas.getContext('2d') : null;
    var fateCells = opts.fateCells || [5, 10, 15, 25, 35, 44];
    var start = opts.start || 1;
    var end = opts.end || 48;
    var palette = opts.palette || { row: ['#16301f', '#1b3a26', '#204430', '#26523a'], edge: '#3f7d4e', fate: '#f5c518', start: '#22c55e', end: '#f5c518', text: '#e7f7ee' };

    // 2D 网格参数
    var W = 0, H = 0;
    var rows = 4, cols = 12;
    var geo = null;

    function layout() {
      W = canvas ? canvas.clientWidth : (opts.width || 640);
      var padX = 6, padY = 6, gap = 3;
      var cw = (W - padX * 2 - gap * (cols - 1)) / cols;
      var ch = Math.round(cw * 0.72); // 略扁的格子，接近正方形
      var totalH = padY * 2 + rows * ch + gap * (rows - 1);
      geo = { padX: padX, padY: padY, gap: gap, cw: cw, ch: ch, totalH: totalH };
      H = totalH;
      if (canvas) {
        var dpr = Math.min(2, global.devicePixelRatio || 1);
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        canvas.style.height = H + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    }

    function posToRC(pos) {
      var idx = pos - 1;
      var row = Math.floor(idx / cols);
      var cc = idx % cols;
      var col = (row % 2 === 0) ? cc : (cols - 1 - cc);
      return { row: row, col: col };
    }
    function rcToPos(row, col) {
      var c = (row % 2 === 0) ? col : (cols - 1 - col);
      return row * cols + c + 1;
    }

    // 返回某格中心 + 尺寸（供棋子精确落格定位）
    function cellCenter(pos) {
      var rc = posToRC(pos);
      var g = geo;
      var x = g.padX + rc.col * (g.cw + g.gap) + g.cw / 2;
      var y = g.padY + rc.row * (g.ch + g.gap) + g.ch / 2;
      return { x: x, y: y, w: g.cw, h: g.ch, row: rc.row, col: rc.col, scale: 1 };
    }

    function draw() {
      if (!ctx || !geo) return;
      ctx.clearRect(0, 0, W, H);
      var g = geo;
      // 棋盘底板
      var bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, 'rgba(10,20,14,.6)');
      bg.addColorStop(1, 'rgba(14,28,18,.8)');
      ctx.fillStyle = bg;
      roundRect(ctx, 0, 0, W, H, 12);
      ctx.fill();
      ctx.strokeStyle = 'rgba(74,222,128,.14)';
      ctx.lineWidth = 1;
      roundRect(ctx, 0, 0, W, H, 12);
      ctx.stroke();

      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          var pos = rcToPos(r, c);
          var cx = g.padX + c * (g.cw + g.gap);
          var cy = g.padY + r * (g.ch + g.gap);
          drawCell(cx, cy, pos);
        }
      }
    }

    function drawCell(x, y, pos) {
      var g = geo;
      var cw = g.cw, ch = g.ch;
      var isFate = fateCells.indexOf(pos) !== -1;
      var isStart = pos === start;
      var isEnd = pos === end;
      var rc = posToRC(pos);
      var base = isFate ? palette.fate : (isStart ? palette.start : (isEnd ? palette.end : palette.row[rc.row]));

      // 格底阴影
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      roundRect(ctx, x + 1, y + 2, cw, ch, 7);
      ctx.fill();
      // 格面
      var gg = ctx.createLinearGradient(x, y, x, y + ch);
      gg.addColorStop(0, shade(base, 0.28));
      gg.addColorStop(0.55, base);
      gg.addColorStop(1, shade(base, -0.18));
      ctx.fillStyle = gg;
      roundRect(ctx, x, y, cw, ch, 7);
      ctx.fill();
      // 描边
      ctx.strokeStyle = isFate ? 'rgba(245,197,24,.85)' : 'rgba(255,255,255,.16)';
      ctx.lineWidth = isFate ? 1.6 : 1;
      roundRect(ctx, x, y, cw, ch, 7);
      ctx.stroke();
      // 命运格发光
      if (isFate) {
        ctx.save();
        ctx.shadowColor = 'rgba(245,197,24,.85)';
        ctx.shadowBlur = 9;
        ctx.strokeStyle = 'rgba(245,197,24,.9)';
        ctx.lineWidth = 1.8;
        roundRect(ctx, x, y, cw, ch, 7);
        ctx.stroke();
        ctx.restore();
      }

      // 序号
      ctx.fillStyle = isFate ? 'rgba(20,12,2,.9)' : (isStart || isEnd ? '#0b140d' : palette.text);
      ctx.font = 'bold ' + Math.max(8, Math.round(cw * 0.22)) + 'px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(String(pos), x + 3, y + 3);

      // 中央标记
      var mark = isFate ? '?' : (isStart ? '起' : (isEnd ? '终' : ''));
      if (mark) {
        ctx.font = 'bold ' + Math.round(cw * 0.4) + 'px ' + (isFate ? 'serif' : 'sans-serif');
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = isFate ? 'rgba(20,12,2,.92)' : 'rgba(8,20,12,.92)';
        ctx.fillText(mark, x + cw / 2, y + ch / 2);
      } else {
        // 蛇形方向箭头
        ctx.font = Math.round(cw * 0.26) + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(255,255,255,.4)';
        ctx.fillText(rc.row % 2 === 0 ? '→' : '←', x + cw / 2, y + ch / 2);
      }
    }

    function roundRect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    // 明暗工具：hex 色 + 亮度 delta(-1..1)
    function shade(hex, delta) {
      var c = hex.replace('#', '');
      if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
      var num = parseInt(c, 16);
      var r = Math.min(255, Math.max(0, (num >> 16) + Math.round(255 * delta)));
      var g = Math.min(255, Math.max(0, ((num >> 8) & 255) + Math.round(255 * delta)));
      var b = Math.min(255, Math.max(0, (num & 255) + Math.round(255 * delta)));
      return 'rgb(' + r + ',' + g + ',' + b + ')';
    }

    function setPalette(p) { if (p) palette = p; }

    return {
      layout: layout,
      draw: draw,
      cellCenter: cellCenter,
      posToRC: posToRC,
      rcToPos: rcToPos,
      setPalette: setPalette,
      get height() { return H; },
      get width() { return W; }
    };
  }

  var api = { createBoard: createBoard };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  global.SnakeBoard = api;
})(typeof window !== 'undefined' ? window : globalThis);
