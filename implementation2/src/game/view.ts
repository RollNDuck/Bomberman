import { Array as EffectArray } from "effect"
import { Model, GRID_ROWS, GRID_COLS, CELL_SIZE, FPS, Player, BASE_SPEED, EXPLOSION_DURATION, Bomb, Explosion } from "./model"
import { Msg } from "./msg"
import { h } from "cs12251-mvu/src"
import { IMAGES } from "./assets"

export const view = (model: Model, dispatch: (msg: Msg) => void) => {
    const timeToDisplay = model.state === "warmup" ? model.roundTimer : model.roundTimer
    const seconds = Math.ceil(timeToDisplay / FPS)

    let timeStr = `${Math.floor(seconds/60)}:${(seconds%60).toString().padStart(2,'0')}`
    if (model.state === "warmup") {
        if (seconds > 2) timeStr = "Ready..."
        else if (seconds > 1) timeStr = "Set..."
        else timeStr = "GO!"
    }

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
        h("div", {
            style: {
                display: "flex", justifyContent: "space-between", alignItems: "center",
                width: `${GRID_COLS * CELL_SIZE}px`,
                backgroundColor: "#00AAAA",
                border: "3px solid #ECECEC", borderBottom: "3px solid #000",
                padding: "5px 15px", marginBottom: "0px", boxSizing: "border-box", height: "50px"
            }
        }, [
            h("div", { style: { display: "flex", alignItems: "center", fontWeight: "bold", color: "#FFF" } }, [
                 h("div", { style: { marginRight: "10px" } }, `R${model.roundNumber}`),
                 h("div", {
                     style: {
                         backgroundColor: "#000", color: "#fff", padding: "2px 5px",
                         fontFamily: "monospace", fontSize: "20px", fontWeight: "bold",
                         border: "2px solid #ECECEC",
                         minWidth: "80px", textAlign: "center"
                     }
                 }, timeStr)
            ]),
            h("div", { style: { display: "flex", gap: "10px" } },
                EffectArray.map(model.players, p =>
                    h("div", { style: { display: "flex", alignItems: "center", opacity: p.isAlive ? 1 : 0.5 } }, [
                        h("div", {
                            style: {
                                width: "20px", height: "20px", backgroundColor: p.color,
                                border: "2px solid #000", borderRadius: "50%", marginRight: "5px"
                            }
                        }),
                        h("div", {
                            style: { backgroundColor: "#000", color: "#fff", padding: "0 5px", border: "1px solid #fff" }
                        }, p.wins.toString())
                    ])
                )
            )
        ]),

        h("div", {
            style: {
                position: "relative",
                width: `${GRID_COLS * CELL_SIZE}px`,
                height: `${GRID_ROWS * CELL_SIZE}px`,
                backgroundColor: "#388700",
                border: "none",
                backgroundImage: `url("${IMAGES.FLOOR}")`,
                backgroundRepeat: "repeat",
                backgroundSize: `${CELL_SIZE}px`,
                imageRendering: "pixelated"
            }
        }, [
            renderGrid(model),
            renderBombs(model),
            renderExplosions(model),
            renderPlayers(model),
            renderBotDebug(model),
            renderOverlays(model),
            model.gamePhase === "gameOver" ? renderGameOver(model) : null
        ].flat().filter(Boolean))
    ])
}

