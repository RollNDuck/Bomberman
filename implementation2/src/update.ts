import { Match, Array as EffectArray, Option, pipe } from "effect"
import { Msg } from "./msg"
import {
    Model, Player, Bomb, Explosion, Position, Cell, GRID_ROWS, GRID_COLS,
    FPS, BOMB_TIMER, EXPLOSION_DURATION, BASE_SPEED, SPEED_INCREMENT,
    DESTRUCTION_DELAY, WARMUP_SECONDS, createGrid, initModel
} from "./model"
import settings from "./settings"

const P1_KEYS = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", bomb: " " }
const P2_KEYS = { up: "w", down: "s", left: "a", right: "d", bomb: "x" }

// ==================== MAIN UPDATE ====================
export const update = (msg: Msg, model: Model): Model => {
    return Match.value(msg).pipe(
        Match.tag("KeyDown", ({ key }) => handleKeyDown(key, model)),
        Match.tag("KeyUp", ({ key }) => handleKeyUp(key, model)),
        Match.tag("Tick", () => handleTick(model)),
        Match.tag("RestartGame", () => handleRestartGame()),
        Match.tag("StartNextRound", () => handleStartNextRound(model)),
        Match.exhaustive
    )
}

const handleKeyDown = (key: string, model: Model): Model => {
    if (key === "Escape") {
        if (model.state === "roundOver" || model.state === "matchOver") {
            // Phase 5: Start next round on Escape, DO NOT toggle debug mode
            return model.state === "matchOver" ? handleRestartGame() : handleStartNextRound(model)
        }
        // Toggle debug mode only if game is active/warmup
        return { ...model, isDebugMode: !model.isDebugMode }
    }

    if ((key === "r" || key === "R") && (model.state === "roundOver" || model.state === "matchOver")) {
        return model.state === "matchOver" ? handleRestartGame() : handleStartNextRound(model)
    }
    if (model.state !== "playing") return model

    const newKeys = new Set(model.keys)
    newKeys.add(key)

    let newBombs = [...model.bombs]
    const newPlayers = model.players.map(player => {
        if (!player.isHuman || !player.isAlive) return player
        const bombKey = player.id === 1 ? P1_KEYS.bomb : P2_KEYS.bomb
        if (key === bombKey && player.activeBombs < player.maxBombs) {
            const bombPos = Position.make({ row: Math.round(player.position.row), col: Math.round(player.position.col) })
            if (!newBombs.some(b => Math.round(b.position.row) === bombPos.row && Math.round(b.position.col) === bombPos.col)) {
                newBombs.push(Bomb.make({ position: bombPos, plantedAt: model.currentTime, range: player.bombRange, playerId: player.id }))
                return { ...player, activeBombs: player.activeBombs + 1 }
            }
        }
        return player
    })
    return { ...model, keys: newKeys, players: newPlayers, bombs: newBombs }
}

const handleKeyUp = (key: string, model: Model): Model => {
    const newKeys = new Set(model.keys)
    newKeys.delete(key)
    return { ...model, keys: newKeys }
}

const handleTick = (model: Model): Model => {
    if (model.state === "warmup") {
        return model.roundTimer <= 1
            ? { ...model, state: "playing", roundTimer: settings.timerSeconds * FPS, currentTime: model.currentTime + 1 }
            : { ...model, roundTimer: model.roundTimer - 1, currentTime: model.currentTime + 1 }
    }
    if (model.state !== "playing") return { ...model, currentTime: model.currentTime + 1 }
    if (model.roundTimer <= 0) return endRound(model, "Draw")

    const nextTime = model.currentTime + 1
    const nextGrid = model.grid.map(row => row.map(cell =>
        cell.isDestroying && cell.destroyTimer > 0
            ? Cell.make({ ...cell, type: cell.destroyTimer === 1 ? "empty" : cell.type, isDestroying: cell.destroyTimer > 1, destroyTimer: cell.destroyTimer - 1 })
            : cell
    ))

    const playersWithTimers = model.players.map(updatePlayerTimers)
    const intermediateModel = { ...model, grid: nextGrid, players: playersWithTimers, currentTime: nextTime }

    // AI Update
    const { players: playersWithAI, bombs: bombsAfterAI } = updateBotAI(intermediateModel)

    // Movement Update
    const movedPlayers = playersWithAI.map(player => updatePlayerMovement(player, model.keys, { ...intermediateModel, players: playersWithAI }))

    const afterPowerups = checkPowerupCollection({ ...intermediateModel, players: movedPlayers, bombs: bombsAfterAI })
    const afterExplosions = updateBombsAndExplosions(afterPowerups)
    return { ...checkDeaths(afterExplosions), roundTimer: model.roundTimer - 1 }
}

