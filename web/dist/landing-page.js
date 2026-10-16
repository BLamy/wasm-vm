import { initHero } from "./landing.js?rev=aac7e0bf506c";
import { initMachineModel } from "./hero-scene.js?rev=129315f0c4ab";

const disposeBackground = initHero(document.querySelector("#hero-canvas"));
const disposeModel = initMachineModel(document.querySelector("#machine-canvas"));
addEventListener("pagehide", event => {
  // A back/forward-cache document returns with its own scene and controls intact.
  // The browser suspends it; visibility handlers resume rendering when it returns.
  if (!event.persisted) { disposeBackground(); disposeModel(); }
});

const liveTerm = document.querySelector("#live-term");
document.querySelector("#live-boot-btn")?.addEventListener("click", () => {
  const body = document.querySelector("#live-body");
  const frame = document.createElement("iframe");
  frame.title = "wasm-vm guest console";
  frame.src = liveTerm.dataset.embedSrc;
  document.querySelector("#live-state").textContent = "Session loading";
  frame.addEventListener("load", () => {
    // A loaded frame is not a claimed successful Linux boot.
    document.querySelector("#live-state").textContent = "Demo session open";
  }, { once: true });
  body.replaceChildren(frame);
}, { once: true });
