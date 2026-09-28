import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { captureLateDisplay } from "../../../tools/verify/omarchy-display-late-probe.mjs";

const epoch = Date.parse("2026-09-17T00:00:00.000Z");
const outcomes = [];
for (const mode of ["same-sequence-pending", "same-sequence-present-count", "later-checkpoint-overrun"]) {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), "av-critic-checkpoint-"));
  try {
    await fs.writeFile(path.join(out, "desktop-keyboard.png"), "immutable original product image");
    let now = epoch, screenshots = 0;
    const frame = { sequence: 7, timestamp: new Date(epoch - 100).toISOString(),
      scanout: 0, format: 2, rect: { x: 1, y: 2, width: 3, height: 2 },
      resourceWidth: 4, resourceHeight: 4, bytes: Uint8Array.from({ length: 64 }, (_, i) => (i * 17 + 13) & 255) };
    const canvasBytes = Uint8Array.from([1, 2, 3, 255, 4, 5, 6, 255]);
    const state = { width: 2, height: 1, framesReceived: 7, successfulPresents: 7, scheduler: { pending: 0 } };
    const probe = { sequence: 7, framesSeen: 7, frames: [frame], disposed: false, errors: [] };
    class FixtureDate extends Date {
      constructor(...args) { super(...(args.length ? args : [now])); }
      static now() { return now; }
    }
    const context = vm.createContext({ __omarchyDisplayPixels: probe,
      __presentation: { state: () => structuredClone(state), readPixels: () => canvasBytes },
      Date: FixtureDate, btoa: value => Buffer.from(value, "binary").toString("base64") });
    const report = { displayLateProbeRequested: true, result: "original-visual-failure",
      keyboard: { verified: true, completedAt: new Date(epoch - 5000).toISOString() },
      trial: { responseImageCapturedAt: new Date(epoch - 1000).toISOString(),
        captureDeadlineAt: new Date(epoch + 10000).toISOString(), presentationAfter: structuredClone(state) } };
    const originalTrial = structuredClone(report.trial), originalKeyboard = structuredClone(report.keyboard);
    const imageTimeouts = [], sourceBefore = [...frame.bytes];
    const page = {
      evaluate: async fn => structuredClone(vm.runInContext(`(${fn.toString()})()`, context)),
      screenshot: async ({ path: filename, timeout }) => {
        imageTimeouts.push(timeout); screenshots++;
        await fs.writeFile(filename, `fixture image ${screenshots}`);
        if (mode === "same-sequence-pending") state.scheduler.pending = 1;
        else if (mode === "same-sequence-present-count") state.successfulPresents++;
        else now += screenshots === 1 ? 179000 : 1001;
      },
    };
    let error;
    try { await captureLateDisplay(page, out, report, { now: () => now, sleep: async ms => { now += ms; } }); }
    catch (failure) { error = String(failure); }
    assert.ok(error, "the ambiguous/late fixture must be rejected");
    assert.equal(report.displayLateProbe.status, "unproven");
    assert.equal(report.displayLateProbe.desktopAcceptance, false);
    assert.equal(report.result, "original-visual-failure");
    assert.deepEqual(report.trial, originalTrial); assert.deepEqual(report.keyboard, originalKeyboard);
    assert.deepEqual([...frame.bytes], sourceBefore);
    assert.equal(probe.sequence, 7, "attack leaves sequence unchanged deliberately");
    assert.equal(await fs.readFile(path.join(out, "desktop-keyboard.png"), "utf8"), "immutable original product image");
    if (mode === "later-checkpoint-overrun") {
      assert.match(error, /deadline exceeded/); assert.equal(screenshots, 2);
      assert.deepEqual(imageTimeouts, [20000, 1000]);
      assert.equal(Date.parse(report.displayLateProbe.deadlineAt), epoch + 180000);
    } else assert.equal(screenshots, 1);
    outcomes.push({ mode, rejected: true, error, imageTimeouts, screenshots,
      checkpointsAttempted: report.displayLateProbe.checkpoints.length,
      sequenceUnchanged: probe.sequence, originalPreserved: true, rawBytesUnchanged: true,
      deadlineAt: report.displayLateProbe.deadlineAt, finishedAt: report.displayLateProbe.finishedAt });
  } finally { await fs.rm(out, { recursive: true, force: true }); }
}
await fs.writeFile(new URL("./checkpoint-attack-independent.json", import.meta.url), JSON.stringify(outcomes, null, 2) + "\n");
console.log(JSON.stringify(outcomes, null, 2));
