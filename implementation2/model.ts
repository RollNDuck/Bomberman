import { Schema as S } from "effect"

export type Model = typeof Model.Type
export const Model = S.Struct({
  counter: S.Int,
})

export const initModel = Model.make({
  counter: 0,
})