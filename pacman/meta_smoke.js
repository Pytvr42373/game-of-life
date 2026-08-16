'use strict';
/* 全模块集成冒烟测试：加载全部 7 个 js，驱动真实引擎 + 元系统结算 */
const store = new Map();
global.localStorage = {
  getItem: k => store.has(k)? store.get(k) : null,
  setItem: (k,v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  key: i => Array.from(store.keys())[i] || null,
  get length(){ return store.size; }
};
function el(){ return { textContent:'', innerHTML:'', style:{}, className:'',
  classList:{add(){},remove(){},toggle(){},contains(){return false}},
  appendChild(){}, setAttribute(){}, addEventListener(){}, offsetWidth:0,
  getContext(){ return {setTransform(){},fillRect(){},beginPath(){},arc(){},fill(){},save(){},restore(){},translate(){},rotate(){},moveTo(){},closePath(){},fillText(){},stroke(){},strokeRect(){},setLineDash(){}}; } }; }
const els={};
global.document = { getElementById(id){ if(!els[id]) els[id]=el(); return els[id]; },
  createElement(){ return el(); }, body:{setAttribute(){},getComputedStyle(){return {}}}, addEventListener(){}, querySelectorAll(){return[];},
  createElementNS(){return el();} };
global.window = global;
if(!global.addEventListener) global.addEventListener = () => {};
global.performance = global.performance || { now: () => Date.now() };
global.requestAnimationFrame = () => 0; global.cancelAnimationFrame = ()=>{};
global.devicePixelRatio = 1;
global.getComputedStyle = () => ({ getPropertyValue: () => '' });

const dir = '/app/data/所有对话/主对话/gol_work/pacman/';
require(dir+'maps.js');
require(dir+'audio.js');
require(dir+'ghosts.js');
require(dir+'game.js');
require(dir+'modes.js');
require(dir+'ui.js');
require(dir+'meta.js');

const PAC = global.PAC;
const M = PAC.Meta;
const assert = require('assert');
console.log('modules loaded, PAC keys:', Object.keys(PAC).join(','));

function reset(){ for(const k of Array.from(store.keys())) store.delete(k); }

/* 真实引擎驱动 */
reset();
const eng = new PAC.Engine({ mode:'adventure', mapIndex:0, difficulty:'normal', lives:3 });
assert.ok(eng && eng.maze && eng.pac && eng.ghosts.length>0, 'engine constructed');
console.log('engine OK: ghosts='+eng.ghosts.length+', dots='+eng.maze.dotCount+', pellets='+eng.maze.pelletCount);

// 挂钩回调
eng.cb = {
  onDot: () => M.event('dot', eng),
  onGhostEat: () => M.event('ghost', eng),
  onFruit: () => M.event('fruit', eng),
  onLevelClear: () => M.event('levelClear', eng),
};
// 让吃豆人吃一个豆子
let dotCell=null;
for(let r=0;r<eng.maze.H && !dotCell;r++) for(let c=0;c<eng.maze.W;c++) if(eng.maze.grid[r][c].t==='dot'){ dotCell={r,c}; break; }
assert.ok(dotCell, 'found a dot');
eng.pac.r=dotCell.r; eng.pac.c=dotCell.c; eng.pac.pr=dotCell.r; eng.pac.pc=dotCell.c;
eng.onPacArrive(eng.pac);
assert.strictEqual(M.achHas('firstDot'), true, '初次吃豆成就');
assert.strictEqual(eng.pac.score>0, true);
console.log('吃豆事件→成就OK, score='+eng.pac.score);

// 模拟吃幽灵连击
eng.combo=4; M.event('ghost', eng); assert.strictEqual(M.achHas('combo4'), true, '反吃四连');
eng.combo=8; M.event('ghost', eng); assert.strictEqual(M.achHas('combo8'), true, '反吃8连(稀有)');
M.event('fruit', eng); assert.strictEqual(M.achHas('fruit'), true, '水果');
console.log('连击/水果成就OK');

// 结算: 1500 分
const res = M.settle('adventure', 1500, { dailyDone:false, win2P:false });
assert.strictEqual(res.coins, Math.floor(1500/80));          // 18
assert.strictEqual(M.coins(), 18);
assert.strictEqual(M.total(), 1500);
assert.strictEqual(M.rankFor().name, '小鸡');                 // 1500 >= 500
assert.strictEqual(M.achHas('score1k'), true, '1000分成就');
assert.strictEqual(M.achHas('score10k'), false, '10000分未达成');
console.log('结算OK: +'+res.coins+'币 累计='+res.total+' 段位='+M.rankFor().name);

// 每日挑战达标 → 连签
reset();
const dr = M.settle('daily', 2600, { dailyDone:true, win2P:false });
assert.strictEqual(dr.checkIn.days, 1, '每日达标自动连签1天');
assert.strictEqual(M.streakDays(), 1);
assert.strictEqual(M.achHas('daily1'), true, '每日挑战成就');
assert.strictEqual(M.coins()>=10+70, true, '币+连签奖励');
console.log('每日达标→连签OK: '+dr.checkIn.days+'天 +'+dr.checkIn.reward+'币');

// 双人胜利成就
reset();
const w = M.settle('split', 1200, { dailyDone:false, win2P:true });
assert.strictEqual(M.achHas('win2p'), true, '双人首胜成就');
console.log('双人胜利成就OK');

// 皮肤装备/免费抽
reset();
M.addCoins(1000);
assert.strictEqual(M.equipped(), 'classic');
M.addSkin('ocean'); M.equip('ocean'); assert.strictEqual(M.equipped(), 'ocean');
assert.strictEqual(M.equippedSkin().name, '深海蓝');
assert.strictEqual(M.freeDrawUsed(), false);
M.doFreeDraw(); assert.strictEqual(M.freeDrawUsed(), true, '每日免费抽占用');
console.log('皮肤装备/免费抽OK');

// 25000 分稀有成就
reset();
M.settle('adventure', 25000, {});
assert.strictEqual(M.achHas('score25k'), true, '25000分稀有成就');
assert.strictEqual(M.rankFor().name, '雄鹰', '25000→雄鹰');
console.log('25000分→雄鹰+稀有成就OK');

console.log('\n===== SMOKE TEST PASSED =====');
