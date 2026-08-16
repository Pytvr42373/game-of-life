/* PAC-MAN 完整版 - 玩法模式 (modes.js) 经典/计时/生存/每日 + 本地双人 */
'use strict';
(function(win){
var PAC = win.PAC = win.PAC || {};
var LS = win.localStorage;

function pad(n){ return n<10? '0'+n : ''+n; }
function lsGet(k,fb){ try{ var v=LS.getItem(k); return v===null? fb : v; }catch(e){ return fb; } }
function lsSet(k,v){ try{ LS.setItem(k,String(v)); }catch(e){} }

var M = {};

M.dailyKey = function(){ var d=new Date(); return ''+d.getFullYear()+pad(d.getMonth()+1)+pad(d.getDate()); };
M.dailyMap = function(){
  var d=new Date();
  var h = d.getFullYear()*13 + (d.getMonth()+1)*7 + d.getDate()*3 + d.getDay();
  return h % PAC.MAPS.length;
};
M.dailyGoal = 2500;
M.dailyDone = function(){ return lsGet('pm_daily_'+M.dailyKey()+'_done','0')==='1'; };
M.dailyBest = function(){ return parseInt(lsGet('pm_daily_'+M.dailyKey()+'_best','0'),10)||0; };
M.markDaily = function(score){
  var k='pm_daily_'+M.dailyKey();
  lsSet(k+'_done','1');
  if(score>(parseInt(lsGet(k+'_best','0'),10)||0)) lsSet(k+'_best',score);
};

M.high = function(mode){ return parseInt(lsGet('pm_best_'+(mode||'adventure'),'0'),10)||0; };
M.tryHigh = function(mode,score){
  var k='pm_best_'+(mode||'adventure'), best=parseInt(lsGet(k,'0'),10)||0;
  if(score>best){ lsSet(k,score); return true; } return false;
};
M.overallHigh = function(){ return parseInt(lsGet('pm_highscore','0'),10)||0; };
M.tryOverall = function(score){ var b=parseInt(lsGet('pm_highscore','0'),10)||0; if(score>b){ lsSet('pm_highscore',score); return true;} return false; };
M.resetAll = function(){
  var keys=[]; for(var i=0;i<LS.length;i++){ var kk=LS.key(i); if(kk&&kk.indexOf('pm_')===0) keys.push(kk); }
  for(var j=0;j<keys.length;j++) LS.removeItem(keys[j]);
};

M.buildEngine = function(mode, sel){
  sel = sel||{};
  var opts = { mode:mode, mapIndex:sel.map, difficulty:sel.difficulty||'normal' };
  if(mode==='adventure'){ opts.lives=3; }
  else if(mode==='timed'){ opts.lives=Infinity; opts.livesInfinite=true; opts.timeLeft=60; }
  else if(mode==='survival'){ opts.lives=3; }
  else if(mode==='daily'){ opts.lives=3; opts.dailyGoal=M.dailyGoal; opts.stayMap=true; }
  else if(mode==='coins'){ opts.nPac=2; opts.noGhosts=true; opts.timeLeft=90; opts.lives=Infinity; opts.livesInfinite=true; }
  else if(mode==='split'){ opts.lives=Infinity; opts.livesInfinite=true; opts.timeLeft=90; }
  else if(mode==='vsghost'){ opts.playerGhost=true; opts.lives=3; }
  return new PAC.Engine(opts);
};

M.modeName = function(m){
  return { adventure:'经典冒险', timed:'计时赛', survival:'生存模式', daily:'每日挑战',
           split:'分屏竞速', coins:'抢金币', vsghost:'吃豆人vs幽灵' }[m]||m;
};

M.judge2P = function(engine, mode){
  var a=engine.pacs[0].score, b=engine.pacs[1]?engine.pacs[1].score:engine.playerScores[1];
  engine.playerScores[0]=a; engine.playerScores[1]=b;
  var msg='', win=0;
  if(mode==='vsghost'){
    if(engine.pacWin) win=1; else if(a>b) win=1; else if(b>a) win=2; else win=0;
  } else {
    if(a>b) win=1; else if(b>a) win=2; else win=0;
  }
  if(win===1) msg='P1 胜!'; else if(win===2) msg='P2 胜!'; else msg='平局!';
  return {p1:a, p2:b, win:win, msg:msg};
};

PAC.Modes = M;
})(typeof window!=='undefined'?window:this);
