#!/usr/bin/env node
// One physical input trial from the exact separately verified prepared pair.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { watchOwnedTrial } from "./omarchy-owned-trial.mjs";
import { auditInputReport } from "./omarchy-input-audit.mjs";
import { PREPARED_DIRECT_COMMAND, PREPARED_DIRECT_IDENTITIES, PREPARED_DIRECT_WASM,
  auditPreparedDirect } from "./omarchy-prepared-direct-state.mjs";
import { assertOriginalPresentation } from "./omarchy-opaque-foot-command.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
assert.ok(process.argv[2] && process.argv[3], "usage: omarchy-prepared-direct-input.mjs NEW_OUTPUT_DIR VERIFIED_PAIR_DIR");
const out = path.resolve(process.argv[2]), pair = path.resolve(process.argv[3]);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
for (const [role, filename] of [["bootSnapshot", "omarchy-ready.snap.gz"], ["overlayDelta", "omarchy-overlay-delta.bin.gz"]]) {
  const bytes = await fs.readFile(path.join(pair, filename));
  assert.equal(bytes.length, PREPARED_DIRECT_IDENTITIES[role].size);
  assert.equal(sha(bytes), PREPARED_DIRECT_IDENTITIES[role].sha256);
}
const wasmSha256 = sha(await fs.readFile(path.join(repo, "web/dist/pkg/wasm_vm_wasm_bg.wasm")));
assert.equal(wasmSha256, PREPARED_DIRECT_WASM, "trial requires verified AL runtime");
await fs.mkdir(out, { recursive: false });
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
const receipt = { purpose: "physical-input-from-prepared-direct-pair", acceptanceClaim: false, head,
  wasmSha256, pairDirectory: pair, pairIdentities: PREPARED_DIRECT_IDENTITIES, startedAt: new Date().toISOString() };
const save = () => fs.writeFile(path.join(out, "run.json"), JSON.stringify(receipt, null, 2) + "\n");
await save();
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith("OMARCHY_")) delete env[key];
Object.assign(env, { OMARCHY_INPUT_TRIAL_ARM: "candidate", OMARCHY_INPUT_TRIAL_EXPERIMENT: "residency",
  OMARCHY_PREPARED_DIRECT: "1", OMARCHY_CANDIDATE_PAIR_DIR: pair,
  OMARCHY_CANDIDATE_CHUNKS: path.join(repo, "target/omarchy-profile-chunks-sdr-r3-256k") });
receipt.args = ["tools/verify/omarchy-desktop-live.mjs", "local", path.join(out, "desktop"), "input-trial"];
const log = createWriteStream(path.join(out, "desktop.log"), { flags: "wx" });
const child = spawn(process.execPath, receipt.args, { cwd: repo, env, detached: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
receipt.exit = await watchOwnedTrial(child);
child.stdout.unpipe(log); child.stderr.unpipe(log); await new Promise(resolve => log.end(resolve));
receipt.finishedAt = new Date().toISOString(); await save();
if (!receipt.exit.closed || receipt.exit.watchdog || receipt.exit.error) {
  child.unref(); child.stdout.destroy(); child.stderr.destroy(); if (child.connected) child.disconnect();
  throw Error("prepared input trial did not close normally; UNPROVEN");
}
const bytes = await fs.readFile(path.join(out, "desktop/report.json"));
const report = JSON.parse(bytes);
try {
  receipt.reportSha256 = sha(bytes);
  receipt.input = auditInputReport(report, { head, wasmSha256, arm: "candidate", preparedDirect: true,
    startupCommands: [PREPARED_DIRECT_COMMAND] });
  receipt.configuration = auditPreparedDirect(report);
  for (const row of report.observations.filter(row => row.runtime)) assertOriginalPresentation(row.runtime.presentation);
  if (report.keyboard?.typedAt) {
    const fence = report.preparedDirectInputFence;
    assert.equal(fence.method, "Input.setIgnoreInputEvents"); assert.equal(fence.ignore, true);
    assert.ok(Date.parse(fence.startedAt) >= report.keyboard.enteredAtMs);
    assert.ok(Date.parse(fence.acknowledgedAt) >= Date.parse(fence.startedAt));
    assert.ok(Date.parse(fence.acknowledgedAt) < Date.parse(report.keyboard.deadlineAt));
    assert.ok(report.inputEvents.every(row => Date.parse(row.timestamp) <= Date.parse(fence.startedAt)));
  }
  receipt.result = report.result;
  receipt.desktopAcceptance = false; // Worker and fresh critic must personally inspect the real image.
  receipt.visualInspectionRequired = true;
} catch (error) { receipt.auditError = String(error); throw error; }
finally { await save(); }
console.log(JSON.stringify(receipt, null, 2));
