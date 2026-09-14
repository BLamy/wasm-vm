// T03m offline evidence audit. Diagnostic integrity is NOT desktop usability acceptance.
// No browser/guest is launched. PNGs are hash-bound, never OCR'd or treated as semantic proof.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertInputTrialSource, assertInputTrialRuntime } from "../../../tools/verify/omarchy-input-trial.mjs";
import { auditSerial, R3 } from "../../../tools/verify/omarchy-latency-receipt.mjs";
import { validatePhysicalKeyboardEvidence } from "../../../tools/verify/omarchy-thread-measurement.mjs";

const dir = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(dir, "../../..");
const head = "81cab94ea874e2f177d1005887e2adf2435e3777";
const wasmSha256 = "9405d6c38be9a170ef5a2e5e0bacdcbec6deace7de48c8e002bc3caea76dfb2b";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const at = value => { const n = Date.parse(value); assert.ok(Number.isFinite(n), `invalid time: ${value}`); return n; };
const relative = name => {
  assert.ok(typeof name === "string" && /^[a-zA-Z0-9_./-]+$/u.test(name)
    && !path.isAbsolute(name) && name.split("/").every(part => part && part !== "." && part !== ".."), "unsafe asset path");
  return name;
};
const bytes = name => {
  const filename = path.join(repo, relative(name));
  assert.ok(fs.lstatSync(filename).isFile(), `not a regular file: ${name}`);
  assert.equal(fs.realpathSync(filename), filename, `symlink in evidence/source path: ${name}`);
  return fs.readFileSync(filename);
};
const local = name => bytes(path.relative(repo, path.join(dir, name)));
const receipt = JSON.parse(local("run.json"));
// report.json is also written before browser close: require the parent's terminal receipt too.
assert.ok(receipt.finishedAt && receipt.exit, "recording not final; wait for parent completion");
const r = JSON.parse(local("desktop/report.json"));
assert.equal(receipt.head, head); assert.equal(r.trial.head, head);
assert.equal(receipt.wasmSha256, wasmSha256);
assert.equal(receipt.exit.closed, true); assert.equal(receipt.exit.watchdog, null);
assert.equal(receipt.exit.error ?? null, null); assert.equal(receipt.exit.signal ?? null, null);
assert.equal(r.mode, "input-trial"); assert.equal(r.trial.arm, "control");
assert.equal(r.trial.recycling, false); assert.equal(r.trial.scopedStatus, "");
assert.equal(r.cleanup.closed, true); assert.deepEqual(r.errors, []);
assert.equal(r.restored, true); assert.equal(r.candidate.localOnly, true);
assert.equal(r.trial.profilingRequested, false); assert.equal(r.trial.admissionProbeRequested, false);
for (const [name, value] of Object.entries({ startupMs: 300000, typingMs: 60000,
  readbackMs: 120000, captureMs: 20000, cleanupMs: 30000 })) assert.equal(r.trial[name], value);
assert.equal(at(r.startup.deadlineAt) - at(r.startup.startedAt), 300000);
assert.equal(r.cleanup.timeoutMs, 30000);
assert.ok(at(r.finishedAt) >= at(r.cleanup.startedAt));
assert.ok(at(r.finishedAt) - at(r.cleanup.startedAt) <= 30000, "owned cleanup exceeded fixed limit");
const claimedPositive = r.result === "input-trial-physical-nonce-and-fresh-presentation";
assert.ok(claimedPositive || r.result === "failed", "unknown recorded result");
assert.equal(receipt.exit.code, claimedPositive ? 0 : 1);
assertInputTrialSource(r.candidate.source);

// Bind all served local runtime resources, not just the seven preflight fetches.
const auditHelpers = ["tools/verify/omarchy-thread-measurement.mjs", "tools/verify/omarchy-latency-receipt.mjs",
  "tools/verify/omarchy-process-sample.mjs", "tools/verify/omarchy-input-trial.mjs",
  "web/guest-rpc.js", "web/src/input/keymap.js"];
