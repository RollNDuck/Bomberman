import { Model } from "./model"
import { Msg, MsgIncrement, MsgDecrement, MsgReset } from "./msg"
import { h } from "cs12251-mvu/src"


export const view = (model: Model, dispatch: (msg: Msg) => void) =>
  h("div", [
    h("button", { on: {
      click: () => dispatch(MsgIncrement.make())
    } }, "+"),
    h("h2", `${model.counter}`),
    h("button", {
      on: {
        click: () => dispatch(MsgDecrement.make())
      }
    }, "-"),
    h("button", {
      on: {
        click: () => dispatch(MsgReset.make())
      }
    }, "Reset"),
  ])