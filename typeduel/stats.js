/* =====================================================================
 * stats.js —— 《打字对决 TYPE DUEL》训练统计面板
 * 纯逻辑（WPM / 准确率 / 评级）导出为 TypeDuelStatsLogic（可 node 自测）；
 * 浏览器侧：实时 HUD、赛后结算、历史聚合、进度、限时 Top10 榜、趋势图。
 * localStorage 键名（§6.3 / §8.4）：
 *   typeduel.stats.v1 / typeduel.history.v1 / typeduel.progress.v1
 *   typeduel.settings.v1 / typeduel.leaderboard.v1
 * ===================================================================== */
(function (global) {
  'use strict';

  /* ================= 纯逻辑层（可 node 自测） ================= */
  var Logic = {
    BASE_SCORE: { campaign: 2000, sprint: 4000, survival: 3000 },

    /* WPM：5 字符 = 1 词 */
    wpm: function (correctKeys, seconds) {
      return seconds > 0 ? (correctKeys / 5) / (seconds / 60) : 0;
    },
    /* 准确率：正确 / (正确+错误) × 100% */
    accuracy: function (correct, errors) {
      var total = correct + errors;
      return total > 0 ? (correct / total) * 100 : 100;
    },
    /* 评级公式（§6.2） */
    ratingScore: function (acc, peakWpm, score, baseScore) {
      return 0.5 * acc + 0.3 * Math.min(peakWpm / 50, 1) * 100 + 0.2 * Math.min(score / (baseScore || 1), 1) * 100;
    },
    grade: function (r) {
      if (r >= 90) return 'S';
      if (r >= 80) return 'A';
      if (r >= 70) return 'B';
      if (r >= 60) return 'C';
      if (r >= 50) return 'D';
      return 'F';
    },
    fmtTime: function (sec) {
      sec = Math.max(0, Math.floor(sec));
      var m = Math.floor(sec / 60), s = sec % 60;
      return (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s);
    }
  };

  /* ================= localStorage 封装 ================= */
  var KEYS = {
    stats: 'typeduel.stats.v1',
    history: 'typeduel.history.v1',
    progress: 'typeduel.progress.v1',
    settings: 'typeduel.settings.v1',
    leaderboard: 'typeduel.leaderboard.v1'
  };

  function read(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 静默 */ }
  }

  var Stats = {};
  Stats.KEYS = KEYS;
  Stats.read = read;
  Stats.write = write;

  Stats.getSettings = function () {
    var d = read(KEYS.settings, null) || {};
    return {
      sound: d.sound !== false,
      bgm: d.bgm !== false,
      shake: d.shake !== false,
      reducedFx: !!d.reducedFx
    };
  };
  Stats.saveSettings = function (s) {
    write(KEYS.settings, { sound: !!s.sound, bgm: !!s.bgm, shake: !!s.shake, reducedFx: !!s.reducedFx });
  };

  Stats.getProgress = function () {
    return read(KEYS.progress, { unlockedDifficulty: 'normal', stage: { normal: 1, hard: 1, inferno: 1 } });
  };
  Stats.saveProgress = function (p) { write(KEYS.progress, p); };

  Stats.getHistory = function () { return read(KEYS.history, []); };
  Stats.getStats = function () {
    return read(KEYS.stats, {
      totalGames: 0,
      bestWpm: { campaign: 0, sprint: 0, survival: 0 },
      avgAcc: 100,
      maxCombo: 0,
      bestScore: { campaign: 0, sprint: 0, survival: 0 },
      skillUse: { heal: 0, bomb: 0, freeze: 0, slow: 0 }
    });
  };
  Stats.getLeaderboard = function () { return read(KEYS.leaderboard, []); };

  /* ================= 赛后记录：历史 + 聚合 + Top10 榜 ================= */
  /* result: {mode, difficulty, score, kills, peakWpm, avgWpm, acc, maxCombo,
              wrongWords, errorKeys, durationSec, skillsUsed, win} */
  Stats.record = function (result) {
    var now = new Date();
    var dateStr = now.getFullYear() + '-' +
      (now.getMonth() + 1 < 10 ? '0' + (now.getMonth() + 1) : now.getMonth() + 1) + '-' +
      (now.getDate() < 10 ? '0' + now.getDate() : now.getDate()) + ' ' +
      (now.getHours() < 10 ? '0' + now.getHours() : now.getHours()) + ':' +
      (now.getMinutes() < 10 ? '0' + now.getMinutes() : now.getMinutes());

    var base = Logic.BASE_SCORE[result.mode] || 2000;
    var rating = Logic.ratingScore(result.acc, result.peakWpm, result.score, base);
    var grade = Logic.grade(rating);
    var entry = {
      date: dateStr,
      mode: result.mode,
      difficulty: result.difficulty || 'normal',
      score: Math.round(result.score),
      wpm: Math.round(result.peakWpm * 10) / 10,
      acc: Math.round(result.acc * 10) / 10,
      maxCombo: result.maxCombo,
      rating: Math.round(rating * 10) / 10,
      grade: grade,
      duration: Math.round(result.durationSec)
    };

    /* 历史（≤100 条，滚动淘汰最旧） */
    var history = Stats.getHistory();
    history.push(entry);
    if (history.length > 100) history = history.slice(history.length - 100);
    write(KEYS.history, history);

    /* 聚合 */
    var st = Stats.getStats();
    st.totalGames++;
    st.bestWpm[result.mode] = Math.max(st.bestWpm[result.mode] || 0, result.peakWpm);
    st.bestScore[result.mode] = Math.max(st.bestScore[result.mode] || 0, Math.round(result.score));
    st.maxCombo = Math.max(st.maxCombo, result.maxCombo);
    /* 平均准确率：滚动均值 */
    var n = st.totalGames;
    st.avgAcc = (st.avgAcc * (n - 1) + result.acc) / n;
    var sk = result.skillsUsed || {};
    st.skillUse.heal += sk.heal || 0;
    st.skillUse.bomb += sk.bomb || 0;
    st.skillUse.freeze += sk.freeze || 0;
    st.skillUse.slow += sk.slow || 0;
    write(KEYS.stats, st);

    var flags = {
      newBestWpm: Math.abs(st.bestWpm[result.mode] - result.peakWpm) < 0.0001 && result.peakWpm > 0,
      newBestScore: Math.abs(st.bestScore[result.mode] - Math.round(result.score)) < 0.0001 && result.score > 0,
      leaderboardRank: -1
    };

    /* 限时模式：写入 Top10 榜（§4.2 / §6.3） */
    if (result.mode === 'sprint') {
      var lb = Stats.getLeaderboard();
      lb.push({
        score: Math.round(result.score),
        wpm: Math.round(result.peakWpm * 10) / 10,
        acc: Math.round(result.acc * 10) / 10,
        diff: result.difficulty || 'standard',
        date: dateStr
      });
      lb.sort(function (a, b) { return b.score - a.score; });
      if (lb.length > 10) lb = lb.slice(0, 10);
      write(KEYS.leaderboard, lb);
      for (var i = 0; i < lb.length; i++) {
        if (lb[i].score === Math.round(result.score) && lb[i].date === dateStr) { flags.leaderboardRank = i + 1; break; }
      }
    }

    return { history: history, stats: st, flags: flags, rating: rating, grade: grade, base: base };
  };

  /* ================= 浏览器 DOM 层 ================= */
  var isBrowser = (typeof document !== 'undefined');

  function el(id) { return isBrowser ? document.getElementById(id) : null; }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  var MODE_LABEL = { campaign: '经典闯关', sprint: '限时冲刺', survival: '无尽生存' };
  var DIFF_LABEL = { normal: '普通', hard: '困难', inferno: '地狱', short: '短词', standard: '标准', long: '长词' };

  /* —— 实时 HUD 更新（每帧或每秒） —— */
  /* data: {wpm, acc, combo, mode, hearts, maxHearts, hp, maxHp,
            wordTyped, wordUntyped, errorChar, timeLabel, subLabel} */
  Stats.updateHud = function (data) {
    if (!isBrowser) return;
    var wpmEl = el('hudWpm'), accEl = el('hudAcc'), comboEl = el('hudCombo');
    if (wpmEl) wpmEl.textContent = Math.round(data.wpm);
    if (accEl) {
      accEl.textContent = Math.round(data.acc) + '%';
      accEl.className = data.acc >= 90 ? 'hud-acc good' : (data.acc >= 80 ? 'hud-acc warn' : 'hud-acc bad');
    }
    if (comboEl) {
      comboEl.textContent = '×' + data.combo;
      comboEl.className = 'hud-combo' + (data.combo >= 10 ? ' gold' : (data.combo >= 5 ? ' up' : ''));
    }

    /* 生命：经典=心 / 生存=血条 */
    var heartsEl = el('hudHearts'), hpWrap = el('hudHpWrap');
    if (heartsEl && hpWrap) {
      if (data.mode === 'survival') {
        heartsEl.style.display = 'none';
        hpWrap.style.display = '';
        var fill = el('hpFill'), txt = el('hpText');
        if (fill) fill.style.transform = 'scaleX(' + Math.max(0, data.hp / data.maxHp) + ')';
        if (txt) txt.textContent = Math.max(0, Math.round(data.hp)) + ' / ' + data.maxHp;
        var danger = data.hp <= 25;
        hpWrap.classList.toggle('danger', danger);
      } else {
        heartsEl.style.display = '';
        hpWrap.style.display = 'none';
        var h = '';
        for (var i = 0; i < data.maxHearts; i++) {
          h += '<i class="hud-heart' + (i < data.hearts ? ' on' : ' off') + '">♥</i>';
        }
        heartsEl.innerHTML = h;
        heartsEl.classList.toggle('danger', data.hearts <= 2);
      }
    }

    /* 当前词进度 */
    var wEl = el('hudWord');
    if (wEl) {
      var typed = (data.wordTyped || '').split('').map(function (c) {
        return '<span class="w-typed">' + esc(c) + '</span>';
      }).join('');
      var unt = (data.wordUntyped || '').split('').map(function (c) {
        return '<span class="w-unt">' + esc(c) + '</span>';
      }).join('');
      var err = data.errorChar ? '<span class="w-err">' + esc(data.errorChar) + '</span>' : '';
      wEl.innerHTML = typed + err + unt;
      wEl.classList.toggle('active', !!data.hasTarget);
    }

    var tEl = el('hudTime'), subEl = el('hudSub');
    if (tEl) tEl.textContent = data.timeLabel || '--:--';
    if (subEl) subEl.textContent = data.subLabel || '';
  };

  /* —— 赛后结算 overlay —— */
  Stats.showResult = function (result, recordOut, callbacks) {
    if (!isBrowser) return;
    var screen = el('resultScreen');
    if (!screen) return;
    var base = Logic.BASE_SCORE[result.mode] || 2000;
    var rating = Logic.ratingScore(result.acc, result.peakWpm, result.score, base);
    var grade = Logic.grade(rating);
    var isVictory = result.mode === 'campaign' && result.win;
    var flags = recordOut ? recordOut.flags : {};

    el('resultTitle').textContent = isVictory ? '全面胜利' : (result.mode === 'sprint' ? '时间到' : '本局结束');
    el('resultCode').textContent = (result.mode === 'campaign' ? 'CAMPAIGN' : result.mode === 'sprint' ? 'SPRINT' : 'SURVIVAL') +
      ' · ' + (DIFF_LABEL[result.difficulty] || '') + ' · 评级 ' + grade;
    el('resultReason').textContent = isVictory ? '你打穿了 12 关数据防线！' :
      (result.mode === 'sprint' ? '60 秒战报结算，已写入本地 Top10。' : '防线已破，训练数据已归档。');

    var extra = '';
    if (flags.newBestScore) extra += '<span class="newrec">新纪录·得分</span>';
    if (flags.newBestWpm) extra += '<span class="newrec">新纪录·WPM</span>';
    if (flags.leaderboardRank > 0) extra += '<span class="newrec">冲榜 第' + flags.leaderboardRank + '名</span>';
    el('resultExtra').innerHTML = extra;

    var cells = [
      ['总分', Math.round(result.score)],
      ['消灭', result.kills],
      ['峰值WPM', Math.round(result.peakWpm)],
      ['准确率', Math.round(result.acc) + '%'],
      ['最高连击', result.maxCombo],
      ['错词/错键', result.wrongWords + ' / ' + result.errorKeys],
      ['用时', Logic.fmtTime(result.durationSec)],
      ['评级', '<b class="grade-' + grade + '">' + grade + '</b>']
    ];
    var html = '';
    cells.forEach(function (c) {
      html += '<div><strong>' + c[1] + '</strong><span>' + c[0] + '</span></div>';
    });
    el('resultStats').innerHTML = html;

    var sk = result.skillsUsed || {};
    el('resultSkills').innerHTML =
      'HEAL×' + (sk.heal || 0) + ' &nbsp; BOMB×' + (sk.bomb || 0) +
      ' &nbsp; FREEZE×' + (sk.freeze || 0) + ' &nbsp; SLOW×' + (sk.slow || 0);

    screen.classList.add('show');
    screen.setAttribute('aria-hidden', 'false');
    var retry = el('retryBtn'), menu = el('resultMenuBtn');
    retry.onclick = function () { screen.classList.remove('show'); if (callbacks && callbacks.retry) callbacks.retry(); };
    menu.onclick = function () { screen.classList.remove('show'); if (callbacks && callbacks.menu) callbacks.menu(); };
  };

  /* —— 统计档案面板 —— */
  Stats.renderStatsPanel = function () {
    if (!isBrowser) return;
    var screen = el('statsScreen');
    if (!screen) return;
    var st = Stats.getStats(), history = Stats.getHistory();
    el('stTotal').textContent = st.totalGames;
    el('stWpmC').textContent = Math.round(st.bestWpm.campaign || 0);
    el('stWpmS').textContent = Math.round(st.bestWpm.sprint || 0);
    el('stWpmU').textContent = Math.round(st.bestWpm.survival || 0);
    el('stAcc').textContent = Math.round(st.avgAcc) + '%';
    el('stCombo').textContent = st.maxCombo;
    el('stScoreC').textContent = Math.round(st.bestScore.campaign || 0);
    el('stScoreS').textContent = Math.round(st.bestScore.sprint || 0);
    el('stScoreU').textContent = Math.round(st.bestScore.survival || 0);
    el('stSkill').innerHTML = 'HEAL×' + (st.skillUse.heal || 0) + ' · BOMB×' + (st.skillUse.bomb || 0) +
      ' · FREEZE×' + (st.skillUse.freeze || 0) + ' · SLOW×' + (st.skillUse.slow || 0);
    Stats.renderTrend(st, history);
    Stats.renderHistory(history, 'all');
  };

  /* —— 趋势图：近 20 局 WPM 折线 —— */
  Stats.renderTrend = function (st, history) {
    var cv = el('trendCanvas');
    if (!cv || !cv.getContext) return;
    var ctx2d = cv.getContext('2d');
    var W = cv.width, H = cv.height;
    ctx2d.clearRect(0, 0, W, H);
    var theme = isBrowser && document.body ? document.body.dataset.theme : '4399';
    var lineC = theme === 'arcade' ? '#46d7e8' : '#3f7d4e';
    var dimC = theme === 'arcade' ? '#7e93a6' : '#81949c';
    /* 网格 */
    ctx2d.strokeStyle = dimC; ctx2d.globalAlpha = 0.18; ctx2d.lineWidth = 1;
    for (var gx = 0; gx <= 4; gx++) {
      var x = gx * W / 4;
      ctx2d.beginPath(); ctx2d.moveTo(x, 0); ctx2d.lineTo(x, H); ctx2d.stroke();
    }
    for (var gy = 0; gy <= 3; gy++) {
      var y = gy * H / 3;
      ctx2d.beginPath(); ctx2d.moveTo(0, y); ctx2d.lineTo(W, y); ctx2d.stroke();
    }
    ctx2d.globalAlpha = 1;
    var recent = history.slice(-20);
    if (recent.length === 0) {
      ctx2d.fillStyle = dimC; ctx2d.font = '12px sans-serif'; ctx2d.textAlign = 'center';
      ctx2d.fillText('暂无数据', W / 2, H / 2);
      return;
    }
    var maxW = 1;
    recent.forEach(function (r) { if (r.wpm > maxW) maxW = r.wpm; });
    maxW = Math.ceil(maxW / 20) * 20 || 20;
    var pad = 6;
    var pts = recent.map(function (r, i) {
      return {
        x: pad + i * (W - pad * 2) / (recent.length - 1),
        y: H - pad - (r.wpm / maxW) * (H - pad * 2)
      };
    });
    /* 面积填充 */
    ctx2d.beginPath();
    pts.forEach(function (p, i) { if (i === 0) ctx2d.moveTo(p.x, p.y); else ctx2d.lineTo(p.x, p.y); });
    ctx2d.lineTo(pts[pts.length - 1].x, H - pad); ctx2d.lineTo(pts[0].x, H - pad); ctx2d.closePath();
    var grad = ctx2d.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, theme === 'arcade' ? 'rgba(70,215,232,.28)' : 'rgba(63,125,78,.28)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx2d.fillStyle = grad; ctx2d.fill();
    /* 折线 */
    ctx2d.beginPath();
    pts.forEach(function (p, i) { if (i === 0) ctx2d.moveTo(p.x, p.y); else ctx2d.lineTo(p.x, p.y); });
    ctx2d.strokeStyle = lineC; ctx2d.lineWidth = 2; ctx2d.stroke();
    /* 点 + 末点标注 */
    pts.forEach(function (p, i) {
      ctx2d.beginPath(); ctx2d.arc(p.x, p.y, i === pts.length - 1 ? 3.5 : 2, 0, Math.PI * 2);
      ctx2d.fillStyle = i === pts.length - 1 ? lineC : dimC; ctx2d.fill();
    });
    ctx2d.fillStyle = dimC; ctx2d.font = '10px sans-serif'; ctx2d.textAlign = 'left';
    ctx2d.fillText('近 ' + recent.length + ' 局 WPM', 6, 12);
  };

  /* —— 逐局记录列表（可按模式过滤） —— */
  Stats.renderHistory = function (history, filter) {
    var box = el('historyList');
    if (!box) return;
    var list = history.slice().reverse().filter(function (r) { return filter === 'all' || r.mode === filter; });
    if (list.length === 0) {
      box.innerHTML = '<div class="empty-row">暂无对局记录</div>';
      return;
    }
    var html = '';
    list.slice(0, 40).forEach(function (r) {
      html += '<div class="hist-row">' +
        '<span class="hr-date">' + r.date + '</span>' +
        '<span class="hr-mode">' + (MODE_LABEL[r.mode] || r.mode) + '</span>' +
        '<span class="hr-diff">' + (DIFF_LABEL[r.difficulty] || '') + '</span>' +
        '<span class="hr-score">' + r.score + '</span>' +
        '<span class="hr-wpm">' + r.wpm + '</span>' +
        '<span class="hr-acc">' + r.acc + '%</span>' +
        '<span class="hr-combo">×' + r.maxCombo + '</span>' +
        '<span class="hr-grade grade-' + r.grade + '">' + r.grade + '</span>' +
        '</div>';
    });
    box.innerHTML = html;
  };

  /* —— 限时 Top10 榜 —— */
  Stats.renderLeaderboard = function () {
    if (!isBrowser) return;
    var lb = Stats.getLeaderboard();
    var listEl = el('lbList');
    if (listEl) {
      if (lb.length === 0) {
        listEl.innerHTML = '<div class="empty-row">暂无冲榜记录</div>';
      } else {
        var html = '';
        lb.forEach(function (r, i) {
          html += '<div class="lb-row' + (i < 3 ? ' top' : '') + '">' +
            '<span class="lb-rank">' + (i + 1) + '</span>' +
            '<span class="lb-score">' + r.score + '</span>' +
            '<span class="lb-meta">' + r.wpm + ' WPM · ' + r.acc + '% · ' + (DIFF_LABEL[r.diff] || r.diff) + '</span>' +
            '<span class="lb-date">' + r.date + '</span>' +
            '</div>';
        });
        listEl.innerHTML = html;
      }
    }
    var menuLb = el('menuLbList');
    if (menuLb) {
      if (lb.length === 0) {
        menuLb.innerHTML = '<div class="empty-row">冲榜吧，记录你的最高分！</div>';
      } else {
        var mh = '';
        lb.slice(0, 3).forEach(function (r, i) {
          mh += '<div class="lb-row' + (i < 3 ? ' top' : '') + '">' +
            '<span class="lb-rank">' + (i + 1) + '</span>' +
            '<span class="lb-score">' + r.score + '</span>' +
            '<span class="lb-meta">' + r.wpm + ' WPM · ' + r.acc + '%</span>' +
            '</div>';
        });
        menuLb.innerHTML = mh;
      }
    }
  };

  Stats.openPanel = function (id) {
    if (!isBrowser) return;
    var screens = document.querySelectorAll('.modal');
    screens.forEach(function (s) { if (s.id !== id) s.classList.remove('show'); });
    var t = el(id);
    if (t) { t.classList.add('show'); t.setAttribute('aria-hidden', 'false'); }
  };
  Stats.closePanel = function (id) {
    var t = el(id);
    if (t) { t.classList.remove('show'); t.setAttribute('aria-hidden', 'true'); }
  };

  Stats.MODE_LABEL = MODE_LABEL;
  Stats.DIFF_LABEL = DIFF_LABEL;
  Stats.fmtTime = Logic.fmtTime;

  if (typeof window !== 'undefined') {
    window.TypeDuelStats = Stats;
    window.TypeDuelStatsLogic = Logic;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Stats: Stats, Logic: Logic };
  }
})(typeof window !== 'undefined' ? window : globalThis);