const renderOverlays = (model: Model) => {
    if (model.state === "warmup") {
        const seconds = Math.ceil(model.roundTimer / FPS)
        let text = seconds.toString()
        if (seconds > 2) text = "Ready..."
        else if (seconds > 1) text = "Set..."
        else text = "GO!"

        return h("div", {
            style: {
                position: "absolute", top: 0, left: 0, width: "100%", height: "100%",
                display: "flex", justifyContent: "center", alignItems: "center",
                backgroundColor: "rgba(0,0,0,0.3)", color: "#FFF", fontSize: "80px", fontWeight: "bold",
                textShadow: "4px 4px #000", zIndex: 100
            }
        }, text)
    }

    if (model.state === "roundOver" || model.state === "matchOver") {
        const title = model.state === "matchOver" ? "MATCH OVER" : "ROUND OVER"
        const sub = model.roundWinner === "Draw" ? "Draw!" : `${model.roundWinner} Wins!`
        const help = model.state === "matchOver" ? "Champion!" : "Press ESC"

        const scoreList = h("div", { style: { display: "flex", gap: "20px", marginTop: "20px" } },
            EffectArray.map(model.players, p => h("div", {
                style: { display: "flex", alignItems: "center", fontSize: "24px", color: p.isAlive ? "#fff" : "#aaa" }
            }, [
                h("div", {
                    style: { width: "20px", height: "20px", backgroundColor: p.color, marginRight: "10px", border: "1px solid #fff" }
                }),
                `${p.label}: ${p.wins}`
            ]))
        )

        return h("div", {
            style: {
                position: "absolute", top: 0, left: 0, width: "100%", height: "100%",
                display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center",
                backgroundColor: "rgba(0,0,0,0.85)", color: "#FFF", zIndex: 100
            }
        }, [
            h("h1", { style: { fontSize: "60px", color: "#FFD700", marginBottom: "20px" } }, title),
            h("h2", { style: { fontSize: "40px", marginBottom: "10px" } }, sub),
            scoreList,
            h("p", { style: { fontSize: "20px", marginTop: "40px" } }, help)
        ])
    }
    return null
}

const renderGrid = (model: Model) => {
    const elements = []

    for (let r = 0; r < GRID_ROWS; r++) {
        for (let c = 0; c < GRID_COLS; c++) {
            const cell = model.grid[r][c]

            // Render floor background
            elements.push(h("div", {
                style: {
                    position: "absolute",
                    left: `${c * CELL_SIZE}px`,
                    top: `${r * CELL_SIZE}px`,
                    width: `${CELL_SIZE}px`,
                    height: `${CELL_SIZE}px`,
                    backgroundImage: `url("${IMAGES.FLOOR}")`,
                    backgroundSize: "cover",
                    zIndex: "0",
                    imageRendering: "pixelated"
                }
            }))

            if (cell.type === "hard") {
                // Hard block
                elements.push(h("div", {
                    style: {
                        position: "absolute",
                        left: `${c * CELL_SIZE}px`,
                        top: `${r * CELL_SIZE}px`,
                        width: `${CELL_SIZE}px`,
                        height: `${CELL_SIZE}px`,
                        backgroundImage: `url("${IMAGES.HARD_BLOCK}")`,
                        backgroundSize: "cover",
                        zIndex: "1",
                        imageRendering: "pixelated"
                    }
                }))
            } else if (cell.type === "soft") {
                // Soft block
                let opacity = 1;
                let frameIndex = 0;

                if (cell.isDestroying) {
                    const maxTime = FPS * 1.1;
                    const progress = 1 - (cell.destroyTimer / maxTime);
                    opacity = 1 - progress;
                    frameIndex = Math.min(Math.floor(progress * 9), 8);
                }

                elements.push(h("div", {
                    style: {
                        position: "absolute",
                        left: `${c * CELL_SIZE}px`,
                        top: `${r * CELL_SIZE}px`,
                        width: `${CELL_SIZE}px`,
                        height: `${CELL_SIZE}px`,
                        backgroundImage: `url("${IMAGES.SOFT_BLOCK_FRAMES[frameIndex]}")`,
                        backgroundSize: "cover",
                        zIndex: "1",
                        opacity: opacity,
                        imageRendering: "pixelated",
                        transition: opacity > 0.1 ? "opacity 0.1s" : "none"
                    }
                }))
            } else if (cell.powerup) {
                // Animated power-up
                const bob = Math.sin(model.currentTime / 5) * 4;
                let powerupFrames: string[] = [];
                let filter = "none";

                switch(cell.powerup) {
                    case "FireUp":
                        powerupFrames = IMAGES.POWERUPS.FIRE_UP;
                        break;
                    case "BombUp":
                        powerupFrames = IMAGES.POWERUPS.BOMB_UP;
                        break;
                    case "SpeedUp":
                        powerupFrames = IMAGES.POWERUPS.SPEED_UP;
                        break;
                    case "Rainbow":
                        // Rainbow cycles through different powerups
                        const rainbowIndex = Math.floor(model.currentTime / 10) % 3;
                        powerupFrames = [
                            IMAGES.POWERUPS.FIRE_UP[rainbowIndex % IMAGES.POWERUPS.FIRE_UP.length],
                            IMAGES.POWERUPS.BOMB_UP[rainbowIndex % IMAGES.POWERUPS.BOMB_UP.length],
                            IMAGES.POWERUPS.SPEED_UP[rainbowIndex % IMAGES.POWERUPS.SPEED_UP.length]
                        ];
                        filter = "hue-rotate(180deg)";
                        break;
                    case "Vest":
                        // Use bomb up image with gold tint for vest
                        powerupFrames = IMAGES.POWERUPS.BOMB_UP;
                        filter = "hue-rotate(60deg) brightness(1.5)";
                        break;
                }

                if (powerupFrames.length > 0) {
                    const frameIndex = Math.floor(model.currentTime / 10) % powerupFrames.length;
                    const currentFrame = powerupFrames[frameIndex];

                    elements.push(h("div", {
                        style: {
                            position: "absolute",
                            left: `${c * CELL_SIZE}px`,
                            top: `${r * CELL_SIZE + bob}px`,
                            width: `${CELL_SIZE}px`,
                            height: `${CELL_SIZE}px`,
                            backgroundImage: `url("${currentFrame}")`,
                            backgroundSize: "contain",
                            backgroundRepeat: "no-repeat",
                            backgroundPosition: "center",
                            zIndex: "2",
                            imageRendering: "pixelated",
                            filter: filter
                        }
                    }))
                }
            }
        }
    }
    return elements
}

