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
export const WARMUP_SECONDS = 3

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

export type Player = typeof Player.Type
export const Player = S.Struct({
    id: S.Int,
    label: S.String,
    position: Position,
    isAlive: S.Boolean,
    isHuman: S.Boolean,
    // Bot Config
    botType: S.Union(S.String, S.Null),
    aiDirection: S.Union(S.Literal("up", "down", "left", "right"), S.Null),
    // Stats
    speed: S.Number,
    bombRange: S.Int,
    maxBombs: S.Int,
    activeBombs: S.Int,
    // Visuals
    color: S.String,
    subColor: S.String,
    direction: S.Literal("up", "down", "left", "right"),
    isMoving: S.Boolean,
    // Meta
    startPosition: Position,
    wins: S.Int
})

export type Bomb = typeof Bomb.Type
export const Bomb = S.Struct({
    position: Position,
    plantedAt: S.Int,
    range: S.Int,
    playerId: S.Int,
})

export type Explosion = typeof Explosion.Type
export const Explosion = S.Struct({
    cells: S.Array(Position),
    createdAt: S.Int,
})

// Game Model
export type Model = typeof Model.Type
export const Model = S.Struct({
    grid: S.Array(S.Array(Cell)),
    players: S.Array(Player),
    bombs: S.Array(Bomb),
    explosions: S.Array(Explosion),
    keys: S.Set(S.String),
    currentTime: S.Int,

    // Phase 5 State Machine
    state: S.Literal("warmup", "playing", "roundOver", "matchOver"),
    roundTimer: S.Int,
    roundNumber: S.Int,
    roundWinner: S.Union(S.String, S.Null),
    isDebugMode: S.Boolean
})

// --- Initialization Helpers ---

export const createGrid = (): Cell[][] => {
    return EffectArray.makeBy(GRID_ROWS, (r) =>
        EffectArray.makeBy(GRID_COLS, (c) => {
            let type: "empty" | "hard" | "soft" = "empty"

            // Hard Blocks (Border + Checkerboard)
            if (r === 0 || r === GRID_ROWS - 1 || c === 0 || c === GRID_COLS - 1) type = "hard"
            else if (r % 2 === 0 && c % 2 === 0) type = "hard"
            // Safe Zones (Corners)
            else if (
                (r <= 2 && c <= 2) || (r <= 2 && c >= GRID_COLS - 3) ||
                (r >= GRID_ROWS - 3 && c <= 2) || (r >= GRID_ROWS - 3 && c >= GRID_COLS - 3)
            ) type = "empty"
            // Soft Blocks (Random)
            else if (Math.random() * 100 < settings.softBlockSpawnChance) type = "soft"

            return Cell.make({ type, hasExplosion: false, powerup: null, isDestroying: false, destroyTimer: 0 })
        })
    )
}

export const initPlayers = (): Player[] => {
    const humanCount = Math.min(2, Math.max(1, settings.humanPlayers))
    const botCount = settings.botTypes.length
    const totalPlayers = Math.min(4, humanCount + botCount)

    return EffectArray.makeBy(totalPlayers, (i) => {
        const id = i + 1
        const isHuman = i < humanCount
        const botType = isHuman ? null : settings.botTypes[i - humanCount] || "hostile"

        let r = 1, c = 1, color = "#FFF", sub = "#00F"
        if (id === 1) { r=1; c=1; color="#FFFFFF"; sub="#0000FF" } // TL
        if (id === 2) { r=1; c=GRID_COLS-2; color="#000000"; sub="#FF0000" } // TR
        if (id === 3) { r=GRID_ROWS-2; c=1; color="#008000"; sub="#FFA500" } // BL
        if (id === 4) { r=GRID_ROWS-2; c=GRID_COLS-2; color="#FFFF00"; sub="#800080" } // BR

        return Player.make({
            id, label: `P${id}`,
            position: Position.make({ row: r, col: c }),
            startPosition: Position.make({ row: r, col: c }),
            isAlive: true, isHuman, botType,
            aiDirection: null, speed: BASE_SPEED,
            bombRange: 1, maxBombs: 1, activeBombs: 0,
            color, subColor: sub, wins: 0,
            direction: "down", isMoving: false
        })
    })
}

export const initModel = Model.make({
    grid: createGrid(),
    players: initPlayers(),
    bombs: [],
    explosions: [],
    keys: new Set(),
    currentTime: 0,
    state: "warmup",
    roundTimer: WARMUP_SECONDS * FPS,
    roundNumber: 1,
    roundWinner: null,
    isDebugMode: false
})