// ==================== AI CORE ====================
type PathNode = { position: Position; distance: number; previous: Option.Option<Position>; visited: boolean }

const getReachableCells = (start: Position, model: Model, ignoreSoftBlocks: boolean): boolean[][] => {
    const reachable = Array.from({ length: GRID_ROWS }, () => Array(GRID_COLS).fill(false))
    const sR = Math.round(start.row), sC = Math.round(start.col)

    if (sR < 0 || sR >= GRID_ROWS || sC < 0 || sC >= GRID_COLS) return reachable

    const queue: { r: number, c: number }[] = [{ r: sR, c: sC }]
    reachable[sR][sC] = true

    while (queue.length > 0) {
        const { r, c } = queue.shift()!
        const neighbors = [{ r: -1, c: 0 }, { r: 1, c: 0 }, { r: 0, c: -1 }, { r: 0, c: 1 }]

        for (const off of neighbors) {
            const nR = r + off.r, nC = c + off.c
            if (nR >= 0 && nR < GRID_ROWS && nC >= 0 && nC < GRID_COLS && !reachable[nR][nC]) {
                const cell = model.grid[nR][nC]
                const isSoft = cell.type === "soft" && !cell.isDestroying
                const isHard = cell.type === "hard"
                const hasBomb = model.bombs.some(b => Math.round(b.position.row) === nR && Math.round(b.position.col) === nC)

                if (!isHard && (!hasBomb) && (ignoreSoftBlocks || !isSoft)) {
                    reachable[nR][nC] = true
                    queue.push({ r: nR, c: nC })
                }
            }
        }
    }
    return reachable
}

const findShortestPath = (start: Position, goal: Position, model: Model, ignoreSoftBlocks: boolean): Position[] => {
    const sR = Math.round(start.row), sC = Math.round(start.col)
    const gR = Math.round(goal.row), gC = Math.round(goal.col)
    if (gR < 0 || gR >= GRID_ROWS || gC < 0 || gC >= GRID_COLS) return []

    const nodes: PathNode[][] = Array.from({ length: GRID_ROWS }, (_, r) =>
        Array.from({ length: GRID_COLS }, (_, c) => ({
            position: Position.make({ row: r, col: c }), distance: Infinity, previous: Option.none(), visited: false
        }))
    )

    nodes[sR][sC].distance = 0
    let unvisited = [nodes[sR][sC]]

    while (unvisited.length > 0) {
        unvisited.sort((a, b) => a.distance - b.distance)
        const current = unvisited.shift()!
        if (current.visited) continue
        current.visited = true

        if (current.position.row === gR && current.position.col === gC) {
            const path: Position[] = []
            let curr = Option.some(current)
            while (Option.isSome(curr)) {
                const node = curr.value
                path.unshift(node.position)
                curr = Option.isSome(node.previous) ? Option.some(nodes[node.previous.value.row][node.previous.value.col]) : Option.none()
            }
            return path
        }

        const neighbors = [{ r: -1, c: 0 }, { r: 1, c: 0 }, { r: 0, c: -1 }, { r: 0, c: 1 }]
        for (const off of neighbors) {
            const nR = current.position.row + off.r, nC = current.position.col + off.c
            if (nR >= 0 && nR < GRID_ROWS && nC >= 0 && nC < GRID_COLS) {
                const cell = model.grid[nR][nC]
                const hasBomb = model.bombs.some(b => Math.round(b.position.row) === nR && Math.round(b.position.col) === nC)
                const walkable = cell.type !== "hard" &&
                                 (ignoreSoftBlocks || cell.type !== "soft" || cell.isDestroying) &&
                                 !hasBomb

                if (walkable) {
                    const nNode = nodes[nR][nC]
                    if (current.distance + 1 < nNode.distance) {
                        nNode.distance = current.distance + 1
                        nNode.previous = Option.some(current.position)
                        if (!nNode.visited) unvisited.push(nNode)
                    }
                }
            }
        }
    }
    return []
}

