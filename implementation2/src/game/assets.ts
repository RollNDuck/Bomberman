// src/game/assets.ts

// 1. IMAGES
export const IMAGES = {
    FLOOR: new URL('../assets/img/floor.png', import.meta.url).href,
    HARD_BLOCK: new URL('../assets/img/hard_block.png', import.meta.url).href,
    SOFT_BLOCK: new URL('../assets/img/soft_block_sheet.png', import.meta.url).href,
    BOMB: new URL('../assets/img/bomb.png', import.meta.url).href,
    PLAYERS: new URL('../assets/img/bombermen.png', import.meta.url).href,
    POWERUPS: new URL('../assets/img/powerup.gif', import.meta.url).href,
}

// 2. SOUNDS
export const SOUNDS = {
    EXPLODE: new URL('../assets/sfx/explode.wav', import.meta.url).href,
    POWERUP: new URL('../assets/sfx/powerup.wav', import.meta.url).href,
    DEATH: new URL('../assets/sfx/death.mp3', import.meta.url).href,
}