import { Schema as S } from "effect"

export type Position = typeof Position.Type
export const Position = S.Struct({
    x: S.Number,
    y: S.Number,
})

export type Cell = typeof Cell.Type
export const Cell = S.Struct({
    row: S.Int,
    col: S.Int,
})

export type Block = typeof Block.Type
export const Block = S.Struct({
    cell: Cell,
    blockType: S.Literal("Hard", "Soft"),
})

export type Bomb = typeof Bomb.Type
export const Bomb = S.Struct({
    cell: Cell,
    timeLeft: S.Number,
})

export type Explosion = typeof Explosion.Type
export const Explosion = S.Struct({
    cells: S.Array(Cell),
    timeLeft: S.Number,
})

export type Bomberman = typeof Bomberman.Type
export const Bomberman = S.Struct({
    position: Position,
    isAlive: S.Boolean,
})