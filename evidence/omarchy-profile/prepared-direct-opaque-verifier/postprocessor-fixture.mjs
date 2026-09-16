// Synthetic result-classifier coverage. No guest, browser, input or real checkpoint.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { assertInputTrialSource, assertInputTrialRuntime, R3_IDENTITIES } from "../../../tools/verify/omarchy-input-trial.mjs";
import { modePreparationOptions, validatePreparedPair, MODE_PREPARATION_MS } from "../../../tools/verify/omarchy-mode-preparation.mjs";
import { assertOriginalPresentation } from "../../../tools/verify/omarchy-opaque-foot-command.mjs";
import { DIRECT_OPAQUE_COMMAND, auditDirectOpaque } from "../../../tools/verify/omarchy-direct-opaque-command.mjs";
import { auditSerial } from "../../../tools/verify/omarchy-latency-receipt.mjs";
import { formatRpcCommand } from "../../../web/guest-rpc.js";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const source = await fs.readFile(new URL("../../../tools/verify/omarchy-prepare-direct-opaque.mjs", import.meta.url), "utf8");
const start = source.indexOf('try {\n  assert.equal(report.mode,"direct-opaque-pair")');
const end = source.indexOf('\nconsole.log(JSON.stringify(receipt', start);
assert.ok(start > 0 && end > start);
const pair = await fs.mkdtemp(path.join(os.tmpdir(), "opaque-verifier-postprocessor-"));
const epoch = Date.parse("2026-09-16T00:00:00.000Z");
const at = offset => new Date(epoch + offset).toISOString();
const pstate = count => ({ framesReceived: count, successfulPresents: count,
  latest: { resourceWidth: 1280, resourceHeight: 832, rect: { x: 0, y: 0, width: 1280, height: 800 } } });
const foot = { class: "foot", mapped: true, hidden: false, address: "0xcafe123", at: [12, 38], size: [1256, 750] };
const propertyStdout = [...Array(8).fill("ok"), "true", "true", "1", "1.000000", "1", "true", "true", "true", JSON.stringify(foot)].join("\n") + "\n";
const manifestFilename = new URL("../../../target/omarchy-profile-chunks-sdr-r3-256k/manifest.json", import.meta.url).pathname;
const rawManifest = await fs.readFile(manifestFilename), manifest = JSON.parse(rawManifest);
const base = sha(JSON.stringify(Object.fromEntries(["version", "image_len", "chunk_size", "layout", "chunks"].map(k => [k, manifest[k]]))));
const generation = 7, snapshot = Buffer.alloc(1048577), delta = Buffer.alloc(61 + 4104);
snapshot.write("WVMRESU1"); snapshot.writeUInt32LE(1, 8); snapshot.write("0.0.1", 12);
Buffer.from(base, "hex").copy(snapshot, 44); snapshot.writeBigUInt64LE(BigInt(generation), 76);
delta.write("WVOD1"); delta.writeUInt32LE(4096, 5); delta.writeBigUInt64LE(4294967296n, 9);
Buffer.from(base, "hex").copy(delta, 17); delta.writeBigUInt64LE(BigInt(generation), 49);
delta.writeUInt32LE(1, 57); delta.writeBigUInt64LE(3n, 61); delta.fill(19, 69);

function serial(command, token, stdout, sent, completed) {
  return [
    { type: "serial-input", sent: true, timestamp: at(sent), ms: sent, bytes: [...Buffer.from(formatRpcCommand(command, token))] },
    { type: "serial-output", timestamp: at(completed), ms: completed, text: `\n__WVBEGIN_${token}\n${stdout}\n__WVEND_${token}_0\n` },
  ];
}