const manhattanDistance = (p1: Position, p2: Position) => Math.abs(Math.round(p1.row) - Math.round(p2.row)) + Math.abs(Math.round(p1.col) - Math.round(p2.col))

const updateBotAI = (model: Model): { players: Player[], bombs: Bomb[] } => {
    let newBombs = [...model.bombs]
    const explosionEnded = model.explosions.some(e => (model.currentTime - e.createdAt) >= (FPS * EXPLOSION_DURATION) - 1)
    const newBombPositions = newBombs.filter(b => b.plantedAt === model.currentTime).map(b => b.position)

    const newPlayers = model.players.map(player => {
        if (!player.isAlive || player.isHuman || !player.botType) return player

        const timeSinceReeval = (model.currentTime - player.lastReevaluation) / FPS
        let shouldReeval = false

        if (explosionEnded) shouldReeval = true
        if (!shouldReeval && newBombPositions.some(pos => manhattanDistance(player.position, pos) <= 5)) {
            shouldReeval = true
        }

        if (!shouldReeval && player.botState !== "ESCAPE") {
            if (timeSinceReeval >= player.reevaluationInterval && Math.random() < player.reevaluationChance) {
                shouldReeval = true
            }
        }

        let updated = player
        if (shouldReeval || !player.botState) {
            updated = performReevaluation(player, model)
            updated = { ...updated, lastReevaluation: model.currentTime }
        }
        updated = executeBotState(updated, model)

        // BOMB PLANTING FIX: Check if current position already has a bomb
        if (shouldPlantBomb(updated, model) && updated.activeBombs < updated.maxBombs) {
            const bPos = Position.make({ row: Math.round(updated.position.row), col: Math.round(updated.position.col) })

            // Explicitly check current position for bomb before planting
            const bombExists = newBombs.some(b =>
                Math.round(b.position.row) === bPos.row &&
                Math.round(b.position.col) === bPos.col
            )

            if (!bombExists) {
                newBombs.push(Bomb.make({ position: bPos, plantedAt: model.currentTime, range: updated.bombRange, playerId: updated.id }))
                updated = { ...updated, activeBombs: updated.activeBombs + 1 }
            }
        }
        return updated
    })
    return { players: newPlayers, bombs: newBombs }
}

const performReevaluation = (player: Player, model: Model): Player => {
    if (isInDanger(player, model)) {
        const safeGoal = findSafeGoal(player, model)
        const path = safeGoal.row !== -1 ? findShortestPath(player.position, safeGoal, model, false) : []
        if (path.length === 0 && safeGoal.row !== -1) {
             const randomGoal = findRandomGoal(model)
             const randPath = randomGoal.row !== -1 ? findShortestPath(player.position, randomGoal, model, true) : []
             return { ...player, botState: "WANDER", botGoal: randomGoal, botPath: randPath }
        }
        return { ...player, botState: "ESCAPE", botGoal: safeGoal, botPath: path }
    }
    const powerupGoal = findPowerupGoal(player, model)
    if (Option.isSome(powerupGoal)) {
        const path = findShortestPath(player.position, powerupGoal.value, model, false)
        return { ...player, botState: "GET_POWERUP", botGoal: powerupGoal.value, botPath: path }
    }
    const attackGoal = findAttackGoal(player, model)
    if (Option.isSome(attackGoal)) {
        const path = findShortestPath(player.position, attackGoal.value, model, player.attackPolicy === "second")
        return { ...player, botState: "ATTACK", botGoal: attackGoal.value, botPath: path }
    }
    const randomGoal = findRandomGoal(model)
    const path = randomGoal.row !== -1 ? findShortestPath(player.position, randomGoal, model, true) : []
    return { ...player, botState: "WANDER", botGoal: randomGoal, botPath: path }
}

