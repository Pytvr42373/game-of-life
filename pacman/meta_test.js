'use strict';
/* ---- 浏览器环境 mock ---- */
const store = new Map();
global.localStorage = {
  getItem: k => store.has(k)? store.get(k) : null,
  setItem: (k,v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  key: i => Array.from(store.keys())[i] || null,
  get length(){ return store.size; }
};
function makeEl(){ return { textContent:'', innerHTML:'', style:{}, className:'',
  classList:{add(){},remove(){},toggle(){},contains(){return false}},
  appendChild(){}, setAttribute(){}, addEventListener(){}, offsetWidth:0 }; }
const els={};
global.document = { getElementById(id){ if(!els[id]) els[id]=makeEl(); return els[id]; },
  createElement(){ return makeEl(); }, body:{setAttribute(){}}, addEventListener(){}, querySelectorAll(){return[];} };
global.window = global;
global.PAC = global.PAC || {};
global.PAC.UI = global.PAC.UI || { toast(){}, show(){}, on(){}, pixelFont(){return '';} };

require('/app/data/所有对话/主对话/gol_work/pacman/meta.js');
const M = global.PAC.Meta;
const assert = require('assert');

function reset(){ for(const k of Array.from(store.keys())) store.delete(k); }

/* 1) 币经济公式 coins = max(10, floor(score/80)) */
reset();
assert.strictEqual(M.coinsForScore(0), 10, '0分保底10');
assert.strictEqual(M.coinsForScore(80), 10, '80分->10');
assert.strictEqual(M.coinsForScore(100), 10, '100分保底');
assert.strictEqual(M.coinsForScore(8000), 100);
assert.strictEqual(M.coinsForScore(100000), 1250);
assert.strictEqual(M.coinsForScore(79), 10);
console.log('[1] 币经济公式 OK');

/* 2) 段位阈值 */
reset();
const thresholds = M.RANKS.map(r=>r.min);
assert.deepStrictEqual(thresholds, [0,500,2000,5000,10000,20000,40000,80000,150000], '9段阈值');
assert.strictEqual(M.RANKS.length, 9);
assert.strictEqual(M.RANKS[0].name, '鹌鹑蛋');
assert.strictEqual(M.RANKS[8].name, '无敌凤凰蛋');
assert.strictEqual(M.rankIdx(0), 0);
assert.strictEqual(M.rankIdx(499), 0);
assert.strictEqual(M.rankIdx(500), 1);
assert.strictEqual(M.rankIdx(1999), 1);
assert.strictEqual(M.rankIdx(2000), 2);
assert.strictEqual(M.rankIdx(150000), 8);
assert.strictEqual(M.rankIdx(999999), 8);
console.log('[2] 段位阈值 OK');

/* 3) 段位累计升级 */
reset();
M.addTotal(400); assert.strictEqual(M.rankFor().name, '鹌鹑蛋');
M.addTotal(200); assert.strictEqual(M.rankFor().name, '小鸡');   // 600
M.addTotal(2000); assert.strictEqual(M.rankFor().name, '公鸡');  // 2600
let prog = M.rankProgress(10000); // 孔雀起点
assert.strictEqual(prog.rank.name, '孔雀'); assert.strictEqual(prog.next.name, '雄鹰'); assert.strictEqual(prog.pct, 0);
prog = M.rankProgress(15000); assert.strictEqual(prog.pct, 50);
prog = M.rankProgress(50000); assert.strictEqual(prog.rank.name, '金凤凰'); assert.strictEqual(prog.pct, 25); // (50000-40000)/(80000-40000)
console.log('[3] 段位累计与进度 OK');

/* 4) 抽卡: 保底逻辑 */
reset(); M.setPity(9);
let d = M.drawOne();
assert.strictEqual(d.rare, true, '第10抽强制保底稀有');
assert.strictEqual(M.pity(), 0, '出稀有后保底重置');
reset(); M.setPity(0);
const origRandom = Math.random;
let seq=[0.5, 0.0];
Math.random = () => seq.shift();
d = M.drawOne();
assert.strictEqual(d.rare, false, '>12%不稀有');
assert.strictEqual(M.pity(), 1, '未出稀有保底+1');
Math.random = origRandom;
console.log('[4] 抽卡保底逻辑 OK');

/* 5) 抽卡概率分布（20000次×100抽 = 200万抽） */
reset();
let rareCount=0, totalDraws=0, pityViolations=0, weeklyCount=0, rareDist={};
for(let t=0;t<20000;t++){
  reset(); let pity=0;
  for(let i=0;i<100;i++){
    let r=M.drawOne(); totalDraws++;
    if(r.rare){ rareCount++; rareDist[r.skin.id]=(rareDist[r.skin.id]||0)+1; pity=0; }
    else { pity++; if(pity>=10) pityViolations++; if(r.skin.limited) weeklyCount++; }
  }
}
const rate = rareCount/totalDraws*100;
const wkShare = weeklyCount/totalDraws*100;
console.log('  稀有率 = '+rate.toFixed(2)+'% (12%+10抽保底→长期期望≈16.6%)');
console.log('  霓虹紫金='+(rareDist.neon||0)+' 透明幽灵='+(rareDist.ghost||0));
console.log('  无稀有连续>9次违规 =', pityViolations);
console.log('  限定皮肤占比 = '+wkShare.toFixed(2)+'% (期望≈42%)');
assert.ok(rate>=15.0 && rate<=18.5, '稀有率范围(12%+10抽保底→长期≈16.6%)');
assert.strictEqual(pityViolations, 0, '绝不允许连抽10次无稀有');
assert.strictEqual(M.allSkins().length, 8, '共8款皮肤');
assert.strictEqual(M.weeklySkins().length, 2, '每周限定2款');
assert.ok(wkShare>=38 && wkShare<=46, '限定占比范围 '+wkShare);
console.log('[5] 抽卡概率分布/保底/皮肤数量 OK');

/* 5b) 重复皮肤折算金币 */
reset();
M.addCoins(1000); M.addSkin('ocean'); M.addSkin('neon'); M.addSkin('w_cherry');
const c0=M.coins();
let r=M.applyResult({skin:M.skinById('ocean')});   // 普通重复
assert.strictEqual(r.dup, true); assert.strictEqual(r.refund, 30); assert.strictEqual(M.coins(), c0+30);
r=M.applyResult({skin:M.skinById('neon')});        // 稀有重复
assert.strictEqual(r.refund, 80); assert.strictEqual(M.coins(), c0+30+80);
r=M.applyResult({skin:M.skinById('w_cherry')});    // 限定重复
assert.strictEqual(r.refund, 40);
r=M.applyResult({skin:M.skinById('emerald')});     // 未拥有→新增
assert.strictEqual(r.dup, false); assert.ok(M.hasSkin('emerald'));
console.log('[5b] 重复皮肤折算金币/新增皮肤 OK');

/* 6) 连签: 递增/封顶/断签重置(不扣币) */
const RealDate = global.Date;
let fakeNow = new Date('2026-01-01T10:00:00+08:00');
function FakeDate(...a){ return a.length? new RealDate(...a) : new RealDate(fakeNow.getTime()); }
FakeDate.now = () => fakeNow.getTime();
global.Date = FakeDate;

reset();
let ci = M.checkIn();
assert.strictEqual(ci.days, 1); assert.strictEqual(ci.reward, 70); assert.strictEqual(M.coins(), 70);
fakeNow = new Date('2026-01-02T10:00:00+08:00');
ci = M.checkIn();
assert.strictEqual(ci.days, 2); assert.strictEqual(ci.reward, 80); assert.strictEqual(M.coins(), 150);
ci = M.checkIn(); // 同一天重复签到
assert.strictEqual(ci.days, 2); assert.strictEqual(M.coins(), 150, '同天不重复发币');
fakeNow = new Date('2026-01-03T10:00:00+08:00');
let lastDays=0;
for(let i=0;i<10;i++){ ci = M.checkIn(); lastDays=ci.days; fakeNow = new Date(fakeNow.getTime()+86400000); }
assert.strictEqual(ci.reward, 130, '第7天起130封顶');
assert.ok(lastDays>=7);
console.log('  连签至 '+lastDays+' 天 · 奖励封顶 '+ci.reward+' (递增+封顶验证OK)');
// 断签重置（跳过一天）
reset();
fakeNow = new Date('2026-02-01T10:00:00+08:00');
M.checkIn();                                    // 第1天
fakeNow = new Date('2026-02-03T10:00:00+08:00'); // 跳过02-02 → 间隔>1天
const before = M.coins();
ci = M.checkIn();
assert.strictEqual(ci.days, 1, '断签重置为1');
assert.strictEqual(M.coins(), before+70, '断签不扣币(仍正常得当日奖励)');
console.log('[6] 连签递增/封顶/断签重置 OK');
global.Date = RealDate;

console.log('\n===== ALL TESTS PASSED =====');
