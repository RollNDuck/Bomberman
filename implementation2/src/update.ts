import { Match, Array as EffectArray } from "effect"
import { Msg } from "./msg"
import {
    Model, Player, Bomb, Explosion, Position, Cell, GRID_ROWS, GRID_COLS,
    FPS, BOMB_TIMER, EXPLOSION_DURATION, BASE_SPEED, SPEED_INCREMENT,
    DESTRUCTION_DELAY, WARMUP_SECONDS, createGrid, initModel
} from "./model"
import settings from "./settings"

const P1_KEYS = {
    up: "ArrowUp",
    down: "ArrowDown",
    left: "ArrowLeft",
    right: "ArrowRight",
    bomb: " "
}
const P2_KEYS = {
    up: "w",
    down: "s",
    left: "a",
    right: "d",
    bomb: "x"
}

const isBombAt = (pos: Position, bombs: Bomb[]): boolean => {
    const roundedPos = {
        row: Math.round(pos.row),
        col: Math.round(pos.col)
    }
    return EffectArray.some(bombs, b =>
        Math.round(b.position.row) === roundedPos.row &&
        Math.round(b.position.col) === roundedPos.col
    )
}

const canPlantBomb = (player: Player, bombs: Bomb[]): boolean => {
    return player.isAlive && player.activeBombs < player.maxBombs
}

const createBomb = (player: Player, time: number): Bomb => {
    return Bomb.make({
        position: Position.make({
            row: Math.round(player.position.row),
            col: Math.round(player.position.col)
        }),
        plantedAt: time,
        range: player.bombRange,
        playerId: player.id
    })
}

export const update = (msg: Msg, model: Model): Model => {
    return Match.value(msg).pipe(
        Match.tag("KeyDown", ({ key }) => handleKeyDown(key, model)),
        Match.tag("KeyUp", ({ key }) => handleKeyUp(key, model)),
        Match.tag("Tick", () => handleTick(model)),
        Match.tag("ToggleDebug", () => Model.make({ ...model, isDebugMode: !model.isDebugMode })),
        Match.tag("RestartGame", () => handleRestartGame()),
        Match.tag("StartNextRound", () => handleStartNextRound(model)),
        Match.exhaustive,
    )
}

const handleKeyDown = (key: string, model: Model): Model => {
    if (key.toLowerCase() === "r" && (model.state === "roundOver" || model.state === "matchOver")) {
        if (model.state === "matchOver") {
            return handleRestartGame()
        } else {
            return handleStartNextRound(model)
        }
    }

    if (key === "Escape") {
        if (model.state === "playing") {
            return Model.make({ ...model, isDebugMode: !model.isDebugMode })
        } else if (model.state === "roundOver") {
            return handleStartNextRound(model)
        } else if (model.state === "matchOver") {
            return handleRestartGame()
        }
    }

    if (model.state !== "playing") return model

    const newKeys = new Set(model.keys)
    newKeys.add(key)

    const bombUpdates = EffectArray.reduce(model.players, {
        players: [],
        bombs: model.bombs
    }, (acc, player) => {
        if (!player.isHuman || !player.isAlive) {
            return {
                ...acc,
                players: EffectArray.append(acc.players, player)
            }
        }

        let bombKey = ""
        if (player.id === 1) bombKey = P1_KEYS.bomb
        else if (player.id === 2) bombKey = P2_KEYS.bomb

        if (key === bombKey && canPlantBomb(player, acc.bombs)) {
            const bombPos = Position.make({
                row: Math.round(player.position.row),
                col: Math.round(player.position.col)
            })

            if (!isBombAt(bombPos, acc.bombs)) {
                const bomb = createBomb(player, model.currentTime)

                return {
                    players: EffectArray.append(acc.players, Player.make({
                        ...player,
                        activeBombs: player.activeBombs + 1
                    })),
                    bombs: EffectArray.append(acc.bombs, bomb)
                }
            }
        }

        return {
            ...acc,
            players: EffectArray.append(acc.players, player)
        }
    })

    return Model.make({
        ...model,
        keys: newKeys,
        players: bombUpdates.players,
        bombs: bombUpdates.bombs
    })
}