const executeBotState = (player: Player, model: Model): Player => {
    const goalR = Math.round(player.botGoal.row), goalC = Math.round(player.botGoal.col)
    const validGoal = goalR >= 0 && goalR < GRID_ROWS && goalC >= 0 && goalC < GRID_COLS

    if (player.botState === "WANDER" && (!validGoal || (Math.round(player.position.row) === goalR && Math.round(player.position.col) === goalC) || player.botPath.length === 0)) return performReevaluation(player, model)

    if (player.botState === "ESCAPE") {
        if (!isInDanger(player, model)) return performReevaluation(player, model)
        if (!validGoal || player.botPath.length === 0) return performReevaluation(player, model)
        return player
    }

    if (player.botState === "GET_POWERUP" && (!validGoal || !model.grid[goalR][goalC].powerup || player.botPath.length === 0)) return performReevaluation(player, model)
    if (player.botState === "ATTACK" && (!validGoal || player.botPath.length === 0)) return performReevaluation(player, model)

    return player
}

const findSafeGoal = (player: Player, model: Model): Position => {
    const reachable = getReachableCells(player.position, model, false)
    const safeSpots: Position[] = []
    for (let r = 0; r < GRID_ROWS; r++) {
        for (let c = 0; c < GRID_COLS; c++) {
            if (reachable[r][c] && !isCellDangerous(r, c, model, player)) {
                safeSpots.push(Position.make({ row: r, col: c }))
            }
        }
    }
    return safeSpots.length > 0 ? safeSpots[Math.floor(Math.random() * safeSpots.length)] : Position.make({ row: -1, col: -1 })
}

const findPowerupGoal = (player: Player, model: Model): Option.Option<Position> => {
    if (Math.random() > player.powerupPolicyChance) {
        return Option.none()
    }

    const reachable = getReachableCells(player.position, model, false)
    const powerups: Position[] = []
    for (let r = 0; r < GRID_ROWS; r++) {
        for (let c = 0; c < GRID_COLS; c++) {
            if (model.grid[r][c].powerup && reachable[r][c]) {
                powerups.push(Position.make({ row: r, col: c }))
            }
        }
    }
    if (powerups.length === 0) return Option.none()

    if (player.powerupPolicy === "first") {
        let best = powerups[0], minDist = Infinity
        for (const p of powerups) {
            const dist = manhattanDistance(player.position, p)
            if (dist < minDist) { minDist = dist; best = p }
        }
        return Option.some(best)
    } else {
        const nearby = powerups.filter(p => manhattanDistance(player.position, p) <= 4)
        return nearby.length > 0 ? Option.some(nearby[Math.floor(Math.random() * nearby.length)]) : Option.none()
    }
}

const findAttackGoal = (player: Player, model: Model): Option.Option<Position> => {
    const enemies = model.players.filter(p => p.id !== player.id && p.isAlive)
    if (enemies.length === 0) return Option.none()

    const ignoreSoft = player.attackPolicy === "second"
    const reachable = getReachableCells(player.position, model, ignoreSoft)

    if (player.attackPolicy === "first") {
        for (const enemy of enemies) {
            const ePos = Position.make({ row: Math.round(enemy.position.row), col: Math.round(enemy.position.col) })
            if (manhattanDistance(player.position, ePos) <= player.attackTargetDistance && reachable[Math.round(ePos.row)][Math.round(ePos.col)]) {
                return Option.some(ePos)
            }
        }
        return Option.none()
    } else {
        const enemy = enemies[Math.floor(Math.random() * enemies.length)]
        return Option.some(Position.make({ row: Math.round(enemy.position.row), col: Math.round(enemy.position.col) }))
    }
}

