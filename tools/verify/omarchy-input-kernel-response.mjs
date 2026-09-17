#!/usr/bin/env node
// One physical-input run on AR's exact verified desktop pair; optional pixel diagnostics.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { watchOwnedTrial } from "./omarchy-owned-trial.mjs";
import { INPUT_BUFFER_PREPARED_IDENTITIES, INPUT_BUFFER_PREPARED_RECORD_SHA256,
  INPUT_BUFFER_RESPONSE_WASM } from "./omarchy-input-kernel-response-state.mjs";
import { auditInputKernelResponse } from "./omarchy-input-kernel-response-audit.mjs";
import { loadGpuTransferRuntime } from "./omarchy-gpu-transfer-runtime.mjs";
import { auditDisplayPixelProbe } from "./omarchy-display-pixel-probe.mjs";
import { auditLateDisplay, DISPLAY_LATE_MS } from "./omarchy-display-late-probe.mjs";

assert.ok(process.argv.length === 4 || (process.argv.length === 5 && ["--gpu-transfer-offset", "--display-pixel-probe", "--display-late-probe", "--prepared-cap-1024", "--prepared-cap-1024-cache16384", "--display-late-cap-1024-cache16384", "--prepared-cap-1024-cache16384-no-jalr", "--prepared-cap-1024-cache16384-code-page-index", "--prepared-cap-1024-cache16384-no-dynamic-publication"].includes(process.argv[4])),
  "usage: omarchy-input-kernel-response.mjs NEW_OUTPUT_DIR VERIFIED_AR_PAIR_DIR [--gpu-transfer-offset|--display-pixel-probe|--display-late-probe|--prepared-cap-1024|--prepared-cap-1024-cache16384|--display-late-cap-1024-cache16384|--prepared-cap-1024-cache16384-no-jalr|--prepared-cap-1024-cache16384-code-page-index|--prepared-cap-1024-cache16384-no-dynamic-publication]");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const [out, pair] = process.argv.slice(2, 4).map(file => path.resolve(file));
const codePageIndex = process.argv[4] === "--prepared-cap-1024-cache16384-code-page-index";
const noDynamicPublication = process.argv[4] === "--prepared-cap-1024-cache16384-no-dynamic-publication";
const gpuRuntime = process.argv[4] && !codePageIndex && !noDynamicPublication ? await loadGpuTransferRuntime(repo) : null;
const displayLateCache16384 = process.argv[4] === "--display-late-cap-1024-cache16384";
const displayLateProbe = displayLateCache16384 || process.argv[4] === "--display-late-probe";
const displayPixelProbe = displayLateProbe || process.argv[4] === "--display-pixel-probe";
const preparedCap1024 = process.argv[4] === "--prepared-cap-1024";
const preparedCap1024Cache16384NoJalr = process.argv[4] === "--prepared-cap-1024-cache16384-no-jalr";
const preparedCap1024Cache16384 = displayLateCache16384 || process.argv[4] === "--prepared-cap-1024-cache16384" || preparedCap1024Cache16384NoJalr || codePageIndex || noDynamicPublication;
const experiment = noDynamicPublication ? "prepared-cap-1024-cache16384-no-dynamic-publication"
  : codePageIndex ? "prepared-cap-1024-cache16384-code-page-index"
  : preparedCap1024Cache16384NoJalr ? "prepared-cap-1024-cache16384-no-jalr"
  : preparedCap1024Cache16384 ? "prepared-cap-1024-cache16384"
  : preparedCap1024 ? "prepared-cap-1024" : "prepared-recycling";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const wasmPath = path.join(repo, "web/dist/pkg/wasm_vm_wasm_bg.wasm");
