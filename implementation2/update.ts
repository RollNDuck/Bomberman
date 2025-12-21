import { Match, Array as EffectArray, Option } from "effect"
import { Msg } from "./msg"
import { Model, Player, Bomb, Explosion, Position, Cell, GRID_ROWS, GRID_COLS, FPS, GAME_DURATION, BOMB_TIMER, EXPLOSION_DURATION, SPEED_INCREMENT, DESTRUCTION_DELAY } from "./model"
import settings from "./settings.json"

const P1_KEYS = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", bomb: " " }
const P2_KEYS = { up: "w", down: "s", left: "a", right: "d", bomb: "x" }

export const update = (msg: Msg, model: Model): Model => {
    return Match.value(msg).pipe(
        Match.tag("KeyDown", ({ key }) => handleKeyDown(key, model)),
        Match.tag("KeyUp", ({ key }) => handleKeyUp(key, model)),
        Match.tag("Tick", () => handleTick(model)),
        Match.exhaustive,
    )
}

const handleKeyDown = (key: string, model: Model): Model => {
    if (model.gamePhase !== "playing") return model
    const newKeys = new Set(model.keys)
    newKeys.add(key)

    // Check if any human player plants a bomb
    // We iterate immutably over players to find if one planted a bomb
    const bombToPlant = EffectArray.findFirst(model.players, p => {
        if (!p.isHuman || !p.isAlive) return false
        let bombKey = ""
        if (p.id === 1) bombKey = P1_KEYS.bomb
        if (p.id === 2) bombKey = P2_KEYS.bomb
        return key === bombKey && canPlantBomb(p, model.bombs)
    })

    // If a player wants to plant, we update state
    return Match.value(bombToPlant).pipe(
        Match.tag("Some", ({ value: p }) => {
            const bomb = createBomb(p, model.currentTime)
            if (!isBombAt(bomb.position, model.bombs)) {
                // Update players (increment active bombs) and bombs list
                const newPlayers = EffectArray.map(model.players, player =>
                    player.id === p.id ? Player.make({ ...player, activeBombs: player.activeBombs + 1 }) : player
                )
                const newBombs = EffectArray.append(model.bombs, bomb)
                return Model.make({ ...model, keys: newKeys, bombs: newBombs, players: newPlayers })
            }
            return Model.make({ ...model, keys: newKeys })
        }),
        Match.tag("None", () => Model.make({ ...model, keys: newKeys })),
        Match.exhaustive
    )
}

const handleKeyUp = (key: string, model: Model): Model => {
    const newKeys = new Set(model.keys)
    newKeys.delete(key)
    return Model.make({ ...model, keys: newKeys })
}

const handleTick = (model: Model): Model => {
    if (model.gamePhase !== "playing") return model

    let newModel = { ...model }
    newModel.currentTime = model.currentTime + 1

    const elapsedSeconds = newModel.currentTime / FPS
    if (elapsedSeconds >= GAME_DURATION) {
        return endGame(newModel, "Draw (Time's Up!)")
    }

    newModel.grid = updateGridTimers(newModel.grid)
    newModel = updateBots(newModel)
    newModel.players = EffectArray.map(newModel.players, p => updatePlayerMovement(p, newModel.keys, newModel))
    newModel = checkPowerupCollection(newModel)

    const bombResult = updateBombsAndExplosions(newModel)
    newModel = { ...newModel, ...bombResult }
    newModel = checkDeaths(newModel)

    return Model.make(newModel)
}

