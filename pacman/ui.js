/* PAC-MAN 完整版 - UI 管理 (ui.js) 屏幕/主题/输入/会话/循环/HUD */
'use strict';
(function(win){
var PAC = win.PAC = win.PAC || {};
var $ = function(id){ return document.getElementById(id); };
var LS = win.localStorage;

var U = PAC.UI = {};
var state = { theme:'arcade', map:0, diff:'normal' };
var session = null;

U.pixelFont = function(){ return state.theme==='arcade' ? "'Press Start 2P',monospace" : "'Orbitron',sans-serif"; };

/* ---------- 主题 ---------- */
U.theme = function(){ return state.theme; };
U.setTheme = function(t){
  state.theme=(t==='neon')?'neon':'arcade';
  document.body.setAttribute('data-theme',state.theme);
  try{ LS.setItem('pm_theme',state.theme); }catch(e){}
  $('setThemeBtn')&&($('setThemeBtn').textContent= state.theme==='arcade'?'切到霓虹':'切到街机');
  $('themeBtn')&&($('themeBtn').textContent='主题: '+(state.theme==='arcade'?'街机':'霓虹'));
};
U.toggleTheme = function(){ U.setTheme(state.theme==='arcade'?'neon':'arcade'); };

/* ---------- Toast ---------- */
U.toast = function(msg,ms){
  var t=$('toast'); t.textContent=msg; t.classList.add('show');
  clearTimeout(U._tt); U._tt=setTimeout(function(){ t.classList.remove('show'); }, ms||1800);
};

/* ---------- 屏幕切换 ---------- */
var scrNames=['menu','level','mode','twop','settings','game','tutorial','ach','rank','gacha'];
U.show = function(name){
  for(var i=0;i<scrNames.length;i++){ $('scr-'+scrNames[i]).classList.toggle('active', scrNames[i]===name); }
  if(name==='game'){ $('rotateHint').classList.add('show'); $('btnPause').classList.add('show'); }
  else { $('rotateHint').classList.remove('show'); $('btnPause').classList.remove('show'); }
};
U.on = function(action){
  PAC.Audio.unlock();
  switch(action){
    case 'menu': teardown(); U.show('menu'); refreshMenu(); break;
    case 'startAdventure': teardown(); state.map=0; state.diff='normal'; U.show('game'); startGame('adventure',{map:state.map,difficulty:state.diff}); break;
    case 'levelSelect': teardown(); buildMapGrid(); U.show('level'); break;
    case 'twoP': teardown(); U.show('twop'); break;
    case 'settings': teardown(); $('setHi').textContent=U.hi(); U.show('settings'); break;
    case 'modeSelect': $('modeTitle').textContent='选择玩法 · '+PAC.MAPS[state.map].name+' / '+PAC.DIFF[state.diff].name; U.show('mode'); if(PAC.Meta) PAC.Meta.refreshMenuBar(); break;
    case 'playClassic': U.show('game'); startGame('adventure',{map:state.map,difficulty:state.diff}); break;
    case 'playTimed': U.show('game'); startGame('timed',{map:state.map,difficulty:state.diff}); break;
    case 'playSurvival': U.show('game'); startGame('survival',{map:state.map,difficulty:state.diff}); break;
    case 'playDaily': U.show('game'); startGame('daily',{map:PAC.Modes.dailyMap(),difficulty:state.diff}); break;
    case 'playSplit': U.show('game'); startGame('split',{map:state.map,difficulty:state.diff}); break;
    case 'playCoins': U.show('game'); startGame('coins',{map:state.map,difficulty:state.diff}); break;
    case 'playVSGhost': U.show('game'); startGame('vsghost',{map:state.map,difficulty:state.diff}); break;
    /* ---------- 元系统入口 ---------- */
    case 'tutorial': if(PAC.Meta) PAC.Meta.showTutorial(); break;
    case 'ach': teardown(); if(PAC.Meta) PAC.Meta.showAchievements(); break;
    case 'rank': teardown(); if(PAC.Meta) PAC.Meta.showRank(); break;
    case 'gacha': teardown(); if(PAC.Meta) PAC.Meta.showGacha(); break;
  }
};
U.hi = function(){ return PAC.Modes.overallHigh(); };
function refreshMenu(){ $('hiBtn').textContent='最高分: '+PAC.Modes.overallHigh(); if(PAC.Meta) PAC.Meta.refreshMenuBar(); }

/* ---------- 选关页 ---------- */
U.pickDiff = function(d){ state.diff=d; var cs=document.querySelectorAll('#diffRow .diff-chip'); for(var i=0;i<cs.length;i++) cs[i].classList.toggle('sel',cs[i].getAttribute('data-d')===d); };
function buildMapGrid(){
  var g=$('mapGrid'); g.innerHTML='';
  for(var i=0;i<PAC.MAPS.length;i++){
    var m=PAC.MAPS[i];
    var card=document.createElement('div'); card.className='map-card'+(i===state.map?' sel':''); card.setAttribute('data-i',i);
    var cv=document.createElement('canvas'); cv.width=126; cv.height=114;
    card.appendChild(cv);
    var nm=document.createElement('div'); nm.className='mname'; nm.textContent=m.name; card.appendChild(nm);
    var de=document.createElement('div'); de.className='mdesc'; de.textContent=m.desc; card.appendChild(de);
    card.onclick=function(){ var k=parseInt(this.getAttribute('data-i'),10); state.map=k; var cs=g.children; for(var j=0;j<cs.length;j++) cs[j].classList.toggle('sel',j===k); };
    g.appendChild(card);
    var ctx=cv.getContext('2d');
    var maze=new PAC.Maze(m.rows); PAC.drawMaze(ctx, maze, 0,0,6,0, PAC.palette());
  }
}

/* ---------- 输入: 键盘 ---------- */
var keys={};
var P1K={up:['ArrowUp','KeyW'],down:['ArrowDown','KeyS'],left:['ArrowLeft','KeyA'],right:['ArrowRight','KeyD']};
var P2K={up:['KeyI'],down:['KeyK'],left:['KeyJ'],right:['KeyL']};
function readKeys(set){
  var x=0,y=0;
  if(any(set.up)) y=-1; else if(any(set.down)) y=1;
  if(any(set.left)) x=-1; else if(any(set.right)) x=1;
  return {x:x,y:y};
}
function any(arr){ for(var i=0;i<arr.length;i++) if(keys[arr[i]]) return true; return false; }

/* 触摸输入缓存: touchP1Arr[i]=引擎i的P1触摸, touchP2=单画布2P的P2触摸 */
var touchP1Arr=[{x:0,y:0},{x:0,y:0}], touchP2={x:0,y:0};
var isTouch=false;
function routeInputs(){
  if(!session) return;
  var kp1=readKeys(P1K), kp2=readKeys(P2K);
  var m=session.mode;
  if(m==='split'){
    var a1=(touchP1Arr[0].x||touchP1Arr[0].y)?touchP1Arr[0]:kp1;
    var a2=(touchP1Arr[1].x||touchP1Arr[1].y)?touchP1Arr[1]:kp2;
    session.engines[0].setInput(0,a1.x,a1.y);
    session.engines[1].setInput(0,a2.x,a2.y);
  } else {
    var b1=(touchP1Arr[0].x||touchP1Arr[0].y)?touchP1Arr[0]:kp1;
    session.engines[0].setInput(0,b1.x,b1.y);
    if(m==='coins'||m==='vsghost'){ var b2=(touchP2.x||touchP2.y)?touchP2:kp2; session.engines[0].setInput(1,b2.x,b2.y); }
  }
}

/* ---------- 摇杆 / 方向键 / 滑动 ---------- */
function dirFrom(dx,dy){ if(Math.abs(dx)<10&&Math.abs(dy)<10) return {x:0,y:0}; return Math.abs(dx)>Math.abs(dy)? {x:dx>0?1:-1,y:0} : {x:0,y:dy>0?1:-1}; }
function bindJoy(){
  var joy=$('joy'), knob=$('joyKnob'), active=false, cx=0, cy=0;
  function moveTo(t,id){
    var rect=joy.getBoundingClientRect();
    var tx=(t.clientX||t.touches[0].clientX), ty=(t.clientY||t.touches[0].clientY);
    var dx=tx-rect.left-rect.width/2, dy=ty-rect.top-rect.height/2;
    var max=rect.width/2-24; var len=Math.min(Math.sqrt(dx*dx+dy*dy),max);
    var ang=Math.atan2(dy,dx);
    knob.style.left=(50+Math.cos(ang)*len/rect.width*100)+'%';
    knob.style.top=(50+Math.sin(ang)*len/rect.height*100)+'%';
    touchP1Arr[0]=dirFrom(dx,dy);
  }
  joy.addEventListener('touchstart',function(e){ e.preventDefault(); active=true; moveTo(e,0); isTouch=true; $('joy').classList.add('show'); });
  joy.addEventListener('touchmove',function(e){ e.preventDefault(); if(active) moveTo(e,0); });
  function up(){ active=false; knob.style.left='50%'; knob.style.top='50%'; touchP1Arr[0]={x:0,y:0}; }
  joy.addEventListener('touchend',function(e){ e.preventDefault(); up(); });
  joy.addEventListener('touchcancel',function(e){ e.preventDefault(); up(); });
  var dpad=$('dpad');
  dpad.addEventListener('touchstart',function(e){
    e.preventDefault(); var b=e.target.closest('button'); if(!b) return; isTouch=true;
    var d=b.getAttribute('data-d'); touchP1Arr[0]= d==='up'?{x:0,y:-1}:d==='down'?{x:0,y:1}:d==='left'?{x:-1,y:0}:{x:1,y:0};
  },{passive:false});
  dpad.addEventListener('touchend',function(e){ e.preventDefault(); touchP1Arr[0]={x:0,y:0}; },{passive:false});
  dpad.addEventListener('touchcancel',function(e){ e.preventDefault(); touchP1Arr[0]={x:0,y:0}; },{passive:false});
}
function bindSwipe(){
  var cvWrap=$('canvasWrap');
  cvWrap.addEventListener('touchstart',function(e){ e.preventDefault(); isTouch=true; var t=e.touches[0]; _swipe={x:t.clientX,y:t.clientY,id:t.identifier,eng:-1,p2:false}; },{passive:false});
  cvWrap.addEventListener('touchmove',function(e){ e.preventDefault(); var t=e.touches[0]; if(!_swipe) return;
    var dx=t.clientX-_swipe.x, dy=t.clientY-_swipe.y; var d=dirFrom(dx,dy);
    if(d.x||d.y){ assignSwipeDir(d); } },{passive:false});
  cvWrap.addEventListener('touchend',function(e){ e.preventDefault(); _swipe=null; },{passive:false});
  cvWrap.addEventListener('touchcancel',function(e){ e.preventDefault(); _swipe=null; },{passive:false});
}
var _swipe=null;
function assignSwipeDir(d){
  if(!session) return;
  var m=session.mode;
  if(m==='split'){
    // 靠近哪个画布就控制哪个
    var wrap=$('canvasWrap').getBoundingClientRect();
    var cx=_swipe.x - wrap.left;
    var idx = cx < wrap.width/2 ? 0 : 1;
    touchP1Arr[idx]=d;
  } else {
    var wrap2=$('canvasWrap').getBoundingClientRect();
    if((m==='coins'||m==='vsghost') && _swipe.x > wrap2.left+wrap2.width/2){ touchP2=d; }
    else { touchP1Arr[0]=d; }
  }
}

/* ---------- 键盘监听 ---------- */
function bindKeys(){
  document.addEventListener('keydown',function(e){
    PAC.Audio.unlock();
    if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].indexOf(e.code)>=0) e.preventDefault();
    if(e.repeat) return;
    keys[e.code]=true;
    if(e.code==='Escape'||e.code==='KeyP') U.togglePause();
  });
  document.addEventListener('keyup',function(e){ keys[e.code]=false; });
}

