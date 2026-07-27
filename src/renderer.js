import { ROWS, COLS, countAlive } from './game.js';

let drawing = false;
let drawMode = 1;
let mouseUpHandler = null;

export function createGrid(gridEl, grid, onClick) {
  if (mouseUpHandler) {
    document.removeEventListener('mouseup', mouseUpHandler);
  }

  gridEl.innerHTML = '';
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.row = r;
      cell.dataset.col = c;
      cell.addEventListener('click', () => onClick(r, c));
      cell.addEventListener('mousedown', (e) => {
        e.preventDefault();
        drawing = true;
        drawMode = grid[r][c] ? 0 : 1;
        onClick(r, c);
      });
      cell.addEventListener('mouseenter', () => {
        if (drawing) {
          grid[r][c] = drawMode;
          updateCellVisual(gridEl, grid, r, c);
        }
      });
      gridEl.appendChild(cell);
    }
  }

  mouseUpHandler = () => { drawing = false; };
  document.addEventListener('mouseup', mouseUpHandler);
}

export function updateCellVisual(gridEl, grid, r, c) {
  const idx = r * COLS + c;
  const cell = gridEl.children[idx];
  if (cell) cell.className = 'cell' + (grid[r][c] ? ' alive' : '');
}

export function refreshAll(gridEl, grid) {
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      updateCellVisual(gridEl, grid, r, c);
}

export function updateStats(genEl, aliveEl, grid, generation) {
  genEl.textContent = generation;
  aliveEl.textContent = countAlive(grid);
}
