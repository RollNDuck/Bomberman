// This file acts as a central registry for asset paths.
// In a real bundler environment (Vite/Webpack), you would likely import these directly.

export const ASSETS = {
    img: {
        p1_sheet: "/src/assets/img/p1_sheet.png",
        p2_sheet: "/src/assets/img/p2_sheet.png",
        p3_sheet: "/src/assets/img/p3_sheet.png",
        p4_sheet: "/src/assets/img/p4_sheet.png",
        bomb_sheet: "/src/assets/img/bomb_sheet.png",
        explosion_sheet: "/src/assets/img/explosion_sheet.png",
        tiles: "/src/assets/img/tiles.png",
        powerups: "/src/assets/img/powerups.png"
    },
    sfx: {
        explode: "/src/assets/sfx/explode.mp3",
        death: "/src/assets/sfx/death.mp3",
        powerup: "/src/assets/sfx/powerup.mp3"
    }
}