import { Schema as S, Array as EffectArray } from "effect"
import settings from "./settings.json"

// Constants
export const GRID_ROWS = 13
export const GRID_COLS = 15
export const CELL_SIZE = 40
export const FPS = 30
export const GAME_DURATION = settings.timerSeconds
export const BOMB_TIMER = 3
export const EXPLOSION_DURATION = 1
export const BASE_SPEED = 0.15
export const SPEED_INCREMENT = 0.05
export const DESTRUCTION_DELAY = 0.5

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
    isDestroying: S.Boolean,
    destroyTimer: S.Number,
    powerup: S.Union(S.Literal("FireUp", "BombUp", "SpeedUp"), S.Null),
})

// Direction Enum
export type Direction = "up" | "down" | "left" | "right"

// Player
export type Player = typeof Player.Type
export const Player = S.Struct({
    id: S.Literal(1, 2, 3),
    label: S.String,
    position: Position,
    isAlive: S.Boolean,
    isHuman: S.Boolean,
    aiDirection: S.Union(S.Literal("up", "down", "left", "right"), S.Null),
    speed: S.Number,
    bombRange: S.Int,
    maxBombs: S.Int,
    activeBombs: S.Int,
    color: S.String,
    subColor: S.String,
    startPosition: Position,
    wins: S.Int,
    direction: S.Literal("up", "down", "left", "right"),
    isMoving: S.Boolean
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
    players: S.Array(Player),
    bombs: S.Array(Bomb),
    explosions: S.Array(Explosion),
    keys: S.Set(S.String),
    currentTime: S.Int,
    gamePhase: S.Literal("playing", "gameOver", "roundOver"),
    gameOverMessage: S.String,
    deathTimer: S.Union(S.Int, S.Null),
})

// Helper: Create Grid using Immutable Effect Array
export const createGrid = (): Cell[][] => {
    return EffectArray.makeBy(GRID_ROWS, (r) =>
        EffectArray.makeBy(GRID_COLS, (c) => {
            let type: "empty" | "hard" | "soft" = "empty"

            if (r === 0 || r === GRID_ROWS - 1 || c === 0 || c === GRID_COLS - 1) {
                type = "hard"
            }
            else if (r % 2 === 0 && c % 2 === 0) {
                type = "hard"
            }
            // Safe Zones
            else if (
                (r <= 2 && c <= 2) ||
                (r <= 2 && c >= GRID_COLS - 3) ||
                (r >= GRID_ROWS - 3 && c <= 2)
            ) {
                type = "empty"
            }
            else if (Math.random() * 100 < settings.softBlockSpawnChance) {
                type = "soft"
            }

            return Cell.make({ type, hasExplosion: false, powerup: null, isDestroying: false, destroyTimer: 0 })
        })
    )
}

export const initModel = Model.make({
    grid: createGrid(),
    players: EffectArray.map(
        EffectArray.range(0, settings.humanPlayers + settings.botPlayers - 1),
        (i) => {
            const id = (i + 1) as 1 | 2 | 3
            const isHuman = i < settings.humanPlayers

            let startRow = 1
            let startCol = 1
            let color = "#FFFFFF"
            let subColor = "#0000FF"

            if (id === 2) {
                startRow = 1
                startCol = GRID_COLS - 2
                color = "#000000"
                subColor = "#FF0000"
            } else if (id === 3) {
                startRow = GRID_ROWS - 2
                startCol = 1
                color = "#008000"
                subColor = "#FFA500"
            }

            return Player.make({
                id,
                label: `P${id}`,
                position: Position.make({ row: startRow, col: startCol }),
                startPosition: Position.make({ row: startRow, col: startCol }),
                isAlive: true,
                isHuman,
                aiDirection: null,
                speed: BASE_SPEED,
                bombRange: 1,
                maxBombs: 1,
                activeBombs: 0,
                color,
                subColor,
                wins: 0,
                direction: "down",
                isMoving: false
            })
        }
    ),
    bombs: [],
    explosions: [],
    keys: new Set(),
    currentTime: 0,
    gamePhase: "playing",
    gameOverMessage: "",
    deathTimer: null
})