try {
  const report = { mode: "direct-opaque-pair", trial: { head: "synthetic-frozen-head", scopedStatus: "" },
    identities: { files: { "pkg/wasm_vm_wasm_bg.wasm": { sha256: "synthetic-wasm" } } },
    candidate: { source: { ...structuredClone(R3_IDENTITIES),
      image: { imageLen: 4294967296, chunkSize: 262144, chunkCount: 16384 } } },
    startup: { startedAt: at(0), deadlineAt: at(900000), timeoutMs: 900000 },
    cleanup: { closed: true }, errors: [], inputEvents: [], observations: [],
    preparationInputFence: { ignore: true, acknowledgedAt: at(0) }, browserRequests: [{ timestamp: at(1) }],
    directOpaqueRequested: true, directOpaque: { command: DIRECT_OPAQUE_COMMAND, requestCount: 1, startedAt: at(10),
      respondedAt: at(21), deadlineAtMs: epoch + 900000, status: "properties-confirmed",
      response: { stdout: propertyStdout, exit: 0 }, foot },
    workerTraffic: [...serial(DIRECT_OPAQUE_COMMAND, "v1", propertyStdout.trimEnd(), 10, 20)],
    result: "prepared-mode-pair-input-untested",
    modePreparation: { status: "pair-captured-input-untested", runtimeBefore: { presentation: pstate(1) },
      lastPixels: { pixels: { nonblank: true }, state: pstate(3) }, presentationBaseline: pstate(2),
      foot, baselineAt: at(50), visibleAt: at(100), exportStartedAt: at(100),
      exportFinishedAt: at(200), exportDeadlineAt: at(180100) },
    pair: { base, generation, snapshotBytes: snapshot.length, blocks: 1,
      coreId: snapshot.subarray(12, 44).toString("hex"), paused: true, restoreDecision: "resume" },
  };
  report.candidate.source.chunkManifest.filename = manifestFilename;
  for (const [role, name, raw] of [["snapshot", "omarchy-ready.snap.gz", snapshot], ["delta", "omarchy-overlay-delta.bin.gz", delta]]) {
    const compressed = gzipSync(raw), filename = path.join(pair, name);
    await fs.writeFile(filename, compressed);
    report.pair[role] = { filename, size: compressed.length, sha256: sha(compressed) };
  }
  const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
  async function check(candidate) {
    let saves = 0;
    const receipt = { head: "synthetic-frozen-head", wasmSha256: "synthetic-wasm" };
    const bindings = { assert, fs, path, pair, report: candidate, receipt, sha, gunzipSync,
      assertInputTrialSource, assertInputTrialRuntime, modePreparationOptions, validatePreparedPair,
      MODE_PREPARATION_MS, DIRECT_OPAQUE_COMMAND, auditDirectOpaque, assertOriginalPresentation,
      auditSerial, save: async () => { saves++; } };
    let error = null;
    try { await new AsyncFunction(...Object.keys(bindings), source.slice(start, end))(...Object.values(bindings)); }
    catch (cause) { error = String(cause); }
    assert.equal(saves, 1);
    return { receipt, saves, error };
  }
  const positive = await check(report);
  assert.equal(positive.error, null);
  assert.equal(positive.receipt.usablePair, false);
  assert.equal(positive.receipt.result, "prepared-pair-awaiting-personal-image-verification");
  assert.equal(positive.receipt.pair.generation, generation);
  const negativeReport = structuredClone(report);
  negativeReport.result = "failed"; negativeReport.modePreparation.status = "preparation-failed-input-untested";
  delete negativeReport.pair;
  const negative = await check(negativeReport);
  assert.equal(negative.error, null);
  assert.equal(negative.receipt.usablePair, false);
  assert.equal(negative.receipt.result, "preparation-failed-input-untested");
  // A different generation, even with honestly recomputed compressed metadata,
  // cannot be classified as a coherent pair by the actual postprocessor body.
  const foreignReport = structuredClone(report), foreignDelta = Buffer.from(delta);
  foreignDelta.writeBigUInt64LE(8n, 49);
  const compressed = gzipSync(foreignDelta);
  await fs.writeFile(foreignReport.pair.delta.filename, compressed);
  Object.assign(foreignReport.pair.delta, { size: compressed.length, sha256: sha(compressed) });
  const foreign = await check(foreignReport);
  assert.match(foreign.error, /8n !== 7n/u);
  assert.ok(foreign.receipt.auditError && foreign.receipt.result === undefined && foreign.receipt.usablePair !== true);
  console.log(JSON.stringify({ synthetic: true, noGuestOrBrowser: true, headerOnlySyntheticSnapshot: true,
    sourceSha256: sha(source), sourceRange: { start, end }, positive, negative, foreign }, null, 2));
} finally { await fs.rm(pair, { recursive: true, force: true }); }
