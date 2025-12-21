import { Model, GRID_ROWS, GRID_COLS, CELL_SIZE, GAME_DURATION } from "./model"
import { Msg } from "./msg"
import { h } from "cs12251-mvu/src"

export const view = (model: Model, dispatch: (msg: Msg) => void) => {
  const elapsed = Math.floor(model.currentTime / 30)
  const remaining = Math.max(0, GAME_DURATION - elapsed)
  const minutes = Math.floor(remaining / 60)
  const seconds = remaining % 60
  const timeStr = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`

  return h("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      fontFamily: "monospace",
      backgroundColor: "#1a1a1a",
      minHeight: "100vh",
      padding: "20px"
    }
  }, [
    h("h1", { style: { color: "#fff", marginBottom: "10px" } }, "Bomberman"),
    h("div", {
      style: {
        color: "#fff",
        fontSize: "24px",
        marginBottom: "10px",
        fontWeight: "bold"
      }
    }, `Time: ${timeStr}`),
    h("div", {
      style: {
        position: "relative",
        width: `${GRID_COLS * CELL_SIZE}px`,
        height: `${GRID_ROWS * CELL_SIZE}px`,
        backgroundColor: "#2a2a2a",
        border: "3px solid #444"
      }
    }, [
      renderGrid(model),
      renderBombs(model),
      renderExplosions(model),
      renderPlayer(model),
      model.gamePhase === "gameOver" ? renderGameOver(model) : null
    ].flat().filter(Boolean))
  ])
}

const renderGrid = (model: Model) => {
  const elements = []
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      const cell = model.grid[r][c]
      let color = "#4a4a4a"
      if (cell.type === "hard") color = "#1a1a1a"
      else if (cell.type === "soft") color = "#8b4513"
      else if (cell.hasExplosion) color = "#ff6600"

      elements.push(h("div", {
        style: {
          position: "absolute",
          left: `${c * CELL_SIZE}px`,
          top: `${r * CELL_SIZE}px`,
          width: `${CELL_SIZE}px`,
          height: `${CELL_SIZE}px`,
          backgroundColor: color,
          border: "1px solid #333"
        }
      }))
    }
  }
  return elements
}

const renderBombs = (model: Model) => {
  return model.bombs.map(bomb =>
    h("div", {
      style: {
        position: "absolute",
        left: `${Math.floor(bomb.position.col) * CELL_SIZE + 4}px`,
        top: `${Math.floor(bomb.position.row) * CELL_SIZE + 4}px`,
        width: `${CELL_SIZE - 8}px`,
        height: `${CELL_SIZE - 8}px`,
        backgroundColor: "#000",
        borderRadius: "50%",
        border: "2px solid #333"
      }
    })
  )
}

const renderExplosions = (model: Model) => {
  const elements = []
  for (const exp of model.explosions) {
    for (const pos of exp.cells) {
      elements.push(h("div", {
        style: {
          position: "absolute",
          left: `${Math.floor(pos.col) * CELL_SIZE}px`,
          top: `${Math.floor(pos.row) * CELL_SIZE}px`,
          width: `${CELL_SIZE}px`,
          height: `${CELL_SIZE}px`,
          backgroundColor: "#ff9900",
          opacity: "0.8"
        }
      }))
    }
  }
  return elements
}

const renderPlayer = (model: Model) => {
  if (!model.player.isAlive) return null
  return h("div", {
    style: {
      position: "absolute",
      left: `${model.player.position.col * CELL_SIZE + 4}px`,
      top: `${model.player.position.row * CELL_SIZE + 4}px`,
      width: `${CELL_SIZE - 8}px`,
      height: `${CELL_SIZE - 8}px`,
      backgroundColor: "#00ff00",
      borderRadius: "4px",
      border: "2px solid #00aa00"
    }
  })
}

const renderGameOver = (model: Model) => {
  return h("div", {
    style: {
      position: "absolute",
      top: "0",
      left: "0",
      width: "100%",
      height: "100%",
      backgroundColor: "rgba(0, 0, 0, 0.8)",
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      alignItems: "center"
    }
  }, [
    h("h2", {
      style: {
        color: "#fff",
        fontSize: "48px",
        marginBottom: "20px"
      }
    }, model.gameOverMessage)
  ])
}