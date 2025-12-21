import { Schema as S } from "effect"

export type Msg = typeof Msg.Type
export const Msg = S.Union(
  S.TaggedStruct("MsgIncrement", {}),
  S.TaggedStruct("MsgDecrement", {}),
  S.TaggedStruct("MsgReset", {}),
)
export const [
  MsgIncrement,
  MsgDecrement,
  MsgReset,
] = Msg.members