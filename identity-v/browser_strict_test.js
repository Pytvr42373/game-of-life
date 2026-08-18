/* ============================================================
 * browser_strict_test.js - 严格浏览器运行时测试
 * 真实 ctx stub（未定义方法调用抛错）+ 完整交互流程 + 卡住检测
 * 运行：node browser_strict_test.js
 * ============================================================ */
'use strict';

let ok = true;
let errors = [];
function check(name, cond, extra) {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  [' + extra + ']' : ''));
  if (!cond) ok = false;
}

// ---------- 严格 canvas 2d context ----------
const CTX_METHODS = [
  'beginPath','closePath','moveTo','lineTo','bezierCurveTo','quadraticCurveTo',
  'arc','arcTo','ellipse','rect','fill','stroke','clip',
  'isPointInPath','isPointInStroke','fillText','strokeText','measureText','drawImage',
  'createImageData','getImageData','putImageData','createLinearGradient','createRadialGradient',
  'createPattern','getLineDash','setLineDash','getTransform','setTransform','resetTransform',
  'transform','translate','rotate','scale','save','restore','clearRect','fillRect','strokeRect'
];
const CTX_PROPS = ['fillStyle','strokeStyle','lineWidth','font','textAlign','textBaseline','globalAlpha','globalCompositeOperation','shadowBlur','shadowColor','shadowOffsetX','shadowOffsetY','lineCap','lineJoin','miterLimit','lineDashOffset'];
function makeGradient() { return { addColorStop: function(){} }; }
function makeCtx() {
  const o = {};
  for (const m of CTX_METHODS) {
    if (m === 'createLinearGradient' || m === 'createRadialGradient' || m === 'createPattern') o[m] = function () { return makeGradient(); };
    else if (m === 'measureText') o[m] = function () { return { width: 10 }; };
    else if (m === 'getImageData' || m === 'createImageData') o[m] = function () { return { data: new Uint8ClampedArray(4), width: 1, height: 1 }; };
    else if (m === 'getTransform') o[m] = function () { return { a:1,b:0,c:0,d:1,e:0,f:0 }; };
    else if (m === 'getLineDash') o[m] = function () { return []; };
    else if (m === 'isPointInPath' || m === 'isPointInStroke') o[m] = function () { return false; };
    else o[m] = function () {};
  }
  for (const p of CTX_PROPS) o[p] = p === 'globalAlpha' ? 1 : (p === 'lineWidth' ? 1 : (p === 'font' ? '10px serif' : (p === 'textAlign' ? 'left' : (p === 'textBaseline' ? 'alphabetic' : (p === 'fillStyle' || p === 'strokeStyle') ? '#000' : 0))));
  return new Proxy(o, {
    get(t, p) {
      if (p === 'canvas') return undefined;
      if (typeof p === 'symbol') return undefined;
      if (p in t) return t[p];
      throw new TypeError('CanvasRenderingContext2D 没有成员: ' + String(p));
    },
    set() { return true; }
  });
}

