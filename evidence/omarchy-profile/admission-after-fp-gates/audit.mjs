// Read-only result audit. A machine verdict still needs separate visual inspection.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertInputTrialRuntime, assertInputTrialSource } from "../../../tools/verify/omarchy-input-trial.mjs";
import { auditSerial } from "../../../tools/verify/omarchy-latency-receipt.mjs";
import { evdevForCode } from "../../../web/src/input/keymap.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const at = value => { const n = Date.parse(value); assert.ok(Number.isFinite(n), "invalid timestamp"); return n; };
const success = "input-trial-physical-nonce-and-fresh-presentation";
const layers = "XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j layers";

export function auditReport(report, { head, wasmSha256, arm }) {
  assert.equal(report.trial.head, head, "wrong source head");
  assert.equal(report.trial.scopedStatus, "");
  assert.equal(report.trial.arm, arm);
  assert.equal(report.trial.recycling, arm === "candidate");
  for (const [key, value] of Object.entries({ startupMs: 300000, typingMs: 60000,
    readbackMs: 120000, captureMs: 20000, cleanupMs: 30000 })) assert.equal(report.trial[key], value);
  assert.equal(report.identities.files["pkg/wasm_vm_wasm_bg.wasm"].sha256, wasmSha256, "wrong WASM");
  assert.equal(report.restored, true);
  assertInputTrialSource(report.candidate.source);
  assert.deepEqual(report.errors, []);
  assert.equal(report.cleanup.closed, true);
  const runtimes = report.observations.filter(row => row.runtime).map(row => row.runtime);
  assert.ok(runtimes.length, "no actual runtime policy observation");
  for (const runtime of runtimes) assertInputTrialRuntime(runtime, { recycling: arm === "candidate" });
  const keyboard = report.keyboard;
  const read = keyboard ? `if [ -f '${keyboard.guestFile}' ]; then cat '${keyboard.guestFile}'; else (exit 75); fi` : null;
  if (keyboard) {
    assert.match(keyboard.nonce, /^[a-f0-9]{16}$/u);
    assert.match(keyboard.guestFile, /^\/tmp\/desktop-keys-[a-f0-9]{16}$/u);
    assert.ok(!keyboard.guestFile.includes(keyboard.nonce));
  }
  assert.ok(report.serialCommands.every(row => row.command === read));
  const serial = auditSerial(report.workerTraffic, read ? [read] : []);
  assert.ok(serial.every(row => row.command === layers || row.command === read), "unexpected serial command");
  assert.equal(report.workerTraffic.filter(row => row.method === "sendAgentInput").length, 0);
  if (keyboard) for (const row of report.workerTraffic.filter(row => row.type === "serial-input")) {
    assert.ok(!Buffer.from(row.bytes).toString("ascii").includes(keyboard.nonce), "nonce injected through serial");
  }
  const keys = report.inputEvents;
  assert.ok(keys.every(row => row.trusted && row.target === "ide-display-canvas" && row.activeElement === "ide-display-canvas"));
  const calls = report.workerTraffic.filter(row => row.type === "worker-call" && row.method === "sendKeyboardEvent");
  assert.equal(calls.length, keys.length);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i], call = calls[i];
    assert.ok(["keydown", "keyup"].includes(key.type));
    assert.deepEqual(call.args, [1, evdevForCode(key.code), key.type === "keydown" ? 1 : 0]);
    assert.equal(call.sent, true);
    const responses = report.workerTraffic.filter(row => row.type === "input-result" && row.method === call.method && row.id === call.id);
    assert.equal(responses.length, 1); assert.equal(responses[0].result, true);
  }
  if (keyboard?.typedAt) {
    const typed = keys.filter(row => row.type === "keydown" && row.key.length === 1).map(row => row.key).join("");
    assert.equal(typed, `printf '${keyboard.nonce}' > ${keyboard.guestFile}`);
    assert.ok(keys.some(row => row.type === "keydown" && row.code === "Enter"));
    assert.equal(keyboard.readbackTimeoutMs, 120000);
    assert.equal(at(keyboard.deadlineAt), keyboard.enteredAtMs + 120000);
    assert.ok(keyboard.typingMs <= 60000);
    assert.ok(at(report.startup.readyProvenAt) <= at(report.startup.deadlineAt));
    assert.ok(report.events.some(row => row.type === "wvm:desktop-ready"));
  }
  const reads = serial.filter(row => row.command === read);
  const nonceReplies = reads.filter(row => row.response?.exit === 0 && row.response.stdout.trim() === keyboard?.nonce);
  if (report.result === success || keyboard?.verified) {
    assert.equal(keyboard.verified, true);
    assert.ok(at(keyboard.completedAt) <= at(keyboard.deadlineAt), "late nonce acceptance");
    assert.ok(nonceReplies.some(row => at(row.completedAt) <= at(keyboard.deadlineAt)), "no timely nonce on the raw wire");
  }
  if (report.result === success) {
    assert.ok(report.trial.presentationAfter.framesReceived > report.trial.presentationBaseline.framesReceived);
    assert.ok(report.trial.presentationAfter.successfulPresents > report.trial.presentationBaseline.successfulPresents);
  }
  const before = runtimes[0], after = runtimes.at(-1);
  const retired = after.jit.guestRetired - before.jit.guestRetired;
  const compiled = after.jit.retiredViaJit - before.jit.retiredViaJit;
  return { arm, machineAcceptance: report.result === success, visualInspectionRequired: true,
    result: report.result, outcome: report.trial.outcome ?? report.result, startup: report.startup,
    keyboard: keyboard ?? null, trustedEvents: keys.length, matchedKeyboardCalls: calls.length,
    completedReads: reads.filter(row => row.response).length, pendingReads: reads.filter(row => !row.response).length,
    readExits: reads.filter(row => row.response).map(row => row.response.exit),
    nonceReplies: nonceReplies.length, framesBefore: before.presentation.framesReceived,
    framesAfter: after.presentation.framesReceived, intervalRetired: retired,
    intervalJitRetired: compiled, intervalJitShare: retired ? compiled / retired : null,
    discoveryBefore: before.jit.discovery, discoveryAfter: after.jit.discovery,
    recyclingBefore: before.jit.coldCounterRecycling, recyclingAfter: after.jit.coldCounterRecycling,
    cacheBefore: { blocks: before.jit.compiledBlocks, installs: before.jit.jitCacheInstalls, evictions: before.jit.jitCacheEvictions },
    cacheAfter: { blocks: after.jit.compiledBlocks, installs: after.jit.jitCacheInstalls, evictions: after.jit.jitCacheEvictions },
    serial };
}

