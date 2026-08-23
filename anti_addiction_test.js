'use strict';
const fs = require('fs');
const vm = require('vm');

const code = fs.readFileSync(__dirname + '/anti-addiction.js', 'utf8');
const RealDate = Date;
let CLOCK = new RealDate('2026-08-22T10:00:00+08:00').getTime();

class FakeDate {
  static now() { return CLOCK; }
  static advance(ms) { CLOCK += ms; }
  static set(t) { CLOCK = t; }
  constructor(...args) {
    if (args.length === 0) this._t = CLOCK;
    else this._t = new RealDate(...args).getTime();
  }
  getTime() { return this._t; }
  getFullYear() { return new RealDate(this._t).getFullYear(); }
  getMonth() { return new RealDate(this._t).getMonth(); }
  getDate() { return new RealDate(this._t).getDate(); }
  getHours() { return new RealDate(this._t).getHours(); }
  getMinutes() { return new RealDate(this._t).getMinutes(); }
  setHours(h, m, s, ms) { const d = new RealDate(this._t); d.setHours(h, m, s, ms); this._t = d.getTime(); return this._t; }
}

function makeStorage() {
  const m = new Map();
  return {
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { m.set(k, String(v)); },
    removeItem(k) { m.delete(k); },
    _raw() { return JSON.parse(JSON.stringify(Object.fromEntries(m))); }
  };
}

