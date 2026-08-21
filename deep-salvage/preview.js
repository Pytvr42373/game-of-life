(function (global, factory) {
  'use strict';
  var api = factory(global);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.DeepSalvagePreview = api;
})(typeof window !== 'undefined' ? window : globalThis, function (global) {
  'use strict';

  var COLORS = {
    background: '#061923', water: '#0b4050', rock: '#142f38', wreck: '#31505a', gate: '#b98b51',
    cyan: '#9ddfd5', amber: '#f1a760', danger: '#ee756d', oxygen: '#91fff1', dim: '#7ca9aa'
  };

  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function createRenderer(canvas, options) {
    if (!canvas || !canvas.getContext) return null;
    options = options || {};
    var ctx = canvas.getContext('2d');
    var doc = canvas.ownerDocument || global.document;
    var staticCanvas = doc && doc.createElement ? doc.createElement('canvas') : null;
    var staticCtx = staticCanvas && staticCanvas.getContext ? staticCanvas.getContext('2d') : null;
    var terrain = null;
    var width = 0;
    var height = 0;
    var dpr = 1;
    var layout = null;
    var dirty = true;
    var motes = [];
    var fish = [];

    function seedDecorations() {
      motes = [];
      fish = [];
      if (!terrain) return;
      var random = mulberry32((terrain.seedValue || 1) ^ 0x9E3779B9);
      for (var i = 0; i < 38; i++) {
        motes.push({ x: random(), y: random(), size: .55 + random() * 1.3, speed: .018 + random() * .035, phase: random() * 8 });
      }
      for (var f = 0; f < 9; f++) {
        fish.push({ route: f % 2, phase: random(), lane: (random() - .5) * .055, size: 2.4 + random() * 2.8, speed: .012 + random() * .012 });
      }
    }

    function setTerrain(nextTerrain) {
      if (terrain === nextTerrain) return;
      terrain = nextTerrain;
      dirty = true;
      seedDecorations();
    }

    function resize() {
      var rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { width: canvas.clientWidth, height: canvas.clientHeight };
      var nextWidth = Math.max(1, Math.round(rect.width || canvas.clientWidth || 420));
      var nextHeight = Math.max(1, Math.round(rect.height || canvas.clientHeight || 240));
      var nextDpr = Math.min(2, global.devicePixelRatio || 1);
      if (nextWidth === width && nextHeight === height && nextDpr === dpr) return;
      width = nextWidth;
      height = nextHeight;
      dpr = nextDpr;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      if (staticCanvas) {
        staticCanvas.width = canvas.width;
        staticCanvas.height = canvas.height;
      }
      dirty = true;
    }

    function makeLayout() {
      var detailed = options.detailed !== false;
      var left = detailed ? Math.min(52, width * .14) : 7;
      var right = detailed ? 12 : 7;
      var top = detailed ? 10 : 7;
      var bottom = detailed ? 10 : 7;
      var availableWidth = Math.max(1, width - left - right);
      var availableHeight = Math.max(1, height - top - bottom);
      var scaleX;
      var scaleY;
      if (options.fit === 'stretch') {
        scaleX = availableWidth / terrain.cols;
        scaleY = availableHeight / terrain.rows;
      } else {
        var scale = Math.min(availableWidth / terrain.cols, availableHeight / terrain.rows);
        scaleX = scale;
        scaleY = scale;
      }
      var mapWidth = terrain.cols * scaleX;
      var mapHeight = terrain.rows * scaleY;
      return {
        x: left + (availableWidth - mapWidth) / 2,
        y: top + (availableHeight - mapHeight) / 2,
        width: mapWidth,
        height: mapHeight,
        scaleX: scaleX,
        scaleY: scaleY,
        detailed: detailed
      };
    }

    function point(value) {
      return {
        x: layout.x + (value.x + .5) * layout.scaleX,
        y: layout.y + (value.y + .5) * layout.scaleY
      };
    }

    function routePoints(index) {
      var a = terrain.anchors;
      return index === 0
        ? [a.boat, a.shallow, a.leftA, a.leftB, a.leftC, a.deep, a.core]
        : [a.shallow, a.rightA, a.rightB, a.rightC, a.deep, a.core];
    }

    function drawRoute(target, points, color) {
      target.strokeStyle = color;
      target.lineWidth = layout.detailed ? 1.35 : 1;
      target.setLineDash([4, 4]);
      target.beginPath();
      for (var i = 0; i < points.length; i++) {
        var p = point(points[i]);
        if (i === 0) target.moveTo(p.x, p.y); else target.lineTo(p.x, p.y);
      }
      target.stroke();
      target.setLineDash([]);
    }

    function buildStaticLayer() {
      if (!terrain || !staticCtx) return;
      layout = makeLayout();
      staticCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      staticCtx.clearRect(0, 0, width, height);
      var water = staticCtx.createLinearGradient(0, 0, 0, height);
      water.addColorStop(0, '#0d4252');
      water.addColorStop(.58, COLORS.background);
      water.addColorStop(1, '#03101b');
      staticCtx.fillStyle = water;
      staticCtx.fillRect(0, 0, width, height);

      if (layout.detailed) {
        staticCtx.strokeStyle = 'rgba(157,223,213,.09)';
        staticCtx.fillStyle = 'rgba(159,180,177,.72)';
        staticCtx.font = '700 8px Consolas,monospace';
        for (var d = 0; d <= 4; d++) {
          var gy = layout.y + layout.height * d / 4;
          staticCtx.beginPath();
          staticCtx.moveTo(38, gy);
          staticCtx.lineTo(width - 8, gy);
          staticCtx.stroke();
          staticCtx.fillText(String(d * 300), 6, gy + 3);
        }
      }

      for (var y = 0; y < terrain.rows; y++) {
        for (var x = 0; x < terrain.cols; x++) {
          var tile = terrain.grid[y][x];
          staticCtx.fillStyle = tile === 0 ? COLORS.rock : tile === 2 ? COLORS.wreck : tile === 3 ? COLORS.gate : COLORS.water;
          staticCtx.fillRect(layout.x + x * layout.scaleX, layout.y + y * layout.scaleY, Math.ceil(layout.scaleX) + .2, Math.ceil(layout.scaleY) + .2);
        }
      }
      staticCtx.strokeStyle = 'rgba(157,223,213,.28)';
      staticCtx.strokeRect(layout.x - .5, layout.y - .5, layout.width + 1, layout.height + 1);
      drawRoute(staticCtx, routePoints(0), 'rgba(157,223,213,.7)');
      drawRoute(staticCtx, routePoints(1), 'rgba(241,167,96,.76)');

      for (var t = 0; t < terrain.entities.treasures.length; t++) {
        var treasure = point(terrain.entities.treasures[t]);
        staticCtx.fillStyle = COLORS.amber;
        staticCtx.beginPath();
        staticCtx.arc(treasure.x, treasure.y, layout.detailed ? 1.7 : 1.25, 0, Math.PI * 2);
        staticCtx.fill();
      }
      for (var m = 0; m < terrain.entities.mines.length; m++) {
        var mine = point(terrain.entities.mines[m]);
        staticCtx.fillStyle = COLORS.danger;
        staticCtx.fillRect(mine.x - 2, mine.y - 2, 4, 4);
      }
      var boat = point(terrain.entities.boat);
      staticCtx.fillStyle = COLORS.oxygen;
      staticCtx.beginPath();
      staticCtx.moveTo(boat.x, boat.y - 4);
      staticCtx.lineTo(boat.x - 4, boat.y + 3);
      staticCtx.lineTo(boat.x + 4, boat.y + 3);
      staticCtx.closePath();
      staticCtx.fill();
      if (layout.detailed) {
        var core = point(terrain.anchors.core);
        staticCtx.font = '800 9px "Avenir Next",sans-serif';
        staticCtx.fillStyle = '#edf4ef';
        staticCtx.fillText('母船', boat.x + 7, boat.y + 3);
        staticCtx.fillStyle = COLORS.amber;
        staticCtx.fillText('深渊核心', core.x + 7, core.y + 3);
      }
      dirty = false;
    }

    function routePosition(route, progress) {
      var span = route.length - 1;
      var scaled = progress * span;
      var index = Math.min(span - 1, Math.floor(scaled));
      var local = scaled - index;
      var from = point(route[index]);
      var to = point(route[index + 1]);
      return { x: from.x + (to.x - from.x) * local, y: from.y + (to.y - from.y) * local, angle: Math.atan2(to.y - from.y, to.x - from.x) };
    }

    function render(time) {
      if (!terrain || !ctx) return;
      resize();
      if (dirty) buildStaticLayer();
      if (!layout) return;
      time = Number(time) || 0;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = COLORS.background;
      ctx.fillRect(0, 0, width, height);
      if (staticCanvas && ctx.drawImage) ctx.drawImage(staticCanvas, 0, 0, staticCanvas.width, staticCanvas.height, 0, 0, width, height);

      ctx.save();
      ctx.beginPath();
      ctx.rect ? ctx.rect(layout.x, layout.y, layout.width, layout.height) : ctx.fillRect(layout.x, layout.y, 0, 0);
      if (ctx.clip) ctx.clip();
      var shaftX = layout.x + layout.width * (.2 + (Math.sin(time * .16) + 1) * .18);
      var shaft = ctx.createLinearGradient(shaftX, layout.y, shaftX + layout.width * .22, layout.y + layout.height);
      shaft.addColorStop(0, 'rgba(157,223,213,.16)');
      shaft.addColorStop(1, 'rgba(157,223,213,0)');
      ctx.fillStyle = shaft;
      ctx.beginPath();
      ctx.moveTo(shaftX, layout.y);
      ctx.lineTo(shaftX + layout.width * .12, layout.y);
      ctx.lineTo(shaftX + layout.width * .32, layout.y + layout.height);
      ctx.lineTo(shaftX + layout.width * .13, layout.y + layout.height);
      ctx.closePath();
      ctx.fill();

      for (var i = 0; i < motes.length; i++) {
        var mote = motes[i];
        var my = (mote.y - time * mote.speed) % 1;
        if (my < 0) my += 1;
        ctx.globalAlpha = .2 + Math.sin(time * .7 + mote.phase) * .08;
        ctx.fillStyle = COLORS.cyan;
        ctx.beginPath();
        ctx.arc(layout.x + mote.x * layout.width, layout.y + my * layout.height, mote.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      for (var f = 0; f < fish.length; f++) {
        var item = fish[f];
        var progress = (item.phase + time * item.speed) % 1;
        var fishPoint = routePosition(routePoints(item.route), progress);
        var laneOffset = item.lane * layout.width;
        ctx.save();
        ctx.translate(fishPoint.x - Math.sin(fishPoint.angle) * laneOffset, fishPoint.y + Math.cos(fishPoint.angle) * laneOffset);
        ctx.rotate(fishPoint.angle);
        ctx.fillStyle = f % 3 ? 'rgba(174,218,202,.62)' : 'rgba(113,214,204,.76)';
        ctx.beginPath();
        ctx.moveTo(item.size, 0);
        ctx.lineTo(-item.size, -item.size * .55);
        ctx.lineTo(-item.size * .55, 0);
        ctx.lineTo(-item.size, item.size * .55);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      for (var h = 0; h < terrain.entities.habitats.length; h++) {
        var home = point(terrain.entities.habitats[h]);
        var pulse = 1 + Math.sin(time * 1.8 + h * 2.1) * .18;
        ctx.strokeStyle = 'rgba(238,117,109,.88)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(home.x, home.y, Math.max(4, terrain.entities.habitats[h].radius * Math.min(layout.scaleX, layout.scaleY)) * pulse, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = COLORS.danger;
        ctx.beginPath();
        ctx.arc(home.x, home.y, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }

      var scanY = layout.y + ((time * .085) % 1) * layout.height;
      var scan = ctx.createLinearGradient(0, scanY - 10, 0, scanY + 4);
      scan.addColorStop(0, 'rgba(145,255,241,0)');
      scan.addColorStop(1, 'rgba(145,255,241,.22)');
      ctx.fillStyle = scan;
      ctx.fillRect(layout.x, scanY - 10, layout.width, 14);
      ctx.fillStyle = 'rgba(145,255,241,.5)';
      ctx.fillRect(layout.x, scanY, layout.width, 1);
      ctx.restore();

      var shade = ctx.createLinearGradient(0, 0, 0, height);
      shade.addColorStop(0, 'rgba(3,16,27,0)');
      shade.addColorStop(1, 'rgba(3,16,27,.34)');
      ctx.fillStyle = shade;
      ctx.fillRect(0, 0, width, height);
    }

    return { setTerrain: setTerrain, render: render };
  }

  return { createRenderer: createRenderer };
});
