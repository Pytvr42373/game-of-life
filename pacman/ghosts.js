/* PAC-MAN 完整版 - 幽灵 AI (ghosts.js) 四性格 + 鬼屋释放 + 恐惧/被吃 */
'use strict';
(function(win){
var PAC = win.PAC = win.PAC || {};

PAC.GHOST_DEFS = [
  { name:'追追', color:'#ff4d6d', ai:'chaser', corner:{r:0,c:0}   , desc:'始终紧咬不放' },
  { name:'包抄', color:'#ffb020', ai:'ambush', corner:{r:0,c:19}  , desc:'预判前路抄截' },
  { name:'围堵', color:'#4dabf7', ai:'flank', corner:{r:17,c:0}   , desc:'对角线包夹' },
  { name:'游荡', color:'#b57bff', ai:'wander', corner:{r:17,c:19} , desc:'神出鬼没游走' },
];

var DIR_LIST = [{x:0,y:-1},{x:0,y:1},{x:-1,y:0},{x:1,y:0}];

var Ghost = function(engine, def, index){
  this.engine=engine; this.maze=engine.maze; this.def=def; this.index=index;
  this.playerControlled=false;
  this.state='home';  // home|exit|out|fright|eyes
  this.phase='scatter';
  this.fright=false; this.scaredTimer=0;
  this.visible=true; this.stunned=0;
  this.pendingDir={x:0,y:0};
  var hc=this.maze.houseCells;
  var cell=hc[Math.min(index,hc.length-1)]||hc[hc.length-1]||{r:9,c:9};
  this.r=cell.r; this.c=cell.c; this.pr=cell.r; this.pc=cell.c; this.t=0;
  this.dir={x:0,y:0}; this.moving=false;
  this.speed=engine.ghostBaseSpeed();
  this.releaseDelay=engine.releaseTime(index);
};

Ghost.prototype = {
  setPhase:function(p){ this.phase=p; },
  reset:function(){
    var hc=this.maze.houseCells, cell=hc[Math.min(this.index,hc.length-1)]||hc[hc.length-1];
    this.r=cell.r; this.c=cell.c; this.pr=cell.r; this.pc=cell.c; this.t=0;
    this.dir={x:0,y:0}; this.moving=false; this.state='home';
    this.fright=false; this.scaredTimer=0; this.speed=this.engine.ghostBaseSpeed();
    this.releaseDelay=this.engine.releaseTime(this.index); this.stunned=0;
  },
  targetCell:function(){
    var m=this.maze, p=this.engine.pac;
    if(this.state==='exit'||this.state==='eyes') return m.doorCells[0];
    if(this.phase==='scatter') return this.def.corner;
    var pr=p?Math.round(PAC.Move.entPos(p).y):9, pc=p?Math.round(PAC.Move.entPos(p).x):10;
    var dx=p?p.dir.x:0, dy=p?p.dir.y:0;
    var ai=this.def.ai;
    if(ai==='chaser') return {r:pr,c:pc};
    if(ai==='ambush') return {r:PAC.clamp(pr+dy*4,0,m.H-1), c:PAC.clamp(pc+dx*4,0,m.W-1)};
    if(ai==='flank') return {r:PAC.clamp(pr+dx*3,0,m.H-1), c:PAC.clamp(pc-dy*3,0,m.W-1)};
    if(Math.random()<0.8){
      var rr=Math.floor(Math.random()*m.H), cc=Math.floor(Math.random()*m.W);
      for(var t=0;t<8&&!m.ghostOk(rr,cc);t++){ rr=Math.floor(Math.random()*m.H); cc=Math.floor(Math.random()*m.W); }
      return {r:rr,c:cc};
    }
    return {r:pr,c:pc};
  },
  canEnter:function(r,c){ var x=this.maze.grid[r][c]; if(!x) return false; if(x.t==='door'||x.t==='house') return this.state==='exit'||this.state==='eyes'; return true; },
  decide:function(){
    var m=this.maze, r=this.r, c=this.c;
    if(this.state==='home'){ this.moving=false; return; }
    if(this.playerControlled){
      var pd=this.pendingDir; this.pendingDir={x:0,y:0};
      if(pd.x||pd.y){ if(m.ghostOk(r+pd.y,c+pd.x)){ this.dir=pd; PAC.Move.setNext(this,r+pd.y,c+pd.x); return; } }
      if(this.dir.x||this.dir.y){ if(m.ghostOk(r+this.dir.y,c+this.dir.x)){ PAC.Move.setNext(this,r+this.dir.y,c+this.dir.x); return; } }
      this.moving=false; return;
    }
    if(this.state==='fright'){
      var opts=[];
      for(var i=0;i<DIR_LIST.length;i++){ var d=DIR_LIST[i]; var nr=r+d.y,nc=c+d.x; if(m.ghostOk(nr,nc)&&this.canEnter(nr,nc)) opts.push(d); }
      if(opts.length){ var ch=opts[Math.floor(Math.random()*opts.length)]; this.dir=ch; PAC.Move.setNext(this,r+ch.y,c+ch.x); return; }
      this.moving=false; return;
    }
    var target=this.targetCell();
    var best=null, bestScore=1e9, cands=[];
    for(var j=0;j<DIR_LIST.length;j++){
      var d=DIR_LIST[j];
      if((d.x===-this.dir.x&&d.y===-this.dir.y)&&(this.dir.x||this.dir.y)) continue;
      var nr2=r+d.y, nc2=c+d.x;
      if(!m.ghostOk(nr2,nc2)||!this.canEnter(nr2,nc2)) continue;
      var score=PAC.mDist(nr2,nc2,target.r,target.c);
      if(this.def.ai==='wander'&&this.phase!=='scatter') score+=Math.random()*4;
      if(score<bestScore){ bestScore=score; best=d; } cands.push(d);
    }
    if(best) this.dir=best; else if(cands.length) this.dir=cands[0];
    if(this.dir.x||this.dir.y) PAC.Move.setNext(this,r+this.dir.y,c+this.dir.x);
    else this.moving=false;
  },
  onArrive:function(){
    var m=this.maze, t=m.grid[this.r][this.c].t;
    if(this.state==='exit'&&t==='door'){ this.state='out'; this.speed=this.engine.ghostBaseSpeed(); }
    if(this.state==='eyes'&&t==='door'){
      var hc=this.maze.houseCells, h=hc[Math.floor(Math.random()*hc.length)];
      this.r=h.r; this.c=h.c; this.pr=h.r; this.pc=h.c; this.t=0; this.moving=false;
      this.state='home'; this.releaseDelay=1.2; this.speed=this.engine.ghostBaseSpeed();
    }
    if(this.state==='home'){ this.moving=false; return; }
    this.decide();
  },
  update:function(dt){
    if(this.stunned>0){ this.stunned-=dt; return; }
    if(this.state==='fright'){
      this.scaredTimer-=dt;
      if(this.scaredTimer<=0){ this.state='out'; this.fright=false; this.speed=this.engine.ghostBaseSpeed(); this.engine.onGhostFrightEnd(this); }
    }
    if(this.state==='home'){
      this.releaseDelay-=dt;
      if(this.releaseDelay<=0&&!this.playerControlled){ this.state='exit'; this.dir={x:0,y:-1}; }
      return;
    }
    PAC.Move.update(this, dt);
  },
  toFright:function(dur){ if(this.state==='out'){ this.state='fright'; this.fright=true; this.scaredTimer=dur; this.speed=this.engine.ghostBaseSpeed()*0.55; } },
  eat:function(){ this.state='eyes'; this.fright=false; this.visible=true; this.speed=this.engine.ghostBaseSpeed()*2.2; },
  draw:function(ctx, ox, oy, ts, time){ PAC.GhostDraw(this, ctx, ox, oy, ts, time); },
};

PAC.GhostDraw = function(g, ctx, ox, oy, ts, time){
  if(!g.visible) return;
  var pos=PAC.Move.entPos(g);
  var x=ox+pos.x*ts, y=oy+pos.y*ts, r=ts*0.46;
  var body=g.def.color, blink=false;
  if(g.state==='fright'){
    var left=g.scaredTimer;
    if(left<1.5 && Math.floor(left*8)%2===0) blink=true;
    body = blink? '#f8f9fa' : '#4d6bff';
  } else if(g.state==='eyes'||g.state==='home'){ body='#cfd8ff'; }
  ctx.save();
  ctx.fillStyle=body; ctx.beginPath();
  ctx.arc(x, y-r*0.55, r, Math.PI, 0);
  var footY=y+r*0.5;
  for(var i=0;i<4;i++){
    var fx=x-r+i*(2*r/3), wig=Math.sin(time*8+g.index+i)*2;
    ctx.lineTo(fx, footY); ctx.lineTo(fx+(2*r/6), footY-(i%2?wig:0)-1);
  }
  ctx.lineTo(x+r, footY); ctx.closePath(); ctx.fill();
  if(g.state==='fright'||g.state==='eyes'||g.state==='home'){
    ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(x-r*0.3,y-r*0.35,r*0.24,0,7); ctx.arc(x+r*0.3,y-r*0.35,r*0.24,0,7); ctx.fill();
    ctx.fillStyle='#222'; ctx.beginPath(); ctx.arc(x-r*0.3,y-r*0.35,r*0.1,0,7); ctx.arc(x+r*0.3,y-r*0.35,r*0.1,0,7); ctx.fill();
    if(g.state==='fright'){ ctx.fillStyle=blink?'#222':'#fff'; ctx.fillRect(x-r*0.6, y+r*0.05, r*1.2, r*0.18); }
  } else {
    ctx.fillStyle='#fff'; ctx.beginPath();
    ctx.ellipse(x-r*0.28,y-r*0.35,r*0.26,r*0.32,0,0,7); ctx.ellipse(x+r*0.28,y-r*0.35,r*0.26,r*0.32,0,0,7); ctx.fill();
    var px=0,py=0;
    if(g.engine.pac){ var pr=Math.round(PAC.Move.entPos(g.engine.pac).y),pc=Math.round(PAC.Move.entPos(g.engine.pac).x),gr=g.r,gc=g.c;
      if(pr!==gr) py=pr>gr?1:-1; if(pc!==gc) px=pc>gc?1:-1; }
    ctx.fillStyle='#222'; ctx.beginPath();
    ctx.arc(x-r*0.28+px*r*0.12,y-r*0.35+py*r*0.12,r*0.13,0,7); ctx.arc(x+r*0.28+px*r*0.12,y-r*0.35+py*r*0.12,r*0.13,0,7); ctx.fill();
  }
  ctx.restore();
};

PAC.Ghost=Ghost;
})(typeof window!=='undefined'?window:this);