const updateBots = (model: Model): Model => {
    if (model.currentTime % 30 !== 0) return model

    // Purely transform players array
    const newPlayers = EffectArray.map(model.players, p => {
        if (!p.isAlive || p.isHuman) return p

        let updatedBot = { ...p }

        // 1. Bot Move Logic (Random)
        if (Math.random() * 100 < settings.botMoveChance) {
            const possibleDirs: ("up" | "down" | "left" | "right")[] = ["up", "down", "left", "right"]
            const validDirs = EffectArray.filter(possibleDirs, d => {
                const r = Math.round(p.position.row)
                const c = Math.round(p.position.col)
                let targetR = r, targetC = c
                if (d === "up") targetR--
                if (d === "down") targetR++
                if (d === "left") targetC--
                if (d === "right") targetC++

                if (targetR < 0 || targetR >= GRID_ROWS || targetC < 0 || targetC >= GRID_COLS) return false
                const cell = model.grid[targetR][targetC]
                if (cell.type !== "empty") return false
                if (EffectArray.some(model.bombs, b => Math.round(b.position.row) === targetR && Math.round(b.position.col) === targetC)) return false
                return true
            })

            if (validDirs.length > 0) {
                const idx = Math.floor(Math.random() * validDirs.length)
                updatedBot.aiDirection = validDirs[idx]
            } else {
                updatedBot.aiDirection = null
            }
        }
        return Player.make(updatedBot)
    })

    // Separate Pass for Planting (State dependent)
    // To strictly follow immutable flow, we could fold, but simple map + check is okay if collisions rare
    // We will just return the player updates for now. Complex bomb planting logic for bots involves checking the updated `newPlayers` against `model.bombs`

    // Simplification for immutable example: Bots effectively decide intent, state updates in next tick or refactored.
    // Here we just plant if possible using current state.

    // We need to return both potential new bombs and players
    // This is tricky with simple map. We'll use a reduce to accumulate changes.

    const botUpdate = EffectArray.reduce(newPlayers, { players: [] as Player[], bombs: model.bombs }, (acc, p) => {
        if (!p.isAlive || p.isHuman) {
            return { ...acc, players: EffectArray.append(acc.players, p) }
        }

        let currentP = p
        let currentBombs = acc.bombs

        if (Math.random() * 100 < settings.botBombChance) {
            if (canPlantBomb(p, currentBombs)) {
                const bomb = createBomb(p, model.currentTime)
                if (!isBombAt(bomb.position, currentBombs)) {
                    currentBombs = EffectArray.append(currentBombs, bomb)
                    currentP = Player.make({ ...p, activeBombs: p.activeBombs + 1 })
                }
            }
        }
        return { players: EffectArray.append(acc.players, currentP), bombs: currentBombs }
    })

    return { ...model, players: botUpdate.players, bombs: botUpdate.bombs }
}

const updatePlayerMovement = (player: Player, keys: Set<string>, model: Model): Player => {
    if (!player.isAlive) return player
    let dRow = 0
    let dCol = 0
    let newDir = player.direction
    let isMoving = false

    if (player.isHuman) {
        if (player.id === 1) {
            if (keys.has(P1_KEYS.up)) { dRow -= player.speed; newDir = "up"; isMoving = true; }
            if (keys.has(P1_KEYS.down)) { dRow += player.speed; newDir = "down"; isMoving = true; }
            if (keys.has(P1_KEYS.left)) { dCol -= player.speed; newDir = "left"; isMoving = true; }
            if (keys.has(P1_KEYS.right)) { dCol += player.speed; newDir = "right"; isMoving = true; }
        } else if (player.id === 2) {
            if (keys.has(P2_KEYS.up)) { dRow -= player.speed; newDir = "up"; isMoving = true; }
            if (keys.has(P2_KEYS.down)) { dRow += player.speed; newDir = "down"; isMoving = true; }
            if (keys.has(P2_KEYS.left)) { dCol -= player.speed; newDir = "left"; isMoving = true; }
            if (keys.has(P2_KEYS.right)) { dCol += player.speed; newDir = "right"; isMoving = true; }
        }
    } else {
        if (player.aiDirection === "up") { dRow -= player.speed; newDir = "up"; isMoving = true; }
        if (player.aiDirection === "down") { dRow += player.speed; newDir = "down"; isMoving = true; }
        if (player.aiDirection === "left") { dCol -= player.speed; newDir = "left"; isMoving = true; }
        if (player.aiDirection === "right") { dCol += player.speed; newDir = "right"; isMoving = true; }
    }

    let nextPos = player.position
    const newRow = player.position.row + dRow
    const newCol = player.position.col + dCol

    if (canMoveTo(newRow, newCol, player.position, model)) {
        nextPos = Position.make({ row: newRow, col: newCol })
    } else if (dRow !== 0 && dCol !== 0) {
        if (canMoveTo(player.position.row + dRow, player.position.col, player.position, model)) {
             nextPos = Position.make({ row: player.position.row + dRow, col: player.position.col })
        } else if (canMoveTo(player.position.row, player.position.col + dCol, player.position, model)) {
             nextPos = Position.make({ row: player.position.row, col: player.position.col + dCol })
        }
    } else if ((dRow !== 0 && dCol === 0) || (dRow === 0 && dCol !== 0)) {
         if (canMoveTo(newRow, newCol, player.position, model)) {
            nextPos = Position.make({ row: newRow, col: newCol })
        }
    }

    return Player.make({ ...player, position: nextPos, direction: newDir, isMoving: isMoving })
}