export async function auditPair(folder) {
  const frozen = JSON.parse(await fs.readFile(path.join(here, "frozen.json"), "utf8"));
  const pair = JSON.parse(await fs.readFile(path.join(folder, "ab.json"), "utf8"));
  assert.equal(pair.head, frozen.head); assert.equal(pair.wasmSha256, frozen.wasmSha256);
  assert.deepEqual(pair.arms.map(row => row.arm), ["control", "candidate"]);
  assert.ok(pair.finishedAt, "pair incomplete");
  assert.ok(at(pair.arms[1].startedAt) >= at(pair.arms[0].finishedAt), "overlapping arms");
  const summaries = [];
  for (const arm of pair.arms) {
    assert.equal(arm.closed, true); assert.equal(arm.watchdog, null); assert.ok(!arm.error);
    const bytes = await fs.readFile(path.join(folder, arm.arm, "report.json"));
    const report = JSON.parse(bytes);
    const summary = auditReport(report, { ...frozen, arm: arm.arm });
    summary.reportSha256 = hash(bytes); summary.screenshots = {};
    for (const name of ["desktop.png", "failure.png", "desktop-keyboard.png"]) {
      try { summary.screenshots[name] = hash(await fs.readFile(path.join(folder, arm.arm, name))); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    summaries.push(summary);
  }
  return { head: pair.head, wasmSha256: pair.wasmSha256, arms: summaries,
    note: "This validates recorded machine outcomes. Visible application response requires separate image inspection; counters alone are not responsiveness." };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const folder = path.resolve(process.argv[2]);
  const result = await auditPair(folder);
  await fs.writeFile(path.join(folder, "audit.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
}