const wasmBytes = await fs.readFile(wasmPath);
const wasmSha256 = codePageIndex || noDynamicPublication ? sha(wasmBytes) : gpuRuntime?.wasmSha256 ?? INPUT_BUFFER_RESPONSE_WASM;
for (const [role, file] of [["bootSnapshot", "omarchy-ready.snap.gz"], ["overlayDelta", "omarchy-overlay-delta.bin.gz"]]) {
  const bytes = await fs.readFile(path.join(pair, file));
  assert.equal(bytes.length, INPUT_BUFFER_PREPARED_IDENTITIES[role].size);
  assert.equal(sha(bytes), INPUT_BUFFER_PREPARED_IDENTITIES[role].sha256);
}
const preparedRecord = path.join(repo, "evidence/omarchy-profile/input-kernel-pair-r1/browser/run.json");
assert.equal(sha(await fs.readFile(preparedRecord)), INPUT_BUFFER_PREPARED_RECORD_SHA256);
assert.equal(sha(wasmBytes), wasmSha256);
await fs.mkdir(out, { recursive: false });
const receipt = { kind: "input-buffer-physical-response", desktopAcceptance: false, visualInspectionRequired: true,
  diagnosticOnly: displayPixelProbe, experiment,
  head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
  wasmSha256, gpuRuntime: gpuRuntime?.record ?? null,
  candidateRuntime: codePageIndex || noDynamicPublication ? { task: noDynamicPublication ? "E5.5-T03bb" : "E5.5-T03ba", files: { ["web/dist/pkg/wasm_vm_wasm_bg.wasm"]: { size: wasmBytes.length, sha256: wasmSha256 } } } : null,
  pairDirectory: pair, pairIdentities: INPUT_BUFFER_PREPARED_IDENTITIES,
  preparedRecord: { filename: preparedRecord, sha256: INPUT_BUFFER_PREPARED_RECORD_SHA256 },
  startedAt: new Date().toISOString() };
const save = () => fs.writeFile(path.join(out, "run.json"), JSON.stringify(receipt, null, 2) + "\n");
await save();
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith("OMARCHY_")) delete env[key];
Object.assign(env, { OMARCHY_INPUT_TRIAL_ARM: "candidate", OMARCHY_INPUT_TRIAL_EXPERIMENT: experiment,
  OMARCHY_PREPARED_DIRECT: "1", OMARCHY_INPUT_KERNEL_PREPARED: "1", OMARCHY_CANDIDATE_PAIR_DIR: pair,
  OMARCHY_CANDIDATE_CHUNKS: path.join(repo, "target/omarchy-profile-chunks-sdr-r3-256k") });
if (displayPixelProbe) env.OMARCHY_DISPLAY_PIXEL_PROBE = "1";
if (displayLateProbe) env.OMARCHY_DISPLAY_LATE_PROBE = "1";
receipt.args = ["tools/verify/omarchy-desktop-live.mjs", "local", path.join(out, "desktop"), "input-trial"];
const log = createWriteStream(path.join(out, "desktop.log"), { flags: "wx" });
const child = spawn(process.execPath, receipt.args, { cwd: repo, env, detached: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
receipt.exit = await watchOwnedTrial(child, { postVerdictCaptureMs: displayLateProbe ? DISPLAY_LATE_MS : 0 });
child.stdout.unpipe(log); child.stderr.unpipe(log); await new Promise(resolve => log.end(resolve));
receipt.finishedAt = new Date().toISOString(); await save();
if (!receipt.exit.closed || receipt.exit.watchdog || receipt.exit.error) {
  child.unref(); child.stdout.destroy(); child.stderr.destroy(); if (child.connected) child.disconnect();
  throw Error("physical input trial did not close normally; UNPROVEN");
}
try {
  const bytes = await fs.readFile(path.join(out, "desktop/report.json")), report = JSON.parse(bytes);
  receipt.reportSha256 = sha(bytes);
  Object.assign(receipt, auditInputKernelResponse(report, receipt.head, { wasmSha256, displayPixelProbe, displayLateProbe, experiment }));
  if (displayPixelProbe) receipt.displayPixels = await auditDisplayPixelProbe(report, path.join(out, "desktop"));
  if (displayLateProbe) receipt.lateDisplay = await auditLateDisplay(report, path.join(out, "desktop"));
  receipt.result = report.result;
  receipt.machineAcceptance = receipt.input.machineAcceptance;
  assert.equal(receipt.exit.code, receipt.machineAcceptance ? 0 : 1);
  receipt.images = {};
  for (const file of ["desktop.png", "prepared-direct.png", "desktop-keyboard.png", "failure.png"]) {
    const bytes = await fs.readFile(path.join(out, "desktop", file)).catch(error => {
      if (error.code === "ENOENT") return null; throw error;
    });
    if (bytes) receipt.images[file] = { size: bytes.length, sha256: sha(bytes) };
  }
  assert.ok(receipt.images[receipt.machineAcceptance ? "desktop-keyboard.png" : "failure.png"], "missing final real image");
} catch (error) { receipt.auditError = String(error); throw error; }
finally { await save(); }
console.log(JSON.stringify({ result: receipt.result, machineAcceptance: receipt.machineAcceptance,
  desktopAcceptance: false, visualInspectionRequired: true }));