const names = [...new Set([...Object.keys(r.trial.helpers), ...auditHelpers,
  ...r.resourceIdentities.filter(row => row.repoPath?.startsWith("web/dist/")).map(row => row.repoPath)])];
names.forEach(relative);
const batch = execFileSync("git", ["cat-file", "--batch"], { cwd: repo,
  input: names.map(name => `${head}:${name}\n`).join(""), maxBuffer: 64000000 });
const frozen = new Map(); let offset = 0;
for (const name of names) {
  const end = batch.indexOf(10, offset);
  const match = /^([0-9a-f]{40}) blob ([0-9]+)$/u.exec(batch.subarray(offset, end).toString());
  assert.ok(match, `missing frozen source ${name}`); offset = end + 1;
  const size = Number(match[2]); frozen.set(name, batch.subarray(offset, offset + size));
  offset += size; assert.equal(batch[offset++], 10);
}
assert.equal(offset, batch.length);
for (const name of auditHelpers) assert.equal(hash(bytes(name)), hash(frozen.get(name)), `audit dependency changed: ${name}`);
for (const [name, pin] of Object.entries(r.trial.helpers)) {
  assert.equal(hash(frozen.get(name)), pin.sha256); assert.equal(frozen.get(name).length, pin.size);
}
const artifacts = new Map();
for (const [role, pin] of Object.entries(R3)) {
  const data = bytes(pin.path); artifacts.set(pin.path, data);
  assert.equal(data.length, pin.size); assert.equal(hash(data), pin.sha256, role);
  assert.ok(r.candidate.source[role].filename.endsWith(`/${pin.path}`), `source path mismatch: ${role}`);
}
const chunkManifest = JSON.parse(artifacts.get(R3.chunkManifest.path));
const generated = { generated: "LOCAL-ONLY diagnostic candidate (not a release claim)",
  artifacts: Object.fromEntries([["kernel", "/candidate/kernel"], ["bootSnapshot", "/candidate/boot-snapshot"],
    ["overlayDelta", "/candidate/overlay-delta"]].map(([role, url]) => [role, { url, sha256: R3[role].sha256, size: R3[role].size }])),
  chunkedImage: { key: `chunked-omarchy/manifest-${R3.chunkManifest.sha256}.json`,
    sha256: R3.chunkManifest.sha256, size: R3.chunkManifest.size } };
assert.deepEqual(r.candidate.manifest, generated);
const url = new URL(r.url), origin = url.origin, paths = new Set();
assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.protocol, "http:");
assert.equal(url.pathname, "/app.html"); assert.equal(url.hash, "#ide");
assert.deepEqual([...url.searchParams.keys()].sort(), ["desktop", "guest", "jit", "jitColdCounterRecycling", "omarchyAssetBase", "omarchyDivider"]);
for (const [key, value] of Object.entries({ guest: "omarchy", desktop: "1", jit: "1",
  jitColdCounterRecycling: "0", omarchyDivider: "64", omarchyAssetBase: origin })) assert.equal(url.searchParams.get(key), value);
