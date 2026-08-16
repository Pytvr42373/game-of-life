/* PAC-MAN 完整版 - 元系统 (meta.js)
   新手教程 / 成就 / 段位 / 金币 / 盲盒皮肤 / 连签
   零外部依赖 · 全程序化绘制 · localStorage 持久化 (pm_meta_*) */
'use strict';
(function(win){
var PAC = win.PAC = win.PAC || {};
var LS = win.localStorage;
var $ = function(id){ return document.getElementById(id); };

function lsGet(k,fb){ try{ var v=LS.getItem(k); return v===null?fb:v; }catch(e){ return fb; } }
function lsSet(k,v){ try{ LS.setItem(k,String(v)); }catch(e){} }
function lsJson(k,fb){ try{ var v=LS.getItem(k); return v?JSON.parse(v):fb; }catch(e){ return fb; } }
function lsSetJson(k,o){ try{ LS.setItem(k,JSON.stringify(o)); }catch(e){} }
function pad(n){ return n<10?'0'+n:''+n; }
function todayKey(){ var d=new Date(); return ''+d.getFullYear()+pad(d.getMonth()+1)+pad(d.getDate()); }
function dateStr(d){ return ''+d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }

var M = {};

/* ==================== 一、新手教程 ==================== */
M.TUTORIAL = [
  {icon:'🎮', title:'操作方式',  desc:'使用 方向键 / WASD 控制移动；手机端支持虚拟摇杆、方向键与在迷宫里滑动操控。'},
  {icon:'🟡', title:'游戏目标',  desc:'吃光迷宫中的所有豆子即可过关。注意躲避巡逻的幽灵，被碰到会损失生命！'},
  {icon:'💊', title:'大力丸',    desc:'吃到闪烁的大能量丸后，幽灵会变蓝变虚弱。这时主动撞上去，就能反吃幽灵得分！'},
  {icon:'🍒', title:'水果 · 连击', desc:'吃到一定数量豆子会出现水果加分；连吃幽灵可获得 200→400→800… 翻倍连击分！'},
  {icon:'❤️', title:'生命机制',  desc:'被幽灵碰到扣除 1 条生命，全部耗尽游戏结束。拿高分升段位、攒金币开皮肤吧！'},
];
M.tutorialDone = function(){ return lsGet('pm_tutorial_done','0')==='1'; };
M.markTutorialDone = function(){ lsSet('pm_tutorial_done','1'); };
M.tutIdx = 0;
M.showTutorial = function(){
  M.tutIdx=0; M.renderTutorial();
  if(PAC.UI && PAC.UI.show) PAC.UI.show('tutorial');
};
M.renderTutorial = function(){
  var s=M.TUTORIAL[M.tutIdx]||M.TUTORIAL[0];
  $('tutIcon').textContent=s.icon; $('tutTitle').textContent=s.title; $('tutDesc').textContent=s.desc;
  var dots=''; for(var i=0;i<M.TUTORIAL.length;i++){ dots+='<span class="tut-dot'+(i===M.tutIdx?' on':'')+'"></span>'; }
  $('tutDots').innerHTML=dots;
  var last=M.tutIdx>=M.TUTORIAL.length-1;
  $('tutNextBtn').textContent = last? '开始游戏 ▶' : '下一步 ▶';
  $('tutPrevBtn').style.visibility = M.tutIdx===0? 'hidden':'visible';
};
M.tutNext = function(){
  if(M.tutIdx>=M.TUTORIAL.length-1){ M.markTutorialDone(); PAC.UI.on('menu'); }
  else { M.tutIdx++; M.renderTutorial(); }
};
M.tutPrev = function(){ if(M.tutIdx>0){ M.tutIdx--; M.renderTutorial(); } };
M.tutSkip = function(){ M.markTutorialDone(); PAC.UI.on('menu'); };

/* ==================== 二、成就系统（10 项，2 稀有） ==================== */
M.ACH = [
  {id:'firstDot', icon:'🟡', name:'初次吃豆',   desc:'第一次吃到豆子',        rare:false},
  {id:'clearL1',  icon:'🏁', name:'通关首关',   desc:'通关第 1 关',          rare:false},
  {id:'combo4',   icon:'😈', name:'反吃四连',   desc:'大力丸连吃 4 个幽灵',   rare:false},
  {id:'fruit',    icon:'🍒', name:'水果猎人',   desc:'收集 1 次水果',         rare:false},
  {id:'score1k',  icon:'💯', name:'初露锋芒',   desc:'单局获得 1000 分',      rare:false},
  {id:'score10k', icon:'🔥', name:'万分开局',   desc:'单局获得 10000 分',     rare:false},
  {id:'daily1',   icon:'📅', name:'每日之星',   desc:'完成 1 次每日挑战',     rare:false},
  {id:'win2p',    icon:'🏆', name:'双人首胜',   desc:'在双人模式中获胜 1 场', rare:false},
  {id:'combo8',   icon:'⚡', name:'幽灵屠戮',   desc:'大力丸连吃 8 个幽灵',   rare:true},
  {id:'score25k', icon:'👑', name:'登峰造极',   desc:'单局获得 25000 分',     rare:true},
];
M.achList = function(){ return lsJson('pm_meta_ach',[]); };
M.achHas = function(id){ return M.achList().indexOf(id)>=0; };
M.achDef = function(id){ for(var i=0;i<M.ACH.length;i++) if(M.ACH[i].id===id) return M.ACH[i]; return null; };
M.achUnlock = function(id){
  if(M.achHas(id)) return false;
  var a=M.achList(); a.push(id); lsSetJson('pm_meta_ach',a);
  var d=M.achDef(id);
  if(d && PAC.UI) PAC.UI.toast((d.rare?'🏅 稀有成就 · ':'🏆 成就解锁 · ')+d.name, 2600);
  return true;
};
M.event = function(type, eng){
  if(type==='dot') M.achUnlock('firstDot');
  else if(type==='ghost'){ if(eng && eng.combo>=4) M.achUnlock('combo4'); if(eng && eng.combo>=8) M.achUnlock('combo8'); }
  else if(type==='fruit') M.achUnlock('fruit');
  else if(type==='levelClear'){ if(eng && eng.level===1) M.achUnlock('clearL1'); }
};
M.showAchievements = function(){
  var g=$('achGrid'); g.innerHTML='';
  var un=M.achList(), n=0;
  for(var i=0;i<M.ACH.length;i++){
    var a=M.ACH[i], has=un.indexOf(a.id)>=0; if(has) n++;
    var card=document.createElement('div');
    card.className='ach-card'+(has?' on':'')+(a.rare?' rare':'');
    card.innerHTML='<div class="ach-icon">'+a.icon+'</div>'+
      '<div class="ach-name">'+a.name+(a.rare?' <span class="rar">稀有</span>':'')+'</div>'+
      '<div class="ach-desc">'+a.desc+'</div>'+
      '<div class="ach-state">'+(has?'✓ 已解锁':'🔒 未解锁')+'</div>';
    g.appendChild(card);
  }
  $('achCount').textContent = n+' / '+M.ACH.length+' 已解锁';
  if(PAC.UI) PAC.UI.show('ach');
};

/* ==================== 三、段位系统（9 段位，纯成长） ==================== */
M.RANKS = [
  {name:'鹌鹑蛋',      min:0,      icon:'🥚'},
  {name:'小鸡',        min:500,    icon:'🐣'},
  {name:'公鸡',        min:2000,   icon:'🐓'},
  {name:'斗鸡',        min:5000,   icon:'🥊'},
  {name:'孔雀',        min:10000,  icon:'🦚'},
  {name:'雄鹰',        min:20000,  icon:'🦅'},
  {name:'金凤凰',      min:40000,  icon:'🪶'},
  {name:'圣兽',        min:80000,  icon:'🐲'},
  {name:'无敌凤凰蛋',  min:150000, icon:'🐉'},
];
M.total = function(){ return parseInt(lsGet('pm_meta_score','0'),10)||0; };
M.addTotal = function(score){ var t=M.total()+Math.max(0,Math.floor(score||0)); lsSet('pm_meta_score',t); return t; };
M.rankIdx = function(total){ var idx=0; for(var i=0;i<M.RANKS.length;i++) if(total>=M.RANKS[i].min) idx=i; return idx; };
M.rankFor = function(total){ return M.RANKS[M.rankIdx(total===undefined?M.total():total)]; };
M.rankProgress = function(total){
  var idx=M.rankIdx(total), r=M.RANKS[idx], next=M.RANKS[idx+1];
  if(!next) return {rank:r, next:null, pct:100};
  var pct=Math.min(100, Math.round((total-r.min)/(next.min-r.min)*100));
  return {rank:r, next:next, pct:pct};
};
M.celebrateRank = function(rank){
  var fx=$('rankFx'); if(!fx) return;
  $('rankFxIcon').textContent=rank.icon; $('rankFxName').textContent=rank.name;
  fx.classList.remove('show'); void fx.offsetWidth; fx.classList.add('show');
  setTimeout(function(){ fx.classList.remove('show'); }, 1900);
};
M.showRank = function(){
  var total=M.total(), prog=M.rankProgress(total);
  $('rankTop').innerHTML = '<div class="rank-cur">'+
    '<div class="rank-big">'+prog.rank.icon+' '+prog.rank.name+'</div>'+
    '<div class="rank-total">累计得分 <b>'+total+'</b></div>'+
    '<div class="rank-bar"><div class="rank-bar-in" style="width:'+prog.pct+'%"></div></div>'+
    (prog.next? '<div class="rank-next">距离 <b>'+prog.next.icon+' '+prog.next.name+'</b> 还需 '+Math.max(0,prog.next.min-total)+' 分 · '+prog.pct+'%</div>':'<div class="rank-next">已登顶 · 无敌凤凰蛋 🐉</div>')+
    '</div>';
  var g=$('rankList'); g.innerHTML='';
  var nowIdx=M.rankIdx(total);
  for(var i=M.RANKS.length-1;i>=0;i--){
    var r=M.RANKS[i], cur=i<=nowIdx;
    var row=document.createElement('div');
    row.className='rank-row'+(cur?' cur':'')+(i===nowIdx?' now':'');
    row.innerHTML='<span class="rank-ico">'+r.icon+'</span><span class="rank-nm">'+r.name+'</span><span class="rank-min">累计 ≥ '+r.min+'</span>'+(i===nowIdx?'<span class="rank-now">当前</span>':'');
    g.appendChild(row);
  }
  if(PAC.UI) PAC.UI.show('rank');
};

/* ==================== 四、金币经济 ==================== */
M.coins = function(){ return parseInt(lsGet('pm_meta_coins','0'),10)||0; };
M.addCoins = function(n){ var c=M.coins()+Math.max(0,Math.floor(n||0)); lsSet('pm_meta_coins',c); return c; };
M.takeCoins = function(n){ var c=M.coins()-n; if(c<0) return false; lsSet('pm_meta_coins',c); return true; };
M.coinsForScore = function(score){ return Math.max(10, Math.floor((score||0)/80)); };

/* ==================== 五、盲盒皮肤系统（8 款：4普/2稀/2每周限定） ==================== */
M.SKIN_NORMAL = [
  {id:'classic', name:'经典黄', color:'#ffe14d', pattern:'classic'},
  {id:'crimson', name:'烈焰红', color:'#ff4d6d', pattern:'classic'},
  {id:'ocean',   name:'深海蓝', color:'#3d7bff', pattern:'classic'},
  {id:'emerald', name:'翡翠绿', color:'#2ee6a8', pattern:'classic'},
];
M.SKIN_RARE = [
  {id:'neon',  name:'霓虹紫金', color:'#b57bff', pattern:'neon'},
  {id:'ghost', name:'透明幽灵', color:'rgba(214,226,255,0.55)', pattern:'ghost'},
];
M.WEEKLY_POOL = [
  {id:'w_cherry', name:'草莓甜心', color:'#ff7eb6'},
  {id:'w_mint',   name:'薄荷清风', color:'#9dffc0'},
  {id:'w_sunset', name:'落日橙红', color:'#ff9f43'},
  {id:'w_star',   name:'星夜幻紫', color:'#7a5cff'},
  {id:'w_snow',   name:'初雪纯白', color:'#f2f7ff'},
  {id:'w_aurora', name:'极光青碧', color:'#59e8c8'},
  {id:'w_gold',   name:'鎏金岁月', color:'#ffd23f'},
  {id:'w_rose',   name:'玫瑰绯红', color:'#ff5e78'},
];
M.weeklySkins = function(){
  var d=new Date();
  var w = Math.floor((d - new Date(d.getFullYear(),0,1))/(7*24*3600*1000));
  return [M.WEEKLY_POOL[w%M.WEEKLY_POOL.length], M.WEEKLY_POOL[(w+1)%M.WEEKLY_POOL.length]];
};
M.allSkins = function(){
  var ws=M.weeklySkins(), arr=[];
  for(var i=0;i<M.SKIN_NORMAL.length;i++) arr.push({id:M.SKIN_NORMAL[i].id,name:M.SKIN_NORMAL[i].name,color:M.SKIN_NORMAL[i].color,pattern:M.SKIN_NORMAL[i].pattern,rare:false,limited:false});
  for(var j=0;j<M.SKIN_RARE.length;j++) arr.push({id:M.SKIN_RARE[j].id,name:M.SKIN_RARE[j].name,color:M.SKIN_RARE[j].color,pattern:M.SKIN_RARE[j].pattern,rare:true,limited:false});
  for(var k=0;k<ws.length;k++) arr.push({id:ws[k].id,name:ws[k].name,color:ws[k].color,pattern:'classic',rare:false,limited:true});
  return arr;
};
M.skinById = function(id){ var all=M.allSkins(); for(var i=0;i<all.length;i++) if(all[i].id===id) return all[i]; return M.SKIN_NORMAL[0]; };
M.ownedSkins = function(){ var a=lsJson('pm_meta_skins',null); return a&&a.length?a:['classic']; };
M.hasSkin = function(id){ return M.ownedSkins().indexOf(id)>=0; };
M.addSkin = function(id){ var a=M.ownedSkins(); if(a.indexOf(id)<0){ a.push(id); lsSetJson('pm_meta_skins',a); } };
M.equipped = function(){ var e=lsGet('pm_meta_skin_eq','classic'); return M.hasSkin(e)?e:'classic'; };
M.equip = function(id){ if(M.hasSkin(id)){ lsSet('pm_meta_skin_eq',id); return true; } return false; };
M.equippedSkin = function(){ return M.skinById(M.equipped()); };

/* ---- 抽卡：稀有率 12%、10 抽保底、每日免费一抽、限定提升当周权重 ---- */
M.SINGLE_COST=100; M.TEN_COST=900;
M.pity = function(){ return parseInt(lsGet('pm_meta_pity','0'),10)||0; };
M.setPity = function(n){ lsSet('pm_meta_pity',n); };
M.freeDrawUsed = function(){ return lsGet('pm_meta_free_draw_'+todayKey(),'0')==='1'; };
M.markFreeDraw = function(){ lsSet('pm_meta_free_draw_'+todayKey(),'1'); };
M.drawOne = function(){
  var pity=M.pity(), forceRare = pity>=9;
  var isRare = forceRare || Math.random()<0.12;
  var skin;
  if(isRare){
    skin=M.SKIN_RARE[Math.floor(Math.random()*M.SKIN_RARE.length)];
    M.setPity(0);
  } else {
    var ws=M.weeklySkins(), pool=[];
    for(var i=0;i<M.SKIN_NORMAL.length;i++) pool.push({s:M.SKIN_NORMAL[i],w:1});
    for(var j=0;j<ws.length;j++) pool.push({s:{id:ws[j].id,name:ws[j].name,color:ws[j].color,pattern:'classic',limited:true},w:2});
    var tw=0; for(var k=0;k<pool.length;k++) tw+=pool[k].w;
    var rr=Math.random()*tw, acc=0, picked=pool[pool.length-1].s;
    for(var n=0;n<pool.length;n++){ acc+=pool[n].w; if(rr<acc){ picked=pool[n].s; break; } }
    skin=picked;
    M.setPity(pity+1);
  }
  return {skin:skin, rare:isRare};
};
M.applyResult = function(res){
  var s=res.skin;
  if(M.hasSkin(s.id)){
    var refund = s.rare? 80 : (s.limited? 40 : 30);
    M.addCoins(refund);
    res.dup=true; res.refund=refund;
  } else { M.addSkin(s.id); res.dup=false; }
  return res;
};
M.showGacha = function(){
  var p=M.pity();
  $('gachaTop').innerHTML = '<div class="gacha-info">🪙 金币 <b>'+M.coins()+'</b> · 保底进度 <b>'+(p>=9?'🔥 下抽保底!':p+'/10')+'</b>'+
    (M.freeDrawUsed()?'<span class="dim"> · 今日免费已用</span>':'<span class="good2"> · 今日可免费抽</span>')+'</div>';
  var ws=M.weeklySkins();
  $('gachaTop').innerHTML += '<div class="gacha-week">🎡 本周限定: '+ws[0].name+' · '+ws[1].name+'（权重提升）</div>';
  var g=$('skinGrid'); g.innerHTML='';
  var all=M.allSkins(), owned=M.ownedSkins(), eq=M.equipped();
  for(var i=0;i<all.length;i++){
    var s=all[i], has=owned.indexOf(s.id)>=0;
    var card=document.createElement('div');
    card.className='skin-card'+(has?' owned':'')+(s.rare?' rare':'')+(s.limited?' limited':'')+(s.id===eq?' eq':'');
    var chip = s.rare? '<span class="s-tag rar">稀有</span>' : s.limited? '<span class="s-tag lim">限定</span>' : '<span class="s-tag">普通</span>';
    card.innerHTML='<div class="skin-swat" style="background:'+s.color+'"></div>'+
      '<div class="skin-nm">'+s.name+'</div>'+chip+
      (s.id===eq? '<div class="skin-eq">✅ 已装备</div>' : has? '<div class="skin-eq">已拥有</div>' : '<div class="skin-eq lock">未拥有</div>')+
      (has && s.id!==eq? '<button class="skin-btn" onclick="PAC.Meta.equipSkin(\''+s.id+'\')">装备</button>' : '');
    g.appendChild(card);
  }
  var fb=$('freeBtn');
  fb.textContent = M.freeDrawUsed()? '🎁 今日免费已使用' : '🎁 每日免费一抽';
  fb.classList.toggle('used', M.freeDrawUsed());
  if(PAC.UI) PAC.UI.show('gacha');
};
M.equipSkin = function(id){ if(M.equip(id)){ PAC.UI.toast('已装备: '+M.skinById(id).name,1200); M.showGacha(); } };
M.doDraw = function(n){
  var need = n===10? M.TEN_COST : M.SINGLE_COST;
  if(M.coins()<need){ PAC.UI.toast('金币不足！还差 '+(need-M.coins())+' 币',1600); return; }
  M.takeCoins(need);
  var results=[], rareN=0, newN=0;
  for(var i=0;i<n;i++){ var r=M.drawOne(); M.applyResult(r); results.push(r); if(r.rare) rareN++; if(!r.dup) newN++; }
  M.showGacha();
  M.renderGachaResult(results, rareN);
  PAC.UI.toast('抽卡完成 · 稀有 ×'+rareN+' · 新皮肤 ×'+newN, 2400);
};
M.doFreeDraw = function(){
  if(M.freeDrawUsed()){ PAC.UI.toast('今日免费一抽已使用',1400); return; }
  M.markFreeDraw();
  var r=M.drawOne(); M.applyResult(r);
  M.showGacha();
  M.renderGachaResult([r], r.rare?1:0);
  PAC.UI.toast(r.dup? '重复皮肤 → +'+r.refund+' 币' : (r.rare? '✨ 稀有皮肤: '+r.skin.name : '新皮肤: '+r.skin.name), 2400);
};
M.renderGachaResult = function(results, rareN){
  var grid=$('grGrid'); grid.innerHTML='';
  $('grTitle').textContent = results.length>1? ('十连抽 · 稀有 ×'+rareN) : '抽取结果';
  for(var i=0;i<results.length;i++){
    var r=results[i], s=r.skin;
    var c=document.createElement('div');
    c.className='gr-card'+(r.rare?' rare':'')+(s.limited?' limited':'');
    c.style.animationDelay=(i*0.07)+'s';
    c.innerHTML='<div class="gr-swat" style="background:'+s.color+'"></div>'+
      '<div class="gr-nm">'+s.name+'</div>'+
      '<div class="gr-tag">'+(r.rare?'★ 稀有':(s.limited?'限定':'普通'))+'</div>'+
      (r.dup? '<div class="gr-dup">重复 +'+r.refund+'🪙</div>':'');
    grid.appendChild(c);
  }
  $('gachaResultOverlay').classList.add('show');
};
M.closeGachaResult = function(){ $('gachaResultOverlay').classList.remove('show'); };

/* ==================== 六、连签系统 ==================== */
M.streak = function(){ return lsJson('pm_meta_streak',{days:0,last:''}); };
M.streakDays = function(){ return M.streak().days||0; };
M.checkIn = function(){
  var st=M.streak(), today=dateStr(new Date());
  if(st.last===today) return {days:st.days, reward:0, new:false, dup:true};
  if(st.last){
    var diff=Math.round((new Date(today).getTime()-new Date(st.last).getTime())/86400000);
    st.days = (diff===1)? st.days+1 : 1;   // 断签重置为 1，不扣币
  } else { st.days=1; }
  st.last=today; lsSetJson('pm_meta_streak',st);
  var reward=Math.min(130, 60+st.days*10);  // 60+N×10，第 7 天起 130 封顶
  M.addCoins(reward);
  return {days:st.days, reward:reward, new:true};
};

/* ==================== 结算统一挂钩: 发币→段位累计→成就检测→每日签到 ==================== */
M.settle = function(mode, score, ctx){
  ctx=ctx||{};
  var coins=M.coinsForScore(score); M.addCoins(coins);
  var oldTotal=M.total();
  var newTotal=M.addTotal(score);
  var oldIdx=M.rankIdx(oldTotal), newIdx=M.rankIdx(newTotal);
  if(score>=1000) M.achUnlock('score1k');
  if(score>=10000) M.achUnlock('score10k');
  if(score>=25000) M.achUnlock('score25k');
  if(ctx.dailyDone) M.achUnlock('daily1');
  if(ctx.win2P) M.achUnlock('win2p');
  var ci=null;
  if(mode==='daily' && ctx.dailyDone){
    ci=M.checkIn();
    if(ci && ci.new && ci.reward>0) PAC.UI.toast('🔥 连签 '+ci.days+' 天 · 奖励 +'+ci.reward+' 币', 2800);
  }
  if(newIdx>oldIdx){ M.celebrateRank(M.RANKS[newIdx]); PAC.UI.toast('🎉 段位提升! '+M.RANKS[newIdx].icon+' '+M.RANKS[newIdx].name, 2800); }
  M.refreshMenuBar();
  return {coins:coins, total:newTotal, rank:M.RANKS[newIdx], next:M.RANKS[newIdx+1]||null, progress:M.rankProgress(newTotal), checkIn:ci};
};

/* ==================== 菜单栏 / 每日挑战行刷新 ==================== */
M.refreshMenuBar = function(){
  var mr=$('metaRank'); if(mr){ var r=M.rankFor(); mr.innerHTML=r.icon+' '+r.name; }
  var mc=$('metaCoins'); if(mc) mc.innerHTML='🪙 '+M.coins();
  var ms=$('metaStreak'); if(ms) ms.textContent='🔥 连签 '+M.streakDays()+' 天';
  var dl=$('dailyStreakLine');
  if(dl){ dl.textContent='🔥 已连签 '+M.streakDays()+' 天 · 每日挑战达标自动签到，奖励 70~130 币递增'; }
  var gc=$('gcCoins'); if(gc) gc.textContent=M.coins();
};

PAC.Meta = M;
})(typeof window!=='undefined'?window:this);
