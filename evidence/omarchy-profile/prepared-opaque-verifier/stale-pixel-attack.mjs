// Independent bounded synthetic attack. No browser, guest, network, or input.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import vm from "node:vm";
import { prepareOpaqueDesktop, ACTIVE_FOOT_COMMAND } from "../../../tools/verify/omarchy-opaque-preparation.mjs";
import { OPAQUE_FOOT_COMMAND } from "../../../tools/verify/omarchy-opaque-foot-command.mjs";

const state = count => ({ backend: "canvas2d", width: 1280, height: 800,
  framesReceived: count, successfulPresents: count,
  latest: { resourceWidth: 1280, resourceHeight: 832,
    rect: { x: 0, y: 0, width: 1280, height: 800 } } });
const runtime = count => ({ jit: { hasExecutor: true, admissionProbe: false,
  coldCounterRecycling: { enabled: false, threshold: 512, capacity: 65536, epochs: "0", discardedCounters: "0" },
  decodedCacheEntries: 4096, jitResidencyPolicy: "cap-256", jitResidencyCap: 256,
  entryCost: { timingEnabled: false, timerReads: 0 } }, clock: { mode: "icount", clockDiv: 64 },
  presentation: state(count) });
const foot = { address: "verifier-synthetic-foot", class: "foot", mapped: true,
  hidden: false, at: [12, 38], size: [1256, 750] };
const pixels = new Uint8ClampedArray(1280 * 800 * 4);
for (let x = 30; x < 222; x++) pixels.set([160 + x % 16, 173, 185, 255], (60 * 1280 + x) * 4);

async function scenario(fresh) {
  const calls = [], report = { restored: true }, captures = [];
  let activeReplied = false;
  const page = { evaluate: async (fn, args) => {
    const source = fn.toString();
    assert.ok(activeReplied, "pixel observation preceded active-window response");
    const isPixels = source.includes("readPixels");
    calls.push(isPixels ? "real-callback-native-pixels" : "post-window-baseline");
    // The pre-rule runtime had four frames. A fifth frame appeared during the
    // property query. No sixth frame arrives in the stale case, though genuine
    // callback logic sees bright native interior pixels in the old fifth frame.
    const actual = state(isPixels && fresh ? 6 : 5);
    return await vm.runInNewContext(`(${source})`, {
      window: { __presentation: { state: () => actual, readPixels: () => pixels } },
    })(args);
  } };
  const began = Date.now();
  const work = () => prepareOpaqueDesktop(page, began + 150, report, {
    observeRuntime: async label => { calls.push(label); return runtime(label.endsWith("before") ? 4 : 6); },
    exec: async command => {
      calls.push(command);
      if (command === OPAQUE_FOOT_COMMAND) return { exit: 0, stdout: "ok\ntrue\ntrue\n1.0\n" };
      assert.equal(command, ACTIVE_FOOT_COMMAND);
      activeReplied = true;
      return { exit: 0, stdout: JSON.stringify(foot) };
    },
    screenshot: async name => { captures.push(name); },
    capturePair: async () => { captures.push("synthetic-export"); },
  });
  if (fresh) await work();
  else await assert.rejects(work, /deadline exceeded/u);
  assert.equal(calls.filter(item => item === OPAQUE_FOOT_COMMAND).length, 1);
  assert.equal(calls.filter(item => item === ACTIVE_FOOT_COMMAND).length, 1);
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
  return { synthetic: true, fresh, captures, calls, elapsedMs: Date.now() - began,
    receipt: report.modePreparation };
}

const helper = await fs.readFile(new URL("../../../tools/verify/omarchy-opaque-preparation.mjs", import.meta.url));
const results = { noGuestOrBrowser: true, sourceSha256: createHash("sha256").update(helper).digest("hex"),
  prediction: "Frame 5 painted during the configuration query cannot pass the post-confirmation frame gate; actual callback frame 6 may pass as synthetic harness coverage.",
  stale: await scenario(false), positiveControl: await scenario(true) };
console.log(JSON.stringify(results, null, 2));
