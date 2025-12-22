import { startSimple } from "cs12251-mvu/src"
import { initModel } from "./model"
import { view } from "./view"
import { update } from "./update"

const root = document.getElementById("app")!

let currentDispatch: ((msg: any) => void) | null = null

const wrappedView = (model: any, dispatch: (msg: any) => void) => {
    if (!currentDispatch) {
        currentDispatch = dispatch
        setupEventListeners()
    }
    return view(model, dispatch)
}

const setupEventListeners = () => {
    if (!currentDispatch) return

    document.addEventListener("keydown", (e) => {
        if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " ",
             "w", "a", "s", "d", "x", "Escape", "r", "R"].includes(e.key)) {
            e.preventDefault()
        }
        currentDispatch?.({ _tag: "KeyDown", key: e.key })
    })

    document.addEventListener("keyup", (e) => {
        if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " ",
             "w", "a", "s", "d", "x"].includes(e.key)) {
            e.preventDefault()
        }
        currentDispatch?.({ _tag: "KeyUp", key: e.key })
    })

    setInterval(() => {
        currentDispatch?.({ _tag: "Tick" })
    }, 1000 / 30)
}

startSimple(root, initModel, update, wrappedView)