const updateGridTimers = (grid: Cell[][]): Cell[][] => {
    return EffectArray.map(grid, row => EffectArray.map(row, cell => {
        if (cell.isDestroying) {
            if (cell.destroyTimer > 0) {
                return Cell.make({ ...cell, destroyTimer: cell.destroyTimer - 1 })
            } else {
                return Cell.make({ ...cell, type: "empty", isDestroying: false })
            }
        }
        return cell
    }))
}

const canPlantBomb = (p: Player, bombs: Bomb[]) => p.isAlive && p.activeBombs < p.maxBombs

const createBomb = (p: Player, time: number): Bomb => {
    return Bomb.make({
        position: Position.make({ row: Math.round(p.position.row), col: Math.round(p.position.col) }),
        plantedAt: time,
        range: p.bombRange,
        playerId: parseInt(p.id.toString())
    })
}

const isBombAt = (pos: Position, bombs: Bomb[]) => {
    return EffectArray.some(bombs, b => b.position.row === pos.row && b.position.col === pos.col)
}

const canMoveTo = (row: number, col: number, oldPos: Position, model: Model): boolean => {
    const corners = [
        { r: row + 0.15, c: col + 0.15 }, { r: row + 0.15, c: col + 0.85 },
        { r: row + 0.85, c: col + 0.15 }, { r: row + 0.85, c: col + 0.85 }
    ]
    for (const corner of corners) {
        const r = Math.floor(corner.r)
        const c = Math.floor(corner.c)
        if (r < 0 || r >= GRID_ROWS || c < 0 || c >= GRID_COLS) return false

        const cell = model.grid[r][c]
        if (cell.type === "hard" || (cell.type === "soft" && !cell.isDestroying)) return false

        const bomb = EffectArray.findFirst(model.bombs, b => Math.round(b.position.row) === r && Math.round(b.position.col) === c)
        // Match.value logic for Option
        const result = Match.value(bomb).pipe(
            Match.tag("Some", () => {
                const alreadyOverlapping = doesOverlap(oldPos, r, c)
                return alreadyOverlapping
            }),
            Match.tag("None", () => true),
            Match.exhaustive
        )
        if (!result) return false
    }
    return true
}

const doesOverlap = (pos: Position, cellR: number, cellC: number): boolean => {
    const pLeft = pos.col + 0.15
    const pRight = pos.col + 0.85
    const pTop = pos.row + 0.15
    const pBottom = pos.row + 0.85
    return !(pLeft > cellC + 1 || pRight < cellC || pTop > cellR + 1 || pBottom < cellR)
}

