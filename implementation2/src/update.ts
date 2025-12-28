import { Match, Array as EffectArray, Option, pipe } from "effect"
import { Msg } from "./msg"
import {
    Model, Player, Bomb, Explosion, Position, Cell, GRID_ROWS, GRID_COLS,
    FPS, BOMB_TIMER, EXPLOSION_DURATION, BASE_SPEED, SPEED_INCREMENT,
    DESTRUCTION_DELAY, WARMUP_SECONDS, createGrid, initModel
} from "./model"

// ==================== SETTINGS & CONSTANTS ====================
const settings = {
    softBlockSpawnChance: 40,
    powerupSpawnChance: 30,
    timerSeconds: 180,
    humanPlayers: 1,
    botTypes: ["hostile", "careful", "greedy", "extreme"],
    roundsToWin: 3
}

const P1_KEYS = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", bomb: " " }
const P2_KEYS = { up: "w", down: "s", left: "a", right: "d", bomb: "x" }

// ==================== MAIN UPDATE FUNCTION ====================
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

// ==================== KEY HANDLERS ====================
const handleKeyDown = (key: string, model: Model): Model => {
    if (key === "Escape") {
        return { ...model, isDebugMode: !model.isDebugMode }
    }

    if ((key === "r" || key === "R") && (model.state === "roundOver" || model.state === "matchOver")) {
        return model.state === "matchOver" ? handleRestartGame() : handleStartNextRound(model)
    }

    if (model.state !== "playing") return model

    const newKeys = new Set(model.keys)
    newKeys.add(key)

    // Handle bomb planting for human players
    let newBombs = [...model.bombs]
    const newPlayers = model.players.map(player => {
        if (!player.isHuman || !player.isAlive) return player

        const bombKey = player.id === 1 ? P1_KEYS.bomb : P2_KEYS.bomb
        if (key === bombKey && player.activeBombs < player.maxBombs) {
            const bombPos = Position.make({
                row: Math.round(player.position.row),
                col: Math.round(player.position.col)
            })

            // Check if there's already a bomb at this position
            const bombAlreadyExists = newBombs.some(bomb =>
                Math.round(bomb.position.row) === bombPos.row &&
                Math.round(bomb.position.col) === bombPos.col
            )

            if (!bombAlreadyExists) {
                newBombs.push(Bomb.make({
                    position: bombPos,
                    plantedAt: model.currentTime,
                    range: player.bombRange,
                    playerId: player.id
                }))

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

// ==================== TICK HANDLER ====================
const handleTick = (model: Model): Model => {
    // Handle warmup countdown
    if (model.state === "warmup") {
        if (model.roundTimer <= 1) {
            return {
                ...model,
                state: "playing",
                roundTimer: settings.timerSeconds * FPS,
                currentTime: model.currentTime + 1
            }
        }
        return {
            ...model,
            roundTimer: model.roundTimer - 1,
            currentTime: model.currentTime + 1
        }
    }

    // Don't update game logic if round/match is over
    if (model.state !== "playing") {
        return { ...model, currentTime: model.currentTime + 1 }
    }

    // Check for timeout
    if (model.roundTimer <= 0) {
        return endRound(model, "Draw")
    }

    const nextTime = model.currentTime + 1

    // Update grid timers
    const nextGrid = EffectArray.map(model.grid, row =>
        EffectArray.map(row, cell => {
            if (cell.isDestroying && cell.destroyTimer > 0) {
                if (cell.destroyTimer === 1) {
                    return Cell.make({
                        ...cell,
                        type: "empty",
                        isDestroying: false,
                        destroyTimer: 0
                    })
                }
                return Cell.make({ ...cell, destroyTimer: cell.destroyTimer - 1 })
            }
            return cell
        })
    )

    // Update player timers
    const playersWithTimers = model.players.map(player => updatePlayerTimers(player))

    // Create intermediate model for bot AI
    const intermediateModel = {
        ...model,
        grid: nextGrid,
        players: playersWithTimers,
        currentTime: nextTime
    }

    // Update bot AI
    const { players: playersWithAI, bombs: bombsAfterAI } = updateBotAI(intermediateModel)

    // Update player movement
    const movedPlayers = playersWithAI.map(player =>
        updatePlayerMovement(player, model.keys, { ...intermediateModel, players: playersWithAI })
    )

    // Check for powerup collection
    const afterPowerups = checkPowerupCollection({
        ...intermediateModel,
        players: movedPlayers,
        bombs: bombsAfterAI
    })

    // Update bombs and explosions
    const afterExplosions = updateBombsAndExplosions(afterPowerups)

    // Check for deaths
    const finalModel = checkDeaths(afterExplosions)

    return {
        ...finalModel,
        roundTimer: model.roundTimer - 1
    }
}

// ==================== BOT AI FUNCTIONS ====================
type PathNode = {
    position: Position
    distance: number
    previous: Option.Option<Position>
    visited: boolean
}

const findShortestPath = (
    start: Position,
    goal: Position,
    grid: Cell[][],
    ignoreSoftBlocks: boolean = false
): Position[] => {
    if (goal.row < 0 || goal.row >= GRID_ROWS || goal.col < 0 || goal.col >= GRID_COLS) {
        return []
    }

    const nodes: PathNode[][] = EffectArray.makeBy(GRID_ROWS, (r) =>
        EffectArray.makeBy(GRID_COLS, (c) => ({
            position: Position.make({ row: r, col: c }),
            distance: Infinity,
            previous: Option.none(),
            visited: false
        }))
    )

    const isWalkable = (r: number, c: number): boolean => {
        if (r < 0 || r >= GRID_ROWS || c < 0 || c >= GRID_COLS) return false
        const cell = grid[r][c]
        if (cell.type === "hard") return false
        if (!ignoreSoftBlocks && cell.type === "soft" && !cell.isDestroying) return false
        return true
    }

    const sR = Math.round(start.row), sC = Math.round(start.col)
    const gR = Math.round(goal.row), gC = Math.round(goal.col)

    if (!isWalkable(sR, sC) || !isWalkable(gR, gC)) return []

    nodes[sR][sC].distance = 0
    let unvisited: PathNode[] = [nodes[sR][sC]]

    while (unvisited.length > 0) {
        unvisited.sort((a, b) => a.distance - b.distance)
        const current = unvisited.shift()!

        if (current.visited) continue
        current.visited = true

        if (current.position.row === gR && current.position.col === gC) {
            return reconstructPath(current, nodes)
        }

        const neighbors = [
            { r: -1, c: 0 }, { r: 1, c: 0 }, { r: 0, c: -1 }, { r: 0, c: 1 }
        ]

        for (const offset of neighbors) {
            const nR = current.position.row + offset.r
            const nC = current.position.col + offset.c

            if (isWalkable(nR, nC)) {
                const neighborNode = nodes[nR][nC]
                const newDist = current.distance + 1
                if (newDist < neighborNode.distance) {
                    neighborNode.distance = newDist
                    neighborNode.previous = Option.some(current.position)
                    if (!neighborNode.visited) {
                        unvisited.push(neighborNode)
                    }
                }
            }
        }
    }
    return []
}

const reconstructPath = (goalNode: PathNode, nodes: PathNode[][]): Position[] => {
    const path: Position[] = []
    let current = Option.some(goalNode)

    while (Option.isSome(current)) {
        const node = current.value
        path.unshift(node.position)

        if (Option.isSome(node.previous)) {
            const prev = node.previous.value
            current = Option.some(nodes[prev.row][prev.col])
            if (nodes[prev.row][prev.col].distance === 0) {
                current = Option.none()
            }
        } else {
            current = Option.none()
        }
    }
    return path
}

const manhattanDistance = (p1: Position, p2: Position): number => {
    return Math.abs(Math.round(p1.row) - Math.round(p2.row)) +
           Math.abs(Math.round(p1.col) - Math.round(p2.col))
}

const isReachable = (start: Position, goal: Position, grid: Cell[][]): boolean => {
    return findShortestPath(start, goal, grid, true).length > 0
}

const updateBotAI = (model: Model): { players: Player[], bombs: Bomb[] } => {
    let newBombs = [...model.bombs]
    const newPlayers = model.players.map(player => {
        if (!player.isAlive || player.isHuman || !player.botType) return player

        // Check if reevaluation is needed
        const timeSinceReeval = (model.currentTime - player.lastReevaluation) / FPS
        const shouldReeval = timeSinceReeval >= player.reevaluationInterval &&
                           Math.random() < player.reevaluationChance

        let updatedPlayer = player
        if (shouldReeval || !player.botState) {
            updatedPlayer = performReevaluation(player, model)
            updatedPlayer = { ...updatedPlayer, lastReevaluation: model.currentTime }
        }

        // Execute bot state
        updatedPlayer = executeBotState(updatedPlayer, model)

        // Handle bomb planting
        if (shouldPlantBomb(updatedPlayer, model) && updatedPlayer.activeBombs < updatedPlayer.maxBombs) {
            const bombPos = Position.make({
                row: Math.round(updatedPlayer.position.row),
                col: Math.round(updatedPlayer.position.col)
            })

            const bombAlreadyExists = newBombs.some(bomb =>
                Math.round(bomb.position.row) === bombPos.row &&
                Math.round(bomb.position.col) === bombPos.col
            )

            if (!bombAlreadyExists) {
                newBombs.push(Bomb.make({
                    position: bombPos,
                    plantedAt: model.currentTime,
                    range: updatedPlayer.bombRange,
                    playerId: updatedPlayer.id
                }))
                updatedPlayer = { ...updatedPlayer, activeBombs: updatedPlayer.activeBombs + 1 }
            }
        }

        return updatedPlayer
    })

    return { players: newPlayers, bombs: newBombs }
}

const performReevaluation = (player: Player, model: Model): Player => {
    // 1. Check for danger
    if (isInDanger(player, model)) {
        const safeGoal = findSafeGoal(player, model)
        const path = safeGoal.row !== -1 ? findShortestPath(player.position, safeGoal, model.grid, true) : []
        return {
            ...player,
            botState: "ESCAPE",
            botGoal: safeGoal,
            botPath: path,
            aiDirection: getDirectionToNextCell(player, path)
        }
    }

    // 2. Check for powerups
    const powerupGoal = findPowerupGoal(player, model)
    if (Option.isSome(powerupGoal)) {
        const path = findShortestPath(player.position, powerupGoal.value, model.grid)
        return {
            ...player,
            botState: "GET_POWERUP",
            botGoal: powerupGoal.value,
            botPath: path,
            aiDirection: getDirectionToNextCell(player, path)
        }
    }

    // 3. Check for attack opportunities
    const attackGoal = findAttackGoal(player, model)
    if (Option.isSome(attackGoal)) {
        const ignoreSoft = player.attackPolicy === "first"
        const path = findShortestPath(player.position, attackGoal.value, model.grid, ignoreSoft)
        return {
            ...player,
            botState: "ATTACK",
            botGoal: attackGoal.value,
            botPath: path,
            aiDirection: getDirectionToNextCell(player, path)
        }
    }

    // 4. Wander randomly
    const randomGoal = findRandomGoal(model)
    const path = randomGoal.row !== -1 ? findShortestPath(player.position, randomGoal, model.grid) : []
    return {
        ...player,
        botState: "WANDER",
        botGoal: randomGoal,
        botPath: path,
        aiDirection: getDirectionToNextCell(player, path)
    }
}

const executeBotState = (player: Player, model: Model): Player => {
    if (!player.botType) return player

    switch (player.botState) {
        case "WANDER":
            return executeWander(player, model)
        case "ESCAPE":
            return executeEscape(player, model)
        case "ATTACK":
            return executeAttack(player, model)
        case "GET_POWERUP":
            return executeGetPowerup(player, model)
        default:
            return player
    }
}

const executeWander = (player: Player, model: Model): Player => {
    const goalRow = Math.round(player.botGoal.row)
    const goalCol = Math.round(player.botGoal.col)

    if (goalRow < 0 || goalRow >= GRID_ROWS || goalCol < 0 || goalCol >= GRID_COLS ||
        player.botPath.length === 0 ||
        (Math.round(player.position.row) === goalRow && Math.round(player.position.col) === goalCol)) {
        return performReevaluation(player, model)
    }

    return followPath(player, model)
}

const executeEscape = (player: Player, model: Model): Player => {
    const goalRow = Math.round(player.botGoal.row)
    const goalCol = Math.round(player.botGoal.col)

    if (goalRow < 0 || goalRow >= GRID_ROWS || goalCol < 0 || goalCol >= GRID_COLS ||
        player.botPath.length === 0 ||
        (Math.round(player.position.row) === goalRow && Math.round(player.position.col) === goalCol) ||
        isInDanger(player, model)) {
        return performReevaluation(player, model)
    }

    return followPath(player, model)
}

const executeAttack = (player: Player, model: Model): Player => {
    const goalRow = Math.round(player.botGoal.row)
    const goalCol = Math.round(player.botGoal.col)

    if (goalRow < 0 || goalRow >= GRID_ROWS || goalCol < 0 || goalCol >= GRID_COLS) {
        return performReevaluation(player, model)
    }

    let targetExists = false
    for (const p of model.players) {
        if (p.id !== player.id && p.isAlive &&
            Math.round(p.position.row) === goalRow &&
            Math.round(p.position.col) === goalCol) {
            targetExists = true
            break
        }
    }

    if (!targetExists || player.botPath.length === 0) {
        return performReevaluation(player, model)
    }

    return followPath(player, model)
}

const executeGetPowerup = (player: Player, model: Model): Player => {
    const goalRow = Math.round(player.botGoal.row)
    const goalCol = Math.round(player.botGoal.col)

    if (goalRow < 0 || goalRow >= GRID_ROWS || goalCol < 0 || goalCol >= GRID_COLS) {
        return performReevaluation(player, model)
    }

    if (player.botPath.length === 0 || !model.grid[goalRow][goalCol].powerup) {
        return performReevaluation(player, model)
    }

    return followPath(player, model)
}

const followPath = (player: Player, model: Model): Player => {
    if (player.botPath.length === 0) return player

    const nextCell = player.botPath[0]
    const currentRow = Math.round(player.position.row)
    const currentCol = Math.round(player.position.col)
    const nextRow = Math.round(nextCell.row)
    const nextCol = Math.round(nextCell.col)

    let aiDirection = player.aiDirection
    if (nextRow < currentRow) aiDirection = "up"
    else if (nextRow > currentRow) aiDirection = "down"
    else if (nextCol < currentCol) aiDirection = "left"
    else if (nextCol > currentCol) aiDirection = "right"

    let newPath = player.botPath
    if (Math.abs(player.position.row - nextCell.row) < 0.3 &&
        Math.abs(player.position.col - nextCell.col) < 0.3) {
        newPath = player.botPath.slice(1)
    }

    return {
        ...player,
        botPath: newPath,
        aiDirection
    }
}

const getDirectionToNextCell = (player: Player, path: Position[]): "up" | "down" | "left" | "right" | null => {
    if (path.length === 0) return null
    const nextCell = path[0]
    const currentRow = Math.round(player.position.row)
    const currentCol = Math.round(player.position.col)
    const nextRow = Math.round(nextCell.row)
    const nextCol = Math.round(nextCell.col)

    if (nextRow < currentRow) return "up"
    if (nextRow > currentRow) return "down"
    if (nextCol < currentCol) return "left"
    if (nextCol > currentCol) return "right"
    return null
}

const shouldPlantBomb = (player: Player, model: Model): boolean => {
    if (player.botState === "ATTACK") {
        for (const enemy of model.players) {
            if (enemy.id !== player.id && enemy.isAlive) {
                const dist = manhattanDistance(player.position, enemy.position)
                if (dist <= player.attackPlantDistance) return true
            }
        }
    }

    if (player.botState === "WANDER" && player.botPath.length > 0) {
        const nextCell = player.botPath[0]
        const row = Math.round(nextCell.row)
        const col = Math.round(nextCell.col)
        if (row >= 0 && row < GRID_ROWS && col >= 0 && col < GRID_COLS) {
            const cell = model.grid[row][col]
            return cell.type === "soft" && !cell.isDestroying
        }
    }

    return false
}

const isInDanger = (player: Player, model: Model): boolean => {
    const playerRow = Math.round(player.position.row)
    const playerCol = Math.round(player.position.col)

    for (let dr = -player.dangerCheckDistance; dr <= player.dangerCheckDistance; dr++) {
        for (let dc = -player.dangerCheckDistance; dc <= player.dangerCheckDistance; dc++) {
            if (Math.abs(dr) + Math.abs(dc) > player.dangerCheckDistance) continue
            const checkRow = playerRow + dr
            const checkCol = playerCol + dc
            if (checkRow >= 0 && checkRow < GRID_ROWS && checkCol >= 0 && checkCol < GRID_COLS) {
                if (isCellDangerous(checkRow, checkCol, model, player)) return true
            }
        }
    }

    return false
}

const isCellDangerous = (row: number, col: number, model: Model, player: Player): boolean => {
    // Check explosions
    for (const exp of model.explosions) {
        for (const pos of exp.cells) {
            if (Math.round(pos.row) === row && Math.round(pos.col) === col) return true
        }
    }

    // Check based on detection policy
    if (player.dangerDetectionPolicy === "bombs_only") {
        for (const bomb of model.bombs) {
            if (Math.round(bomb.position.row) === row && Math.round(bomb.position.col) === col) {
                return true
            }
        }
    } else if (player.dangerDetectionPolicy === "explosion_range") {
        for (const bomb of model.bombs) {
            const bombRow = Math.round(bomb.position.row)
            const bombCol = Math.round(bomb.position.col)
            if (isInExplosionRange(row, col, bombRow, bombCol, bomb.range, model.grid)) {
                return true
            }
        }
    }

    return false
}

const isInExplosionRange = (row: number, col: number, bombRow: number, bombCol: number, range: number, grid: Cell[][]): boolean => {
    if (row === bombRow && col > bombCol) {
        for (let c = bombCol + 1; c <= Math.min(bombCol + range, GRID_COLS - 1); c++) {
            if (c === col) return true
            if (grid[row][c].type === "hard") break
            if (grid[row][c].type === "soft" && !grid[row][c].isDestroying) break
        }
    }
    if (row === bombRow && col < bombCol) {
        for (let c = bombCol - 1; c >= Math.max(bombCol - range, 0); c--) {
            if (c === col) return true
            if (grid[row][c].type === "hard") break
            if (grid[row][c].type === "soft" && !grid[row][c].isDestroying) break
        }
    }
    if (col === bombCol && row > bombRow) {
        for (let r = bombRow + 1; r <= Math.min(bombRow + range, GRID_ROWS - 1); r++) {
            if (r === row) return true
            if (grid[r][col].type === "hard") break
            if (grid[r][col].type === "soft" && !grid[r][col].isDestroying) break
        }
    }
    if (col === bombCol && row < bombRow) {
        for (let r = bombRow - 1; r >= Math.max(bombRow - range, 0); r--) {
            if (r === row) return true
            if (grid[r][col].type === "hard") break
            if (grid[r][col].type === "soft" && !grid[r][col].isDestroying) break
        }
    }
    return false
}

const findSafeGoal = (player: Player, model: Model): Position => {
    const safeSpots: Position[] = []
    for (let r = 0; r < GRID_ROWS; r++) {
        for (let c = 0; c < GRID_COLS; c++) {
            if (model.grid[r][c].type === "empty" && !isCellDangerous(r, c, model, player)) {
                const goal = Position.make({ row: r, col: c })
                if (isReachable(player.position, goal, model.grid)) {
                    safeSpots.push(goal)
                }
            }
        }
    }

    return safeSpots.length > 0
        ? safeSpots[Math.floor(Math.random() * safeSpots.length)]
        : Position.make({ row: -1, col: -1 })
}

const findPowerupGoal = (player: Player, model: Model): Option.Option<Position> => {
    const powerups: Position[] = []
    for (let r = 0; r < GRID_ROWS; r++) {
        for (let c = 0; c < GRID_COLS; c++) {
            if (model.grid[r][c].powerup) {
                powerups.push(Position.make({ row: r, col: c }))
            }
        }
    }

    if (powerups.length === 0) return Option.none()

    if (player.powerupPolicy === "first") {
        let best: Position | null = null
        let minDist = Infinity
        for (const p of powerups) {
            const dist = manhattanDistance(player.position, p)
            if (dist < minDist && isReachable(player.position, p, model.grid)) {
                minDist = dist
                best = p
            }
        }
        return best ? Option.some(best) : Option.none()
    } else {
        const nearby = powerups.filter(p =>
            manhattanDistance(player.position, p) <= 4 &&
            isReachable(player.position, p, model.grid) &&
            Math.random() < player.powerupPolicyChance
        )
        return nearby.length > 0
            ? Option.some(nearby[Math.floor(Math.random() * nearby.length)])
            : Option.none()
    }
}

const findAttackGoal = (player: Player, model: Model): Option.Option<Position> => {
    const enemies = model.players.filter(p => p.id !== player.id && p.isAlive)
    if (enemies.length === 0) return Option.none()

    if (player.attackPolicy === "first") {
        for (const enemy of enemies) {
            const dist = manhattanDistance(player.position, enemy.position)
            if (dist <= player.attackTargetDistance && isReachable(player.position, enemy.position, model.grid)) {
                return Option.some(Position.make({
                    row: Math.round(enemy.position.row),
                    col: Math.round(enemy.position.col)
                }))
            }
        }
        return Option.none()
    } else {
        const enemy = enemies[Math.floor(Math.random() * enemies.length)]
        return Option.some(Position.make({
            row: Math.round(enemy.position.row),
            col: Math.round(enemy.position.col)
        }))
    }
}

const findRandomGoal = (model: Model): Position => {
    let attempts = 0
    while (attempts < 50) {
        const r = Math.floor(Math.random() * GRID_ROWS)
        const c = Math.floor(Math.random() * GRID_COLS)
        if (model.grid[r][c].type !== "hard") {
            return Position.make({ row: r, col: c })
        }
        attempts++
    }
    return Position.make({ row: -1, col: -1 })
}

// ==================== PLAYER MOVEMENT ====================
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
                case "up": dRow -= player.speed; newDirection = "up"; isMoving = true; break
                case "down": dRow += player.speed; newDirection = "down"; isMoving = true; break
                case "left": dCol -= player.speed; newDirection = "left"; isMoving = true; break
                case "right": dCol += player.speed; newDirection = "right"; isMoving = true; break
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

    return {
        ...player,
        position: nextPos,
        direction: newDirection,
        isMoving
    }
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

    // Where is the player's center currently?
    const currentCenterR = Math.round(oldPos.row)
    const currentCenterC = Math.round(oldPos.col)

    for (const corner of corners) {
        const r = Math.floor(corner.r)
        const c = Math.floor(corner.c)

        // 1. Boundary check
        if (r < 0 || r >= GRID_ROWS || c < 0 || c >= GRID_COLS) return false

        // 2. Hard block check
        const cell = model.grid[r][c]
        if (cell.type === "hard") return false

        // 3. Soft block check (if not being destroyed)
        if (cell.type === "soft" && !cell.isDestroying) return false

        // 4. Bomb check
        const bomb = model.bombs.find(b => {
            const bombR = Math.round(b.position.row)
            const bombC = Math.round(b.position.col)
            return bombR === r && bombC === c
        })

        if (bomb) {
            // Can we walk through this bomb?
            // Only if we're currently centered in this cell
            const isCurrentCell = (r === currentCenterR && c === currentCenterC)

            if (!isCurrentCell) {
                return false // Can't walk into a bomb from another cell
            }
            // If we ARE in this cell, we can walk out of it
        }
    }

    return true
}

// ==================== GAME LOGIC FUNCTIONS ====================
const updatePlayerTimers = (player: Player): Player => {
    let updatedPlayer = player

    if (updatedPlayer.hasVest) {
        const newVestTimer = Math.max(0, updatedPlayer.vestTimer - 1 / FPS)
        if (newVestTimer <= 0) {
            updatedPlayer = { ...updatedPlayer, hasVest: false, vestTimer: 0 }
        } else {
            updatedPlayer = { ...updatedPlayer, vestTimer: newVestTimer }
        }
    }

    const timers = updatedPlayer.rainbowTimers
    let hasActiveRainbow = false

    let newFireUp = timers.FireUp
    let newBombUp = timers.BombUp
    let newSpeedUp = timers.SpeedUp

    if (timers.FireUp > 0) {
        newFireUp = Math.max(0, timers.FireUp - 1 / FPS)
        hasActiveRainbow = true
    }
    if (timers.BombUp > 0) {
        newBombUp = Math.max(0, timers.BombUp - 1 / FPS)
        hasActiveRainbow = true
    }
    if (timers.SpeedUp > 0) {
        newSpeedUp = Math.max(0, timers.SpeedUp - 1 / FPS)
        hasActiveRainbow = true
    }

    if (!hasActiveRainbow) {
        updatedPlayer = {
            ...updatedPlayer,
            bombRange: Math.max(1, updatedPlayer.bombRange - 3),
            maxBombs: Math.max(1, updatedPlayer.maxBombs - 3),
            speed: Math.max(BASE_SPEED, updatedPlayer.speed - SPEED_INCREMENT * 3)
        }
    }

    return {
        ...updatedPlayer,
        rainbowTimers: {
            FireUp: newFireUp,
            BombUp: newBombUp,
            SpeedUp: newSpeedUp
        }
    }
}

const checkPowerupCollection = (model: Model): Model => {
    let newGrid = model.grid
    const newPlayers = model.players.map(player => {
        if (!player.isAlive) return player

        const r = Math.round(player.position.row)
        const c = Math.round(player.position.col)
        const cell = newGrid[r][c]

        if (cell.powerup && !cell.isDestroying && cell.type === "empty") {
            let updatedPlayer = player

            switch (cell.powerup) {
                case "FireUp":
                    updatedPlayer = { ...updatedPlayer, bombRange: updatedPlayer.bombRange + 1 }
                    break
                case "BombUp":
                    updatedPlayer = { ...updatedPlayer, maxBombs: updatedPlayer.maxBombs + 1 }
                    break
                case "SpeedUp":
                    updatedPlayer = { ...updatedPlayer, speed: updatedPlayer.speed + SPEED_INCREMENT }
                    break
                case "Rainbow":
                    updatedPlayer = {
                        ...updatedPlayer,
                        rainbowTimers: { FireUp: 10, BombUp: 10, SpeedUp: 10 }
                    }
                    break
                case "Vest":
                    updatedPlayer = { ...updatedPlayer, hasVest: true, vestTimer: 10 }
                    break
            }

            // Remove powerup from grid
            newGrid = EffectArray.map(newGrid, (gridRow, rowIdx) =>
                rowIdx !== r ? gridRow : EffectArray.map(gridRow, (gridCell, colIdx) =>
                    colIdx !== c ? gridCell : Cell.make({ ...gridCell, powerup: null })
                )
            )

            return updatedPlayer
        }
        return player
    })

    return { ...model, grid: newGrid, players: newPlayers }
}

const updateBombsAndExplosions = (model: Model): Model => {
    // Filter active explosions
    const activeExplosions = model.explosions.filter(explosion =>
        (model.currentTime - explosion.createdAt) < FPS * EXPLOSION_DURATION
    )

    // Check which bombs should explode
    const explodingBombIndices: number[] = []
    const newExplosions: Explosion[] = []

    model.bombs.forEach((bomb, index) => {
        const r = Math.round(bomb.position.row)
        const c = Math.round(bomb.position.col)
        const timeElapsed = (model.currentTime - bomb.plantedAt) / FPS
        const hitByExplosion = model.grid[r][c].hasExplosion

        if (timeElapsed >= BOMB_TIMER || hitByExplosion) {
            explodingBombIndices.push(index)

            // Create explosion
            const cells: Position[] = []
            const center = { r, c }

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
        }
    })

    // Combine explosions
    const allExplosions = [...activeExplosions, ...newExplosions]
    const activeExplosionCells = new Set(
        allExplosions.flatMap(e => e.cells.map(p => `${Math.round(p.row)},${Math.round(p.col)}`))
    )

    // Update grid with explosions
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

    // Remove exploded bombs
    const remainingBombs = model.bombs.filter((_, index) => !explodingBombIndices.includes(index))

    // Update player active bomb counts
    const newPlayers = model.players.map(player => {
        const bombsExploded = explodingBombIndices.filter(index =>
            model.bombs[index].playerId === player.id
        ).length

        if (bombsExploded > 0) {
            return { ...player, activeBombs: Math.max(0, player.activeBombs - bombsExploded) }
        }
        return player
    })

    return {
        ...model,
        grid: newGrid,
        bombs: remainingBombs,
        explosions: allExplosions,
        players: newPlayers
    }
}

const checkDeaths = (model: Model): Model => {
    const newPlayers = model.players.map(player => {
        if (!player.isAlive) return player

        const corners = [
            { r: Math.floor(player.position.row + 0.2), c: Math.floor(player.position.col + 0.2) },
            { r: Math.floor(player.position.row + 0.2), c: Math.floor(player.position.col + 0.8) },
            { r: Math.floor(player.position.row + 0.8), c: Math.floor(player.position.col + 0.2) },
            { r: Math.floor(player.position.row + 0.8), c: Math.floor(player.position.col + 0.8) }
        ]

        let isHit = false
        for (const corner of corners) {
            if (corner.r < 0 || corner.r >= GRID_ROWS || corner.c < 0 || corner.c >= GRID_COLS) continue
            if (model.grid[corner.r][corner.c].hasExplosion) {
                isHit = true
                break
            }
        }

        if (isHit && player.hasVest) {
            return { ...player, hasVest: false, vestTimer: 0 }
        }

        if (isHit) return { ...player, isAlive: false }
        return player
    })

    const alivePlayers = newPlayers.filter(p => p.isAlive)
    if (alivePlayers.length <= 1 && model.players.length > 1 && model.state === "playing") {
        const winner = alivePlayers.length === 1 ? alivePlayers[0] : null
        return endRound({ ...model, players: newPlayers }, winner ? winner.label : "Draw")
    }

    return { ...model, players: newPlayers }
}

const endRound = (model: Model, winnerLabel: string): Model => {
    const newPlayers = model.players.map(player =>
        player.label === winnerLabel
            ? { ...player, wins: player.wins + 1 }
            : player
    )

    const matchWinner = newPlayers.find(player => player.wins >= model.roundsToWin)

    return {
        ...model,
        players: newPlayers,
        state: matchWinner ? "matchOver" : "roundOver",
        roundWinner: winnerLabel,
        gamePhase: "gameOver",
        gameOverMessage: matchWinner ? `${winnerLabel} WINS MATCH!` : `${winnerLabel} WINS ROUND!`
    }
}

const handleRestartGame = (): Model => {
    return {
        ...initModel,
        grid: createGrid(),
        state: "warmup"
    }
}

const handleStartNextRound = (model: Model): Model => {
    return {
        ...model,
        grid: createGrid(),
        players: initModel.players.map((p, i) => ({
            ...model.players[i],
            position: p.startPosition,
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
            botState: p.botType ? "WANDER" : null,
            botGoal: Position.make({ row: -1, col: -1 }),
            botPath: [],
            lastReevaluation: 0,
            aiDirection: null
        })),
        bombs: [],
        explosions: [],
        state: "warmup",
        roundTimer: WARMUP_SECONDS * FPS,
        roundNumber: model.roundNumber + 1
    }
}