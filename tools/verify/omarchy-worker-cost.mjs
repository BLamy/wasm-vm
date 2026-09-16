#!/usr/bin/env node
// One post-verdict host-cost diagnostic. Child acceptance is never relabeled.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { watchOwnedTrial } from "./omarchy-owned-trial.mjs";
import { inputTrialOptions, assertInputTrialRuntime, assertInputTrialSource } from "./omarchy-input-trial.mjs";
import { WORKER_COST_CAPTURE_MS, validateWorkerCostProfile, workerCostInputVerdict } from "./omarchy-worker-cost-capture.mjs";
import { auditSerial } from "./omarchy-latency-receipt.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
assert.ok(process.argv[2], "usage: omarchy-worker-cost.mjs NEW_OUTPUT_DIR");
const out = path.resolve(process.argv[2]); await fs.mkdir(out, { recursive: false });
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
const receipt = { purpose: "post-verdict-worker-cost", acceptanceClaim: false, head,
  wasmSha256: sha(await fs.readFile(path.join(repo, "web/dist/pkg/wasm_vm_wasm_bg.wasm"))),
  startedAt: new Date().toISOString() };
const save = () => fs.writeFile(path.join(out, "run.json"), JSON.stringify(receipt, null, 2) + "\n");
await save();
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith("OMARCHY_")) delete env[key];
Object.assign(env, { OMARCHY_INPUT_TRIAL_ARM: "candidate", OMARCHY_INPUT_TRIAL_EXPERIMENT: "residency",
  OMARCHY_WORKER_COST: "1", OMARCHY_CANDIDATE_PAIR_DIR: path.join(repo, "target/omarchy-sdr-r3-snapshot"),
  OMARCHY_CANDIDATE_CHUNKS: path.join(repo, "target/omarchy-profile-chunks-sdr-r3-256k") });
receipt.args = ["tools/verify/omarchy-desktop-live.mjs", "local", path.join(out, "desktop"), "input-trial"];
const log = createWriteStream(path.join(out, "desktop.log"), { flags: "wx" });
const child = spawn(process.execPath, receipt.args, { cwd: repo, env, detached: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
receipt.exit = await watchOwnedTrial(child, { postVerdictCaptureMs: WORKER_COST_CAPTURE_MS });
child.stdout.unpipe(log); child.stderr.unpipe(log); await new Promise(resolve => log.end(resolve));
receipt.finishedAt = new Date().toISOString(); await save();
if (!receipt.exit.closed || receipt.exit.watchdog || receipt.exit.error) {
  child.unref(); child.stdout.destroy(); child.stderr.destroy(); if (child.connected) child.disconnect();
  throw Error("worker cost diagnostic did not close normally; UNPROVEN");
}
const report = JSON.parse(await fs.readFile(path.join(out, "desktop/report.json"), "utf8"));
try {
  assert.equal(report.trial.head, head); assert.equal(report.trial.scopedStatus, "");
  assert.equal(report.identities.files["pkg/wasm_vm_wasm_bg.wasm"].sha256, receipt.wasmSha256);
  assertInputTrialSource(report.candidate.source);
  const options = inputTrialOptions({ urlArg: "local", pair: "pinned", chunks: "pinned", arm: "candidate",
    renderer: null, lp: null, experiment: "residency" });
  for (const row of report.observations.filter(row => row.runtime)) assertInputTrialRuntime(row.runtime, options);
  assert.equal(report.restored, true); assert.equal(report.cleanup.closed, true); assert.deepEqual(report.errors, []);
  receipt.inputResult = report.result; receipt.keyboard = report.keyboard;
  if (report.result === "input-trial-physical-nonce-and-fresh-presentation") {
    assert.equal(report.workerCost.status, "skipped-input-passed");
    receipt.result = "unexpected input pass retained; failure diagnostic skipped; separate visual verification required";
  } else {
    const verdict = JSON.parse(workerCostInputVerdict(report));
    const capture = report.workerCost;
    assert.equal(capture?.status, "captured"); assert.deepEqual(capture.inputVerdict, verdict);
    assert.ok(Date.parse(capture.startedAt) >= Date.parse(report.keyboard.failedAt));
    assert.ok(Date.parse(capture.finishedAt) <= Date.parse(capture.deadlineAt));
    assert.equal(capture.failureImageSha256, sha(await fs.readFile(path.join(out, "desktop/failure.png"))));
    const bytes = await fs.readFile(path.join(out, "desktop/worker-cpu.json"));
    assert.equal(sha(bytes), capture.sha256); assert.equal(bytes.length, capture.bytes);
    receipt.profile = validateWorkerCostProfile(JSON.parse(bytes), new URL("./linux-worker.js", report.url).href);
    const read = `if [ -f '${report.keyboard.guestFile}' ]; then cat '${report.keyboard.guestFile}'; else (exit 75); fi`;
    const serial = auditSerial(report.workerTraffic, [read]);
    assert.ok(serial.every(row => row.command === read || row.command === "XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j layers"));
    for (const row of report.workerTraffic.filter(row => row.type === "serial-input")) {
      assert.ok(!Buffer.from(row.bytes).toString("ascii").includes(report.keyboard.nonce));
      assert.ok(Date.parse(row.timestamp) <= Date.parse(report.keyboard.failedAt), "new serial input after verdict");
    }
    assert.ok(report.inputEvents.every(row => Date.parse(row.timestamp) <= Date.parse(report.keyboard.failedAt)),
      "new physical input after verdict");
    receipt.result = "post-verdict CPU sample captured; desktop acceptance remains failed";
  }
} catch (error) { receipt.auditError = String(error); throw error; }
finally { await save(); }
console.log(JSON.stringify(receipt, null, 2));