const checkPowerupCollection = (model: Model): Model => {
    // Pure transformation
    const collectedUpdates = EffectArray.reduce(model.players, { grid: model.grid, players: [] as Player[] }, (acc, p) => {
        if (!p.isAlive) return { ...acc, players: EffectArray.append(acc.players, p) }

        const r = Math.round(p.position.row)
        const c = Math.round(p.position.col)
        const cell = acc.grid[r][c]

        if (cell.powerup && !cell.isDestroying && cell.type === "empty") {
            let updatedPlayer = { ...p }
            if (cell.powerup === "FireUp") updatedPlayer.bombRange++
            if (cell.powerup === "BombUp") updatedPlayer.maxBombs++
            if (cell.powerup === "SpeedUp") updatedPlayer.speed += SPEED_INCREMENT

            // Return updated grid (powerup removed) and updated player
            const newRow = EffectArray.map(acc.grid[r], (cCell, idx) => idx === c ? Cell.make({ ...cCell, powerup: null }) : cCell)
            const newGrid = EffectArray.map(acc.grid, (row, idx) => idx === r ? newRow : row)

            return { grid: newGrid, players: EffectArray.append(acc.players, Player.make(updatedPlayer)) }
        }
        return { ...acc, players: EffectArray.append(acc.players, p) }
    })

    return { ...model, grid: collectedUpdates.grid, players: collectedUpdates.players }
}

const updateBombsAndExplosions = (model: Model): Partial<Model> => {
    // 1. Filter out old explosions
    let newExplosions = EffectArray.filter(model.explosions, e => (model.currentTime - e.createdAt) < FPS * EXPLOSION_DURATION)

    // 2. Identify new explosions (from bombs)
    const explodingBombIndices = EffectArray.filterMap(model.bombs, (b, i) => {
        // Time based or Chain reaction?
        // Chain reaction is hard to calculate immutably in one pass without recursion.
        // Simplified: Explode if time is up OR if on an existing explosion.
        const r = Math.round(b.position.row)
        const c = Math.round(b.position.col)

        // Check if bomb is on a cell that currently has an explosion
        const hitByExplosion = model.grid[r][c].hasExplosion

        if ((model.currentTime - b.plantedAt) >= FPS * BOMB_TIMER || hitByExplosion) {
            return Option.some(i)
        }
        return Option.none()
    })

    // If no bombs explode, just return cleaned explosions
    if (explodingBombIndices.length === 0) {
        // Need to update grid hasExplosion state based on remaining explosions
        // This requires a full grid map
        const activeExplosionCells = new Set(EffectArray.flatMap(newExplosions, e => e.cells).map(p => `${p.row},${p.col}`))
        const newGrid = EffectArray.map(model.grid, (row, r) => EffectArray.map(row, (cell, c) =>
            Cell.make({ ...cell, hasExplosion: activeExplosionCells.has(`${r},${c}`) })
        ))
        return { grid: newGrid, explosions: newExplosions, bombs: model.bombs, players: model.players }
    }

    // Process explosions
    // We simply remove the bombs and add new explosions.
    // We let the NEXT tick handle the "destroy soft block" logic via the grid state to keep this function cleaner,
    // OR we calculate the rays here.

    // Let's calculate rays for the exploding bombs
    const newRayExplosions = EffectArray.flatMap(model.bombs, (b, i) => {
        if (!EffectArray.contains(explodingBombIndices, i)) return []

        const cells: Position[] = []
        const center = { r: Math.round(b.position.row), c: Math.round(b.position.col) }
        cells.push(Position.make({ row: center.r, col: center.c }))

        const dirs = [[0,1], [0,-1], [1,0], [-1,0]]
        // Ray casting logic (simplified for immutable array construction)
        // In a strictly immutable/pure functional way, we can't "break" easily inside a map.
        // We usually calculate the full ray distance then generate points.

        dirs.forEach(([dr, dc]) => {
            for (let k = 1; k <= b.range; k++) {
                const r = center.r + dr * k
                const c = center.c + dc * k
                if (r < 0 || r >= GRID_ROWS || c < 0 || c >= GRID_COLS) break
                const cell = model.grid[r][c]
                if (cell.type === "hard") break
                cells.push(Position.make({ row: r, col: c }))
                if (cell.type === "soft" && !cell.isDestroying) break // Stop at soft block
            }
        })

        return [Explosion.make({ cells, createdAt: model.currentTime })]
    })

    const allExplosions = EffectArray.appendAll(newExplosions, newRayExplosions)
    const activeExplosionCells = new Set(EffectArray.flatMap(allExplosions, e => e.cells).map(p => `${p.row},${p.col}`))

    // Rebuild Grid
    const newGrid = EffectArray.map(model.grid, (row, r) => EffectArray.map(row, (cell, c) => {
        const isExplosion = activeExplosionCells.has(`${r},${c}`)

        // Handle Block Destruction
        if (isExplosion && cell.type === "soft" && !cell.isDestroying) {
             const spawnPowerup = Math.random() * 100 < settings.powerupSpawnChance
             let powerup: any = null
             if (spawnPowerup) {
                 const rand = Math.random()
                 if (rand < 0.33) powerup = "FireUp"
                 else if (rand < 0.66) powerup = "BombUp"
                 else powerup = "SpeedUp"
             }
             return Cell.make({
                 ...cell, hasExplosion: true, isDestroying: true,
                 destroyTimer: FPS * DESTRUCTION_DELAY, powerup
             })
        }

        // Handle Powerup Destruction
        if (isExplosion && cell.powerup) {
            return Cell.make({ ...cell, hasExplosion: true, powerup: null })
        }

        return Cell.make({ ...cell, hasExplosion: isExplosion })
    }))

    // Remove exploded bombs
    const remainingBombs = EffectArray.filter(model.bombs, (_, i) => !EffectArray.contains(explodingBombIndices, i))

    // Restore bombs to players
    const playersRestored = EffectArray.map(model.players, p => {
        const bombsOwnedExploded = EffectArray.filter(model.bombs, (b, i) =>
            b.playerId === p.id && EffectArray.contains(explodingBombIndices, i)
        ).length
        if (bombsOwnedExploded > 0) {
            return Player.make({ ...p, activeBombs: Math.max(0, p.activeBombs - bombsOwnedExploded) })
        }
        return p
    })

    return { grid: newGrid, bombs: remainingBombs, explosions: allExplosions, players: playersRestored }
}