const renderBombs = (model: Model) => {
    return EffectArray.map(model.bombs, bomb => {
        const frameIndex = Math.floor(model.currentTime / 10) % IMAGES.BOMB_FRAMES.length;
        const bombImage = IMAGES.BOMB_FRAMES[frameIndex];

        return h("div", {
            style: {
                position: "absolute", left: `${Math.floor(bomb.position.col) * CELL_SIZE}px`, top: `${Math.floor(bomb.position.row) * CELL_SIZE}px`,
                width: `${CELL_SIZE}px`, height: `${CELL_SIZE}px`, zIndex: "10", display: "flex", justifyContent: "center", alignItems: "center",
                backgroundImage: `url("${bombImage}")`,
                backgroundSize: "contain",
                backgroundRepeat: "no-repeat",
                backgroundPosition: "center",
                imageRendering: "pixelated",
                filter: bomb.range > 1 ? "hue-rotate(180deg) saturate(1.5)" : "none"
            }
        })
    })
}

const renderExplosions = (model: Model) => {
    const elements = []

    for (const exp of model.explosions) {
        const age = model.currentTime - exp.createdAt;
        const maxAge = FPS * 1; // 1 second explosion duration
        const lifeLeft = 1 - (age / maxAge);

        // 7 frames instead of 4
        const frameCount = 7;
        const frameIndex = Math.min(Math.floor((1 - lifeLeft) * frameCount), frameCount - 1);
        const opacity = Math.min(1, lifeLeft * 1.5);

        // Use the simple explosion array with 7 frames
        const explosionImage = IMAGES.EXPLOSION[frameIndex];

        // If explosions have chain cells, render them all with the same sprite
        for (const pos of exp.cells) {
            elements.push(h("div", {
                style: {
                    position: "absolute",
                    left: `${Math.floor(pos.col) * CELL_SIZE}px`,
                    top: `${Math.floor(pos.row) * CELL_SIZE}px`,
                    width: `${CELL_SIZE}px`,
                    height: `${CELL_SIZE}px`,
                    zIndex: "15",
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    backgroundImage: `url("${explosionImage}")`,
                    backgroundSize: "contain",
                    backgroundRepeat: "no-repeat",
                    backgroundPosition: "center",
                    opacity: opacity,
                    imageRendering: "pixelated",
                    pointerEvents: "none"
                }
            }));
        }
    }
    return elements
}