const handleKeyUp = (key: string, model: Model): Model => {
    const newKeys = new Set(model.keys)
    newKeys.delete(key)
    return Model.make({ ...model, keys: newKeys })
}

const handleTick = (model: Model): Model => {
    const currentTime = model.currentTime + 1

    if (model.state === "warmup") {
        const remaining = model.roundTimer - 1
        if (remaining <= 0) {
            return Model.make({
                ...model,
                currentTime,
                state: "playing",
                roundTimer: settings.timerSeconds * FPS
            })
        }
        return Model.make({
            ...model,
            currentTime,
            roundTimer: remaining
        })
    }

    if (model.state === "roundOver" || model.state === "matchOver") {
        return Model.make({ ...model, currentTime })
    }

    if (model.roundTimer <= 0) {
        return endRound(model, "Draw")
    }

    let updatedModel = Model.make({
        ...model,
        currentTime,
        roundTimer: model.roundTimer - 1
    })

    updatedModel.grid = updateGridTimers(updatedModel.grid)
    updatedModel.players = EffectArray.map(updatedModel.players, updatePlayerTimers)

    if (updatedModel.players.length > 1) {
        updatedModel = updateBotAI(updatedModel)
    }

    updatedModel.players = EffectArray.map(updatedModel.players, player =>
        updatePlayerMovement(player, updatedModel.keys, updatedModel)
    )

    updatedModel = checkPowerupCollection(updatedModel)

    const bombResult = updateBombsAndExplosions(updatedModel)
    updatedModel = { ...updatedModel, ...bombResult }

    updatedModel = checkDeaths(updatedModel)

    return updatedModel
}

const handleRestartGame = (): Model => {
    const newModel = createGrid()
    return Model.make({
        ...initModel,
        grid: newModel,
        roundsToWin: settings.roundsToWin || 3
    })
}

const handleStartNextRound = (model: Model): Model => {
    const newPlayers = EffectArray.map(model.players, player => Player.make({
        ...player,
        position: player.startPosition,
        isAlive: true,
        activeBombs: 0,
        speed: BASE_SPEED,
        bombRange: 1,
        maxBombs: 1,
        hasVest: false,
        vestTimer: 0,
        rainbowTimers: { FireUp: 0, BombUp: 0, SpeedUp: 0 },
        direction: "down",
        isMoving: false,
        botState: player.botType ? "WANDER" : null,
        botGoal: Position.make({ row: -1, col: -1 }),
        botPath: [],
        lastReevaluation: 0,
        aiDirection: null
    }))

    return Model.make({
        grid: createGrid(),
        players: newPlayers,
        bombs: [],
        explosions: [],
        keys: new Set(),
        currentTime: 0,
        state: "warmup",
        roundTimer: WARMUP_SECONDS * FPS,
        roundNumber: model.roundNumber + 1,
        roundWinner: null,
        roundsToWin: model.roundsToWin,
        isDebugMode: false,
        deathTimer: null,
        gamePhase: "active",
        gameOverMessage: ""
    })
}

const endRound = (model: Model, winnerLabel: string): Model => {
    const newPlayers = EffectArray.map(model.players, player =>
        player.label === winnerLabel ?
            Player.make({ ...player, wins: player.wins + 1 }) :
            player
    )

    const matchWinner = EffectArray.findFirst(newPlayers, player =>
        player.wins >= model.roundsToWin
    )

    return Match.value(matchWinner).pipe(
        Match.tag("Some", ({ value: winner }) =>
            Model.make({
                ...model,
                players: newPlayers,
                state: "matchOver",
                roundWinner: winner.label,
                gamePhase: "active"
            })
        ),
        Match.tag("None", () =>
            Model.make({
                ...model,
                players: newPlayers,
                state: "roundOver",
                roundWinner: winnerLabel,
                gamePhase: "active"
            })
        ),
        Match.exhaustive
    )
}

