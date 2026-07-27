import { ROWS, COLS, createEmptyGrid, step, randomize, clearGrid, toggleCell, applyPattern } from './game.js';
import { PATTERNS } from './patterns.js';
import { createGrid, refreshAll, updateStats, updateCellVisual } from './renderer.js';

let grid = createEmptyGrid();
let generation = 0;
let playing = false;
let intervalId = null;
let speed = 200;

const gridEl = document.getElementById('grid');
const genEl = document.getElementById('generation');
const aliveEl = document.getElementById('alive-count');
const btnPlay = document.getElementById('btn-play');
const patternSelect = document.getElementById('pattern-select');
const speedInput = document.getElementById('speed');
const speedLabel = document.getElementById('speed-label');

const MAX_HISTORY = 50;
let history = [];
let historyIndex = -1;

function saveState() {
  const snapshot = grid.map(row => [...row]);
  history = history.slice(0, historyIndex + 1);
  history.push(snapshot);
  if (history.length > MAX_HISTORY) history.shift();
  historyIndex = history.length - 1;
}

function undo() {
  if (historyIndex > 0) {
    historyIndex--;
    grid = history[historyIndex].map(row => [...row]);
    refreshAll(gridEl, grid);
    updateStats(genEl, aliveEl, grid, generation);
  }
}

function redo() {
  if (historyIndex < history.length - 1) {
    historyIndex++;
    grid = history[historyIndex].map(row => [...row]);
    refreshAll(gridEl, grid);
    updateStats(genEl, aliveEl, grid, generation);
  }
}

function handleCellClick(r, c) {
  toggleCell(grid, r, c);
  updateCellVisual(gridEl, grid, r, c);
  updateStats(genEl, aliveEl, grid, generation);
  saveState();
}

function init() {
  createGrid(gridEl, grid, handleCellClick);
  generation = 0;
  updateStats(genEl, aliveEl, grid, generation);
  saveState();
}

function doStep() {
  grid = step(grid);
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
    if (data.grid && data.grid.length === ROWS) {
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

window.togglePlay = togglePlay;
window.doStep = doStep;
window.handleRandomize = handleRandomize;
window.handleClear = handleClear;
window.updateSpeed = updateSpeed;
window.undo = undo;
window.redo = redo;
window.saveToLocal = saveToLocal;
window.loadFromLocal = loadFromLocal;

patternSelect.addEventListener('change', handlePatternSelect);

init();
