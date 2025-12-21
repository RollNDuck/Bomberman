import { startSimple } from "cs12251-mvu/src"
import { initModel } from "./model"
import { view } from "./view"
import { update } from "./update"

const root = document.getElementById("app")!

// Set up event listeners globally
let dispatchFn: ((msg: any) => void) | null = null

// Wrap view to capture dispatch function
const wrappedView = (model: any, dispatch: any) => {
  if (!dispatchFn) {
    dispatchFn = dispatch
    setupEventListeners()
  }
  return view(model, dispatch)
}

const setupEventListeners = () => {
  if (!dispatchFn) return

  // Keyboard events
  document.addEventListener("keydown", (e) => {
    e.preventDefault()
    dispatchFn?.({ _tag: "KeyDown", key: e.key })
  })

  document.addEventListener("keyup", (e) => {
    e.preventDefault()
    dispatchFn?.({ _tag: "KeyUp", key: e.key })
  })

  // Game tick (30 FPS)
  setInterval(() => {
    dispatchFn?.({ _tag: "Tick" })
  }, 1000 / 30)
}

// Start the app
startSimple(root, initModel, update, wrappedView)