// ---------- DOM stub（支持父子关系） ----------
function makeEl(id) {
  const el = {
    id: id, style: {}, className: '', textContent: '', innerHTML: '', value: '', checked: false,
    width: 0, height: 0, type: '', children: [], parent: null,
    listeners: {},
    addEventListener: function (ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
    appendChild: function (child) { this.children.push(child); child.parent = this; this.innerHTML += '<child/>'; return child; },
    append: function (child) { return this.appendChild(child); },
    setPointerCapture: function () {},
    getContext: function () { return makeCtx(); }
  };
  return el;
}
const els = {};
const doc = {
  getElementById: function (id) { if (!els[id]) els[id] = makeEl(id); return els[id]; },
  createElement: function (tag) { if (tag === 'canvas') { const c = makeEl('c'); c.getContext = function () { return makeCtx(); }; return c; } return makeEl(tag); },
  addEventListener: function () {},
  body: { appendChild: function(){} }
};

globalThis.window = globalThis;
globalThis.document = doc;
globalThis.localStorage = {
  _d: {},
  getItem: function (k) { return this._d[k] !== undefined ? this._d[k] : null; },
  setItem: function (k, v) { this._d[k] = String(v); },
  removeItem: function (k) { delete this._d[k]; }
};
globalThis.performance = { now: function () { return Date.now(); } };
Object.defineProperty(globalThis, 'navigator', { value: { maxTouchPoints: 0 }, configurable: true });
globalThis.innerWidth = 1280;
globalThis.innerHeight = 720;
globalThis.setTimeout = function (fn) { return 1; };
globalThis.clearTimeout = function () {};

const winHandlers = {};
globalThis.addEventListener = function (ev, fn) { (winHandlers[ev] = winHandlers[ev] || []).push(fn); };
function fireWin(ev, e) { (winHandlers[ev] || []).forEach(function (fn) { try { fn(e); } catch (err) { errors.push('window handler [' + ev + '] 异常: ' + err.message); } }); }
function fireElRecursive(el, ev, e) {
  (el.listeners[ev] || []).forEach(function (fn) { try { fn(e || {}); } catch (err) { errors.push('click handler 异常: ' + (err && err.stack ? err.stack.split('\n')[0] : err)); } });
  el.children.slice().forEach(function (c) { fireElRecursive(c, ev, e); });
}
function fireEl(id, ev, e) { const el = els[id]; if (el) fireElRecursive(el, ev, e); }
function keyDown(k) { fireWin('keydown', { key: k, preventDefault: function(){} }); }
function keyUp(k) { fireWin('keyup', { key: k, preventDefault: function(){} }); }

const rafQueue = [];
let rafId = 0;
globalThis.requestAnimationFrame = function (cb) { rafQueue.push(cb); return ++rafId; };
globalThis.cancelAnimationFrame = function () {};

// ---------- 加载模块 ----------
const mapsMod = require('./maps.js');
const charsMod = require('./chars.js');
const audioMod = require('./audio.js');
Object.assign(globalThis, { MAPS: mapsMod.MAPS, parseMap: mapsMod.parseMap, tileSolid: mapsMod.tileSolid, TILE: mapsMod.TILE, mapConnectivity: mapsMod.mapConnectivity });
Object.assign(globalThis, { SURVIVORS: charsMod.SURVIVORS, HUNTERS: charsMod.HUNTERS, getSurvivor: charsMod.getSurvivor, getHunter: charsMod.getHunter });
globalThis.AudioSys = audioMod.AudioSys;
require('./game.js');
require('./ai.js');
require('./ui.js');

const Game = globalThis.Game;
const UI = globalThis.UI;

function pump(n, label) {
  let stopped = false;
  for (let i = 0; i < n; i++) {
    if (rafQueue.length === 0) {
      errors.push('[' + label + '] 第 ' + i + ' 帧后 RAF 队列为空 → loop 已停止（卡住）');
      stopped = true;
      break;
    }
    const cb = rafQueue.shift();
    try { cb(performance.now() + i * 16); }
    catch (e) { errors.push('[' + label + '] loop 帧异常: ' + (e && e.stack ? e.stack : String(e))); }
  }
  return !stopped;
}

// ================= 主流程 =================
const game = new Game();
UI.start(game);

check('主菜单渲染(loop 持续调度)', pump(3, '主菜单'));
check('菜单面板显示为 flex', els['menu'] && els['menu'].style.display === 'flex');
check('G.state = menu', game.state === 'menu');

// 设置
fireEl('btn-settings', 'click');
pump(2, '设置');
check('设置面板显示(不被菜单兜底拉回)', els['settings'] && els['settings'].style.display === 'flex', 'settings=' + (els['settings'] ? els['settings'].style.display : '?') + ' menu=' + (els['menu'] ? els['menu'].style.display : '?'));
fireEl('btn-back-settings', 'click');
pump(2, '返回');
check('返回主菜单', els['menu'] && els['menu'].style.display === 'flex');

// 开始求生 → 选择角色
fireEl('btn-start', 'click');
pump(2, '角色选择');
check('角色选择面板显示(不被菜单兜底拉回)', els['charsel'] && els['charsel'].style.display === 'flex', 'charsel=' + (els['charsel'] ? els['charsel'].style.display : '?') + ' menu=' + (els['menu'] ? els['menu'].style.display : '?'));
check('角色卡片已构建(6个)', els['charsel-list'] && els['charsel-list'].children.length === 6, 'children=' + (els['charsel-list'] ? els['charsel-list'].children.length : 0));

// 点击第一张卡 → 开始对局
fireEl('charsel-list', 'click');
pump(5, '对局开始');
check('对局开始 state=playing', game.state === 'playing', 'state=' + game.state);
check('玩家为求生者', game.player && game.player.kind === 'survivor');
check('求生者 AI 已创建', game.survivors.filter(function (s) { return s.ai; }).length >= 2);
check('监管者 AI 已创建', !!(game.hunter && game.hunter.ai));

// 移动 1s
keyDown('w'); keyDown('d');
pump(60, '移动1s');
keyUp('w'); keyUp('d');

// 15 秒对局
check('对局 15s loop 仍在运行', pump(900, '对局15s'));

// 修机：选一台未被 AI 占用且未解码的机器
let m0 = null;
for (let mi = 0; mi < game.machines.length; mi++) {
  if (!game.machines[mi].decoded && !game.machines[mi].occupiedBy) { m0 = game.machines[mi]; break; }
}
check('存在可用密码机', !!m0);
game.player.x = m0.x; game.player.y = m0.y;
game.updateInput({ x:0, y:0, interact:true, skill:false, skill2:false, crouch:false, pause:false });
game.update(1/60);
game.updateInput({ x:0, y:0, interact:false, skill:false, skill2:false, crouch:false, pause:false });
pump(30, '修机');
check('玩家开始修机 decoding', !!(game.player && game.player.decoding));
pump(300, '修机5s');
check('修机进度增加', m0.progress > 0 || m0.decoded);

if (game.check) { game.pressCheck(); pump(10, '校准'); check('校准被处理', !game.check); }

// 攻击
game.hunter.x = game.player.x + 20; game.hunter.y = game.player.y;
game.hunter.dir = Math.atan2(game.player.y - game.hunter.y, game.player.x - game.hunter.x);
game.hunter.atkCd = 0; game.hunter.stunT = 0; game.hunter.carrying = null; game.hunter.ai.active = false;
game.hunterAttack(game.hunter);
pump(10, '受击');
check('玩家受伤 hp<2 或护盾', game.player.hp < 2, 'hp=' + game.player.hp);

// 结算（求生者胜）
game.endMatch('survivor_win');
pump(3, '结算');
check('结算面板显示', els['result'] && els['result'].style.display === 'flex');
check('结算标题已设置', els['result-title'] && els['result-title'].textContent !== '—', els['result-title'] ? els['result-title'].textContent : 'null');

// 再来一局
fireEl('btn-again', 'click');
pump(3, '再来一局');
check('再来一局 state=playing', game.state === 'playing');

// 暂停（键盘 Esc）→ 恢复 → 再暂停 → 退出
keyDown('escape');
pump(2, '暂停');
check('暂停面板显示(Esc)', els['pause'] && els['pause'].style.display === 'flex');
check('暂停 state=paused', game.state === 'paused', 'state=' + game.state);
keyDown('escape');
pump(2, '恢复');
check('再次 Esc 恢复对局', game.state === 'playing', 'state=' + game.state);
check('暂停面板隐藏', els['pause'] && els['pause'].style.display === 'none');
keyDown('escape');
pump(2, '再暂停');
check('再次暂停 state=paused', game.state === 'paused');
fireEl('btn-quit', 'click');
pump(2, '退出');
check('退出后 state=menu', game.state === 'menu');

// 扮演监管者
fireEl('btn-hunter', 'click');
pump(2, '监管者选择');
fireEl('huntersel-list', 'click');
pump(10, '监管者对局');
check('监管者对局 state=playing', game.state === 'playing');
check('玩家为监管者', game.player && game.player.kind === 'hunter');
check('玩家监管者 AI 已关闭', game.hunter && game.hunter.isPlayer && !game.hunter.isAI && !game.hunter.ai.active);

// 监管者键盘移动
let hunterCell = null;
for (let hy = 1; hy < game.rows - 1 && !hunterCell; hy++) {
  for (let hx = 1; hx < game.cols - 2; hx++) {
    const px = hx * game.ts + game.ts / 2, py = hy * game.ts + game.ts / 2;
    if (!game.tileIsSolid(hx, hy) && !game.tileIsSolid(hx + 1, hy)) { hunterCell = { x:px, y:py }; break; }
  }
}
check('找到监管者移动测试位置', !!hunterCell);
game.hunter.x = hunterCell.x; game.hunter.y = hunterCell.y;
const hunterX = game.hunter.x;
keyDown('d'); pump(20, '监管者向右移动'); keyUp('d'); pump(1, '监管者停止移动');
check('监管者响应玩家移动输入', game.hunter.x > hunterX, 'before=' + hunterX + ' after=' + game.hunter.x);

// 空格攻击、E 交互
const hunterTarget = game.survivors[0];
hunterTarget.ai = null; hunterTarget.hp = 2; hunterTarget.alive = true; hunterTarget.escaped = false;
hunterTarget.carriedBy = null; hunterTarget.chair = null;
game.hunter.dir = 0; game.hunter.atkCd = 0;
hunterTarget.x = game.hunter.x + 20; hunterTarget.y = game.hunter.y;
keyDown(' '); pump(2, '监管者攻击'); keyUp(' '); pump(1, '监管者攻击松键');
check('监管者空格攻击生效', hunterTarget.hp === 1, 'hp=' + hunterTarget.hp);
hunterTarget.hp = 0; game.hunter.carrying = null; game.hunter.atkCd = 0;
hunterTarget.x = game.hunter.x + 20; hunterTarget.y = game.hunter.y;
keyDown('e'); pump(2, '监管者交互'); keyUp('e'); pump(1, '监管者交互松键');
check('监管者 E 键牵制倒地者', game.hunter.carrying === hunterTarget);
check('监管者对局 loop 继续运行', pump(60, '监管者继续运行'));

// 监管者技能
game.updateInput({ x:0, y:0, interact:false, skill:true, skill2:false, crouch:false, pause:false });
game.update(1/60);
pump(10, '监管者技能');
check('监管者技能无异常', true);

// 监管者胜
game.endMatch('hunter_win');
pump(3, '监管者结算');
check('监管者结算面板', els['result'] && els['result'].style.display === 'flex');

// 触摸流程
Object.defineProperty(globalThis, 'navigator', { value: { maxTouchPoints: 5 }, configurable: true });
const game2 = new Game();
try { UI.start(game2); pump(3, '触摸初始化'); check('触摸流程初始化无异常', true); }
catch (e) { errors.push('触摸初始化异常: ' + (e && e.stack ? e.stack : String(e))); }

console.log('\n===== 捕获的运行时错误 =====');
if (errors.length === 0) console.log('  (无)');
errors.forEach(function (e, i) { console.log('  [' + (i + 1) + '] ' + e); });
console.log('\n' + (ok && errors.length === 0 ? 'STRICT TEST OK' : 'STRICT TEST FAILED'));
if (!ok || errors.length > 0) process.exit(1);
