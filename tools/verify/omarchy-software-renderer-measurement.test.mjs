import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { parseProbe, probeCommand } from "./omarchy-browser-session.mjs";
import { validateObserverCommand, validateObserverTraffic } from "./omarchy-observer-guard.mjs";

import {
  INPUT_DEADLINE_MS,
  RECORD_TIMEOUT_MS,
  validateExecution,
  validateOutcome,
  validateProbeEvents,
  validatePatchReceipt,
} from "./omarchy-software-renderer-measurement.mjs";

test("T03f harness pins the separate cold record configuration", () => {
  const execution = {
    mode: "cold-wasm", timeoutMs: RECORD_TIMEOUT_MS, keyboard: "none", control: "stdin",
    noSnapshot: true, persistence: false, captureState: "cold", reusedWorker: false,
  };
  assert.deepEqual(validateExecution(execution), execution);
  assert.throws(() => validateExecution({ ...execution, timeoutMs: RECORD_TIMEOUT_MS - 1 }), /exact fresh cold-WASM/iu);
  assert.throws(() => validateExecution({ ...execution, persistence: true }), /exact fresh cold-WASM/iu);
});

test("T03f replays every sent/result probe from its recorded serial offset", () => {
  const token = "omarchy_test_1";
  const serial = `noise\n${token}_begin\n1000\n${token}_end:0\n`;
  const events = [
    { type: "probe-sent", token, command: "id -u", serialCharacterOffset: 0 },
    { type: "probe-result", token, status: 0, output: "1000", beginLine: 2, endLine: 4 },
  ];
  assert.deepEqual(validateProbeEvents(events, serial), { sent: 1, results: 1, outstanding: 0 });
  assert.throws(() => validateProbeEvents([
    events[0], { ...events[1], output: "forged" },
  ], serial), /reparse disagrees/iu);
  assert.throws(() => validateProbeEvents([events[1], events[0]], serial), /precedes/iu);
  const pending = { type: "probe-sent", token: "omarchy_test_2", command: "cat /proc/486/status", serialCharacterOffset: serial.length };
  assert.deepEqual(validateProbeEvents([...events, pending, { type: "diagnostic-stop-request" }], serial, { allowOutstanding: true }),
    { sent: 2, results: 1, outstanding: 1 });
  assert.throws(() => validateProbeEvents([...events, pending], serial, { allowOutstanding: true }), /diagnostic stop/iu);
});

test("T03f rejects a CoreDumping or generic Aquamarine observation as negative proof", () => {
  const pending = { negative: {
    kind: "same-pid-terminal-crash", pid: 486, environmentPid: 486, terminalPid: 486,
    pidDead: false, samePid: true, cause: "failed to mkdir crash report directory",
  } };
  assert.throws(() => validateOutcome(pending), /final PID death/iu);
  assert.throws(() => validateOutcome({ negative: {
    ...pending.negative, pidDead: true, cause: "aquamarine DRM renderer failed",
  } }), /generic renderer error/iu);
  assert.throws(() => validateOutcome({ negative: {
    ...pending.negative, pidDead: true, cause: "Hyprland aborted", environmentProbeToken: "env_probe",
    terminalProbeTokens: ["terminal_probe", "absence_probe"],
  }, }, [
    { type: "probe-sent", token: "env_probe", command: "cat /proc/486/environ" },
    { type: "probe-sent", token: "terminal_probe", command: "coredumpctl info 486" },
    { type: "probe-sent", token: "absence_probe", command: "test ! -d /proc/123" },
  ]), /not bound to PID 486/iu);
});

test("T03f does not accept self-asserted positive renderer/input evidence", () => {
  assert.throws(() => validateOutcome({ positive: {
    renderer: {
      expected: "softpipe", pid: 486,
      environment: { pid: 486, output: "GALLIUM_DRIVER=softpipe\n" },
      threads: { pid: 486, output: "Hyprland\nsoftpipe-0\n" },
      log: { pid: 486, output: "DEBUG ]: Renderer: softpipe (LLVM 18)\nDEBUG ]: Vendor: Mesa\n" },
    },
    input: { built: true, mode: "physical", deadlineMs: INPUT_DEADLINE_MS,
      outcome: "timeout", diagnosticOnly: true, screenshots: ["before", "after"] },
  } }), /separately bound physical-input report/iu);
});

const fixture = new URL("../../evidence/omarchy-profile/softpipe-r1/", import.meta.url);
const receipt = JSON.parse(fs.readFileSync(new URL("candidate-receipt.json", fixture), "utf8"));
const sealed = JSON.parse(fs.readFileSync(new URL("cold-wasm/manifest.json", fixture), "utf8"));
const recordedEvents = fs.readFileSync(new URL("cold-wasm/events.jsonl", fixture), "utf8").trim().split("\n").map(JSON.parse);

