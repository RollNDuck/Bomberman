import { Model, GRID_ROWS, GRID_COLS, CELL_SIZE, GAME_DURATION } from "./model"
import { Msg } from "./msg"
import { h } from "cs12251-mvu/src"

export const view = (model: Model, dispatch: (msg: Msg) => void) => {
    const elapsed = Math.floor(model.currentTime / 30)
    const remaining = Math.max(0, GAME_DURATION - elapsed)
    const minutes = Math.floor(remaining / 60)
    const seconds = remaining % 60
    const timeStr = `${minutes.toString().padStart(1, '0')}:${seconds.toString().padStart(2, '0')}`

    return h("div", {
        style: {
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            fontFamily: "'Courier New', monospace",
            backgroundColor: "#222",
            minHeight: "100vh",
            padding: "20px"
        }
    }, [
        // --- SCOREBOARD / HEADER ---
        h("div", {
            style: {
                display: "flex", justifyContent: "space-between", alignItems: "center",
                width: `${GRID_COLS * CELL_SIZE}px`,
                backgroundColor: "#00AAAA",
                border: "3px solid #ECECEC",
                borderBottom: "3px solid #000",
                padding: "5px 15px",
                marginBottom: "0px",
                boxSizing: "border-box",
                height: "50px"
            }
        }, [
            // Timer
            h("div", { style: { display: "flex", alignItems: "center" } }, [
                 h("div", {
                     style: {
                         width: "24px", height: "24px", borderRadius: "50%",
                         backgroundColor: "#D32F2F", border: "2px solid #5D4037",
                         marginRight: "8px", position: "relative"
                     }
                 }, [
                     h("div", { style: { position: "absolute", top: "-3px", left: "9px", width: "4px", height: "3px", backgroundColor: "#FFD700" } }),
                     h("div", { style: { position: "absolute", top: "4px", left: "10px", width: "2px", height: "8px", backgroundColor: "#fff", transform: "rotate(45deg)" } })
                 ]),
                 h("div", {
                     style: {
                         backgroundColor: "#000", color: "#fff", padding: "2px 5px",
                         fontFamily: "monospace", fontSize: "20px", fontWeight: "bold",
                         border: "2px solid #ECECEC", textShadow: "1px 1px 0 #000"
                     }
                 }, timeStr)
            ]),

            // Players Section (Mini Heads + Wins)
            h("div", { style: { display: "flex", gap: "20px" } },
                model.players.map(p =>
                    h("div", { style: { display: "flex", alignItems: "center" } }, [
                        h("div", {
                            style: {
                                width: "24px", height: "22px",
                                backgroundColor: p.color,
                                border: "2px solid #000",
                                borderRadius: "6px 6px 8px 8px",
                                marginRight: "5px",
                                position: "relative",
                                display: "flex", justifyContent: "center", alignItems: "center"
                            }
                        }, [
                            h("div", { style: { width: "14px", height: "10px", backgroundColor: "#FFCC99", borderRadius: "2px", border: "1px solid #000" } }, [
                                h("div", { style: { width: "2px", height: "4px", backgroundColor: "#000", position: "absolute", top: "8px", left: "6px" } }),
                                h("div", { style: { width: "2px", height: "4px", backgroundColor: "#000", position: "absolute", top: "8px", right: "6px" } })
                            ])
                        ]),
                        h("div", {
                            style: {
                                backgroundColor: "#000", color: "#fff", width: "20px", height: "20px",
                                display: "flex", justifyContent: "center", alignItems: "center",
                                fontSize: "14px", fontWeight: "bold", border: "2px solid #ECECEC"
                            }
                        }, p.wins.toString())
                    ])
                )
            )
        ]),

        // Game Area
        h("div", {
            style: {
                position: "relative",
                width: `${GRID_COLS * CELL_SIZE}px`,
                height: `${GRID_ROWS * CELL_SIZE}px`,
                backgroundColor: "#388700",
                border: "none",
            }
        }, [
            renderGrid(model),
            renderBombs(model),
            renderExplosions(model),
            renderPlayers(model),
            model.gamePhase === "gameOver" ? renderGameOver(model) : null
        ].flat().filter(Boolean))
    ])
}

