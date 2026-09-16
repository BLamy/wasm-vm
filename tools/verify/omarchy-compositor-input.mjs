#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { watchOwnedTrial } from "./omarchy-owned-trial.mjs";
import { PREPARED_DIRECT_IDENTITIES } from "./omarchy-prepared-direct-state.mjs";
import { INPUT_OBSERVER_COLLECTION_MS } from "./omarchy-compositor-input-capture.mjs";
import { auditCompositorInput } from "./omarchy-compositor-input-audit.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
assert.equal(process.argv.length, 6, "usage: omarchy-compositor-input.mjs NEW_OUTPUT_DIR OBSERVER_RISCV64 VERIFIED_PAIR_DIR");
const [out, observer, pair] = process.argv.slice(2).map(file => path.resolve(file));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
for (const [role, filename] of [["bootSnapshot", "omarchy-ready.snap.gz"], ["overlayDelta", "omarchy-overlay-delta.bin.gz"]]) {
  const bytes = await fs.readFile(path.join(pair, filename));
  assert.equal(bytes.length, PREPARED_DIRECT_IDENTITIES[role].size); assert.equal(sha(bytes), PREPARED_DIRECT_IDENTITIES[role].sha256);
}
const wasmSha256 = sha(await fs.readFile(path.join(repo, "web/dist/pkg/wasm_vm_wasm_bg.wasm")));
assert.equal(wasmSha256, "36b4f1ccf9e1437f687eae552aca3290fab7c555dfd7fa9fac6cc3862d87a916");
await fs.mkdir(out, { recursive: false });
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
const receipt = { purpose: "actual-compositor-input-read-diagnostic", desktopAcceptance: false, head, wasmSha256,
  observerSha256: sha(await fs.readFile(observer)), pairDirectory: pair, pairIdentities: PREPARED_DIRECT_IDENTITIES,
  startedAt: new Date().toISOString() };
const save = () => fs.writeFile(path.join(out, "run.json"), JSON.stringify(receipt, null, 2) + "\n");
await save();
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith("OMARCHY_")) delete env[key];
Object.assign(env, { OMARCHY_INPUT_TRIAL_ARM: "candidate", OMARCHY_INPUT_TRIAL_EXPERIMENT: "prepared-recycling",
  OMARCHY_PREPARED_DIRECT: "1", OMARCHY_CANDIDATE_PAIR_DIR: pair, OMARCHY_INPUT_OBSERVER: observer,
  OMARCHY_CANDIDATE_CHUNKS: path.join(repo, "target/omarchy-profile-chunks-sdr-r3-256k") });
receipt.args = ["tools/verify/omarchy-desktop-live.mjs", "local", path.join(out, "desktop"), "input-trial"];
const log = createWriteStream(path.join(out, "desktop.log"), { flags: "wx" });
const child = spawn(process.execPath, receipt.args, { cwd: repo, env, detached: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
receipt.exit = await watchOwnedTrial(child, { postVerdictCaptureMs: INPUT_OBSERVER_COLLECTION_MS });
child.stdout.unpipe(log); child.stderr.unpipe(log); await new Promise(resolve => log.end(resolve));
receipt.finishedAt = new Date().toISOString(); await save();
if (!receipt.exit.closed || receipt.exit.watchdog || receipt.exit.error) {
  child.unref(); child.stdout.destroy(); child.stderr.destroy(); if (child.connected) child.disconnect();
  throw Error("compositor input diagnostic did not close normally; UNPROVEN");
}
try {
  const bytes = await fs.readFile(path.join(out, "desktop/report.json"));
  receipt.reportSha256 = sha(bytes); const report = JSON.parse(bytes);
  const trace = await fs.readFile(path.join(out, "desktop/compositor-input.jsonl"));
  assert.equal(sha(trace), report.inputObserver.trace.sha256);
  const audit = auditCompositorInput(report, receipt, trace.toString("utf8"));
  await fs.writeFile(path.join(out, "audit.json"), JSON.stringify(audit, null, 2) + "\n");
  receipt.diagnosticRecorded = true;
  receipt.streams = audit.observed.streams.map(({ identity, keyEvents, synReports, synDropped, matchesEntirePhysicalSequence }) =>
    ({ identity, keyEvents, synReports, synDropped, matchesEntirePhysicalSequence }));
  receipt.tracingErrors = audit.observed.errors;
} catch (error) { receipt.auditError = String(error); throw error; }
finally { await save(); }
console.log(JSON.stringify(receipt, null, 2));