const routes = new Map(Object.entries(generated.artifacts).map(([role, asset]) => [asset.url, R3[role].path]));
const manifestRoute = `/${generated.chunkedImage.key}`;
for (const row of r.resourceIdentities) {
  assert.equal(row.method, "GET"); assert.equal(row.status, 200); at(row.timestamp);
  const chunk = /^\/chunked-omarchy\/chunks\/([a-f0-9]{64})\.bin$/u.exec(row.pathname);
  const filename = chunk ? `target/omarchy-profile-chunks-sdr-r3-256k/chunks/${chunk[1]}.bin`
    : routes.get(row.pathname) ?? `web/dist${row.pathname}`;
  let data;
  if (["/artifacts-omarchy.json", manifestRoute].includes(row.pathname)) {
    assert.equal(row.repoPath, null);
    data = row.pathname === manifestRoute ? artifacts.get(R3.chunkManifest.path) : Buffer.from(JSON.stringify(generated));
  } else {
    assert.equal(row.repoPath, filename, `served route/body mismatch: ${row.pathname}`);
    data = frozen.get(filename) ?? artifacts.get(filename) ?? bytes(filename);
    if (chunk) { assert.ok(chunkManifest.chunks.includes(chunk[1])); assert.equal(hash(data), chunk[1]); }
  }
  assert.equal(row.size, data.length); assert.equal(row.sha256, hash(data)); paths.add(row.pathname);
}
for (const row of r.browserRequests) {
  const request = new URL(row.url); assert.equal(request.origin, origin); assert.equal(row.method, "GET");
  assert.ok(paths.has(request.pathname) || request.pathname === "/favicon.ico", "request without served body");
}
for (const route of ["/app.html", "/main.js", "/ide.js", "/desktop-agent-session.js", "/loader.js",
  "/linux-worker.js", "/linux-worker-protocol.js", "/pkg/wasm_vm_wasm_bg.wasm", ...routes.keys(), manifestRoute]) {
  assert.ok(paths.has(route), `missing served resource: ${route}`);
}
assert.equal(hash(frozen.get("web/dist/pkg/wasm_vm_wasm_bg.wasm")), wasmSha256);
assert.equal(r.identities.files["pkg/wasm_vm_wasm_bg.wasm"].sha256, wasmSha256);

// One context/epoch/worker prevents serial parser or acknowledgement cross-binding.
assert.deepEqual([...new Set(r.workerTraffic.map(row => row.context))], ["primary"]);
assert.deepEqual([...new Set(r.workerTraffic.map(row => row.epoch))], ["final"]);
assert.equal(new Set(r.workerTraffic.map(row => row.worker)).size, 1);
const allowedMethods = new Set(["setDisplay", "keyboardLedState", "jitStats", "inputDeviceStats", "schedulerStats",
  "guestClockState", "sendKeyboardEvent", "syncKeyboard", "sendTabletEvent", "syncTablet", "sendMouseEvent", "syncMouse"]);
for (const row of r.workerTraffic) {
  assert.ok(["worker-boot", "worker-call", "input-result", "serial-input", "serial-output"].includes(row.type), "unknown/error wire event");
  if (row.type === "worker-call") { assert.ok(allowedMethods.has(row.method), `unapproved worker method ${row.method}`); assert.equal(row.sent, true); }
}
const keyboard = r.keyboard;
if (keyboard) {
  assert.match(keyboard.nonce, /^[a-f0-9]{16}$/u); assert.match(keyboard.guestFile, /^\/tmp\/desktop-keys-[a-f0-9]{16}$/u);
  assert.ok(!keyboard.guestFile.includes(keyboard.nonce), "filename reuses nonce");
  const serialBytes = Buffer.concat(r.workerTraffic.filter(row => row.type === "serial-input").map(row => Buffer.from(row.bytes)));
  assert.ok(!serialBytes.includes(Buffer.from(keyboard.nonce)), "nonce in serial input (including split messages)");
}
const readCommand = keyboard ? `if [ -f '${keyboard.guestFile}' ]; then cat '${keyboard.guestFile}'; else (exit 75); fi` : null;
for (const row of r.serialCommands) {
  assert.equal(row.command, readCommand, "recorder sent a pre-input diagnostic or mutation");
  assert.equal(row.stage, "physical keyboard:nonce-readback");
  assert.ok(at(row.timestamp) >= at(keyboard.typedAt));
  assert.ok(Number.isSafeInteger(row.timeoutMs) && row.timeoutMs > 0 && row.timeoutMs <= 120000);
  assert.ok(at(row.timestamp) < at(keyboard.deadlineAt), "readback issued after outer deadline");
}
const serial = auditSerial(r.workerTraffic, readCommand ? [readCommand] : []);
const layers = "XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j layers";
assert.ok(serial.some(row => row.command === layers && row.response?.exit === 0), "no successful real layers query");
assert.ok(serial.every(row => row.command === layers || row.command === readCommand), "hidden service or pre-input diagnostic");
const reads = serial.filter(row => row.command === readCommand);
assert.ok(reads.length <= r.serialCommands.length);
for (let i = 0; i < reads.length; i++) assert.ok(at(reads[i].sentAt) >= at(r.serialCommands[i].timestamp));

