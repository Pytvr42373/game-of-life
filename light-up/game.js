(function () {
  "use strict";

  const DIRECTIONS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const DIFFICULTY_LABELS = { easy: "入门", medium: "进阶", hard: "专家" };
  const STORAGE = {
    best: "akari-best-v1",
    progress: "akari-progress-v1"
  };

  // Fixed layouts are solver-verified to have exactly one solution each.
  const PUZZLES = {
    easy: [
      {
        id: "E-01",
        title: "晨光回廊",
        rows: [
          "..2....",
          ".......",
          "....1..",
          ".1.....",
          ".....2.",
          "..3....",
          "....1.."
        ]
      },
      {
        id: "E-02",
        title: "午后窗格",
        rows: [
          "...#...",
          ".3.....",
          ".....1.",
          "..2....",
          "....3..",
          "......1",
          ".#....."
        ]
      },
      {
        id: "E-03",
        title: "庭院折光",
        rows: [
          ".1...2.",
          ".......",
          "...1...",
          "0.....0",
          "...3...",
          ".......",
          ".1...1."
        ]
      }
    ],
    medium: [
      {
        id: "M-01",
        title: "长廊天井",
        rows: [
          "..#...#..",
          "....4....",
          ".2.....1.",
          ".........",
          "...2.0...",
          "#.......#",
          "...1.....",
          "......1..",
          ".1..1...."
        ]
      },
      {
        id: "M-02",
        title: "拱顶光井",
        rows: [
          "...#.....",
          ".2....3..",
          ".....#...",
          "..2.....#",
          "....3....",
          "1.....2..",
          "...1.....",
          "..#....2.",
          ".....1..."
        ]
      },
      {
        id: "M-03",
        title: "斜阳展厅",
        rows: [
          ".#.....#.",
          "....2....",
          "..3...2..",
          ".........",
          "#...#...#",
          ".........",
          "..1...2..",
          "....2....",
          ".1.....1."
        ]
      }
    ],
    hard: [
      {
        id: "H-01",
        title: "星夜中庭",
        rows: [
          "..1....1...",
          ".....3.....",
          ".2......2..",
          "...0.......",
          "......2..#.",
          "1....1....1",
          ".2..#......",
          ".......#...",
          "..2......2.",
          ".....2.....",
          "...1....1.."
        ]
      },
      {
        id: "H-02",
        title: "霓虹连桥",
        rows: [
          "...0.....2.",
          ".2....2....",
          ".....2...#.",
          "..2........",
          ".......2...",
          "0...3.....#",
          "...3.......",
          "........2..",
          ".2...1.....",
          "....2....2.",
          ".1.....#..."
        ]
      },
      {
        id: "H-03",
        title: "深空穹顶",
        rows: [
          ".1....#...#",
          "....1......",
          ".......1.3.",
          "..2........",
          ".....0..1..",
          "0.........#",
          "..0..3.....",
          "........2..",
          ".#.2.......",
          "......1....",
          "#...#....1."
        ]
      }
    ]
  };

  function keyOf(row, col) {
    return row + "," + col;
  }

  function createModel(puzzle) {
    const height = puzzle.rows.length;
    const width = puzzle.rows[0].length;
    const cells = [];
    const indexByKey = new Map();

    puzzle.rows.forEach(function (row, rowIndex) {
      if (row.length !== width) {
        throw new Error("题目 " + puzzle.id + " 的行宽不一致");
      }
      Array.from(row).forEach(function (symbol, colIndex) {
        if (symbol === ".") {
          const index = cells.length;
          cells.push({ row: rowIndex, col: colIndex, key: keyOf(rowIndex, colIndex) });
          indexByKey.set(keyOf(rowIndex, colIndex), index);
        }
      });
    });

    const visibility = cells.map(function (cell) {
      const visible = [indexByKey.get(cell.key)];
      DIRECTIONS.forEach(function (direction) {
        let row = cell.row + direction[0];
        let col = cell.col + direction[1];
        while (row >= 0 && row < height && col >= 0 && col < width && puzzle.rows[row][col] === ".") {
          visible.push(indexByKey.get(keyOf(row, col)));
          row += direction[0];
          col += direction[1];
        }
      });
      return visible;
    });

    const peers = visibility.map(function (visible, index) {
      return visible.filter(function (other) { return other !== index; });
    });

    const clues = [];
    puzzle.rows.forEach(function (row, rowIndex) {
      Array.from(row).forEach(function (symbol, colIndex) {
        if (/^[0-4]$/.test(symbol)) {
          const adjacent = [];
          DIRECTIONS.forEach(function (direction) {
            const index = indexByKey.get(keyOf(rowIndex + direction[0], colIndex + direction[1]));
            if (index !== undefined) adjacent.push(index);
          });
          clues.push({
            row: rowIndex,
            col: colIndex,
            target: Number(symbol),
            adjacent: adjacent
          });
        }
      });
    });

    return {
      puzzle: puzzle,
      width: width,
      height: height,
      cells: cells,
      indexByKey: indexByKey,
      visibility: visibility,
      peers: peers,
      clues: clues
    };
  }

  function solvePuzzle(puzzle, limit) {
    const model = createModel(puzzle);
    const maxSolutions = limit || 2;
    const solutions = [];
    const initial = new Int8Array(model.cells.length);
    initial.fill(-1);

    function assign(values, index, value) {
      if (values[index] !== -1 && values[index] !== value) return false;
      values[index] = value;
      return true;
    }

    function propagate(values) {
      let changed = true;
      while (changed) {
        changed = false;

        for (let index = 0; index < values.length; index += 1) {
          if (values[index] !== 1) continue;
          const peers = model.peers[index];
          for (let peerIndex = 0; peerIndex < peers.length; peerIndex += 1) {
            const peer = peers[peerIndex];
            if (values[peer] === 1) return false;
            if (values[peer] === -1) {
              values[peer] = 0;
              changed = true;
            }
          }
        }

        for (let clueIndex = 0; clueIndex < model.clues.length; clueIndex += 1) {
          const clue = model.clues[clueIndex];
          let bulbs = 0;
          const unknown = [];
          clue.adjacent.forEach(function (index) {
            if (values[index] === 1) bulbs += 1;
            if (values[index] === -1) unknown.push(index);
          });
          if (bulbs > clue.target || bulbs + unknown.length < clue.target) return false;
          if (bulbs === clue.target || bulbs + unknown.length === clue.target) {
            const forcedValue = bulbs === clue.target ? 0 : 1;
            for (let i = 0; i < unknown.length; i += 1) {
              if (!assign(values, unknown[i], forcedValue)) return false;
              changed = true;
            }
          }
        }

        for (let cellIndex = 0; cellIndex < model.visibility.length; cellIndex += 1) {
          const visible = model.visibility[cellIndex];
          let hasBulb = false;
          const unknown = [];
          for (let i = 0; i < visible.length; i += 1) {
            if (values[visible[i]] === 1) hasBulb = true;
            if (values[visible[i]] === -1) unknown.push(visible[i]);
          }
          if (!hasBulb && unknown.length === 0) return false;
          if (!hasBulb && unknown.length === 1) {
            if (!assign(values, unknown[0], 1)) return false;
            changed = true;
          }
        }
      }
      return true;
    }

    function chooseBranch(values) {
      let best = null;
      let bestLength = Infinity;

      model.visibility.forEach(function (visible) {
        let hasBulb = false;
        const unknown = [];
        visible.forEach(function (index) {
          if (values[index] === 1) hasBulb = true;
          if (values[index] === -1) unknown.push(index);
        });
        if (!hasBulb && unknown.length > 1 && unknown.length < bestLength) {
          best = unknown[0];
          bestLength = unknown.length;
        }
      });

      if (best !== null) return best;
      for (let index = 0; index < values.length; index += 1) {
        if (values[index] === -1) return index;
      }
      return null;
    }

    function search(values) {
      if (solutions.length >= maxSolutions || !propagate(values)) return;
      const branch = chooseBranch(values);
      if (branch === null) {
        const solution = new Set();
        values.forEach(function (value, index) {
          if (value === 1) solution.add(model.cells[index].key);
        });
        solutions.push(solution);
        return;
      }

      const withBulb = values.slice();
      withBulb[branch] = 1;
      search(withBulb);
      if (solutions.length >= maxSolutions) return;

      const withoutBulb = values.slice();
      withoutBulb[branch] = 0;
      search(withoutBulb);
    }

    search(initial);
    return { model: model, solutions: solutions };
  }

  function evaluateBoard(model, bulbs) {
    const bulbIndexes = new Set();
    bulbs.forEach(function (key) {
      const index = model.indexByKey.get(key);
      if (index !== undefined) bulbIndexes.add(index);
    });

    const lit = new Set();
    const conflicts = new Set();
    bulbIndexes.forEach(function (index) {
      model.visibility[index].forEach(function (visible) { lit.add(model.cells[visible].key); });
      model.peers[index].forEach(function (peer) {
        if (bulbIndexes.has(peer)) {
          conflicts.add(model.cells[index].key);
          conflicts.add(model.cells[peer].key);
        }
      });
    });

    const clueResults = model.clues.map(function (clue) {
      const count = clue.adjacent.reduce(function (total, index) {
        return total + (bulbIndexes.has(index) ? 1 : 0);
      }, 0);
      return {
        key: keyOf(clue.row, clue.col),
        count: count,
        target: clue.target,
        valid: count === clue.target
      };
    });

    const unlit = model.cells.filter(function (cell) { return !lit.has(cell.key); });
    const invalidClues = clueResults.filter(function (clue) { return !clue.valid; });
    return {
      lit: lit,
      conflicts: conflicts,
      clueResults: clueResults,
      unlit: unlit,
      invalidClues: invalidClues,
      solved: unlit.length === 0 && conflicts.size === 0 && invalidClues.length === 0
    };
  }

  const core = {
    puzzles: PUZZLES,
    createModel: createModel,
    solvePuzzle: solvePuzzle,
    evaluateBoard: evaluateBoard
  };

  if (typeof module !== "undefined" && module.exports) module.exports = core;
  if (typeof window !== "undefined") window.LightUpCore = core;
  if (typeof document === "undefined") return;

  const elements = {
    board: document.getElementById("board"),
    puzzleTitle: document.getElementById("puzzleTitle"),
    puzzleCode: document.getElementById("puzzleCode"),
    timer: document.getElementById("timer"),
    bulbCount: document.getElementById("bulbCount"),
    darkCount: document.getElementById("darkCount"),
    bestTime: document.getElementById("bestTime"),
    message: document.getElementById("message"),
    difficultyPicker: document.getElementById("difficultyPicker"),
    checkButton: document.getElementById("checkButton"),
    hintButton: document.getElementById("hintButton"),
    newButton: document.getElementById("newButton"),
    resetButton: document.getElementById("resetButton"),
    undoButton: document.getElementById("undoButton"),
    redoButton: document.getElementById("redoButton"),
    hintCount: document.getElementById("hintCount"),
    saveState: document.getElementById("saveState"),
    themeToggle: document.getElementById("themeToggle"),
    themeFlash: document.getElementById("themeFlash"),
    successLayer: document.getElementById("successLayer"),
    resultTime: document.getElementById("resultTime"),
    resultBulbs: document.getElementById("resultBulbs"),
    resultHints: document.getElementById("resultHints"),
    recordLine: document.getElementById("recordLine"),
    nextPuzzleButton: document.getElementById("nextPuzzleButton"),
    closeModalButton: document.getElementById("closeModalButton")
  };

  let state = null;
  let model = null;
  let timerHandle = null;
  let lastFocusedCell = null;
  const solutionCache = new Map();

  function storageGet(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function storageSet(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      return false;
    }
  }

  function formatTime(seconds) {
    const safeSeconds = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(safeSeconds / 60);
    const remainder = safeSeconds % 60;
    return String(minutes).padStart(2, "0") + ":" + String(remainder).padStart(2, "0");
  }

  function currentElapsed() {
    if (!state) return 0;
    if (state.completed || !state.startedAt) return state.elapsed;
    return state.elapsed + Math.floor((Date.now() - state.startedAt) / 1000);
  }

  function getPuzzle(difficulty, id) {
    return PUZZLES[difficulty].find(function (puzzle) { return puzzle.id === id; });
  }

  function snapshot() {
    return {
      bulbs: Array.from(state.bulbs),
      marks: Array.from(state.marks),
      hints: state.hints
    };
  }

  function restoreSnapshot(saved) {
    state.bulbs = new Set(saved.bulbs);
    state.marks = new Set(saved.marks);
    state.hints = saved.hints;
  }

  function saveProgress() {
    if (!state || state.completed) return;
    const saved = storageSet(STORAGE.progress, {
      difficulty: state.difficulty,
      puzzleId: state.puzzle.id,
      bulbs: Array.from(state.bulbs),
      marks: Array.from(state.marks),
      hints: state.hints,
      elapsed: currentElapsed()
    });
    elements.saveState.textContent = saved ? "进度已自动保存" : "浏览器禁止保存进度";
  }

  function loadSavedState() {
    const saved = storageGet(STORAGE.progress, null);
    if (!saved || !PUZZLES[saved.difficulty]) return null;
    const puzzle = getPuzzle(saved.difficulty, saved.puzzleId);
    if (!puzzle || !Array.isArray(saved.bulbs) || !Array.isArray(saved.marks)) return null;

    const savedModel = createModel(puzzle);
    const validKeys = new Set(savedModel.cells.map(function (cell) { return cell.key; }));
    return {
      difficulty: saved.difficulty,
      puzzle: puzzle,
      bulbs: new Set(saved.bulbs.filter(function (key) { return validKeys.has(key); })),
      marks: new Set(saved.marks.filter(function (key) { return validKeys.has(key); })),
      hints: Number.isFinite(saved.hints) ? Math.max(0, saved.hints) : 0,
      elapsed: Number.isFinite(saved.elapsed) ? Math.max(0, saved.elapsed) : 0
    };
  }

  function setMessage(text, type) {
    elements.message.textContent = text;
    elements.message.className = "game-message" + (type ? " " + type : "");
  }

  function startState(difficulty, puzzle, restored) {
    state = {
      difficulty: difficulty,
      puzzle: puzzle,
      bulbs: restored ? restored.bulbs : new Set(),
      marks: restored ? restored.marks : new Set(),
      hints: restored ? restored.hints : 0,
      elapsed: restored ? restored.elapsed : 0,
      startedAt: Date.now(),
      completed: false,
      undo: [],
      redo: [],
      checksVisible: false
    };
    model = createModel(puzzle);
    renderPuzzle();
    startTimer();
    saveProgress();
  }

  function startTimer() {
    if (timerHandle) window.clearInterval(timerHandle);
    updateTimer();
    timerHandle = window.setInterval(function () {
      updateTimer();
      if (currentElapsed() % 10 === 0) saveProgress();
    }, 1000);
  }

  function updateTimer() {
    elements.timer.textContent = formatTime(currentElapsed());
  }

  function createBulbIcon() {
    const icon = document.createElement("span");
    icon.className = "bulb-icon";
    icon.setAttribute("aria-hidden", "true");
    return icon;
  }

  function renderPuzzle() {
    elements.puzzleTitle.textContent = state.puzzle.title;
    elements.puzzleCode.textContent = state.puzzle.id;
    elements.board.replaceChildren();
    elements.board.style.setProperty("--columns", model.width);
    elements.board.style.setProperty("--rows", model.height);
    document.documentElement.style.setProperty("--board-columns", model.width);

    state.puzzle.rows.forEach(function (row, rowIndex) {
      Array.from(row).forEach(function (symbol, colIndex) {
        const key = keyOf(rowIndex, colIndex);
        if (symbol === ".") {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "cell white-cell";
          button.dataset.key = key;
          button.setAttribute("role", "gridcell");
          button.addEventListener("click", function () { toggleBulb(key); });
          button.addEventListener("contextmenu", function (event) {
            event.preventDefault();
            toggleMark(key);
          });
          button.addEventListener("keydown", function (event) {
            if (event.key.toLowerCase() === "x") {
              event.preventDefault();
              toggleMark(key);
            }
          });
          elements.board.appendChild(button);
        } else {
          const wall = document.createElement("div");
          wall.className = "cell wall-cell" + (/^[0-4]$/.test(symbol) ? " numbered" : "");
          wall.dataset.key = key;
          wall.setAttribute("role", "gridcell");
          if (/^[0-4]$/.test(symbol)) {
            wall.textContent = symbol;
            wall.setAttribute("aria-label", "数字墙 " + symbol);
          } else {
            wall.setAttribute("aria-label", "黑墙");
          }
          elements.board.appendChild(wall);
        }
      });
    });

    updateDifficultyButtons();
    refreshBoard();
    setMessage("左键放置灯泡，右键标记不可放灯的位置。", "");
  }

  function refreshBoard(focusKey) {
    const evaluation = evaluateBoard(model, state.bulbs);
    elements.board.classList.toggle("show-checks", state.checksVisible);

    elements.board.querySelectorAll(".white-cell").forEach(function (cell) {
      const key = cell.dataset.key;
      const hasBulb = state.bulbs.has(key);
      const marked = state.marks.has(key) && !hasBulb;
      cell.classList.toggle("is-lit", evaluation.lit.has(key));
      cell.classList.toggle("is-marked", marked);
      cell.classList.toggle("has-conflict", state.checksVisible && evaluation.conflicts.has(key));
      cell.replaceChildren();
      if (hasBulb) cell.appendChild(createBulbIcon());
      const position = key.split(",").map(Number);
      const status = hasBulb ? "有灯泡" : marked ? "已标记不可放灯" : evaluation.lit.has(key) ? "已照亮" : "未照亮";
      cell.setAttribute("aria-label", "第 " + (position[0] + 1) + " 行第 " + (position[1] + 1) + " 列，" + status);
      cell.title = hasBulb ? "左键移除灯泡；右键改为排除标记" : marked ? "左键放灯；右键清除标记" : "左键放灯；右键标记";
    });

    evaluation.clueResults.forEach(function (clue) {
      const wall = elements.board.querySelector('[data-key="' + clue.key + '"]');
      if (!wall) return;
      wall.dataset.adjacent = clue.count + "/" + clue.target;
      wall.classList.toggle("clue-ok", state.checksVisible && clue.valid);
      wall.classList.toggle("clue-bad", state.checksVisible && !clue.valid);
    });

    elements.bulbCount.textContent = String(state.bulbs.size);
    elements.darkCount.textContent = String(evaluation.unlit.length);
    elements.hintCount.textContent = String(state.hints);
    elements.undoButton.disabled = state.undo.length === 0 || state.completed;
    elements.redoButton.disabled = state.redo.length === 0 || state.completed;
    updateBestTime();

    if (focusKey) {
      const target = elements.board.querySelector('[data-key="' + focusKey + '"]');
      if (target) target.focus({ preventScroll: true });
    }
    return evaluation;
  }

  function commitChange(changer, focusKey) {
    if (state.completed) return;
    state.undo.push(snapshot());
    if (state.undo.length > 100) state.undo.shift();
    state.redo = [];
    state.checksVisible = false;
    changer();
    const evaluation = refreshBoard(focusKey);
    saveProgress();
    if (evaluation.solved) finishGame();
  }

  function toggleBulb(key) {
    commitChange(function () {
      if (state.bulbs.has(key)) {
        state.bulbs.delete(key);
      } else {
        state.marks.delete(key);
        state.bulbs.add(key);
      }
    }, key);
  }

  function toggleMark(key) {
    commitChange(function () {
      if (state.marks.has(key)) {
        state.marks.delete(key);
      } else {
        state.bulbs.delete(key);
        state.marks.add(key);
      }
    }, key);
  }

  function undo() {
    if (state.undo.length === 0 || state.completed) return;
    state.redo.push(snapshot());
    restoreSnapshot(state.undo.pop());
    state.checksVisible = false;
    refreshBoard();
    saveProgress();
    setMessage("已撤销上一步。", "");
  }

  function redo() {
    if (state.redo.length === 0 || state.completed) return;
    state.undo.push(snapshot());
    restoreSnapshot(state.redo.pop());
    state.checksVisible = false;
    refreshBoard();
    saveProgress();
    setMessage("已重做一步。", "");
  }

  function resetPuzzle() {
    if (!state || state.completed) {
      startState(state.difficulty, state.puzzle, null);
      return;
    }
    // Resetting also restarts the timer, so old board states must not be
    // restorable with a new elapsed time.
    state.undo = [];
    state.redo = [];
    state.bulbs.clear();
    state.marks.clear();
    state.hints = 0;
    state.elapsed = 0;
    state.startedAt = Date.now();
    state.checksVisible = false;
    refreshBoard();
    updateTimer();
    saveProgress();
    setMessage("图纸已恢复到初始状态。", "");
  }

  function selectDifficulty(difficulty) {
    if (!PUZZLES[difficulty]) return;
    startState(difficulty, PUZZLES[difficulty][0], null);
    setMessage("已切换为" + DIFFICULTY_LABELS[difficulty] + "难度。", "");
  }

  function nextPuzzle() {
    const collection = PUZZLES[state.difficulty];
    const currentIndex = collection.findIndex(function (puzzle) { return puzzle.id === state.puzzle.id; });
    const next = collection[(currentIndex + 1) % collection.length];
    closeSuccess();
    startState(state.difficulty, next, null);
  }

  function updateDifficultyButtons() {
    elements.difficultyPicker.querySelectorAll("button").forEach(function (button) {
      button.setAttribute("aria-pressed", String(button.dataset.difficulty === state.difficulty));
    });
  }

  function getSolution() {
    if (!solutionCache.has(state.puzzle.id)) {
      const result = solvePuzzle(state.puzzle, 2);
      if (result.solutions.length !== 1) {
        setMessage("当前图纸校验异常，请切换到下一张图纸。", "bad");
        return null;
      }
      solutionCache.set(state.puzzle.id, result.solutions[0]);
    }
    return solutionCache.get(state.puzzle.id);
  }

  function giveHint() {
    if (state.completed) return;
    const solution = getSolution();
    if (!solution) return;
    let target = null;
    let action = "place";

    state.bulbs.forEach(function (key) {
      if (!target && !solution.has(key)) {
        target = key;
        action = "remove";
      }
    });

    if (!target) {
      solution.forEach(function (key) {
        if (!target && !state.bulbs.has(key)) target = key;
      });
    }
    if (!target) return;

    commitChange(function () {
      state.hints += 1;
      if (action === "remove") {
        state.bulbs.delete(target);
        state.marks.add(target);
      } else {
        state.marks.delete(target);
        state.bulbs.add(target);
      }
    }, target);

    const targetCell = elements.board.querySelector('[data-key="' + target + '"]');
    if (targetCell) {
      targetCell.classList.add("hint-focus");
      window.setTimeout(function () { targetCell.classList.remove("hint-focus"); }, 1800);
    }
    setMessage(action === "remove" ? "提示：这个位置不应放灯，已替你标记。" : "提示：这里可以确定放置一盏灯。", "good");
  }

  function checkBoard() {
    if (state.completed) return;
    state.checksVisible = true;
    const evaluation = refreshBoard();
    if (evaluation.solved) {
      finishGame();
      return;
    }
    if (evaluation.conflicts.size > 0) {
      setMessage("有 " + evaluation.conflicts.size + " 盏灯彼此直视，请检查红框位置。", "bad");
    } else if (evaluation.invalidClues.length > 0) {
      setMessage("还有 " + evaluation.invalidClues.length + " 面数字墙未满足，角标显示当前灯数。", "bad");
    } else {
      setMessage("规则均已满足，但还有 " + evaluation.unlit.length + " 个白格没有照亮。", "bad");
    }
  }

  function getBestResults() {
    return storageGet(STORAGE.best, {});
  }

  function updateBestTime() {
    const best = getBestResults()[state.difficulty];
    elements.bestTime.textContent = best ? formatTime(best.seconds) : "--:--";
  }

  function finishGame() {
    if (state.completed) return;
    const elapsed = currentElapsed();
    state.elapsed = elapsed;
    state.startedAt = null;
    state.completed = true;
    state.checksVisible = true;
    if (timerHandle) window.clearInterval(timerHandle);
    timerHandle = null;
    updateTimer();
    refreshBoard();

    const bests = getBestResults();
    const previous = bests[state.difficulty];
    const isRecord = !previous || elapsed < previous.seconds || (elapsed === previous.seconds && state.hints < previous.hints);
    if (isRecord) {
      bests[state.difficulty] = {
        seconds: elapsed,
        hints: state.hints,
        puzzleId: state.puzzle.id
      };
      storageSet(STORAGE.best, bests);
    }
    try { localStorage.removeItem(STORAGE.progress); } catch (error) { /* Storage can be unavailable. */ }

    elements.resultTime.textContent = formatTime(elapsed);
    elements.resultBulbs.textContent = String(state.bulbs.size);
    elements.resultHints.textContent = String(state.hints);
    elements.recordLine.textContent = isRecord ? "新的" + DIFFICULTY_LABELS[state.difficulty] + "难度最佳记录" : "本难度最佳：" + formatTime(previous.seconds);
    elements.successLayer.hidden = false;
    setModalBackgroundInert(true);
    lastFocusedCell = document.activeElement;
    elements.nextPuzzleButton.focus();
    setMessage("验收通过：所有白格都已正确照亮。", "good");
    updateBestTime();
  }

  function closeSuccess() {
    elements.successLayer.hidden = true;
    setModalBackgroundInert(false);
    if (lastFocusedCell && typeof lastFocusedCell.focus === "function") lastFocusedCell.focus();
  }

  function setModalBackgroundInert(active) {
    Array.from(document.body.children).forEach(function (child) {
      if (child !== elements.successLayer && child.tagName !== "SCRIPT") child.inert = active;
    });
  }

  function iconSvg(showArcadeDestination) {
    if (showArcadeDestination) {
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 0 9.3 13.7L12 12l8.4-5.4A10 10 0 0 0 12 2Z"/><circle cx="13" cy="6.7" r="1.2" fill="#111"/></svg>';
    }
    return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21V10m0 3-4-4m4 1 4-4m-4 11-4 4m4-4 4 4"/><path d="M7.2 13.2a4 4 0 0 1-1.5-7.7A5.7 5.7 0 0 1 16.5 5a4 4 0 0 1 .4 7.9"/><path d="M4 21h16"/></svg>';
  }

  function paintThemeIcon() {
    const isDay = document.body.dataset.theme === "4399";
    elements.themeToggle.innerHTML = iconSvg(isDay);
    elements.themeToggle.setAttribute("aria-label", isDay ? "切换为街机夜间主题" : "切换为日间建筑主题");
  }

  function applyInitialTheme() {
    let theme = "4399";
    try {
      const saved = localStorage.getItem("gh-theme");
      if (saved === "4399" || saved === "arcade") theme = saved;
    } catch (error) { /* Keep the daylight default. */ }
    document.body.dataset.theme = theme;
    paintThemeIcon();
  }

  function toggleTheme() {
    const next = document.body.dataset.theme === "arcade" ? "4399" : "arcade";
    elements.themeFlash.classList.remove("is-active");
    void elements.themeFlash.offsetWidth;
    elements.themeFlash.classList.add("is-active");
    window.setTimeout(function () {
      document.body.dataset.theme = next;
      try { localStorage.setItem("gh-theme", next); } catch (error) { /* Theme still applies for this visit. */ }
      paintThemeIcon();
    }, 130);
  }

  function bindEvents() {
    elements.difficultyPicker.addEventListener("click", function (event) {
      const button = event.target.closest("button[data-difficulty]");
      if (button) selectDifficulty(button.dataset.difficulty);
    });
    elements.checkButton.addEventListener("click", checkBoard);
    elements.hintButton.addEventListener("click", giveHint);
    elements.newButton.addEventListener("click", nextPuzzle);
    elements.resetButton.addEventListener("click", resetPuzzle);
    elements.undoButton.addEventListener("click", undo);
    elements.redoButton.addEventListener("click", redo);
    elements.nextPuzzleButton.addEventListener("click", nextPuzzle);
    elements.closeModalButton.addEventListener("click", closeSuccess);
    elements.themeToggle.addEventListener("click", toggleTheme);
    elements.successLayer.addEventListener("click", function (event) {
      if (event.target === elements.successLayer) closeSuccess();
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !elements.successLayer.hidden) closeSuccess();
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
      }
    });
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) saveProgress();
    });
    window.addEventListener("beforeunload", saveProgress);
  }

  function initialize() {
    applyInitialTheme();
    bindEvents();
    const restored = loadSavedState();
    if (restored) {
      startState(restored.difficulty, restored.puzzle, restored);
      setMessage("已恢复上次未完成的图纸。", "good");
    } else {
      startState("easy", PUZZLES.easy[0], null);
    }
  }

  initialize();
}());
