import { Match, Array as EffectArray, Option, pipe } from "effect"
import { Msg } from "./msg"
import {
    Model, Player, Bomb, Explosion, Position, Cell, GRID_ROWS, GRID_COLS,
    FPS, BOMB_TIMER, EXPLOSION_DURATION, BASE_SPEED, SPEED_INCREMENT,
    DESTRUCTION_DELAY, WARMUP_SECONDS, createGrid, initModel
} from "./model"
import settings from "./settings"

// ==================== SETTINGS & CONSTANTS ====================
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
    const nextGrid = model.grid.map(row =>
        row.map(cell => {
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
    model: Model, // Pass full model to check bombs
    ignoreSoftBlocks: boolean = false
): Position[] => {
    if (goal.row < 0 || goal.row >= GRID_ROWS || goal.col < 0 || goal.col >= GRID_COLS) {
        return []
    }

    const nodes: PathNode[][] = Array.from({ length: GRID_ROWS }, (_, r) =>
        Array.from({ length: GRID_COLS }, (_, c) => ({
            position: Position.make({ row: r, col: c }),
            distance: Infinity,
            previous: Option.none(),
            visited: false
        }))
    )

    // AI Walkability Logic
    const isWalkable = (r: number, c: number): boolean => {
        if (r < 0 || r >= GRID_ROWS || c < 0 || c >= GRID_COLS) return false

        // 1. Grid Check
        const cell = model.grid[r][c]
        if (cell.type === "hard") return false
        if (!ignoreSoftBlocks && cell.type === "soft" && !cell.isDestroying) return false

        // 2. Bomb Check
        // Bots should treat bombs as walls unless they are standing ON that bomb (escape)
        const hasBomb = model.bombs.some(b =>
            Math.round(b.position.row) === r &&
            Math.round(b.position.col) === c
        )

        if (hasBomb) {
            // Allow start node (current position) to be valid even if it has a bomb
            const sR = Math.round(start.row)
            const sC = Math.round(start.col)
            if (r === sR && c === sC) return true

            return false // Blocked by other bombs
        }

        return true
    }

    const sR = Math.round(start.row), sC = Math.round(start.col)
    const gR = Math.round(goal.row), gC = Math.round(goal.col)

    if (!isWalkable(sR, sC) || !isWalkable(gR, gC)) return []

    nodes[sR][sC].distance = 0
    let unvisited: PathNode[] = [nodes[sR][sC]]

    while (unvisited.length > 0) {
        // Sort by distance (Simple Dijkstra/BFS)
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

const isReachable = (start: Position, goal: Position, model: Model): boolean => {
    return findShortestPath(start, goal, model, false).length > 0 // False = strict reachability
}

const updateBotAI = (model: Model): { players: Player[], bombs: Bomb[] } => {
    let newBombs = [...model.bombs]

    // Check triggers
    const explosionEnded = model.explosions.some(e =>
        (model.currentTime - e.createdAt) >= (FPS * EXPLOSION_DURATION) - 1
    )

    const newBombPositions = newBombs
        .filter(b => b.plantedAt === model.currentTime)
        .map(b => b.position)

    const newPlayers = model.players.map(player => {
        if (!player.isAlive || player.isHuman || !player.botType) return player

        const timeSinceReeval = (model.currentTime - player.lastReevaluation) / FPS
        let shouldReeval = timeSinceReeval >= player.reevaluationInterval &&
                           Math.random() < player.reevaluationChance

        if (explosionEnded) shouldReeval = true

        if (!shouldReeval) {
            for (const pos of newBombPositions) {
                if (manhattanDistance(player.position, pos) <= 5) {
                    shouldReeval = true
                    break
                }
            }
        }

        let updatedPlayer = player
        if (shouldReeval || !player.botState) {
            updatedPlayer = performReevaluation(player, model)
            updatedPlayer = { ...updatedPlayer, lastReevaluation: model.currentTime }
        }

        // Execute State
        updatedPlayer = executeBotState(updatedPlayer, model)

        // Planting Logic
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
    // 1. Danger
    if (isInDanger(player, model)) {
        const safeGoal = findSafeGoal(player, model)
        const path = safeGoal.row !== -1 ? findShortestPath(player.position, safeGoal, model, true) : []
        return {
            ...player,
            botState: "ESCAPE",
            botGoal: safeGoal,
            botPath: path,
            aiDirection: getDirectionToNextCell(player, path)
        }
    }

    // 2. Powerups
    const powerupGoal = findPowerupGoal(player, model)
    if (Option.isSome(powerupGoal)) {
        const path = findShortestPath(player.position, powerupGoal.value, model, false) // Strict path
        return {
            ...player,
            botState: "GET_POWERUP",
            botGoal: powerupGoal.value,
            botPath: path,
            aiDirection: getDirectionToNextCell(player, path)
        }
    }

    // 3. Attack
    const attackGoal = findAttackGoal(player, model)
    if (Option.isSome(attackGoal)) {
        // FIX: "Hostile" bots (Policy 2) should attack aggressively through walls
        const ignoreSoft = player.attackPolicy === "second"
        const path = findShortestPath(player.position, attackGoal.value, model, ignoreSoft)
        return {
            ...player,
            botState: "ATTACK",
            botGoal: attackGoal.value,
            botPath: path,
            aiDirection: getDirectionToNextCell(player, path)
        }
    }

    // 4. Wander
    const randomGoal = findRandomGoal(model)
    // Ignore soft blocks = true allows pathing through them to destroy them
    const path = randomGoal.row !== -1 ? findShortestPath(player.position, randomGoal, model, true) : []
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
        case "WANDER": return executeWander(player, model)
        case "ESCAPE": return executeEscape(player, model)
        case "ATTACK": return executeAttack(player, model)
        case "GET_POWERUP": return executeGetPowerup(player, model)
        default: return player
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
    if (player.botPath.length === 0) {
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
    if (!model.grid[goalRow][goalCol].powerup) {
        return performReevaluation(player, model)
    }
    if (player.botPath.length === 0) {
         return performReevaluation(player, model)
    }
    return followPath(player, model)
}

const followPath = (player: Player, model: Model): Player => {
    if (player.botPath.length === 0) return player

    let nextCell = player.botPath[0]

    // Check if we are physically AT the next cell (start node or next step)
    if (Math.round(player.position.row) === Math.round(nextCell.row) &&
        Math.round(player.position.col) === Math.round(nextCell.col)) {

        if (player.botPath.length > 1) {
             nextCell = player.botPath[1]
        } else {
            return player
        }
    }

    const currentRow = player.position.row
    const currentCol = player.position.col
    const nextRow = nextCell.row
    const nextCol = nextCell.col

    let aiDirection: "up" | "down" | "left" | "right" | null = null

    // FIX: Floating point comparisons for direction to prevent jitter
    const epsilon = 0.05
    if (nextRow < currentRow - epsilon) aiDirection = "up"
    else if (nextRow > currentRow + epsilon) aiDirection = "down"
    else if (nextCol < currentCol - epsilon) aiDirection = "left"
    else if (nextCol > currentCol + epsilon) aiDirection = "right"

    // Snap to center if close enough
    if (Math.abs(currentRow - nextRow) < 0.2 &&
        Math.abs(currentCol - nextCol) < 0.2) {

        const newPath = player.botPath.filter(p =>
            !(Math.round(p.row) === Math.round(nextCell.row) && Math.round(p.col) === Math.round(nextCell.col))
        )
        return {
            ...player,
            botPath: newPath,
            aiDirection
        }
    }

    return {
        ...player,
        aiDirection
    }
}

const getDirectionToNextCell = (player: Player, path: Position[]): "up" | "down" | "left" | "right" | null => {
    if (path.length < 2) return null
    const nextCell = path[1]
    const currentRow = Math.round(player.position.row)
    const nextRow = Math.round(nextCell.row)
    const nextCol = Math.round(nextCell.col)

    if (nextRow < currentRow) return "up"
    if (nextRow > currentRow) return "down"
    if (nextCol < Math.round(player.position.col)) return "left"
    if (nextCol > Math.round(player.position.col)) return "right"
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

    // Plant if blocked by soft block
    if (player.botPath.length > 1) {
        const nextCell = player.botPath[1]
        const row = Math.round(nextCell.row)
        const col = Math.round(nextCell.col)
             if (row >= 0 && row < GRID_ROWS && col >= 0 && col < GRID_COLS) {
                const cell = model.grid[row][col]
                // Plant if blocking soft block
                if (cell.type === "soft" && !cell.isDestroying) return true
            }
    }

    return false
}

const isInDanger = (player: Player, model: Model): boolean => {
    const playerRow = Math.round(player.position.row)
    const playerCol = Math.round(player.position.col)

    if (model.grid[playerRow][playerCol].hasExplosion) return true

    const range = player.dangerCheckDistance

    for (let dr = -range; dr <= range; dr++) {
        for (let dc = -range; dc <= range; dc++) {
            if (Math.abs(dr) + Math.abs(dc) > range) continue

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
    if (model.grid[row][col].hasExplosion) return true

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

const isInExplosionRange = (targetRow: number, targetCol: number, bombRow: number, bombCol: number, range: number, grid: Cell[][]): boolean => {
    if (targetRow === bombRow && targetCol === bombCol) return true

    if (targetRow === bombRow) {
        const dist = targetCol - bombCol
        if (Math.abs(dist) <= range) {
            const step = dist > 0 ? 1 : -1
            for (let c = bombCol + step; c !== targetCol + step; c += step) {
                 if (c < 0 || c >= GRID_COLS) return false
                 if (grid[targetRow][c].type === "hard") return false
                 if (grid[targetRow][c].type === "soft" && !grid[targetRow][c].isDestroying) {
                     return c === targetCol
                 }
            }
            return true
        }
    }

    if (targetCol === bombCol) {
        const dist = targetRow - bombRow
        if (Math.abs(dist) <= range) {
            const step = dist > 0 ? 1 : -1
            for (let r = bombRow + step; r !== targetRow + step; r += step) {
                 if (r < 0 || r >= GRID_ROWS) return false
                 if (grid[r][targetCol].type === "hard") return false
                 if (grid[r][targetCol].type === "soft" && !grid[r][targetCol].isDestroying) {
                     return r === targetRow
                 }
            }
            return true
        }
    }

    return false
}

const findSafeGoal = (player: Player, model: Model): Position => {
    const safeSpots: Position[] = []
    for (let r = 0; r < GRID_ROWS; r++) {
        for (let c = 0; c < GRID_COLS; c++) {
            if (model.grid[r][c].type !== "hard" && !isCellDangerous(r, c, model, player)) {
                const goal = Position.make({ row: r, col: c })
                if (isReachable(player.position, goal, model)) {
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
            if (dist < minDist && isReachable(player.position, p, model)) {
                minDist = dist
                best = p
            }
        }
        return best ? Option.some(best) : Option.none()
    } else {
        const nearby = powerups.filter(p =>
            manhattanDistance(player.position, p) <= 4 &&
            isReachable(player.position, p, model)
        )
        if (nearby.length > 0) {
             return Option.some(nearby[Math.floor(Math.random() * nearby.length)])
        }
        return Option.none()
    }
}

const findAttackGoal = (player: Player, model: Model): Option.Option<Position> => {
    const enemies = model.players.filter(p => p.id !== player.id && p.isAlive)
    if (enemies.length === 0) return Option.none()

    if (player.attackPolicy === "first") {
        for (const enemy of enemies) {
            const dist = manhattanDistance(player.position, enemy.position)
            if (dist <= player.attackTargetDistance && isReachable(player.position, enemy.position, model)) {
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

            const centeringSpeed = player.speed * 0.5
            if (player.aiDirection === "up" || player.aiDirection === "down") {
                const idealCol = Math.round(player.position.col)
                const diff = idealCol - player.position.col
                if (Math.abs(diff) > 0.05) {
                    dCol += Math.sign(diff) * Math.min(Math.abs(diff), centeringSpeed)
                }
            } else {
                const idealRow = Math.round(player.position.row)
                const diff = idealRow - player.position.row
                if (Math.abs(diff) > 0.05) {
                    dRow += Math.sign(diff) * Math.min(Math.abs(diff), centeringSpeed)
                }
            }
        }
    }

    const newRow = player.position.row + dRow
    const newCol = player.position.col + dCol

    let nextPos = player.position
    if (canMoveTo(newRow, newCol, player, model)) {
        nextPos = Position.make({ row: newRow, col: newCol })
    } else {
        if (dRow !== 0 && canMoveTo(player.position.row + dRow, player.position.col, player, model)) {
            nextPos = Position.make({ row: player.position.row + dRow, col: player.position.col })
        } else if (dCol !== 0 && canMoveTo(player.position.row, player.position.col + dCol, player, model)) {
             nextPos = Position.make({ row: player.position.row, col: player.position.col + dCol })
        }
    }

    return {
        ...player,
        position: nextPos,
        direction: newDirection,
        isMoving
    }
}

// ==================== PROPER BOMB COLLISION LOGIC ====================
const canMoveTo = (row: number, col: number, player: Player, model: Model): boolean => {
    // Player bounding box (70% of cell size, centered)
    const playerWidth = 0.7
    const playerHeight = 0.7
    const offsetX = (1 - playerWidth) / 2
    const offsetY = (1 - playerHeight) / 2

    // 1. Grid/Map Collision (Check corners)
    const corners = [
        { x: col + offsetX, y: row + offsetY },
        { x: col + offsetX + playerWidth, y: row + offsetY },
        { x: col + offsetX, y: row + offsetY + playerHeight },
        { x: col + offsetX + playerWidth, y: row + offsetY + playerHeight }
    ]

    for (const corner of corners) {
        const cellX = Math.floor(corner.x)
        const cellY = Math.floor(corner.y)

        if (cellY < 0 || cellY >= GRID_ROWS || cellX < 0 || cellX >= GRID_COLS) return false
        const cell = model.grid[cellY][cellX]
        if (cell.type === "hard") return false
        if (cell.type === "soft" && !cell.isDestroying) return false
    }

    // 2. Bomb Collision (Explicit Intersection)
    // Check destination rect vs all bomb rects
    const destLeft = col + offsetX
    const destRight = col + offsetX + playerWidth
    const destTop = row + offsetY
    const destBottom = row + offsetY + playerHeight

    const currLeft = player.position.col + offsetX
    const currRight = player.position.col + offsetX + playerWidth
    const currTop = player.position.row + offsetY
    const currBottom = player.position.row + offsetY + playerHeight

    for (const bomb of model.bombs) {
        const bRow = Math.round(bomb.position.row)
        const bCol = Math.round(bomb.position.col)

        const bLeft = bCol
        const bRight = bCol + 1
        const bTop = bRow
        const bBottom = bRow + 1

        const destIntersects = !(destRight <= bLeft || destLeft >= bRight || destBottom <= bTop || destTop >= bBottom)

        if (destIntersects) {
            // Check if current position ALSO intersects this specific bomb
            const currIntersects = !(currRight <= bLeft || currLeft >= bRight || currBottom <= bTop || currTop >= bBottom)

            // If we are NOT currently inside it, we are hitting it from the outside -> Blocked
            if (!currIntersects) {
                return false
            }
            // If we ARE inside it, we are allowed to move (escape)
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

    if (!hasActiveRainbow && (timers.FireUp > 0 || timers.BombUp > 0 || timers.SpeedUp > 0)) {
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
    const newPlayers = model.players.map(player => {
        if (!player.isAlive) return player

        const r = Math.round(player.position.row)
        const c = Math.round(player.position.col)

        if (r < 0 || r >= GRID_ROWS || c < 0 || c >= GRID_COLS) return player

        const cell = model.grid[r][c]

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
                        rainbowTimers: { FireUp: 10, BombUp: 10, SpeedUp: 10 },
                        bombRange: updatedPlayer.bombRange + 3,
                        maxBombs: updatedPlayer.maxBombs + 3,
                        speed: updatedPlayer.speed + SPEED_INCREMENT * 3
                    }
                    break
                case "Vest":
                    updatedPlayer = { ...updatedPlayer, hasVest: true, vestTimer: 10 }
                    break
            }

            return updatedPlayer
        }
        return player
    })

    const newGrid = model.grid.map((row, r) =>
        row.map((cell, c) => {
             const collected = newPlayers.some(p =>
                 Math.round(p.position.row) === r &&
                 Math.round(p.position.col) === c &&
                 model.grid[r][c].powerup
             )
             if (collected && cell.powerup) {
                 return Cell.make({ ...cell, powerup: null })
             }
             return cell
        })
    )

    return { ...model, players: newPlayers, grid: newGrid }
}

const updateBombsAndExplosions = (model: Model): Model => {
    const activeExplosions = model.explosions.filter(explosion =>
        (model.currentTime - explosion.createdAt) < FPS * EXPLOSION_DURATION
    )

    const explodingBombIndices: number[] = []
    const newExplosions: Explosion[] = []

    model.bombs.forEach((bomb, index) => {
        const r = Math.round(bomb.position.row)
        const c = Math.round(bomb.position.col)
        const timeElapsed = (model.currentTime - bomb.plantedAt) / FPS
        const hitByExplosion = model.grid[r][c].hasExplosion

        if (timeElapsed >= BOMB_TIMER || hitByExplosion) {
            explodingBombIndices.push(index)

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

    const allExplosions = [...activeExplosions, ...newExplosions]
    const activeExplosionCells = new Set(
        allExplosions.flatMap(e => e.cells.map(p => `${Math.round(p.row)},${Math.round(p.col)}`))
    )

    const newGrid = model.grid.map((row, r) =>
        row.map((cell, c) => {
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

    const remainingBombs = model.bombs.filter((_, index) => !explodingBombIndices.includes(index))

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
        players: model.players.map((p, i) => {
            const defaultPlayer = initModel.players[i]
            return {
                ...p,
                position: defaultPlayer.position,
                startPosition: defaultPlayer.position,
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
            }
        }),
        bombs: [],
        explosions: [],
        state: "warmup",
        roundTimer: WARMUP_SECONDS * FPS,
        roundNumber: model.roundNumber + 1,
        isDebugMode: false,
        deathTimer: null,
        gamePhase: "active",
        gameOverMessage: ""
    }
}