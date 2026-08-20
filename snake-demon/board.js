/* =====================================================================
 * board.js —— 《恶魔追逐·队友模式》Canvas 等距阶梯棋盘渲染
 * 采用确定性等距(斜投影)几何：棋盘从远(第1行)到近(第4行)逐级放大，
 * 每行是一层台阶（顶面 + 立面），格子为立体平行四边形，
 * 命运格金色发光，起点/终点高亮，蛇形方向箭头可见。
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

    // 等距几何参数（单位 px，基于画布宽度自适应）
    var W = 0, H = 0;
    var rows = 4, cols = 12;
    var geo = null; // 每行几何

    function layout() {
      W = canvas ? canvas.clientWidth : (opts.width || 640);
      // 每行宽度按比例缩放：第0行(远)=78%，第3行(近)=100%，形成透视阶梯
      var padX = 16;
      var rowScale = [0.78, 0.85, 0.92, 1.0];
      var baseRowW = W - padX * 2;
      var rowW = [];
      for (var r = 0; r < rows; r++) {
        rowW.push(baseRowW * rowScale[r]);
      }
      var colW = [], hh = [];
      for (var r = 0; r < rows; r++) {
        colW.push(rowW[r] / cols);
        hh.push(colW[r] * 0.5); // 顶面高度（等距纵向压缩）
      }
      var stepH = colW[0] * 0.34; // 台阶立面高度
      // 每行顶部 y：逐行累计（顶面高 + 立面 + 错层）
      var yTop = [padX + 6];
      for (var r = 1; r < rows; r++) {
        yTop.push(yTop[r - 1] + hh[r - 1] + stepH);
      }
      // 斜偏移：顶面右端下移，形成等距菱形感（相对行宽）
      var dx = rowW[0] * 0.085;
      var totalH = yTop[rows - 1] + hh[rows - 1] + stepH + 12;
      geo = { rowW: rowW, colW: colW, hh: hh, yTop: yTop, stepH: stepH, dx: dx, totalH: totalH, padX: padX, rowScale: rowScale };
      H = totalH;
      if (canvas) {
        var dpr = Math.min(2, global.devicePixelRatio || 1);
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        canvas.style.height = H + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    }

    // 返回某格顶面中心（屏幕坐标）+ 尺寸，供棋子定位
    function cellCenter(pos) {
      var rc = posToRC(pos);
      var r = rc.row, c = rc.col;
      var g = geo;
      var rowW = g.rowW[r];
      var x0 = (W - rowW) / 2;
      var cw = g.colW[r];
      var cx = x0 + c * cw + cw / 2 + g.dx / 2; // 顶面水平中心（含斜度）
      var cy = g.yTop[r] + g.hh[r] / 2 + g.dx / 2; // 顶面垂直中心（含斜度）
      return { x: cx, y: cy, w: cw, h: g.hh[r], row: r, col: c, scale: g.rowScale[r], dx: g.dx };
    }
    function posToRC(pos) {
      var idx = pos - 1;
      var row = Math.floor(idx / cols);
      var cc = idx % cols;
      var col = (row % 2 === 0) ? cc : (cols - 1 - cc);
      return { row: row, col: col };
    }

    function draw() {
      if (!ctx || !geo) return;
      ctx.clearRect(0, 0, W, H);
      // 背景透视地面
      var grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, 'rgba(6,14,10,.9)');
      grad.addColorStop(1, 'rgba(14,26,18,.95)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      // 从远到近画每一行（近行覆盖远行底部，形成前后遮挡）
      for (var r = 0; r < rows; r++) {
        drawRow(r);
      }
    }

    // 画一行台阶：先画立面（整行），再画格子顶面
    function drawRow(r) {
      var g = geo;
      var rowW = g.rowW[r];
      var x0 = (W - rowW) / 2;
      var y = g.yTop[r];
      var cw = g.colW[r];
      var hh = g.hh[r];
      var dx = g.dx;
      var stepH = g.stepH;

      // —— 行背景立面（台阶侧壁）——
      ctx.beginPath();
      ctx.moveTo(x0, y + hh);
      ctx.lineTo(x0 + rowW, y + hh);
      ctx.lineTo(x0 + rowW + dx, y + hh + stepH);
      ctx.lineTo(x0 + dx, y + hh + stepH);
      ctx.closePath();
      var sh = ctx.createLinearGradient(0, y + hh, 0, y + hh + stepH);
      var dk = shade(palette.row[r], -0.55);
      sh.addColorStop(0, shade(dk, 0.18));
      sh.addColorStop(1, dk);
      ctx.fillStyle = sh;
      ctx.fill();

      // —— 该行左/右侧壁 ——
      // 左壁
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x0 + dx, y + stepH);
      ctx.lineTo(x0 + dx, y + hh + stepH);
      ctx.lineTo(x0, y + hh);
      ctx.closePath();
      ctx.fillStyle = shade(palette.row[r], -0.42);
      ctx.fill();
      // 右壁
      ctx.beginPath();
      ctx.moveTo(x0 + rowW, y);
      ctx.lineTo(x0 + rowW + dx, y + stepH);
      ctx.lineTo(x0 + rowW + dx, y + hh + stepH);
      ctx.lineTo(x0 + rowW, y + hh);
      ctx.closePath();
      ctx.fillStyle = shade(palette.row[r], -0.38);
      ctx.fill();

      // —— 12 个格子顶面 ——
      for (var c = 0; c < cols; c++) {
        var pos = rcToPos(r, c);
        var cx = x0 + c * cw;
        var cy = y;
        // 顶面平行四边形（右侧带斜度）
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + cw, cy);
        ctx.lineTo(cx + cw + dx, cy + hh);
        ctx.lineTo(cx + dx, cy + hh);
        ctx.closePath();
        var isFate = fateCells.indexOf(pos) !== -1;
        var isStart = pos === start;
        var isEnd = pos === end;
        var base = isFate ? palette.fate : (isStart ? palette.start : (isEnd ? palette.end : palette.row[r]));
        var gg = ctx.createLinearGradient(cx, cy, cx + cw, cy + hh);
        gg.addColorStop(0, shade(base, 0.34));
        gg.addColorStop(1, shade(base, -0.1));
        ctx.fillStyle = gg;
        ctx.fill();
        // 描边
        ctx.strokeStyle = isFate ? 'rgba(245,197,24,.85)' : 'rgba(255,255,255,.14)';
        ctx.lineWidth = isFate ? 1.6 : 1;
        ctx.stroke();
        // 命运格发光
        if (isFate) {
          ctx.save();
          ctx.shadowColor = 'rgba(245,197,24,.9)';
          ctx.shadowBlur = 10;
          ctx.strokeStyle = 'rgba(245,197,24,.9)';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.restore();
        }
        // 序号
        ctx.fillStyle = isFate ? 'rgba(20,12,2,.9)' : (isStart || isEnd ? '#0b140d' : palette.text);
        ctx.font = 'bold ' + Math.max(9, Math.round(cw * 0.26)) + 'px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(String(pos), cx + 2, cy + 2);
        // 命运/起点/终点标记
        if (isFate) {
          ctx.font = 'bold ' + Math.round(cw * 0.5) + 'px serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = 'rgba(20,12,2,.92)';
          ctx.fillText('?', cx + cw / 2 + dx / 2, cy + hh / 2);
        } else if (isStart) {
          ctx.font = 'bold ' + Math.round(cw * 0.42) + 'px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = 'rgba(8,24,14,.92)';
          ctx.fillText('起', cx + cw / 2 + dx / 2, cy + hh / 2);
        } else if (isEnd) {
          ctx.font = 'bold ' + Math.round(cw * 0.42) + 'px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = 'rgba(20,12,2,.92)';
          ctx.fillText('终', cx + cw / 2 + dx / 2, cy + hh / 2);
        }
        // 蛇形方向箭头（非命运/起终）
        if (!isFate && !isStart && !isEnd && c < cols - 1) {
          ctx.font = Math.round(cw * 0.3) + 'px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = 'rgba(255,255,255,.4)';
          ctx.fillText(r % 2 === 0 ? '→' : '←', cx + cw / 2 + dx / 2, cy + hh / 2);
        }
      }
    }

    function rcToPos(row, col) {
      var c = (row % 2 === 0) ? col : (cols - 1 - col);
      return row * cols + c + 1;
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
