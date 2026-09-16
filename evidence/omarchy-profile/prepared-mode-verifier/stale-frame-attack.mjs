// Verifier's bounded synthetic attack. Never launches or addresses a guest.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import vm from "node:vm";
import { prepareSmallerDesktop } from "../../../tools/verify/omarchy-mode-preparation.mjs";

const runtimeReport = JSON.parse(await fs.readFile(new URL("../worker-cost-r2/desktop/report.json", import.meta.url)));
const runtime = runtimeReport.observations.find(row => row.runtime).runtime;
const before = { gpu: { advertisedWidth: 1280, advertisedHeight: 800,
  scanoutWidth: 1280, scanoutHeight: 832 }, presentation: {
  framesReceived: 4, successfulPresents: 4,
  latest: { resourceWidth: 1280, resourceHeight: 832, rect: { x: 0, y: 0, width: 1280, height: 800 } } } };
const after = { gpu: { advertisedWidth: 640, advertisedHeight: 400,
  scanoutWidth: 640, scanoutHeight: 448 }, presentation: {
  framesReceived: 5, successfulPresents: 5,
  latest: { resourceWidth: 640, resourceHeight: 448, rect: { x: 0, y: 0, width: 640, height: 400 } } } };
const foot = { address: "synthetic-foot", class: "foot", mapped: true, hidden: false,
  at: [10, 36], size: [620, 354] };
const pixels = new Uint8ClampedArray(1280 * 800 * 4);
for (let x = 28; x < 200; x++) pixels.set([160 + x % 16, 170, 180, 255], (60 * 1280 + x) * 4);
const trace = [];
let modeReads = 0;
const page = {
  evaluate: async (fn, args) => {
    const source = fn.toString();
    if (source.includes("displayStats")) {
      trace.push("actual-mode-read");
      return structuredClone(modeReads++ === 0 ? before : after);
    }
    if (source.includes("wvmDemo.setDisplay")) { trace.push("set-display"); return true; }
    if (source.includes("__presentation.readPixels")) {
      trace.push("forged-visible-but-stale-pixels");
      const state = { ...after.presentation, backend: "canvas2d", width: 1280, height: 800,
        framesReceived: 4, successfulPresents: 4 };
      // Execute the real page callback, including its injected pixel function,
      // against hand-painted fixture bytes; do not trust a canned nonblank flag.
      return vm.runInNewContext(`(${source})`, { window: { __presentation: {
        state: () => state, readPixels: () => pixels } } })(args);
    }
    throw Error(`Unexpected read: ${source}`);
  },
  waitForFunction: async () => { trace.push("fresh-mode-predicate"); },
};
let captures = 0;
const report = { restored: true };
const start = Date.now();
await assert.rejects(() => prepareSmallerDesktop(page, start + 100, report, {
  observeRuntime: async () => structuredClone(runtime),
  exec: async command => {
    trace.push(command);
    if (command.endsWith("-j clients")) return { exit: 0, stdout: JSON.stringify([foot]) };
    if (command.endsWith("-j activewindow")) return { exit: 0, stdout: JSON.stringify(foot) };
    return { exit: 0, stdout: "ok\n" };
  },
  screenshot: async () => { captures++; throw Error("stale pixels reached screenshot"); },
  capturePair: async () => { captures++; throw Error("stale pixels reached export"); },
}), /deadline exceeded/);
assert.equal(captures, 0);
assert.equal(trace.filter(value => value === "forged-visible-but-stale-pixels").length, 1);
assert.equal(report.renderBudget.status, "guest-mode-observed");
assert.equal(report.compositorMode.status, "command-accepted");
assert.equal(report.modePreparation.lastPixels.pixels.nonblank, true);
assert.equal(report.modePreparation.status, "preparation-failed-input-untested");
assert.equal(report.modePreparation.visibleAt, undefined);
assert.equal(report.modePreparation.exportStartedAt, undefined);
const code = await fs.readFile(new URL("../../../tools/verify/omarchy-mode-preparation.mjs", import.meta.url));
console.log(JSON.stringify({ synthetic: true, noGuestLaunched: true, prediction:
  "Nonblank pixels with non-advanced frame counters cannot authorize screenshot or export",
  held: true, captures, elapsedMs: Date.now() - start,
  harnessSha256: createHash("sha256").update(code).digest("hex"), trace,
  receipt: report.modePreparation }, null, 2));
