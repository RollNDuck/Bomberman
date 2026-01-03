import { Array as EffectArray } from "effect"

const getUrl = (path: string) => new URL(`../assets/${path}`, import.meta.url).href

export const SOUNDS = {
    EXPLODE: getUrl('sfx/explode.wav'),
    POWERUP: getUrl('sfx/powerup.wav'),
    DEATH: getUrl('sfx/death.mp3'),
}

export const IMAGES = {
    FLOOR: getUrl('img/level/floor.png'),
    HARD_BLOCK: getUrl('img/level/hard_block.png'),
    SOFT_BLOCK_FRAMES: EffectArray.map(EffectArray.range(1, 9), i =>
        getUrl(`img/level/soft_block/${i}.png`)
    ),

    BOMB_FRAMES: EffectArray.map(EffectArray.range(1, 3), i =>
        getUrl(`img/bomb/${i}.png`)
    ),

    EXPLOSION: EffectArray.map(EffectArray.range(1, 7), i =>
        getUrl(`img/bomb/explosion/${i}.png`)
    ),

    PLAYERS: {
        P1: {
            STAND: {
                down: getUrl('img/bombermen/characters/p1/stand/down.png'),
                left: getUrl('img/bombermen/characters/p1/stand/left.png'),
                right: getUrl('img/bombermen/characters/p1/stand/right.png'),
                up: getUrl('img/bombermen/characters/p1/stand/top.png'),
            },
            WALK_LEFT: {
                down: getUrl('img/bombermen/characters/p1/walk/left/down.png'),
                left: getUrl('img/bombermen/characters/p1/walk/left/left.png'),
                right: getUrl('img/bombermen/characters/p1/walk/left/right.png'),
                up: getUrl('img/bombermen/characters/p1/walk/left/top.png'),
            },
            WALK_RIGHT: {
                down: getUrl('img/bombermen/characters/p1/walk/right/down.png'),
                left: getUrl('img/bombermen/characters/p1/walk/right/left.png'),
                right: getUrl('img/bombermen/characters/p1/walk/right/right.png'),
                up: getUrl('img/bombermen/characters/p1/walk/right/top.png'),
            },
            DEATH: EffectArray.map(EffectArray.range(1, 7), i =>
                getUrl(`img/bombermen/characters/death/p1/${i}.png`)
            ),
        },
        P2: {
            STAND: {
                down: getUrl('img/bombermen/characters/p2/stand/down.png'),
                left: getUrl('img/bombermen/characters/p2/stand/left.png'),
                right: getUrl('img/bombermen/characters/p2/stand/right.png'),
                up: getUrl('img/bombermen/characters/p2/stand/top.png'),
            },
            WALK_LEFT: {
                down: getUrl('img/bombermen/characters/p2/walk/left/down.png'),
                left: getUrl('img/bombermen/characters/p2/walk/left/left.png'),
                right: getUrl('img/bombermen/characters/p2/walk/left/right.png'),
                up: getUrl('img/bombermen/characters/p2/walk/left/top.png'),
            },
            WALK_RIGHT: {
                down: getUrl('img/bombermen/characters/p2/walk/right/down.png'),
                left: getUrl('img/bombermen/characters/p2/walk/right/left.png'),
                right: getUrl('img/bombermen/characters/p2/walk/right/right.png'),
                up: getUrl('img/bombermen/characters/p2/walk/right/top.png'),
            },
            DEATH: EffectArray.map(EffectArray.range(1, 7), i =>
                getUrl(`img/bombermen/characters/death/p2/${i}.png`)
            ),
        },
        P3: {
            STAND: {
                down: getUrl('img/bombermen/characters/p3/stand/down.png'),
                left: getUrl('img/bombermen/characters/p3/stand/left.png'),
                right: getUrl('img/bombermen/characters/p3/stand/right.png'),
                up: getUrl('img/bombermen/characters/p3/stand/top.png'),
            },
            WALK_LEFT: {
                down: getUrl('img/bombermen/characters/p3/walk/left/down.png'),
                left: getUrl('img/bombermen/characters/p3/walk/left/left.png'),
                right: getUrl('img/bombermen/characters/p3/walk/left/right.png'),
                up: getUrl('img/bombermen/characters/p3/walk/left/top.png'),
            },
            WALK_RIGHT: {
                down: getUrl('img/bombermen/characters/p3/walk/right/down.png'),
                left: getUrl('img/bombermen/characters/p3/walk/right/left.png'),
                right: getUrl('img/bombermen/characters/p3/walk/right/right.png'),
                up: getUrl('img/bombermen/characters/p3/walk/right/top.png'),
            },
            DEATH: EffectArray.map(EffectArray.range(1, 7), i =>
                getUrl(`img/bombermen/characters/death/p3/${i}.png`)
            ),
        },
        P4: {
            STAND: {
                down: getUrl('img/bombermen/characters/p4/stand/down.png'),
                left: getUrl('img/bombermen/characters/p4/stand/left.png'),
                right: getUrl('img/bombermen/characters/p4/stand/right.png'),
                up: getUrl('img/bombermen/characters/p4/stand/top.png'),
            },
            WALK_LEFT: {
                down: getUrl('img/bombermen/characters/p4/walk/left/down.png'),
                left: getUrl('img/bombermen/characters/p4/walk/left/left.png'),
                right: getUrl('img/bombermen/characters/p4/walk/left/right.png'),
                up: getUrl('img/bombermen/characters/p4/walk/left/top.png'),
            },
            WALK_RIGHT: {
                down: getUrl('img/bombermen/characters/p4/walk/right/down.png'),
                left: getUrl('img/bombermen/characters/p4/walk/right/left.png'),
                right: getUrl('img/bombermen/characters/p4/walk/right/right.png'),
                up: getUrl('img/bombermen/characters/p4/walk/right/top.png'),
            },
            DEATH: EffectArray.map(EffectArray.range(1, 7), i =>
                getUrl(`img/bombermen/characters/death/p4/${i}.png`)
            ),
        }
    },

    POWERUPS: {
        BOMB_UP: [
            getUrl('img/powerup/bomb_up1.png'),
            getUrl('img/powerup/bomb_up2.png')
        ],
        FIRE_UP: [
            getUrl('img/powerup/fire_up1.png'),
            getUrl('img/powerup/fire_up2.png')
        ],
        SPEED_UP: [
            getUrl('img/powerup/speed_up1.png'),
            getUrl('img/powerup/speed_up2.png')
        ]
    }
}