function dirFromKey(code){
  if(code==='ArrowUp'||code==='KeyW') return {x:0,y:-1};
  if(code==='ArrowDown'||code==='KeyS') return {x:0,y:1};
  if(code==='ArrowLeft'||code==='KeyA') return {x:-1,y:0};
  if(code==='ArrowRight'||code==='KeyD') return {x:1,y:0};
  return {x:0,y:0};
}

/* ---------- 会话管理 ---------- */
function mirrorMap(idx){
  var rows=PAC.MAPS[idx].rows.slice();
  for(var i=0;i<rows.length;i++) rows[i]=rows[i].split('').reverse().join('');
  return rows;
}
function startGame(mode, sel){
  session = { mode:mode, sel:sel, engines:[], canvases:[], ctxs:[], over:false, paused:false, last:0, raf:0 };
  $('resultOverlay').classList.remove('show');
  $('pauseOverlay').classList.remove('show');
  var wrap=$('canvasWrap'); wrap.innerHTML='';
  var ts=20, w=PAC.MAPS[0].rows[0].length*ts, h=PAC.MAPS[0].rows.length*ts;
  var n = (mode==='split')? 2 : 1;
  for(var i=0;i<n;i++){
    var cv=document.createElement('canvas'); cv.className='game'+(n>1?' c2':'');
    wrap.appendChild(cv);
    var ctx=fitCanvas(cv,w,h);
    session.canvases.push(cv); session.ctxs.push(ctx);
    var eng;
    if(mode==='split'){
      var opts = {mode:'split', mapIndex:sel.map, difficulty:sel.difficulty, lives:Infinity, livesInfinite:true, timeLeft:90};
      eng = new PAC.Engine(opts);
      if(i===1){ eng.loadMap(sel.map); eng.maze = new PAC.Maze(mirrorMap(sel.map)); eng.pac.reset(); }
    } else {
      eng = PAC.Modes.buildEngine(mode, sel);
    }
    session.engines.push(eng);
    attachCallbacks(eng, mode, i);
  }
  buildHUD(mode);
  routeInputs();
  session.last = performance.now();
  session.raf = requestAnimationFrame(frame);
}
function fitCanvas(cv,w,h){
  var dpr = Math.min(win.devicePixelRatio||1, 2.5);
  cv.width=Math.round(w*dpr); cv.height=Math.round(h*dpr);
  cv.style.width=w+'px'; cv.style.height=h+'px';
  var ctx=cv.getContext('2d'); ctx.setTransform(dpr,0,0,dpr,0,0);
  return ctx;
}