const renderGrid = (model: Model) => {
    const elements = []
    const highlight = "#E0E0E0"
    const shadow = "#707070"

    for (let r = 0; r < GRID_ROWS; r++) {
        for (let c = 0; c < GRID_COLS; c++) {
            const cell = model.grid[r][c]
            let style: any = {
                position: "absolute", left: `${c * CELL_SIZE}px`, top: `${r * CELL_SIZE}px`,
                width: `${CELL_SIZE}px`, height: `${CELL_SIZE}px`,
            }

            if (cell.type === "hard") {
                style.backgroundColor = "#B0B0B0"
                style.borderTop = `4px solid ${highlight}`; style.borderLeft = `4px solid ${highlight}`
                style.borderRight = `4px solid ${shadow}`; style.borderBottom = `4px solid ${shadow}`
                style.boxSizing = "border-box"
                elements.push(h("div", { style }, [
                    h("div", { style: { width: "100%", height: "100%", border: "2px solid #999", boxSizing: "border-box" } })
                ]))
            } else if (cell.type === "soft") {
                if (cell.isDestroying) {
                    style.backgroundColor = "#FF4500"; style.border = "2px solid #FFFF00"; style.boxShadow = "inset 0 0 10px #FFFF00"
                    elements.push(h("div", { style }, [
                         h("div", { style: { width: "100%", height: "100%", backgroundColor: "rgba(255, 255, 0, 0.5)" } })
                    ]))
                } else {
                    style.backgroundColor = "#202020"; style.display = "flex"; style.flexDirection = "column"; style.boxSizing = "border-box"
                    const brick = (w: string, mr: boolean = false) => h("div", {
                        style: {
                            width: w, height: "100%", backgroundColor: "#9AA2AB",
                            borderTop: `2px solid ${highlight}`, borderLeft: `2px solid ${highlight}`,
                            borderBottom: `2px solid ${shadow}`, borderRight: mr ? "2px solid #202020" : `2px solid ${shadow}`, boxSizing: "border-box"
                        }
                    })
                    elements.push(h("div", { style }, [
                        h("div", { style: { width: "100%", height: "13px", display: "flex" } }, [ brick("100%") ]),
                        h("div", { style: { width: "100%", height: "13px", display: "flex" } }, [ brick("33.33%", true), brick("66.67%") ]),
                        h("div", { style: { width: "100%", height: "14px", display: "flex" } }, [ brick("50%", true), brick("50%") ])
                    ]))
                }
            } else if (cell.powerup) {
                let color = "#fff", text = "?"
                if (cell.powerup === "FireUp") { color = "#FF4500"; text = "🔥"; }
                if (cell.powerup === "BombUp") { color = "#000"; text = "💣"; }
                if (cell.powerup === "SpeedUp") { color = "#1E90FF"; text = "👞"; }
                elements.push(h("div", {
                    style: {
                        position: "absolute", left: `${c * CELL_SIZE + 5}px`, top: `${r * CELL_SIZE + 5}px`,
                        width: `${CELL_SIZE - 10}px`, height: `${CELL_SIZE - 10}px`, backgroundColor: "#fff",
                        border: `2px solid ${color}`, borderRadius: "5px", display: "flex", justifyContent: "center",
                        alignItems: "center", fontSize: "20px", zIndex: "2", boxShadow: "0 2px 5px rgba(0,0,0,0.3)"
                    }
                }, text))
            }
        }
    }
    return elements
}

const renderBombs = (model: Model) => {
    return model.bombs.map(bomb => {
        const frame = Math.floor(model.currentTime / 5) % 2
        const size = frame === 0 ? 30 : 34
        return h("div", {
            style: {
                position: "absolute", left: `${Math.floor(bomb.position.col) * CELL_SIZE}px`, top: `${Math.floor(bomb.position.row) * CELL_SIZE}px`,
                width: `${CELL_SIZE}px`, height: `${CELL_SIZE}px`, zIndex: "10", display: "flex", justifyContent: "center", alignItems: "center"
            }
        }, [
            h("div", { style: { position: "relative", width: `${size}px`, height: `${size}px`, transition: "width 0.1s, height 0.1s" } }, [
                h("div", { style: { width: "100%", height: "100%", backgroundColor: "#000", borderRadius: "50%", border: "2px solid #333", boxShadow: "2px 4px 6px rgba(0,0,0,0.5)", position: "absolute", zIndex: "1" } }, [
                     h("div", { style: { position: "absolute", top: "15%", left: "15%", width: "35%", height: "35%", backgroundColor: "#fff", borderRadius: "50%" } })
                ]),
                h("div", { style: { position: "absolute", top: "-4px", left: "50%", transform: "translateX(-50%)", width: "10px", height: "6px", backgroundColor: "#FFD700", border: "1px solid #000", borderRadius: "2px", zIndex: "0" } }),
                h("div", { style: { position: "absolute", top: "-10px", left: "50%", width: "4px", height: "6px", backgroundColor: (model.currentTime % 4 < 2) ? "#FF4500" : "#FFFF00", borderRadius: "50%", zIndex: "2", boxShadow: "0 0 5px #FF4500" } })
            ])
        ])
    })
}

const renderExplosions = (model: Model) => {
    const elements = []
    for (const exp of model.explosions) {
        for (const pos of exp.cells) {
            elements.push(h("div", {
                style: {
                    position: "absolute", left: `${Math.floor(pos.col) * CELL_SIZE}px`, top: `${Math.floor(pos.row) * CELL_SIZE}px`,
                    width: `${CELL_SIZE}px`, height: `${CELL_SIZE}px`, backgroundColor: "#FFFF00", border: "4px solid #FF4500",
                    zIndex: "15", display: "flex", justifyContent: "center", alignItems: "center", boxShadow: "0 0 15px #FF4500", boxSizing: "border-box"
                }
            }, [ h("div", { style: { width: "60%", height: "60%", backgroundColor: "#FFF", borderRadius: "50%" } }) ]))
        }
    }
    return elements
}