const findRandomGoal = (model: Model): Position => {
    for(let i=0; i<50; i++) {
        const r = Math.floor(Math.random() * GRID_ROWS), c = Math.floor(Math.random() * GRID_COLS)
        if (model.grid[r][c].type !== "hard") return Position.make({ row: r, col: c })
    }
    return Position.make({ row: -1, col: -1 })
}

const updatePlayerMovement = (player: Player, keys: Set<string>, model: Model): Player => {
    if (!player.isAlive || model.state !== "playing") return player

    let nextPos = player.position
    let newDirection = player.direction
    let isMoving = false
    let newBotPath = player.botPath
    let newAiDirection = player.aiDirection

    if (player.isHuman) {
        let dRow = 0, dCol = 0
        const k = player.id === 1 ? P1_KEYS : P2_KEYS
        if (keys.has(k.up)) { dRow -= player.speed; newDirection = "up"; isMoving = true }
        if (keys.has(k.down)) { dRow += player.speed; newDirection = "down"; isMoving = true }
        if (keys.has(k.left)) { dCol -= player.speed; newDirection = "left"; isMoving = true }
        if (keys.has(k.right)) { dCol += player.speed; newDirection = "right"; isMoving = true }

        if (canMoveTo(nextPos.row + dRow, nextPos.col + dCol, player, model)) nextPos = Position.make({ row: nextPos.row + dRow, col: nextPos.col + dCol })
        else if (dRow !== 0 && canMoveTo(nextPos.row + dRow, nextPos.col, player, model)) nextPos = Position.make({ row: nextPos.row + dRow, col: nextPos.col })
        else if (dCol !== 0 && canMoveTo(nextPos.row, nextPos.col + dCol, player, model)) nextPos = Position.make({ row: nextPos.row, col: nextPos.col + dCol })

    } else {
        if (player.botPath.length > 0) {
            isMoving = true
            const target = player.botPath[0]
            const dx = target.col - player.position.col
            const dy = target.row - player.position.row
            const dist = Math.sqrt(dx*dx + dy*dy)

            if (Math.abs(dy) > Math.abs(dx)) newAiDirection = dy < 0 ? "up" : "down"
            else newAiDirection = dx < 0 ? "left" : "right"
            newDirection = newAiDirection as any

            if (dist <= player.speed) {
                if (canMoveTo(target.row, target.col, player, model)) {
                     nextPos = target
                     newBotPath = player.botPath.slice(1)
                     if (newBotPath.length === 0) isMoving = false
                } else {
                    isMoving = false
                }
            } else {
                const moveX = (dx / dist) * player.speed
                const moveY = (dy / dist) * player.speed
                const nextR = player.position.row + moveY
                const nextC = player.position.col + moveX

                if (canMoveTo(nextR, nextC, player, model)) {
                     nextPos = Position.make({ row: nextR, col: nextC })
                } else {
                     isMoving = false
                }
            }
        } else {
            newAiDirection = null
            isMoving = false
        }
    }

    return { ...player, position: nextPos, direction: newDirection, isMoving, botPath: newBotPath, aiDirection: newAiDirection }
}

const canMoveTo = (row: number, col: number, player: Player, model: Model): boolean => {
    const pw = 0.7, ph = 0.7, ox = (1 - pw) / 2, oy = (1 - ph) / 2
    const corners = [{ x: col + ox, y: row + oy }, { x: col + ox + pw, y: row + oy }, { x: col + ox, y: row + oy + ph }, { x: col + ox + pw, y: row + oy + ph }]
    for (const p of corners) {
        const cX = Math.floor(p.x), cY = Math.floor(p.y)
        if (cY < 0 || cY >= GRID_ROWS || cX < 0 || cX >= GRID_COLS) return false
        const cell = model.grid[cY][cX]
        if (cell.type === "hard" || (cell.type === "soft" && !cell.isDestroying)) return false
    }
    const dL = col + ox, dR = col + ox + pw, dT = row + oy, dB = row + oy + ph
    const cL = player.position.col + ox, cR = player.position.col + ox + pw, cT = player.position.row + oy, cB = player.position.row + oy + ph

    for (const b of model.bombs) {
        const bR = Math.round(b.position.row), bC = Math.round(b.position.col)
        const bL = bC, bR_b = bC + 1, bT = bR, bB = bR + 1
        if (!(dR <= bL || dL >= bR_b || dB <= bT || dT >= bB)) {
            if (!(cR <= bL || cL >= bR_b || cB <= bT || cT >= bB)) continue
            return false
        }
    }
    return true
}

