#!/usr/bin/env node
// Exactly one control then candidate. A failed arm is retained, never retried.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { watchOwnedTrial } from "./omarchy-owned-trial.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const [output] = process.argv.slice(2);
assert.ok(output, "usage: omarchy-recycling-ab.mjs NEW_OUTPUT_DIR");
const out = path.resolve(output);
await fs.mkdir(out, { recursive: false });
const head = () => execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
const frozenHead = head();
const wasm = await fs.readFile(path.join(repo, "web/dist/pkg/wasm_vm_wasm_bg.wasm"));
const wasmSha256 = createHash("sha256").update(wasm).digest("hex");
const results = { head: frozenHead, wasmSha256, startedAt: new Date().toISOString(), arms: [] };
await fs.writeFile(path.join(out, "ab.json"), JSON.stringify(results, null, 2) + "\n");
for (const arm of ["control", "candidate"]) {
  assert.equal(head(), frozenHead, "HEAD changed between arms");
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("OMARCHY_")) delete env[key];
  Object.assign(env, { OMARCHY_INPUT_TRIAL_ARM: arm,
    OMARCHY_CANDIDATE_PAIR_DIR: path.join(repo, "target/omarchy-sdr-r3-snapshot"),
    OMARCHY_CANDIDATE_CHUNKS: path.join(repo, "target/omarchy-profile-chunks-sdr-r3-256k") });
  const args = ["tools/verify/omarchy-desktop-live.mjs", "local", path.join(out, arm), "input-trial"];
  const entry = { arm, args, startedAt: new Date().toISOString() };
  results.arms.push(entry);
  const log = createWriteStream(path.join(out, `${arm}.log`), { flags: "wx" });
  console.log(`INPUT_TRIAL_START ${arm}`);
  const child = spawn(process.execPath, args, { cwd: repo, env, detached: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  const exit = await watchOwnedTrial(child);
  child.stdout.unpipe(log); child.stderr.unpipe(log);
  await new Promise(resolve => log.end(resolve));
  Object.assign(entry, { ...exit, finishedAt: new Date().toISOString() });
  await fs.writeFile(path.join(out, "ab.json"), JSON.stringify(results, null, 2) + "\n");
  if (!exit.closed || exit.watchdog || exit.error) {
    // Stop the batch even if the watchdog successfully killed the owned process group.
    child.unref(); child.stdout.destroy(); child.stderr.destroy();
    if (child.connected) child.disconnect();
    throw Error("trial process did not close within its bounded lifecycle; A/B aborted (UNPROVEN)");
  }
  const report = JSON.parse(await fs.readFile(path.join(out, arm, "report.json"), "utf8"));
  entry.result = report.result; entry.outcome = report.trial?.outcome ?? report.result;
  entry.startup = report.startup; entry.keyboard = report.keyboard; entry.cleanup = report.cleanup;
  await fs.writeFile(path.join(out, "ab.json"), JSON.stringify(results, null, 2) + "\n");
  assert.equal(report.trial.head, frozenHead);
  assert.equal(report.trial.scopedStatus, "");
  const recordedWasm = report.identities?.["pkg/wasm_vm_wasm_bg.wasm"]
    ?? report.resourceIdentities.find(row => row.pathname === "/pkg/wasm_vm_wasm_bg.wasm");
  assert.equal(recordedWasm?.sha256, wasmSha256, "arm did not serve the pinned WASM");
  assert.equal(report.cleanup?.closed, true, "previous browser not confirmed closed; do not start another arm");
  console.log(`INPUT_TRIAL_END ${JSON.stringify({ arm, code: exit.code, result: report.result, outcome: entry.outcome })}`);
}
results.finishedAt = new Date().toISOString();
results.claim = "Compare actual per-arm acceptance; counters alone do not establish responsiveness.";
await fs.writeFile(path.join(out, "ab.json"), JSON.stringify(results, null, 2) + "\n");