const updateGridTimers = (grid: Cell[][]): Cell[][] => {
    return EffectArray.map(grid, row =>
        EffectArray.map(row, cell => {
            if (cell.isDestroying) {
                const newTimer = cell.destroyTimer - 1
                if (newTimer <= 0) {
                    return Cell.make({
                        ...cell,
                        type: "empty",
                        isDestroying: false,
                        destroyTimer: 0
                    })
                }
                return Cell.make({ ...cell, destroyTimer: newTimer })
            }
            return cell
        })
    )
}

const updatePlayerTimers = (player: Player): Player => {
    let updatedPlayer = { ...player }

    if (updatedPlayer.hasVest) {
        updatedPlayer.vestTimer = Math.max(0, updatedPlayer.vestTimer - 1 / FPS)
        if (updatedPlayer.vestTimer <= 0) {
            updatedPlayer.hasVest = false
        }
    }

    const timers = { ...updatedPlayer.rainbowTimers }
    let hasActiveRainbow = false

    if (timers.FireUp > 0) {
        timers.FireUp = Math.max(0, timers.FireUp - 1 / FPS)
        hasActiveRainbow = true
    }
    if (timers.BombUp > 0) {
        timers.BombUp = Math.max(0, timers.BombUp - 1 / FPS)
        hasActiveRainbow = true
    }
    if (timers.SpeedUp > 0) {
        timers.SpeedUp = Math.max(0, timers.SpeedUp - 1 / FPS)
        hasActiveRainbow = true
    }

    if (!hasActiveRainbow) {
        updatedPlayer.bombRange = Math.max(1, updatedPlayer.bombRange - 3)
        updatedPlayer.maxBombs = Math.max(1, updatedPlayer.maxBombs - 3)
        updatedPlayer.speed = Math.max(BASE_SPEED, updatedPlayer.speed - SPEED_INCREMENT * 3)
    }

    return Player.make({ ...updatedPlayer, rainbowTimers: timers })
}

const updateBotAI = (model: Model): Model => {
    return EffectArray.reduce(model.players, {
        ...model,
        players: [],
        bombs: model.bombs
    }, (acc, player) => {
        if (!player.isAlive || player.isHuman) {
            return {
                ...acc,
                players: EffectArray.append(acc.players, player)
            }
        }

        let updatedPlayer = { ...player }
        let currentBombs = acc.bombs

        if (model.currentTime % (FPS / 2) === 0) {
            const directions = ["up", "down", "left", "right"] as const
            const validDirs = directions.filter(dir =>
                isSafeMove(updatedPlayer.position, dir, model)
            )
            if (validDirs.length > 0) {
                updatedPlayer.aiDirection = validDirs[Math.floor(Math.random() * validDirs.length)]
            }

            if (Math.random() < 0.1 && canPlantBomb(updatedPlayer, currentBombs)) {
                const bomb = createBomb(updatedPlayer, model.currentTime)
                if (!isBombAt(bomb.position, currentBombs)) {
                    currentBombs = EffectArray.append(currentBombs, bomb)
                    updatedPlayer.activeBombs = updatedPlayer.activeBombs + 1
                }
            }
        }

        return {
            ...acc,
            players: EffectArray.append(acc.players, Player.make(updatedPlayer)),
            bombs: currentBombs
        }
    })
}