function attachCallbacks(eng, mode, idx){
  var cb = eng.cb;
  cb.onPause = function(){ $('pauseOverlay').classList.add('show'); session.paused=true; PAC.Audio.pauseTone(); };
  cb.onResume = function(){ $('pauseOverlay').classList.remove('show'); session.paused=false; PAC.Audio.pauseTone(); };
  cb.onGameOver = function(){ endSession(); };
  cb.onTimeUp = function(){ endSession(); };
  cb.on2PEnd = function(){ endSession(); };
  cb.onLevelClear = function(){
    if(PAC.Meta) PAC.Meta.event('levelClear', eng);
    if(mode==='daily'){ PAC.Modes.markDaily(eng.pac.score); endSession(); }
    else if(mode==='vsghost'){ eng.pacWin=true; eng.finish2P(); }
  };
  cb.onDailyGoal = function(){ PAC.Modes.markDaily(eng.pac.score); U.toast('🎉 目标 '+PAC.Modes.dailyGoal+' 达成!',2500); };
  cb.onVSCatch = function(){ U.toast('👻 幽灵得分!',900); };
  /* 元系统成就事件 */
  cb.onDot = function(){ if(PAC.Meta) PAC.Meta.event('dot', eng); };
  cb.onGhostEat = function(){ if(PAC.Meta) PAC.Meta.event('ghost', eng); };
  cb.onFruit = function(){ if(PAC.Meta) PAC.Meta.event('fruit', eng); };
}

