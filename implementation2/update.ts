import { Match } from "effect"
import { Msg } from "./msg"
import { Model, Player, Bomb, Explosion, Position, Cell } from "./model"
import { GRID_ROWS, GRID_COLS, FPS, GAME_DURATION, BOMB_TIMER, EXPLOSION_DURATION } from "./model"

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

  if (key === " " && model.player.activeBombs < model.player.maxBombs) {
    const pos = model.player.position
    const bombPos = { row: Math.round(pos.row), col: Math.round(pos.col) }

    // Check if bomb already exists here
    const bombExists = model.bombs.some(b =>
      Math.round(b.position.row) === bombPos.row &&
      Math.round(b.position.col) === bombPos.col
    )

    if (!bombExists) {
      const newBomb = Bomb.make({
        position: Position.make(bombPos),
        plantedAt: model.currentTime,
        range: model.player.bombRange,
        playerId: model.player.id,
      })

      return Model.make({
        ...model,
        bombs: [...model.bombs, newBomb],
        player: Player.make({
          ...model.player,
          activeBombs: model.player.activeBombs + 1,
        }),
        keys: newKeys,
      })
    }
  }

  return Model.make({ ...model, keys: newKeys })
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

  // Check timer
  if (newModel.currentTime / FPS >= GAME_DURATION) {
    return Model.make({
      ...newModel,
      gamePhase: "gameOver",
      gameOverMessage: "Time's up!",
    })
  }

  // Move player
  newModel = updatePlayer(newModel)

  // Check if player is in explosion
  const playerRow = Math.floor(newModel.player.position.row)
  const playerCol = Math.floor(newModel.player.position.col)
  const playerCell = newModel.grid[playerRow]?.[playerCol]
  if (playerCell?.hasExplosion) {
    return Model.make({
      ...newModel,
      player: Player.make({ ...newModel.player, isAlive: false }),
      gamePhase: "gameOver",
      gameOverMessage: "Game Over!",
    })
  }

  // Update bombs and explosions
  const bombResult = updateBombsAndExplosions(newModel)
  newModel = { ...newModel, ...bombResult }

  return Model.make(newModel)
}

const updatePlayer = (model: Model): Model => {
  if (!model.player.isAlive) return model

  let newRow = model.player.position.row
  let newCol = model.player.position.col
  const speed = model.player.speed

  if (model.keys.has("ArrowUp")) newRow -= speed
  if (model.keys.has("ArrowDown")) newRow += speed
  if (model.keys.has("ArrowLeft")) newCol -= speed
  if (model.keys.has("ArrowRight")) newCol += speed

  // Check collision
  if (canMoveTo(newRow, newCol, model)) {
    return Model.make({
      ...model,
      player: Player.make({
        ...model.player,
        position: Position.make({ row: newRow, col: newCol }),
      }),
    })
  }

  return model
}

const canMoveTo = (row: number, col: number, model: Model): boolean => {
  // Check all four corners of the player
  const corners = [
    { r: row + 0.2, c: col + 0.2 },
    { r: row + 0.2, c: col + 0.8 },
    { r: row + 0.8, c: col + 0.2 },
    { r: row + 0.8, c: col + 0.8 },
  ]

  for (const corner of corners) {
    const r = Math.floor(corner.r)
    const c = Math.floor(corner.c)
    const cell = model.grid[r]?.[c]

    if (!cell || cell.type === "hard" || cell.type === "soft") {
      return false
    }

    // Check for bombs (can't move into a new bomb)
    const oldR = Math.floor(model.player.position.row)
    const oldC = Math.floor(model.player.position.col)

    for (const bomb of model.bombs) {
      const bombR = Math.floor(bomb.position.row)
      const bombC = Math.floor(bomb.position.col)

      if (bombR === r && bombC === c) {
        // Allow moving away from a bomb we're already on
        if (oldR !== bombR || oldC !== bombC) {
          return false
        }
      }
    }
  }

  return true
}

const updateBombsAndExplosions = (model: Model): Partial<Model> => {
  const currentTime = model.currentTime
  let bombsExploded = 0

  // Create new grid without explosions
  const newGrid = model.grid.map(row =>
    row.map(cell => Cell.make({ ...cell, hasExplosion: false }))
  )

  // Update existing explosions
  const newExplosions = model.explosions.filter(exp => {
    const age = (currentTime - exp.createdAt) / FPS
    return age < EXPLOSION_DURATION
  })

  // Mark explosions on grid
  for (const exp of newExplosions) {
    for (const pos of exp.cells) {
      const r = Math.floor(pos.row)
      const c = Math.floor(pos.col)
      if (r >= 0 && r < GRID_ROWS && c >= 0 && c < GRID_COLS) {
        newGrid[r][c] = Cell.make({ ...newGrid[r][c], hasExplosion: true })
      }
    }
  }

  // Check bombs
  const bombsToExplode: typeof Bomb.Type[] = []
  const newBombs = model.bombs.filter(bomb => {
    const age = (currentTime - bomb.plantedAt) / FPS
    const r = Math.floor(bomb.position.row)
    const c = Math.floor(bomb.position.col)
    const inExplosion = newGrid[r]?.[c]?.hasExplosion || false

    if (age >= BOMB_TIMER || inExplosion) {
      bombsToExplode.push(bomb)
      bombsExploded++
      return false
    }
    return true
  })

  // Create explosions from bombs
  for (const bomb of bombsToExplode) {
    const cells = getExplosionCells(bomb, newGrid)
    newExplosions.push(Explosion.make({
      cells,
      createdAt: currentTime,
    }))

    // Mark explosion cells
    for (const pos of cells) {
      const r = Math.floor(pos.row)
      const c = Math.floor(pos.col)
      if (r >= 0 && r < GRID_ROWS && c >= 0 && c < GRID_COLS) {
        newGrid[r][c] = Cell.make({ ...newGrid[r][c], hasExplosion: true })

        // Destroy soft blocks
        if (newGrid[r][c].type === "soft") {
          newGrid[r][c] = Cell.make({ type: "empty", hasExplosion: true })
        }
      }
    }
  }

  // Update player's active bombs count
  let newPlayer = model.player
  if (bombsExploded > 0) {
    newPlayer = Player.make({
      ...model.player,
      activeBombs: Math.max(0, model.player.activeBombs - bombsExploded),
    })
  }

  return {
    grid: newGrid,
    bombs: newBombs,
    explosions: newExplosions,
    player: newPlayer,
  }
}

const getExplosionCells = (bomb: typeof Bomb.Type, grid: Cell[][]): Position[] => {
  const cells: Position[] = []
  const centerR = Math.floor(bomb.position.row)
  const centerC = Math.floor(bomb.position.col)

  cells.push(Position.make({ row: centerR, col: centerC }))

  const directions = [
    { dr: -1, dc: 0 },
    { dr: 1, dc: 0 },
    { dr: 0, dc: -1 },
    { dr: 0, dc: 1 },
  ]

  for (const dir of directions) {
    for (let i = 1; i <= bomb.range; i++) {
      const r = centerR + dir.dr * i
      const c = centerC + dir.dc * i

      if (r < 0 || r >= GRID_ROWS || c < 0 || c >= GRID_COLS) break

      const cell = grid[r][c]
      if (cell.type === "hard" || cell.type === "soft") break

      cells.push(Position.make({ row: r, col: c }))
    }
  }

  return cells
}