const renderBotDebug = (model: Model) => {
    if (!model.isDebugMode) return []

    const debugElements: any[] = []
    for (const p of model.players) {
        if (p.isHuman || !p.isAlive) continue

        if (p.dangerCheckDistance > 0) {
            const radius = p.dangerCheckDistance * CELL_SIZE
            debugElements.push(h("div", {
                style: {
                    position: "absolute",
                    left: `${(p.position.col * CELL_SIZE) + (CELL_SIZE / 2) - radius}px`,
                    top: `${(p.position.row * CELL_SIZE) + (CELL_SIZE / 2) - radius}px`,
                    width: `${radius * 2}px`,
                    height: `${radius * 2}px`,
                    border: "2px dashed rgba(255, 0, 0, 0.5)",
                    borderRadius: "50%",
                    zIndex: "40",
                    pointerEvents: "none"
                }
            }))
        }

        const botTypeText = p.botType ? p.botType : "human"
        const botStateText = p.botState ? p.botState : "none"

        debugElements.push(h("div", {
            style: {
                position: "absolute",
                left: `${p.position.col * CELL_SIZE}px`,
                top: `${p.position.row * CELL_SIZE - 25}px`,
                backgroundColor: "rgba(0, 0, 0, 0.8)",
                color: "#fff",
                fontSize: "12px",
                padding: "2px 4px",
                zIndex: "50",
                whiteSpace: "nowrap",
                borderRadius: "2px",
                pointerEvents: "none",
                transform: "translateX(-50%)",
                marginLeft: `${CELL_SIZE / 2}px`,
                border: "1px solid #fff"
            }
        }, `${botTypeText}: ${botStateText}`))

        if (p.botPath && p.botPath.length > 0) {
            for (let i = 0; i < p.botPath.length; i++) {
                const pos = p.botPath[i]
                let cornerStyle: any = {}

                if (p.id === 2) {
                    cornerStyle = { top: "2px", right: "2px", left: "auto", bottom: "auto" }
                } else if (p.id === 3) {
                    cornerStyle = { bottom: "2px", left: "2px", top: "auto", right: "auto" }
                } else if (p.id === 4) {
                    cornerStyle = { bottom: "2px", right: "2px", top: "auto", left: "auto" }
                } else {
                    cornerStyle = { top: "2px", left: "2px", right: "auto", bottom: "auto" }
                }

                debugElements.push(h("div", {
                    style: {
                        position: "absolute",
                        left: `${pos.col * CELL_SIZE}px`,
                        top: `${pos.row * CELL_SIZE}px`,
                        width: `${CELL_SIZE}px`,
                        height: `${CELL_SIZE}px`,
                        zIndex: "35",
                        pointerEvents: "none"
                    }
                }, [
                    h("div", {
                        style: {
                            position: "absolute",
                            width: "8px",
                            height: "8px",
                            backgroundColor: p.color,
                            border: "1px solid #000",
                            ...cornerStyle
                        }
                    })
                ]))
            }
        }

        if (p.botGoal && p.botGoal.row !== -1) {
            debugElements.push(h("div", {
                style: {
                    position: "absolute",
                    left: `${p.botGoal.col * CELL_SIZE + CELL_SIZE/2 - 8}px`,
                    top: `${p.botGoal.row * CELL_SIZE + CELL_SIZE/2 - 8}px`,
                    width: "16px",
                    height: "16px",
                    backgroundColor: p.color,
                    border: "2px solid #000",
                    borderRadius: "50%",
                    zIndex: "35",
                    pointerEvents: "none",
                    opacity: 0.8
                }
            }))
        }
    }
    return debugElements
}

