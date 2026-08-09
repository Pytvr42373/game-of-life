import { ROWS, COLS, createEmptyGrid, step, stepDayNight, randomize, clearGrid, applyPattern } from './game.js';
import { PATTERNS } from './patterns.js';
import { createGrid, refreshAll, updateStats } from './renderer.js';

let grid = createEmptyGrid();
let generation = 0;
let playing = false;
let intervalId = null;
let speed = 200;
let dayNight = false;

const gridEl = document.getElementById('grid');
const genEl = document.getElementById('generation');
const aliveEl = document.getElementById('alive-count');
const btnPlay = document.getElementById('btn-play');
const patternSelect = document.getElementById('pattern-select');
const speedInput = document.getElementById('speed');
const speedLabel = document.getElementById('speed-label');
const modeSelect = document.getElementById('mode-select');
const rulesEl = document.getElementById('rules-text');

const MAX_HISTORY = 50;
let history = [];
let historyIndex = -1;

function saveState() {
  const snapshot = grid.map(row => [...row]);
  history = history.slice(0, historyIndex + 1);
  history.push({ grid: snapshot, gen: generation });
  if (history.length > MAX_HISTORY) history.shift();
  historyIndex = history.length - 1;
}

function undo() {
  if (historyIndex > 0) {
    historyIndex--;
    grid = history[historyIndex].grid.map(row => [...row]);
    generation = history[historyIndex].gen;
    refreshAll(gridEl, grid);
    updateStats(genEl, aliveEl, grid, generation);
  }
}

function redo() {
  if (historyIndex < history.length - 1) {
    historyIndex++;
    grid = history[historyIndex].grid.map(row => [...row]);
    generation = history[historyIndex].gen;
    refreshAll(gridEl, grid);
    updateStats(genEl, aliveEl, grid, generation);
  }
}

function handleCellClick(r, c) {
  updateStats(genEl, aliveEl, grid, generation);
}

function init() {
  createGrid(gridEl, grid, handleCellClick, saveState);
  generation = 0;
  updateStats(genEl, aliveEl, grid, generation);
  saveState();
}

function doStep() {
  grid = dayNight ? stepDayNight(grid) : step(grid);
  generation++;
  refreshAll(gridEl, grid);
  updateStats(genEl, aliveEl, grid, generation);
  saveState();
}

function togglePlay() {
  playing = !playing;
  btnPlay.textContent = playing ? '暂停' : '开始';
  btnPlay.className = playing ? 'danger' : 'primary';
  if (playing) {
    intervalId = setInterval(doStep, speed);
  } else {
    clearInterval(intervalId);
  }
}

function stop() {
  playing = false;
  clearInterval(intervalId);
  btnPlay.textContent = '开始';
  btnPlay.className = 'primary';
}

function handleRandomize() {
  stop();
  generation = 0;
  randomize(grid);
  refreshAll(gridEl, grid);
  updateStats(genEl, aliveEl, grid, generation);
  saveState();
}

function handleClear() {
  stop();
  generation = 0;
  clearGrid(grid);
  refreshAll(gridEl, grid);
  updateStats(genEl, aliveEl, grid, generation);
  saveState();
}

function updateSpeed() {
  speed = 1050 - speedInput.value;
  speedLabel.textContent = speed + 'ms';
  if (playing) {
    clearInterval(intervalId);
    intervalId = setInterval(doStep, speed);
  }
}

function handlePatternSelect() {
  const key = patternSelect.value;
  if (!key) return;
  handleClear();
  const p = PATTERNS[key];
  if (p) {
    applyPattern(grid, p.cells, p.offset[0], p.offset[1]);
    refreshAll(gridEl, grid);
    updateStats(genEl, aliveEl, grid, generation);
    saveState();
  }
  patternSelect.value = '';
}

function saveToLocal() {
  const data = { grid, generation };
  localStorage.setItem('game-of-life-state', JSON.stringify(data));
}

function loadFromLocal() {
  const raw = localStorage.getItem('game-of-life-state');
  if (!raw) return false;
  try {
    const data = JSON.parse(raw);
    if (data.grid && data.grid.length === ROWS && data.grid[0] && data.grid[0].length === COLS) {
      grid = data.grid;
      generation = data.generation || 0;
      refreshAll(gridEl, grid);
      updateStats(genEl, aliveEl, grid, generation);
      saveState();
      return true;
    }
  } catch (e) {}
  return false;
}

function handleModeChange() {
  dayNight = modeSelect.value === 'daynight';
  stop();
  generation = 0;
  history = [];
  historyIndex = -1;
  clearGrid(grid);
  refreshAll(gridEl, grid);
  updateStats(genEl, aliveEl, grid, generation);
  saveState();
  updateRulesDisplay();
}

function updateRulesDisplay() {
  if (dayNight) {
    rulesEl.innerHTML =
      '<strong>规则: Day & Night (B3678/S34678)</strong> — 存活细胞需要 3、4、6、7 或 8 个邻居；' +
      '死亡细胞在恰好 3、6、7 或 8 个邻居时复活。' +
      '此规则下许多经典结构行为不同，且会产生独特的混沌模式。';
  } else {
    rulesEl.innerHTML =
      '<strong>规则:</strong> 每个细胞有两种状态 — 存活或死亡。每一轮，根据邻居数决定命运：' +
      '<strong>存活</strong>的细胞需要恰好2或3个邻居才能继续存活；' +
      '<strong>死亡</strong>的细胞在恰好3个邻居时会复活。邻居指周围8个方向的细胞。';
  }
}

window.togglePlay = togglePlay;
window.doStep = doStep;
window.handleRandomize = handleRandomize;
window.handleClear = handleClear;
window.updateSpeed = updateSpeed;
window.undo = undo;
window.redo = redo;
window.saveToLocal = saveToLocal;
window.loadFromLocal = loadFromLocal;
window.handleModeChange = handleModeChange;

patternSelect.addEventListener('change', handlePatternSelect);
modeSelect.addEventListener('change', handleModeChange);

init();