test("frozen receipt rejects duplicate files, moved ranges, and altered inode metadata", () => {
  assert.equal(validatePatchReceipt(receipt).changed, 8);
  for (const sabotage of [
    value => { value.patches[1].path = value.patches[0].path; },
    value => { value.patches[0].absoluteOffset += 1; },
    value => { value.metadata[0].source.uid = 1000; value.metadata[0].candidate.uid = 1000; },
  ]) {
    const changed = structuredClone(receipt); sabotage(changed);
    assert.throws(() => validatePatchReceipt(changed));
  }
});

test("actual negative needs unique environment, matching boot, successful probes, and terminal ordering", () => {
  const claim = sealed.claims;
  assert.deepEqual(validateOutcome(claim, recordedEvents), { kind: "same-pid-terminal-crash", pid: 486 });
  const envToken = claim.negative.environmentProbeToken;
  const coreToken = claim.negative.coredumpProbeToken;
  const absentToken = claim.negative.absenceProbeToken;
  for (const sabotage of [
    events => { events.find(e => e.type === "probe-result" && e.token === envToken).output += "\nGALLIUM_DRIVER=softpipe"; },
    events => { events.find(e => e.type === "probe-result" && e.token === coreToken).status = 1; },
    events => { const event = events.find(e => e.type === "probe-result" && e.token === coreToken); event.output = event.output.replace("670725d30d7b46958f53e2b2f6c2399c", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"); },
    events => { const index = events.findIndex(e => e.type === "probe-result" && e.token === absentToken); events.splice(index, 1); },
    events => { const index = events.findIndex(e => e.type === "diagnostic-stop-request"); events.unshift(events.splice(index, 1)[0]); },
  ]) {
    const changed = structuredClone(recordedEvents); sabotage(changed);
    assert.throws(() => validateOutcome(claim, changed));
  }
});

test("offline Make acceptance never reseals or records its evidence", () => {
  const makefile = fs.readFileSync(new URL("../../Makefile", import.meta.url), "utf8");
  const recipe = makefile.split("verify-E5.5-T03f:\n")[1].split(".PHONY:")[0];
  assert.match(recipe, /measurement\.mjs verify/u);
  assert.doesNotMatch(recipe, /measurement\.mjs (?:seal|record)/u);
});

test("observer-issued ABRT with valid serial framing cannot establish a spontaneous crash", () => {
  const events = structuredClone(recordedEvents);
  const original = fs.readFileSync(new URL("cold-wasm/serial.log", fixture), "utf8");
  const token = "critic_kill";
  const serial = `${original}\n${token}_begin\n\n${token}_end:0\n`;
  const result = parseProbe(serial.slice(original.length), token);
  assert.equal(result.status, 0, "sabotage is structurally a completed serial probe");
  const at = events.findIndex(event => event.type === "probe-sent" && event.token === sealed.claims.negative.coredumpProbeToken);
  events.splice(at, 0,
    { type: "probe-sent", token, command: "kill -ABRT 486", serialCharacterOffset: original.length },
    { type: "serial-input", text: probeCommand("kill -ABRT 486", token) },
    { type: "probe-result", token, ...result });
  assert.throws(() => validateProbeEvents(events, serial, { allowOutstanding: true }), /approved read-only/iu);
  assert.throws(() => validateOutcome(sealed.claims, events), /approved read-only/iu);
});

test("observer whitelist rejects alternate mutators, shell composition, and unframed input", () => {
  for (const command of ["/bin/kill -6 486", "pkill Hyprland", "systemctl --user stop wayland-wm@hyprland.desktop.service",
    "python3 -c 'import os; os.kill(486, 6)'", "id -u; kill -ABRT 486", "id -u $(kill -ABRT 486)",
    "id -u > /proc/486/mem", "journalctl --user --no-pager -n 99999 -o short-monotonic"]) {
    assert.throws(() => validateObserverCommand(command), /approved read-only/iu);
  }
  validateObserverTraffic(recordedEvents);
  assert.throws(() => validateObserverTraffic([{ type: "serial-input", text: "kill -6 486\r" }]), /unframed/iu);
  assert.throws(() => validateObserverTraffic([{ type: "terminal-input", bytes: [3] }]), /cursor-position/iu);
  assert.throws(() => validateObserverTraffic([{ type: "dom-key", code: "Escape" }]), /physical input/iu);
});
