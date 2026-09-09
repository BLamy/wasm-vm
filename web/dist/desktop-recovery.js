// E5-T18d: the real worker/framebuffer, with explicitly local fixed-verb recovery drills.
import { startLinuxBootWorker } from "./linux-worker-host.js";
import { PresentationController } from "./src/sink/presentation.js";
import { desktopRecoveryOptions, desktopRecoveryCommandAllowed } from "./src/input/desktop-recovery-policy.js";

const query = new URLSearchParams(location.search);
const { test, configFault, bootargs } = desktopRecoveryOptions(location.search, location.hostname);
const canvas = document.getElementById("desktop-canvas");
const status = document.getElementById("recovery-status");
const transcript = document.getElementById("recovery-serial");
const controls = document.getElementById("recovery-controls");
const presentation = new PresentationController(canvas, {
  defaultBackend: "canvas2d",
  canvas2dOptions: { contextAttributes: { alpha: true, willReadFrequently: true } },
});
const decoder = new TextDecoder();
let serial = "";
let frames = 0;
let controller;
let error = null;

function setStatus(message, failed = false) {
  status.textContent = message;
  status.dataset.state = failed ? "error" : "running";
}

async function command(verb) {
  if (!controller || !desktopRecoveryCommandAllowed(test, verb)) {
    throw new Error("recovery command unavailable");
  }
  return controller.sendInput(new TextEncoder().encode(`${verb}\n`));
}

controls.hidden = !test;
controls.addEventListener("click", (event) => {
  const verb = event.target.dataset.command;
  if (verb) void command(verb).catch((failure) => setStatus(failure.message, true));
});

globalThis.__desktopRecovery = {
  serial: () => serial,
  command,
  state: () => ({ test, configFault, frames, error, presentation: presentation.snapshot() }),
  async capture() {
    await controller.pause();
    try {
      const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      const hash = await crypto.subtle.digest("SHA-256", pixels);
      return {
        frames, width: canvas.width, height: canvas.height,
        framebufferSha256: [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
        guestStateDigest: await controller.stateDigest(),
        scheduler: await controller.schedulerStats(),
        presentation: presentation.snapshot(),
      };
    } finally { await controller.resume(); }
  },
};

startLinuxBootWorker({
  manifestUrl: query.get("manifestUrl") || "./artifacts-alpine.json",
  mode: "chunked",
  imageManifestUrl: query.get("imageManifestUrl") || "./e5t18d-desktop/manifest.json",
  baseUrl: query.get("baseUrl") || "./e5t18d-desktop/",
  ramMib: 256,
  bootargs,
  bootSnapshot: false, persist: false, slirpNet: false,
  fastInterpreter: true, jit: query.get("jit") !== "0",
  quantum: Number(query.get("quantum") || 500_000),
  onState: (value) => setStatus(`linux: ${value}`),
  onOutput: (bytes) => {
    serial = (serial + decoder.decode(bytes, { stream: true })).slice(-1_000_000);
    transcript.textContent = serial.slice(-12_000);
    transcript.scrollTop = transcript.scrollHeight;
  },
  onDisplayFrame: (frame) => { const reached = presentation.present(frame); frames += 1; return reached; },
  onError: (failure) => { error = String(failure); setStatus(error, true); },
}).then((value) => {
  controller = value;
  globalThis.__desktopController = controller;
}).catch((failure) => { error = String(failure); setStatus(error, true); });

addEventListener("beforeunload", () => { void controller?.stop?.(); });
