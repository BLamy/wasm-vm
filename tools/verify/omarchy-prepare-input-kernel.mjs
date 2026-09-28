#!/usr/bin/env node
// Prepare the freshly cold-booted input-kernel pair without a physical-input claim.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { watchOwnedTrial } from "./omarchy-owned-trial.mjs";
import { modePreparationOptions, validatePreparedPair, MODE_PREPARATION_MS } from "./omarchy-mode-preparation.mjs";
import { assertInputTrialRuntime } from "./omarchy-input-trial.mjs";
import { assertOriginalInputGeometry } from "./omarchy-compositor-input-capture.mjs";
import { DIRECT_OPAQUE_COMMAND, auditDirectOpaque } from "./omarchy-direct-opaque-command.mjs";
import { auditSerial } from "./omarchy-latency-receipt.mjs";
import { INPUT_BUFFER_NOTES_COMMAND, assertInputKernelProvenance, assertInputKernelSource,
  assertInputKernelNotes } from "./omarchy-input-kernel-state.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
assert.equal(process.argv.length, 5, "usage: omarchy-prepare-input-kernel.mjs NEW_EVIDENCE_DIR NEW_PAIR_DIR NATIVE_RECORD");
const [out, pair, nativeFile] = process.argv.slice(2).map(file => path.resolve(file));
assert.ok(pair.startsWith(path.join(repo, "target") + path.sep));
await assert.rejects(fs.stat(pair), { code: "ENOENT" });
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const nativeBytes = await fs.readFile(nativeFile), native = assertInputKernelProvenance(JSON.parse(nativeBytes));
await fs.mkdir(out, { recursive: false });
const receipt = { kind: "input-buffer-prepared-pair", passed: false, keyboardAcceptance: false,
  startedAt: new Date().toISOString(), pairDirectory: pair, nativeRecord: { filename: nativeFile, sha256: sha(nativeBytes) },
  head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
  wasmSha256: sha(await fs.readFile(path.join(repo, "web/dist/pkg/wasm_vm_wasm_bg.wasm"))) };
assert.equal(receipt.wasmSha256, native.inputs.wasm.sha256);
const save = () => fs.writeFile(path.join(out, "run.json"), JSON.stringify(receipt, null, 2) + "\n");
await save();
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith("OMARCHY_")) delete env[key];
Object.assign(env, { OMARCHY_CANDIDATE_PAIR_DIR: native.pairDirectory,
  OMARCHY_CANDIDATE_CHUNKS: path.dirname(native.inputs.chunkManifest.filename),
  OMARCHY_MODE_PAIR_OUTPUT_DIR: pair, OMARCHY_INPUT_KERNEL_RECORD: nativeFile });