const renderPlayers = (model: Model) => {
    return model.players.map(p => {
        if (!p.isAlive) return null

        const accessoryColor = "#E6005C", faceColor = "#FFCC99", beltColor = "#F0F0F0"
        const isBack = p.direction === "up"
        const isSide = p.direction === "left" || p.direction === "right"
        const isRight = p.direction === "right"
        const animFrame = p.isMoving ? Math.floor(model.currentTime / 4) % 2 : 0

        let leftHandTop = "24px", rightHandTop = "24px"
        if (p.isMoving) {
            if (isSide) { leftHandTop = animFrame === 0 ? "26px" : "22px" }
            else { leftHandTop = animFrame === 0 ? "26px" : "22px"; rightHandTop = animFrame === 0 ? "22px" : "26px" }
        }
        const leftFootTop = animFrame === 0 ? "32px" : "30px"
        const rightFootTop = animFrame === 0 ? "30px" : "32px"

        return h("div", {
            style: {
                position: "absolute", left: `${p.position.col * CELL_SIZE}px`, top: `${p.position.row * CELL_SIZE}px`,
                width: `${CELL_SIZE}px`, height: `${CELL_SIZE}px`, zIndex: "20",
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                filter: "drop-shadow(0px 2px 2px rgba(0,0,0,0.4))",
            }
        }, [
            // Pom
            h("div", { style: { width: "6px", height: "6px", backgroundColor: accessoryColor, borderRadius: "50%", border: "1px solid #000", position: "absolute", top: "1px", zIndex: "25", left: isSide ? (isRight ? "10px" : "24px") : "17px" } }),
            // Helmet
            h("div", {
                style: { width: "22px", height: "20px", backgroundColor: p.color, borderRadius: "6px 6px 8px 8px", border: "2px solid #000", position: "absolute", top: "5px", zIndex: "24", display: "flex", justifyContent: "center", alignItems: "center", transform: isRight && isSide ? "scaleX(-1)" : "none" }
            }, [
                !isBack ? h("div", { style: { width: isSide ? "10px" : "14px", height: "10px", backgroundColor: faceColor, borderRadius: "3px", border: "1px solid #000", position: "absolute", top: "5px", left: isSide ? "2px" : "auto" } }, [
                    h("div", { style: { width: "2px", height: "5px", backgroundColor: "#000", position: "absolute", top: "1px", left: "2px" } }),
                    !isSide ? h("div", { style: { width: "2px", height: "5px", backgroundColor: "#000", position: "absolute", top: "1px", right: "2px" } }) : null
                ]) : null
            ]),
            // Body
            h("div", { style: { width: isSide ? "12px" : "16px", height: "11px", backgroundColor: p.subColor, border: "2px solid #000", borderRadius: "3px", position: "absolute", top: "23px", zIndex: "23", display: "flex", justifyContent: "center", alignItems: "center" } }, [
                h("div", { style: { width: "100%", height: "3px", backgroundColor: beltColor, marginTop: "4px" } })
            ]),
            // Hands
            h("div", { style: { width: "7px", height: "7px", backgroundColor: accessoryColor, borderRadius: "50%", border: "1px solid #000", position: "absolute", top: leftHandTop, left: isSide ? "14px" : "4px", zIndex: "26", display: (isSide && isRight) ? "none" : "block" } }),
            h("div", { style: { width: "7px", height: "7px", backgroundColor: accessoryColor, borderRadius: "50%", border: "1px solid #000", position: "absolute", top: rightHandTop, right: isSide ? "14px" : "4px", zIndex: "26", display: (isSide && !isRight) ? "none" : "block" } }),
            // Feet
            h("div", { style: { width: "8px", height: "6px", backgroundColor: accessoryColor, borderRadius: "3px", border: "1px solid #000", position: "absolute", top: leftFootTop, left: "8px", zIndex: "23", transition: "top 0.1s" } }),
            h("div", { style: { width: "8px", height: "6px", backgroundColor: accessoryColor, borderRadius: "3px", border: "1px solid #000", position: "absolute", top: rightFootTop, right: "8px", zIndex: "23", transition: "top 0.1s" } }),
        ])
    })
}

const renderGameOver = (model: Model) => {
    return h("div", {
        style: {
            position: "absolute", top: "0", left: "0", width: "100%", height: "100%",
            backgroundColor: "rgba(0, 0, 0, 0.7)", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center",
            zIndex: "100", color: "#fff", textShadow: "2px 2px #000"
        }
    }, [
        h("h2", { style: { fontSize: "40px", marginBottom: "20px" } }, "GAME OVER"),
        h("h3", { style: { fontSize: "24px", color: "#FFD700" } }, model.gameOverMessage)
    ])
}