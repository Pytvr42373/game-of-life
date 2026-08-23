/* =====================================================================
 * meta.js —— 《终局狂奔》纯数据与判定（无 DOM / 无引擎依赖）
 * 生态区配色 / 跑者皮肤 / 起始道具 / 成就定义 / 每日挑战目标与判定。
 * 供 game.js 渲染与 Node 单测共用：暴露 window.FinalRunMeta。
 * ===================================================================== */
(function (global) {
  'use strict';

  /* —— 生态区（每 600m，双主题配色） —— */
  var ZONES = [
    { name: '城市废墟',
      pal: { '4399': { skyTop:'#0a1c12', skyBot:'#0c2318', ground:'#0d2b1c', groundLine:'rgba(74,222,128,.25)', obstacle:'#2f6b4f', obstacleEdge:'rgba(154,230,172,.5)', star:'#c9e8d2', building:'rgba(18,48,31,.85)' },
             'arcade': { skyTop:'#05070f', skyBot:'#0b1128', ground:'#0a1024', groundLine:'rgba(127,243,255,.3)', obstacle:'#17306b', obstacleEdge:'rgba(127,243,255,.6)', star:'#9be8ff', building:'rgba(16,27,61,.85)' } } },
    { name: '变异丛林',
      pal: { '4399': { skyTop:'#0d1f10', skyBot:'#0f2a16', ground:'#12351c', groundLine:'rgba(163,230,53,.3)', obstacle:'#3a7d3a', obstacleEdge:'rgba(190,242,100,.55)', star:'#d9f99d', building:'rgba(22,55,30,.85)' },
             'arcade': { skyTop:'#0b0616', skyBot:'#150b2e', ground:'#180f33', groundLine:'rgba(167,139,250,.35)', obstacle:'#3b2d6b', obstacleEdge:'rgba(196,181,253,.6)', star:'#c4b5fd', building:'rgba(30,20,60,.85)' } } },
    { name: '核废土',
      pal: { '4399': { skyTop:'#1f1a0b', skyBot:'#2a2310', ground:'#33290f', groundLine:'rgba(217,119,6,.35)', obstacle:'#7a5a1e', obstacleEdge:'rgba(252,211,77,.55)', star:'#fde68a', building:'rgba(50,40,15,.85)' },
             'arcade': { skyTop:'#0f1408', skyBot:'#1a240c', ground:'#202b10', groundLine:'rgba(132,204,22,.4)', obstacle:'#4d7c0f', obstacleEdge:'rgba(190,242,100,.6)', star:'#bef264', building:'rgba(30,45,15,.85)' } } },
    { name: '冰封荒原',
      pal: { '4399': { skyTop:'#0c1a24', skyBot:'#122736', ground:'#14303f', groundLine:'rgba(125,211,252,.35)', obstacle:'#2c5f77', obstacleEdge:'rgba(186,230,253,.6)', star:'#e0f2fe', building:'rgba(22,48,64,.85)' },
             'arcade': { skyTop:'#040c16', skyBot:'#0a1d30', ground:'#0d2236', groundLine:'rgba(56,189,248,.4)', obstacle:'#1e4e6e', obstacleEdge:'rgba(125,211,252,.65)', star:'#bae6fd', building:'rgba(14,35,54,.85)' } } },
    { name: '地下要塞',
      pal: { '4399': { skyTop:'#14161c', skyBot:'#1d2028', ground:'#242830', groundLine:'rgba(148,163,184,.35)', obstacle:'#4a5265', obstacleEdge:'rgba(203,213,225,.5)', star:'#cbd5e1', building:'rgba(35,40,50,.85)' },
             'arcade': { skyTop:'#0a0a12', skyBot:'#131322', ground:'#181826', groundLine:'rgba(99,102,241,.4)', obstacle:'#3730a3', obstacleEdge:'rgba(165,180,252,.6)', star:'#a5b4fc', building:'rgba(24,24,44,.85)' } } },
    { name: '最终防线',
      pal: { '4399': { skyTop:'#241013', skyBot:'#32171b', ground:'#3a1a1e', groundLine:'rgba(248,113,113,.4)', obstacle:'#7f1d1d', obstacleEdge:'rgba(254,202,202,.6)', star:'#fecaca', building:'rgba(58,25,28,.85)' },
             'arcade': { skyTop:'#160409', skyBot:'#2a0a12', ground:'#320d14', groundLine:'rgba(248,113,113,.45)', obstacle:'#7f1d1d', obstacleEdge:'rgba(254,202,202,.65)', star:'#fda4af', building:'rgba(45,12,20,.85)' } } }
  ];

  /* —— 跑者皮肤 —— */
  var SKINS = [
    { id: 'cyber',   name: '青蓝疾影', price: 0,   c1: '#0ea5e9', c2: '#22d3ee', edge: '#a5f3fc' },
    { id: 'crimson', name: '猩红残响', price: 300, c1: '#dc2626', c2: '#f87171', edge: '#fecaca' },
    { id: 'jade',    name: '翡翠遗民', price: 300, c1: '#059669', c2: '#34d399', edge: '#a7f3d0' },
    { id: 'violet',  name: '紫电游魂', price: 500, c1: '#7c3aed', c2: '#a78bfa', edge: '#ddd6fe' }
  ];
  var STARTERS = [
    { id: 'startShield', name: '开局护盾', desc: '起跑即 1 层护盾', price: 200 },
    { id: 'startMagnet', name: '开局磁石', desc: '起跑 1.2s 冲刺',  price: 250 }
  ];

  /* —— 成就定义（test 为纯判定，可单测） —— */
  var ACHS = [
    { id: 'first_run',  icon: '🏁', name: '初次终局',   desc: '完成一局',            test: function (s) { return !!s.finished; } },
    { id: 'dist_500',   icon: '🏃', name: '五百米幸存', desc: '单局跑 500m',        test: function (s) { return s.dist >= 500; } },
    { id: 'dist_1000',  icon: '🏃', name: '千米潜行',   desc: '单局跑 1000m',       test: function (s) { return s.dist >= 1000; } },
    { id: 'dist_3000',  icon: '👑', name: '三千米传奇', desc: '单局跑 3000m',       test: function (s) { return s.dist >= 3000; } },
    { id: 'combo_10',   icon: '⚡', name: '十连闪避',   desc: '连击达 10',           test: function (s) { return s.bestCombo >= 10; } },
    { id: 'combo_20',   icon: '⚡', name: '二十连狂舞', desc: '连击达 20',           test: function (s) { return s.bestCombo >= 20; } },
    { id: 'combo_30',   icon: '🌪', name: '三十连神话', desc: '连击达 30',           test: function (s) { return s.bestCombo >= 30; } },
    { id: 'near_100',   icon: '💨', name: '百次擦身',   desc: '累计极限闪避 100 次', test: function (s, a) { return a.near >= 100; } },
    { id: 'coin_1000',  icon: '💰', name: '金币千枚',   desc: '累计拾取 1000 金币',  test: function (s, a) { return a.coins >= 1000; } },
    { id: 'all_zones',  icon: '🗺', name: '穿越六界',   desc: '抵达最终防线',       test: function (s) { return s.zone >= 5; } },
    { id: 'rage_clear', icon: '👹', name: '狂怒克星',   desc: '击退一次巨兽狂怒',   test: function (s) { return s.rageCleared >= 1; } },
    { id: 'escape_10',  icon: '🏆', name: '十度逃生',   desc: '累计完成 10 局',      test: function (s, a) { return a.runs >= 10; } },
    { id: 'daily_win',  icon: '📅', name: '今日之星',   desc: '完成今日挑战',       test: function (s, a, d) { return !!(d && d.done); } }
  ];

  /* —— 每日挑战目标 —— */
  var DAILY_GOALS = [
    { id: 'dist',  name: '今日累计跑 800m', target: 800, metric: 'dist' },
    { id: 'coin',  name: '今日拾取 30 金币', target: 30,  metric: 'coins' },
    { id: 'combo', name: '今日达成连击 15', target: 15,  metric: 'combo' },
    { id: 'near',  name: '今日极限闪避 20 次', target: 20, metric: 'near' }
  ];

  function dayStr() { var d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
  function hashDay(str) { var h = 0; for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0; return h; }
  function dailyGoalOf(d) {
    for (var i = 0; i < DAILY_GOALS.length; i++) if (DAILY_GOALS[i].id === d.goalId) return DAILY_GOALS[i];
    return DAILY_GOALS[0];
  }
  function dailyDone(d) { var g = dailyGoalOf(d); return d.prog[g.metric] >= g.target; }
  function freshDaily(dateStr) {
    var goal = DAILY_GOALS[hashDay(dateStr) % DAILY_GOALS.length];
    return { date: dateStr, goalId: goal.id, prog: { dist: 0, coins: 0, combo: 0, near: 0 }, done: false, claimed: false };
  }

  var Meta = {
    ZONES: ZONES, SKINS: SKINS, STARTERS: STARTERS, ACHS: ACHS, DAILY_GOALS: DAILY_GOALS,
    dayStr: dayStr, hashDay: hashDay, dailyGoalOf: dailyGoalOf, dailyDone: dailyDone, freshDaily: freshDaily
  };
  global.FinalRunMeta = Meta;
  if (typeof module !== 'undefined' && module.exports) module.exports = Meta;
})(typeof window !== 'undefined' ? window : globalThis);