receipt.args = ["tools/verify/omarchy-desktop-live.mjs", "local", path.join(out, "desktop"), "direct-opaque-pair"];
const log = createWriteStream(path.join(out, "desktop.log"), { flags: "wx" });
const child = spawn(process.execPath, receipt.args, { cwd: repo, env, detached: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
receipt.exit = await watchOwnedTrial(child, { modePreparation: true });
child.stdout.unpipe(log); child.stderr.unpipe(log); await new Promise(resolve => log.end(resolve));
receipt.finishedAt = new Date().toISOString(); await save();
if (!receipt.exit.closed || receipt.exit.watchdog || receipt.exit.error) {
  child.unref(); child.stdout.destroy(); child.stderr.destroy(); if (child.connected) child.disconnect();
  throw Error("input-kernel preparation did not close normally; pair UNPROVEN");
}
try {
  const reportBytes = await fs.readFile(path.join(out, "desktop/report.json")), report = JSON.parse(reportBytes);
  receipt.reportSha256 = sha(reportBytes);
  assert.equal(report.trial.head, receipt.head); assert.equal(report.trial.scopedStatus, "");
  assert.equal(report.mode, "direct-opaque-pair");
  assertInputKernelSource(report.candidate.source, native);
  assert.equal(report.inputKernel.sha256, sha(nativeBytes));
  assert.deepEqual(report.inputKernel.provenance, native);
  assert.equal(report.identities.files["pkg/wasm_vm_wasm_bg.wasm"].sha256, receipt.wasmSha256);
  assert.equal(report.startup.timeoutMs, MODE_PREPARATION_MS);
  assert.equal(Date.parse(report.startup.deadlineAt) - Date.parse(report.startup.startedAt), MODE_PREPARATION_MS);
  assert.equal(report.cleanup.closed, true); assert.deepEqual(report.errors, []);
  assert.equal(report.keyboard, undefined); assert.deepEqual(report.inputEvents, []);
  assert.equal(report.preparationInputFence.ignore, true);
  assert.ok(Date.parse(report.preparationInputFence.acknowledgedAt) <= Date.parse(report.browserRequests[0].timestamp));
  for (const row of report.workerTraffic) assert.ok(!/^(?:send(?:Keyboard|Tablet|Mouse|Agent)|sync(?:Keyboard|Tablet|Mouse))/u.test(row.method ?? ""));
  const allowed = ["XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j layers", INPUT_BUFFER_NOTES_COMMAND, DIRECT_OPAQUE_COMMAND, "sync"];
  receipt.serial = auditSerial(report.workerTraffic, allowed);
  assert.ok(receipt.serial.every(row => allowed.includes(row.command)));
  for (const row of report.observations.filter(row => row.runtime)) assertInputTrialRuntime(row.runtime, modePreparationOptions());
  if (report.directOpaque) receipt.configuration = auditDirectOpaque(report, [INPUT_BUFFER_NOTES_COMMAND, "sync"]);
  if (report.result !== "prepared-mode-pair-input-untested") {
    assert.equal(report.result, "failed");
    receipt.result = "preparation-failed-input-untested";
  } else {
    assert.equal(receipt.exit.code, 0);
    const notes = receipt.serial.filter(row => row.command === INPUT_BUFFER_NOTES_COMMAND);
    assert.equal(notes.length, 1); assertInputKernelNotes(notes[0].response);
    assert.deepEqual(notes[0].response, report.inputKernelIdentity.response);
    assert.equal(report.inputKernelIdentity.status, "verified");
    const configured = receipt.serial.filter(row => row.command === DIRECT_OPAQUE_COMMAND);
    assert.equal(configured.length, 1);
    assert.ok(Date.parse(notes[0].completedAt) <= Date.parse(configured[0].sentAt));
    const sync = receipt.serial.filter(row => row.command === "sync");
    assert.equal(sync.length, 1); assert.equal(sync[0].response.exit, 0);
    assert.deepEqual(sync[0].response, report.inputKernelSync.response);
    const prep = report.modePreparation;
    assert.equal(prep.status, "pair-captured-input-untested");
    assert.ok(prep.lastPixels.pixels.nonblank);
    assertOriginalInputGeometry(prep.runtimeBefore.presentation);
    assertOriginalInputGeometry(prep.lastPixels.state);
    assert.ok(prep.lastPixels.state.framesReceived > prep.presentationBaseline.framesReceived);
    assert.ok(prep.lastPixels.state.successfulPresents > prep.presentationBaseline.successfulPresents);
    assert.ok(Date.parse(configured[0].completedAt) <= Date.parse(prep.baselineAt));
    assert.ok(Date.parse(prep.visibleAt) < Date.parse(report.startup.deadlineAt));
    assert.ok(Date.parse(sync[0].sentAt) >= Date.parse(prep.exportStartedAt));
    assert.ok(Date.parse(sync[0].completedAt) <= Date.parse(report.capturePersistence.timestamp));
    assert.ok(Date.parse(prep.exportFinishedAt) < Date.parse(prep.exportDeadlineAt));
    assert.equal(report.pair.paused, true); assert.equal(report.pair.restoreDecision, "resume");
    for (const [role, filename] of [["snapshot", "omarchy-ready.snap.gz"], ["delta", "omarchy-overlay-delta.bin.gz"]]) {
      assert.equal(report.pair[role].filename, path.join(pair, filename));
      const bytes = await fs.readFile(report.pair[role].filename);
      assert.equal(bytes.length, report.pair[role].size); assert.equal(sha(bytes), report.pair[role].sha256);
    }
    receipt.pair = validatePreparedPair(gunzipSync(await fs.readFile(report.pair.snapshot.filename), { maxOutputLength: 2 * 1024 ** 3 }),
      gunzipSync(await fs.readFile(report.pair.delta.filename), { maxOutputLength: 512 * 1024 ** 2 }),
      await fs.readFile(native.inputs.chunkManifest.filename), report.pair);
    receipt.kernel = native.inputs.kernel; receipt.kernelNotesSha256 = native.kernelNotesSha256;
    receipt.chunkManifest = native.inputs.chunkManifest; receipt.foot = prep.foot;
    receipt.artifacts = { bootSnapshot: report.pair.snapshot, overlayDelta: report.pair.delta };
    receipt.result = "prepared-pair-awaiting-personal-image-verification";
    // A human-visible recording and fresh critic must approve the real image.
    receipt.passed = true;
  }
} catch (error) { receipt.auditError = String(error); throw error; }
finally { await save(); }
console.log(JSON.stringify({ result: receipt.result, passed: receipt.passed, keyboardAcceptance: false }));