function endSession(){
  if(!session || session.over) return;
  session.over=true;
  cancelAnimationFrame(session.raf);
  for(var i=0;i<session.engines.length;i++){ PAC.Audio.stopSiren(); PAC.Audio.stopFright(); }
  var mode=session.mode, eng=session.engines[0], title='', msg='', detail='';
  var score = eng.pac.score;
  var winP1=false;
  if(mode==='adventure'){
    title='GAME OVER'; msg='本局得分 '+score;
    PAC.Modes.tryOverall(score); PAC.Modes.tryHigh('adventure',score);
  } else if(mode==='timed'){
    title='时间到!'; msg='得分 '+score;
    var nb=PAC.Modes.tryHigh('timed',score); detail='本模式最高分: '+PAC.Modes.high('timed'); if(nb) detail+=' (新纪录!)';
    PAC.Modes.tryOverall(score);
  } else if(mode==='survival'){
    title='挑战结束'; msg='坚持到第 '+eng.level+' 波';
    detail='得分 '+score; var nb2=PAC.Modes.tryHigh('survival',score); if(nb2) detail+=' (新纪录!)';
    PAC.Modes.tryOverall(score);
  } else if(mode==='daily'){
    var done=PAC.Modes.dailyDone(); var best=PAC.Modes.dailyBest();
    title= done? '每日挑战完成' : '每日挑战结束';
    msg= done? '🎉 今日达标!': '今日目标 '+PAC.Modes.dailyGoal+' 未达成';
    detail='本局得分 '+score+' · 今日最佳 '+best; PAC.Modes.tryOverall(score);
  } else if(mode==='split'){
    var s0=session.engines[0].pac.score, s1=session.engines[1].pac.score;
    title='分屏竞速 · 时间到';
    msg = s0>s1?'P1 胜!':s1>s0?'P2 胜!':'平局!';
    detail='P1: '+s0+' 分 · P2: '+s1+' 分';
    winP1 = s0>s1;
  } else if(mode==='coins'){
    var r=PAC.Modes.judge2P(eng,'coins'); title='抢金币 · 时间到'; msg=r.msg; detail='P1: '+r.p1+' 分 · P2: '+r.p2+' 分';
    winP1 = r.win===1;
  } else if(mode==='vsghost'){
    var r2=PAC.Modes.judge2P(eng,'vsghost');
    title='吃豆人 vs 幽灵';
    msg = eng.pacWin? 'P1 吃豆人 胜利!' : (r2.win===2?'P2 幽灵 胜利!':'平局');
    detail='P1 得分: '+r2.p1+' · P2 得分: '+r2.p2;
    winP1 = !!(eng.pacWin) || r2.win===1;
  }
  $('resTitle').textContent=title; $('resMsg').textContent=msg; $('resDetail').textContent=detail;
  /* ---------- 元系统结算挂钩: 发币→段位累计→成就检测→每日签到 ---------- */
  var metaLine=$('resMeta');
  if(metaLine && PAC.Meta && PAC.Meta.settle){
    var mres=PAC.Meta.settle(mode, score, { dailyDone: (mode==='daily')? PAC.Modes.dailyDone() : false, win2P: winP1 });
    var pr=mres.progress;
    metaLine.innerHTML='<div class="rm-row"><span>'+pr.rank.icon+' '+pr.rank.name+'</span><span>累计 '+mres.total+' 分</span><span class="good">+'+mres.coins+' 🪙</span></div>'+
      '<div class="rm-bar"><div class="rm-bar-in" style="width:'+pr.pct+'%"></div></div>'+
      '<div class="rm-sub">'+(pr.next? '下一段位 '+pr.next.icon+' '+pr.next.name+' · '+pr.pct+'%':'已达最高段位')+'</div>';
  }
  $('resultOverlay').classList.add('show');
  refreshMenu();
}

