(function () {
  'use strict';

  var TerrainAPI = window.DeepSalvageTerrain;
  var GameAPI = window.DeepSalvageGame;
  var AudioSys = window.DeepSalvageAudio;
  var PreviewAPI = window.DeepSalvagePreview;
  if (!TerrainAPI || !GameAPI) return;

  var canvas = document.getElementById('gameCanvas');
  var ctx = canvas.getContext('2d');
  var lightCanvas = document.createElement('canvas');
  var lightCtx = lightCanvas.getContext('2d');
  var previewCanvas = document.getElementById('trenchPreview');
  var previewRenderer = PreviewAPI ? PreviewAPI.createRenderer(previewCanvas, { detailed: true }) : null;
  var startScreen = document.getElementById('startScreen');
  var resultScreen = document.getElementById('resultScreen');
  var pauseScreen = document.getElementById('pauseScreen');
  var startBtn = document.getElementById('startBtn');
  var seedBtn = document.getElementById('seedBtn');
  var retryBtn = document.getElementById('retryBtn');
  var resumeBtn = document.getElementById('resumeBtn');
  var soundToggle = document.getElementById('soundToggle');
  var missionHud = document.getElementById('missionHud');
  var crewStrip = document.getElementById('crewStrip');
  var depthGauge = document.getElementById('depthGauge');
  var inventoryPanel = document.getElementById('inventoryPanel');
  var controlNote = document.getElementById('controlNote');
  var oxygenValue = document.getElementById('oxygenValue');
  var oxygenFill = document.getElementById('oxygenFill');
  var suffocationCount = document.getElementById('suffocationCount');
  var depthValue = document.getElementById('depthValue');
  var zoneValue = document.getElementById('zoneValue');
  var haulValue = document.getElementById('haulValue');
  var timeValue = document.getElementById('timeValue');
  var guardIntent = document.getElementById('guardIntent');
  var salvagerIntent = document.getElementById('salvagerIntent');
  var guardOxygen = document.getElementById('guardOxygen');
  var salvagerOxygen = document.getElementById('salvagerOxygen');
  var depthMarker = document.getElementById('depthMarker');
  var inventorySlots = document.getElementById('inventorySlots');
  var scorePreview = document.getElementById('scorePreview');
  var staminaFill = document.getElementById('staminaFill');
  var staminaValue = document.getElementById('staminaValue');
  var dangerMessage = document.getElementById('dangerMessage');
  var eventToast = document.getElementById('eventToast');
  var archiveCount = document.getElementById('archiveCount');
  var archiveGear = document.getElementById('archiveGear');
  var seedValue = document.getElementById('seedValue');

  var COLORS = {
    waterTop: '#1b6073', waterMid: '#0d3c51', waterDeep: '#08283f', waterCore: '#06182d',
    rock: '#183a42', rockDark: '#0d2832', rockEdge: '#56807d', sand: '#78988b',
    wreck: '#314d59', wreckDark: '#172f3e', rust: '#a85e49', metal: '#6e9092',
    cyan: '#71d6cc', cyanDark: '#2b8e8b', amber: '#d9bd6c', coral: '#e87a67',
    danger: '#f35f62', weed: '#3b8a6f', oxygen: '#91fff1', text: '#e2f4f1', dim: '#8aafb2'
  };

  var RARITY_COLORS = {
    common: '#c6d0cf', fine: '#67d6ab', rare: '#61b8f4', epic: '#c679e7', legendary: '#f2c75c'
  };
  var RARITY_NAMES = { common: '普通', fine: '精良', rare: '稀有', epic: '史诗', legendary: '传奇' };
  var FAILURE_NAMES = {
    oxygen: ['氧气耗尽', '窒息倒计时结束，打捞任务失败。'],
    shark: ['深海猎杀', '你被第二次拖入鲨鱼巢穴，打捞任务失败。']
  };

  var viewWidth = 0;
  var viewHeight = 0;
  var dpr = 1;
  var terrain = null;
  var game = null;
  var seed = '';
  var camera = { x: 0, y: 0 };
  var keys = {};
  var touchMove = { up: false, down: false, left: false, right: false };
  var touchAction = { sprint: false, interact: false };
  var paused = false;
  var concluded = false;
  var elapsed = 0;
  var lastTime = 0;
  var toastTimer = 0;
  var decor = null;
  var particles = [];
  var shockwaves = [];
  var unlockedGear = loadUnlockedGear();
  var reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function loadUnlockedGear() {
    try {
      var value = JSON.parse(localStorage.getItem('ds-unlocked-gear') || '[]');
      return Array.isArray(value) ? value.filter(function (id) { return /^gear[0-4]$/.test(id); }) : [];
    } catch (e) { return []; }
  }

  function saveUnlockedGear(items) {
    try { localStorage.setItem('ds-unlocked-gear', JSON.stringify(items)); } catch (e) {}
  }

  function saveBestScore(score) {
    try {
      var current = parseInt(localStorage.getItem('ds-best-score'), 10) || 0;
      if (score > current) localStorage.setItem('ds-best-score', String(score));
    } catch (e) {}
  }

  function randomSeed() {
    return 'TRENCH-' + Math.floor(Date.now() % 2176782336).toString(36).toUpperCase();
  }

  function mulberry32(value) {
    var state = value >>> 0;
    return function () {
      state |= 0; state = state + 0x6D2B79F5 | 0;
      var t = Math.imul(state ^ state >>> 15, 1 | state);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function resize() {
    var rect = canvas.getBoundingClientRect();
    viewWidth = Math.max(1, rect.width);
    viewHeight = Math.max(1, rect.height);
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(viewWidth * dpr);
    canvas.height = Math.round(viewHeight * dpr);
    lightCanvas.width = canvas.width;
    lightCanvas.height = canvas.height;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (lightCtx) lightCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (terrain) drawTrenchPreview();
  }

  function cellNoise(x, y, salt) {
    var n = Math.imul(x + 17 + salt, 374761393) ^ Math.imul(y + 29, 668265263) ^ terrain.seedValue;
    n = Math.imul(n ^ n >>> 13, 1274126177);
    return ((n ^ n >>> 16) >>> 0) / 4294967295;
  }

  function isPassableTile(x, y) {
    return TerrainAPI.isPassable(terrain, Math.floor(x), Math.floor(y), true);
  }

  function randomPassable(random, minY, maxY) {
    minY = minY == null ? 1 : minY;
    maxY = maxY == null ? terrain.rows - 2 : maxY;
    for (var i = 0; i < 90; i++) {
      var point = { x: 1 + random() * (terrain.cols - 2), y: minY + random() * Math.max(1, maxY - minY) };
      if (isPassableTile(point.x, point.y)) return point;
    }
    return { x: terrain.entities.spawn.x, y: terrain.entities.spawn.y };
  }

  function generateDecorations() {
    var random = mulberry32(terrain.seedValue ^ 0x9E3779B9);
    var fishSchools = [];
    var jellies = [];
    var shafts = [];
    var motes = [];
    for (var i = 0; i < 10; i++) {
      var point = randomPassable(random, 5, i < 6 ? Math.floor(terrain.rows * .48) : terrain.rows - 4);
      fishSchools.push({
        x: point.x, y: point.y, count: 6 + Math.floor(random() * 9), spread: 0.8 + random() * 1.3,
        angle: random() * Math.PI * 2, speed: 0.16 + random() * 0.22, phase: random() * 9,
        color: i < 5 ? 'rgba(175,218,202,.62)' : 'rgba(94,184,199,.55)'
      });
    }
    for (var j = 0; j < 18; j++) {
      var jellyPoint = randomPassable(random, 10, terrain.rows - 3);
      jellies.push({ x: jellyPoint.x, y: jellyPoint.y, size: 0.16 + random() * 0.18, phase: random() * 8, hue: random() > .5 ? COLORS.cyan : '#8e9ee8' });
    }
    for (var s = 0; s < 7; s++) shafts.push({ x: 4 + random() * (terrain.cols - 8), width: 2.5 + random() * 4.5, lean: -0.25 + random() * 0.5, alpha: 0.06 + random() * 0.08 });
    for (var m = 0; m < 90; m++) motes.push({ x: random() * terrain.cols, y: random() * terrain.rows, size: .025 + random() * .055, phase: random() * 10, speed: .05 + random() * .13 });
    decor = { fishSchools: fishSchools, jellies: jellies, shafts: shafts, motes: motes };
  }

  function drawTrenchPreview(){
    if(!previewRenderer||!terrain)return;
    previewRenderer.setTerrain(terrain);
    previewRenderer.render(reducedMotion?0:elapsed);
  }

  function makeRun(nextSeed) {
    seed = nextSeed || randomSeed();
    terrain = TerrainAPI.generateTerrain(seed);
    game = new GameAPI.Game(terrain, { unlockedGear: unlockedGear });
    seedValue.textContent = seed;
    concluded = false;
    paused = false;
    particles = [];
    shockwaves = [];
    generateDecorations();
    drawTrenchPreview();
    setCameraToPlayer(true);
    renderArchive();
  }

  function startRun() {
    if (!game || game.state !== 'ready') makeRun(randomSeed());
    game.start();
    startScreen.hidden = true;
    resultScreen.hidden = true;
    pauseScreen.hidden = true;
    showRunUI(true);
    if (AudioSys) AudioSys.start();
  }

  function restartRun() {
    makeRun(randomSeed());
    startRun();
  }

  function showRunUI(show) {
    missionHud.hidden = !show;
    crewStrip.hidden = !show;
    depthGauge.hidden = !show;
    inventoryPanel.hidden = !show;
    controlNote.hidden = !show;
  }

  function renderArchive() {
    archiveCount.textContent = unlockedGear.length + ' / 5';
    archiveGear.innerHTML = '';
    for (var i = 0; i < 5; i++) {
      var dot = document.createElement('span');
      if (unlockedGear.indexOf('gear' + i) !== -1) dot.className = 'on';
      archiveGear.appendChild(dot);
    }
  }

  function setCameraToPlayer(immediate) {
    if (!game) return;
    var target = actorWorld(game.player);
    if (immediate) { camera.x = target.x; camera.y = target.y; }
    else {
      camera.x += (target.x - camera.x) * 0.08;
      camera.y += (target.y - camera.y) * 0.08;
    }
    var worldWidth = terrain.cols * terrain.tileSize;
    var worldHeight = terrain.rows * terrain.tileSize;
    camera.x = clampCamera(camera.x, worldWidth, viewWidth);
    camera.y = clampCamera(camera.y, worldHeight, viewHeight);
  }

  function clampCamera(value, worldSize, viewSize) {
    if (worldSize <= viewSize) return worldSize / 2;
    return Math.max(viewSize / 2, Math.min(worldSize - viewSize / 2, value));
  }

  function actorWorld(actor) {
    return { x: actor.x * terrain.tileSize, y: actor.y * terrain.tileSize };
  }

  function zoneAt(y, x) {
    if (y < 8) return '潜航坞';
    if (y < 27) return x > 32 ? '沉船上层' : '浅水架';
    if (y < 51) return x > 32 ? '沉船舱室' : '礁石猎场';
    if (y < 60) return '海沟过渡区';
    return '深渊核心';
  }

  function movementInput() {
    var x = 0, y = 0;
    if (keys.KeyA || keys.ArrowLeft || touchMove.left) x--;
    if (keys.KeyD || keys.ArrowRight || touchMove.right) x++;
    if (keys.KeyW || keys.ArrowUp || touchMove.up) y--;
    if (keys.KeyS || keys.ArrowDown || touchMove.down) y++;
    var length = Math.sqrt(x * x + y * y);
    if (length) { x /= length; y /= length; }
    return { x: x, y: y };
  }

  function updateGame(dt) {
    if (!game || game.state !== 'playing' || paused) return;
    var move = movementInput();
    game.setInput({
      x: move.x, y: move.y,
      sprint: !!(keys.ShiftLeft || keys.ShiftRight || keys.Space || touchAction.sprint),
      interact: !!(keys.KeyE || touchAction.interact)
    });
    game.update(dt);
    updateDecor(dt);
    updateParticles(dt);
    setCameraToPlayer(false);
    handleEvents(game.drainEvents());
    updateHUD();
    updateThreatAudio();
    if (!concluded && (game.state === 'won' || game.state === 'failed')) concludeRun();
  }

  function updateDecor(dt) {
    if (!decor) return;
    for (var i = 0; i < decor.fishSchools.length; i++) {
      var school = decor.fishSchools[i];
      var nextX=school.x+Math.cos(school.angle)*school.speed*dt;
      var nextY=school.y+Math.sin(school.angle)*school.speed*dt;
      if(isSchoolPositionClear(nextX,nextY,school.spread)){
        school.x=nextX;school.y=nextY;
      }else{
        school.angle+=Math.PI*(.62+(i%4)*.13);
        school.phase+=.7;
      }
    }
    for (var m = 0; m < decor.motes.length; m++) {
      decor.motes[m].y -= decor.motes[m].speed * dt;
      if (decor.motes[m].y < 1) decor.motes[m].y = terrain.rows - 1;
    }
  }

  function isSchoolPositionClear(x,y,spread){
    if(x<2||y<2||x>terrain.cols-2||y>terrain.rows-2||!isPassableTile(x,y))return false;
    var radius=Math.min(1.2,spread*.68);
    return isPassableTile(x+radius,y)&&isPassableTile(x-radius,y)&&isPassableTile(x,y+radius)&&isPassableTile(x,y-radius);
  }

  function updateParticles(dt) {
    for (var i = particles.length - 1; i >= 0; i--) {
      var particle = particles[i];
      particle.t += dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      if (particle.t >= particle.life) particles.splice(i, 1);
    }
    for (var j = shockwaves.length - 1; j >= 0; j--) {
      shockwaves[j].t += dt;
      if (shockwaves[j].t >= shockwaves[j].life) shockwaves.splice(j, 1);
    }
  }

  function handleEvents(events) {
    for (var i = 0; i < events.length; i++) {
      var event = events[i];
      var data = event.data || {};
      if (AudioSys) AudioSys.play(event);
      if (event.type === 'loot') {
        showToast('获得' + (RARITY_NAMES[data.rarity] || '') + '宝物', data.rarity === 'legendary' || data.rarity === 'epic' ? 'gear' : '');
        burstAt(game.player, RARITY_COLORS[data.rarity] || COLORS.amber, data.rarity === 'legendary' ? 28 : 14);
        if (data.rarity === 'legendary') shockwaves.push({ x: game.player.x, y: game.player.y, t: 0, life: 1.1, color: COLORS.amber });
      } else if (event.type === 'gear') {
        showToast('回收到 ' + (RARITY_NAMES[data.rarity] || '') + '装备 · ' + data.name, 'gear');
        burstAt(game.player, RARITY_COLORS[data.rarity] || COLORS.cyan, 24);
      } else if (event.type === 'oxygen') {
        showToast(data.target === 'player' ? '氧气补充 +40' : '队友补充氧气', '');
      } else if (event.type === 'inventoryFull') {
        showToast('背包已满，立即返船或继续冒险', 'danger');
      } else if (event.type === 'hazard') {
        var weedSeconds = unlockedGear.indexOf('gear2') !== -1 ? '1' : '2';
        var hazardNames = { seaweed: '缠绕海草 · 束缚 ' + weedSeconds + ' 秒', mine: '触发水雷 · 减速 2 秒' };
        if (data.target === 'player') {
          showDanger(hazardNames[data.type] || '危险接触');
          if(data.type==='mine'){burstAt(game.player,COLORS.danger,18);shockwaves.push({x:game.player.x,y:game.player.y,t:0,life:.7,color:COLORS.danger});}
        }
      } else if (event.type === 'sharkGrab') {
        showDanger(data.target === 'player' ? '鲨鱼正在拖拽你' : '队友被鲨鱼拖走');
      } else if (event.type === 'sharkNest') {
        showDanger(data.target === 'player' ? '首次拖入巢穴 · 你正在流血' : '队友被拖入巢穴');
      } else if (event.type === 'rescue') {
        showToast(data.target === 'player' ? '队友将你救出' : '已救出队友', '');
      } else if (event.type === 'teammateLost') {
        showToast((data.role === 'guard' ? '护卫' : '打捞员') + '失联', 'danger');
      }
    }
  }

  function burstAt(actor, color, count) {
    for (var i = 0; i < count; i++) {
      var angle = Math.random() * Math.PI * 2;
      var speed = 0.35 + Math.random() * 0.8;
      particles.push({ x: actor.x, y: actor.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, t: 0, life: 0.55 + Math.random() * 0.7, color: color, size: 1.5 + Math.random() * 2.5 });
    }
  }

  function showToast(text, tone) {
    eventToast.textContent = text;
    eventToast.className = 'event-toast show' + (tone ? ' ' + tone : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { eventToast.className = 'event-toast'; }, 1900);
  }

  function showDanger(text) {
    dangerMessage.textContent = text;
    dangerMessage.classList.remove('show');
    void dangerMessage.offsetWidth;
    dangerMessage.classList.add('show');
  }

  function updateThreatAudio() {
    if (!AudioSys || !game) return;
    var nearest = Infinity;
    for (var i = 0; i < game.sharks.length; i++) {
      var shark = game.sharks[i];
      var dx = shark.x - game.player.x;
      var dy = shark.y - game.player.y;
      nearest = Math.min(nearest, Math.sqrt(dx * dx + dy * dy));
    }
    var threat = nearest === Infinity ? 0 : Math.max(0, 1 - nearest / 9);
    if (game.sharks.some(function (shark) { return shark.aiState === 'chase'; })) threat = Math.max(threat, 0.65);
    AudioSys.setThreat(threat, game.player.oxygen / game.player.oxygenMax);
  }

  function updateHUD() {
    var p = game.player;
    var ratio = Math.max(0, p.oxygen / p.oxygenMax);
    oxygenValue.textContent = Math.ceil(p.oxygen);
    oxygenFill.style.transform = 'scaleX(' + ratio + ')';
    oxygenFill.style.background = ratio < .25 ? COLORS.danger : ratio < .5 ? COLORS.amber : '';
    suffocationCount.textContent = p.oxygen <= 0 ? Math.max(0, 3 - p.suffocating).toFixed(1) : '';
    var depth = Math.max(0, Math.round((p.y - game.boat.y) * 20));
    depthValue.textContent = depth + ' m';
    zoneValue.textContent = zoneAt(p.y, p.x);
    haulValue.textContent = p.inventory.length + ' / ' + GameAPI.CONST.INVENTORY_SLOTS;
    timeValue.textContent = formatTime(game.time);
    depthMarker.style.top = Math.min(100, depth / 1200 * 100) + '%';
    updateCrewHUD(game.teammates[0], guardIntent, guardOxygen);
    updateCrewHUD(game.teammates[1], salvagerIntent, salvagerOxygen);
    var score = 0;
    for (var i = 0; i < p.inventory.length; i++) score += p.inventory[i].value * 100;
    scorePreview.textContent = score + ' PTS';
    updateInventory(p.inventory);
    var staminaRatio=Math.max(0,p.stamina/p.staminaMax);
    staminaFill.style.transform='scaleX('+staminaRatio+')';
    staminaFill.style.background=staminaRatio<.2?COLORS.danger:'';
    staminaValue.textContent=Math.ceil(p.stamina);
  }

  function updateCrewHUD(teammate, intentNode, oxygenNode) {
    if (!teammate) return;
    var article = intentNode.closest('article');
    article.classList.toggle('lost', !teammate.alive);
    intentNode.textContent = teammate.alive ? teammate.intent : '信号失联';
    oxygenNode.style.transform = 'scaleX(' + Math.max(0, teammate.oxygen / 100) + ')';
  }

  function updateInventory(items) {
    if (!inventorySlots.children.length) {
      for (var i = 0; i < GameAPI.CONST.INVENTORY_SLOTS; i++) inventorySlots.appendChild(document.createElement('i'));
    }
    for (var j = 0; j < inventorySlots.children.length; j++) {
      var slot = inventorySlots.children[j];
      var item = items[j];
      slot.className = item ? 'filled ' + item.rarity : '';
      slot.title = item ? (RARITY_NAMES[item.rarity] || item.rarity) + '宝物' : '空槽位';
    }
  }

  function formatTime(seconds) {
    var minutes = Math.floor(seconds / 60);
    var remain = Math.floor(seconds % 60);
    return (minutes < 10 ? '0' : '') + minutes + ':' + (remain < 10 ? '0' : '') + remain;
  }

  function concludeRun() {
    concluded = true;
    showRunUI(false);
    var result = game.result || {};
    var won = game.state === 'won';
    document.getElementById('resultKicker').textContent = won ? 'DIVE COMPLETE' : 'DIVE LOST';
    document.getElementById('resultTitle').textContent = won ? '成功返航' : (FAILURE_NAMES[game.reason] || ['任务失败'])[0];
    document.getElementById('resultReason').textContent = won ? '船舱封闭，打捞物与生还队员已完成清点。' : (FAILURE_NAMES[game.reason] || ['', '深海终止了本次任务。'])[1];
    var stats = document.getElementById('resultStats');
    stats.innerHTML = won
      ? '<span><small>总分</small><b>' + result.score + '</b></span><span><small>宝物价值</small><b>' + result.treasureValue + '</b></span><span><small>返航队友</small><b>' + result.extractedTeammates + ' / 2</b></span>'
      : '<span><small>潜航时间</small><b>' + formatTime(game.time) + '</b></span><span><small>已拾宝物</small><b>' + game.player.inventory.length + '</b></span><span><small>装备作废</small><b>' + (result.gearFound ? result.gearFound.length : 0) + '</b></span>';
    var gearWrap = document.getElementById('resultGear');
    gearWrap.innerHTML = '';
    if (won && result.gearFound && result.gearFound.length) {
      result.gearFound.forEach(function (gear) {
        if (unlockedGear.indexOf(gear.id) === -1) unlockedGear.push(gear.id);
        var chip = document.createElement('span');
        chip.style.color = RARITY_COLORS[gear.rarity] || COLORS.cyan;
        chip.textContent = (RARITY_NAMES[gear.rarity] || '') + '装备 · ' + gear.name;
        gearWrap.appendChild(chip);
      });
      saveUnlockedGear(unlockedGear);
    } else {
      var empty = document.createElement('span');
      empty.textContent = won ? '本次未回收到新装备' : '失败后装备无法带回局外仓库';
      gearWrap.appendChild(empty);
    }
    if (won) saveBestScore(result.score || 0);
    renderArchive();
    resultScreen.hidden = false;
  }

  function togglePause(force) {
    if (!game || game.state !== 'playing') return;
    paused = typeof force === 'boolean' ? force : !paused;
    pauseScreen.hidden = !paused;
  }

  function waterColorForRow(row) {
    var ratio = row / terrain.rows;
    if (ratio < .25) return COLORS.waterTop;
    if (ratio < .58) return COLORS.waterMid;
    if (ratio < .86) return COLORS.waterDeep;
    return COLORS.waterCore;
  }

  function drawWorld() {
    var ts = terrain.tileSize;
    var offsetX = viewWidth / 2 - camera.x;
    var offsetY = viewHeight / 2 - camera.y;
    var minX = Math.max(0, Math.floor(-offsetX / ts) - 1);
    var maxX = Math.min(terrain.cols - 1, Math.ceil((viewWidth - offsetX) / ts) + 1);
    var minY = Math.max(0, Math.floor(-offsetY / ts) - 1);
    var maxY = Math.min(terrain.rows - 1, Math.ceil((viewHeight - offsetY) / ts) + 1);
    var screenGradient = ctx.createLinearGradient(0, 0, 0, viewHeight);
    screenGradient.addColorStop(0, COLORS.waterTop);screenGradient.addColorStop(.55, COLORS.waterDeep);screenGradient.addColorStop(1, COLORS.waterCore);
    ctx.fillStyle = screenGradient;ctx.fillRect(0, 0, viewWidth, viewHeight);
    ctx.save();ctx.translate(offsetX, offsetY);
    for (var y = minY; y <= maxY; y++) {
      for (var x = minX; x <= maxX; x++) drawTerrainCell(x, y, ts);
    }
    ctx.save();ctx.globalCompositeOperation='screen';drawLightShafts();ctx.restore();
    drawRockEdges(minX, maxX, minY, maxY, ts);
    drawCoralDecor(minX, maxX, minY, maxY, ts);
    drawMotes();
    drawFishSchools();
    drawJellies();
    drawSharkNests();
    drawHazards();
    drawCollectibles();
    drawBoat();
    drawSharks();
    drawActors();
    drawParticles();
    ctx.restore();
    drawDarkness();
    drawLootAfterglow();
    drawSonarPulse();
    drawBoatPrompt();
    drawBoatIndicator();
    drawEdgeWarnings();
  }

  function drawLightShafts() {
    var ts = terrain.tileSize;
    for (var i = 0; i < decor.shafts.length; i++) {
      var shaft = decor.shafts[i];
      var x = shaft.x * ts;
      var gradient = ctx.createLinearGradient(x, 0, x + shaft.lean * 700, 16 * ts);
      gradient.addColorStop(0, 'rgba(170,235,220,' + shaft.alpha + ')');
      gradient.addColorStop(1, 'rgba(170,235,220,0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();ctx.moveTo(x, 0);ctx.lineTo(x + shaft.width * ts, 0);ctx.lineTo(x + shaft.width * ts + shaft.lean * 700, 17 * ts);ctx.lineTo(x + shaft.lean * 700, 17 * ts);ctx.closePath();ctx.fill();
    }
  }

  function drawTerrainCell(x, y, ts) {
    var tile = terrain.grid[y][x];
    var px = x * ts, py = y * ts;
    if (tile === TerrainAPI.TILE.ROCK) {
      ctx.fillStyle = cellNoise(x, y, 1) > .52 ? COLORS.rock : COLORS.rockDark;
      ctx.fillRect(px, py, ts + 1, ts + 1);
      if (cellNoise(x, y, 4) > .74) {
        ctx.fillStyle = 'rgba(111,141,129,.08)';ctx.beginPath();ctx.ellipse(px + ts * cellNoise(x, y, 5), py + ts * cellNoise(x, y, 6), 5 + cellNoise(x, y, 7) * 13, 3 + cellNoise(x, y, 8) * 7, cellNoise(x, y, 9) * Math.PI, 0, Math.PI * 2);ctx.fill();
      }
    } else {
      ctx.fillStyle = waterColorForRow(y);ctx.fillRect(px, py, ts + 1, ts + 1);
      if (tile === TerrainAPI.TILE.WRECK) drawWreckFloor(px, py, ts, x, y);
      if (tile === TerrainAPI.TILE.GATE) drawGate(px, py, ts);
    }
  }

  function drawWreckFloor(px, py, ts, x, y) {
    var n = cellNoise(x, y, 21);
    ctx.fillStyle = n > .5 ? 'rgba(49,77,89,.46)' : 'rgba(23,47,62,.62)';ctx.fillRect(px + 2, py + 2, ts - 4, ts - 4);
    ctx.strokeStyle = n > .5 ? 'rgba(168,94,73,.48)' : 'rgba(110,144,146,.42)';ctx.lineWidth = 1.2;ctx.beginPath();
    if (n > .45) { ctx.moveTo(px + 4, py + ts * .28);ctx.lineTo(px + ts - 4, py + ts * .28);ctx.moveTo(px + 4, py + ts * .72);ctx.lineTo(px + ts - 4, py + ts * .72); }
    else { ctx.moveTo(px + ts * .34, py + 4);ctx.lineTo(px + ts * .34, py + ts - 4);ctx.moveTo(px + ts * .72, py + 4);ctx.lineTo(px + ts * .72, py + ts - 4); }
    ctx.stroke();
    if (n > .79) { ctx.fillStyle = COLORS.rust;ctx.globalAlpha = .28;ctx.beginPath();ctx.arc(px + ts * .7, py + ts * .38, 5, 0, Math.PI * 2);ctx.fill();ctx.globalAlpha = 1; }
  }

  function drawGate(px, py, ts) {
    ctx.fillStyle = COLORS.wreckDark;ctx.fillRect(px + 3, py + 1, ts - 6, ts - 2);
    ctx.strokeStyle = COLORS.cyan;ctx.globalAlpha = .48;ctx.lineWidth = 2;
    for (var i = 0; i < 4; i++) { var gx = px + 8 + i * 9;ctx.beginPath();ctx.moveTo(gx, py + 4);ctx.lineTo(gx, py + ts - 4);ctx.stroke(); }
    ctx.globalAlpha = 1;
  }

  function drawRockEdges(minX, maxX, minY, maxY, ts) {
    ctx.strokeStyle = COLORS.rockEdge;ctx.lineWidth = 4;ctx.lineCap = 'round';ctx.globalAlpha = .52;
    for (var y = minY; y <= maxY; y++) for (var x = minX; x <= maxX; x++) {
      if (terrain.grid[y][x] !== TerrainAPI.TILE.ROCK) continue;
      var px = x * ts, py = y * ts;
      if (TerrainAPI.isPassable(terrain, x, y - 1, true)) edge(px, py, px + ts, py, x, y, 1);
      if (TerrainAPI.isPassable(terrain, x, y + 1, true)) edge(px, py + ts, px + ts, py + ts, x, y, 2);
      if (TerrainAPI.isPassable(terrain, x - 1, y, true)) edge(px, py, px, py + ts, x, y, 3);
      if (TerrainAPI.isPassable(terrain, x + 1, y, true)) edge(px + ts, py, px + ts, py + ts, x, y, 4);
    }
    ctx.globalAlpha = 1;
    function edge(x1, y1, x2, y2, tx, ty, salt) {
      var n = (cellNoise(tx, ty, salt + 30) - .5) * 5;ctx.beginPath();ctx.moveTo(x1 + n, y1);ctx.quadraticCurveTo((x1 + x2) / 2 - n, (y1 + y2) / 2 + n, x2 - n, y2);ctx.stroke();
    }
  }

  function drawCoralDecor(minX, maxX, minY, maxY, ts) {
    ctx.lineCap = 'round';
    for (var y = minY; y <= Math.min(maxY, 22); y++) for (var x = minX; x <= maxX; x++) {
      if (terrain.grid[y][x] !== TerrainAPI.TILE.ROCK || cellNoise(x, y, 60) < .78) continue;
      var openBelow = TerrainAPI.isPassable(terrain, x, y + 1, true);
      var openSide = TerrainAPI.isPassable(terrain, x + 1, y, true) || TerrainAPI.isPassable(terrain, x - 1, y, true);
      if (!openBelow && !openSide) continue;
      var cx = x * ts + ts * cellNoise(x, y, 61), cy = y * ts + ts * .75;
      ctx.strokeStyle = cellNoise(x, y, 62) > .5 ? '#d17568' : '#61a78e';ctx.globalAlpha = .42;ctx.lineWidth = 2;
      for (var branch = 0; branch < 3; branch++) { ctx.beginPath();ctx.moveTo(cx, cy);ctx.quadraticCurveTo(cx + (branch - 1) * 7, cy - 8, cx + (branch - 1) * 11, cy - 16 - branch * 3);ctx.stroke(); }
      ctx.globalAlpha = 1;
    }
  }

  function drawMotes() {
    for (var i = 0; i < decor.motes.length; i++) {
      var mote = decor.motes[i];ctx.fillStyle = mote.y > terrain.rows*.68 ? 'rgba(91,206,207,.2)' : 'rgba(188,221,204,.16)';ctx.beginPath();ctx.arc(mote.x * terrain.tileSize, mote.y * terrain.tileSize, mote.size * terrain.tileSize, 0, Math.PI * 2);ctx.fill();
    }
  }

  function drawFishSchools() {
    for (var i = 0; i < decor.fishSchools.length; i++) {
      var school = decor.fishSchools[i];ctx.fillStyle = school.color;
      for (var f = 0; f < school.count; f++) {
        var spreadX = Math.sin(f * 2.37 + school.phase) * school.spread * terrain.tileSize;
        var spreadY = Math.cos(f * 1.71 + school.phase) * school.spread * .45 * terrain.tileSize;
        var fishX=school.x+spreadX/terrain.tileSize,fishY=school.y+spreadY/terrain.tileSize;
        if(isPassableTile(fishX,fishY))drawFish(fishX*terrain.tileSize,fishY*terrain.tileSize,school.angle,4+f%3);
      }
    }
  }

  function drawFish(x, y, angle, size) {
    ctx.save();ctx.translate(x, y);ctx.rotate(angle);ctx.beginPath();ctx.ellipse(0, 0, size * 1.5, size * .6, 0, 0, Math.PI * 2);ctx.fill();ctx.beginPath();ctx.moveTo(-size, 0);ctx.lineTo(-size * 2, -size);ctx.lineTo(-size * 2, size);ctx.closePath();ctx.fill();ctx.restore();
  }

  function drawJellies() {
    for (var i = 0; i < decor.jellies.length; i++) {
      var jelly = decor.jellies[i];var bob = reducedMotion ? 0 : Math.sin(elapsed * 1.2 + jelly.phase) * 6;var x = jelly.x * terrain.tileSize, y = jelly.y * terrain.tileSize + bob;var size = jelly.size * terrain.tileSize;
      ctx.fillStyle = jelly.hue;ctx.globalAlpha = .18;ctx.beginPath();ctx.arc(x, y, size, Math.PI, 0);ctx.quadraticCurveTo(x, y + size * .7, x - size, y);ctx.fill();ctx.strokeStyle = jelly.hue;ctx.globalAlpha = .28;ctx.lineWidth = 1;
      for (var t = -1; t <= 1; t++) { ctx.beginPath();ctx.moveTo(x + t * size * .45, y + 2);ctx.quadraticCurveTo(x + t * size * .7 + Math.sin(elapsed + i) * 3, y + size, x + t * size * .4, y + size * 1.7);ctx.stroke(); }
      ctx.globalAlpha = 1;
    }
  }

  function drawSharkNests(){
    for(var i=0;i<game.sharks.length;i++){
      var shark=game.sharks[i],center=actorWorld(shark.home);ctx.save();ctx.translate(center.x,center.y);ctx.fillStyle='rgba(2,9,14,.72)';ctx.strokeStyle='rgba(238,117,109,.35)';ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,0,27,Math.PI,0);ctx.quadraticCurveTo(0,13,-27,0);ctx.fill();ctx.stroke();ctx.globalAlpha=.45;
      for(var c=0;c<4;c++){ctx.beginPath();ctx.moveTo(-18+c*11,2);ctx.lineTo(-23+c*13,15+c%2*6);ctx.stroke();}
      ctx.globalAlpha=1;ctx.fillStyle=COLORS.danger;ctx.beginPath();ctx.arc(0,4,3,0,Math.PI*2);ctx.fill();ctx.restore();
    }
  }

  function drawHazards() {
    for (var i = 0; i < game.vortices.length; i++) drawVortex(game.vortices[i], i);
    for (var w = 0; w < game.seaweed.length; w++) if (!game.seaweed[w].consumed) drawSeaweed(game.seaweed[w], w);
    for (var m = 0; m < game.mines.length; m++) if (!game.mines[m].triggered) drawMine(game.mines[m], m);
  }

  function drawVortex(vortex, index) {
    var center=actorWorld(vortex),radius=vortex.radius*terrain.tileSize,phase=reducedMotion ? .2 : elapsed*.7*(vortex.spin||1)+index;
    ctx.save();ctx.translate(center.x,center.y);
    var wash=ctx.createRadialGradient(0,0,4,0,0,radius);wash.addColorStop(0,'rgba(82,155,181,.2)');wash.addColorStop(.62,'rgba(82,155,181,.08)');wash.addColorStop(1,'rgba(82,155,181,0)');ctx.fillStyle=wash;ctx.beginPath();ctx.arc(0,0,radius,0,Math.PI*2);ctx.fill();
    ctx.rotate(phase);ctx.strokeStyle='#79b6cb';ctx.lineCap='round';
    for(var r=0;r<5;r++){var rr=radius*(.18+r*.16);ctx.globalAlpha=.5-r*.055;ctx.lineWidth=3-r*.35;ctx.beginPath();ctx.arc(0,0,rr,r*.72,r*.72+Math.PI*1.28);ctx.stroke();}
    ctx.globalAlpha=.8;ctx.fillStyle='#8cc9d8';ctx.beginPath();ctx.arc(0,0,5,0,Math.PI*2);ctx.fill();ctx.strokeStyle='rgba(190,234,239,.65)';ctx.lineWidth=1;ctx.beginPath();ctx.arc(0,0,13,0,Math.PI*2);ctx.stroke();
    ctx.restore();ctx.globalAlpha=1;
  }

  function drawSeaweed(weed, index) {
    var center=actorWorld(weed),direction=weedGrowthDirection(weed),px=-direction.y,py=direction.x;ctx.strokeStyle=COLORS.weed;ctx.lineCap='round';
    for(var i=0;i<10;i++){var offset=(i-4.5)*3.2,sway=reducedMotion?0:Math.sin(elapsed*1.55+i*.8+index)*6;var length=28+i%4*7;var rx=center.x+px*offset,ry=center.y+py*offset;ctx.globalAlpha=.5+i%3*.09;ctx.lineWidth=2+i%2;ctx.beginPath();ctx.moveTo(rx,ry);ctx.quadraticCurveTo(rx+direction.x*length*.52+px*sway,ry+direction.y*length*.52+py*sway,rx+direction.x*length-px*sway*.25,ry+direction.y*length-py*sway*.25);ctx.stroke();}
    ctx.globalAlpha=1;
  }

  function weedGrowthDirection(weed){
    var x=Math.floor(weed.x),y=Math.floor(weed.y),dirs=[[1,0],[-1,0],[0,1],[0,-1]];
    for(var i=0;i<dirs.length;i++)if(TerrainAPI.isPassable(terrain,x+dirs[i][0],y+dirs[i][1],true))return{x:dirs[i][0],y:dirs[i][1]};
    return{x:0,y:-1};
  }

  function drawMine(mine,index){
    var center=actorWorld(mine),pulse=reducedMotion?0:Math.sin(elapsed*2+index)*1.5;ctx.save();ctx.translate(center.x,center.y);ctx.strokeStyle='#9aaca9';ctx.fillStyle='#263a40';ctx.lineWidth=2;
    for(var i=0;i<8;i++){var angle=i/8*Math.PI*2;ctx.beginPath();ctx.moveTo(Math.cos(angle)*11,Math.sin(angle)*11);ctx.lineTo(Math.cos(angle)*(18+pulse),Math.sin(angle)*(18+pulse));ctx.stroke();}
    ctx.beginPath();ctx.arc(0,0,12,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle=COLORS.danger;ctx.globalAlpha=.72;ctx.beginPath();ctx.arc(3,-3,3,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;ctx.restore();
  }

  function drawCollectibles() {
    for (var i = 0; i < game.oxygenPickups.length; i++) if (!game.oxygenPickups[i].collected) drawOxygen(game.oxygenPickups[i], i);
    for (var t = 0; t < game.treasures.length; t++) if (!game.treasures[t].collected) drawTreasure(game.treasures[t], t);
    for (var g = 0; g < game.gear.length; g++) if (!game.gear[g].collected) drawGear(game.gear[g], g);
  }

  function drawOxygen(point, index) {
    var center = actorWorld(point);ctx.strokeStyle = COLORS.oxygen;ctx.fillStyle = COLORS.oxygen;
    for (var i = 0; i < 6; i++) { var phase = reducedMotion ? i * 5 : (elapsed * 15 + index * 17 + i * 9) % 38;var bx = center.x + Math.sin(i * 2.2 + index) * 13;var by = center.y + 18 - phase;ctx.globalAlpha = .35 + i * .07;ctx.beginPath();ctx.arc(bx, by, 2 + i % 3, 0, Math.PI * 2);ctx.stroke(); }
    ctx.globalAlpha = .12;ctx.beginPath();ctx.arc(center.x, center.y, 28, 0, Math.PI * 2);ctx.fill();ctx.globalAlpha = 1;
  }

  function drawTreasure(item, index) {
    var center=actorWorld(item),color=RARITY_COLORS[item.rarity]||COLORS.amber,pulse=reducedMotion?1:.9+Math.sin(elapsed*2.1+index)*.1,glow=item.rarity==='legendary'?42:item.rarity==='epic'?34:25;drawGlow(center.x,center.y,color,glow*pulse,item.rarity==='common'?.13:.25);ctx.fillStyle='#242c2b';ctx.fillRect(center.x-12,center.y-8,24,17);ctx.fillStyle=color;ctx.globalAlpha=.88;ctx.fillRect(center.x-11,center.y-7,22,4);ctx.fillRect(center.x-2,center.y-2,4,7);ctx.globalAlpha=1;
    for(var s=0;s<3;s++){var angle=elapsed*.35+index+s*Math.PI*2/3,dist=16+s*4;ctx.fillStyle=color;ctx.globalAlpha=.28+s*.08;ctx.beginPath();ctx.arc(center.x+Math.cos(angle)*dist,center.y+Math.sin(angle)*dist,1.2+s*.25,0,Math.PI*2);ctx.fill();}ctx.globalAlpha=1;
  }

  function drawGear(item, index) {
    var center = actorWorld(item);var color = RARITY_COLORS[item.rarity] || COLORS.cyan;var pulse = reducedMotion ? 1 : .8 + Math.sin(elapsed * 2 + index) * .2;drawGlow(center.x, center.y, color, 38 * pulse, .42);ctx.save();ctx.translate(center.x,center.y);ctx.rotate(reducedMotion ? 0 : elapsed * .25 + index);ctx.strokeStyle = color;ctx.lineWidth = 2;ctx.beginPath();for(var i=0;i<6;i++){var angle=i/6*Math.PI*2;var x=Math.cos(angle)*12,y=Math.sin(angle)*12;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.closePath();ctx.stroke();ctx.beginPath();ctx.arc(0,0,4,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();ctx.restore();
  }

  function drawGlow(x, y, color, radius, alpha) {
    var gradient = ctx.createRadialGradient(x,y,1,x,y,radius);gradient.addColorStop(0,color);gradient.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=gradient;ctx.globalAlpha=alpha;ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;
  }

  function drawBoat() {
    var center=actorWorld(game.boat);ctx.save();ctx.translate(center.x,center.y-10);ctx.fillStyle=COLORS.wreck;ctx.strokeStyle=COLORS.cyan;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-68,-20);ctx.quadraticCurveTo(-33,-40,42,-25);ctx.quadraticCurveTo(70,-8,45,18);ctx.quadraticCurveTo(-20,28,-68,10);ctx.closePath();ctx.fill();ctx.stroke();ctx.fillStyle=COLORS.metal;ctx.fillRect(-13,-20,31,21);ctx.fillStyle='#0a2028';ctx.strokeStyle=COLORS.amber;ctx.lineWidth=2;ctx.fillRect(-7,-14,18,25);ctx.strokeRect(-7,-14,18,25);ctx.fillStyle=COLORS.oxygen;ctx.globalAlpha=.72;ctx.fillRect(-3,-9,10,5);ctx.restore();ctx.globalAlpha=1;
  }

  function drawSharks() {
    for (var i = 0; i < game.sharks.length; i++) {
      var shark=game.sharks[i];if(!shark.alive)continue;var center=actorWorld(shark),chase=shark.aiState==='chase'||shark.aiState==='drag';
      if(shark.dragTarget){var targetCenter=actorWorld(shark.dragTarget);ctx.strokeStyle='rgba(238,117,109,.58)';ctx.lineWidth=2;ctx.setLineDash([4,5]);ctx.beginPath();ctx.moveTo(center.x,center.y);ctx.lineTo(targetCenter.x,targetCenter.y);ctx.stroke();ctx.setLineDash([]);}
      ctx.save();ctx.translate(center.x,center.y);ctx.rotate(shark.faceAngle||0);var body=ctx.createLinearGradient(-28,-12,24,12);body.addColorStop(0,chase?'#6f3840':'#415d67');body.addColorStop(1,chase?'#b25a58':'#78909a');ctx.fillStyle=body;
      ctx.beginPath();ctx.moveTo(31,0);ctx.quadraticCurveTo(19,-13,-8,-12);ctx.quadraticCurveTo(-27,-10,-34,-4);ctx.lineTo(-43,-15);ctx.lineTo(-40,-2);ctx.lineTo(-50,0);ctx.lineTo(-40,2);ctx.lineTo(-43,15);ctx.lineTo(-34,4);ctx.quadraticCurveTo(-18,13,8,10);ctx.quadraticCurveTo(24,8,31,0);ctx.fill();
      ctx.fillStyle=chase?'#763d44':'#526f78';ctx.beginPath();ctx.moveTo(-5,-10);ctx.lineTo(-15,-28);ctx.lineTo(8,-11);ctx.closePath();ctx.fill();ctx.beginPath();ctx.moveTo(2,8);ctx.lineTo(-8,22);ctx.lineTo(13,8);ctx.closePath();ctx.fill();
      ctx.strokeStyle='rgba(220,238,235,.42)';ctx.lineWidth=1.4;for(var g=0;g<3;g++){ctx.beginPath();ctx.moveTo(11-g*4,-7);ctx.lineTo(8-g*4,1);ctx.stroke();}
      ctx.fillStyle='#e3f1ed';ctx.beginPath();ctx.arc(20,-4,2.1,0,Math.PI*2);ctx.fill();ctx.fillStyle='#071117';ctx.beginPath();ctx.arc(20,-4,1,0,Math.PI*2);ctx.fill();ctx.strokeStyle='rgba(238,117,109,.75)';ctx.beginPath();ctx.arc(26,3,6,.15,Math.PI-.15);ctx.stroke();ctx.restore();ctx.globalAlpha=1;
    }
  }

  function drawActors() {
    drawDiver(game.teammates[0], COLORS.coral, '余烬', 'guard');
    drawDiver(game.teammates[1], COLORS.cyan, '灰鳍', 'salvager');
    drawDiver(game.player, COLORS.amber, '你', 'player');
  }

  function drawDiver(actor, color, label, role) {
    if (!actor || actor.alive === false) return;
    var center=actorWorld(actor);
    var phase=elapsed*4+(role==='player'?0:role==='guard'?1.8:3.7);
    var bob=reducedMotion?0:Math.sin(phase)*1.5;
    var angle=actor.faceAngle||0;
    var lookX=Math.cos(angle),lookY=Math.sin(angle);
    if(Math.abs(lookX)>.18)actor.renderFacing=lookX<0?-1:1;
    var facing=actor.renderFacing||1;
    var kick=reducedMotion?0:Math.sin(phase)*3;
    var handX=lookX*15,handY=lookY*12-1;
    ctx.save();ctx.translate(center.x,center.y+bob);
    if(role==='player'){
      ctx.strokeStyle='rgba(217,189,108,.48)';ctx.lineWidth=1.5;ctx.setLineDash([3,5]);ctx.beginPath();ctx.ellipse(0,4,22,29,0,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
    }
    ctx.strokeStyle='#071722';ctx.lineWidth=5;ctx.lineCap='round';
    ctx.beginPath();ctx.moveTo(-5,10);ctx.lineTo(-8+kick,23);ctx.moveTo(5,10);ctx.lineTo(8-kick,23);ctx.stroke();
    ctx.fillStyle=color;
    ctx.beginPath();ctx.moveTo(-8+kick,20);ctx.lineTo(-19+kick,25);ctx.lineTo(-7+kick,27);ctx.closePath();ctx.fill();
    ctx.beginPath();ctx.moveTo(8-kick,20);ctx.lineTo(19-kick,25);ctx.lineTo(7-kick,27);ctx.closePath();ctx.fill();
    ctx.fillStyle='#365a64';ctx.fillRect(-facing*13-4,-6,8,20);
    ctx.fillStyle=color;ctx.strokeStyle='#06151f';ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(-9,-6);ctx.quadraticCurveTo(-12,7,-7,14);ctx.lineTo(7,14);ctx.quadraticCurveTo(12,7,9,-6);ctx.closePath();ctx.fill();ctx.stroke();
    ctx.strokeStyle=color;ctx.lineWidth=4;
    ctx.beginPath();ctx.moveTo(facing*5,-1);ctx.lineTo(handX,handY);ctx.stroke();
    ctx.beginPath();ctx.moveTo(-facing*5,0);ctx.lineTo(-facing*11,8);ctx.stroke();
    ctx.fillStyle='#0c2631';ctx.strokeStyle=color;ctx.lineWidth=2;
    ctx.beginPath();ctx.arc(0,-13,9,0,Math.PI*2);ctx.fill();ctx.stroke();
    ctx.fillStyle='#86d7d0';ctx.globalAlpha=.78;
    ctx.beginPath();ctx.ellipse(facing*3.5,-14,4.8,5.2,0,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;
    ctx.strokeStyle='#9ff5e8';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(handX,handY);ctx.lineTo(handX+lookX*7,handY+lookY*7);ctx.stroke();
    ctx.fillStyle=COLORS.oxygen;ctx.beginPath();ctx.arc(handX+lookX*7,handY+lookY*7,2.4,0,Math.PI*2);ctx.fill();
    ctx.restore();
    ctx.font='800 10px "Avenir Next",sans-serif';ctx.textAlign='center';ctx.fillStyle=color;ctx.fillText(label,center.x,center.y-34);
    if(actor.draggedBy||actor.inNest){ctx.fillStyle=COLORS.danger;ctx.font='800 9px Consolas,monospace';ctx.fillText(actor.inNest?'等待救援':'被拖拽',center.x,center.y+43);}
    if(actor.bleeding>0)drawBleeding(center,role);
  }

  function drawBleeding(center,role){
    for(var i=0;i<6;i++){var drift=(elapsed*13+i*11)%34,side=Math.sin(i*2.4+elapsed)*10;ctx.fillStyle=COLORS.danger;ctx.globalAlpha=.18+i*.055;ctx.beginPath();ctx.arc(center.x+side,center.y+10+drift,1.3+i%2,0,Math.PI*2);ctx.fill();}ctx.globalAlpha=1;
  }

  function drawParticles() {
    for(var i=0;i<particles.length;i++){var p=particles[i];var center=actorWorld(p);ctx.globalAlpha=Math.max(0,1-p.t/p.life);ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(center.x,center.y,p.size,0,Math.PI*2);ctx.fill();}ctx.globalAlpha=1;
    for(var j=0;j<shockwaves.length;j++){var wave=shockwaves[j];var c=actorWorld(wave);var ratio=wave.t/wave.life;ctx.strokeStyle=wave.color;ctx.globalAlpha=1-ratio;ctx.lineWidth=3;ctx.beginPath();ctx.arc(c.x,c.y,20+ratio*90,0,Math.PI*2);ctx.stroke();}ctx.globalAlpha=1;
  }

  function drawDarkness() {
    if (!lightCtx) return;
    var p=game.player;
    var playerScreen=screenPoint(actorWorld(p));
    var depthRatio=Math.max(0,Math.min(1,p.y/terrain.rows));
    var opacity=.46+depthRatio*.23;
    lightCtx.setTransform(dpr,0,0,dpr,0,0);
    lightCtx.clearRect(0,0,viewWidth,viewHeight);
    lightCtx.save();
    lightCtx.globalCompositeOperation='source-over';
    lightCtx.fillStyle='rgba(0,5,14,'+opacity+')';
    lightCtx.fillRect(0,0,viewWidth,viewHeight);
    lightCtx.globalCompositeOperation='destination-out';
    clearLight(lightCtx,playerScreen,p.faceAngle,124,370+(p.lampRangeBonus||0),.5,1);
    for(var i=0;i<game.teammates.length;i++){
      var mate=game.teammates[i];if(!mate.alive)continue;
      var mateScreen=screenPoint(actorWorld(mate));
      clearLight(lightCtx,mateScreen,mate.faceAngle,82,235,.43,.9);
    }
    for(var t=0;t<game.treasures.length;t++){
      var treasure=game.treasures[t];if(treasure.collected)continue;
      var treasureScreen=screenPoint(actorWorld(treasure));
      var rarity=treasure.rarity==='legendary' ? .44 : treasure.rarity==='epic' ? .34 : treasure.rarity==='rare' ? .27 : .19;
      clearPointLight(lightCtx,treasureScreen,treasure.rarity==='legendary'?38:treasure.rarity==='epic'?32:24,rarity);
    }
    lightCtx.restore();
    ctx.drawImage(lightCanvas,0,0,lightCanvas.width,lightCanvas.height,0,0,viewWidth,viewHeight);
    drawLampFlare(playerScreen,p.faceAngle);
  }

  function clearLight(targetCtx, pos, angle, ambientRadius, beamLength, spread, strength) {
    var ambient=targetCtx.createRadialGradient(pos.x,pos.y,8,pos.x,pos.y,ambientRadius);ambient.addColorStop(0,'rgba(0,0,0,'+strength+')');ambient.addColorStop(.58,'rgba(0,0,0,'+(strength*.76)+')');ambient.addColorStop(1,'rgba(0,0,0,0)');targetCtx.fillStyle=ambient;targetCtx.beginPath();targetCtx.arc(pos.x,pos.y,ambientRadius,0,Math.PI*2);targetCtx.fill();targetCtx.save();targetCtx.beginPath();targetCtx.moveTo(pos.x,pos.y);targetCtx.arc(pos.x,pos.y,beamLength,angle-spread,angle+spread);targetCtx.closePath();targetCtx.clip();var beam=targetCtx.createRadialGradient(pos.x,pos.y,18,pos.x,pos.y,beamLength);beam.addColorStop(0,'rgba(0,0,0,'+strength+')');beam.addColorStop(.68,'rgba(0,0,0,'+(strength*.88)+')');beam.addColorStop(1,'rgba(0,0,0,0)');targetCtx.fillStyle=beam;targetCtx.fillRect(pos.x-beamLength,pos.y-beamLength,beamLength*2,beamLength*2);targetCtx.restore();
  }

  function clearPointLight(targetCtx,pos,radius,strength){
    var glow=targetCtx.createRadialGradient(pos.x,pos.y,2,pos.x,pos.y,radius);glow.addColorStop(0,'rgba(0,0,0,'+strength+')');glow.addColorStop(.45,'rgba(0,0,0,'+(strength*.58)+')');glow.addColorStop(1,'rgba(0,0,0,0)');targetCtx.fillStyle=glow;targetCtx.beginPath();targetCtx.arc(pos.x,pos.y,radius,0,Math.PI*2);targetCtx.fill();
  }

  function drawLootAfterglow(){
    for(var i=0;i<game.treasures.length;i++){
      var item=game.treasures[i];if(item.collected)continue;var pos=screenPoint(actorWorld(item));if(pos.x<-20||pos.y<-20||pos.x>viewWidth+20||pos.y>viewHeight+20)continue;var color=RARITY_COLORS[item.rarity]||COLORS.amber,twinkle=reducedMotion?1:.72+Math.sin(elapsed*2.4+i)*.28;ctx.strokeStyle=color;ctx.fillStyle=color;ctx.globalAlpha=.28*twinkle;ctx.lineWidth=1;ctx.beginPath();ctx.arc(pos.x,pos.y,7,0,Math.PI*2);ctx.stroke();ctx.globalAlpha=.5*twinkle;ctx.beginPath();ctx.arc(pos.x,pos.y,1.8,0,Math.PI*2);ctx.fill();
    }ctx.globalAlpha=1;
  }

  function drawLampFlare(pos, angle) {
    var x=pos.x+Math.cos(angle)*17;
    var y=pos.y+Math.sin(angle)*17;
    var glow=ctx.createRadialGradient(x,y,0,x,y,18);
    glow.addColorStop(0,'rgba(220,255,242,.95)');
    glow.addColorStop(.28,'rgba(145,255,231,.55)');
    glow.addColorStop(1,'rgba(145,255,231,0)');
    ctx.fillStyle=glow;ctx.beginPath();ctx.arc(x,y,18,0,Math.PI*2);ctx.fill();
  }

  function drawSonarPulse() {
    if (!game.player.sonarUnlocked || game.state !== 'playing') return;
    var phase=game.time%6;if(phase>1.25)return;var ratio=phase/1.25;var pos=screenPoint(actorWorld(game.player));ctx.strokeStyle=COLORS.cyan;ctx.globalAlpha=(1-ratio)*.65;ctx.lineWidth=2;ctx.beginPath();ctx.arc(pos.x,pos.y,ratio*360,0,Math.PI*2);ctx.stroke();ctx.globalAlpha=(1-ratio)*.75;
    game.treasures.concat(game.gear).forEach(function(item){if(item.collected)return;var screen=screenPoint(actorWorld(item));var dx=screen.x-pos.x,dy=screen.y-pos.y;if(Math.sqrt(dx*dx+dy*dy)<ratio*360+30){ctx.fillStyle=RARITY_COLORS[item.rarity]||COLORS.cyan;ctx.beginPath();ctx.arc(screen.x,screen.y,4,0,Math.PI*2);ctx.fill();}});ctx.globalAlpha=1;
  }

  function drawEdgeWarnings() {
    if (!game || game.state !== 'playing') return;
    var closest=null,closestDist=Infinity;
    for(var i=0;i<game.sharks.length;i++){var shark=game.sharks[i];var dx=shark.x-game.player.x,dy=shark.y-game.player.y;var dist=Math.sqrt(dx*dx+dy*dy);if(dist<closestDist){closest=shark;closestDist=dist;}}
    if(!closest||closestDist>9)return;var alpha=Math.max(0,1-closestDist/9);var gradient=ctx.createRadialGradient(viewWidth/2,viewHeight/2,Math.min(viewWidth,viewHeight)*.25,viewWidth/2,viewHeight/2,Math.max(viewWidth,viewHeight)*.7);gradient.addColorStop(0,'rgba(243,95,98,0)');gradient.addColorStop(1,'rgba(243,95,98,'+(alpha*.28)+')');ctx.fillStyle=gradient;ctx.fillRect(0,0,viewWidth,viewHeight);
  }

  function drawBoatIndicator() {
    if (!game || game.state !== 'playing') return;
    var boatScreen = screenPoint(actorWorld(game.boat));
    if (boatScreen.x > 74 && boatScreen.x < viewWidth - 74 && boatScreen.y > 90 && boatScreen.y < viewHeight - 74) return;
    var center = { x: viewWidth / 2, y: viewHeight / 2 };
    var angle = Math.atan2(boatScreen.y - center.y, boatScreen.x - center.x);
    var marginX = Math.max(94, viewWidth / 2 - 94);
    var marginY = Math.max(90, viewHeight / 2 - 90);
    var scale = Math.min(marginX / Math.max(.001, Math.abs(Math.cos(angle))), marginY / Math.max(.001, Math.abs(Math.sin(angle))));
    var x = center.x + Math.cos(angle) * scale;
    var y = center.y + Math.sin(angle) * scale;
    ctx.save();ctx.translate(x,y);ctx.rotate(angle);ctx.fillStyle=COLORS.amber;ctx.globalAlpha=.88;ctx.beginPath();ctx.moveTo(12,0);ctx.lineTo(-8,-7);ctx.lineTo(-8,7);ctx.closePath();ctx.fill();ctx.restore();ctx.fillStyle=COLORS.amber;ctx.font='800 10px Consolas,monospace';ctx.textAlign='center';ctx.fillText('母船',x,y+20);ctx.globalAlpha=1;
  }

  function drawBoatPrompt(){
    if(!game||game.state!=='playing')return;var dx=game.player.x-game.boat.x,dy=game.player.y-game.boat.y,dist=Math.sqrt(dx*dx+dy*dy);if(dist>GameAPI.CONST.BOAT_INTERACT_RADIUS+1)return;var pos=screenPoint(actorWorld(game.boat)),ready=game.player.inventory.length>0,text=ready?'E 进入船舱 · 完成本次打捞':'需要至少一件宝物';var width=ready?226:158,x=Math.max(12,Math.min(viewWidth-width-12,pos.x-width/2)),y=Math.max(94,Math.min(viewHeight-62,pos.y+38));ctx.fillStyle='rgba(6,23,31,.94)';ctx.fillRect(x,y,width,34);ctx.strokeStyle=ready?COLORS.amber:COLORS.dim;ctx.lineWidth=1;ctx.strokeRect(x+.5,y+.5,width-1,33);ctx.fillStyle=ready?COLORS.amber:COLORS.dim;ctx.font='800 11px "Avenir Next",sans-serif';ctx.textAlign='center';ctx.fillText(text,x+width/2,y+21);
  }

  function screenPoint(world) { return { x:viewWidth/2+world.x-camera.x,y:viewHeight/2+world.y-camera.y }; }

  function render() {
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,viewWidth,viewHeight);drawWorld();
  }

  function frame(time) {
    var dt=lastTime?Math.min(.04,(time-lastTime)/1000):0;lastTime=time;elapsed+=dt;
    if(game&&game.state==='playing')updateGame(dt);else{updateDecor(dt);updateParticles(dt);setCameraToPlayer(false);}
    render();if(!startScreen.hidden)drawTrenchPreview();requestAnimationFrame(frame);
  }

  function setTouchButton(button, active) {
    var move=button.dataset.move,action=button.dataset.action;
    if(move)touchMove[move]=active;if(action)touchAction[action]=active;
  }

  window.addEventListener('resize',resize);
  window.addEventListener('keydown',function(event){
    keys[event.code]=true;
    if(event.code==='KeyP'&&!event.repeat)togglePause();
    if(event.code==='Escape'&&!event.repeat&&game&&game.state==='playing')togglePause();
    if(event.code.indexOf('Arrow')===0||event.code==='Space')event.preventDefault();
  });
  window.addEventListener('keyup',function(event){keys[event.code]=false;});
  window.addEventListener('blur',function(){keys={};touchMove={up:false,down:false,left:false,right:false};touchAction={sprint:false,interact:false};});
  document.querySelectorAll('[data-move],[data-action]').forEach(function(button){
    button.addEventListener('pointerdown',function(event){event.preventDefault();button.setPointerCapture(event.pointerId);setTouchButton(button,true);});
    button.addEventListener('pointerup',function(){setTouchButton(button,false);});
    button.addEventListener('pointercancel',function(){setTouchButton(button,false);});
  });
  startBtn.addEventListener('click',startRun);
  seedBtn.addEventListener('click',function(){makeRun(randomSeed());showToast('已生成新的沉船海沟','');});
  retryBtn.addEventListener('click',restartRun);
  resumeBtn.addEventListener('click',function(){togglePause(false);});
  soundToggle.addEventListener('click',function(){var enabled=AudioSys?AudioSys.toggle():false;soundToggle.textContent=enabled?'SOUND ON':'SOUND OFF';soundToggle.setAttribute('aria-label',enabled?'关闭声音':'开启声音');});

  resize();
  makeRun(randomSeed());
  showRunUI(false);
  updateInventory([]);
  requestAnimationFrame(frame);
})();
