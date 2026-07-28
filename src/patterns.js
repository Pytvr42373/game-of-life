// Classic Game of Life patterns
// Each pattern is an array of [row, col] offsets from the pattern's origin

export const PATTERNS = {
  glider: {
    name: 'Glider',
    offset: [1, 1],
    cells: [[0, 1], [1, 2], [2, 0], [2, 1], [2, 2]]
  },

  lwss: {
    name: 'Lightweight Spaceship',
    offset: [1, 1],
    cells: [
      [0, 1], [0, 4],
      [1, 0],
      [2, 0], [2, 4],
      [3, 0], [3, 1], [3, 2], [3, 3]
    ]
  },

  blinker: {
    name: 'Blinker',
    offset: [19, 19],
    cells: [[0, 0], [0, 1], [0, 2]]
  },

  toad: {
    name: 'Toad',
    offset: [19, 19],
    cells: [[0, 1], [0, 2], [0, 3], [1, 0], [1, 1], [1, 2]]
  },

  beacon: {
    name: 'Beacon',
    offset: [19, 19],
    cells: [[0, 0], [0, 1], [1, 0], [2, 3], [3, 2], [3, 3]]
  },

  pulsar: {
    name: 'Pulsar',
    offset: [14, 14],
    cells: [
      // top-left quadrant
      [0, 2], [0, 3], [0, 4],
      [2, 0], [3, 0], [4, 0],
      [2, 5], [3, 5], [4, 5],
      [5, 2], [5, 3], [5, 4],
      // top-right quadrant
      [0, 8], [0, 9], [0, 10],
      [2, 12], [3, 12], [4, 12],
      [2, 7], [3, 7], [4, 7],
      [5, 8], [5, 9], [5, 10],
      // bottom-left quadrant
      [7, 2], [7, 3], [7, 4],
      [9, 0], [10, 0], [11, 0],
      [9, 5], [10, 5], [11, 5],
      [12, 2], [12, 3], [12, 4],
      // bottom-right quadrant
      [7, 8], [7, 9], [7, 10],
      [9, 7], [10, 7], [11, 7],
      [9, 12], [10, 12], [11, 12],
      [12, 8], [12, 9], [12, 10]
    ]
  },

  pentadecathlon: {
    name: 'Pentadecathlon',
    offset: [15, 19],
    cells: [
      [0, 0], [1, 0],
      [2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [7, 0],
      [8, 0], [9, 0]
    ]
  },

  'gosper-glider-gun': {
    name: 'Gosper Glider Gun',
    offset: [5, 2],
    cells: [
      // left block
      [0, 0], [0, 1], [1, 0], [1, 1],
      // left spark
      [0, 10], [1, 10], [2, 10],
      [3, 11],
      // middle structure
      [4, 12], [5, 12], [6, 12],
      [3, 13], [5, 13],
      [2, 14], [6, 14],
      [4, 16], [5, 16],
      [4, 17], [5, 17],
      // right spark
      [2, 20], [3, 20], [4, 20],
      [2, 21], [3, 21], [4, 21],
      [1, 22], [5, 22],
      [0, 24], [1, 24], [5, 24], [6, 24],
      // right block
      [3, 34], [3, 35], [4, 34], [4, 35]
    ]
  },

  rpentomino: {
    name: 'R-pentomino',
    offset: [19, 19],
    cells: [[0, 1], [0, 2], [1, 0], [1, 1], [2, 1]]
  },

  diehard: {
    name: 'Diehard',
    offset: [19, 16],
    cells: [[0, 6], [1, 0], [1, 1], [2, 1], [2, 5], [2, 6], [2, 7]]
  },

  acorn: {
    name: 'Acorn',
    offset: [19, 17],
    cells: [[0, 1], [1, 3], [2, 0], [2, 1], [2, 4], [2, 5], [2, 6]]
  }
};
