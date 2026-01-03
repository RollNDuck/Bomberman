// src/game/assets.ts

// Sound assets
export const SOUNDS = {
    EXPLODE: new URL('../assets/sfx/explode.wav', import.meta.url).href,
    POWERUP: new URL('../assets/sfx/powerup.wav', import.meta.url).href,
    DEATH: new URL('../assets/sfx/death.mp3', import.meta.url).href,
};

// Image assets with animations
export const IMAGES = {
    // Level tiles
    FLOOR: new URL('../assets/img/level/soft_block/floor.png', import.meta.url).href,
    HARD_BLOCK: new URL('../assets/img/level/soft_block/hard_block.png', import.meta.url).href,

    // Soft blocks - all 9 frames for destruction animation
    SOFT_BLOCK_FRAMES: Array.from({length: 9}, (_, i) =>
        new URL(`../assets/img/level/soft_block/${i + 1}.png`, import.meta.url).href
    ),

    // Bomb - 3 frames for animation
    BOMB_FRAMES: Array.from({length: 3}, (_, i) =>
        new URL(`../assets/img/bomb/${i + 1}.png`, import.meta.url).href
    ),

    // Explosion animations - complete with all types for proper explosions
    EXPLOSION: {
        // Center explosion (4 frames)
        CENTER: Array.from({length: 4}, (_, i) =>
            new URL(`../assets/img/bomb/explosion/center/${i + 1}.png`, import.meta.url).href
        ),
        // End explosions (4 frames each direction)
        END: {
            TOP: Array.from({length: 4}, (_, i) =>
                new URL(`../assets/img/bomb/explosion/end/top/${i + 1}.png`, import.meta.url).href
            ),
            DOWN: Array.from({length: 4}, (_, i) =>
                new URL(`../assets/img/bomb/explosion/end/down/${i + 1}.png`, import.meta.url).href
            ),
            LEFT: Array.from({length: 4}, (_, i) =>
                new URL(`../assets/img/bomb/explosion/end/left/${i + 1}.png`, import.meta.url).href
            ),
            RIGHT: Array.from({length: 4}, (_, i) =>
                new URL(`../assets/img/bomb/explosion/end/right/${i + 1}.png`, import.meta.url).href
            ),
        },
        // Mid explosions (varying frames per direction)
        MID: {
            TOP: Array.from({length: 2}, (_, i) =>
                new URL(`../assets/img/bomb/explosion/mid/top/${i + 1}.png`, import.meta.url).href
            ),
            DOWN: Array.from({length: 4}, (_, i) =>
                new URL(`../assets/img/bomb/explosion/mid/down/${i + 1}.png`, import.meta.url).href
            ),
            LEFT: Array.from({length: 4}, (_, i) =>
                new URL(`../assets/img/bomb/explosion/mid/left/${i + 1}.png`, import.meta.url).href
            ),
            RIGHT: Array.from({length: 4}, (_, i) =>
                new URL(`../assets/img/bomb/explosion/mid/right/${i + 1}.png`, import.meta.url).href
            ),
        }
    },

    // Player characters - with proper animations
    PLAYERS: {
        P1: {
            // Standing poses for each direction
            STAND: {
                DOWN: new URL('../assets/img/bombermen/characters/p1/stand/down.png', import.meta.url).href,
                LEFT: new URL('../assets/img/bombermen/characters/p1/stand/left.png', import.meta.url).href,
                RIGHT: new URL('../assets/img/bombermen/characters/p1/stand/right.png', import.meta.url).href,
                TOP: new URL('../assets/img/bombermen/characters/p1/stand/top.png', import.meta.url).href,
            },
            // Walking animations - left foot forward
            WALK_LEFT: {
                DOWN: new URL('../assets/img/bombermen/characters/p1/walk/left/down.png', import.meta.url).href,
                LEFT: new URL('../assets/img/bombermen/characters/p1/walk/left/left.png', import.meta.url).href,
                RIGHT: new URL('../assets/img/bombermen/characters/p1/walk/left/right.png', import.meta.url).href,
                TOP: new URL('../assets/img/bombermen/characters/p1/walk/left/top.png', import.meta.url).href,
            },
            // Walking animations - right foot forward
            WALK_RIGHT: {
                DOWN: new URL('../assets/img/bombermen/characters/p1/walk/right/down.png', import.meta.url).href,
                LEFT: new URL('../assets/img/bombermen/characters/p1/walk/right/left.png', import.meta.url).href,
                RIGHT: new URL('../assets/img/bombermen/characters/p1/walk/right/right.png', import.meta.url).href,
                TOP: new URL('../assets/img/bombermen/characters/p1/walk/right/top.png', import.meta.url).href,
            },
            // Death animation (7 frames)
            DEATH: Array.from({length: 7}, (_, i) =>
                new URL(`../assets/img/bombermen/characters/death/p1/${i + 1}.png`, import.meta.url).href
            ),
        },
        // Note: For P2-P4, you would duplicate the P1 structure with different hue rotation
    },

    // Power-ups with animation frames
    POWERUPS: {
        BOMB_UP: [
            new URL('../assets/img/powerup/bomb_up.png', import.meta.url).href,
            new URL('../assets/img/powerup/bomb_up1.png', import.meta.url).href,
            new URL('../assets/img/powerup/bomb_up2.png', import.meta.url).href,
        ],
        FIRE_UP: [
            new URL('../assets/img/powerup/fire_up.png', import.meta.url).href,
            new URL('../assets/img/powerup/fire_up1.png', import.meta.url).href,
            new URL('../assets/img/powerup/fire_up2.png', import.meta.url).href,
        ],
        SPEED_UP: [
            new URL('../assets/img/powerup/speed_up.png', import.meta.url).href,
            new URL('../assets/img/powerup/speed_up1.png', import.meta.url).href,
            new URL('../assets/img/powerup/speed_up2.png', import.meta.url).href,
        ]
    }
};