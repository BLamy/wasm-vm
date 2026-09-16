// Offline synthetic false-success attack. Never evidence of a responsive guest.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { auditInputReport } from "../../../tools/verify/omarchy-input-audit.mjs";
import { PREPARED_DIRECT_COMMAND, PREPARED_DIRECT_IDENTITIES, assertPreparedDirectSource,
  auditPreparedDirect } from "../../../tools/verify/omarchy-prepared-direct-state.mjs";
import { R3_IDENTITIES, assertInputTrialSource } from "../../../tools/verify/omarchy-input-trial.mjs";
import { formatRpcCommand } from "../../../web/guest-rpc.js";

const dir = new URL("./", import.meta.url);
const head = "9cc377180921be98f904c3689a1d7c48b9df3947";
const wasm = "8230800b2ed4fe92ed0647d871d6c548fe824f3a550b09ca4a9b4941bc220ca4";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const baseBytes = await fs.readFile(new URL("../direct-opaque-r2/desktop/report.json", dir));
assert.equal(sha(baseBytes), "b7f4b5578d1beba34661417f5a535639b7644f7473694d8c36a30ade63f78ef7");
const base = JSON.parse(baseBytes);
const pins = {
  kernel: { size: 24208896, sha256: "af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce" },
  chunkManifest: { size: 1097812, sha256: "5f6a080986a423e5d77d2ec794eee3e42359ccc7d8a5fd23071a7420f4f23d44" },
  bootSnapshot: { size: 207172408, sha256: "989dff1cad261ab6e53e1dea8f57cb12866d2a236b5366f114102744553d4e75" },
  overlayDelta: { size: 1232847, sha256: "4fde816771e4fcfe085b492b6321302e945c58145c5c16f0c91e02ac94d10972" },
};
assert.deepEqual(PREPARED_DIRECT_IDENTITIES, pins);
const command = "XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 --batch 'getprop active opaque; getprop active force_rgbx; getprop active opacity; getprop active opacity_inactive; getprop active opacity_fullscreen; getprop active opacity_override; getprop active opacity_inactive_override; getprop active opacity_fullscreen_override; j/activewindow'";
assert.equal(PREPARED_DIRECT_COMMAND, command);
const foot = { address: "0x55555eb73630", pid: 503, class: "foot", mapped: true, hidden: false,
  visible: true, acceptsInput: true, at: [12, 38], size: [1256, 750] };
