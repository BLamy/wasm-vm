import { startLinuxBoot } from "./loader.js";
import { startLinuxBootWorker, stopLinuxController } from "./linux-worker-host.js";

// These are real bytes fetched and hash-checked by the production loader. They retire only
// if explicitly resumed: addi a0, zero, 1; jal zero, 0. Empty initramfs is intentional.
export async function fixtureOptions() {
  const bytes = new Uint8Array([0x13, 0x05, 0x10, 0, 0x6f, 0, 0, 0]);
  const hash = async (data) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data)),
    (byte) => byte.toString(16).padStart(2, "0")).join("");
  const manifest = { artifacts: {
    kernel: { url: "data:application/octet-stream;base64,EwUQAG8AAAA=", sha256: await hash(bytes) },
    initramfs: { url: "data:application/octet-stream;base64,", sha256: await hash(new Uint8Array()) },
  } };
  return { manifestUrl: "data:application/json," + encodeURIComponent(JSON.stringify(manifest)),
    ramMib: 16, startPaused: true, jit: false, slirpNet: false };
}

let controller = null;
let busy = false;
const element = (id) => document.getElementById(id);
function controls() {
  element("start").disabled = busy || controller !== null;
  element("stop").disabled = busy || controller === null;
  element("apply").disabled = busy || controller === null;
}
export function printableStats(stats) {
  return stats ? { ...stats, edid: Array.from(stats.edid) } : null;
}
async function show() {
  const stats = printableStats(await controller?.displayStats());
  const { edid, ...fields } = stats ?? {};
  element("stats").textContent = JSON.stringify(stats && { ...fields,
    edidHex: edid.map((byte) => byte.toString(16).padStart(2, "0")).join(" ") }, null, 2);
  return stats;
}
async function action(work) {
  if (busy) return;
  busy = true; controls();
  try { await work(); }
  catch (error) { element("status").textContent = String(error); }
  finally { busy = false; controls(); }
}
element("start").addEventListener("click", () => action(async () => {
  const start = element("backend").value === "worker" ? startLinuxBootWorker : startLinuxBoot;
  controller = await start(await fixtureOptions());
  await show();
  element("status").textContent = "Real GPU attached; guest fixture paused. No guest scanout yet.";
}));
element("mode").addEventListener("submit", (event) => {
  event.preventDefault();
  void action(async () => {
    await controller.setDisplay(Number(element("width").value), Number(element("height").value));
    await show();
    element("status").textContent = "Preferred mode requested; actual scanout remains guest-owned.";
  });
});
element("stop").addEventListener("click", () => action(async () => {
  await stopLinuxController(controller);
  controller = null;
  await show();
  element("status").textContent = "Fixture stopped.";
}));
