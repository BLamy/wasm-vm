// Recorded input audit, shared with fixed-command diagnostics. Images still need inspection.
import assert from "node:assert/strict";
import { inputTrialOptions, assertInputTrialRuntime, assertInputTrialSource } from "./omarchy-input-trial.mjs";
import { auditSerial } from "./omarchy-latency-receipt.mjs";
import { evdevForCode } from "../../web/src/input/keymap.js";
import { physicalStroke } from "./omarchy-browser-session.mjs";
import { assertPreparedDirectSource } from "./omarchy-prepared-direct-state.mjs";
const at = value => { const n = Date.parse(value); assert.ok(Number.isFinite(n), "invalid timestamp"); return n; };
const success = "input-trial-physical-nonce-and-fresh-presentation";
const layers = "XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j layers";

export function auditInputReport(report, { head, wasmSha256, arm, startupCommands = [], preparedDirect = false }) {
  assert.equal(typeof preparedDirect, "boolean");
  assert.equal(report.preparedDirectRequested === true, preparedDirect);
  assert.equal(report.trial.head, head, "wrong source head");
  assert.equal(report.trial.scopedStatus, "");
  assert.equal(report.trial.arm, arm);
  assert.equal(report.trial.experiment, "residency");
  assert.equal(report.trial.recycling, false);
  const options = inputTrialOptions({ urlArg: "local", pair: "pinned", chunks: "pinned", arm,
    renderer: null, lp: null, experiment: "residency" });
  assert.equal(report.trial.jitResidencyPolicy, options.jitResidencyPolicy);
  assert.equal(report.trial.jitResidencyCap, options.jitResidencyCap);
  for (const [key, value] of Object.entries({ startupMs: 300000, typingMs: 60000,
    readbackMs: 120000, captureMs: 20000, cleanupMs: 30000 })) assert.equal(report.trial[key], value);
  assert.equal(report.identities.files["pkg/wasm_vm_wasm_bg.wasm"].sha256, wasmSha256, "wrong WASM");
  assert.equal(report.startup.timeoutMs, 300000);
  assert.equal(at(report.startup.deadlineAt)-at(report.startup.startedAt), 300000);
  assert.equal(report.restored, true);
  if (preparedDirect) assertPreparedDirectSource(report.candidate.source);
  else assertInputTrialSource(report.candidate.source);
  assert.deepEqual(report.errors, []);
  assert.equal(report.cleanup.closed, true);
  const runtimes = report.observations.filter(row => row.runtime).map(row => row.runtime);
  assert.ok(runtimes.length, "no actual runtime policy observation");
  for (const runtime of runtimes) {
    assertInputTrialRuntime(runtime, options);
    for (const field of ["droppedFrames", "droppedEvents", "rejectedEvents"])
      assert.equal(runtime.inputDevice[field], 0, `input queue ${field}`);
  }
  const keyboard = report.keyboard;
  if (report.result === success || keyboard?.verified) {
    assert.ok(keyboard?.typedAt, "input success requires a completed physical sequence");
    assert.ok(Number.isSafeInteger(keyboard.enteredAtMs));
    assert.ok(at(keyboard.typedAt) >= keyboard.enteredAtMs);
  }
  const read = keyboard ? `if [ -f '${keyboard.guestFile}' ]; then cat '${keyboard.guestFile}'; else (exit 75); fi` : null;
  if (keyboard) {
    assert.match(keyboard.nonce, /^[a-f0-9]{16}$/u);
    assert.match(keyboard.guestFile, /^\/tmp\/desktop-keys-[a-f0-9]{16}$/u);
    assert.ok(!keyboard.guestFile.includes(keyboard.nonce));
  }
  assert.ok(report.serialCommands.every(row => row.command === read || startupCommands.includes(row.command)));
  const serial = auditSerial(report.workerTraffic, [...startupCommands, ...(read ? [read] : [])]);
  assert.ok(serial.every(row => row.command === layers || row.command === read || startupCommands.includes(row.command)), "unexpected serial command");
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
  const framedCalls = report.workerTraffic.filter(row => row.type === "worker-call" &&
    ["sendKeyboardEvent", "syncKeyboard"].includes(row.method));
  assert.equal(framedCalls.length, keys.length * 2, "one ordered sync per physical key event");
  for (let i = 0; i < framedCalls.length; i++) {
    const call = framedCalls[i];
    assert.equal(call.method, i % 2 ? "syncKeyboard" : "sendKeyboardEvent");
    assert.equal(call.sent, true);
    if (i % 2) assert.deepEqual(call.args, []);
    const responses = report.workerTraffic.filter(row => row.type === "input-result" &&
      row.worker === call.worker && row.method === call.method && row.id === call.id);
    assert.equal(responses.length, 1); assert.equal(responses[0].result, true);
    assert.equal(responses[0].error, null);
    assert.ok(at(responses[0].timestamp) >= at(call.timestamp));
  }
  if (keyboard?.typedAt) {
    const expectedEvents = [];
    for (const character of `printf '${keyboard.nonce}' > ${keyboard.guestFile}`) {
      const { code, shift } = physicalStroke(character);
      if (shift) expectedEvents.push(["keydown", "ShiftLeft"]);
      expectedEvents.push(["keydown", code], ["keyup", code]);
      if (shift) expectedEvents.push(["keyup", "ShiftLeft"]);
    }
    expectedEvents.push(["keydown", "Enter"], ["keyup", "Enter"]);
    assert.deepEqual(keys.map(row => [row.type, row.code]), expectedEvents, "incomplete physical key sequence");
    assert.ok(at(keys[0].timestamp) >= at(keyboard.startedAt));
    assert.ok(at(keys.at(-1).timestamp) <= keyboard.enteredAtMs);
    const typed = keys.filter(row => row.type === "keydown" && row.key.length === 1).map(row => row.key).join("");
    assert.equal(typed, `printf '${keyboard.nonce}' > ${keyboard.guestFile}`);
    assert.ok(keys.some(row => row.type === "keydown" && row.code === "Enter"));
    assert.equal(keyboard.readbackTimeoutMs, 120000);
    assert.equal(at(keyboard.deadlineAt), keyboard.enteredAtMs + 120000);
    assert.ok(keyboard.typingMs <= 60000);
    assert.equal(keyboard.typingMs, keyboard.enteredAtMs - at(keyboard.startedAt));
    assert.ok(at(report.startup.readyProvenAt) <= at(report.startup.deadlineAt));
    assert.ok(report.events.some(row => row.type === "wvm:desktop-ready"));
  }
  const reads = serial.filter(row => row.command === read);
  const nonceReplies = reads.filter(row => row.response?.exit === 0 && row.response.stdout.trim() === keyboard?.nonce);
  if (report.result === success || keyboard?.verified) {
    assert.equal(keyboard.verified, true);
    assert.ok(at(keyboard.completedAt) >= keyboard.enteredAtMs);
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
    residency: { policy: before.jit.jitResidencyPolicy, cap: before.jit.jitResidencyCap },
    cacheBefore: { blocks: before.jit.compiledBlocks, installs: before.jit.jitCacheInstalls, evictions: before.jit.jitCacheEvictions },
    cacheAfter: { blocks: after.jit.compiledBlocks, installs: after.jit.jitCacheInstalls, evictions: after.jit.jitCacheEvictions },
    serial };
}
