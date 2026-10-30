// Public pages: the interactive architecture model (hero-scene.js) where a page has one. The
// full-screen decorative shader that used to sit behind these pages was removed in E0-T30; the
// model is the page's real visual. Its visible controls are a library island (ui.js) pressing
// the figure's own [data-layer] and .model-motion buttons, which hero-scene.js listens to.
import { initMachineModel } from "./hero-scene.js?rev=ac35169fc0ff";

const canvas = document.querySelector("#machine-canvas");
const disposeModel = initMachineModel(canvas);
addEventListener("pagehide", event => {
  // A back/forward-cache document returns with its own scene and controls intact.
  if (!event.persisted) disposeModel();
});