const runtimeRows = r.observations.filter(row => row.runtime).map(row => row.runtime);
assert.ok(runtimeRows.length);
for (const state of runtimeRows) {
  assertInputTrialRuntime(state, { recycling: false });
  assert.equal(state.guestSession?.key, "omarchy");
  assert.ok(Number.isSafeInteger(state.guestSession.generation) && state.guestSession.generation > 0);
  assert.deepEqual(state.presentation.errors, []);
}
assert.equal(new Set(runtimeRows.map(row => row.guestSession.generation)).size, 1);
const ready = r.events.find(row => row.type === "wvm:desktop-ready"); assert.ok(Number.isFinite(ready?.ms));
let delivery = { attempted: Boolean(keyboard), chainValidated: false, domEvents: r.inputEvents.length,
  acknowledgementMeaning: "RPC returned true without throwing; inject_event acceptance and guest consumption are NOT proven" };
if (keyboard?.typedAt) {
  assert.ok(at(keyboard.startedAt) <= at(r.startup.deadlineAt), "input began after 300s");
  assert.ok(at(keyboard.typedAt) - at(keyboard.startedAt) <= 60000, "typing exceeded 60s");
  assert.equal(keyboard.enteredAtMs, at(keyboard.typedAt));
  assert.equal(keyboard.readbackTimeoutMs, 120000); assert.equal(keyboard.deadlineMs, 120000);
  assert.equal(at(keyboard.readbackStartedAt), keyboard.enteredAtMs);
  assert.equal(at(keyboard.deadlineAt), keyboard.enteredAtMs + 120000);
  try {
    validatePhysicalKeyboardEvidence(r, keyboard, at(keyboard.readbackStartedAt));
    const first = r.inputEvents.find(row => row.type === "keydown");
    assert.ok(first.ms >= ready.ms, "key predates real desktop-ready");
    assert.equal(keyboard.readyToFirstPhysicalKeydownMs, first.ms - ready.ms);
    delivery = { ...delivery, chainValidated: true, firstKeyPageMs: first.ms,
      readyToFirstKeyMs: first.ms - ready.ms,
      calls: r.workerTraffic.filter(row => row.type === "worker-call" && ["sendKeyboardEvent", "syncKeyboard"].includes(row.method)
        && at(row.timestamp) >= at(keyboard.startedAt)).length };
  } catch (error) { delivery.error = String(error); }
}
const deadline = keyboard?.deadlineAt ? at(keyboard.deadlineAt) : null;
const readback = { attempted: reads.length > 0, declared: r.serialCommands.length, sent: reads.length,
  // remaining is sampled before exec records its timestamp. Preserve the actual
  // difference rather than equating the per-RPC timeout with the frozen outer race.
  requests: r.serialCommands.map(row => ({ timestamp: row.timestamp, timeoutMs: row.timeoutMs,
    remainingAtRecordedTimestampMs: deadline - at(row.timestamp),
    nominalRpcEndPastOuterDeadlineMs: Math.max(0, at(row.timestamp) + row.timeoutMs - deadline) })),
  responses: reads.map(row => ({ rid: row.rid, sentAt: row.sentAt, completedAt: row.completedAt, response: row.response })),
  nonceConfirmedByDeadline: reads.some(row => row.response?.exit === 0 && row.response.stdout.trim() === keyboard.nonce
    && at(row.completedAt) <= deadline),
  completedLate: reads.some(row => row.completedAt && at(row.completedAt) > deadline),
  full120sElapsed: Boolean(keyboard?.failedAt && deadline && at(keyboard.failedAt) >= deadline),
  observedElapsedMs: keyboard?.failedAt ? at(keyboard.failedAt) - at(keyboard.readbackStartedAt) : null,
  reportedStage: keyboard?.stage ?? null, reportedError: keyboard?.error ?? null };
