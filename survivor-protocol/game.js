(function(root,factory){
  'use strict';
  var api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root&&root.document)api.boot();
})(typeof window!=='undefined'?window:null,function(){
  'use strict';

  var STEP=1/60;
  var MAX={enemies:140,playerBullets:220,enemyBullets:100,drops:200,repairs:12,hazards:32,effects:240};
  var WEAPON_NAMES={needle:'导向针',orbit:'护航环',arc:'跃迁弧',beacon:'定域信标'};
  var PASSIVE_NAMES={power:'功率增幅',cycle:'周期压缩',speed:'轻量底盘',magnet:'回收磁场',frame:'扩容框架',repair:'自修复层'};
  var WAVE_TABLE=[
    {start:0,end:45,rate:1.05,weights:[1,0,0,0],hp:1,damage:1},
    {start:45,end:90,rate:1.6,weights:[.75,.25,0,0],hp:1.12,damage:1},
    {start:90,end:135,rate:2,weights:[.55,.25,.2,0],hp:1.25,damage:1.1},
    {start:135,end:180,rate:2.4,weights:[.4,.25,.25,.1],hp:1.4,damage:1.15},
    {start:180,end:240,rate:2.9,weights:[.35,.3,.2,.15],hp:1.6,damage:1.25},
    {start:240,end:300,rate:3.6,weights:[.25,.3,.25,.2],hp:1.9,damage:1.35}
  ];
  var ENEMY_BASE={
    chaser:{hp:26,r:12,speed:72,damage:8,xp:1},
    charger:{hp:22,r:10,speed:88,damage:12,xp:1},
    shooter:{hp:42,r:13,speed:52,damage:6,xp:2},
    tank:{hp:120,r:19,speed:42,damage:18,xp:4},
    elite:{hp:500,r:27,speed:58,damage:15,xp:30}
  };

  function xpRequired(level){return 10+7*(level-1);}
  function waveAt(time){
    for(var i=0;i<WAVE_TABLE.length;i++)if(time>=WAVE_TABLE[i].start&&time<WAVE_TABLE[i].end)return WAVE_TABLE[i];
    return null;
  }
  function createRng(seed){
    var value=seed>>>0;
    return function(){
      value+=0x6D2B79F5;
      var t=value;
      t=Math.imul(t^(t>>>15),t|1);
      t^=t+Math.imul(t^(t>>>7),t|61);
      return((t^(t>>>14))>>>0)/4294967296;
    };
  }
  function resolveOutcome(flags){
    if(flags.bossDead)return'win';
    if(flags.playerDead)return'dead';
    if(flags.timeUp)return'timeout';
    return null;
  }
  function bossPhase(hp){return hp<=2700?2:1;}
  function cloneLevels(levels,keys){var out={};keys.forEach(function(key){out[key]=levels&&levels[key]||0;});return out;}
  function generateUpgradeOptions(build,rng){
    var weapons=cloneLevels(build.weapons,Object.keys(WEAPON_NAMES));
    var passives=cloneLevels(build.passives,Object.keys(PASSIVE_NAMES));
    var unowned=Object.keys(weapons).filter(function(key){return weapons[key]===0;});
    var pool=[];
    Object.keys(weapons).forEach(function(key){if(weapons[key]>0&&weapons[key]<4)pool.push({kind:'weapon',key:key,weight:3});});
    Object.keys(passives).forEach(function(key){if(passives[key]<3)pool.push({kind:'passive',key:key,weight:2});});
    var result=[];
    if(unowned.length){var first=unowned[Math.floor(rng()*unowned.length)];result.push({kind:'weapon',key:first});}
    while(result.length<3&&pool.length){
      var total=pool.reduce(function(sum,item){return sum+item.weight;},0);
      var pick=rng()*total,index=0;
      for(;index<pool.length;index++){pick-=pool[index].weight;if(pick<=0)break;}
      var chosen=pool.splice(Math.min(index,pool.length-1),1)[0];
      if(!result.some(function(item){return item.kind===chosen.kind&&item.key===chosen.key;}))result.push({kind:chosen.kind,key:chosen.key});
    }
    if(result.length<3)result.push({kind:'heal',key:'heal'});
    if(result.length<3)result.push({kind:'heal',key:'heal2'});
    return result.slice(0,3);
  }
  function passiveValue(key,level){
    if(key==='power')return[0,.12,.24,.36][level];
    if(key==='cycle')return[0,.08,.16,.24][level];
    if(key==='speed')return[0,.08,.16,.24][level];
    if(key==='magnet')return[70,120,170,230][level];
    if(key==='frame')return[100,120,145,175][level];
    if(key==='repair')return[0,.35,.7,1.05][level];
    return 0;
  }
  function applyUpgradeToBuild(build,option){
    if(option.kind==='weapon')build.weapons[option.key]=Math.min(4,(build.weapons[option.key]||0)+1);
    if(option.kind==='passive')build.passives[option.key]=Math.min(3,(build.passives[option.key]||0)+1);
    return build;
  }
  function dist2(a,b){var x=a.x-b.x,y=a.y-b.y;return x*x+y*y;}
  function clamp(value,min,max){return Math.max(min,Math.min(max,value));}
  function normalize(x,y){var d=Math.hypot(x,y);return d?{x:x/d,y:y/d}:{x:0,y:0};}
  function formatTime(seconds){
    var value=Math.max(0,Math.ceil(seconds));
    return String(Math.floor(value/60)).padStart(2,'0')+':'+String(value%60).padStart(2,'0');
  }

  function Game(doc){
    this.doc=doc;
    this.canvas=doc.getElementById('game');
    this.ctx=this.canvas.getContext('2d');
    this.dom={
      menu:doc.getElementById('menuScreen'),upgrade:doc.getElementById('upgradeScreen'),pause:doc.getElementById('pauseScreen'),result:doc.getElementById('resultScreen'),
      start:doc.getElementById('startBtn'),resume:doc.getElementById('resumeBtn'),restart:doc.getElementById('restartBtn'),again:doc.getElementById('againBtn'),pauseBtn:doc.getElementById('pauseBtn'),
      theme:doc.getElementById('themeToggle'),themeSubtitle:doc.getElementById('themeSubtitle'),upgradeGrid:doc.getElementById('upgradeGrid'),pauseReason:doc.getElementById('pauseReason'),
      hpFill:doc.getElementById('hpFill'),hpText:doc.getElementById('hpText'),time:doc.getElementById('timeText'),level:doc.getElementById('levelText'),kills:doc.getElementById('killText'),xpFill:doc.getElementById('xpFill'),xpText:doc.getElementById('xpText'),
      bossHud:doc.getElementById('bossHud'),bossFill:doc.getElementById('bossFill'),bossPhase:doc.getElementById('bossPhase'),toast:doc.getElementById('combatToast'),
      resultTitle:doc.getElementById('resultTitle'),resultCode:doc.getElementById('resultCode'),resultReason:doc.getElementById('resultReason'),resultStats:doc.getElementById('resultStats'),buildSummary:doc.getElementById('buildSummary'),
      runs:doc.getElementById('recordRuns'),wins:doc.getElementById('recordWins'),recordLevel:doc.getElementById('recordLevel'),recordKills:doc.getElementById('recordKills'),
      stickZone:doc.getElementById('stickZone'),stickKnob:doc.getElementById('stickKnob'),dash:doc.getElementById('dashBtn'),dashText:doc.getElementById('dashText')
    };
    this.width=innerWidth;this.height=innerHeight;this.dpr=1;this.scale=1;
    this.state='MENU';this.phase='WAVES';this.keys={};this.touch={x:0,y:0,id:null};this.lastMove={x:0,y:-1};
    this.lastFrame=performance.now();this.acc=0;this.idCounter=1;this.toastTimer=0;this.restartArmed=false;
    this.reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.records=this.loadRecords();
    this.bind();this.applySavedTheme();this.resize();this.updateRecords();this.render();
  }

  Game.prototype.defaultRecords=function(){return{version:1,runs:0,wins:0,bestClearMs:null,bestKills:0,highestLevel:1,totalKills:0};};
  Game.prototype.loadRecords=function(){
    var data=this.defaultRecords();
    try{
      var parsed=JSON.parse(localStorage.getItem('gh-survivor-protocol-v1')||'null');
      if(parsed&&parsed.version===1){
        ['runs','wins','bestKills','highestLevel','totalKills'].forEach(function(key){if(Number.isFinite(parsed[key])&&parsed[key]>=0)data[key]=Math.floor(parsed[key]);});
        if(parsed.bestClearMs===null||(Number.isFinite(parsed.bestClearMs)&&parsed.bestClearMs>=0))data.bestClearMs=parsed.bestClearMs;
      }
    }catch(e){}
    return data;
  };
  Game.prototype.saveRecords=function(){try{localStorage.setItem('gh-survivor-protocol-v1',JSON.stringify(this.records));}catch(e){}};
  Game.prototype.updateRecords=function(){
    this.dom.runs.textContent=this.records.runs;this.dom.wins.textContent=this.records.wins;
    this.dom.recordLevel.textContent=this.records.highestLevel;this.dom.recordKills.textContent=this.records.bestKills;
  };
  Game.prototype.commitRun=function(won){
    if(!this.player||this.runCommitted)return;
    this.runCommitted=true;
    this.records.bestKills=Math.max(this.records.bestKills,this.kills);
    this.records.highestLevel=Math.max(this.records.highestLevel,this.player.level);
    this.records.totalKills+=this.kills;
    if(won){
      this.records.wins++;
      var clear=Math.max(0,Math.round((this.time-300)*1000));
      if(this.records.bestClearMs===null||clear<this.records.bestClearMs)this.records.bestClearMs=clear;
    }
    this.saveRecords();this.updateRecords();
  };

  Game.prototype.bind=function(){
    var self=this;
    addEventListener('resize',function(){self.resize();});
    addEventListener('keydown',function(event){
      var key=event.key.toLowerCase();self.keys[key]=true;
      if(['arrowup','arrowdown','arrowleft','arrowright',' '].includes(key))event.preventDefault();
      if((key===' '||key==='shift')&&self.state==='PLAYING')self.tryDash();
      if((key==='escape'||key==='p')&&(self.state==='PLAYING'||self.state==='PAUSED'))self.state==='PLAYING'?self.pause('所有战斗计时均已冻结。'):self.resume();
      if(self.state==='LEVEL_UP'&&['1','2','3'].includes(key)){var card=self.dom.upgradeGrid.children[Number(key)-1];if(card)card.click();}
    },{passive:false});
    addEventListener('keyup',function(event){self.keys[event.key.toLowerCase()]=false;});
    addEventListener('blur',function(){self.clearInput();if(self.state==='PLAYING')self.pause('窗口失去焦点，任务已自动暂停。');});
    docVisibility(this.doc,function(){self.clearInput();if(self.doc.hidden&&self.state==='PLAYING')self.pause('页面已隐藏，任务已自动暂停。');});
    this.dom.start.addEventListener('click',function(){self.start();});
    this.dom.again.addEventListener('click',function(){self.start();});
    this.dom.resume.addEventListener('click',function(){self.resume();});
    this.dom.pauseBtn.addEventListener('click',function(){self.pause('所有战斗计时均已冻结。');});
    this.dom.restart.addEventListener('click',function(){
      if(!self.restartArmed){self.restartArmed=true;self.dom.restart.textContent='再次点击确认';setTimeout(function(){self.restartArmed=false;self.dom.restart.textContent='重新开始';},1800);return;}
      self.commitRun(false);self.start();
    });
    this.dom.theme.addEventListener('click',function(){self.setTheme(self.doc.body.dataset.theme==='arcade'?'4399':'arcade');});
    this.bindTouch();
    requestAnimationFrame(function(now){self.frame(now);});
  };
  function docVisibility(doc,fn){doc.addEventListener('visibilitychange',fn);}
  Game.prototype.bindTouch=function(){
    var self=this,zone=this.dom.stickZone;
    function move(event){
      if(self.touch.id!==event.pointerId)return;
      var rect=zone.getBoundingClientRect(),cx=rect.left+rect.width/2,cy=rect.top+rect.height/2;
      var dx=event.clientX-cx,dy=event.clientY-cy,d=Math.hypot(dx,dy),limit=44;
      if(d>limit){dx=dx/d*limit;dy=dy/d*limit;d=limit;}
      self.touch.x=d<8?0:dx/limit;self.touch.y=d<8?0:dy/limit;
      self.dom.stickKnob.style.transform='translate(calc(-50% + '+dx+'px),calc(-50% + '+dy+'px))';
    }
    function end(event){if(self.touch.id!==event.pointerId)return;self.touch.id=null;self.touch.x=0;self.touch.y=0;self.dom.stickKnob.style.transform='translate(-50%,-50%)';}
    zone.addEventListener('pointerdown',function(event){self.touch.id=event.pointerId;zone.setPointerCapture(event.pointerId);move(event);});
    zone.addEventListener('pointermove',move);zone.addEventListener('pointerup',end);zone.addEventListener('pointercancel',end);
    this.dom.dash.addEventListener('pointerdown',function(event){event.preventDefault();self.tryDash();});
  };
  Game.prototype.clearInput=function(){this.keys={};this.touch.x=0;this.touch.y=0;this.touch.id=null;this.dom.stickKnob.style.transform='translate(-50%,-50%)';};
  Game.prototype.resize=function(){
    this.width=innerWidth;this.height=innerHeight;this.dpr=Math.min(devicePixelRatio||1,matchMedia('(pointer:coarse)').matches?1.5:2);this.scale=clamp(Math.min(this.width,this.height)/800,.75,1.35);
    this.canvas.width=Math.round(this.width*this.dpr);this.canvas.height=Math.round(this.height*this.dpr);this.canvas.style.width=this.width+'px';this.canvas.style.height=this.height+'px';
    this.ctx.setTransform(this.dpr,0,0,this.dpr,0,0);
  };

  Game.prototype.applySavedTheme=function(){var theme='4399';try{var stored=localStorage.getItem('gh-theme');if(stored==='4399'||stored==='arcade')theme=stored;}catch(e){}this.setTheme(theme,false);};
  Game.prototype.themeIcon=function(target){
    if(target==='arcade')return'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 2.5 7.5 4.3v8.4L12 19.5l-7.5-4.3V6.8z"/><path d="M8.5 9.2 12 7.3l3.5 1.9v4L12 15l-3.5-1.8z"/><path d="M3 8H1.8v3M21 8h1.2v3M8.5 21.5h7"/></svg>';
    return'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6.5" cy="6.5" r="2.5"/><path d="M3 14h10.5c2 0 2-3 0-3-1 0-1.7.5-2 1.2M3 18h14c2.3 0 2.3-3.5 0-3.5-1.1 0-1.9.5-2.3 1.3"/><path d="M16.5 4.5c2.8.2 4.2 1.6 4.5 4.5-2.9-.2-4.3-1.6-4.5-4.5Z"/></svg>';
  };
  Game.prototype.setTheme=function(theme,persist){
    this.doc.body.dataset.theme=theme;var target=theme==='arcade'?'4399':'arcade';
    this.dom.theme.innerHTML=this.themeIcon(target);this.dom.themeSubtitle.textContent=theme==='arcade'?'未来机甲实战':'清新训练模拟';
    var label=target==='arcade'?'切换到未来机甲主题':'切换到清新主题';this.dom.theme.setAttribute('aria-label',label);this.dom.theme.title=label;
    if(persist!==false)try{localStorage.setItem('gh-theme',theme);}catch(e){}
  };

  Game.prototype.start=function(){
    this.runCommitted=false;this.records.runs++;this.saveRecords();this.updateRecords();
    this.state='PLAYING';this.phase='WAVES';this.time=0;this.spawnBudget=0;this.kills=0;this.eliteKills=0;this.totalDamage=0;this.pendingLevels=0;this.bossWaiting=false;this.boss=null;this.bossStartedAt=null;
    this.player={x:0,y:0,r:14,hp:100,maxHp:100,baseSpeed:200,level:1,xp:0,invuln:0,dashCooldown:0,dashTimer:0,dashX:0,dashY:-1,weapons:{needle:1,orbit:0,arc:0,beacon:0},passives:{power:0,cycle:0,speed:0,magnet:0,frame:0,repair:0},cooldowns:{needle:0,arc:0,beacon:0}};
    this.enemies=[];this.playerBullets=[];this.enemyBullets=[];this.drops=[];this.repairs=[];this.hazards=[];this.effects=[];this.eliteFlags={90:false,180:false,255:false};
    this.rng=createRng((Date.now()^Math.floor(performance.now()*1000))>>>0);this.lastMove={x:0,y:-1};this.clearInput();
    this.hideAllScreens();this.doc.body.classList.add('playing');this.dom.bossHud.classList.remove('show');this.toast('协议启动');this.lastFrame=performance.now();this.acc=0;this.updateHud();
  };
  Game.prototype.hideAllScreens=function(){[this.dom.menu,this.dom.upgrade,this.dom.pause,this.dom.result].forEach(function(node){node.classList.remove('show');node.setAttribute('aria-hidden','true');});};
  Game.prototype.pause=function(reason){if(this.state!=='PLAYING')return;this.state='PAUSED';this.dom.pauseReason.textContent=reason;this.dom.pause.classList.add('show');this.dom.pause.setAttribute('aria-hidden','false');this.clearInput();};
  Game.prototype.resume=function(){if(this.state!=='PAUSED')return;this.state='PLAYING';this.dom.pause.classList.remove('show');this.dom.pause.setAttribute('aria-hidden','true');this.lastFrame=performance.now();this.acc=0;};
  Game.prototype.tryDash=function(){
    if(this.state!=='PLAYING'||this.player.dashCooldown>0||this.player.dashTimer>0)return;
    var input=this.inputVector(),dir=Math.hypot(input.x,input.y)>.05?normalize(input.x,input.y):this.lastMove;
    this.player.dashX=dir.x;this.player.dashY=dir.y;this.player.dashTimer=.18;this.player.dashCooldown=3.2;this.player.invuln=Math.max(this.player.invuln,.18);
    if(!this.reduced)this.addEffect({kind:'ring',x:this.player.x,y:this.player.y,r:18,maxR:58,ttl:.25,max:.25,color:'accent'});
  };
  Game.prototype.inputVector=function(){
    var x=(this.keys.d||this.keys.arrowright?1:0)-(this.keys.a||this.keys.arrowleft?1:0)+this.touch.x;
    var y=(this.keys.s||this.keys.arrowdown?1:0)-(this.keys.w||this.keys.arrowup?1:0)+this.touch.y;
    var length=Math.hypot(x,y);if(length>1){x/=length;y/=length;}return{x:x,y:y};
  };

  Game.prototype.frame=function(now){
    var delta=Math.min(.25,(now-this.lastFrame)/1000);this.lastFrame=now;
    if(this.state==='PLAYING'){
      this.acc+=delta;var steps=0;
      while(this.acc>=STEP&&steps<5&&this.state==='PLAYING'){this.update(STEP);this.acc-=STEP;steps++;}
      if(steps===5)this.acc=0;
    }else this.acc=0;
    this.render();requestAnimationFrame(this.frame.bind(this));
  };
  Game.prototype.update=function(dt){
    var previous=this.time;this.time+=dt;this.player.invuln=Math.max(0,this.player.invuln-dt);this.player.dashCooldown=Math.max(0,this.player.dashCooldown-dt);
    this.movePlayer(dt);this.updateHazards(dt);this.updateWeapons(dt);this.updateEnemies(dt);this.updateProjectiles(dt);this.updateDrops(dt);this.updateEffects(dt);
    if(this.phase==='WAVES'){
      this.spawnWave(dt);
      [90,180,255].forEach(function(mark){if(previous<mark&&this.time>=mark&&!this.eliteFlags[mark]){this.eliteFlags[mark]=true;this.spawnEnemy('elite');this.toast('精英监察体接近');}},this);
      if(previous<300&&this.time>=300)this.prepareBoss();
    }else if(this.boss)this.updateBoss(dt);
    if(this.player.passives.repair>0)this.player.hp=Math.min(this.player.maxHp,this.player.hp+passiveValue('repair',this.player.passives.repair)*dt);
    var result=resolveOutcome({bossDead:this.boss&&this.boss.hp<=0,playerDead:this.player.hp<=0,timeUp:this.time>=360&&this.boss&&this.boss.hp>0});
    if(result)this.finish(result);
    this.updateHud();
  };
  Game.prototype.movePlayer=function(dt){
    var p=this.player;
    if(p.dashTimer>0){var dashSpeed=160/.18;p.x+=p.dashX*dashSpeed*dt;p.y+=p.dashY*dashSpeed*dt;p.dashTimer=Math.max(0,p.dashTimer-dt);return;}
    var input=this.inputVector();if(Math.hypot(input.x,input.y)>.05)this.lastMove=normalize(input.x,input.y);
    var speed=p.baseSpeed*(1+passiveValue('speed',p.passives.speed));p.x+=input.x*speed*dt;p.y+=input.y*speed*dt;
  };

  Game.prototype.spawnWave=function(dt){
    var wave=waveAt(this.time);if(!wave)return;this.spawnBudget+=wave.rate*dt;
    while(this.spawnBudget>=1){this.spawnBudget-=1;if(this.enemies.length>=MAX.enemies)continue;var roll=this.rng(),sum=0,index=0;for(;index<wave.weights.length;index++){sum+=wave.weights[index];if(roll<=sum)break;}this.spawnEnemy(['chaser','charger','shooter','tank'][Math.min(index,3)],wave);}
  };
  Game.prototype.spawnPoint=function(){
    var angle=this.rng()*Math.PI*2,radius=Math.hypot(this.width,this.height)/this.scale*.55+80+this.rng()*60;
    return{x:this.player.x+Math.cos(angle)*radius,y:this.player.y+Math.sin(angle)*radius};
  };
  Game.prototype.spawnEnemy=function(type,wave){
    if(this.enemies.length>=MAX.enemies)return null;wave=wave||waveAt(this.time)||WAVE_TABLE[WAVE_TABLE.length-1];
    var bulletDamage=type==='shooter'?Math.round(9*wave.damage):type==='elite'?Math.round(10*wave.damage):0;
    var base=ENEMY_BASE[type],point=this.spawnPoint(),enemy={id:this.idCounter++,type:type,x:point.x,y:point.y,r:base.r,speed:base.speed,damage:Math.round(base.damage*wave.damage),bulletDamage:bulletDamage,xp:base.xp,hp:base.hp*wave.hp,maxHp:base.hp*wave.hp,alive:true,far:0,orbitCd:0,cooldown:type==='charger'?1.4:type==='shooter'?1.2:type==='elite'?1.5:0,ai:'chase',timer:0,angle:0};
    this.enemies.push(enemy);return enemy;
  };
  Game.prototype.updateEnemies=function(dt){
    var self=this,p=this.player,limit=Math.max(1000,Math.hypot(this.width,this.height)/this.scale*1.5);
    this.enemies.forEach(function(enemy){
      if(!enemy.alive)return;enemy.orbitCd=Math.max(0,enemy.orbitCd-dt);var dx=p.x-enemy.x,dy=p.y-enemy.y,d=Math.hypot(dx,dy)||1,nx=dx/d,ny=dy/d;
      if(enemy.type==='charger')self.updateCharger(enemy,dt,nx,ny);
      else if(enemy.type==='shooter'){
        var move=d<260?-1:d>360?1:0;enemy.x+=nx*enemy.speed*move*dt;enemy.y+=ny*enemy.speed*move*dt;enemy.cooldown-=dt;
        if(enemy.cooldown<=0){self.fireEnemyBullet(enemy.x,enemy.y,nx,ny,220,enemy.bulletDamage,4);enemy.cooldown=2.2;}
      }else if(enemy.type==='elite'){
        enemy.x+=nx*enemy.speed*dt;enemy.y+=ny*enemy.speed*dt;enemy.cooldown-=dt;
        if(enemy.ai==='warn'){enemy.timer-=dt;if(enemy.timer<=0){for(var i=0;i<10;i++){var a=i*Math.PI/5;self.fireEnemyBullet(enemy.x,enemy.y,Math.cos(a),Math.sin(a),180,enemy.bulletDamage,4.5);}enemy.ai='chase';enemy.cooldown=3.8;}}
        else if(enemy.cooldown<=0){enemy.ai='warn';enemy.timer=.55;}
      }else{enemy.x+=nx*enemy.speed*dt;enemy.y+=ny*enemy.speed*dt;}
      if(Math.hypot(enemy.x-p.x,enemy.y-p.y)<enemy.r+p.r)self.damagePlayer(enemy.damage);
      if(d>limit){enemy.far+=dt;if(enemy.far>=3){var point=self.spawnPoint();enemy.x=point.x;enemy.y=point.y;enemy.far=0;}}else enemy.far=0;
    });
    this.enemies=this.enemies.filter(function(enemy){return enemy.alive;});
  };
  Game.prototype.updateCharger=function(enemy,dt,nx,ny){
    if(enemy.ai==='chase'){
      enemy.x+=nx*enemy.speed*dt;enemy.y+=ny*enemy.speed*dt;enemy.cooldown-=dt;
      if(enemy.cooldown<=0){enemy.ai='warn';enemy.timer=.5;enemy.angle=Math.atan2(ny,nx);}
    }else if(enemy.ai==='warn'){
      enemy.timer-=dt;if(enemy.timer<=0){enemy.ai='dash';enemy.timer=.42;}
    }else if(enemy.ai==='dash'){
      enemy.x+=Math.cos(enemy.angle)*260*dt;enemy.y+=Math.sin(enemy.angle)*260*dt;enemy.timer-=dt;if(enemy.timer<=0){enemy.ai='recover';enemy.timer=.55;}
    }else{enemy.timer-=dt;if(enemy.timer<=0){enemy.ai='chase';enemy.cooldown=3.4;}}
  };

  Game.prototype.damageMultiplier=function(){return 1+passiveValue('power',this.player.passives.power);};
  Game.prototype.intervalMultiplier=function(){return 1-passiveValue('cycle',this.player.passives.cycle);};
  Game.prototype.allTargets=function(range){
    var self=this,range2=range*range,targets=this.enemies.filter(function(enemy){return enemy.alive&&dist2(enemy,self.player)<=range2;});
    if(this.boss&&this.boss.hp>0&&dist2(this.boss,this.player)<=range2)targets.push(this.boss);
    return targets.sort(function(a,b){return dist2(a,self.player)-dist2(b,self.player)||a.id-b.id;});
  };
  Game.prototype.updateWeapons=function(dt){
    var p=this.player,cycle=this.intervalMultiplier(),damage=this.damageMultiplier();
    if(p.weapons.needle){
      p.cooldowns.needle-=dt;if(p.cooldowns.needle<=0){var targets=this.allTargets(560),level=p.weapons.needle;if(targets.length){var count=level>=3?2:1,amount=(level===1?18:level===2||level===3?25:31)*damage;for(var i=0;i<count&&this.playerBullets.length<MAX.playerBullets;i++)this.spawnNeedle(targets[Math.min(i,targets.length-1)],amount,level>=4?1:0);p.cooldowns.needle=.6*cycle;}else p.cooldowns.needle=.1;}
    }
    if(p.weapons.orbit)this.updateOrbit(dt,damage,cycle);
    if(p.weapons.arc){
      p.cooldowns.arc-=dt;if(p.cooldowns.arc<=0){var arcTargets=this.allTargets(460);if(arcTargets.length){this.fireArc(arcTargets[0],damage);p.cooldowns.arc=(p.weapons.arc>=3?.95:1.35)*cycle;}else p.cooldowns.arc=.1;}
    }
    if(p.weapons.beacon){
      p.cooldowns.beacon-=dt;if(p.cooldowns.beacon<=0){var point=this.densestTarget();if(point){var bl=p.weapons.beacon,r=bl===1?58:bl===2?72:bl===3?72:88,amount=(bl===1?40:bl===2?52:bl===3?52:70)*damage;this.addHazard({kind:'beacon',x:point.x,y:point.y,r:r,timer:bl>=3?.35:.45,damage:amount});p.cooldowns.beacon=(bl>=3?1.8:2.5)*cycle;}else p.cooldowns.beacon=.1;}
    }
  };
  Game.prototype.spawnNeedle=function(target,damage,pierce){
    var dir=normalize(target.x-this.player.x,target.y-this.player.y);this.playerBullets.push({x:this.player.x,y:this.player.y,vx:dir.x*620,vy:dir.y*620,r:5,life:1.2,target:target,damage:damage,pierce:pierce,hit:{}});
  };
  Game.prototype.updateOrbit=function(dt,damage,cycle){
    var level=this.player.weapons.orbit,count=level===1?2:level===2||level===3?3:4,radius=level>=3?82:70,amount=(level>=3?16:10)*damage,hitGap=(level>=4?.38:.55)*cycle;
    this.orbitAngle=(this.orbitAngle||0)+2.2*dt;
    for(var i=0;i<count;i++){
      var angle=this.orbitAngle+i*Math.PI*2/count,x=this.player.x+Math.cos(angle)*radius,y=this.player.y+Math.sin(angle)*radius;
      this.enemies.forEach(function(enemy){if(enemy.alive&&enemy.orbitCd<=0&&Math.hypot(enemy.x-x,enemy.y-y)<enemy.r+8){this.damageEnemy(enemy,amount);enemy.orbitCd=hitGap;}},this);
      if(this.boss&&this.boss.hp>0&&this.boss.orbitCd<=0&&Math.hypot(this.boss.x-x,this.boss.y-y)<this.boss.r+8){this.damageEnemy(this.boss,amount);this.boss.orbitCd=hitGap;}
    }
  };
  Game.prototype.fireArc=function(first,multiplier){
    var level=this.player.weapons.arc,count=level===1?2:level===2?3:level===3?3:5,jump=level>=4?170:145,amount=(level===1?22:level===2||level===3?28:35)*multiplier,current=first,used={};
    for(var i=0;i<count&&current;i++){
      used[current.id]=true;this.damageEnemy(current,amount);var from={x:current.x,y:current.y};
      var candidates=this.enemies.slice();if(this.boss)candidates.push(this.boss);
      current=candidates.filter(function(target){return target.alive!==false&&target.hp>0&&!used[target.id]&&dist2(target,from)<=jump*jump;}).sort(function(a,b){return dist2(a,from)-dist2(b,from)||a.id-b.id;})[0]||null;
      if(current)this.addEffect({kind:'line',x:from.x,y:from.y,x2:current.x,y2:current.y,ttl:.16,max:.16,color:'accent'});
    }
  };
  Game.prototype.densestTarget=function(){
    var targets=this.enemies.slice();if(this.boss&&this.boss.hp>0)targets.push(this.boss);if(!targets.length)return null;var radius=90,best=targets[0],bestCount=-1,self=this;
    targets.forEach(function(candidate){var count=targets.reduce(function(sum,target){return sum+(dist2(candidate,target)<=radius*radius?1:0);},0);if(count>bestCount||(count===bestCount&&(dist2(candidate,self.player)<dist2(best,self.player)||(dist2(candidate,self.player)===dist2(best,self.player)&&candidate.id<best.id)))){best=candidate;bestCount=count;}});
    return{x:best.x,y:best.y};
  };

  Game.prototype.updateProjectiles=function(dt){
    var self=this;
    this.playerBullets.forEach(function(bullet){
      if(bullet.target&&bullet.target.hp>0){var dir=normalize(bullet.target.x-bullet.x,bullet.target.y-bullet.y);bullet.vx=dir.x*620;bullet.vy=dir.y*620;}
      bullet.x+=bullet.vx*dt;bullet.y+=bullet.vy*dt;bullet.life-=dt;
      var targets=self.enemies.slice();if(self.boss)targets.push(self.boss);
      for(var i=0;i<targets.length&&bullet.life>0;i++){var target=targets[i];if(target.hp<=0||bullet.hit[target.id]||Math.hypot(target.x-bullet.x,target.y-bullet.y)>=target.r+bullet.r)continue;bullet.hit[target.id]=true;self.damageEnemy(target,bullet.damage);if(bullet.pierce>0)bullet.pierce--;else bullet.life=0;}
    });
    this.playerBullets=this.playerBullets.filter(function(bullet){return bullet.life>0;});
    this.enemyBullets.forEach(function(bullet){bullet.x+=bullet.vx*dt;bullet.y+=bullet.vy*dt;bullet.life-=dt;if(Math.hypot(bullet.x-self.player.x,bullet.y-self.player.y)<bullet.r+self.player.r){self.damagePlayer(bullet.damage);bullet.life=0;}});
    this.enemyBullets=this.enemyBullets.filter(function(bullet){return bullet.life>0&&Math.abs(bullet.x-self.player.x)<self.width/self.scale/2+240&&Math.abs(bullet.y-self.player.y)<self.height/self.scale/2+240;});
  };
  Game.prototype.fireEnemyBullet=function(x,y,nx,ny,speed,damage,life){if(this.enemyBullets.length>=MAX.enemyBullets)return;this.enemyBullets.push({x:x,y:y,vx:nx*speed,vy:ny*speed,r:6,damage:damage,life:life});};
  Game.prototype.damagePlayer=function(amount){if(this.player.invuln>0||this.player.dashTimer>0||this.state!=='PLAYING')return;this.player.hp=Math.max(0,this.player.hp-amount);this.player.invuln=.65;if(!this.reduced)this.addEffect({kind:'ring',x:this.player.x,y:this.player.y,r:12,maxR:44,ttl:.22,max:.22,color:'danger'});};
  Game.prototype.damageEnemy=function(target,amount){
    if(!target||target.hp<=0)return;target.hp-=amount;this.totalDamage+=amount;
    if(target===this.boss)return;
    if(target.hp<=0&&target.alive){target.alive=false;this.kills++;if(target.type==='elite')this.eliteKills++;this.dropXp(target.x,target.y,target.xp);if(target.type==='elite'||this.rng()<.02)this.dropRepair(target.x,target.y);}
  };
  Game.prototype.dropXp=function(x,y,value){
    if(this.drops.length<MAX.drops){this.drops.push({x:x,y:y,value:value});return;}
    var closest=this.drops[0],best=Infinity;this.drops.forEach(function(drop){var d=(drop.x-x)*(drop.x-x)+(drop.y-y)*(drop.y-y);if(d<best){best=d;closest=drop;}});closest.value+=value;
  };
  Game.prototype.dropRepair=function(x,y){if(this.repairs.length<MAX.repairs)this.repairs.push({x:x,y:y,life:20});};
  Game.prototype.updateDrops=function(dt){
    var self=this,p=this.player,radius=passiveValue('magnet',p.passives.magnet);
    this.drops.forEach(function(drop){var dx=p.x-drop.x,dy=p.y-drop.y,d=Math.hypot(dx,dy)||1;if(d<radius){drop.x+=dx/d*520*dt;drop.y+=dy/d*520*dt;}if(d<p.r+8){drop.collected=true;self.gainXp(drop.value);}});
    this.drops=this.drops.filter(function(drop){return!drop.collected;});
    this.repairs.forEach(function(drop){drop.life-=dt;var d=Math.hypot(p.x-drop.x,p.y-drop.y);if(d<radius){var n=normalize(p.x-drop.x,p.y-drop.y);drop.x+=n.x*520*dt;drop.y+=n.y*520*dt;}if(d<p.r+10){drop.collected=true;p.hp=Math.min(p.maxHp,p.hp+25);}});
    this.repairs=this.repairs.filter(function(drop){return!drop.collected&&drop.life>0;});
  };
  Game.prototype.gainXp=function(amount){
    this.player.xp+=amount;
    while(this.player.xp>=xpRequired(this.player.level)){this.player.xp-=xpRequired(this.player.level);this.player.level++;this.pendingLevels++;}
    if(this.pendingLevels>0&&this.state==='PLAYING')this.openUpgrade();
  };
  Game.prototype.openUpgrade=function(){this.state='LEVEL_UP';this.dom.upgrade.classList.add('show');this.dom.upgrade.setAttribute('aria-hidden','false');this.showUpgradeOptions();this.clearInput();};
  Game.prototype.showUpgradeOptions=function(){
    var self=this,options=generateUpgradeOptions(this.player,this.rng);this.dom.upgradeGrid.innerHTML='';
    options.forEach(function(option,index){var button=self.doc.createElement('button');button.type='button';button.className='upgrade-card';button.innerHTML=self.upgradeMarkup(option,index+1);button.addEventListener('click',function(){self.chooseUpgrade(option);});self.dom.upgradeGrid.appendChild(button);});
  };
  Game.prototype.upgradeMarkup=function(option,index){
    if(option.kind==='heal')return'<small>'+index+' / EMERGENCY</small><strong>紧急修复</strong><span>恢复 35 点机体完整度。</span><b>立即生效</b>';
    var level=option.kind==='weapon'?this.player.weapons[option.key]:this.player.passives[option.key],name=option.kind==='weapon'?WEAPON_NAMES[option.key]:PASSIVE_NAMES[option.key];
    return'<small>'+index+' / '+(option.kind==='weapon'?'WEAPON':'MODULE')+'</small><strong>'+name+'</strong><span>'+this.upgradeDescription(option.key,level+1)+'</span><b>Lv.'+level+' → Lv.'+(level+1)+'</b>';
  };
  Game.prototype.upgradeDescription=function(key,level){
    var text={
      needle:['','每 0.60 秒发射 1 枚，伤害 18。','单枚伤害提升至 25。','每轮发射 2 枚导向针。','单枚伤害 31，并穿透 1 个目标。'],
      orbit:['','2 个节点环绕，单次伤害 10。','节点增加至 3 个。','伤害 16，环绕半径提升至 82。','节点增加至 4 个，命中间隔降至 0.38 秒。'],
      arc:['','最多跃迁 2 个目标，每个伤害 22。','伤害 28，最多跃迁 3 个目标。','攻击间隔降至 0.95 秒。','伤害 35，最多跃迁 5 个目标。'],
      beacon:['','58 半径爆炸，伤害 40。','伤害 52，半径提升至 72。','间隔降至 1.80 秒，预警缩短。','伤害 70，半径提升至 88。'],
      power:['','所有武器伤害 +12%。','所有武器伤害 +24%。','所有武器伤害 +36%。'],
      cycle:['','攻击间隔 -8%。','攻击间隔 -16%。','攻击间隔 -24%。'],
      speed:['','移动速度 +8%。','移动速度 +16%。','移动速度 +24%。'],
      magnet:['','拾取半径提升至 120。','拾取半径提升至 170。','拾取半径提升至 230。'],
      frame:['','最大生命提升至 120。','最大生命提升至 145。','最大生命提升至 175。'],
      repair:['','每秒恢复 0.35 生命。','每秒恢复 0.70 生命。','每秒恢复 1.05 生命。']
    };return text[key][level];
  };
  Game.prototype.chooseUpgrade=function(option){
    if(this.state!=='LEVEL_UP')return;
    if(option.kind==='heal')this.player.hp=Math.min(this.player.maxHp,this.player.hp+35);
    else{
      var oldMax=this.player.maxHp;applyUpgradeToBuild(this.player,option);
      if(option.kind==='passive'&&option.key==='frame'){this.player.maxHp=passiveValue('frame',this.player.passives.frame);this.player.hp+=this.player.maxHp-oldMax;}
    }
    this.pendingLevels--;
    if(this.pendingLevels>0){this.showUpgradeOptions();return;}
    this.dom.upgrade.classList.remove('show');this.dom.upgrade.setAttribute('aria-hidden','true');
    if(this.bossWaiting){this.bossWaiting=false;this.spawnBoss();}else this.state='PLAYING';
    this.lastFrame=performance.now();this.acc=0;
  };

  Game.prototype.prepareBoss=function(){
    if(this.phase!=='WAVES')return;this.phase='BOSS_PENDING';this.enemies=[];this.enemyBullets=[];this.hazards=[];
    var xp=this.drops.reduce(function(sum,drop){return sum+drop.value;},0);this.drops=[];if(xp)this.gainXp(xp);
    this.bossWaiting=true;this.toast('最终裁定开始');
    if(this.pendingLevels===0){this.bossWaiting=false;this.spawnBoss();}
  };
  Game.prototype.spawnBoss=function(){
    this.phase='BOSS_PHASE_1';this.state='PLAYING';this.bossStartedAt=this.time;this.boss={id:this.idCounter++,type:'boss',x:this.player.x,y:this.player.y-340,r:42,hp:5400,maxHp:5400,speed:68,damage:14,phase:1,cycle:0,eventIndex:0,charge:0,chargeX:0,chargeY:0,chargeDamage:0,chargeHit:false,orbitCd:0};
    this.dom.bossHud.classList.add('show');this.toast('零号裁定机');
  };
  Game.prototype.updateBoss=function(dt){
    var boss=this.boss;if(!boss||boss.hp<=0)return;boss.orbitCd=Math.max(0,boss.orbitCd-dt);
    if(boss.phase===1&&boss.hp<=2700){boss.phase=2;boss.speed=90;boss.cycle=0;boss.eventIndex=0;this.phase='BOSS_PHASE_2';this.hazards=this.hazards.filter(function(h){return h.source!=='boss';});this.toast('裁定阶段');}
    if(boss.charge>0){boss.x+=boss.chargeX*dt;boss.y+=boss.chargeY*dt;boss.charge-=dt;if(!boss.chargeHit&&Math.hypot(boss.x-this.player.x,boss.y-this.player.y)<boss.r+this.player.r){this.damagePlayer(boss.chargeDamage);boss.chargeHit=true;}}
    else{var n=normalize(this.player.x-boss.x,this.player.y-boss.y);boss.x+=n.x*boss.speed*dt;boss.y+=n.y*boss.speed*dt;}
    boss.cycle+=dt;var events=boss.phase===1?[0,1.7,3.3]:[0,1.6,3.4],length=boss.phase===1?4.8:5.2;
    while(boss.eventIndex<events.length&&boss.cycle>=events[boss.eventIndex]){this.scheduleBossAttack(boss,boss.eventIndex);boss.eventIndex++;}
    if(boss.cycle>=length){boss.cycle-=length;boss.eventIndex=0;}
    if(Math.hypot(boss.x-this.player.x,boss.y-this.player.y)<boss.r+this.player.r)this.damagePlayer(boss.damage);
  };
  Game.prototype.scheduleBossAttack=function(boss,index){
    var angle=Math.atan2(this.player.y-boss.y,this.player.x-boss.x);
    if(boss.phase===1){if(index<2)this.addHazard({kind:'fan',timer:.35,angle:angle,source:'boss'});else this.addHazard({kind:'charge',timer:.6,angle:angle,speed:420,duration:.55,damage:20,source:'boss'});return;}
    if(index===0)this.addHazard({kind:'ringShot',timer:.35,rotation:(this.bossRingRotation=(this.bossRingRotation||0)+47*Math.PI/180),source:'boss'});
    else if(index===1){var px=this.player.x,py=this.player.y;[-100,0,100].forEach(function(offset){this.addHazard({kind:'collapse',x:px,y:py+offset,r:48,timer:.85,damage:16,group:this.time,source:'boss'});},this);}
    else this.addHazard({kind:'charge',timer:.45,angle:angle,speed:480,duration:.5,damage:22,source:'boss'});
  };
  Game.prototype.addHazard=function(hazard){if(this.hazards.length<MAX.hazards)this.hazards.push(hazard);};
  Game.prototype.updateHazards=function(dt){
    var self=this,collapseGroups={};
    this.hazards.forEach(function(h){h.timer-=dt;if(h.timer>0)return;h.done=true;
      if(h.kind==='collapse'){
        if(!collapseGroups[h.group])collapseGroups[h.group]=[];
        collapseGroups[h.group].push(h);
        return;
      }
      if(h.kind==='beacon'){
        self.enemies.forEach(function(enemy){if(enemy.alive&&Math.hypot(enemy.x-h.x,enemy.y-h.y)<=enemy.r+h.r)self.damageEnemy(enemy,h.damage);});
        if(self.boss&&self.boss.hp>0&&Math.hypot(self.boss.x-h.x,self.boss.y-h.y)<=self.boss.r+h.r)self.damageEnemy(self.boss,h.damage);
        self.addEffect({kind:'ring',x:h.x,y:h.y,r:8,maxR:h.r,ttl:.25,max:.25,color:'accent'});
      }else if(h.kind==='fan'&&self.boss&&self.boss.hp>0){for(var i=-2;i<=2;i++){var a=h.angle+i*12*Math.PI/180;self.fireEnemyBullet(self.boss.x,self.boss.y,Math.cos(a),Math.sin(a),260,10,3);}}
      else if(h.kind==='ringShot'&&self.boss&&self.boss.hp>0){for(var j=0;j<12;j++){if(j===0||j===1)continue;var ra=h.rotation+j*Math.PI/6;self.fireEnemyBullet(self.boss.x,self.boss.y,Math.cos(ra),Math.sin(ra),220,11,4);}}
      else if(h.kind==='charge'&&self.boss&&self.boss.hp>0){self.boss.charge=h.duration;self.boss.chargeX=Math.cos(h.angle)*h.speed;self.boss.chargeY=Math.sin(h.angle)*h.speed;self.boss.chargeDamage=h.damage;self.boss.chargeHit=false;}
    });
    Object.keys(collapseGroups).forEach(function(group){
      var zones=collapseGroups[group],hit=zones.some(function(h){return Math.hypot(self.player.x-h.x,self.player.y-h.y)<h.r+self.player.r;});
      if(hit)self.damagePlayer(zones[0].damage);
      zones.forEach(function(h){self.addEffect({kind:'ring',x:h.x,y:h.y,r:h.r,maxR:h.r+20,ttl:.22,max:.22,color:'danger'});});
    });
    this.hazards=this.hazards.filter(function(h){return!h.done;});
  };
  Game.prototype.addEffect=function(effect){if(this.effects.length<MAX.effects)this.effects.push(effect);};
  Game.prototype.updateEffects=function(dt){this.effects.forEach(function(effect){effect.ttl-=dt;});this.effects=this.effects.filter(function(effect){return effect.ttl>0;});};

  Game.prototype.finish=function(result){
    if(this.state==='RESULT')return;this.state='RESULT';this.phase='ENDED';this.doc.body.classList.remove('playing');this.dom.bossHud.classList.remove('show');this.dom.upgrade.classList.remove('show');this.dom.pause.classList.remove('show');this.dom.upgrade.setAttribute('aria-hidden','true');this.dom.pause.setAttribute('aria-hidden','true');var won=result==='win';this.commitRun(won);
    this.dom.resultCode.textContent=won?'PROTOCOL COMPLETE':result==='timeout'?'PROTOCOL TIMEOUT':'UNIT OFFLINE';
    this.dom.resultTitle.textContent=won?'任务完成':'任务失败';this.dom.resultReason.textContent=won?'零号裁定机已解除。':result==='timeout'?'协议超时，裁定机仍在运行。':'机体完整度归零。';
    var bossLeft=this.boss?Math.max(0,Math.ceil(this.boss.hp/this.boss.maxHp*100))+'%':'--';
    this.dom.resultStats.innerHTML='<div><strong>'+formatTime(this.time)+'</strong><span>战斗时间</span></div><div><strong>'+this.player.level+'</strong><span>最终等级</span></div><div><strong>'+this.kills+'</strong><span>击破数量</span></div><div><strong>'+(won?'0%':bossLeft)+'</strong><span>Boss 剩余</span></div>';
    var chips=[];Object.keys(WEAPON_NAMES).forEach(function(key){if(this.player.weapons[key])chips.push(WEAPON_NAMES[key]+' Lv.'+this.player.weapons[key]);},this);Object.keys(PASSIVE_NAMES).forEach(function(key){if(this.player.passives[key])chips.push(PASSIVE_NAMES[key]+' Lv.'+this.player.passives[key]);},this);
    this.dom.buildSummary.innerHTML=chips.map(function(text){return'<span>'+text+'</span>';}).join('');this.dom.result.classList.add('show');this.dom.result.setAttribute('aria-hidden','false');
  };
  Game.prototype.toast=function(text){var self=this;clearTimeout(this.toastTimer);this.dom.toast.textContent=text;this.dom.toast.classList.add('show');this.toastTimer=setTimeout(function(){self.dom.toast.classList.remove('show');},1100);};
  Game.prototype.updateHud=function(){
    if(!this.player)return;var hp=this.player.hp/this.player.maxHp,need=xpRequired(this.player.level),remaining=360-this.time;
    this.dom.hpFill.style.transform='scaleX('+clamp(hp,0,1)+')';this.dom.hpText.textContent=Math.ceil(this.player.hp)+' / '+this.player.maxHp;this.dom.time.textContent=formatTime(remaining);this.dom.level.textContent=this.player.level;this.dom.kills.textContent=this.kills;
    this.dom.xpFill.style.transform='scaleX('+clamp(this.player.xp/need,0,1)+')';this.dom.xpText.textContent=this.player.xp+' / '+need;
    var cooldown=this.player.dashCooldown;this.dom.dash.classList.toggle('cooling',cooldown>0);this.dom.dashText.textContent=cooldown>0?cooldown.toFixed(1):'冲刺';
    if(this.boss){this.dom.bossFill.style.transform='scaleX('+clamp(this.boss.hp/this.boss.maxHp,0,1)+')';this.dom.bossPhase.textContent=this.boss.phase===1?'校准阶段':'裁定阶段';}
  };

  Game.prototype.palette=function(){return this.doc.body.dataset.theme==='arcade'?{bg:'#07111c',grid:'rgba(70,215,232,.11)',player:'#46d7e8',playerCore:'#ff913f',enemy:'#ff665d',enemy2:'#a8c3ca',tank:'#bd7b54',elite:'#ff913f',bullet:'#ff7c64',xp:'#62e0c2',repair:'#8fe6a7',accent:'#46d7e8',danger:'#ff665d',warn:'#ff913f'}:{bg:'#eef5f3',grid:'rgba(47,128,110,.12)',player:'#2f806e',playerCore:'#e18a3d',enemy:'#d65e4a',enemy2:'#668f9b',tank:'#9a765c',elite:'#d87a38',bullet:'#d65e4a',xp:'#3c9b7e',repair:'#58a96c',accent:'#2f806e',danger:'#d65e4a',warn:'#e18a3d'};};
  Game.prototype.screenPoint=function(entity){return{x:this.width/2/this.scale+entity.x-this.player.x,y:this.height/2/this.scale+entity.y-this.player.y};};
  Game.prototype.render=function(){
    var ctx=this.ctx,palette=this.palette(),w=this.width,h=this.height,S=this.scale,vw=w/S,vh=h/S;ctx.setTransform(this.dpr,0,0,this.dpr,0,0);ctx.scale(S,S);ctx.clearRect(0,0,vw,vh);ctx.fillStyle=palette.bg;ctx.fillRect(0,0,vw,vh);
    var px=this.player?this.player.x:0,py=this.player?this.player.y:0,spacing=64,ox=((vw/2-px)%spacing+spacing)%spacing,oy=((vh/2-py)%spacing+spacing)%spacing;ctx.strokeStyle=palette.grid;ctx.lineWidth=1;ctx.beginPath();for(var x=ox;x<vw;x+=spacing){ctx.moveTo(x,0);ctx.lineTo(x,vh);}for(var y=oy;y<vh;y+=spacing){ctx.moveTo(0,y);ctx.lineTo(vw,y);}ctx.stroke();
    if(!this.player)return;this.drawHazards(ctx,palette);this.drawDrops(ctx,palette);this.drawProjectiles(ctx,palette);this.drawEnemies(ctx,palette);this.drawOrbit(ctx,palette);this.drawPlayer(ctx,palette);this.drawEffects(ctx,palette);
  };
  Game.prototype.visible=function(point,pad){return point.x>-pad&&point.x<this.width/this.scale+pad&&point.y>-pad&&point.y<this.height/this.scale+pad;};
  Game.prototype.drawPlayer=function(ctx,p){
    var x=this.width/2/this.scale,y=this.height/2/this.scale,flash=this.player.invuln>0&&Math.floor(this.player.invuln*20)%2===0;ctx.save();ctx.translate(x,y);ctx.globalAlpha=flash?.45:1;ctx.strokeStyle=p.player;ctx.fillStyle=p.player;ctx.lineWidth=3;ctx.beginPath();ctx.arc(0,0,16,0,Math.PI*2);ctx.stroke();ctx.rotate(Math.atan2(this.lastMove.y,this.lastMove.x)+Math.PI/2);ctx.beginPath();ctx.moveTo(0,-12);ctx.lineTo(7,9);ctx.lineTo(0,5);ctx.lineTo(-7,9);ctx.closePath();ctx.fill();ctx.fillStyle=p.playerCore;ctx.beginPath();ctx.arc(0,0,4,0,Math.PI*2);ctx.fill();ctx.restore();
  };
  Game.prototype.drawEnemies=function(ctx,p){
    var self=this;this.enemies.forEach(function(enemy){var s=self.screenPoint(enemy);if(!self.visible(s,50))return;ctx.save();ctx.translate(s.x,s.y);ctx.strokeStyle=enemy.type==='elite'?p.elite:p.enemy;ctx.fillStyle=enemy.type==='shooter'?p.enemy2:enemy.type==='tank'?p.tank:p.enemy;ctx.lineWidth=2;
      if(enemy.type==='chaser'){ctx.rotate(Math.PI/4);ctx.fillRect(-enemy.r*.7,-enemy.r*.7,enemy.r*1.4,enemy.r*1.4);}
      else if(enemy.type==='charger'){ctx.beginPath();ctx.moveTo(enemy.r,0);ctx.lineTo(-enemy.r*.8,enemy.r*.75);ctx.lineTo(-enemy.r*.8,-enemy.r*.75);ctx.closePath();ctx.fill();if(enemy.ai==='warn'){ctx.strokeStyle=p.warn;ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(Math.cos(enemy.angle)*170,Math.sin(enemy.angle)*170);ctx.stroke();}}
      else if(enemy.type==='shooter'){ctx.beginPath();for(var i=0;i<6;i++){var a=i*Math.PI/3;ctx.lineTo(Math.cos(a)*enemy.r,Math.sin(a)*enemy.r);}ctx.closePath();ctx.fill();ctx.stroke();}
      else if(enemy.type==='tank'){ctx.fillRect(-enemy.r,-enemy.r,enemy.r*2,enemy.r*2);ctx.strokeRect(-enemy.r*.55,-enemy.r*.55,enemy.r*1.1,enemy.r*1.1);}
      else{ctx.beginPath();ctx.arc(0,0,enemy.r,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.arc(0,0,enemy.r*.55,0,Math.PI*2);ctx.fill();if(enemy.ai==='warn'){ctx.globalAlpha=.7;ctx.beginPath();ctx.arc(0,0,enemy.r+12,0,Math.PI*2);ctx.stroke();}}
      if(enemy.type==='elite'){ctx.fillStyle=p.danger;ctx.fillRect(-enemy.r,-enemy.r-8,enemy.r*2*(enemy.hp/enemy.maxHp),3);}ctx.restore();
    });
    if(this.boss&&this.boss.hp>0){var b=this.screenPoint(this.boss);ctx.save();ctx.translate(b.x,b.y);ctx.strokeStyle=p.danger;ctx.fillStyle=this.boss.phase===1?p.enemy2:p.enemy;ctx.lineWidth=4;ctx.rotate(this.time*.35);ctx.beginPath();for(var j=0;j<8;j++){var ba=j*Math.PI/4,br=j%2?this.boss.r*.72:this.boss.r;ctx.lineTo(Math.cos(ba)*br,Math.sin(ba)*br);}ctx.closePath();ctx.fill();ctx.stroke();ctx.rotate(-this.time*.8);ctx.strokeStyle=p.warn;ctx.beginPath();ctx.arc(0,0,18,0,Math.PI*1.5);ctx.stroke();ctx.restore();}
  };
  Game.prototype.drawProjectiles=function(ctx,p){
    var self=this;ctx.fillStyle=p.accent;this.playerBullets.forEach(function(bullet){var s=self.screenPoint(bullet);ctx.beginPath();ctx.arc(s.x,s.y,bullet.r,0,Math.PI*2);ctx.fill();});ctx.fillStyle=p.bullet;this.enemyBullets.forEach(function(bullet){var s=self.screenPoint(bullet);ctx.beginPath();ctx.arc(s.x,s.y,bullet.r,0,Math.PI*2);ctx.fill();});
  };
  Game.prototype.drawDrops=function(ctx,p){
    var self=this;this.drops.forEach(function(drop){var s=self.screenPoint(drop);if(!self.visible(s,20))return;ctx.save();ctx.translate(s.x,s.y);ctx.rotate(Math.PI/4);ctx.fillStyle=p.xp;ctx.fillRect(-5,-5,10,10);ctx.restore();});this.repairs.forEach(function(drop){var s=self.screenPoint(drop);ctx.fillStyle=p.repair;ctx.fillRect(s.x-3,s.y-9,6,18);ctx.fillRect(s.x-9,s.y-3,18,6);});
  };
  Game.prototype.drawOrbit=function(ctx,p){
    var level=this.player.weapons.orbit;if(!level)return;var count=level===1?2:level===2||level===3?3:4,radius=level>=3?82:70;ctx.fillStyle=p.accent;for(var i=0;i<count;i++){var a=(this.orbitAngle||0)+i*Math.PI*2/count,s=this.screenPoint({x:this.player.x+Math.cos(a)*radius,y:this.player.y+Math.sin(a)*radius});ctx.beginPath();ctx.arc(s.x,s.y,8,0,Math.PI*2);ctx.fill();}
  };
  Game.prototype.drawHazards=function(ctx,p){
    var self=this;this.hazards.forEach(function(h){ctx.save();ctx.strokeStyle=h.kind==='beacon'?p.accent:p.danger;ctx.fillStyle=h.kind==='beacon'?'rgba(70,215,232,.08)':'rgba(255,102,93,.09)';ctx.setLineDash([7,6]);
      if(h.kind==='beacon'||h.kind==='collapse'){var s=self.screenPoint(h);ctx.beginPath();ctx.arc(s.x,s.y,h.r,0,Math.PI*2);ctx.fill();ctx.stroke();}
      else if(h.kind==='fan'&&self.boss){var b=self.screenPoint(self.boss);ctx.beginPath();ctx.moveTo(b.x,b.y);ctx.lineTo(b.x+Math.cos(h.angle)*260,b.y+Math.sin(h.angle)*260);ctx.stroke();}
      else if(h.kind==='charge'&&self.boss){var c=self.screenPoint(self.boss);ctx.beginPath();ctx.moveTo(c.x,c.y);ctx.lineTo(c.x+Math.cos(h.angle)*Math.max(self.width,self.height),c.y+Math.sin(h.angle)*Math.max(self.width,self.height));ctx.stroke();}
      else if(h.kind==='ringShot'&&self.boss){var r=self.screenPoint(self.boss);ctx.beginPath();ctx.arc(r.x,r.y,58,0,Math.PI*2);ctx.stroke();}ctx.restore();
    });
  };
  Game.prototype.drawEffects=function(ctx,p){
    var self=this;this.effects.forEach(function(effect){var alpha=effect.ttl/effect.max;ctx.save();ctx.globalAlpha=alpha;ctx.strokeStyle=effect.color==='danger'?p.danger:p.accent;ctx.lineWidth=3;if(effect.kind==='line'){var a=self.screenPoint(effect),b=self.screenPoint({x:effect.x2,y:effect.y2});ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}else{var s=self.screenPoint(effect),progress=1-alpha,r=effect.r+(effect.maxR-effect.r)*progress;ctx.beginPath();ctx.arc(s.x,s.y,r,0,Math.PI*2);ctx.stroke();}ctx.restore();});
  };

  function boot(){return new Game(document);}
  return{boot:boot,Game:Game,xpRequired:xpRequired,waveAt:waveAt,createRng:createRng,resolveOutcome:resolveOutcome,bossPhase:bossPhase,generateUpgradeOptions:generateUpgradeOptions,applyUpgradeToBuild:applyUpgradeToBuild,passiveValue:passiveValue,constants:{waves:WAVE_TABLE,max:MAX}};
});