const shouldPlantBomb = (player: Player, model: Model): boolean => {
    if (player.botState === "ATTACK") {
        for (const e of model.players) {
            if (e.id !== player.id && e.isAlive && manhattanDistance(player.position, e.position) <= player.attackPlantDistance) return true
        }
    }

    if (player.botPath.length > 0) {
        const next = player.botPath[0]
        const r = Math.round(next.row), c = Math.round(next.col)
        if (r >= 0 && r < GRID_ROWS && c >= 0 && c < GRID_COLS) {
            const cell = model.grid[r][c]

            // FIX: Check if current position has a bomb before planting
            const currentHasBomb = model.bombs.some(b =>
                Math.round(b.position.row) === Math.round(player.position.row) &&
                Math.round(b.position.col) === Math.round(player.position.col)
            )

            if (cell.type === "soft" && !cell.isDestroying && !currentHasBomb) return true
        }
    }
    return false
}

const isInDanger = (player: Player, model: Model): boolean => {
    const pR = Math.round(player.position.row), pC = Math.round(player.position.col)
    if (model.grid[pR][pC].hasExplosion) return true
    const range = player.dangerCheckDistance
    for (let dr = -range; dr <= range; dr++) {
        for (let dc = -range; dc <= range; dc++) {
            if (Math.abs(dr) + Math.abs(dc) > range) continue
            const cR = pR + dr, cC = pC + dc
            if (cR >= 0 && cR < GRID_ROWS && cC >= 0 && cC < GRID_COLS && isCellDangerous(cR, cC, model, player)) return true
        }
    }
    return false
}

const isCellDangerous = (r: number, c: number, model: Model, player: Player): boolean => {
    if (model.grid[r][c].hasExplosion) return true
    if (player.dangerDetectionPolicy === "bombs_only") {
        return model.bombs.some(b => Math.round(b.position.row) === r && Math.round(b.position.col) === c)
    } else {
        return model.bombs.some(b => isInExplosionRange(r, c, Math.round(b.position.row), Math.round(b.position.col), b.range, model.grid))
    }
}

const isInExplosionRange = (tR: number, tC: number, bR: number, bC: number, range: number, grid: Cell[][]): boolean => {
    if (tR === bR && tC === bC) return true
    if (tR === bR && Math.abs(tC - bC) <= range) {
        const step = tC > bC ? 1 : -1
        for (let c = bC + step; c !== tC + step; c += step) {
            if (c < 0 || c >= GRID_COLS || grid[tR][c].type === "hard") return false
            if (grid[tR][c].type === "soft" && !grid[tR][c].isDestroying) return c === tC
        }
        return true
    }
    if (tC === bC && Math.abs(tR - bR) <= range) {
        const step = tR > bR ? 1 : -1
        for (let r = bR + step; r !== tR + step; r += step) {
            if (r < 0 || r >= GRID_ROWS || grid[r][tC].type === "hard") return false
            if (grid[r][tC].type === "soft" && !grid[r][tC].isDestroying) return r === tR
        }
        return true
    }
    return false
}

const updatePlayerTimers = (p: Player): Player => {
    let u = p
    if (u.hasVest) u = { ...u, vestTimer: Math.max(0, u.vestTimer - 1/FPS), hasVest: u.vestTimer > 1/FPS }

    let { FireUp, BombUp, SpeedUp } = u.rainbowTimers
    let active = false
    if (FireUp > 0) { FireUp = Math.max(0, FireUp - 1/FPS); active = true }
    if (BombUp > 0) { BombUp = Math.max(0, BombUp - 1/FPS); active = true }
    if (SpeedUp > 0) { SpeedUp = Math.max(0, SpeedUp - 1/FPS); active = true }

    if (!active && (u.rainbowTimers.FireUp > 0 || u.rainbowTimers.BombUp > 0 || u.rainbowTimers.SpeedUp > 0)) {
        u = { ...u, bombRange: Math.max(1, u.bombRange - 3), maxBombs: Math.max(1, u.maxBombs - 3), speed: Math.max(BASE_SPEED, u.speed - SPEED_INCREMENT * 3) }
    }
    return { ...u, rainbowTimers: { FireUp, BombUp, SpeedUp } }
}