function buildHUD(mode){
  var hud=$('hud'); hud.innerHTML='';
  function cell(lb,id,cls){ var d=document.createElement('div'); d.className='hud-cell';
    var l=document.createElement('div'); l.className='lb'; l.textContent=lb; d.appendChild(l);
    var v=document.createElement('div'); v.className='vl '+cls; v.id=id; v.textContent='0'; d.appendChild(v); hud.appendChild(d); return v; }
  if(mode==='split'){ cell('P1 得分','hud_s0','good'); cell('P2 得分','hud_s1','info'); cell('剩余','hud_time','danger'); return; }
  if(mode==='coins'){ cell('P1','hud_s0','good'); cell('P2','hud_s1','info'); cell('剩余','hud_time','danger'); return; }
  if(mode==='vsghost'){ cell('P1 得分','hud_s0','good'); cell('幽灵得分','hud_s1','danger'); cell('剩余','hud_time','info'); return; }
  cell('得分','hud_score','good'); cell('最高','hud_hi','accent'); cell(mode==='timed'?'时间':mode==='survival'?'波次':'关卡','hud_level', mode==='timed'?'danger':'info'); cell('生命','hud_lives','');
}

function updateHUD(){
  if(!session) return;
  var mode=session.mode, eng=session.engines[0];
  function set(id,v){ var el=$(id); if(el) el.textContent=v; }
  if(mode==='split'){
    set('hud_s0',session.engines[0].pac.score); set('hud_s1',session.engines[1].pac.score);
    set('hud_time',Math.ceil(session.engines[0].timeLeft)); return;
  }
  if(mode==='coins'){ set('hud_s0',eng.pacs[0].score); set('hud_s1',eng.pacs[1].score); set('hud_time',Math.ceil(eng.timeLeft)); return; }
  if(mode==='vsghost'){ set('hud_s0',eng.pac.score); set('hud_s1',eng.playerScores[1]); set('hud_time',Math.ceil(eng.timeLeft)); return; }
  set('hud_score',eng.pac.score); set('hud_hi',PAC.Modes.high(session.mode));
  set('hud_level', mode==='timed'? Math.ceil(eng.timeLeft)+'s' : eng.level);
  var lv=$('hud_lives'); if(lv){ if(eng.livesInfinite){ lv.textContent='∞'; } else { lv.innerHTML=''; for(var i=0;i<Math.max(0,eng.lives);i++){ var s=document.createElement('span'); s.className='lives-ico'; lv.appendChild(s); } } }
}

