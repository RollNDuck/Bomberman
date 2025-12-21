import { Schema as S } from "effect"

export type Msg = typeof Msg.Type
export const Msg = S.Union(
  S.TaggedStruct("KeyDown", {
    key: S.String,
  }),
  S.TaggedStruct("KeyUp", {
    key: S.String,
  }),
  S.TaggedStruct("Tick", {})
)

export const [KeyDown, KeyUp, Tick] = Msg.members