const checkPowerupCollection = (model: Model): Model => {
    const newPlayers = model.players.map(p => {
        if (!p.isAlive) return p
        const r = Math.round(p.position.row), c = Math.round(p.position.col)
        if (r < 0 || r >= GRID_ROWS || c < 0 || c >= GRID_COLS) return p
        const cell = model.grid[r][c]
        if (cell.powerup && !cell.isDestroying && cell.type === "empty") {
            let u = p
            if (cell.powerup === "FireUp") u = { ...u, bombRange: u.bombRange + 1 }
            else if (cell.powerup === "BombUp") u = { ...u, maxBombs: u.maxBombs + 1 }
            else if (cell.powerup === "SpeedUp") u = { ...u, speed: u.speed + SPEED_INCREMENT }
            else if (cell.powerup === "Rainbow") u = { ...u, rainbowTimers: { FireUp: 10, BombUp: 10, SpeedUp: 10 }, bombRange: u.bombRange + 3, maxBombs: u.maxBombs + 3, speed: u.speed + SPEED_INCREMENT * 3 }
            else if (cell.powerup === "Vest") u = { ...u, hasVest: true, vestTimer: 10 }
            return u
        }
        return p
    })
    const newGrid = model.grid.map((row, r) => row.map((cell, c) => {
        return newPlayers.some(p => Math.round(p.position.row) === r && Math.round(p.position.col) === c && model.grid[r][c].powerup) ? Cell.make({ ...cell, powerup: null }) : cell
    }))
    return { ...model, players: newPlayers, grid: newGrid }
}

const updateBombsAndExplosions = (model: Model): Model => {
    const activeExps = model.explosions.filter(e => (model.currentTime - e.createdAt) < FPS * EXPLOSION_DURATION)
    const explodedIndices: number[] = []
    const newExps: Explosion[] = []

    model.bombs.forEach((b, i) => {
        const r = Math.round(b.position.row), c = Math.round(b.position.col)
        if ((model.currentTime - b.plantedAt)/FPS >= BOMB_TIMER || model.grid[r][c].hasExplosion) {
            explodedIndices.push(i)
            const cells = [Position.make({ row: r, col: c })]
            for (const d of [{r:0,c:1}, {r:0,c:-1}, {r:1,c:0}, {r:-1,c:0}]) {
                for (let k = 1; k <= b.range; k++) {
                    const nr = r + d.r * k, nc = c + d.c * k
                    if (nr < 0 || nr >= GRID_ROWS || nc < 0 || nc >= GRID_COLS) break
                    const cell = model.grid[nr][nc]
                    if (cell.type === "hard") break
                    cells.push(Position.make({ row: nr, col: nc }))
                    if (cell.type === "soft" && !cell.isDestroying) break
                }
            }
            newExps.push(Explosion.make({ cells, createdAt: model.currentTime }))
        }
    })

    const allExps = [...activeExps, ...newExps]
    const expSet = new Set(allExps.flatMap(e => e.cells.map(p => `${Math.round(p.row)},${Math.round(p.col)}`)))
    const newGrid = model.grid.map((row, r) => row.map((cell, c) => {
        if (expSet.has(`${r},${c}`)) {
            if (cell.type === "soft" && !cell.isDestroying) {
                const spawn = Math.random() * 100 < settings.powerupSpawnChance
                let pup: any = null
                if (spawn) {
                    const rnd = Math.random()
                    pup = rnd < 0.3 ? "FireUp" : rnd < 0.6 ? "BombUp" : rnd < 0.9 ? "SpeedUp" : rnd < 0.95 ? "Rainbow" : "Vest"
                }
                return Cell.make({ ...cell, hasExplosion: true, isDestroying: true, destroyTimer: FPS * DESTRUCTION_DELAY, powerup: pup })
            }
            if (cell.type === "empty" && !cell.isDestroying && cell.powerup) {
                 return Cell.make({ ...cell, hasExplosion: true, powerup: null })
            }
            return Cell.make({ ...cell, hasExplosion: true })
        }
        return Cell.make({ ...cell, hasExplosion: false })
    }))

    const remBombs = model.bombs.filter((_, i) => !explodedIndices.includes(i))
    const newPlayers = model.players.map(p => {
        const count = explodedIndices.filter(i => model.bombs[i].playerId === p.id).length
        return count > 0 ? { ...p, activeBombs: Math.max(0, p.activeBombs - count) } : p
    })

    return { ...model, grid: newGrid, bombs: remBombs, explosions: allExps, players: newPlayers }
}

