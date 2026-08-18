(function (globalScope) {
  "use strict";

  const SIDES = ["T", "R", "B", "L"];
  const OUTCOME_LABELS = {
    exit: "出口",
    hit: "命中",
    reflection: "反射",
    loop: "回路"
  };
  const BEST_STORAGE_KEY = "ray-lab-best-v1";
  const MAX_HINTS = 2;

  const DIFFICULTIES = Object.freeze({
    trainee: Object.freeze({
      name: "见习",
      code: "T",
      size: 5,
      particles: 4,
      baseScore: 6200,
      boards: Object.freeze([
        Object.freeze([2, 4, 5, 24]),
        Object.freeze([0, 8, 12, 19]),
        Object.freeze([0, 1, 8, 22])
      ])
    }),
    detective: Object.freeze({
      name: "侦探",
      code: "D",
      size: 6,
      particles: 5,
      baseScore: 9000,
      boards: Object.freeze([
        Object.freeze([4, 24, 25, 29, 35]),
        Object.freeze([8, 12, 31, 33, 35]),
        Object.freeze([2, 12, 16, 26, 33])
      ])
    })
  });

  const RULE_DEMOS = Object.freeze({
    straight: Object.freeze({ size: 3, particles: Object.freeze([]), entry: "T02" }),
    hit: Object.freeze({ size: 3, particles: Object.freeze([1]), entry: "T02" }),
    turn: Object.freeze({ size: 3, particles: Object.freeze([5]), entry: "T02" }),
    reflection: Object.freeze({ size: 3, particles: Object.freeze([3, 5]), entry: "T02" })
  });

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function cellKey(row, col, size) {
    return row * size + col;
  }

  function isInside(row, col, size) {
    return row >= 0 && row < size && col >= 0 && col < size;
  }

  function createPort(side, index, size) {
    const definitions = {
      T: { row: -1, col: index, dr: 1, dc: 0 },
      R: { row: index, col: size, dr: 0, dc: -1 },
      B: { row: size, col: index, dr: -1, dc: 0 },
      L: { row: index, col: -1, dr: 0, dc: 1 }
    };
    const port = definitions[side];
    return {
      id: side + pad2(index + 1),
      side,
      index,
      row: port.row,
      col: port.col,
      dr: port.dr,
      dc: port.dc
    };
  }

  function createPorts(size) {
    const ports = [];
    SIDES.forEach(function (side) {
      for (let index = 0; index < size; index += 1) {
        ports.push(createPort(side, index, size));
      }
    });
    return ports;
  }

  function exitPortId(row, col, size) {
    if (row < 0) return "T" + pad2(col + 1);
    if (row >= size) return "B" + pad2(col + 1);
    if (col < 0) return "L" + pad2(row + 1);
    return "R" + pad2(row + 1);
  }

  function asParticleSet(particles) {
    return particles instanceof Set ? particles : new Set(particles);
  }

  /**
   * Ray model: enter the first edge cell, then inspect the three cells one
   * step forward from every occupied ray position. Direct takes precedence;
   * one diagonal turns away, and two diagonals return the ray along its path.
   */
  function traceRay(size, particlesInput, entryInput) {
    const particles = asParticleSet(particlesInput);
    const entry = typeof entryInput === "string"
      ? createPorts(size).find(function (port) { return port.id === entryInput; })
      : entryInput;

    if (!entry) throw new Error("Unknown ray entry port");

    let row = entry.row;
    let col = entry.col;
    let dr = entry.dr;
    let dc = entry.dc;
    const path = [{ row, col }];
    const events = [];
    const visited = new Set();
    let deflections = 0;

    while (true) {
      const stateKey = row + "," + col + "," + dr + "," + dc;
      if (visited.has(stateKey)) {
        events.push({ row, col, type: "loop" });
        return {
          outcome: "loop",
          entry: entry.id,
          exit: null,
          path,
          events,
          deflections,
          statesVisited: visited.size
        };
      }
      visited.add(stateKey);

      const nextRow = row + dr;
      const nextCol = col + dc;

      if (!isInside(nextRow, nextCol, size)) {
        const exit = exitPortId(nextRow, nextCol, size);
        path.push({ row: nextRow, col: nextCol });
        return {
          outcome: "exit",
          entry: entry.id,
          exit,
          path,
          events,
          deflections,
          statesVisited: visited.size
        };
      }

      if (particles.has(cellKey(nextRow, nextCol, size))) {
        path.push({ row: nextRow, col: nextCol });
        events.push({ row: nextRow, col: nextCol, type: "hit" });
        return {
          outcome: "hit",
          entry: entry.id,
          exit: null,
          path,
          events,
          deflections,
          statesVisited: visited.size
        };
      }

      // The outside state only tests the directly facing edge cell.
      if (!isInside(row, col, size)) {
        row = nextRow;
        col = nextCol;
        path.push({ row, col });
        continue;
      }

      // Facing direction's geometric left is (-dc, dr); right is (dc, -dr).
      const leftRow = nextRow - dc;
      const leftCol = nextCol + dr;
      const rightRow = nextRow + dc;
      const rightCol = nextCol - dr;
      const leftBlocked = isInside(leftRow, leftCol, size)
        && particles.has(cellKey(leftRow, leftCol, size));
      const rightBlocked = isInside(rightRow, rightCol, size)
        && particles.has(cellKey(rightRow, rightCol, size));

      if (leftBlocked && rightBlocked) {
        events.push({ row, col, type: "reflection" });
        const returnPath = path.slice(0, -1).reverse();
        return {
          outcome: "reflection",
          entry: entry.id,
          exit: entry.id,
          path: path.concat(returnPath),
          events,
          deflections,
          statesVisited: visited.size
        };
      }

      if (leftBlocked || rightBlocked) {
        const oldDr = dr;
        if (leftBlocked) {
          dr = dc;
          dc = -oldDr;
        } else {
          dr = -dc;
          dc = oldDr;
        }
        deflections += 1;
        events.push({ row, col, type: "deflection" });
        continue;
      }

      row = nextRow;
      col = nextCol;
      path.push({ row, col });
    }
  }

  function renderRuleDiagrams() {
    const svgNamespace = "http://www.w3.org/2000/svg";
    const boardX = 56;
    const boardY = 41;
    const cellSize = 36;

    function addSvg(parent, tagName, attributes, text) {
      const element = document.createElementNS(svgNamespace, tagName);
      Object.keys(attributes || {}).forEach(function (name) {
        element.setAttribute(name, String(attributes[name]));
      });
      if (text !== undefined) element.textContent = text;
      if (parent) parent.appendChild(element);
      return element;
    }

    function mapPoint(point) {
      return {
        x: boardX + (point.col + 0.5) * cellSize,
        y: boardY + (point.row + 0.5) * cellSize
      };
    }

    function compactRoute(points) {
      if (points.length < 2) return points.slice();
      const route = [points[0]];
      let previousDirection = null;
      for (let index = 1; index < points.length; index += 1) {
        const direction = Math.sign(points[index].x - points[index - 1].x)
          + "," + Math.sign(points[index].y - points[index - 1].y);
        if (previousDirection && direction !== previousDirection) route.push(points[index - 1]);
        previousDirection = direction;
      }
      route.push(points[points.length - 1]);
      return route;
    }

    document.querySelectorAll("[data-rule-demo]").forEach(function (container) {
      const demoName = container.dataset.ruleDemo;
      const demo = RULE_DEMOS[demoName];
      if (!demo) return;

      const result = traceRay(demo.size, demo.particles, demo.entry);
      const boardSize = demo.size * cellSize;
      const svg = addSvg(null, "svg", {
        viewBox: "0 0 220 190",
        preserveAspectRatio: "xMidYMid meet",
        "aria-hidden": "true",
        focusable: "false"
      });
      addSvg(svg, "rect", {
        class: "rule-demo-board",
        x: boardX,
        y: boardY,
        width: boardSize,
        height: boardSize
      });
      for (let line = 1; line < demo.size; line += 1) {
        addSvg(svg, "line", {
          class: "rule-demo-grid-line",
          x1: boardX + line * cellSize,
          y1: boardY,
          x2: boardX + line * cellSize,
          y2: boardY + boardSize
        });
        addSvg(svg, "line", {
          class: "rule-demo-grid-line",
          x1: boardX,
          y1: boardY + line * cellSize,
          x2: boardX + boardSize,
          y2: boardY + line * cellSize
        });
      }

      const mappedPath = result.path.map(mapPoint);
      addSvg(svg, "polyline", {
        class: "rule-demo-beam is-" + result.outcome,
        points: mappedPath.map(function (point) { return point.x + "," + point.y; }).join(" ")
      });
      const route = compactRoute(mappedPath);
      for (let index = 1; index < route.length; index += 1) {
        const from = route[index - 1];
        const to = route[index];
        const ratio = result.outcome === "reflection" ? 0.67 : 0.56;
        const x = from.x + (to.x - from.x) * ratio;
        const y = from.y + (to.y - from.y) * ratio;
        const angle = Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI;
        addSvg(svg, "path", {
          class: "rule-demo-arrow",
          d: "M -5 -3 L 4 0 L -5 3 Z",
          transform: "translate(" + x + " " + y + ") rotate(" + angle + ")"
        });
      }

      demo.particles.forEach(function (particle) {
        const point = mapPoint({
          row: Math.floor(particle / demo.size),
          col: particle % demo.size
        });
        addSvg(svg, "circle", { class: "rule-demo-particle", cx: point.x, cy: point.y, r: 9 });
        addSvg(svg, "text", {
          class: "rule-demo-particle-label",
          x: point.x,
          y: point.y + 2.5
        }, "P");
      });

      result.events.forEach(function (event) {
        const point = mapPoint(event);
        addSvg(svg, "circle", {
          class: "rule-demo-event is-" + event.type,
          cx: point.x,
          cy: point.y,
          r: event.type === "hit" ? 13 : 7
        });
      });

      const ports = createPorts(demo.size);
      function drawPort(portId, isReturn) {
        const port = ports.find(function (item) { return item.id === portId; });
        if (!port) return;
        const point = mapPoint(port);
        addSvg(svg, "circle", {
          class: "rule-demo-port" + (isReturn ? " is-return" : ""),
          cx: point.x,
          cy: point.y,
          r: 4
        });
        const label = { x: point.x, y: point.y + 3, anchor: "middle" };
        if (port.side === "T") label.y = 11;
        else if (port.side === "B") label.y = 185;
        else if (port.side === "L") {
          label.x = point.x - 9;
          label.anchor = "end";
        } else {
          label.x = point.x + 9;
          label.anchor = "start";
        }
        addSvg(svg, "text", {
          class: "rule-demo-port-label",
          x: label.x,
          y: label.y,
          "text-anchor": label.anchor
        }, portId);
      }

      drawPort(result.entry, result.outcome === "reflection");
      if (result.exit && result.exit !== result.entry) drawPort(result.exit, false);

      const outcomeLabels = {
        straight: "STRAIGHT",
        hit: "HIT",
        turn: "TURN AWAY",
        reflection: "RETURN"
      };
      const routeLabel = result.outcome === "hit"
        ? result.entry + " · STOP"
        : result.entry + " → " + result.exit;
      addSvg(svg, "text", { class: "rule-demo-outcome", x: 170, y: 22 }, outcomeLabels[demoName]);
      addSvg(svg, "text", { class: "rule-demo-route", x: 170, y: 35 }, routeLabel);
      container.replaceChildren(svg);
    });
  }

  function outcomeSignature(result) {
    if (result.outcome === "exit") return ">" + result.exit;
    if (result.outcome === "hit") return "H";
    if (result.outcome === "reflection") return "R";
    return "L";
  }

  function layoutSignature(size, particles) {
    return createPorts(size).map(function (port) {
      return outcomeSignature(traceRay(size, particles, port));
    }).join("|");
  }

  function countMatchingLayouts(size, particleCount, targetParticles, stopAfter) {
    const ports = createPorts(size);
    const target = ports.map(function (port) {
      return outcomeSignature(traceRay(size, targetParticles, port));
    });
    const chosen = [];
    const cellCount = size * size;
    const limit = stopAfter || Infinity;
    let matches = 0;

    function candidateMatches() {
      const candidate = new Set(chosen);
      for (let index = 0; index < ports.length; index += 1) {
        if (outcomeSignature(traceRay(size, candidate, ports[index])) !== target[index]) {
          return false;
        }
      }
      return true;
    }

    function choose(start) {
      if (matches >= limit) return;
      if (chosen.length === particleCount) {
        if (candidateMatches()) matches += 1;
        return;
      }
      const needed = particleCount - chosen.length;
      for (let cell = start; cell <= cellCount - needed; cell += 1) {
        chosen.push(cell);
        choose(cell + 1);
        chosen.pop();
        if (matches >= limit) return;
      }
    }

    choose(0);
    return matches;
  }

  function formatTime(totalSeconds) {
    const safeSeconds = Math.max(0, Math.floor(totalSeconds));
    const minutes = Math.floor(safeSeconds / 60);
    const seconds = safeSeconds % 60;
    return pad2(minutes) + ":" + pad2(seconds);
  }

  function calculateScore(config, elapsedSeconds, rays, hints, failedAttempts) {
    return Math.max(100, config.baseScore
      - Math.floor(elapsedSeconds) * 3
      - rays * 115
      - hints * 700
      - failedAttempts * 250);
  }

  const app = {
    elements: {},
    portElements: new Map(),
    difficultyId: "trainee",
    boardCursor: { trainee: -1, detective: -1 },
    config: DIFFICULTIES.trainee,
    boardCells: [],
    particles: new Set(),
    marks: [],
    hintedCells: new Set(),
    markMode: "particle",
    undoStack: [],
    redoStack: [],
    observations: new Map(),
    currentTrace: null,
    hintsUsed: 0,
    failedAttempts: 0,
    startedAt: 0,
    elapsedSeconds: 0,
    timerHandle: null,
    gameOver: false,
    bestResults: {},
    toastHandle: null,
    rulesTimerWasRunning: false,
    rulesLastFocused: null,
    rulesDialogFallback: false
  };

  function getElements() {
    const ids = [
      "themeToggle", "difficulty", "newGame", "resetMarks", "undoMark",
      "redoMark", "hintButton", "rayCount", "marksRemaining", "timer",
      "bestResult", "boardCode", "rayBoard", "topPorts", "rightPorts",
      "bottomPorts", "leftPorts", "cellGrid", "rayOverlay", "latestReading",
      "readingTitle", "readingDetail", "showRayPath", "recordCount",
      "observationList", "submitLayout", "resultDialog", "resultSummary",
      "finalScore", "finalTime", "finalRays", "closeResult",
      "resultNewGame", "rulesDialog", "rulesClose", "rulesStart", "toast"
    ];
    ids.forEach(function (id) {
      app.elements[id] = document.getElementById(id);
    });
    app.elements.cellStage = document.querySelector(".cell-stage");
    app.elements.markModes = Array.from(document.querySelectorAll(".mark-mode"));
  }

  function safeStorageGet(key) {
    try {
      return globalScope.localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function safeStorageSet(key, value) {
    try {
      globalScope.localStorage.setItem(key, value);
    } catch (error) {
      // Storage can be unavailable in private or sandboxed browser contexts.
    }
  }

  function themeIcon(theme) {
    if (theme === "arcade") {
      return '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M12 12 L21 6 A10 10 0 1 0 21 18 Z"/><circle cx="13.5" cy="7.5" r="1.1" fill="#ffffff"/></svg>';
    }
    return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3C9.8 3 8 4.8 8 7c0 .6.1 1.2.4 1.7C6.5 9.4 5.2 11 5.2 13c0 2.2 1.8 4 4 4h5.6c2.2 0 4-1.8 4-4 0-2-1.3-3.6-3.2-4.3.3-.5.4-1.1.4-1.7 0-2.2-1.8-4-4-4z"/><path d="M12 17v4"/><path d="M12 21l-3 2M12 21l3 2"/></svg>';
  }

  function applyTheme(theme, persist) {
    const safeTheme = theme === "arcade" ? "arcade" : "4399";
    document.body.dataset.theme = safeTheme;
    const targetTheme = safeTheme === "arcade" ? "4399" : "arcade";
    app.elements.themeToggle.innerHTML = themeIcon(targetTheme);
    app.elements.themeToggle.setAttribute(
      "aria-label",
      safeTheme === "arcade" ? "切换到清新实验室主题" : "切换到街机仪器主题"
    );
    if (persist) safeStorageSet("gh-theme", safeTheme);
  }

  function toggleTheme() {
    applyTheme(document.body.dataset.theme === "arcade" ? "4399" : "arcade", true);
  }

  function loadBestResults() {
    const raw = safeStorageGet(BEST_STORAGE_KEY);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  function saveBestResult(score) {
    const previous = app.bestResults[app.difficultyId];
    if (previous && previous.score >= score) return false;
    app.bestResults[app.difficultyId] = {
      score,
      time: app.elapsedSeconds,
      rays: app.observations.size
    };
    safeStorageSet(BEST_STORAGE_KEY, JSON.stringify(app.bestResults));
    return true;
  }

  function updateBestDisplay() {
    const best = app.bestResults[app.difficultyId];
    app.elements.bestResult.textContent = best
      ? best.score + " 分 · " + formatTime(best.time)
      : "暂无记录";
  }

  function showToast(message, isError) {
    globalScope.clearTimeout(app.toastHandle);
    app.elements.toast.textContent = message;
    app.elements.toast.classList.toggle("error", Boolean(isError));
    app.elements.toast.classList.add("show");
    app.toastHandle = globalScope.setTimeout(function () {
      app.elements.toast.classList.remove("show");
    }, 2600);
  }

  function updateTimer() {
    if (!app.gameOver) {
      app.elapsedSeconds = Math.floor((Date.now() - app.startedAt) / 1000);
    }
    app.elements.timer.textContent = formatTime(app.elapsedSeconds);
  }

  function startTimer() {
    globalScope.clearInterval(app.timerHandle);
    app.startedAt = Date.now();
    app.elapsedSeconds = 0;
    updateTimer();
    app.timerHandle = globalScope.setInterval(updateTimer, 250);
  }

  function stopTimer() {
    updateTimer();
    globalScope.clearInterval(app.timerHandle);
    app.timerHandle = null;
  }

  function pauseTimer() {
    if (app.timerHandle === null) return;
    updateTimer();
    globalScope.clearInterval(app.timerHandle);
    app.timerHandle = null;
  }

  function resumeTimer() {
    if (app.gameOver || app.timerHandle !== null) return;
    app.startedAt = Date.now() - app.elapsedSeconds * 1000;
    updateTimer();
    app.timerHandle = globalScope.setInterval(updateTimer, 250);
  }

  function serializeMarks() {
    return app.marks.join("");
  }

  function restoreMarks(snapshot) {
    app.marks = snapshot.split("").map(Number);
    renderMarks();
    updateStats();
  }

  function commitMarks(nextMarks) {
    const previous = serializeMarks();
    const next = nextMarks.join("");
    if (previous === next) return false;
    app.undoStack.push(previous);
    if (app.undoStack.length > 100) app.undoStack.shift();
    app.redoStack = [];
    app.marks = nextMarks;
    renderMarks();
    updateStats();
    return true;
  }

  function countParticleMarks() {
    return app.marks.reduce(function (sum, mark) {
      return sum + (mark === 1 ? 1 : 0);
    }, 0);
  }

  function updateStats() {
    const remaining = app.config.particles - countParticleMarks();
    app.elements.rayCount.textContent = app.observations.size + " / " + (app.config.size * 4);
    app.elements.marksRemaining.textContent = String(remaining);
    app.elements.marksRemaining.parentElement.classList.toggle("warning", remaining < 0);
    app.elements.recordCount.textContent = app.observations.size + " 条";
    app.elements.undoMark.disabled = app.undoStack.length === 0 || app.gameOver;
    app.elements.redoMark.disabled = app.redoStack.length === 0 || app.gameOver;
    app.elements.resetMarks.disabled = app.marks.every(function (mark) { return mark === 0; }) || app.gameOver;
    app.elements.hintButton.disabled = app.hintsUsed >= MAX_HINTS || app.gameOver;
    app.elements.hintButton.textContent = "请求提示 " + app.hintsUsed + "/" + MAX_HINTS;
  }

  function setMarkMode(mode) {
    app.markMode = mode;
    app.elements.markModes.forEach(function (button) {
      const active = button.dataset.mode === mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function cellDescription(index) {
    const row = Math.floor(index / app.config.size) + 1;
    const col = index % app.config.size + 1;
    const states = ["空白", "已标记粒子", "已标记候选"];
    return "第 " + row + " 行第 " + col + " 列，" + states[app.marks[index]];
  }

  function renderMarks() {
    const cells = app.elements.cellGrid.querySelectorAll(".cell");
    cells.forEach(function (cell, index) {
      cell.classList.toggle("mark-particle", app.marks[index] === 1);
      cell.classList.toggle("mark-candidate", app.marks[index] === 2);
      cell.classList.toggle("hinted", app.hintedCells.has(index));
      cell.setAttribute("aria-label", cellDescription(index));
    });
  }

  function changeCellMark(index, mode) {
    if (app.gameOver) return;
    const nextMarks = app.marks.slice();
    const targetValue = mode === "candidate" ? 2 : 1;
    const addingParticle = targetValue === 1 && nextMarks[index] !== 1;
    if (addingParticle && countParticleMarks() >= app.config.particles) {
      showToast("粒子标记已达到本级上限，可先移除一个标记。", true);
      return;
    }
    nextMarks[index] = nextMarks[index] === targetValue ? 0 : targetValue;
    commitMarks(nextMarks);
  }

  function buildCells() {
    app.elements.cellGrid.replaceChildren();
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < app.config.size * app.config.size; index += 1) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "cell";
      cell.setAttribute("role", "gridcell");
      cell.addEventListener("click", function () {
        changeCellMark(index, app.markMode);
      });
      cell.addEventListener("contextmenu", function (event) {
        event.preventDefault();
        changeCellMark(index, "candidate");
      });
      cell.addEventListener("keydown", function (event) {
        if (event.key.toLowerCase() === "x") {
          event.preventDefault();
          changeCellMark(index, "particle");
        } else if (event.key === "?" || event.key === "/") {
          event.preventDefault();
          changeCellMark(index, "candidate");
        } else if (event.key === "Delete" || event.key === "Backspace") {
          event.preventDefault();
          if (app.marks[index] !== 0) {
            const nextMarks = app.marks.slice();
            nextMarks[index] = 0;
            commitMarks(nextMarks);
          }
        }
      });
      fragment.appendChild(cell);
    }
    app.elements.cellGrid.appendChild(fragment);
    renderMarks();
  }

  function portContainer(side) {
    return {
      T: app.elements.topPorts,
      R: app.elements.rightPorts,
      B: app.elements.bottomPorts,
      L: app.elements.leftPorts
    }[side];
  }

  function buildPorts() {
    ["topPorts", "rightPorts", "bottomPorts", "leftPorts"].forEach(function (id) {
      app.elements[id].replaceChildren();
    });
    app.portElements.clear();
    createPorts(app.config.size).forEach(function (port) {
      const button = document.createElement("button");
      const number = document.createElement("span");
      const badge = document.createElement("span");
      button.type = "button";
      button.className = "ray-port";
      button.dataset.port = port.id;
      button.setAttribute("aria-label", "从端口 " + port.id + " 发射射线");
      number.className = "port-number";
      number.textContent = String(port.index + 1);
      badge.className = "port-badge";
      badge.setAttribute("aria-hidden", "true");
      button.append(number, badge);
      button.addEventListener("click", function () { fireRay(port); });
      portContainer(port.side).appendChild(button);
      app.portElements.set(port.id, button);
    });
  }

  function clearLatestPorts() {
    app.portElements.forEach(function (button) {
      button.classList.remove("latest");
    });
  }

  function applyPortReading(record) {
    const toneClass = "ray-tone-" + ((record.sequence - 1) % 6 + 1);
    const port = app.portElements.get(record.result.entry);
    if (!port) return;
    for (let tone = 1; tone <= 6; tone += 1) port.classList.remove("ray-tone-" + tone);
    port.classList.add("observed", toneClass);
    port.querySelector(".port-badge").textContent = record.result.outcome === "hit"
      ? "H" + pad2(record.sequence)
      : record.result.outcome === "reflection"
        ? "R" + pad2(record.sequence)
        : record.result.outcome === "loop"
          ? "L" + pad2(record.sequence)
          : pad2(record.sequence);
  }

  function resultTitle(result) {
    if (result.outcome === "exit") return result.entry + " → " + result.exit;
    if (result.outcome === "hit") return result.entry + " · 直接命中";
    if (result.outcome === "reflection") return result.entry + " · 双侧反射";
    return result.entry + " · 光线回路";
  }

  function resultDetail(result) {
    if (result.outcome === "exit") {
      return "从 " + result.exit + " 离舱，途中发生 " + result.deflections + " 次单侧偏转。";
    }
    if (result.outcome === "hit") {
      return "射线在前进方向遇到粒子并停止；此前偏转 " + result.deflections + " 次。";
    }
    if (result.outcome === "reflection") {
      return "两个前方对角粒子形成反射门，射线返回原入口。";
    }
    return "检测到重复的格心与方向状态，系统已停止射线以避免无限循环。";
  }

  function renderRayPath(result) {
    const svg = app.elements.rayOverlay;
    svg.replaceChildren();
    svg.setAttribute("viewBox", "0 0 " + app.config.size + " " + app.config.size);
    if (!app.elements.showRayPath.checked || !result) {
      svg.classList.add("hidden");
      return;
    }
    svg.classList.remove("hidden");
    const clamp = function (value) { return Math.max(0, Math.min(app.config.size, value)); };
    const points = result.path.map(function (point) {
      return clamp(point.col + 0.5) + "," + clamp(point.row + 0.5);
    }).join(" ");
    const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    line.setAttribute("class", "ray-line");
    line.setAttribute("points", points);
    svg.appendChild(line);
    result.events.forEach(function (event) {
      const point = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      point.setAttribute("cx", String(clamp(event.col + 0.5)));
      point.setAttribute("cy", String(clamp(event.row + 0.5)));
      point.setAttribute("r", event.type === "hit" ? "0.15" : "0.11");
      point.setAttribute("class", event.type === "hit" ? "hit-point" : "event-point");
      svg.appendChild(point);
    });
  }

  function showObservation(record, animate) {
    app.currentTrace = record.result;
    app.elements.latestReading.dataset.outcome = record.result.outcome;
    app.elements.readingTitle.textContent = resultTitle(record.result);
    app.elements.readingDetail.textContent = resultDetail(record.result);
    clearLatestPorts();
    app.portElements.get(record.result.entry).classList.add("latest");
    if (record.result.exit) app.portElements.get(record.result.exit).classList.add("latest");
    document.querySelectorAll(".observation").forEach(function (button) {
      button.classList.toggle("active", Number(button.dataset.sequence) === record.sequence);
    });
    renderRayPath(record.result);
    if (animate) {
      app.elements.cellStage.classList.remove("scanning");
      void app.elements.cellStage.offsetWidth;
      app.elements.cellStage.classList.add("scanning");
    }
  }

  function renderObservations() {
    app.elements.observationList.replaceChildren();
    if (app.observations.size === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-record";
      empty.innerHTML = '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="22"/><path d="M32 10v44M10 32h44M17 17l30 30M47 17 17 47"/></svg><p>尚无光谱记录</p><span>每个入口按发射顺序编号</span>';
      app.elements.observationList.appendChild(empty);
      return;
    }

    Array.from(app.observations.values())
      .sort(function (a, b) { return b.sequence - a.sequence; })
      .forEach(function (record) {
        const button = document.createElement("button");
        const sequence = document.createElement("span");
        const route = document.createElement("span");
        const title = document.createElement("strong");
        const detail = document.createElement("span");
        const outcome = document.createElement("span");
        button.type = "button";
        button.className = "observation";
        button.dataset.outcome = record.result.outcome;
        button.dataset.sequence = String(record.sequence);
        sequence.className = "sequence";
        sequence.textContent = pad2(record.sequence);
        route.className = "route";
        title.textContent = resultTitle(record.result);
        detail.textContent = record.result.deflections + " 次偏转 · 点击复查光路";
        route.append(title, detail);
        outcome.className = "outcome";
        outcome.textContent = OUTCOME_LABELS[record.result.outcome];
        button.append(sequence, route, outcome);
        button.addEventListener("click", function () { showObservation(record, false); });
        app.elements.observationList.appendChild(button);
      });
  }

  function fireRay(port) {
    if (app.gameOver) {
      showToast("本案已结案，可在观测簿中复查已有光路。", false);
      return;
    }
    let record = app.observations.get(port.id);
    const isNew = !record;
    if (isNew) {
      record = {
        sequence: app.observations.size + 1,
        result: traceRay(app.config.size, app.particles, port)
      };
      app.observations.set(port.id, record);
      applyPortReading(record);
      renderObservations();
      updateStats();
    }
    showObservation(record, true);
    if (!isNew) showToast("已复查端口 " + port.id + "，探测计数不增加。", false);
  }

  function undoMarks() {
    if (app.undoStack.length === 0 || app.gameOver) return;
    app.redoStack.push(serializeMarks());
    restoreMarks(app.undoStack.pop());
  }

  function redoMarks() {
    if (app.redoStack.length === 0 || app.gameOver) return;
    app.undoStack.push(serializeMarks());
    restoreMarks(app.redoStack.pop());
  }

  function resetMarks() {
    if (app.gameOver) return;
    if (commitMarks(new Array(app.config.size * app.config.size).fill(0))) {
      showToast("格子标记已清除，射线记录保留。", false);
    }
  }

  function giveHint() {
    if (app.gameOver || app.hintsUsed >= MAX_HINTS) return;
    const available = app.boardCells.filter(function (index) {
      return app.marks[index] !== 1;
    });
    if (available.length === 0) {
      showToast("所有真实粒子都已有实心标记。", false);
      return;
    }
    const pick = available[(app.hintsUsed + app.boardCursor[app.difficultyId]) % available.length];
    const nextMarks = app.marks.slice();
    if (countParticleMarks() >= app.config.particles) {
      const wrongMark = nextMarks.findIndex(function (mark, index) {
        return mark === 1 && !app.particles.has(index);
      });
      if (wrongMark !== -1) nextMarks[wrongMark] = 0;
    }
    nextMarks[pick] = 1;
    app.hintsUsed += 1;
    app.hintedCells.add(pick);
    commitMarks(nextMarks);
    showToast("提示已锁定一个真实粒子；结算时将扣除提示分。", false);
  }

  function revealBoard() {
    const cells = app.elements.cellGrid.querySelectorAll(".cell");
    cells.forEach(function (cell, index) {
      cell.classList.toggle("revealed-particle", app.particles.has(index));
      cell.classList.toggle("wrong-mark", app.marks[index] === 1 && !app.particles.has(index));
      cell.disabled = true;
    });
  }

  function submitLayout() {
    if (app.gameOver) return;
    const marked = countParticleMarks();
    if (marked !== app.config.particles) {
      showToast("需要正好标记 " + app.config.particles + " 个粒子，目前为 " + marked + " 个。", true);
      return;
    }
    let correct = 0;
    app.marks.forEach(function (mark, index) {
      if (mark === 1 && app.particles.has(index)) correct += 1;
    });
    if (correct !== app.config.particles) {
      app.failedAttempts += 1;
      const wrong = app.config.particles - correct;
      showToast("布局未通过：" + correct + " 个位置正确，" + wrong + " 个位置错误。", true);
      return;
    }

    app.gameOver = true;
    stopTimer();
    revealBoard();
    updateStats();
    const score = calculateScore(
      app.config,
      app.elapsedSeconds,
      app.observations.size,
      app.hintsUsed,
      app.failedAttempts
    );
    const isBest = saveBestResult(score);
    updateBestDisplay();
    app.elements.finalScore.textContent = String(score);
    app.elements.finalTime.textContent = formatTime(app.elapsedSeconds);
    app.elements.finalRays.textContent = String(app.observations.size);
    app.elements.resultSummary.textContent = isBest
      ? "完整布局与密封舱一致，已刷新本级最佳记录。"
      : "完整布局与密封舱一致，推演结案。";
    if (typeof app.elements.resultDialog.showModal === "function") {
      app.elements.resultDialog.showModal();
    } else {
      app.elements.resultDialog.setAttribute("open", "");
    }
  }

  function closeResultDialog() {
    if (typeof app.elements.resultDialog.close === "function") {
      app.elements.resultDialog.close();
    } else {
      app.elements.resultDialog.removeAttribute("open");
    }
  }

  function finishRulesDialogClose() {
    const shouldResume = app.rulesTimerWasRunning;
    const focusTarget = app.rulesLastFocused;
    app.rulesTimerWasRunning = false;
    app.rulesLastFocused = null;
    if (shouldResume) resumeTimer();
    if (focusTarget && focusTarget.isConnected && typeof focusTarget.focus === "function") {
      focusTarget.focus();
    }
  }

  function isRulesDialogOpen() {
    return Boolean(app.elements.rulesDialog.open || app.elements.rulesDialog.hasAttribute("open"));
  }

  function setRulesBackgroundInert(active) {
    Array.from(document.body.children).forEach(function (child) {
      if (child === app.elements.rulesDialog || child.tagName === "SCRIPT") return;
      child.inert = active;
      if (active) {
        child.dataset.rulesPreviousAriaHidden = child.hasAttribute("aria-hidden")
          ? child.getAttribute("aria-hidden") : "__none__";
        child.setAttribute("aria-hidden", "true");
      } else if (child.dataset.rulesPreviousAriaHidden !== undefined) {
        const previous = child.dataset.rulesPreviousAriaHidden;
        if (previous === "__none__") child.removeAttribute("aria-hidden");
        else child.setAttribute("aria-hidden", previous);
        delete child.dataset.rulesPreviousAriaHidden;
      }
    });
  }

  function closeRulesDialog() {
    if (!isRulesDialogOpen()) return;
    if (!app.rulesDialogFallback && typeof app.elements.rulesDialog.close === "function") {
      app.elements.rulesDialog.close();
    } else {
      app.elements.rulesDialog.removeAttribute("open");
      app.elements.rulesDialog.classList.remove("is-fallback");
      setRulesBackgroundInert(false);
      app.rulesDialogFallback = false;
      finishRulesDialogClose();
    }
  }

  function openRulesDialog() {
    if (isRulesDialogOpen()) return;
    app.rulesLastFocused = document.activeElement;
    app.rulesTimerWasRunning = !app.gameOver && app.timerHandle !== null;
    if (app.rulesTimerWasRunning) pauseTimer();
    if (typeof app.elements.rulesDialog.showModal === "function") {
      app.elements.rulesDialog.showModal();
    } else {
      app.rulesDialogFallback = true;
      app.elements.rulesDialog.classList.add("is-fallback");
      app.elements.rulesDialog.setAttribute("open", "");
      setRulesBackgroundInert(true);
    }
    app.elements.rulesClose.focus();
  }

  function resetReading() {
    app.elements.latestReading.dataset.outcome = "idle";
    app.elements.readingTitle.textContent = "等待发射";
    app.elements.readingDetail.textContent = "选择任意边缘端口，系统将记录入口、结果与光路。";
    app.elements.rayOverlay.replaceChildren();
  }

  function newGame() {
    closeResultDialog();
    app.difficultyId = app.elements.difficulty.value;
    app.config = DIFFICULTIES[app.difficultyId];
    app.boardCursor[app.difficultyId] = (app.boardCursor[app.difficultyId] + 1) % app.config.boards.length;
    app.boardCells = app.config.boards[app.boardCursor[app.difficultyId]].slice();
    app.particles = new Set(app.boardCells);
    app.marks = new Array(app.config.size * app.config.size).fill(0);
    app.hintedCells = new Set();
    app.undoStack = [];
    app.redoStack = [];
    app.observations = new Map();
    app.currentTrace = null;
    app.hintsUsed = 0;
    app.failedAttempts = 0;
    app.gameOver = false;
    app.elements.rayBoard.style.setProperty("--size", String(app.config.size));
    app.elements.boardCode.textContent = "CHAMBER " + app.config.code + "-" + pad2(app.boardCursor[app.difficultyId] + 1);
    buildPorts();
    buildCells();
    renderObservations();
    resetReading();
    updateBestDisplay();
    updateStats();
    startTimer();
  }

  function bindEvents() {
    app.elements.themeToggle.addEventListener("click", toggleTheme);
    app.elements.themeToggle.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggleTheme();
      }
    });
    app.elements.difficulty.addEventListener("change", newGame);
    app.elements.newGame.addEventListener("click", newGame);
    app.elements.resetMarks.addEventListener("click", resetMarks);
    app.elements.undoMark.addEventListener("click", undoMarks);
    app.elements.redoMark.addEventListener("click", redoMarks);
    app.elements.hintButton.addEventListener("click", giveHint);
    app.elements.submitLayout.addEventListener("click", submitLayout);
    app.elements.closeResult.addEventListener("click", closeResultDialog);
    app.elements.resultNewGame.addEventListener("click", newGame);
    app.elements.rulesClose.addEventListener("click", closeRulesDialog);
    app.elements.rulesStart.addEventListener("click", closeRulesDialog);
    app.elements.rulesDialog.addEventListener("click", function (event) {
      if (event.target === app.elements.rulesDialog) closeRulesDialog();
    });
    app.elements.rulesDialog.addEventListener("cancel", function (event) {
      event.preventDefault();
      closeRulesDialog();
    });
    app.elements.rulesDialog.addEventListener("close", finishRulesDialogClose);
    app.elements.showRayPath.addEventListener("change", function () {
      renderRayPath(app.currentTrace);
    });
    app.elements.markModes.forEach(function (button) {
      button.addEventListener("click", function () { setMarkMode(button.dataset.mode); });
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Tab" && app.rulesDialogFallback && isRulesDialogOpen()) {
        const focusable = Array.from(app.elements.rulesDialog.querySelectorAll(
          "button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])"
        ));
        if (focusable.length > 0) {
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && (document.activeElement === first || !app.elements.rulesDialog.contains(document.activeElement))) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && (document.activeElement === last || !app.elements.rulesDialog.contains(document.activeElement))) {
            event.preventDefault();
            first.focus();
          }
        }
        return;
      }
      if (event.key === "Escape" && isRulesDialogOpen()) {
        event.preventDefault();
        closeRulesDialog();
        return;
      }
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) redoMarks(); else undoMarks();
      } else if (key === "y") {
        event.preventDefault();
        redoMarks();
      }
    });
  }

  function init() {
    getElements();
    renderRuleDiagrams();
    app.bestResults = loadBestResults();
    applyTheme(safeStorageGet("gh-theme") || "4399", false);
    bindEvents();
    setMarkMode("particle");
    newGame();
    openRulesDialog();
  }

  function assert(condition, message) {
    if (!condition) throw new Error("Self-test failed: " + message);
  }

  function runSelfTests(options) {
    const pathSignature = function (result) {
      return result.path.map(function (point) { return point.row + "," + point.col; }).join("|");
    };
    const traceDemo = function (name) {
      const demo = RULE_DEMOS[name];
      return traceRay(demo.size, demo.particles, demo.entry);
    };
    const emptyExit = traceDemo("straight");
    assert(emptyExit.outcome === "exit" && emptyExit.exit === "B02", "empty board exits opposite port");
    assert(pathSignature(emptyExit) === "-1,1|0,1|1,1|2,1|3,1", "straight rule diagram path");

    const directHit = traceDemo("hit");
    assert(directHit.outcome === "hit", "entry-facing particle is a direct hit");
    assert(pathSignature(directHit) === "-1,1|0,1", "hit rule diagram path");

    const deflection = traceDemo("turn");
    assert(deflection.outcome === "exit" && deflection.exit === "L01", "single diagonal turns away");
    assert(deflection.deflections === 1, "single deflection is counted");
    assert(pathSignature(deflection) === "-1,1|0,1|0,0|0,-1", "turn rule diagram path");

    const reflection = traceDemo("reflection");
    assert(reflection.outcome === "reflection" && reflection.exit === "T02", "double diagonal reflects");
    assert(pathSignature(reflection) === "-1,1|0,1|-1,1", "reflection rule diagram retraces its path");

    const loop = traceRay(4, [0, 2, 3, 8], "T02");
    assert(loop.outcome === "loop" && loop.statesVisited === 4, "repeated ray state stops a loop");

    Object.keys(DIFFICULTIES).forEach(function (difficultyId) {
      const config = DIFFICULTIES[difficultyId];
      config.boards.forEach(function (board, index) {
        assert(board.length === config.particles, difficultyId + " board " + index + " particle count");
        assert(new Set(board).size === board.length, difficultyId + " board " + index + " has distinct cells");
        board.forEach(function (cell) {
          assert(cell >= 0 && cell < config.size * config.size, difficultyId + " board cell is in range");
        });
        if (options && options.verifyUniqueness) {
          const matches = countMatchingLayouts(config.size, config.particles, board, 2);
          assert(matches === 1, difficultyId + " board " + (index + 1) + " is unique, got " + matches);
        }
      });
    });
    return true;
  }

  function discoverUniqueBoards(size, particleCount, wanted, seed) {
    let state = seed >>> 0;
    const found = [];
    const tried = new Set();
    function random() {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    }
    while (found.length < wanted) {
      const cells = new Set();
      while (cells.size < particleCount) cells.add(Math.floor(random() * size * size));
      const board = Array.from(cells).sort(function (a, b) { return a - b; });
      const key = board.join(",");
      if (tried.has(key)) continue;
      tried.add(key);
      if (countMatchingLayouts(size, particleCount, board, 2) === 1) found.push(board);
      if (tried.size > 500) throw new Error("Could not discover enough unique boards");
    }
    return found;
  }

  const api = {
    DIFFICULTIES,
    RULE_DEMOS,
    createPorts,
    traceRay,
    layoutSignature,
    countMatchingLayouts,
    calculateScore,
    formatTime,
    runSelfTests,
    discoverUniqueBoards
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    if (require.main === module) {
      if (process.argv.includes("--discover")) {
        console.log("trainee", JSON.stringify(discoverUniqueBoards(5, 4, 3, 0x52415931)));
        console.log("detective", JSON.stringify(discoverUniqueBoards(6, 5, 3, 0x52415932)));
      } else {
        runSelfTests({ verifyUniqueness: process.argv.includes("--verify-uniqueness") });
        console.log("Ray Lab logic checks passed.");
      }
    }
  } else if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
  }
}(typeof window !== "undefined" ? window : globalThis));
