// Synthetic harness coverage only. This is not a guest checkpoint or readiness proof.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { assertInputTrialSource, assertInputTrialRuntime } from "../../../tools/verify/omarchy-input-trial.mjs";
import { modePreparationOptions, validatePreparedPair, MODE_PREPARATION_MS } from "../../../tools/verify/omarchy-mode-preparation.mjs";
import { assertModeWire, assertGuestMode } from "../../../tools/verify/omarchy-render-mode.mjs";
import { assertCompositorModeWire, COMPOSITOR_MODE_COMMAND } from "../../../tools/verify/omarchy-compositor-command.mjs";
import { auditSerial } from "../../../tools/verify/omarchy-latency-receipt.mjs";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const source = await fs.readFile(new URL("../../../tools/verify/omarchy-prepare-mode.mjs", import.meta.url), "utf8");
const start = source.indexOf('try {\n  assert.equal(report.mode,"mode-pair")');
const end = source.indexOf('\nconsole.log(JSON.stringify(receipt', start);
assert.ok(start > 0 && end > start);
const pair = await fs.mkdtemp(path.join(os.tmpdir(), "omarchy-postprocessor-fixture-"));
try {
  const report = JSON.parse(await fs.readFile(new URL("../prepared-mode-r2/desktop/report.json", import.meta.url)));
  const manifest = JSON.parse(await fs.readFile(report.candidate.source.chunkManifest.filename));
  const canonical = Object.fromEntries(["version", "image_len", "chunk_size", "layout", "chunks"].map(k => [k, manifest[k]]));
  const base = sha(JSON.stringify(canonical)), generation = 7;
  const snapshot = Buffer.alloc(1048577);
  snapshot.write("WVMRESU1"); snapshot.writeUInt32LE(1, 8); snapshot.write("0.0.1", 12);
  Buffer.from(base, "hex").copy(snapshot, 44); snapshot.writeBigUInt64LE(BigInt(generation), 76);
  const delta = Buffer.alloc(61 + 4104);
  delta.write("WVOD1"); delta.writeUInt32LE(4096, 5); delta.writeBigUInt64LE(4294967296n, 9);
  Buffer.from(base, "hex").copy(delta, 17); delta.writeBigUInt64LE(BigInt(generation), 49);
  delta.writeUInt32LE(1, 57); delta.writeBigUInt64LE(3n, 61); delta.fill(19, 69);
  report.pair = { base, generation, snapshotBytes: snapshot.length, blocks: 1,
    coreId: snapshot.subarray(12,44).toString("hex"), paused: true, restoreDecision: "resume" };
  for (const [role, filename, bytes] of [["snapshot", "omarchy-ready.snap.gz", snapshot],
      ["delta", "omarchy-overlay-delta.bin.gz", delta]]) {
    const compressed = gzipSync(bytes), full = path.join(pair, filename);
    await fs.writeFile(full, compressed);
    report.pair[role] = { filename: full, size: compressed.length, sha256: sha(compressed) };
  }
  report.result = "prepared-mode-pair-input-untested";
  Object.assign(report.modePreparation, { status: "pair-captured-input-untested", lastPixels: { pixels: { nonblank: true } },
    readyMode: report.renderBudget.after, visibleAt: "2026-09-16T03:26:00.000Z",
    exportStartedAt: "2026-09-16T03:26:00.000Z", exportFinishedAt: "2026-09-16T03:26:01.000Z", exportDeadlineAt: "2026-09-16T03:29:00.000Z" });
  const receipt = { head: report.trial.head, wasmSha256: report.identities.files["pkg/wasm_vm_wasm_bg.wasm"].sha256 };
  let saves = 0;
  const bindings = { assert, fs, path, pair, report, receipt, sha, gunzipSync, assertInputTrialSource,
    assertInputTrialRuntime, modePreparationOptions, validatePreparedPair, MODE_PREPARATION_MS,
    assertModeWire, assertGuestMode, assertCompositorModeWire, COMPOSITOR_MODE_COMMAND, auditSerial,
    save: async () => { saves++; } };
  const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
  await new AsyncFunction(...Object.keys(bindings), source.slice(start, end))(...Object.values(bindings));
  assert.equal(saves, 1); assert.equal(receipt.usablePair, false);
  assert.equal(receipt.result, "prepared-pair-awaiting-personal-image-verification");
  assert.equal(receipt.pair.blocks, 1); assert.equal(receipt.pair.generation, generation);
  console.log(JSON.stringify({ synthetic: true, noGuestLaunched: true, headerOnlySyntheticSnapshot: true,
    prediction: "Even a synthetically valid positive parent postprocessor leaves usablePair false pending actual image verification",
    held: true, sourceSha256: sha(source), positivePostprocessorExecuted: true, usablePair: receipt.usablePair,
    result: receipt.result, syntheticBlocksValidated: receipt.pair.blocks, saves }, null, 2));
} finally { await fs.rm(pair, { recursive: true, force: true }); }
