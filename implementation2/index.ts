import { startSimple } from "cs12251-mvu/src"
import { initModel } from "./model"
import { view } from "./view"
import { update } from "./update"

const root = document.getElementById("app")!

startSimple(root, initModel, update, view)