const updatePlayerMovement = (player: Player, keys: Set<string>, model: Model): Player => {
    if (!player.isAlive || model.state !== "playing") return player

    let dRow = 0
    let dCol = 0
    let newDirection = player.direction
    let isMoving = false

    if (player.isHuman) {
        if (player.id === 1) {
            if (keys.has(P1_KEYS.up)) { dRow -= player.speed; newDirection = "up"; isMoving = true }
            if (keys.has(P1_KEYS.down)) { dRow += player.speed; newDirection = "down"; isMoving = true }
            if (keys.has(P1_KEYS.left)) { dCol -= player.speed; newDirection = "left"; isMoving = true }
            if (keys.has(P1_KEYS.right)) { dCol += player.speed; newDirection = "right"; isMoving = true }
        } else if (player.id === 2) {
            if (keys.has(P2_KEYS.up)) { dRow -= player.speed; newDirection = "up"; isMoving = true }
            if (keys.has(P2_KEYS.down)) { dRow += player.speed; newDirection = "down"; isMoving = true }
            if (keys.has(P2_KEYS.left)) { dCol -= player.speed; newDirection = "left"; isMoving = true }
            if (keys.has(P2_KEYS.right)) { dCol += player.speed; newDirection = "right"; isMoving = true }
        }
    } else {
        if (player.aiDirection) {
            switch (player.aiDirection) {
                case "up":
                    dRow -= player.speed;
                    newDirection = "up";
                    isMoving = true;
                    break
                case "down":
                    dRow += player.speed;
                    newDirection = "down";
                    isMoving = true;
                    break
                case "left":
                    dCol -= player.speed;
                    newDirection = "left";
                    isMoving = true;
                    break
                case "right":
                    dCol += player.speed;
                    newDirection = "right";
                    isMoving = true;
                    break
            }
        }
    }

    const newRow = player.position.row + dRow
    const newCol = player.position.col + dCol

    let nextPos = player.position
    if (canMoveTo(newRow, newCol, player.position, model)) {
        nextPos = Position.make({ row: newRow, col: newCol })
    } else if (dRow !== 0 && dCol !== 0) {
        if (canMoveTo(player.position.row + dRow, player.position.col, player.position, model)) {
            nextPos = Position.make({
                row: player.position.row + dRow,
                col: player.position.col
            })
        } else if (canMoveTo(player.position.row, player.position.col + dCol, player.position, model)) {
            nextPos = Position.make({
                row: player.position.row,
                col: player.position.col + dCol
            })
        }
    }

    return Player.make({
        ...player,
        position: nextPos,
        direction: newDirection,
        isMoving
    })
}

const canMoveTo = (row: number, col: number, oldPos: Position, model: Model): boolean => {
    const size = 0.7
    const offset = (1 - size) / 2

    const corners = [
        { r: row + offset, c: col + offset },
        { r: row + offset, c: col + size + offset },
        { r: row + size + offset, c: col + offset },
        { r: row + size + offset, c: col + size + offset }
    ]

    for (const corner of corners) {
        const r = Math.floor(corner.r)
        const c = Math.floor(corner.c)

        if (r < 0 || r >= GRID_ROWS || c < 0 || c >= GRID_COLS) {
            return false
        }

        const cell = model.grid[r][c]

        if (cell.type === "hard" || (cell.type === "soft" && !cell.isDestroying)) {
            return false
        }

        const bombAtCell = EffectArray.findFirst(model.bombs, b =>
            Math.round(b.position.row) === r &&
            Math.round(b.position.col) === c
        )

        if (bombAtCell._tag === "Some") {
            const isOverlapping = doesOverlap(oldPos, r, c)
            if (!isOverlapping) {
                return false
            }
        }
    }

    return true
}

const doesOverlap = (pos: Position, cellR: number, cellC: number): boolean => {
    const playerLeft = pos.col
    const playerRight = pos.col + 1
    const playerTop = pos.row
    const playerBottom = pos.row + 1

    const cellLeft = cellC
    const cellRight = cellC + 1
    const cellTop = cellR
    const cellBottom = cellR + 1

    return !(playerLeft >= cellRight ||
             playerRight <= cellLeft ||
             playerTop >= cellBottom ||
             playerBottom <= cellTop)
}

const isSafeMove = (pos: Position, dir: "up" | "down" | "left" | "right", model: Model): boolean => {
    let r = Math.round(pos.row)
    let c = Math.round(pos.col)

    switch (dir) {
        case "up": r--; break
        case "down": r++; break
        case "left": c--; break
        case "right": c++; break
    }

    if (r < 0 || r >= GRID_ROWS || c < 0 || c >= GRID_COLS) {
        return false
    }

    const cell = model.grid[r][c]
    return cell.type === "empty" &&
           !cell.hasExplosion &&
           !isBombAt(Position.make({ row: r, col: c }), model.bombs)
}