const renderPlayers = (model: Model) => {
    return EffectArray.map(model.players, p => {
        // SELECT ASSETS BASED ON PLAYER ID
        const playerKey = `P${p.id}` as keyof typeof IMAGES.PLAYERS;
        const playerAssets = IMAGES.PLAYERS[playerKey];
        const assets = playerAssets || IMAGES.PLAYERS.P1;

        if (!p.isAlive) {
            const deathTime = p.deathTime || model.currentTime;
            const deathAge = model.currentTime - deathTime;
            const deathDuration = FPS * 2;
            const deathProgress = Math.min(deathAge / deathDuration, 1);
            const deathFrameIndex = Math.min(Math.floor(deathProgress * 7), 6);

            const deathImage = assets.DEATH[deathFrameIndex];

            return h("div", {
                style: {
                    position: "absolute", left: `${p.position.col * CELL_SIZE}px`, top: `${p.position.row * CELL_SIZE}px`,
                    width: `${CELL_SIZE}px`, height: `${CELL_SIZE}px`, zIndex: "20",
                    backgroundImage: `url("${deathImage}")`,
                    backgroundSize: "contain", backgroundRepeat: "no-repeat", backgroundPosition: "center",
                    imageRendering: "pixelated",
                }
            })
        }

        let playerImage: string;
        const walkCycle = Math.floor(model.currentTime / 8) % 2;

        if (p.isMoving) {
            const dir = p.direction === "up" ? "up" : p.direction;
            // @ts-ignore
            playerImage = assets.WALK_LEFT[dir] || assets.WALK_LEFT.down; // Fallback
            if (walkCycle !== 0) {
                 // @ts-ignore
                playerImage = assets.WALK_RIGHT[dir] || assets.WALK_RIGHT.down;
            }
        } else {
            // @ts-ignore
            playerImage = assets.STAND[p.direction === "up" ? "up" : p.direction] || assets.STAND.down;
        }

        let statusEmojis = ""
        if (p.rainbowTimers?.FireUp > 0 || p.rainbowTimers?.BombUp > 0 || p.rainbowTimers?.SpeedUp > 0) statusEmojis += "🌈"
        if (p.hasVest) statusEmojis += "🛡️"
        if (p.bombRange > 1) statusEmojis += "🔥"
        if (p.maxBombs > 1) statusEmojis += "💣"
        if (p.speed > BASE_SPEED + 0.01) statusEmojis += "👟"

        return h("div", {
            style: {
                position: "absolute",
                left: `${p.position.col * CELL_SIZE}px`,
                top: `${p.position.row * CELL_SIZE}px`,
                width: `${CELL_SIZE}px`,
                height: `${CELL_SIZE}px`,
                zIndex: "20",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                ...(p.hasVest ? { filter: "drop-shadow(0 0 8px gold)" } : {})
            }
        }, [
            h("div", {
                style: {
                    position: "absolute", top: "-20px", fontSize: "14px", fontWeight: "bold", color: "#fff",
                    textShadow: "1px 1px 2px #000", zIndex: "30", whiteSpace: "nowrap",
                    backgroundColor: "rgba(0,0,0,0.5)", padding: "2px 5px", borderRadius: "3px"
                }
            }, `${p.label} ${statusEmojis}`),

            h("div", {
                style: {
                    width: `${CELL_SIZE}px`, height: `${CELL_SIZE}px`,
                    backgroundImage: `url("${playerImage}")`,
                    backgroundSize: "contain", backgroundRepeat: "no-repeat", backgroundPosition: "center",
                    imageRendering: "pixelated",
                    ...(p.hasVest ? { filter: `drop-shadow(0 0 8px gold)` } : {})
                }
            })
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