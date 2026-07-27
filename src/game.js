const ROWS = 40, COLS = 40;

export function createEmptyGrid() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(0));
}

export function countNeighbors(grid, r, c) {
  let n = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS)
        n += grid[nr][nc];
    }
  }
  return n;
}

export function step(grid) {
  const next = createEmptyGrid();
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const n = countNeighbors(grid, r, c);
      if (grid[r][c]) {
        next[r][c] = (n === 2 || n === 3) ? 1 : 0;
      } else {
        next[r][c] = (n === 3) ? 1 : 0;
      }
    }
  }
  return next;
}

export function randomize(grid, density = 0.25) {
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      grid[r][c] = Math.random() < density ? 1 : 0;
}

export function clearGrid(grid) {
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      grid[r][c] = 0;
}

export function countAlive(grid) {
  let count = 0;
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (grid[r][c]) count++;
  return count;
}

export function toggleCell(grid, r, c) {
  grid[r][c] = grid[r][c] ? 0 : 1;
}

export function applyPattern(grid, pattern, offsetRow, offsetCol) {
  pattern.forEach(([r, c]) => {
    const gr = offsetRow + r, gc = offsetCol + c;
    if (gr >= 0 && gr < ROWS && gc >= 0 && gc < COLS) {
      grid[gr][gc] = 1;
    }
  });
}

export { ROWS, COLS };
