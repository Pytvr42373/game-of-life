(function () {
  'use strict';

  if (window.__ghAntiAddictionLoaded) return;
  window.__ghAntiAddictionLoaded = true;

  var STATE_KEY = 'gh-wellbeing-v1';
  var LEASE_KEY = 'gh-wellbeing-owner-v1';
  var PLAY_REMINDER_MS = 15 * 60 * 1000;
  var HEARTBEAT_MS = 5000;
  var LEASE_MS = 12000;
  var MAX_STEP_MS = HEARTBEAT_MS * 3;
  var CLOCK_REMINDERS = [
    { time: '17:10', danger: false, title: '已经 17:10 了', sub: '今天玩得差不多了，可以准备休息啦。' },
    { time: '17:15', danger: false, title: '17:15 了，时间不早啦', sub: '建议今天先到这里，去休息吧。' },
    { time: '17:20', danger: true, title: '17:20 了，很晚了', sub: '为了健康，请立刻停止游戏去休息。' }
  ];

  var tabId = createTabId();
  var lastCountedAt = 0;
  var host = null;
  var banner = null;
  var titleElement = null;
  var subElement = null;
  var closeButton = null;
  var hideTimer = null;
  var noticeQueue = [];
  var noticeVisible = false;

  function createTabId() {
    try {
      var values = new Uint32Array(2);
      crypto.getRandomValues(values);
      return values[0].toString(36) + values[1].toString(36);
    } catch (error) {
      return Math.random().toString(36).slice(2) + Date.now().toString(36);
    }
  }

  function dateKey(value) {
    var date = value instanceof Date ? value : new Date(value);
    var month = String(date.getMonth() + 1).padStart(2, '0');
    var day = String(date.getDate()).padStart(2, '0');
    return date.getFullYear() + '-' + month + '-' + day;
  }

  function freshState(day) {
    return {
      date: day,
      activeMs: 0,
      playReminderShown: false,
      clockReminders: [],
      updatedAt: Date.now()
    };
  }

  function safeGet(key) {
    try { return localStorage.getItem(key); } catch (error) { return null; }
  }

  function safeSet(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (error) {
      return false;
    }
  }

  function safeRemove(key) {
    try { localStorage.removeItem(key); } catch (error) {}
  }

  function readState(now) {
    var day = dateKey(now);
    var parsed = null;
    try { parsed = JSON.parse(safeGet(STATE_KEY) || 'null'); } catch (error) {}
    if (!parsed || parsed.date !== day) return { state: freshState(day), dirty: true };

    var activeMs = Number(parsed.activeMs);
    var dirty = !(isFinite(activeMs) && activeMs >= 0) ||
      (parsed.playReminderShown !== true && parsed.playReminderShown !== false) ||
      !Array.isArray(parsed.clockReminders);
    parsed.activeMs = isFinite(activeMs) && activeMs >= 0 ? activeMs : 0;
    parsed.playReminderShown = parsed.playReminderShown === true;
    parsed.clockReminders = Array.isArray(parsed.clockReminders) ? parsed.clockReminders : [];
    return { state: parsed, dirty: dirty };
  }

  function writeState(state, now) {
    state.updatedAt = now;
    safeSet(STATE_KEY, JSON.stringify(state));
  }

  function readLease() {
    try { return JSON.parse(safeGet(LEASE_KEY) || 'null'); } catch (error) { return null; }
  }

  function claimLease(now) {
    var lease = readLease();
    if (lease && lease.id !== tabId && Number(lease.expiresAt) > now) return false;

    var stored = safeSet(LEASE_KEY, JSON.stringify({ id: tabId, expiresAt: now + LEASE_MS }));
    if (!stored) return true;
    lease = readLease();
    return !!lease && lease.id === tabId;
  }

  function ownsLease() {
    var lease = readLease();
    return !lease || lease.id === tabId;
  }

  function releaseLease() {
    var lease = readLease();
    if (lease && lease.id === tabId) safeRemove(LEASE_KEY);
  }

  function queueNotice(title, sub, danger) {
    noticeQueue.push({ title: title, sub: sub, danger: danger });
    showNextNotice();
  }

  function showNextNotice() {
    if (!banner || noticeVisible || !noticeQueue.length) return;
    var notice = noticeQueue.shift();
    noticeVisible = true;
    titleElement.textContent = notice.title;
    subElement.textContent = notice.sub;
    banner.classList.toggle('danger', notice.danger);
    banner.classList.add('show');
    banner.setAttribute('aria-hidden', 'false');
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(hideNotice, notice.danger ? 9000 : 10000);
  }

  function hideNotice() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    if (banner) {
      banner.classList.remove('show');
      banner.setAttribute('aria-hidden', 'true');
    }
    noticeVisible = false;
    setTimeout(showNextNotice, 250);
  }

  function checkClockReminders(state, now) {
    var date = new Date(now);
    var current = String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
    var changed = false;

    for (var i = 0; i < CLOCK_REMINDERS.length; i += 1) {
      var reminder = CLOCK_REMINDERS[i];
      if (reminder.time === current && state.clockReminders.indexOf(current) === -1) {
        state.clockReminders.push(current);
        queueNotice(reminder.title, reminder.sub, reminder.danger);
        changed = true;
      }
    }
    return changed;
  }

  function recordTime(now, includeElapsed) {
    var result = readState(now);
    var state = result.state;
    var changed = result.dirty;

    if (includeElapsed && lastCountedAt) {
      var start = lastCountedAt;
      if (dateKey(start) !== state.date) {
        var midnight = new Date(now);
        midnight.setHours(0, 0, 0, 0);
        start = Math.max(start, midnight.getTime());
      }
      var elapsed = Math.max(0, Math.min(now - start, MAX_STEP_MS));
      if (elapsed) {
        state.activeMs += elapsed;
        changed = true;
      }
    }

    if (!state.playReminderShown && state.activeMs >= PLAY_REMINDER_MS) {
      state.playReminderShown = true;
      queueNotice(
        '已经使用 GameHub ' + Math.floor(state.activeMs / 60000) + ' 分钟',
        '看看远处、活动一下，休息后再继续。',
        true
      );
      changed = true;
    }

    if (checkClockReminders(state, now)) changed = true;
    if (changed) writeState(state, now);
  }

  function heartbeat() {
    var now = Date.now();
    if (document.visibilityState !== 'visible') {
      stopCounting(true);
      return;
    }
    if (!claimLease(now)) {
      lastCountedAt = 0;
      return;
    }

    recordTime(now, lastCountedAt !== 0);
    lastCountedAt = now;
  }

  function stopCounting(flush) {
    var now = Date.now();
    if (flush && lastCountedAt && ownsLease()) recordTime(now, true);
    lastCountedAt = 0;
    releaseLease();
  }

  function detectDarkPage() {
    var bodyTheme = document.body && document.body.getAttribute('data-theme');
    var htmlTheme = document.documentElement.getAttribute('data-theme');
    if (bodyTheme === 'arcade' || htmlTheme === 'arcade' || document.documentElement.classList.contains('pre-arcade')) return true;
    if (bodyTheme === '4399' || htmlTheme === '4399') return false;

    var themeColor = document.querySelector('meta[name="theme-color"]');
    var color = themeColor ? themeColor.getAttribute('content') : '';
    if (!color && document.body) color = getComputedStyle(document.body).backgroundColor;
    var match = color && color.match(/#([0-9a-f]{6})|rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)/i);
    if (!match) return false;
    var red = match[1] ? parseInt(match[1].slice(0, 2), 16) : Number(match[2]);
    var green = match[1] ? parseInt(match[1].slice(2, 4), 16) : Number(match[3]);
    var blue = match[1] ? parseInt(match[1].slice(4, 6), 16) : Number(match[4]);
    return red * 0.299 + green * 0.587 + blue * 0.114 < 110;
  }

  function syncTone() {
    if (host) host.setAttribute('data-tone', detectDarkPage() ? 'dark' : 'light');
  }

  function buildUi() {
    if (!document.body || host) return;
    host = document.createElement('div');
    host.id = 'gh-wellbeing-host';
    host.setAttribute('data-tone', 'light');
    var root = host.attachShadow({ mode: 'open' });
    root.innerHTML =
      '<style>' +
      ':host{all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}' +
      '.notice{position:absolute;left:50%;bottom:max(24px,env(safe-area-inset-bottom));width:min(500px,calc(100vw - 32px));box-sizing:border-box;display:flex;align-items:center;gap:13px;padding:14px 15px;color:#24401d;background:rgba(255,255,255,.97);border:2px solid #d8e8cd;border-radius:14px;box-shadow:0 12px 34px rgba(0,0,0,.24);opacity:0;transform:translate(-50%,calc(100% + 48px));transition:transform .35s ease,opacity .35s ease;pointer-events:none}' +
      ':host([data-tone="dark"]) .notice{color:#f4f4ff;background:rgba(16,16,35,.97);border-color:#3a3a5c;border-radius:4px;box-shadow:5px 5px 0 #000,0 0 24px rgba(61,225,255,.2)}' +
      '.notice.show{opacity:1;transform:translate(-50%,0);pointer-events:auto}' +
      '.notice.danger{border-color:#e64e00}' +
      ':host([data-tone="dark"]) .notice.danger{border-color:#ff2d78;box-shadow:5px 5px 0 #000,0 0 28px rgba(255,45,120,.35)}' +
      '.icon{width:31px;height:31px;flex:0 0 31px;color:#389904}' +
      '.danger .icon{color:#e64e00}' +
      ':host([data-tone="dark"]) .icon{color:#3de1ff}' +
      ':host([data-tone="dark"]) .danger .icon{color:#ff2d78}' +
      '.copy{min-width:0;flex:1}' +
      '.title{font-size:15px;font-weight:800;line-height:1.4}' +
      '.sub{margin-top:3px;color:#6f8a63;font-size:12px;line-height:1.5}' +
      ':host([data-tone="dark"]) .sub{color:#a8a8c8}' +
      'button{flex:0 0 auto;min-height:36px;padding:7px 14px;color:#fff;background:#389904;border:0;border-radius:999px;font-family:inherit;font-size:12px;font-weight:700;line-height:1;cursor:pointer}' +
      ':host([data-tone="dark"]) button{color:#0b0b18;background:#3de1ff;border-radius:3px}' +
      'button:focus-visible{outline:3px solid #fb6400;outline-offset:2px}' +
      '@media(max-width:560px){.notice{bottom:max(76px,calc(env(safe-area-inset-bottom) + 66px));align-items:flex-start}.icon{width:27px;height:27px;flex-basis:27px}.title{font-size:14px}button{align-self:center;padding:7px 11px}}' +
      '@media(prefers-reduced-motion:reduce){.notice{transition:none}}' +
      '</style>' +
      '<section class="notice" role="alert" aria-live="assertive" aria-hidden="true">' +
      '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.7 1.8M9 3h6"/></svg>' +
      '<div class="copy"><div class="title"></div><div class="sub"></div></div>' +
      '<button type="button">知道了</button>' +
      '</section>';
    document.body.appendChild(host);
    banner = root.querySelector('.notice');
    titleElement = root.querySelector('.title');
    subElement = root.querySelector('.sub');
    closeButton = root.querySelector('button');
    closeButton.addEventListener('click', hideNotice);
    syncTone();
    showNextNotice();

    if (window.MutationObserver) {
      var observer = new MutationObserver(syncTone);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
      observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    }
  }

  function start() {
    buildUi();
    safeRemove('golPlaySeconds');
    safeRemove('golPlayWarnedDate');
    heartbeat();
    setInterval(heartbeat, HEARTBEAT_MS);

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') heartbeat();
      else stopCounting(true);
    });
    window.addEventListener('pagehide', function () { stopCounting(true); });
    window.addEventListener('pageshow', heartbeat);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
