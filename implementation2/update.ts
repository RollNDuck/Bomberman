import { Match, Array as EffectArray, Option } from "effect"
import { Msg } from "./msg"
import { Model, Player, Bomb, Explosion, Position, Cell, GRID_ROWS, GRID_COLS, FPS, GAME_DURATION, BOMB_TIMER, EXPLOSION_DURATION, SPEED_INCREMENT, DESTRUCTION_DELAY, WARMUP_SECONDS, createGrid } from "./model"
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
    // Phase 5 Inputs
    if (key === "Escape" && model.state === "roundOver") return startNextRound(model)
    if (key === "Escape" && model.state === "playing") return Model.make({ ...model, isDebugMode: !model.isDebugMode })

    if (model.state !== "playing") return model

    const newKeys = new Set(model.keys)
    newKeys.add(key)

    // Immutable Bomb Planting
    const updates = EffectArray.reduce(model.players, { players: [] as Player[], bombs: model.bombs }, (acc, p) => {
        if (!p.isHuman || !p.isAlive) return { ...acc, players: EffectArray.append(acc.players, p) }

        let bombKey = (p.id === 1) ? P1_KEYS.bomb : (p.id === 2 ? P2_KEYS.bomb : "")
        if (key === bombKey && canPlantBomb(p, acc.bombs)) {
            const bomb = createBomb(p, model.currentTime)
            if (!isBombAt(bomb.position, acc.bombs)) {
                return {
                    players: EffectArray.append(acc.players, Player.make({ ...p, activeBombs: p.activeBombs + 1 })),
                    bombs: EffectArray.append(acc.bombs, bomb)
                }
            }
        }
        return { ...acc, players: EffectArray.append(acc.players, p) }
    })

    return Model.make({ ...model, keys: newKeys, bombs: updates.bombs, players: updates.players })
}

const handleKeyUp = (key: string, model: Model): Model => {
    const newKeys = new Set(model.keys)
    newKeys.delete(key)
    return Model.make({ ...model, keys: newKeys })
}

const handleTick = (model: Model): Model => {
    const currentTime = model.currentTime + 1

    // 1. WARMUP
    if (model.state === "warmup") {
        const remaining = model.roundTimer - 1
        if (remaining <= 0) return Model.make({ ...model, state: "playing", roundTimer: GAME_DURATION * FPS, currentTime })
        return Model.make({ ...model, roundTimer: remaining, currentTime })
    }

    if (model.state === "roundOver" || model.state === "matchOver") return model

    // 2. PLAYING
    let newModel = Model.make({ ...model, currentTime, roundTimer: model.roundTimer - 1 })

    if (newModel.roundTimer <= 0) return endRound(newModel, "Draw")

    newModel.grid = updateGridTimers(newModel.grid)
    newModel = updateBots(newModel)
    newModel.players = EffectArray.map(newModel.players, p => updatePlayerMovement(p, newModel.keys, newModel))
    newModel = checkPowerupCollection(newModel)

    const bombResult = updateBombsAndExplosions(newModel)
    newModel = { ...newModel, ...bombResult }

    // UPDATED: Check Deaths with 4-corner logic
    newModel = checkDeaths(newModel)

    return checkRoundEnd(newModel)
}

// --- ROUND LOGIC ---

const checkRoundEnd = (model: Model): Model => {
    const alivePlayers = EffectArray.filter(model.players, p => p.isAlive)
    if (alivePlayers.length === 0) return endRound(model, "Draw")
    if (alivePlayers.length === 1) return endRound(model, alivePlayers[0].label)
    return model
}

const endRound = (model: Model, winnerLabel: string): Model => {
    const newPlayers = EffectArray.map(model.players, p =>
        p.label === winnerLabel ? Player.make({ ...p, wins: p.wins + 1 }) : p
    )

    // Check Match Winner
    const matchWinner = EffectArray.findFirst(newPlayers, p => p.wins >= settings.roundsToWin)

    return Match.value(matchWinner).pipe(
        Match.tag("Some", ({ value: winner }) =>
            Model.make({ ...model, players: newPlayers, state: "matchOver", roundWinner: winner.label })
        ),
        Match.tag("None", () =>
            Model.make({ ...model, players: newPlayers, state: "roundOver", roundWinner: winnerLabel })
        ),
        Match.exhaustive
    )
}

