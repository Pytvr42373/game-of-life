/* ============================================================
 * stress_test.js - 长时/多组合压力测试
 * 验证：长时间对局 loop 持续、AI 全自动对局能推进、多地图×多角色无崩溃
 * 运行：node stress_test.js
 * ============================================================ */
'use strict';
// 轻量 stub（不渲染，只驱动逻辑 + 完整流程）
const CTX_METHODS=['beginPath','closePath','moveTo','lineTo','quadraticCurveTo','arc','ellipse','fill','stroke','fillText','drawImage','createLinearGradient','createRadialGradient','save','restore','translate','rotate','clearRect','fillRect','strokeRect','arcTo'];
function makeCtx(){const o={};for(const m of CTX_METHODS){o[m]=function(){return {addColorStop:function(){},width:10};};}return new Proxy(o,{get(t,p){if(p in t)return t[p];throw new TypeError('no '+String(p));},set(){return true;}});}
function makeEl(id){return {id,style:{},listeners:{},children:[],innerHTML:'',value:'',checked:false,appendChild(c){this.children.push(c);return c;},addEventListener(ev,fn){(this.listeners[ev]=this.listeners[ev]||[]).push(fn);},getContext(){return makeCtx();},setPointerCapture(){}};}
const els={};
globalThis.window=globalThis;globalThis.document={getElementById(id){if(!els[id])els[id]=makeEl(id);return els[id];},createElement(){return makeEl('x');},addEventListener(){}};
globalThis.localStorage={_d:{},getItem(k){return this._d[k]??null;},setItem(k,v){this._d[k]=String(v);},removeItem(k){delete this._d[k];}};
globalThis.performance={now:()=>Date.now()};
Object.defineProperty(globalThis,'navigator',{value:{maxTouchPoints:0},configurable:true});
globalThis.innerWidth=1280;globalThis.innerHeight=720;
globalThis.setTimeout=()=>1;
const winHandlers={};globalThis.addEventListener=(ev,fn)=>{(winHandlers[ev]=winHandlers[ev]||[]).push(fn);};
function keyDown(k){fireWin('keydown',{key:k,preventDefault:function(){}});} function keyUp(k){fireWin('keyup',{key:k,preventDefault:function(){}});}
function fireWin(ev,e){(winHandlers[ev]||[]).forEach(fn=>fn(e));}
const rafQueue=[];globalThis.requestAnimationFrame=(cb)=>{rafQueue.push(cb);return 1;};
const mapsMod=require('./maps.js'),charsMod=require('./chars.js'),audioMod=require('./audio.js');
Object.assign(globalThis,{MAPS:mapsMod.MAPS,parseMap:mapsMod.parseMap,tileSolid:mapsMod.tileSolid,TILE:mapsMod.TILE});
Object.assign(globalThis,{SURVIVORS:charsMod.SURVIVORS,HUNTERS:charsMod.HUNTERS,getSurvivor:charsMod.getSurvivor,getHunter:charsMod.getHunter});
globalThis.AudioSys=audioMod.AudioSys;
require('./game.js');require('./ai.js');require('./ui.js');
const Game=globalThis.Game,UI=globalThis.UI;

let failures = [];
function pump(n,label){
  for(let i=0;i<n;i++){
    if(!rafQueue.length){ failures.push(label+': 第'+i+'帧 loop 停止(卡住)'); return false; }
    try{ rafQueue.shift()(performance.now()+i*16); }
    catch(e){ failures.push(label+': 帧异常 '+e.message); return false; }
  }
  return true;
}
let pass=0, fail=0;
function check(name,cond){ console.log((cond?'PASS  ':'FAIL  ')+name); cond?pass++:fail++; }

// ===== 场景1: 长时全AI对局(玩家旁观, 监管者AI+求生者AI自动跑) =====
const g1 = new Game();
g1.startMatch({ mapIdx:0, difficulty:'normal', asHunter:true, hunterId:'hun_chase', charId:'med' });
g1.player=null;g1.playerIsHunter=false;g1.hunter.isPlayer=false;g1.hunter.isAI=true;g1.hunter.ai.active=true;
const dt=1/60;
let g1steps=0;
for(let i=0;i<7200;i++){ // 2 分钟
  g1.updateInput({x:0,y:0,interact:false,skill:false,skill2:false,crouch:false,pause:false});
  g1.update(dt);
  if(g1.state!=='playing') break;
  g1steps++;
}
check('场景1 全AI对局 2分钟不崩溃 (推进 '+g1steps+' 步, 状态='+g1.state+')', g1steps>600);

// ===== 场景2: 所有地图 × 全部求生者开局, 跑 30s =====
const charIds = SURVIVORS.map(function (c) { return c.id; });
for (let m = 0; m < MAPS.length; m++){
  for (let c = 0; c < charIds.length; c++){
    const g=new Game();
    g.startMatch({mapIdx:m, difficulty:'normal', asHunter:false, charId:charIds[c], hunterId:'hun_chase'});
    let steps=0;
    for(let i=0;i<1800;i++){
      g.updateInput({x:0,y:0,interact:false,skill:false,skill2:false,crouch:false,pause:false});
      g.update(dt);
      if(g.state!=='playing') break;
      steps++;
    }
    check('地图'+m+' 求生者'+charIds[c]+' 30s 不崩溃(step='+steps+')', steps>100);
  }
}

// ===== 场景3: 所有地图 × 全部监管者开局 =====
const hunterIds = HUNTERS.map(function (c) { return c.id; });
for(let m=0;m<MAPS.length;m++){
  for(const hid of hunterIds){
    const g=new Game();
    g.startMatch({mapIdx:m, difficulty:'nightmare', asHunter:true, charId:'med', hunterId:hid});
    let steps=0;
    for(let i=0;i<1800;i++){
      g.updateInput({x:0,y:0,interact:false,skill:true,skill2:true,crouch:false,pause:false});
      g.update(dt);
      if(g.state!=='playing') break;
      steps++;
    }
    check('地图'+m+' 监管者'+hid+' 30s 不崩溃(step='+steps+',state='+g.state+')', steps>100);
  }
}

// ===== 场景4: UI 完整渲染链路 2分钟 =====
const g4=new Game();
UI.start(g4);
pump(5,'UI启动');
g4.startMatch({mapIdx:2,difficulty:'normal',asHunter:false,charId:'run',hunterId:'hun_tele'});
const ok4=pump(7200,'UI对局2分钟');
check('UI 渲染链路 2分钟 loop 持续', ok4);

console.log('\n通过 '+pass+' / '+(pass+fail)+' 失败 '+fail);
if(failures.length){console.log('失败详情:');failures.forEach(f=>console.log('  - '+f));}
if(fail>0||failures.length) process.exit(1);
console.log('STRESS TEST OK');