/* ---------- 主循环 ---------- */
function frame(t){
  if(!session || session.over) return;
  var dt=Math.min(0.05,(t-session.last)/1000||0.016); session.last=t;
  routeInputs();
  for(var i=0;i<session.engines.length;i++){ session.engines[i].update(dt); if(session.over) return; }
  for(var j=0;j<session.engines.length;j++){ session.engines[j].render(session.ctxs[j], t/1000); }
  updateHUD();
  session.raf=requestAnimationFrame(frame);
}

U.togglePause = function(){ if(!session||session.over) return; var eng=session.engines[0]; eng.togglePause(); };
U.resume = function(){ if(session){ $('pauseOverlay').classList.remove('show'); for(var i=0;i<session.engines.length;i++) if(session.engines[i].state==='paused') session.engines[i].resume(); } };
U.restart = function(){ if(!session) return; var mode=session.mode, sel=session.sel; teardown(); startGame(mode, sel); };
U.vol = function(v){ PAC.Audio.setVolume(parseInt(v,10)/100); $('volVal').textContent=v; };
U.resetSave = function(){ PAC.Modes.resetAll(); U.setTheme('arcade'); PAC.Audio.setVolume(0.8); $('volSlider').value=80; $('volVal').textContent='80'; U.toast('存档已重置'); refreshMenu(); };

function teardown(){
  if(session){ session.over=true; cancelAnimationFrame(session.raf); PAC.Audio.stopSiren(); PAC.Audio.stopFright(); session=null; }
  $('resultOverlay').classList.remove('show'); $('pauseOverlay').classList.remove('show');
  touchP1Arr=[{x:0,y:0},{x:0,y:0}]; touchP2={x:0,y:0};
}

/* ---------- 启动 ---------- */
U.init = function(){
  var saved=null; try{ saved=LS.getItem('pm_theme'); }catch(e){}
  U.setTheme(saved==='neon'?'neon':'arcade');
  var vol=0.8; try{ vol=parseFloat(LS.getItem('pm_volume'))||0.8; }catch(e){}
  PAC.Audio.setVolume(vol);
  $('volSlider').value=Math.round(vol*100); $('volVal').textContent=Math.round(vol*100);
  refreshMenu();
  bindKeys(); bindJoy(); bindSwipe();
  // 首次手势解锁音频
  document.addEventListener('pointerdown',function(){ PAC.Audio.unlock(); },{once:false});
  document.addEventListener('touchstart',function(){ isTouch=true; $('joy').classList.add('show'); $('dpad').classList.add('show'); },{passive:true});
  var last=0; function autoPause(){ if(session&&!session.over&&document.hidden){ var eng=session.engines[0]; if(eng.state==='play'){ eng.pause(); } } }
  document.addEventListener('visibilitychange',autoPause);
  if(PAC.Meta && !PAC.Meta.tutorialDone()){ PAC.Meta.showTutorial(); }
  else { U.show('menu'); refreshMenu(); }
};

// 兜底: 某些浏览器 pointerdown 前 touch 已发生
win.addEventListener('load',function(){ U.init(); });
})(typeof window!=='undefined'?window:this);
