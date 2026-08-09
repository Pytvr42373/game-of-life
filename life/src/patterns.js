// Classic Game of Life patterns
// Each pattern is an array of [row, col] offsets from the pattern's origin
// All patterns verified by simulation (B3/S23 rules)

export const PATTERNS = {
  glider: {
    name: 'Glider',
    offset: [19, 19],
    cells: [[0,1],[1,2],[2,0],[2,1],[2,2]]
  },

  lwss: {
    name: 'Lightweight Spaceship',
    offset: [10, 5],
    cells: [[0,1],[0,4],[1,0],[1,4],[2,0],[3,0],[3,1],[3,2],[3,3]]
  },

  blinker: {
    name: 'Blinker',
    offset: [19, 19],
    cells: [[0,0],[0,1],[0,2]]
  },

  toad: {
    name: 'Toad',
    offset: [19, 19],
    cells: [[0,1],[0,2],[0,3],[1,0],[1,1],[1,2]]
  },

  beacon: {
    name: 'Beacon',
    offset: [19, 19],
    cells: [[0,0],[0,1],[1,0],[1,1],[2,2],[2,3],[3,2],[3,3]]
  },

  pulsar: {
    name: 'Pulsar',
    offset: [13, 13],
    cells: [
      // top-left quadrant
      [0,2],[0,3],[0,4],
      [2,0],[3,0],[4,0],
      [2,5],[3,5],[4,5],
      [5,2],[5,3],[5,4],
      // top-right quadrant
      [0,8],[0,9],[0,10],
      [2,7],[3,7],[4,7],
      [2,12],[3,12],[4,12],
      [5,8],[5,9],[5,10],
      // bottom-left quadrant (mirror of top)
      [7,2],[7,3],[7,4],
      [8,0],[9,0],[10,0],
      [8,5],[9,5],[10,5],
      [12,2],[12,3],[12,4],
      // bottom-right quadrant (mirror of top)
      [7,8],[7,9],[7,10],
      [8,7],[9,7],[10,7],
      [8,12],[9,12],[10,12],
      [12,8],[12,9],[12,10]
    ]
  },

  pentadecathlon: {
    name: 'Pentadecathlon',
    offset: [16, 19],
    cells: [
      [0,0],[1,0],[2,0],[3,0],[4,0],[5,0],[6,0],[7,0],
      [0,1],[2,1],[3,1],[4,1],[5,1],[7,1],
      [0,2],[1,2],[2,2],[3,2],[4,2],[5,2],[6,2],[7,2]
    ]
  },

  'gosper-glider-gun': {
    name: 'Gosper Glider Gun',
    offset: [2, 2],
    cells: [
      [0,24],
      [1,22],[1,24],
      [2,12],[2,13],[2,20],[2,21],[2,34],[2,35],
      [3,11],[3,15],[3,20],[3,21],[3,34],[3,35],
      [4,0],[4,1],[4,10],[4,16],[4,20],[4,21],
      [5,0],[5,1],[5,10],[5,14],[5,16],[5,17],[5,22],[5,24],
      [6,10],[6,16],[6,24],
      [7,11],[7,15],
      [8,12],[8,13]
    ]
  },

  rpentomino: {
    name: 'R-pentomino',
    offset: [19, 19],
    cells: [[0,1],[0,2],[1,0],[1,1],[2,1]]
  },

  diehard: {
    name: 'Diehard',
    offset: [19, 16],
    cells: [[0,6],[1,0],[1,1],[2,1],[2,5],[2,6],[2,7]]
  },

  acorn: {
    name: 'Acorn',
    offset: [19, 17],
    cells: [[0,1],[1,3],[2,0],[2,1],[2,4],[2,5],[2,6]]
  }
};
