import { Match } from "effect"
import { Msg } from "./msg"
import { Model } from "./model"

export const update = (msg: Msg, model: Model): Model =>
  Match.value(msg).pipe(
    Match.tag("MsgIncrement", () => Model.make({
      ...model,
      counter: model.counter + 1,
    })),
    Match.tag("MsgDecrement", () => Model.make({
      ...model,
      counter: model.counter - 1,
    })),
    Match.tag("MsgReset", () => Model.make({
      ...model,
      counter: 0,
    })),
    Match.exhaustive,
  )