const startNextRound = (model: Model): Model => {
    return Model.make({
        ...model,
        grid: createGrid(),
        bombs: [],
        explosions: [],
        keys: new Set(),
        state: "warmup",
        roundTimer: WARMUP_SECONDS * FPS,
        roundNumber: model.roundNumber + 1,
        isDebugMode: false,
        players: EffectArray.map(model.players, p => Player.make({
            ...p,
            position: p.startPosition,
            isAlive: true,
            activeBombs: 0,
            aiDirection: null,
            direction: "down",
            isMoving: false,
            // Keep upgrades? Standard usually resets, but let's reset to keep it fair/simple
            speed: BASE_SPEED,
            bombRange: 1,
            maxBombs: 1
        }))
    })
}

// --- GAMEPLAY HELPERS ---

const updateBots = (model: Model): Model => {
    if (model.currentTime % 15 !== 0) return model

    const newPlayers = EffectArray.map(model.players, p => {
        if (!p.isAlive || p.isHuman) return p
        let updatedBot = { ...p }

        if (Math.random() < 0.5) {
            const possibleDirs: ("up"|"down"|"left"|"right")[] = ["up", "down", "left", "right"]
            const valid = EffectArray.filter(possibleDirs, d => isSafeMove(p.position, d, model))
            if (valid.length > 0) updatedBot.aiDirection = valid[Math.floor(Math.random() * valid.length)]
        }
        return Player.make(updatedBot)
    })

    // Bot Bomb Logic
    const botUpdate = EffectArray.reduce(newPlayers, { players: [] as Player[], bombs: model.bombs }, (acc, p) => {
        if (!p.isAlive || p.isHuman) return { ...acc, players: EffectArray.append(acc.players, p) }

        let currentP = p
        let currentBombs = acc.bombs

        // 10% chance to plant if safe
        if (Math.random() < 0.1 && canPlantBomb(p, currentBombs)) {
             const bomb = createBomb(p, model.currentTime)
             if (!isBombAt(bomb.position, currentBombs)) {
                 currentBombs = EffectArray.append(currentBombs, bomb)
                 currentP = Player.make({ ...p, activeBombs: p.activeBombs + 1 })
             }
        }
        return { players: EffectArray.append(acc.players, currentP), bombs: currentBombs }
    })

    return { ...model, players: botUpdate.players, bombs: botUpdate.bombs }
}

const isSafeMove = (pos: Position, dir: string, model: Model): boolean => {
    let r = Math.round(pos.row), c = Math.round(pos.col)
    if (dir === "up") r--; if (dir === "down") r++; if (dir === "left") c--; if (dir === "right") c++
    if (r < 0 || r >= GRID_ROWS || c < 0 || c >= GRID_COLS) return false
    const cell = model.grid[r][c]
    return cell.type === "empty" && !cell.hasExplosion && !isBombAt({row:r, col:c}, model.bombs)
}

