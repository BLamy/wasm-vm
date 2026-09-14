#!/usr/bin/env node
// One real post-fix desktop run, not another recycling A/B or a relaxed input gate.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { watchOwnedTrial } from "./omarchy-owned-trial.mjs";
import { auditSerial } from "./omarchy-latency-receipt.mjs";
import { assertInputTrialRuntime } from "./omarchy-input-trial.mjs";

export function auditDesktopServicesReport(report) {
  assert.equal(report.trial.recycling, false, "service test must retain default admission");
  assert.equal(report.trial.scopedStatus, "");
  assert.equal(report.cleanup.closed, true);
  assert.deepEqual(report.errors, []);
  const state = report.trial.runtimeAfter ?? report.observations.findLast(row => row.runtime)?.runtime;
  assertInputTrialRuntime(state, { recycling: false });
  assert.equal(state.guestSession?.key, "omarchy", "not the actual Omarchy owner");
  assert.ok(Number.isSafeInteger(state.guestSession.generation) && state.guestSession.generation > 0);
  assert.equal(report.workerTraffic.filter(row => row.method === "sendAgentInput").length, 0,
    "ordinary Omarchy boot started an unsolicited agent session");
  const serial = auditSerial(report.workerTraffic, report.serialCommands.map(row => row.command));
  assert.ok(serial.length > 0, "actual compositor readiness query was not recorded");
  assert.ok(serial.some(row => row.command === "XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j layers"));
  assert.ok(serial.every(row => !/ls -la|wvrun|\/opt\/containers/u.test(row.command)),
    "hidden CLI IDE work reached the guest");
  if (report.result === "input-trial-physical-nonce-and-fresh-presentation") {
    assert.equal(report.keyboard?.verified, true);
    assert.ok(Date.parse(report.keyboard.completedAt) <= Date.parse(report.keyboard.deadlineAt));
    assert.ok(report.inputEvents.some(row => row.type === "keydown" && row.trusted && row.code === "Enter"));
    assert.ok(report.trial.presentationAfter.framesReceived > report.trial.presentationBaseline.framesReceived);
    assert.ok(report.trial.presentationAfter.successfulPresents > report.trial.presentationBaseline.successfulPresents);
  }
  return { serviceIsolation: true, desktopAcceptance: report.result === "input-trial-physical-nonce-and-fresh-presentation",
    inputOutcome: report.trial.outcome ?? report.result, serial,
    keyboard: report.keyboard ?? null, guestSession: state.guestSession, presentation: state.presentation,
    note: "Absence of hidden service traffic is not sufficient evidence of interactive input." };
}

async function main(output) {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  assert.ok(output, "usage: omarchy-desktop-services.mjs NEW_OUTPUT_DIR");
  const out = path.resolve(output); await fs.mkdir(out, { recursive: false });
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
  const wasmSha256 = createHash("sha256").update(await fs.readFile(path.join(repo, "web/dist/pkg/wasm_vm_wasm_bg.wasm"))).digest("hex");
  const receipt = { purpose: "desktop-service-isolation", head, wasmSha256, startedAt: new Date().toISOString() };
  const save = () => fs.writeFile(path.join(out, "run.json"), JSON.stringify(receipt, null, 2) + "\n");
  await save();
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("OMARCHY_")) delete env[key];
  Object.assign(env, { OMARCHY_INPUT_TRIAL_ARM: "control",
    OMARCHY_CANDIDATE_PAIR_DIR: path.join(repo, "target/omarchy-sdr-r3-snapshot"),
    OMARCHY_CANDIDATE_CHUNKS: path.join(repo, "target/omarchy-profile-chunks-sdr-r3-256k") });
  receipt.args = ["tools/verify/omarchy-desktop-live.mjs", "local", path.join(out, "desktop"), "input-trial"];
  const log = createWriteStream(path.join(out, "desktop.log"), { flags: "wx" });
  const child = spawn(process.execPath, receipt.args, { cwd: repo, env, detached: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  receipt.exit = await watchOwnedTrial(child);
  child.stdout.unpipe(log); child.stderr.unpipe(log);
  await new Promise(resolve => log.end(resolve));
  receipt.finishedAt = new Date().toISOString(); await save();
  if (!receipt.exit.closed || receipt.exit.watchdog || receipt.exit.error) {
    child.unref(); child.stdout.destroy(); child.stderr.destroy();
    if (child.connected) child.disconnect();
    throw Error("owned desktop run did not close normally; preserve as UNPROVEN");
  }
  const report = JSON.parse(await fs.readFile(path.join(out, "desktop/report.json"), "utf8"));
  assert.equal(report.trial.head, head);
  assert.equal(report.identities.files["pkg/wasm_vm_wasm_bg.wasm"].sha256, wasmSha256);
  try { receipt.audit = auditDesktopServicesReport(report); }
  catch (error) { receipt.auditError = String(error); throw error; }
  finally { await save(); }
  console.log(JSON.stringify(receipt.audit));
  if (!receipt.audit.desktopAcceptance) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main(process.argv[2]);
}
