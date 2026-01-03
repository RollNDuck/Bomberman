import { SOUNDS } from "./assets";

export const audioManager = {
    playSFX: (key: keyof typeof SOUNDS) => {
        const sfx = new Audio(SOUNDS[key]);
        sfx.volume = 0.8;
        sfx.play().catch(e => {});
    }
}