const updatePlayerMovement = (player: Player, keys: Set<string>, model: Model): Player => {
    if (!player.isAlive) return player
    let dRow = 0
    let dCol = 0
    let newDir = player.direction
    let isMoving = false

    if (player.isHuman) {
        if (player.id === 1) {
            if (keys.has(P1_KEYS.up)) { dRow -= player.speed; newDir = "up"; isMoving = true }
            if (keys.has(P1_KEYS.down)) { dRow += player.speed; newDir = "down"; isMoving = true }
            if (keys.has(P1_KEYS.left)) { dCol -= player.speed; newDir = "left"; isMoving = true }
            if (keys.has(P1_KEYS.right)) { dCol += player.speed; newDir = "right"; isMoving = true }
        } else if (player.id === 2) {
            if (keys.has(P2_KEYS.up)) { dRow -= player.speed; newDir = "up"; isMoving = true }
            if (keys.has(P2_KEYS.down)) { dRow += player.speed; newDir = "down"; isMoving = true }
            if (keys.has(P2_KEYS.left)) { dCol -= player.speed; newDir = "left"; isMoving = true }
            if (keys.has(P2_KEYS.right)) { dCol += player.speed; newDir = "right"; isMoving = true }
        }
    } else {
        if (player.aiDirection === "up") { dRow -= player.speed; newDir = "up"; isMoving = true }
        if (player.aiDirection === "down") { dRow += player.speed; newDir = "down"; isMoving = true }
        if (player.aiDirection === "left") { dCol -= player.speed; newDir = "left"; isMoving = true }
        if (player.aiDirection === "right") { dCol += player.speed; newDir = "right"; isMoving = true }
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
    return EffectArray.map(grid, row => EffectArray.map(row, cell =>
        cell.isDestroying ?
            (cell.destroyTimer > 0 ? Cell.make({ ...cell, destroyTimer: cell.destroyTimer - 1 }) : Cell.make({ ...cell, type: "empty", isDestroying: false }))
            : cell
    ))
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

    // 2. Identify new explosions
    const explodingBombIndices = EffectArray.filterMap(model.bombs, (b, i) => {
        const r = Math.round(b.position.row)
        const c = Math.round(b.position.col)
        const hitByExplosion = model.grid[r][c].hasExplosion

        if ((model.currentTime - b.plantedAt) >= FPS * BOMB_TIMER || hitByExplosion) {
            return Option.some(i)
        }
        return Option.none()
    })

    if (explodingBombIndices.length === 0) {
        const activeExplosionCells = new Set(EffectArray.flatMap(newExplosions, e => e.cells).map(p => `${p.row},${p.col}`))
        const newGrid = EffectArray.map(model.grid, (row, r) => EffectArray.map(row, (cell, c) =>
            Cell.make({ ...cell, hasExplosion: activeExplosionCells.has(`${r},${c}`) })
        ))
        return { grid: newGrid, explosions: newExplosions, bombs: model.bombs, players: model.players }
    }

    const newRayExplosions = EffectArray.flatMap(model.bombs, (b, i) => {
        if (!EffectArray.contains(explodingBombIndices, i)) return []

        const cells: Position[] = []
        const center = { r: Math.round(b.position.row), c: Math.round(b.position.col) }
        cells.push(Position.make({ row: center.r, col: center.c }))

        const dirs = [[0,1], [0,-1], [1,0], [-1,0]]

        dirs.forEach(([dr, dc]) => {
            for (let k = 1; k <= b.range; k++) {
                const r = center.r + dr * k
                const c = center.c + dc * k
                if (r < 0 || r >= GRID_ROWS || c < 0 || c >= GRID_COLS) break
                const cell = model.grid[r][c]
                if (cell.type === "hard") break
                cells.push(Position.make({ row: r, col: c }))
                if (cell.type === "soft" && !cell.isDestroying) break
            }
        })
        return [Explosion.make({ cells, createdAt: model.currentTime })]
    })

    const allExplosions = EffectArray.appendAll(newExplosions, newRayExplosions)
    const activeExplosionCells = new Set(EffectArray.flatMap(allExplosions, e => e.cells).map(p => `${p.row},${p.col}`))

    const newGrid = EffectArray.map(model.grid, (row, r) => EffectArray.map(row, (cell, c) => {
        const isExplosion = activeExplosionCells.has(`${r},${c}`)
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
        if (isExplosion && cell.powerup) {
            return Cell.make({ ...cell, hasExplosion: true, powerup: null })
        }
        return Cell.make({ ...cell, hasExplosion: isExplosion })
    }))

    const remainingBombs = EffectArray.filter(model.bombs, (_, i) => !EffectArray.contains(explodingBombIndices, i))
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

        // CORNER CHECK LOGIC FOR DEATH
        // Check 4 corners with a slight inset (hitbox)
        const corners = [
            { r: Math.floor(p.position.row + 0.2), c: Math.floor(p.position.col + 0.2) },
            { r: Math.floor(p.position.row + 0.2), c: Math.floor(p.position.col + 0.8) },
            { r: Math.floor(p.position.row + 0.8), c: Math.floor(p.position.col + 0.2) },
            { r: Math.floor(p.position.row + 0.8), c: Math.floor(p.position.col + 0.8) }
        ]

        const isHit = corners.some(corner => {
             if (corner.r < 0 || corner.r >= GRID_ROWS || corner.c < 0 || corner.c >= GRID_COLS) return false
             return model.grid[corner.r][corner.c].hasExplosion
        })

        if (isHit) {
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