let cryptoCounter = 0;
function makeContext(storage, label) {
  const intervals = [];
  const timeouts = [];
  const els = [];
  function makeEl() {
    const handlers = {};
    const cls = new Set();
    const el = {
      textContent: '', style: {}, _handlers: handlers, _cls: cls,
      classList: {
        add(c) { cls.add(c); },
        remove(c) { cls.delete(c); },
        toggle(c, f) { if (f === undefined) { cls.has(c) ? cls.delete(c) : cls.add(c); } else { f ? cls.add(c) : cls.delete(c); } },
        contains(c) { return cls.has(c); }
      },
      setAttribute() {},
      addEventListener(t, fn) { (handlers[t] = handlers[t] || []).push(fn); },
      fire(t) { (handlers[t] || []).forEach(f => f()); }
    };
    els.push(el);
    return el;
  }
  const shadowRoot = { innerHTML: '', querySelector() { return makeEl(); } };
  const document = {
    readyState: 'complete',
    visibilityState: 'visible',
    body: { getAttribute() { return null; }, appendChild() {} },
    documentElement: { getAttribute() { return null; }, classList: { contains() { return false; } } },
    querySelector() { return null; },
    addEventListener() {},
    createElement() { return { id: '', setAttribute() {}, attachShadow() { return shadowRoot; }, addEventListener() {} }; }
  };
  const sandbox = {
    console, Math, Date: FakeDate, Uint32Array,
    crypto: { getRandomValues(arr) { for (let i = 0; i < arr.length; i++) arr[i] = (cryptoCounter + i) >>> 0; cryptoCounter += arr.length + 1; return arr; } },
    localStorage: storage, document, window: null, addEventListener() {},
    getComputedStyle() { return { backgroundColor: '' }; },
    MutationObserver: function () { return { observe() {}, disconnect() {} }; },
    setTimeout(fn, ms) { timeouts.push({ fn, ms, cleared: false }); return timeouts.length; },
    clearTimeout(id) { if (id && timeouts[id - 1]) timeouts[id - 1].cleared = true; },
    setInterval(fn, ms) { intervals.push({ fn, ms }); return intervals.length; },
    clearInterval() {}
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return { sandbox, intervals, timeouts, els, storage, label, shadowRoot };
}

let passed = 0, failed = 0;
function T(name, fn) {
  try { fn(); passed++; console.log('  PASS ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name); console.error('    ' + e.message); }
}
function stateOf(storage) { return JSON.parse(storage.getItem('gh-wellbeing-v1')); }
function heartbeats(ctx, n) { for (let i = 0; i < n; i++) { FakeDate.advance(5000); ctx.intervals[0].fn(); } }

console.log('[1] 每日重置 + 初始不弹');
{
  const st = makeStorage();
  FakeDate.set(new RealDate('2026-08-22T10:00:00+08:00').getTime());
  const ctx = makeContext(st, 't1');
  const overlay = ctx.els[0], title = ctx.els[2], card = ctx.els[1];
  T('初始不弹窗', () => { if (title.textContent !== '') throw new Error('title=' + title.textContent); if (overlay.classList.contains('show')) throw new Error('overlay shown'); });
  T('state 初始 fresh(activeMs=0/slot=0)', () => { const s = stateOf(st); if (s.activeMs !== 0 || s.lastPlayReminderSlot !== 0) throw new Error(JSON.stringify(s)); });
  T('state 含当日 date', () => { if (stateOf(st).date !== '2026-08-22') throw new Error(stateOf(st).date); });
  T('card 初始非 danger', () => { if (card.classList.contains('danger')) throw new Error('danger'); });
}

console.log('[2] 每 15 分钟周期性弹窗');
{
  const st = makeStorage();
  FakeDate.set(new RealDate('2026-08-22T10:00:00+08:00').getTime());
  const ctx = makeContext(st, 't2');
  const overlay = ctx.els[0], title = ctx.els[2], card = ctx.els[1], btn = ctx.els[4];
  heartbeats(ctx, 180); // 10:00 -> 10:15
  T('第1次: 弹窗标题含15分钟', () => { if (!/15/.test(title.textContent)) throw new Error('title=' + title.textContent); });
  T('第1次: overlay show + danger', () => { if (!overlay.classList.contains('show')) throw new Error('no show'); if (!card.classList.contains('danger')) throw new Error('no danger'); });
  T('第1次: slot=1 activeMs=900000', () => { const s = stateOf(st); if (s.lastPlayReminderSlot !== 1 || s.activeMs !== 900000) throw new Error(JSON.stringify(s)); });
  T('第1次: 强制提醒不自动关闭(无10s定时)', () => { if (ctx.timeouts.some(t => t.ms === 10000)) throw new Error('auto-hide scheduled'); });
  btn.fire('click');
  T('点按钮关闭', () => { if (overlay.classList.contains('show')) throw new Error('still shown'); });
  heartbeats(ctx, 180); // 10:30
  T('第2次: 标题含30分钟 slot=2', () => { if (!/30/.test(title.textContent)) throw new Error('title=' + title.textContent); if (stateOf(st).lastPlayReminderSlot !== 2) throw new Error('slot'); });
  btn.fire('click');
  heartbeats(ctx, 180); // 10:45
  T('第3次: 标题含45分钟 slot=3', () => { if (!/45/.test(title.textContent)) throw new Error('title=' + title.textContent); if (stateOf(st).lastPlayReminderSlot !== 3) throw new Error('slot'); });
  T('activeMs=2700000', () => { if (stateOf(st).activeMs !== 2700000) throw new Error('activeMs=' + stateOf(st).activeMs); });
}

console.log('[3] 时钟提醒(17:10 普通/自动关)');
{
  const st = makeStorage();
  FakeDate.set(new RealDate('2026-08-22T17:10:00+08:00').getTime());
  const ctx = makeContext(st, 't3');
  const title = ctx.els[2], card = ctx.els[1];
  T('17:10 弹时钟提醒', () => { if (title.textContent !== '已经 17:10 了') throw new Error('title=' + title.textContent); });
  T('时钟提醒非 danger', () => { if (card.classList.contains('danger')) throw new Error('danger'); });
  T('普通提醒调度10s自动关', () => { if (!ctx.timeouts.some(t => t.ms === 10000)) throw new Error('no 10s timer'); });
  T('clockReminders 记录去重', () => { const s = stateOf(st); if (s.clockReminders.indexOf('17:10') === -1) throw new Error('not recorded'); ctx.intervals[0].fn(); if (s.clockReminders.length !== 1) throw new Error('dup'); });
}

console.log('[4] 跨天重置 + 重新开始周期');
{
  const st = makeStorage();
  // 预置昨天的旧状态
  st.setItem('gh-wellbeing-v1', JSON.stringify({ date: '2026-08-21', activeMs: 3600000, lastPlayReminderSlot: 4, clockReminders: ['17:10', '17:15'], updatedAt: 0 }));
  FakeDate.set(new RealDate('2026-08-22T09:00:00+08:00').getTime());
  const ctx = makeContext(st, 't4');
  const title = ctx.els[2];
  T('跨天自动重置(activeMs/slot/clock归零)', () => { const s = stateOf(st); if (s.date !== '2026-08-22' || s.activeMs !== 0 || s.lastPlayReminderSlot !== 0 || s.clockReminders.length !== 0) throw new Error(JSON.stringify(s)); });
  heartbeats(ctx, 180); // 09:00 -> 09:15
  T('重置后重新满15分钟再弹', () => { if (!/15/.test(title.textContent)) throw new Error('title=' + title.textContent); if (stateOf(st).lastPlayReminderSlot !== 1) throw new Error('slot'); });
  ctx.els[4].fire('click');
  heartbeats(ctx, 180); // 09:30
  T('同日继续周期(第2次)', () => { if (!/30/.test(title.textContent)) throw new Error('title=' + title.textContent); if (stateOf(st).lastPlayReminderSlot !== 2) throw new Error('slot'); });
}

console.log('[5] 多标签页 lease 不重复计数 + 切换接管');
{
  const st = makeStorage();
  FakeDate.set(new RealDate('2026-08-22T09:30:00+08:00').getTime());
  const ctx1 = makeContext(st, 't5a');
  heartbeats(ctx1, 180); // 09:30 -> 09:45, slot=3
  const base = stateOf(st).activeMs;
  const ctx2 = makeContext(st, 't5b'); // 第二个标签页
  T('新标签页在lease内不抢计数', () => {
    FakeDate.advance(5000); ctx2.intervals[0].fn();
    if (stateOf(st).activeMs !== base) throw new Error('increased to ' + stateOf(st).activeMs);
  });
  T('lease过期后接管继续累计', () => {
    FakeDate.advance(13000); // 超过 LEASE_MS
    ctx2.intervals[0].fn(); // claim 成功
    FakeDate.advance(5000); ctx2.intervals[0].fn();
    if (stateOf(st).activeMs <= base) throw new Error('not increased: ' + stateOf(st).activeMs);
  });
  T('接管后跨槽位仍按15分钟弹', () => {
    const title = ctx2.els[2];
    const baseSlot = stateOf(st).lastPlayReminderSlot;
    let guard = 0;
    while (stateOf(st).lastPlayReminderSlot === baseSlot && guard++ < 400) heartbeats(ctx2, 1);
    if (!/分钟/.test(title.textContent)) throw new Error('no reminder, title=' + title.textContent);
    if (stateOf(st).lastPlayReminderSlot <= baseSlot) throw new Error('slot not advanced: ' + stateOf(st).lastPlayReminderSlot);
  });
}

console.log('[6] 旧状态兼容迁移(playReminderShown -> slot)');
{
  const st = makeStorage();
  st.setItem('gh-wellbeing-v1', JSON.stringify({ date: '2026-08-22', activeMs: 900000, playReminderShown: true, clockReminders: [], updatedAt: 0 }));
  FakeDate.set(new RealDate('2026-08-22T10:00:00+08:00').getTime());
  const ctx = makeContext(st, 't6');
  const title = ctx.els[2];
  T('旧一次性提醒迁移为 slot=1', () => { const s = stateOf(st); if (s.lastPlayReminderSlot !== 1) throw new Error('slot=' + s.lastPlayReminderSlot); });
  T('迁移后不重复弹(同槽位不触发)', () => { if (title.textContent !== '') throw new Error('re-fired: ' + title.textContent); });
}

console.log('[7] 隐藏时宿主事件穿透(pointer-events 回归)');
{
  const st = makeStorage();
  FakeDate.set(new RealDate('2026-08-22T10:00:00+08:00').getTime());
  const ctx = makeContext(st, 't7');
  const css = ctx.shadowRoot.innerHTML;
  const ruleOf = re => { const m = css.match(re); if (!m) throw new Error('missing rule: ' + re); return m[0]; };
  T('宿主 :host 含 pointer-events:none(隐藏时整页可点击)', () => {
    const r = ruleOf(/:host\{[^}]+\}/);
    if (!/pointer-events:\s*none/.test(r)) throw new Error(r);
  });
  T('overlay 默认(隐藏) pointer-events:none', () => {
    const r = ruleOf(/\.overlay\{[^}]+\}/);
    if (!/pointer-events:\s*none/.test(r)) throw new Error(r);
  });
  T('overlay.show 弹窗显示时 pointer-events:auto(可交互)', () => {
    const r = ruleOf(/\.overlay\.show\{[^}]+\}/);
    if (!/pointer-events:\s*auto/.test(r)) throw new Error(r);
  });
  T('overlay 与 :host 都声明 pointer-events(双保险)', () => {
    if ((css.match(/pointer-events/g) || []).length < 3) throw new Error(css.match(/pointer-events/g));
  });
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
