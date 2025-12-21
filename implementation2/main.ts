import { start } from "cs12251-mvu/src"
import { initModel } from "./model"
import { view } from "./view"
import { update } from "./update"
import { MsgKeyDown, MsgKeyUp, MsgGameTick } from "./msg"

const root = document.getElementById("app")!

// Set up event listeners
const keyDownListener = (e: KeyboardEvent) => {
  e.preventDefault()
  return MsgKeyDown.make({ key: e.key })
}

const keyUpListener = (e: KeyboardEvent) => {
  e.preventDefault()
  return MsgUp.make({ key: e.key })
}

// Set up game tick (30 FPS)
const tickInterval = 1000 / 30

// Start the application with event handling
start(
  root,
  initModel,
  update,
  view,
  {
    keydown: keyDownListener,
    keyup: keyUpListener
  },
  () => MsgGameTick.make({}),
  tickInterval
)