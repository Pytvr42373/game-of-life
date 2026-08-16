/* PAC-MAN 完整版 - 核心引擎 (game.js) 移动/碰撞/计分/状态机/渲染/演出 */
'use strict';
(function(win){
var PAC = win.PAC = win.PAC || {};

PAC.clamp = function(v,a,b){ return v<a?a:(v>b?b:v); };
PAC.mDist = function(r1,c1,r2,c2){ return Math.abs(r1-r2)+Math.abs(c1-c2); };

/* 三档难度参数 */
PAC.DIFF = {
  casual:{ name:'休闲', pac:6.6, ghost:6.0, frightTime:9.0  },
  normal:{ name:'普通', pac:7.4, ghost:6.8, frightTime:6.5  },
  hard:  { name:'硬核', pac:8.0, ghost:7.6, frightTime:5.0  },
};
PAC.FRUIT_SCORES = [100,300,500];

/* ---------- 移动模型: 格子中心逐格平滑移动 (progress-based) ---------- */
PAC.Move = {
  entPos:function(e){ return { x: e.c+(e.pc-e.c)*e.t, y: e.r+(e.pr-e.r)*e.t }; },
  update:function(e, dt){
    if(!e.moving){ if(e.onArrive) e.onArrive(); return; }
    e.t += e.speed*dt;
    if(e.t>=1){ e.t=0; e.r=e.pr; e.c=e.pc; e.moving=false; if(e.onArrive) e.onArrive(); }
  },
  setNext:function(e,nr,nc){ e.pr=nr; e.pc=nc; e.dir={x:nc-e.c,y:nr-e.r}; e.t=0; e.moving=true; },
};

/* ---------- 画刷颜色 (跟随主题 CSS 变量) ---------- */
PAC.palette = function(){
  var s = win.getComputedStyle? win.getComputedStyle(document.body):null;
  function g(n,fb){ if(s){ var v=s.getPropertyValue(n).trim(); if(v) return v; } return fb; }
  return {
    bg: g('--pm-bg','#0b0b1a'), wall: g('--pm-wall','#16206b'), wallEdge: g('--pm-wallEdge','#2a3db0'),
    dot: g('--pm-dot','#ffd166'), pellet: g('--pm-pellet','#ffd166'),
    text: g('--pm-text','#eef'), accent: g('--pm-accent','#ffe14d'),
    house: g('--pm-house','#5b3a7a'), door: g('--pm-door','#ff8fa3'),
  };
};

/* ---------- 迷宫绘制 ---------- */
PAC.drawMaze = function(ctx, maze, ox, oy, ts, time, pal){
  pal = pal || PAC.palette();
  ctx.fillStyle=pal.bg; ctx.fillRect(ox,oy,maze.W*ts,maze.H*ts);
  ctx.fillStyle=pal.wall;
  for(var r=0;r<maze.H;r++)for(var c=0;c<maze.W;c++){
    var t=maze.grid[r][c].t;
    if(t==='wall'){ ctx.fillRect(ox+c*ts,oy+r*ts,ts,ts); }
    else if(t==='house'){ ctx.fillStyle=pal.house; ctx.fillRect(ox+c*ts+1,oy+r*ts+1,ts-2,ts-2); ctx.fillStyle=pal.wall; }
  }
  ctx.fillStyle=pal.wallEdge;
  for(var i=0;i<maze.H;i++)for(var j=0;j<maze.W;j++){
    var tt=maze.grid[i][j].t;
    if(tt==='wall'){
      if(maze.grid[i-1]&&maze.grid[i-1][j].t!=='wall') ctx.fillRect(ox+j*ts,oy+i*ts,ts,2);
      if(maze.grid[i][j-1]&&maze.grid[i][j-1].t!=='wall') ctx.fillRect(ox+j*ts,oy+i*ts,2,ts);
    }
  }
  for(var d=0;d<maze.doorCells.length;d++){
    var dc=maze.doorCells[d];
    ctx.fillStyle=pal.door; ctx.fillRect(ox+dc.c*ts+3, oy+dc.r*ts+ts*0.45, ts-6, Math.max(2,ts*0.12));
  }
  var pulse = 0.5+0.5*Math.sin(time*4);
  for(var r2=0;r2<maze.H;r2++)for(var c2=0;c2<maze.W;c2++){
    var cell=maze.grid[r2][c2];
    var x=ox+c2*ts+ts/2, y=oy+r2*ts+ts/2;
    if(cell.t==='dot'){ ctx.fillStyle=pal.dot; ctx.beginPath(); ctx.arc(x,y,ts*0.14,0,7); ctx.fill(); }
    else if(cell.t==='pellet'){ ctx.fillStyle=pal.pellet; ctx.beginPath(); ctx.arc(x,y,ts*(0.28+0.08*pulse),0,7); ctx.fill(); }
  }
};

/* ---------- 吃豆人绘制 ---------- */
PAC.drawPac = function(ctx, p, ox, oy, ts, time){
  if(!p.alive) return;
  var pos=PAC.Move.entPos(p);
  var x=ox+pos.x*ts, y=oy+pos.y*ts;
  var ang=(p.dir.x||p.dir.y)? Math.atan2(p.dir.y,p.dir.x) : 0;
  var mouth = p.moving? (0.12+0.22*Math.abs(Math.sin(time*13))): 0.14;
  /* 元系统皮肤: P1 按装备皮肤变色/加图案, P2 保持绿色便于区分 */
  var skin = (p.idx===0 && PAC.Meta && PAC.Meta.equippedSkin)? PAC.Meta.equippedSkin() : null;
  var fill = p.idx===1 ? '#7cff6b' : (skin? skin.color : '#ffe14d');
  var pat  = (p.idx===0 && skin)? skin.pattern : 'classic';
  for(var i=0;i<p.trail.length;i++){
    var tr=p.trail[i];
    ctx.globalAlpha=tr.a*0.5; ctx.fillStyle=fill;
    ctx.beginPath(); ctx.arc(tr.x,tr.y,ts*0.42*(tr.a),0,7); ctx.fill();
  }
  ctx.globalAlpha=1;
  var blink = p.invincible>0 && Math.floor(p.invincible*8)%2===0;
  if(blink) ctx.globalAlpha=0.4;
  ctx.save(); ctx.translate(x,y); ctx.rotate(ang);
  ctx.fillStyle = fill;
  ctx.beginPath(); ctx.moveTo(0,0); ctx.arc(0,0,ts*0.46, mouth, Math.PI*2-mouth); ctx.closePath(); ctx.fill();
  if(pat==='neon'){
    ctx.strokeStyle='#ffd23f'; ctx.lineWidth=Math.max(1,ts*0.07);
    ctx.beginPath(); ctx.arc(0,0,ts*0.46, mouth, Math.PI*2-mouth); ctx.stroke();
    ctx.fillStyle='#fff'; ctx.globalAlpha=0.55; ctx.beginPath(); ctx.arc(0,0,ts*0.18,0,7); ctx.fill(); ctx.globalAlpha=1;
  } else if(pat==='ghost'){
    ctx.fillStyle='rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.arc(0,0,ts*0.22,0,7); ctx.fill();
    ctx.fillStyle='rgba(255,255,255,0.18)'; ctx.beginPath(); ctx.arc(0,0,ts*0.34,0,7); ctx.fill();
  } else if(skin && skin.id!=='classic'){
    ctx.fillStyle='rgba(255,255,255,0.28)'; ctx.beginPath(); ctx.arc(0,-ts*0.12,ts*0.12,0,7); ctx.fill();
  }
  if(!p.moving){ ctx.fillStyle='#000'; ctx.beginPath(); ctx.arc(0,-ts*0.1,ts*0.1,0,7); ctx.fill(); }
  ctx.restore(); ctx.globalAlpha=1;
  if(p.stunned>0){
    ctx.fillStyle='#fff'; ctx.font=Math.max(8,ts*0.5)+'px monospace'; ctx.textAlign='center';
    ctx.fillText('~', x, y-ts*0.7);
  }
};

/* ---------- 水果绘制 ---------- */
PAC.drawFruit = function(ctx, type, x, y, r){
  ctx.save(); ctx.translate(x,y);
  if(type===0){
    ctx.fillStyle='#e63946'; ctx.beginPath(); ctx.arc(-r*0.45,0,r*0.5,0,7); ctx.arc(r*0.45,0,r*0.5,0,7); ctx.fill();
    ctx.fillStyle='#f9c74f'; ctx.beginPath(); ctx.arc(-r*0.45,0,r*0.2,0,7); ctx.arc(r*0.45,0,r*0.2,0,7); ctx.fill();
    ctx.strokeStyle='#2a9d8f'; ctx.lineWidth=Math.max(1,r*0.08); ctx.beginPath();
    ctx.moveTo(-r*0.35,-r*0.3); ctx.quadraticCurveTo(0,-r*1.1,r*0.2,-r*1.0); ctx.moveTo(r*0.35,-r*0.3); ctx.quadraticCurveTo(r*0.1,-r*0.9,r*0.25,-r*1.0); ctx.stroke();
  } else if(type===1){
    ctx.fillStyle='#e63946'; ctx.beginPath(); ctx.moveTo(0,r*0.9); ctx.quadraticCurveTo(-r*0.9,r*0.1,-r*0.7,-r*0.4); ctx.quadraticCurveTo(0,-r*1.0,r*0.7,-r*0.4); ctx.quadraticCurveTo(r*0.9,r*0.1,0,r*0.9); ctx.fill();
    ctx.fillStyle='#ffd60a'; for(var i=0;i<8;i++){ var a=i*2.4; ctx.beginPath(); ctx.arc(Math.cos(a)*r*0.35,-r*0.2+Math.sin(a)*r*0.2,r*0.07,0,7); ctx.fill(); }
    ctx.fillStyle='#2a9d8f'; ctx.beginPath(); ctx.ellipse(0,-r*0.9,r*0.28,r*0.5,0,0,7); ctx.fill();
  } else {
    ctx.fillStyle='#ffb703'; ctx.beginPath(); ctx.arc(0,0,r*0.85,0,7); ctx.fill();
    ctx.fillStyle='#fb8500'; ctx.beginPath(); ctx.arc(0,0,r*0.5,0,7); ctx.fill();
    ctx.fillStyle='#2a9d8f'; ctx.beginPath(); ctx.arc(0,-r*0.7,r*0.2,0,7); ctx.fill();
  }
  ctx.restore();
};

/* ---------- 吃豆人实体 ---------- */
var Pacman = function(engine, idx, spawn){
  this.engine=engine; this.idx=idx; this.maze=engine.maze;
  this.r=spawn.r; this.c=spawn.c; this.pr=spawn.r; this.pc=spawn.c; this.t=0;
  this.dir={x:0,y:0}; this.moving=false;
  this.speed=engine.pacSpeed();
  this.score=0; this.stunned=0; this.invincible=0; this.trail=[];
  this.alive=true;
};
Pacman.prototype = {
  onArrive:function(){
    var e=this.engine, m=this.maze;
    e.onPacArrive(this);
    if(this.stunned>0){ this.moving=false; return; }
    var rd = e.getInput(this.idx) || {x:0,y:0};
    var r=this.r, c=this.c;
    if(rd.x||rd.y){
      if(m.pacOk(r+rd.y,c+rd.x)){ this.dir={x:rd.x,y:rd.y}; PAC.Move.setNext(this,r+rd.y,c+rd.x); return; }
    }
    if(this.dir.x||this.dir.y){
      if(m.pacOk(r+this.dir.y,c+this.dir.x)){ PAC.Move.setNext(this,r+this.dir.y,c+this.dir.x); return; }
    }
    this.moving=false; this.dir={x:0,y:0};
  },
  reset:function(){
    var s=this.engine.maze.pacSpawn;
    this.r=s.r; this.c=s.c; this.pr=s.r; this.pc=s.c; this.t=0;
    this.dir={x:0,y:0}; this.moving=false; this.trail=[];
    this.speed=this.engine.pacSpeed(); this.stunned=0; this.alive=true;
  },
  update:function(dt){
    if(!this.alive) return;
    if(this.invincible>0) this.invincible-=dt;
    if(this.stunned>0){ this.stunned-=dt; return; }
    if(this.moving){
      var pos=PAC.Move.entPos(this);
      this.trail.push({x:pos.x*this.engine.ts, y:pos.y*this.engine.ts, a:1});
      if(this.trail.length>10) this.trail.shift();
      for(var i=0;i<this.trail.length;i++) this.trail[i].a*=0.86;
    }
    PAC.Move.update(this, dt);
  },
};
PAC.Pacman=Pacman;

/* ---------- 引擎 ---------- */
var Engine = function(opts){
  this.opts = opts||{};
  this.diff = this.opts.difficulty||'normal';
  this.mode = this.opts.mode||'adventure';
  this.mapIndex = this.opts.mapIndex||0;
  this.level = this.opts.level||1;
  this.lives = (this.opts.lives===undefined)? 3 : this.opts.lives;
  this.livesInfinite = (this.opts.lives===Infinity)||!!this.opts.livesInfinite;
  this.ts = this.opts.ts||20;
  this.loadMap(this.mapIndex);
  this.pacs=[]; this.ghosts=[];
  var nPac = this.opts.nPac||1;
  for(var i=0;i<nPac;i++) this.pacs.push(new Pacman(this,i,this.maze.pacSpawn));
  this.pac = this.pacs[0];
  this.setupGhosts();
  this.inputs = []; for(var k=0;k<Math.max(nPac,2);k++) this.inputs.push({x:0,y:0});
  this.score=0; this.dotsEaten=0; this.combo=0;
  this.state='ready'; this.stateTimer=2.6; this.time=0;
  this.phase='scatter'; this.phaseTimer=3;
  this.fruit=null; this.fruitEatenThisLvl=false;
  this.shake=0; this.texts=[];
  this.timeLeft = this.opts.timeLeft||0;
  this.over=false; this.playerScores=[0,0];
  this.dailyDone = false;
  this.cb = this.opts.callbacks||{};
  this.offsetX=0; this.offsetY=0;
};

Engine.prototype = {
  loadMap:function(idx){ this.mapIndex=idx; this.maze = new PAC.Maze(PAC.MAPS[idx].rows); },
  setupGhosts:function(){
    this.ghosts=[];
    if(this.opts.noGhosts) return;
    var defs=PAC.GHOST_DEFS.slice();
    var nAI = this.opts.playerGhost ? defs.length-1 : defs.length;
    for(var i=0;i<nAI;i++){
      var g=new PAC.Ghost(this, defs[i], i);
      g.releaseDelay=this.releaseTime(i); this.ghosts.push(g);
    }
    if(this.opts.playerGhost){
      var ph=new PAC.Ghost(this, defs[defs.length-1], 3);
      ph.playerControlled=true; ph.state='out'; ph.releaseDelay=0;
      ph.r=1.5; ph.c=10.5; ph.pr=1; ph.pc=10;
      this.ghosts.push(ph); this.ghostHero=ph;
    }
  },
  ghostBaseSpeed:function(){ return PAC.DIFF[this.diff].ghost * (1+(this.level-1)*0.03); },
  pacSpeed:function(){ return PAC.DIFF[this.diff].pac * (1+(this.level-1)*0.006); },
  frightTime:function(){ return Math.max(2.5, PAC.DIFF[this.diff].frightTime - (this.level-1)*0.5); },
  releaseTime:function(i){ var b=[0.8,3,6,9][i]||9; return Math.max(0.4,(b-this.level*0.3)); },
  fruitAt:function(){ return Math.max(25, 70 - (this.level-1)*6); },
  getInput:function(idx){ return this.inputs[idx]||{x:0,y:0}; },
  setInput:function(idx,x,y){ if(this.inputs[idx]){ this.inputs[idx].x=x; this.inputs[idx].y=y; } },
  pause:function(){ if(this.state==='play'||this.state==='ready'){ this._prevState=this.state; this.state='paused'; this.cb.onPause&&this.cb.onPause(); } },
  resume:function(){ if(this.state==='paused'){ this.state=this._prevState||'play'; this.cb.onResume&&this.cb.onResume(); } },
  togglePause:function(){ this.state==='paused'?this.resume():this.pause(); },
  addText:function(x,y,txt,color,size,life){ this.texts.push({x:x,y:y,txt:txt,color:color||'#ffe14d',size:size||12,life:life||0.9,age:0}); },
  shakeIt:function(n){ this.shake=Math.max(this.shake,n||3); },

  onPacArrive:function(pac){
    var m=this.maze, r=pac.r, c=pac.c;
    var cell=m.grid[r][c];
    if(cell.t==='dot'||cell.t==='pellet'){
      var pts=m.eat(r,c);
      var isPell = pts===50;
      pac.score+=pts;
      if(this.pacs.length===1) this.score+=pts;
      this.dotsEaten++;
      if(isPell){
        if(this.mode==='coins'){ pac.speed=this.pacSpeed()*1.35; this.pacBoostT=2.5; }
        else { this.combo=0; this.startFright(); this.shakeIt(2); this.addText(c+0.5,r+0.5,'大能量!','#4d6bff',10,0.8); }
        PAC.Audio.pellet();
      } else {
        this.addText(c+0.5,r-0.2,'+'+pts,'#ffe14d',8,0.4);
        if(Math.random()<0.5) PAC.Audio.wakka();
      }
      this.maybeSpawnFruit();
      if(this.cb.onDot) this.cb.onDot(pac,this);
      if(this.mode!=='timed' && this.mode!=='split' && !m.hasDots()){ this.levelClear(); return; }
    }
    if(this.fruit && Math.abs((this.fruit.cell.c+0.5)-PAC.Move.entPos(pac).x)<0.9 && Math.abs((this.fruit.cell.r+0.5)-PAC.Move.entPos(pac).y)<0.9){ this.eatFruit(pac); }
  },
  maybeSpawnFruit:function(){
    if(this.fruit || this.fruitEatenThisLvl) return;
    if(this.dotsEaten>=this.fruitAt()){
      this.fruit={type:Math.min(2,this.level-1), cell:this.maze.fruitCell, timer:10};
    }
  },
  eatFruit:function(pac){
    var pts = (this.mode==='coins')? 300 : PAC.FRUIT_SCORES[this.fruit.type];
    pac.score+=pts; if(this.pacs.length===1) this.score+=pts;
    this.addText(this.fruit.cell.c+0.5,this.fruit.cell.r-0.3,'+'+pts,'#ffb703',12,1);
    PAC.Audio.fruit(); this.fruit=null; this.fruitEatenThisLvl=true;
    if(this.cb.onFruit) this.cb.onFruit(pac,this);
  },
  startFright:function(){
    var dur=this.frightTime();
    for(var i=0;i<this.ghosts.length;i++){ this.ghosts[i].toFright(dur); }
    PAC.Audio.startFright();
    if(this.cb.onFright) this.cb.onFright(this);
  },
  onGhostFrightEnd:function(){
    var any=false;
    for(var i=0;i<this.ghosts.length;i++){ if(this.ghosts[i].state==='fright'){any=true;break;} }
    if(!any){ PAC.Audio.stopFright(); PAC.Audio.startSiren(); }
  },
  eatGhost:function(ghost){
    var pts=200*Math.pow(2,this.combo); this.combo++;
    this.pac.score+=pts; this.score+=pts;
    this.addText(ghost.c+0.5,ghost.r-0.3,'+'+pts, this.combo>=3?'#ff4d6d':'#4d6bff',12,1.1);
    PAC.Audio.eatGhost(); ghost.eat();
    if(this.cb.onGhostEat) this.cb.onGhostEat(this);
  },
  pacCaught:function(pac){
    if(pac.invincible>0||pac.stunned>0||this.state!=='play') return;
    this.state='dying'; this.stateTimer=1.8; this.dyingPac=pac;
    PAC.Audio.death(); this.lives--;
    if(this.mode==='vsghost'){ this.playerScores[1]++; this.cb.onVSCatch&&this.cb.onVSCatch(this); }
    if(this.cb.onDeath) this.cb.onDeath(this);
  },
  levelClear:function(){
    if(this.state==='clear'||this.state==='end') return;
    this.state='clear'; this.stateTimer=3;
    PAC.Audio.levelClear(); PAC.Audio.stopSiren(); PAC.Audio.stopFright();
    if(this.cb.onLevelClear) this.cb.onLevelClear(this);
  },
  gameOver:function(){
    this.state='over'; PAC.Audio.gameOver(); PAC.Audio.stopSiren(); PAC.Audio.stopFright();
    if(this.cb.onGameOver) this.cb.onGameOver(this);
  },
  timeUp:function(){
    if(this.state==='end'||this.state==='over') return;
    this.state='end'; PAC.Audio.gameOver(); PAC.Audio.stopSiren(); PAC.Audio.stopFright();
    if(this.cb.onTimeUp) this.cb.onTimeUp(this);
  },
  finish2P:function(){
    if(this.state==='end'||this.state==='over') return;
    this.state='end'; PAC.Audio.stopSiren(); PAC.Audio.stopFright();
    this.playerScores[0]=this.pacs[0].score; this.playerScores[1]=this.pacs[1]?this.pacs[1].score:0;
    if(this.cb.on2PEnd) this.cb.on2PEnd(this);
  },
  update:function(dt){
    this.time+=dt;
    this.shake*=Math.pow(0.001,dt); if(this.shake<0.1) this.shake=0;
    for(var i=this.texts.length-1;i>=0;i--){ var t=this.texts[i]; t.age+=dt; t.y-=dt*1.2; if(t.age>=t.life) this.texts.splice(i,1); }
    if(this.state==='ready'){
      this.stateTimer-=dt;
      if(this.stateTimer<=0){ this.state='play'; PAC.Audio.startSiren(); if(this.cb.onStart) this.cb.onStart(this); }
      return;
    }
    if(this.state==='dying'){
      this.stateTimer-=dt;
      if(this.stateTimer<=0){
        if(this.livesInfinite || this.lives>0){ this.respawn(); }
        else { this.gameOver(); }
      }
      return;
    }
    if(this.state==='clear'){
      this.stateTimer-=dt;
      if(this.stateTimer<=0){ if(this.mode==='survival') this.nextWave(); else this.nextLevel(); }
      return;
    }
    if(this.state==='end'||this.state==='over'||this.state==='paused') return;
    // ---- play ----
    this.phaseTimer-=dt;
    if(this.phaseTimer<=0){
      this.phase = (this.phase==='chase')?'scatter':'chase';
      this.phaseTimer = (this.phase==='chase')? PAC.CHASE_TIME : PAC.SCATTER_TIME;
      for(var gi=0;gi<this.ghosts.length;gi++){ var gg=this.ghosts[gi]; if(!gg.playerControlled) gg.setPhase(this.phase); }
    }
    if(this.fruit){ this.fruit.timer-=dt; if(this.fruit.timer<=0) this.fruit=null; }
    if(this.mode==='coins' && this.pacBoostT!==undefined){ this.pacBoostT-=dt; if(this.pacBoostT<=0){ this.pacs.forEach(function(p){p.speed=this.pacSpeed();}.bind(this)); this.pacBoostT=0; } }
    for(var g2=0;g2<this.ghosts.length;g2++){ this.ghosts[g2].update(dt); }
    if(this.ghostHero){
      var in2=this.getInput(1);
      if(in2.x||in2.y){ var hg=this.ghostHero; if(hg.atCenter()){ hg.pendingDir={x:in2.x,y:in2.y}; hg.decide(); } }
    }
    for(var p2=0;p2<this.pacs.length;p2++){ this.pacs[p2].update(dt); }
    for(var p3=0;p3<this.pacs.length;p3++){ this.checkGhostCollision(this.pacs[p3]); }
    if(this.pacs.length>1 && this.mode==='coins'){ this.checkPacCollision(); }
    if(this.mode==='daily' && !this.dailyDone && this.pac.score>=this.opts.dailyGoal){
      this.dailyDone=true; if(this.cb.onDailyGoal) this.cb.onDailyGoal(this);
    }
    if(this.timeLeft>0){ this.timeLeft-=dt; if(this.timeLeft<=0){ this.timeLeft=0; this.timeUp(); } }
  },
  checkGhostCollision:function(pac){
    if(this.state!=='play'||!pac.alive||pac.invincible>0||pac.stunned>0) return;
    var pp=PAC.Move.entPos(pac);
    for(var i=0;i<this.ghosts.length;i++){
      var g=this.ghosts[i]; if(!g.visible) continue;
      if(g.state==='home'||g.state==='exit'||g.state==='eyes') continue;
      var gp=PAC.Move.entPos(g);
      if(Math.abs(pp.x-gp.x)<0.7 && Math.abs(pp.y-gp.y)<0.7){
        if(g.state==='fright'){ this.eatGhost(g); }
        else { this.pacCaught(pac); return; }
      }
    }
  },
  checkPacCollision:function(){
    var a=this.pacs[0], b=this.pacs[1];
    if(!a.alive||!b.alive||a.stunned>0||b.stunned>0) return;
    var ap=PAC.Move.entPos(a), bp=PAC.Move.entPos(b);
    if(Math.abs(ap.x-bp.x)<0.8 && Math.abs(ap.y-bp.y)<0.8){
      a.stunned=0.6; b.stunned=0.6; PAC.Audio.bump(); this.shakeIt(3);
      this.addText(a.c+0.5,a.r-0.3,'相撞!','#ff4d6d',10,0.6);
    }
  },
  respawn:function(){
    this.pac.reset(); this.pac.invincible=2.2;
    if(this.pacs[1]) this.pacs[1].reset();
    for(var i=0;i<this.ghosts.length;i++){ if(!this.ghosts[i].playerControlled) this.ghosts[i].reset(); }
    this.combo=0; this.fruit=null; this.phase='scatter'; this.phaseTimer=3;
    this.state='ready'; this.stateTimer=2.2;
  },
  nextLevel:function(){
    this.level++; this.loadMap((this.mapIndex+1)%PAC.MAPS.length);
    if(this.opts.stayMap) this.loadMap(this.mapIndex);
    this.resetLevel();
  },
  nextWave:function(){ this.level++; this.resetLevel(); },
  resetLevel:function(){
    this.dotsEaten=0; this.combo=0; this.fruit=null; this.fruitEatenThisLvl=false;
    this.pac.reset(); if(this.pacs[1]) this.pacs[1].reset();
    this.ghosts=[]; this.setupGhosts();
    this.phase='scatter'; this.phaseTimer=3;
    this.state='ready'; this.stateTimer=2.6;
    if(this.cb.onLevel) this.cb.onLevel(this);
  },
  render:function(ctx, time){
    var pal=PAC.palette(), ts=this.ts;
    var ox=this.offsetX||0, oy=this.offsetY||0;
    ctx.save();
    if(this.shake>0) ctx.translate((Math.random()-0.5)*this.shake,(Math.random()-0.5)*this.shake);
    PAC.drawMaze(ctx, this.maze, ox, oy, ts, time, pal);
    if(this.fruit){ var fc=this.fruit.cell; PAC.drawFruit(ctx, this.fruit.type, ox+fc.c*ts+ts/2, oy+fc.r*ts+ts/2, ts*0.7); }
    for(var i=0;i<this.ghosts.length;i++) this.ghosts[i].draw(ctx, ox, oy, ts, time);
    for(var j=0;j<this.pacs.length;j++) PAC.drawPac(ctx, this.pacs[j], ox, oy, ts, time);
    if(this.state==='dying'&&this.dyingPac){
      var p=this.dyingPac, pp=PAC.Move.entPos(p);
      var prog=1-Math.max(0,this.stateTimer/1.8);
      var x=ox+pp.x*ts, y=oy+pp.y*ts;
      ctx.save(); ctx.beginPath(); ctx.rect(x-ts*0.5, y-ts*0.5+prog*ts*0.9, ts, ts); ctx.clip();
      ctx.fillStyle='#fff'; ctx.globalAlpha=prog; ctx.fillRect(x-ts*0.6,y-ts*0.6,ts*1.2,ts*1.2); ctx.globalAlpha=1; ctx.restore();
      PAC.drawPac(ctx,p,ox,oy,ts,time);
    }
    ctx.textAlign='center';
    var pf = (PAC.UI&&PAC.UI.pixelFont)? PAC.UI.pixelFont() : 'monospace';
    for(var k=0;k<this.texts.length;k++){
      var ft=this.texts[k]; ctx.globalAlpha=1-ft.age/ft.life; ctx.fillStyle=ft.color;
      ctx.font='bold '+ft.size+'px '+pf;
      ctx.fillText(ft.txt, ox+ft.x*ts, oy+ft.y*ts);
    }
    ctx.globalAlpha=1;
    var cxm=ox+this.maze.W*ts/2;
    if(this.state==='ready'){ ctx.fillStyle=pal.accent; ctx.font='bold 22px '+pf; ctx.fillText('READY!', cxm, oy+this.maze.H*ts*0.5); }
    if(this.state==='clear'){ ctx.fillStyle=pal.accent; ctx.font='bold 26px '+pf; ctx.fillText('LEVEL CLEAR', cxm, oy+this.maze.H*ts*0.5); ctx.font='14px '+pf; ctx.fillStyle=pal.text; ctx.fillText('下一关…', cxm, oy+this.maze.H*ts*0.5+26); }
    if(this.state==='over'){
      ctx.fillStyle='rgba(0,0,0,0.6)'; ctx.fillRect(ox,oy,this.maze.W*ts,this.maze.H*ts);
      ctx.fillStyle='#ff4d6d'; ctx.font='bold 30px '+pf; ctx.fillText('GAME OVER', cxm, oy+this.maze.H*ts*0.45);
      ctx.font='14px '+pf; ctx.fillStyle=pal.text; ctx.fillText('得分 '+this.pac.score, cxm, oy+this.maze.H*ts*0.45+28);
    }
    ctx.restore();
  },
};

PAC.CHASE_TIME=7; PAC.SCATTER_TIME=3;
PAC.Engine=Engine;
})(typeof window!=='undefined'?window:this);