if (keyboard?.verified) {
  assert.equal(readback.nonceConfirmedByDeadline, true, "claimed nonce proof lacks timely wire response");
  assert.ok(at(keyboard.completedAt) <= deadline);
}
const queueCounters = runtimeRows.map(row => ({ label: row.label, timestamp: row.timestamp, inputDevice: row.inputDevice }));
for (const row of queueCounters) for (const key of ["pendingEvents", "pendingFrames", "droppedFrames", "droppedEvents", "rejectedEvents"]) {
  assert.ok(Number.isSafeInteger(row.inputDevice?.[key]) && row.inputDevice[key] >= 0, `missing input counter ${key}`);
}
const frames = runtimeRows.map(row => ({ label: row.label, timestamp: row.timestamp,
  framesReceived: row.presentation.framesReceived, successfulPresents: row.presentation.successfulPresents,
  pending: row.presentation.scheduler?.pending, retiredInstructions: row.scheduler.retiredInstructions }));
const queueDeltas = queueCounters.length < 2 ? null : Object.fromEntries(
  ["droppedFrames", "droppedEvents", "rejectedEvents"].map(key => [key,
    queueCounters.at(-1).inputDevice[key] - queueCounters[0].inputDevice[key]]));
const frameDeltas = frames.length < 2 ? null : Object.fromEntries(
  ["framesReceived", "successfulPresents", "retiredInstructions"].map(key => [key, frames.at(-1)[key] - frames[0][key]]));
const before = r.trial.presentationBaseline, after = r.trial.presentationAfter;
const freshPresentation = Boolean(before && after && after.framesReceived > before.framesReceived
  && after.successfulPresents > before.successfulPresents);
const screenshots = {};
const lastScreenshots = new Map(r.observations.filter(row => row.screenshot).map(row => [path.basename(row.screenshot), row]));
for (const [name, row] of lastScreenshots) {
  assert.match(name, /^[a-zA-Z0-9_-]+\.png$/u);
  const png = local(`desktop/${name}`); assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  screenshots[name] = { size: png.length, sha256: hash(png), timestamp: row.timestamp };
  assert.equal(screenshots[name].sha256, row.sha256);
}
assert.ok(screenshots["desktop.png"], "missing pre-input desktop PNG");
if (claimedPositive) {
  assert.equal(delivery.chainValidated, true, delivery.error);
  assert.equal(readback.nonceConfirmedByDeadline, true);
  assert.equal(freshPresentation, true);
  assert.ok(screenshots["desktop-keyboard.png"]);
  assert.ok(at(screenshots["desktop-keyboard.png"].timestamp) - at(keyboard.completedAt) <= 20000);
} else assert.ok(r.error, "failure must retain its error");
const audit = { head, wasmSha256, reportSha256: hash(local("desktop/report.json")), receiptSha256: hash(local("run.json")),
  evidenceIntegrityVerified: true, recordedResult: r.result, recordedOutcome: r.trial.outcome ?? null,
  serviceIsolation: true, delivery, queueCounters, queueDeltas, readback, frames, frameDeltas, freshPresentation, screenshots,
  limitsMs: { startup: 300000, typing: 60000, readback: 120000, capture: 20000, cleanup: 30000 },
  servedResponses: r.resourceIdentities.length, browserRequests: r.browserRequests.length,
  desktopAcceptance: false, independentVisualReviewRequired: true,
  limitations: ["Trusted DOM/evdev/true RPC acknowledgements establish the host RPC chain, not inject_event acceptance or guest/compositor consumption.",
    "Queue counters are observations, not proof that Linux/Foot consumed the command.",
    "Fresh frame counts and PNG hashes do not prove a visible application response; main/Blue must inspect PNGs.",
    "This post-run integrity audit does not change the recorded result, establish a cause, or promote usability."] };
fs.writeFileSync(path.join(dir, "audit.json"), JSON.stringify(audit, null, 2) + "\n");
console.log(JSON.stringify(audit, null, 2));