const checkDeaths = (model: Model): Model => {
    const players = EffectArray.map(model.players, p => {
        if (!p.isAlive) return p
        const r = Math.round(p.position.row)
        const c = Math.round(p.position.col)
        if (model.grid[r][c].hasExplosion) {
            return Player.make({ ...p, isAlive: false })
        }
        return p
    })

    const deathOccurred = EffectArray.some(players, p => !p.isAlive &&
        EffectArray.findFirst(model.players, oldP => oldP.id === p.id && oldP.isAlive)._tag === "Some"
    )

    let newDeathTimer = model.deathTimer
    if (deathOccurred && model.deathTimer === null) newDeathTimer = model.currentTime

    if (newDeathTimer !== null) {
        const timeSinceDeath = (model.currentTime - newDeathTimer) / FPS
        if (timeSinceDeath >= 1.0) {
            const alivePlayers = EffectArray.filter(players, p => p.isAlive)
            if (alivePlayers.length === 0) return endGame({ ...model, players }, "Draw!")
            else if (alivePlayers.length === 1) return endGame({ ...model, players }, `${alivePlayers[0].label} Wins!`)
        }
    }
    return { ...model, players, deathTimer: newDeathTimer }
}

const endGame = (model: Model, msg: string): Model => {
    return Model.make({ ...model, gamePhase: "gameOver", gameOverMessage: msg })
}