const checkPowerupCollection = (model: Model): Model => {
    const result = EffectArray.reduce(model.players, {
        grid: model.grid,
        players: [] as Player[]
    }, (acc, player) => {
        if (!player.isAlive) {
            return {
                ...acc,
                players: EffectArray.append(acc.players, player)
            }
        }

        const r = Math.round(player.position.row)
        const c = Math.round(player.position.col)
        const cell = acc.grid[r][c]

        if (cell.powerup && !cell.isDestroying && cell.type === "empty") {
            let updatedPlayer = { ...player }
            const powerup = cell.powerup

            switch (powerup) {
                case "FireUp":
                    updatedPlayer.bombRange += 1
                    break

                case "BombUp":
                    updatedPlayer.maxBombs += 1
                    break

                case "SpeedUp":
                    updatedPlayer.speed += SPEED_INCREMENT
                    break

                case "Rainbow":
                    updatedPlayer.rainbowTimers = {
                        FireUp: 10,
                        BombUp: 10,
                        SpeedUp: 10
                    }
                    break

                case "Vest":
                    updatedPlayer.hasVest = true
                    updatedPlayer.vestTimer = 10
                    break
            }

            const newRow = EffectArray.map(acc.grid[r], (cCell, idx) =>
                idx === c ? Cell.make({ ...cCell, powerup: null }) : cCell
            )
            const newGrid = EffectArray.map(acc.grid, (row, idx) =>
                idx === r ? newRow : row
            )

            return {
                grid: newGrid,
                players: EffectArray.append(acc.players, Player.make(updatedPlayer))
            }
        }

        return {
            ...acc,
            players: EffectArray.append(acc.players, player)
        }
    })

    return Model.make({
        ...model,
        grid: result.grid,
        players: result.players
    })
}

const updateBombsAndExplosions = (model: Model): Partial<Model> => {
    let activeExplosions = EffectArray.filter(model.explosions, explosion =>
        (model.currentTime - explosion.createdAt) < FPS * EXPLOSION_DURATION
    )

    const explodingBombIndices: number[] = []
    EffectArray.forEach(model.bombs, (bomb, index) => {
        const r = Math.round(bomb.position.row)
        const c = Math.round(bomb.position.col)

        const timeElapsed = (model.currentTime - bomb.plantedAt) / FPS
        const hitByExplosion = model.grid[r][c].hasExplosion

        if (timeElapsed >= BOMB_TIMER || hitByExplosion) {
            explodingBombIndices.push(index)
        }
    })

    if (explodingBombIndices.length === 0) {
        const activeExplosionCells = new Set(
            EffectArray.flatMap(activeExplosions, e => e.cells)
                .map(p => `${Math.round(p.row)},${Math.round(p.col)}`)
        )

        const newGrid = EffectArray.map(model.grid, (row, r) =>
            EffectArray.map(row, (cell, c) =>
                Cell.make({
                    ...cell,
                    hasExplosion: activeExplosionCells.has(`${r},${c}`)
                })
            )
        )

        return {
            grid: newGrid,
            explosions: activeExplosions
        }
    }

    const newExplosions: Explosion[] = []

    EffectArray.forEach(model.bombs, (bomb, index) => {
        if (!explodingBombIndices.includes(index)) return

        const cells: Position[] = []
        const center = {
            r: Math.round(bomb.position.row),
            c: Math.round(bomb.position.col)
        }

        cells.push(Position.make({ row: center.r, col: center.c }))

        const directions = [
            { dr: 0, dc: 1 },
            { dr: 0, dc: -1 },
            { dr: 1, dc: 0 },
            { dr: -1, dc: 0 }
        ]

        for (const { dr, dc } of directions) {
            for (let k = 1; k <= bomb.range; k++) {
                const r = center.r + dr * k
                const c = center.c + dc * k

                if (r < 0 || r >= GRID_ROWS || c < 0 || c >= GRID_COLS) break

                const cell = model.grid[r][c]

                if (cell.type === "hard") break

                cells.push(Position.make({ row: r, col: c }))

                if (cell.type === "soft" && !cell.isDestroying) break
            }
        }

        newExplosions.push(Explosion.make({
            cells,
            createdAt: model.currentTime
        }))
    })

    const allExplosions = EffectArray.appendAll(activeExplosions, newExplosions)

    const activeExplosionCells = new Set(
        EffectArray.flatMap(allExplosions, e => e.cells)
            .map(p => `${Math.round(p.row)},${Math.round(p.col)}`)
    )

    const newGrid = EffectArray.map(model.grid, (row, r) =>
        EffectArray.map(row, (cell, c) => {
            const isExplosion = activeExplosionCells.has(`${r},${c}`)

            if (isExplosion) {
                if (cell.type === "soft" && !cell.isDestroying) {
                    const spawnPowerup = Math.random() * 100 < settings.powerupSpawnChance
                    let powerup: any = null

                    if (spawnPowerup) {
                        const rand = Math.random()
                        if (rand < 0.2) powerup = "FireUp"
                        else if (rand < 0.4) powerup = "BombUp"
                        else if (rand < 0.6) powerup = "SpeedUp"
                        else if (rand < 0.8) powerup = "Rainbow"
                        else powerup = "Vest"
                    }

                    return Cell.make({
                        ...cell,
                        type: "empty",
                        hasExplosion: true,
                        isDestroying: true,
                        destroyTimer: FPS * DESTRUCTION_DELAY,
                        powerup
                    })
                }

                if (cell.powerup) {
                    return Cell.make({
                        ...cell,
                        hasExplosion: true,
                        powerup: null
                    })
                }

                return Cell.make({
                    ...cell,
                    hasExplosion: true
                })
            }

            return Cell.make({
                ...cell,
                hasExplosion: false
            })
        })
    )

    const remainingBombs = EffectArray.filter(model.bombs, (_, index) =>
        !explodingBombIndices.includes(index)
    )

    const updatedPlayers = EffectArray.map(model.players, player => {
        const bombsExploded = EffectArray.filter(model.bombs, (bomb, index) =>
            bomb.playerId === player.id && explodingBombIndices.includes(index)
        ).length

        if (bombsExploded > 0) {
            return Player.make({
                ...player,
                activeBombs: Math.max(0, player.activeBombs - bombsExploded)
            })
        }
        return player
    })

    return {
        grid: newGrid,
        bombs: remainingBombs,
        explosions: allExplosions,
        players: updatedPlayers
    }
}

