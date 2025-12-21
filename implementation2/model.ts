import { Schema as S } from "effect"

// Constants
export const GRID_ROWS = 13
export const GRID_COLS = 15
export const CELL_SIZE = 32
export const FPS = 30
export const GAME_DURATION = 60
export const BOMB_TIMER = 3
export const EXPLOSION_DURATION = 1
export const PLAYER_SPEED = 0.08

// Position
export type Position = typeof Position.Type
export const Position = S.Struct({
  row: S.Number,
  col: S.Number,
})

// Cell
export type Cell = typeof Cell.Type
export const Cell = S.Struct({
  type: S.Literal("empty", "hard", "soft"),
  hasExplosion: S.Boolean,
})

// Player
export type Player = typeof Player.Type
export const Player = S.Struct({
  id: S.Int,
  position: Position,
  isAlive: S.Boolean,
  speed: S.Number,
  bombRange: S.Int,
  maxBombs: S.Int,
  activeBombs: S.Int,
})

// Bomb
export type Bomb = typeof Bomb.Type
export const Bomb = S.Struct({
  position: Position,
  plantedAt: S.Int,
  range: S.Int,
  playerId: S.Int,
})

// Explosion
export type Explosion = typeof Explosion.Type
export const Explosion = S.Struct({
  cells: S.Array(Position),
  createdAt: S.Int,
})

// Model
export type Model = typeof Model.Type
export const Model = S.Struct({
  grid: S.Array(S.Array(Cell)),
  player: Player,
  bombs: S.Array(Bomb),
  explosions: S.Array(Explosion),
  keys: S.Set(S.String),
  currentTime: S.Int,
  gamePhase: S.Literal("playing", "gameOver"),
  gameOverMessage: S.String,
})

// Helper functions
export const createGrid = (): Cell[][] => {
  const grid: Cell[][] = []
  for (let r = 0; r < GRID_ROWS; r++) {
    const row: Cell[] = []
    for (let c = 0; c < GRID_COLS; c++) {
      let type: "empty" | "hard" | "soft" = "empty"

      if (r === 0 || r === GRID_ROWS - 1 || c === 0 || c === GRID_COLS - 1) {
        type = "hard"
      } else if (r % 2 === 0 && c % 2 === 0) {
        type = "hard"
      } else if (!(r <= 1 && c <= 1) && Math.random() < 0.3) {
        type = "soft"
      }

      row.push(Cell.make({ type, hasExplosion: false }))
    }
    grid.push(row)
  }
  return grid
}

export const initModel = Model.make({
  grid: createGrid(),
  player: Player.make({
    id: 1,
    position: Position.make({ row: 1, col: 1 }),
    isAlive: true,
    speed: PLAYER_SPEED,
    bombRange: 1,
    maxBombs: 1,
    activeBombs: 0,
  }),
  bombs: [],
  explosions: [],
  keys: new Set(),
  currentTime: 0,
  gamePhase: "playing",
  gameOverMessage: "",
})

export const getCellAt = (grid: Cell[][], row: number, col: number): Cell | null => {
  if (row >= 0 && row < GRID_ROWS && col >= 0 && col < GRID_COLS) {
    return grid[row][col]
  }
  return null
}

export const getClosestCell = (pos: Position): Position =>
  Position.make({ row: Math.round(pos.row), col: Math.round(pos.col) })