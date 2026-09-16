// Bounded synthetic stale-frame attack. No browser, guest, network or input.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import vm from "node:vm";
import { prepareDirectOpaqueDesktop } from "../../../tools/verify/omarchy-direct-opaque-preparation.mjs";
import { DIRECT_OPAQUE_COMMAND } from "../../../tools/verify/omarchy-direct-opaque-command.mjs";

const state = count => ({ backend: "canvas2d", width: 1280, height: 800,
  framesReceived: count, successfulPresents: count,
  latest: { resourceWidth: 1280, resourceHeight: 832, rect: { x: 0, y: 0, width: 1280, height: 800 } } });
const runtime = count => ({ jit: { hasExecutor: true, admissionProbe: false,
  coldCounterRecycling: { enabled: false, threshold: 512, capacity: 65536, epochs: "0", discardedCounters: "0" },
  decodedCacheEntries: 4096, jitResidencyPolicy: "cap-256", jitResidencyCap: 256,
  entryCost: { timingEnabled: false, timerReads: 0 } }, clock: { mode: "icount", clockDiv: 64 }, presentation: state(count) });
const foot = { address: "0xcafe123", class: "foot", mapped: true, hidden: false, at: [12, 38], size: [1256, 750] };
const pixels = new Uint8ClampedArray(1280 * 800 * 4);
for (let x = 30; x < 222; x++) pixels.set([160 + x % 16, 173, 185, 255], (60 * 1280 + x) * 4);
const response = { exit: 0, stdout: [...Array(8).fill("ok"), "true", "true", "1", "1.000000", "1.0",
  "true", "true", "true", JSON.stringify(foot)].join("\n\n") + "\n" };

async function scenario(fresh) {
  const calls = [], captures = [], report = { restored: true };
  let batchReplied = false;
  const page = { evaluate: async (fn, args) => {
    assert.ok(batchReplied, "pixel baseline preceded completed properties/active-window response");
    const source = fn.toString(), pixelRead = source.includes("readPixels");
    calls.push(pixelRead ? "actual-native-pixel-callback" : "post-response-baseline");
    // Frame 5 appeared during the direct-property transaction. It is nonblank,
    // but only a new frame 6 may satisfy the post-response baseline 5.
    const actual = state(pixelRead && fresh ? 6 : 5);
    return await vm.runInNewContext(`(${source})`, {
      window: { __presentation: { state: () => actual, readPixels: () => pixels } },
    })(args);
  } };
  const began = Date.now();
  const work = () => prepareDirectOpaqueDesktop(page, began + 150, report, {
    observeRuntime: async label => { calls.push(label); return runtime(label.endsWith("before") ? 4 : 6); },
    exec: async command => {
      assert.equal(command, DIRECT_OPAQUE_COMMAND); calls.push(command); batchReplied = true;
      return structuredClone(response);
    },
    screenshot: async name => { captures.push(name); },
    capturePair: async () => { captures.push("synthetic-export"); },
  });
  if (fresh) await work(); else await assert.rejects(work, /deadline exceeded/u);
  assert.equal(calls.filter(item => item === DIRECT_OPAQUE_COMMAND).length, 1);
  assert.equal(report.directOpaque.status, "properties-confirmed");
  assert.deepEqual(report.directOpaque.foot, foot);
  assert.equal(report.modePreparation.presentationBaseline.framesReceived, 5);
  assert.equal(report.modePreparation.lastPixels.pixels.nonblank, true);
  if (fresh) {
    assert.deepEqual(captures, ["prepared-desktop.png", "synthetic-export"]);
    assert.equal(report.modePreparation.status, "pair-captured-input-untested");
  } else {
    assert.deepEqual(captures, []);
    assert.equal(report.modePreparation.status, "preparation-failed-input-untested");
    assert.equal(report.modePreparation.visibleAt, undefined);
    assert.equal(report.modePreparation.exportStartedAt, undefined);
  }
  return { synthetic: true, fresh, calls, captures, elapsedMs: Date.now() - began,
    configuration: report.directOpaque, preparation: report.modePreparation };
}

const helper = await fs.readFile(new URL("../../../tools/verify/omarchy-direct-opaque-preparation.mjs", import.meta.url));
console.log(JSON.stringify({ synthetic: true, noGuestOrBrowser: true,
  sourceSha256: createHash("sha256").update(helper).digest("hex"),
  prediction: "Nonblank frame 5 painted during the batch fails after baseline 5; actual callback frame 6 may pass only as synthetic harness coverage.",
  stale: await scenario(false), freshControl: await scenario(true) }, null, 2));