const checkDeaths = (model: Model): Model => {
    const updatedPlayers = EffectArray.map(model.players, player => {
        if (!player.isAlive) return player

        const corners = [
            { r: Math.floor(player.position.row + 0.2), c: Math.floor(player.position.col + 0.2) },
            { r: Math.floor(player.position.row + 0.2), c: Math.floor(player.position.col + 0.8) },
            { r: Math.floor(player.position.row + 0.8), c: Math.floor(player.position.col + 0.2) },
            { r: Math.floor(player.position.row + 0.8), c: Math.floor(player.position.col + 0.8) }
        ]

        let isHit = false
        for (const corner of corners) {
            if (corner.r < 0 || corner.r >= GRID_ROWS || corner.c < 0 || corner.c >= GRID_COLS) {
                continue
            }

            if (model.grid[corner.r][corner.c].hasExplosion) {
                isHit = true
                break
            }
        }

        if (isHit && player.hasVest) {
            return Player.make({
                ...player,
                hasVest: false,
                vestTimer: 0
            })
        }

        if (isHit) {
            return Player.make({ ...player, isAlive: false })
        }

        return player
    })

    const alivePlayers = EffectArray.filter(updatedPlayers, p => p.isAlive)
    const deathOccurred = updatedPlayers.length !== alivePlayers.length

    let newDeathTimer = model.deathTimer
    if (deathOccurred && model.deathTimer === null) {
        newDeathTimer = model.currentTime
    }

    if (newDeathTimer !== null) {
        const timeSinceDeath = (model.currentTime - newDeathTimer) / FPS

        if (timeSinceDeath >= 1.0) {
            if (alivePlayers.length === 0) {
                return endRound({ ...model, players: updatedPlayers }, "Draw")
            } else if (alivePlayers.length === 1) {
                return endRound({ ...model, players: updatedPlayers }, alivePlayers[0].label)
            }
            newDeathTimer = null
        }
    }

    return Model.make({
        ...model,
        players: updatedPlayers,
        deathTimer: newDeathTimer
    })
}