const raw = ["true", "true", "1", "1.000000", "1", "true", "true", "true", JSON.stringify(foot)].join("\n\n\n") + "\n";
const iso = ms => new Date(ms).toISOString();
const expected = { head, wasmSha256: wasm, arm: "candidate", preparedDirect: true, startupCommands: [command] };
function syntheticSuccess() {
  const report = structuredClone(base);
  report.syntheticVerifierFixture = true;
  report.trial.head = head;
  delete report.directOpaqueRequested;
  delete report.directOpaque;
  report.preparedDirectRequested = true;
  report.preparedDirectInputFence = report.directOpaqueInputFence;
  delete report.directOpaqueInputFence;
  report.identities.files["pkg/wasm_vm_wasm_bg.wasm"].sha256 = wasm;
  report.candidate.source = { ...structuredClone(pins), image: { imageLen: 4294967296, chunkSize: 262144, chunkCount: 16384 } };
  report.result = "input-trial-physical-nonce-and-fresh-presentation";
  delete report.trial.outcome;
  report.keyboard.verified = true;
  delete report.keyboard.failedAt;
  delete report.keyboard.error;
  const typed = Date.parse(report.keyboard.startedAt), entered = report.keyboard.enteredAtMs;
  report.keyboard.completedAt = iso(entered + 500);
  report.trial.presentationAfter = { ...report.trial.presentationBaseline,
    framesReceived: report.trial.presentationBaseline.framesReceived + 1,
    successfulPresents: report.trial.presentationBaseline.successfulPresents + 1 };
  report.preparedDirect = { command, requestCount: 1, startedAt: iso(typed - 1000),
    deadlineAtMs: Date.parse(report.startup.deadlineAt), respondedAt: iso(typed - 100),
    finishedAt: iso(typed - 100), status: "properties-confirmed", response: { exit: 0, stdout: raw }, foot: structuredClone(foot) };
  const read = `if [ -f '${report.keyboard.guestFile}' ]; then cat '${report.keyboard.guestFile}'; else (exit 75); fi`;
  const epoch = Date.parse(report.startup.startedAt);
  const frame = (rid, cmd, ms) => ({ type: "serial-input", sent: true, ms: ms - epoch,
    timestamp: iso(ms), bytes: [...Buffer.from(formatRpcCommand(cmd, rid))] });
  const output = (rid, text, ms) => ({ type: "serial-output", ms: ms - epoch,
    timestamp: iso(ms), text: `\n__WVBEGIN_${rid}\n${text}__WVEND_${rid}_0\n` });
  report.workerTraffic = report.workerTraffic.filter(row => !["serial-input", "serial-output"].includes(row.type));
  report.workerTraffic.push(frame("criticak1", command, typed - 900), output("criticak1", raw, typed - 200),
    frame("criticak2", read, entered + 100), output("criticak2", `${report.keyboard.nonce}\n`, entered + 500));
  report.workerTraffic.sort((a, b) => a.ms - b.ms);
  report.serialCommands = [{ command }, { command: read }];
  return report;
}
function audit(report, options = expected) {
  const input = auditInputReport(report, options);
  const configuration = auditPreparedDirect(report);
  return { machineAcceptance: input.machineAcceptance, visualInspectionRequired: input.visualInspectionRequired,
    nonceReplies: input.nonceReplies, configuration: configuration.configuration };
}
const cases = [];
function check(name, operation, mustReject) {
  const repeats = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    let result, error;
    try { result = operation(); } catch (caught) { error = String(caught); }
    assert.equal(Boolean(error), mustReject, `${name}: rejection mismatch`);
    repeats.push({ attempt, rejected: Boolean(error), error: error ?? null, result: result ?? null });
  }
  cases.push({ name, expectedRejection: mustReject, repeats });
}
check("complete synthetic machine-only control", () => audit(syntheticSuccess()), false);
check("old R3 pair relabelled as prepared", () => {
  const r = syntheticSuccess(); Object.assign(r.candidate.source, structuredClone(R3_IDENTITIES)); return audit(r);
}, true);
check("prepared snapshot mixed with old R3 delta", () => {
  const r = syntheticSuccess(); r.candidate.source.overlayDelta = structuredClone(R3_IDENTITIES.overlayDelta); return audit(r);
}, true);
check("prepared evidence without trusted caller opt-in", () => audit(syntheticSuccess(), { ...expected, preparedDirect: false }), true);
check("success flags and complete physical sequence but missing raw nonce", () => {
  const r = syntheticSuccess(); r.workerTraffic = r.workerTraffic.filter(row => !row.text?.includes("__WVEND_criticak2_")); return audit(r);
}, true);
check("nonce text on an unrelated RPC is not readback", () => {
  const r = syntheticSuccess(); const row = r.workerTraffic.find(row => row.text?.includes("__WVEND_criticak2_"));
  row.text = row.text.replaceAll("criticak2", "criticakother"); return audit(r);
}, true);
check("complete property receipt conceals missing final raw property", () => {
  const r = syntheticSuccess(); const row = r.workerTraffic.find(row => row.text?.includes("__WVEND_criticak1_"));
  const partial = ["true", "true", "1", "1.000000", "1", "true", "true", JSON.stringify(foot)].join("\n") + "\n";
  row.text = row.text.replace(raw, partial); return audit(r);
}, true);
check("good raw property reply past the original startup deadline", () => {
  const r = syntheticSuccess(); const late = Date.parse(r.startup.deadlineAt) + 1;
  const row = r.workerTraffic.find(row => row.text?.includes("__WVEND_criticak1_"));
  row.timestamp = iso(late); row.ms = late - Date.parse(r.startup.startedAt);
  r.preparedDirect.respondedAt = iso(late); return audit(r);
}, true);
check("original R3 guard remains exact", () => {
  const r = { ...structuredClone(R3_IDENTITIES), image: syntheticSuccess().candidate.source.image };
  assertInputTrialSource(r); assert.throws(() => assertPreparedDirectSource(r)); return { originalR3AcceptedOnlyByOriginalGuard: true };
}, false);
const hashes = {};
for (const name of ["tools/verify/omarchy-prepared-direct-state.mjs", "tools/verify/omarchy-input-audit.mjs",
  "tools/verify/omarchy-input-trial.mjs", "tools/verify/omarchy-latency-receipt.mjs", "web/guest-rpc.js"])
  hashes[name] = sha(await fs.readFile(new URL(`../../../${name}`, dir)));
const result = { head, productEvidence: false,
  fixtureBase: "evidence/omarchy-profile/direct-opaque-r2/desktop/report.json", fixtureBaseSha256: sha(baseBytes),
  transformation: "The complete physical sequence is inherited from the earlier negative run. Head, pair, property wire, nonce wire, and success counters are explicitly synthetic. Only auditor behavior is tested.",
  syntheticControlSha256: sha(JSON.stringify(syntheticSuccess())), sourceHashes: hashes, cases };
await fs.writeFile(new URL("attack.json", dir), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