const checkDeaths = (model: Model): Model => {
    const newPlayers = model.players.map(p => {
        if (!p.isAlive) return p
        const r = p.position.row, c = p.position.col
        // 4 corners check
        const hit = [{x:c+0.2,y:r+0.2}, {x:c+0.8,y:r+0.2}, {x:c+0.2,y:r+0.8}, {x:c+0.8,y:r+0.8}]
            .some(pt => {
                const cr = Math.floor(pt.y), cc = Math.floor(pt.x)
                return cr >= 0 && cr < GRID_ROWS && cc >= 0 && cc < GRID_COLS && model.grid[cr][cc].hasExplosion
            })
        if (hit) {
            if (p.hasVest) return { ...p, hasVest: false, vestTimer: 0 }
            return { ...p, isAlive: false }
        }
        return p
    })
    const alive = newPlayers.filter(p => p.isAlive)

    if (alive.length <= 1 && model.players.length > 1 && model.state === "playing") {
        if (model.deathTimer === null) {
            return { ...model, players: newPlayers, deathTimer: 30 } // 1 second delay
        } else if (model.deathTimer > 0) {
            return { ...model, players: newPlayers, deathTimer: model.deathTimer - 1 }
        } else {
            return endRound({ ...model, players: newPlayers }, alive.length === 1 ? alive[0].label : "Draw")
        }
    }

    if (alive.length > 1) {
        return { ...model, players: newPlayers, deathTimer: null }
    }

    return { ...model, players: newPlayers }
}

const endRound = (model: Model, winner: string): Model => {
    const newPlayers = model.players.map(p => p.label === winner ? { ...p, wins: p.wins + 1 } : p)
    const matchWinner = newPlayers.find(p => p.wins >= model.roundsToWin)
    return { ...model, players: newPlayers, state: matchWinner ? "matchOver" : "roundOver", roundWinner: winner, gamePhase: "gameOver", gameOverMessage: matchWinner ? `${winner} WINS MATCH!` : `${winner} WINS ROUND!`, deathTimer: null }
}

const handleRestartGame = (): Model => ({ ...initModel, grid: createGrid(), state: "warmup" })
const handleStartNextRound = (model: Model): Model => ({
    ...model, grid: createGrid(),
    players: model.players.map((p, i) => ({
        ...p, position: initModel.players[i].position, startPosition: initModel.players[i].position,
        isAlive: true, activeBombs: 0, speed: BASE_SPEED, bombRange: 1, maxBombs: 1, hasVest: false, vestTimer: 0,
        rainbowTimers: { FireUp: 0, BombUp: 0, SpeedUp: 0 }, direction: "down", isMoving: false,
        botState: p.botType ? "WANDER" : null, botGoal: Position.make({ row: -1, col: -1 }), botPath: [], lastReevaluation: 0, aiDirection: null
    })),
    bombs: [], explosions: [], state: "warmup", roundTimer: WARMUP_SECONDS * FPS, roundNumber: model.roundNumber + 1, isDebugMode: false, deathTimer: null, gamePhase: "active", gameOverMessage: ""
})