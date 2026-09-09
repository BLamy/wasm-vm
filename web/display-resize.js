import { PresentationController } from "./src/sink/presentation.js";
import { DisplayViewportController } from "./src/sink/viewport.js";
import { startLinuxBootWorker, stopLinuxController } from "./linux-worker-host.js";
import { createPointerBridge, createWasmPointerAdapter, attachPointerBridge } from "./src/input/pointer.js";

const container = document.getElementById("viewport");
const status = document.getElementById("status");
const state = document.getElementById("state");
const backend = new URLSearchParams(location.search).get("backend") === "webgl2" ? "webgl2" : "canvas2d";
const presentation = new PresentationController(document.getElementById("canvas"), {
  defaultBackend: backend, scheduleFrames: true,
});
let controller = null;
let viewport = null;
let disposed = false;
const pointerFrames = [];

export function fixtureFrame(width, height) {
  const pixels = new Uint32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    // Row/column-dependent pattern makes one-pixel shear and scaling visible.
    const red = (x * 17 + y * 3) & 255;
    const green = (x * 5 + y * 11) & 255;
    const blue = ((x ^ y) & 1) ? 224 : 32;
    pixels[y * width + x] = (0xff000000 | (red << 16) | (green << 8) | blue) >>> 0;
  }
  return { resourceWidth: width, resourceHeight: height, format: 1, scanout: 0,
    rect: { x: 0, y: 0, width, height }, pixels };
}
function show() {
  if (!viewport) return;
  state.textContent = JSON.stringify({ viewport: viewport.snapshot(), presentation: presentation.snapshot() }, null, 2);
}
viewport = new DisplayViewportController({ container, presentation, onState: show });
const bridge = createPointerBridge(createWasmPointerAdapter({
  sendTabletEvent: (...args) => controller?.sendTabletEvent(...args),
  syncTablet: () => controller?.syncTablet(),
  sendMouseEvent: (...args) => controller?.sendMouseEvent(...args),
  syncMouse: () => controller?.syncMouse(),
}), {
  target: container, documentTarget: document, isReady: () => !!controller && !disposed,
  getRect: () => viewport.pointerRect(), serializeTransport: true,
  onFrame: (frame) => { pointerFrames.push(frame); if (pointerFrames.length > 64) pointerFrames.shift(); },
});
const detachPointer = attachPointerBridge(container, bridge, { documentTarget: document, windowTarget: window });
function present(frame) { presentation.present(frame); show(); }
present(fixtureFrame(641, 481));
document.getElementById("match").onclick = () => {
  const mode = viewport.snapshot().desired;
  if (mode && !disposed) present(fixtureFrame(mode.width, mode.height));
};
async function dispose() {
  if (disposed) return;
  disposed = true;
  viewport.dispose(); detachPointer(); bridge.reset({ emit: false, exitLock: true });
  await stopLinuxController(controller);
  controller = null;
  document.getElementById("match").disabled = true;
  document.getElementById("dispose").disabled = true;
  status.textContent = "Disposed. Resize and DPR listeners are detached.";
  show();
}
document.getElementById("dispose").onclick = () => { void dispose(); };
window.viewportDemo = { presentation, viewport, fixtureFrame, present,
  displayStats: () => controller?.displayStats(), pointerFrames, dispose, ready: false };
try {
  const hash = async (bytes) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (byte) => byte.toString(16).padStart(2, "0")).join("");
  const bytes = new Uint8Array([0x13, 5, 0x10, 0, 0x6f, 0, 0, 0]);
  const manifest = { artifacts: {
    kernel: { url: "data:application/octet-stream;base64,EwUQAG8AAAA=", sha256: await hash(bytes) },
    initramfs: { url: "data:application/octet-stream;base64,", sha256: await hash(new Uint8Array()) },
  } };
  const boot = await startLinuxBootWorker({ manifestUrl: "data:application/json," + encodeURIComponent(JSON.stringify(manifest)),
    ramMib: 16, startPaused: true, jit: false, slirpNet: false });
  if (disposed) await stopLinuxController(boot);
  else {
    controller = boot;
    await viewport.setController(controller);
    status.textContent = "Real GPU attached; fixture paused. Synthetic frame remains independently sized.";
    window.viewportDemo.ready = true; show();
  }
} catch (error) { status.textContent = String(error); window.viewportDemo.error = String(error); }
