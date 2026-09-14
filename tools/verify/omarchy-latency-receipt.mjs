#!/usr/bin/env node
// Read-only T03h receipt audit. This is a diagnostic gate, NOT desktop acceptance.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { processSamplePlan, parseProcessSample, processSampleDeltas } from "./omarchy-process-sample.mjs";
import { createFencedRpc, formatRpcCommand } from "../../web/guest-rpc.js";
import { evdevForCode } from "../../web/src/input/keymap.js";

export const FROZEN_HEAD = "ea77bfa1c3d50b9b08ecd381025bbfc393741b52";
const CORE_SHA = "c48e9c2d9ec550c7daf4875716fef1dc729072fdfc91b805394d379bee4b9305";
export const HARNESS = ["tools/verify/omarchy-input-diagnostic.mjs", "tools/verify/omarchy-process-sample.mjs",
  "tools/verify/omarchy-live-recording.mjs", "tools/verify/omarchy-browser-session.mjs"];
export const R3 = {
  kernel: { path: "releases/kernel/6.6.63/Image", size: 24208896, sha256: "af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce" },
  bootSnapshot: { path: "target/omarchy-sdr-r3-snapshot/omarchy-ready.snap.gz", size: 205050833, sha256: "2231a21eb8ebc8d3965d1352a3523501faebc87bda31e2c8dc184320219235f5" },
  overlayDelta: { path: "target/omarchy-sdr-r3-snapshot/omarchy-overlay-delta.bin.gz", size: 1209196, sha256: "1f56d0bd44c945fab3ec1c201d04f39dd3f590320f54c8d2224446ebffb7e7da" },
  chunkManifest: { path: "target/omarchy-profile-chunks-sdr-r3-256k/manifest.json", size: 1097812, sha256: "5f6a080986a423e5d77d2ec794eee3e42359ccc7d8a5fd23071a7420f4f23d44" },
};
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const identity = bytes => ({ size: bytes.length, sha256: hash(bytes) });
const at = value => { const n = Date.parse(value); assert.ok(Number.isFinite(n), "missing/invalid timestamp"); return n; };
const nonnegative = n => Number.isSafeInteger(n) && n >= 0;
const sameIdentity = (actual, expected, label) => {
  assert.equal(actual?.size, expected.size, `${label}: size mismatch`);
  assert.equal(actual?.sha256, expected.sha256, `${label}: SHA mismatch`);
};
const relative = p => {
  assert.ok(typeof p === "string" && p.length && !p.includes("\\") && !path.posix.isAbsolute(p)
    && p.split("/").every(part => part && part !== "." && part !== ".."), "unsafe relative path");
  return p;
};
const sourceRoot = source => {
  assert.ok(path.isAbsolute(source.kernel.filename) && source.kernel.filename.endsWith(`/${R3.kernel.path}`), "kernel source path mismatch");
  const root = source.kernel.filename.slice(0, -R3.kernel.path.length);
  for (const [name, pin] of Object.entries(R3)) {
    sameIdentity(source[name], pin, name);
    assert.equal(source[name].filename, root + pin.path, `${name}: source path mismatch`);
  }
  return root;
};

export function candidateManifest() {
  return { generated: "LOCAL-ONLY diagnostic candidate (explicit real input pair; not a release claim)",
    artifacts: Object.fromEntries([["kernel", "/candidate/kernel"], ["bootSnapshot", "/candidate/boot-snapshot"],
      ["overlayDelta", "/candidate/overlay-delta"]].map(([name, url]) => [name, { url, sha256: R3[name].sha256, size: R3[name].size }])),
    chunkedImage: { key: `chunked-omarchy/manifest-${R3.chunkManifest.sha256}.json`,
      sha256: R3.chunkManifest.sha256, size: R3.chunkManifest.size } };
}

// identityForPath compares disk AND git for web/dist/harness paths in the CLI.
// Injection here permits tiny synthetic fixtures, never alternate production pins.
export async function validateResources(identities, source, manifest, identityForPath) {
  sourceRoot(source);
  assert.equal(identities.head, FROZEN_HEAD, "wrong frozen harness head");
  assert.equal(identities.scopedStatus, "", "executed harness was dirty");
  assert.deepEqual(identities.harness.map(row => row.path).sort(), [...HARNESS].sort(), "incomplete harness closure");
  for (const row of identities.harness) sameIdentity(row, await identityForPath(row.path), row.path);
  for (const pin of Object.values(R3)) sameIdentity(await identityForPath(pin.path), pin, pin.path);
  assert.equal(manifest.version, 1); assert.equal(manifest.image_len, 4294967296);
  assert.equal(manifest.chunk_size, 262144); assert.equal(manifest.layout, "split");
  assert.equal(manifest.chunks?.length, 16384);
  assert.ok(manifest.chunks.every(s => /^[a-f0-9]{64}$/u.test(s)), "invalid chunk names");
  const members = new Set(manifest.chunks), generated = candidateManifest();
  const routes = new Map(Object.entries(generated.artifacts).map(([name, item]) => [item.url, R3[name].path]));
  routes.set(`/${generated.chunkedImage.key}`, R3.chunkManifest.path);
  const seen = new Set();
  assert.ok(identities.resourceIdentities?.length, "no served resources");
  for (const row of identities.resourceIdentities) {
    assert.equal(row.method, "GET"); assert.equal(row.status, 200); at(row.timestamp);
    let expected;
    if (row.pathname === "/artifacts-omarchy.json") {
      assert.equal(row.repoPath, null); expected = identity(Buffer.from(JSON.stringify(generated)));
    } else {
      const chunk = /^\/chunked-omarchy\/chunks\/([a-f0-9]{64})\.bin$/u.exec(row.pathname);
      const expectedPath = chunk ? `target/omarchy-profile-chunks-sdr-r3-256k/chunks/${chunk[1]}.bin`
        : routes.get(row.pathname) ?? `web/dist${row.pathname}`;
      assert.equal(row.repoPath, expectedPath, "served path does not match its route");
      relative(expectedPath);
      expected = await identityForPath(expectedPath);
      if (chunk) {
        assert.ok(members.has(chunk[1]), "served chunk absent from manifest");
        assert.equal(expected.sha256, chunk[1]); assert.equal(expected.size, 262144);
      }
      if (row.pathname === "/pkg/wasm_vm_wasm_bg.wasm") assert.equal(expected.sha256, CORE_SHA);
    }
    sameIdentity(row, expected, row.pathname); seen.add(row.pathname);
  }
  for (const required of ["/app.html", "/main.js", "/loader.js", "/linux-worker.js", "/linux-worker-protocol.js",
    "/pkg/wasm_vm_wasm_bg.wasm", "/artifacts-omarchy.json", ...routes.keys()]) assert.ok(seen.has(required), `missing served ${required}`);
  const origin = new URL(identities.ready.pageUrl).origin;
  assert.ok(identities.browserRequests?.length, "missing browser requests");
  for (const request of identities.browserRequests) {
    const url = new URL(request.url); at(request.timestamp);
    assert.equal(url.origin, origin, "cross-origin request not bound");
    assert.equal(request.method, "GET");
    assert.ok(seen.has(url.pathname) || url.pathname === "/favicon.ico", `unbound requested resource ${url.pathname}`);
  }
  return { servedRows: identities.resourceIdentities.length, uniquePaths: seen.size };
}

function checkClockAndJit(stats) {
  assert.equal(stats?.clock?.mode, "icount"); assert.equal(stats.clock.clockDiv, 64);
  assert.equal(stats.clock.timebaseHz, 10000000); assert.match(stats.clock.mtime, /^\d+$/u);
  assert.equal(stats.jit?.hasExecutor, true, "JIT executor not observed");
  assert.equal(stats.jit.decodedCacheEntries, 4096); assert.equal(stats.jit.jitResidencyPolicy, "repack-off");
  assert.equal(stats.jit.jitResidencyCap, 24);
}
function checkStats(stats) {
  checkClockAndJit(stats);
  for (const key of ["pendingEventBudget", "pendingEvents", "pendingFrames", "droppedFrames", "droppedEvents", "statusEventsServed", "rejectedEvents"]) {
    assert.ok(nonnegative(stats.inputDevice?.[key]), `missing input counter ${key}`);
  }
  for (const key of ["framesReceived", "successfulPresents"]) assert.ok(nonnegative(stats.display?.[key]), `missing display ${key}`);
  assert.deepEqual(stats.display.errors, [], "presentation errors");
  assert.ok(nonnegative(stats.scheduler?.retiredInstructions), "missing guest instruction counter");
}

export function auditSerial(traffic, commands) {
  const allowed = new Set(["ls -la '/root'", "XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j layers", ...commands]);
  const inputs = traffic.filter(row => row.type === "serial-input");
  let input = ""; const spans = [];
  for (const row of inputs) {
    assert.equal(row.sent, true);
    assert.ok(Array.isArray(row.bytes) && row.bytes.every(b => Number.isInteger(b) && b >= 0 && b < 128), "non-ASCII serial input");
    spans.push({ start: input.length, end: input.length + row.bytes.length, row });
    input += Buffer.from(row.bytes).toString("ascii");
  }
  let offset = 0; const records = [], ids = new Set();
  while (offset < input.length) {
    const rest = input.slice(offset), control = /^(?:\r|\x1b\[\d+;\d+R)/u.exec(rest);
    if (control) { offset += control[0].length; continue; }
    const prefix = /^printf '\\n__WVBEGIN_([a-z0-9]+)\\n'; /u.exec(rest);
    assert.ok(prefix, "unframed/unapproved serial input");
    const rid = prefix[1], end = rest.indexOf("\r");
    assert.ok(end >= 0 && !ids.has(rid), "incomplete/duplicate RPC"); ids.add(rid);
    const frame = rest.slice(0, end + 1);
    const command = [...allowed].find(cmd => formatRpcCommand(cmd, rid) === frame);
    assert.ok(command, "unapproved serial command");
    const first = spans.find(s => s.start <= offset && s.end > offset).row;
    const last = spans.find(s => s.start <= offset + end && s.end > offset + end).row;
    const parser = createFencedRpc(rid); let response = null, completedAt = null;
    for (const row of traffic) {
      if (row.type !== "serial-output" || row.ms < last.ms) continue;
      response = parser.feed(row.text);
      if (response) { completedAt = row.timestamp; break; }
    }
    records.push({ rid, command, sentAt: first.timestamp, completedAt, response }); offset += frame.length;
  }
  return records;
}

export function validateObservations({ identities, wire, diagnostic }) {
  assert.deepEqual(identities.errors, [], "observer errors");
  assert.ok(Array.isArray(diagnostic) && diagnostic.length, "missing diagnostic history");
  const readyRows = diagnostic.filter(r => r.event === "ready"); assert.equal(readyRows.length, 1);
  const ready = readyRows[0], url = new URL(ready.pageUrl), root = sourceRoot(ready.sourceReceipt);
  assert.equal(identities.head, FROZEN_HEAD); assert.equal(identities.headed, true); assert.equal(ready.headed, true);
  assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.protocol, "http:"); assert.equal(url.pathname, "/app.html");
  assert.deepEqual([...url.searchParams], [["guest", "omarchy"], ["desktop", "1"], ["omarchyDivider", "64"],
    ["jit", "1"], ["omarchyAssetBase", url.origin]], "changed diagnostic configuration");
  assert.equal(wire.pageUrl, ready.pageUrl); assert.equal(identities.ready.pageUrl, ready.pageUrl);
  assert.equal(identities.ready.restoredFromBootSnapshot, true, "shipped snapshot did not restore");
  assert.deepEqual(identities.ready.storedSnapshotRestoreEvidence, { attempted: false, decision: null, overlayGeneration: null });
  checkClockAndJit(identities.ready);
  let last = -Infinity;
  for (const row of diagnostic) {
    assert.ok(at(row.time) >= last, "diagnostic order changed"); last = at(row.time);
    assert.ok(!row.error, "diagnostic operation failed");
    if (row.event === "process-sample-rpc-before-submit") continue;
    assert.equal(row.pageUrl, ready.pageUrl); assert.deepEqual(row.sourceReceipt, ready.sourceReceipt);
    assert.equal(row.headed, true); assert.equal(row.jitResidency, null); assert.equal(row.decodedCacheEntries, null);
    assert.equal(row.jitThreshold, null); assert.equal(row.profileRequested, false);
    assert.ok(row === ready || ["stats", "screenshot", "type", "process-sample"].includes(row.request?.op), "unexpected diagnostic operation");
    if (row.request?.op === "stats") checkStats(row.result);
  }
  assert.ok(at(identities.collectedAt) >= last && at(wire.collectedAt) >= last - 1000, "stale sidecar snapshot");
  const typed = diagnostic.filter(r => r.request?.op === "type"); assert.equal(typed.length, 1);
  assert.equal(typed[0].request.text, "x"); assert.ok(!typed[0].request.enter); assert.equal(typed[0].result, "sent");
  assert.equal(wire.inputEvents?.length, 2, "exactly one physical KeyX down/up required");
  const [down, up] = wire.inputEvents;
  for (const [i, event] of wire.inputEvents.entries()) {
    assert.equal(event.type, i ? "keyup" : "keydown"); assert.equal(event.code, "KeyX"); assert.equal(event.key, "x");
    assert.equal(event.trusted, true); assert.equal(event.repeat, false);
    assert.equal(event.target, "ide-display-canvas"); assert.equal(event.activeElement, "ide-display-canvas");
  }
  assert.ok(up.ms > down.ms && at(typed[0].time) >= at(up.timestamp));
  const stats = diagnostic.filter(r => r.request?.op === "stats");
  const before = stats.filter(r => at(r.time) < at(down.timestamp)).at(-1);
  const immediate = stats.find(r => at(r.time) >= at(up.timestamp));
  const end = stats.find(r => at(r.time) - at(up.timestamp) >= 120000);
  assert.ok(before && at(down.timestamp) - at(before.time) <= 5000, "missing immediate baseline stats");
  assert.ok(immediate && at(immediate.time) - at(up.timestamp) <= 5000, "missing immediate post-key stats (5s cap)");
  assert.ok(end && at(end.time) - at(up.timestamp) <= 180000, "manual observation must span 120..180s");
  const traffic = wire.workerTraffic; assert.ok(Array.isArray(traffic)); last = -Infinity;
  const calls = new Map(), keys = [], acknowledgements = [], startupAgent = [];
  const readers = new Set(["keyboardLedState", "jitStats", "storedSnapshotRestoreEvidence", "guestClockState", "inputDeviceStats", "schedulerStats"]);
  for (const row of [...wire.inputEvents, ...traffic]) {
    assert.ok(Number.isFinite(row.ms) && Math.abs(wire.timeOrigin + row.ms - at(row.timestamp)) < 5, "wire clocks disagree");
  }
  for (const row of traffic) {
    assert.equal(row.worker, 1, "multiple/restarted workers"); assert.ok(row.ms >= last, "wire order changed"); last = row.ms;
    assert.ok(!row.error && !["fatal", "error"].includes(row.type), "worker error");
    assert.ok(["worker-boot", "worker-call", "input-result", "serial-input", "serial-output"].includes(row.type), "unknown traffic");
    if (row.type === "worker-call") {
      assert.equal(row.sent, true); assert.ok(Number.isSafeInteger(row.id) && !calls.has(row.id), "reused worker call id"); calls.set(row.id, row);
      if (["sendKeyboardEvent", "syncKeyboard"].includes(row.method)) keys.push(row);
      else if (readers.has(row.method)) assert.deepEqual(row.args, []);
      else if (row.method === "setDisplay") {
        assert.deepEqual(row.args, [1280, 800]); assert.ok(at(row.timestamp) < at(ready.time), "display changed during observation");
      } else if (row.method === "sendAgentInput") {
        // The frozen bridge retries its handshake while Omarchy has no agent.
        // Payloads are length-only, including after restore; retain this gap.
        assert.deepEqual(row.args, [{ binaryBytes: 18 }]); startupAgent.push(row);
      } else assert.fail(`unexpected/mutating worker method ${row.method}`);
    } else if (row.type === "input-result") acknowledgements.push(row);
  }
  assert.equal(traffic.filter(r => r.type === "worker-boot" && r.sent).length, 1);
  assert.equal(keys.length, 4, "incomplete/extra keyboard calls"); assert.equal(acknowledgements.length, 4);
  for (const [index, call] of keys.entries()) {
    const event = index < 2 ? down : up, sync = index % 2;
    assert.equal(call.method, sync ? "syncKeyboard" : "sendKeyboardEvent");
    assert.deepEqual(call.args, sync ? [] : [1, evdevForCode("KeyX"), index < 2 ? 1 : 0], "wrong evdev args");
    assert.ok(call.ms >= event.ms && at(call.timestamp) <= at(immediate.time));
    const matches = acknowledgements.filter(r => r.id === call.id && r.method === call.method);
    assert.equal(matches.length, 1, "missing/duplicate keyboard acknowledgement");
    assert.equal(matches[0].result, true); assert.ok(matches[0].ms >= call.ms && at(matches[0].timestamp) <= at(immediate.time));
  }
  for (const row of [before, immediate, end]) {
    const prevTime = at(diagnostic[diagnostic.indexOf(row) - 1].time);
    for (const method of ["inputDeviceStats", "guestClockState", "schedulerStats", "jitStats"]) {
      assert.ok([...calls.values()].some(c => c.method === method && at(c.timestamp) >= prevTime && at(c.timestamp) <= at(row.time)), `stats not bound to worker request ${method}`);
    }
  }
  const declarations = diagnostic.filter(r => r.event === "process-sample-rpc-before-submit");
  const samples = diagnostic.filter(r => r.request?.op === "process-sample" && !r.event);
  assert.ok(declarations.length <= 2 && samples.length <= 2, "unbounded process sampling");
  for (const row of declarations) {
    assert.equal(row.command, processSamplePlan(row.request).command);
    assert.ok(at(row.time) > at(end.time), "sampler contaminated timed input window");
  }
  const serial = auditSerial(traffic, declarations.map(r => r.command));
  let previous = null; const process = [];
  for (const [index, row] of samples.entries()) {
    const result = row.result, plan = processSamplePlan(row.request), declaration = declarations[index];
    assert.ok(declaration, "sample lacks pre-send record"); assert.deepEqual(declaration.request, row.request);
    assert.equal(row.actualCommand, plan.command); assert.equal(result.command, plan.command); assert.deepEqual(result.targets, plan.targets);
    assert.equal(result.timeoutMs, plan.timeoutMs); assert.equal(result.startedMs, at(result.startedAt));
    assert.equal(result.finishedMs, at(result.finishedAt)); assert.equal(result.elapsedMs, result.finishedMs - result.startedMs);
    assert.ok(result.startedMs > at(end.time) && result.finishedMs <= at(row.time) && result.elapsedMs >= 0);
    assert.ok(["sampled", "timeout", "unavailable"].includes(result.status));
    const record = serial.find(r => !r.used && r.command === plan.command && at(r.sentAt) >= at(declaration.time));
    if (record) record.used = true;
    if (result.rpc?.raw) {
      assert.ok(record?.response, "raw process result lacks completed wire fence");
      assert.deepEqual(result.rpc.raw, record.response, "process raw result differs from wire");
      assert.ok(at(record.completedAt) <= at(result.rpc.completedAt));
    }
    if (result.status === "sampled") {
      assert.ok(result.elapsedMs <= plan.timeoutMs, "process sample completed after outer deadline");
      assert.ok(at(result.before.completedAt) <= at(result.rpc.submittedAt) && at(result.rpc.completedAt) <= at(result.after.startedAt));
      assert.deepEqual(result.process, parseProcessSample(plan, result.rpc.raw), "parsed process identity mismatch");
      checkStats(result.before.values); checkStats(result.after.values);
    } else {
      assert.ok(result.error && result.failedPhase, "missing explicit failed-sample reason");
      assert.equal(result.process, undefined, "failed probe claims process proof");
      assert.equal(index, samples.length - 1, "retry after missing process observation");
    }
    const deltas = processSampleDeltas(previous, result);
    assert.deepEqual(result.deltas, deltas, "process deltas differ from raw identity-bound samples");
    process.push({ status: result.status, startedAt: result.startedAt, finishedAt: result.finishedAt,
      ...(result.error ? { error: result.error } : {}), process: result.process ?? null, deltas }); previous = result;
  }
  for (const record of serial.filter(r => declarations.some(d => d.command === r.command))) {
    assert.ok(record.used || !record.response, "unaccounted completed process RPC");
    assert.ok(at(record.sentAt) > at(end.time), "process wire command inside input window");
  }
  const screenshots = diagnostic.filter(r => r.request?.op === "screenshot");
  assert.ok(screenshots.some(r => at(r.time) < at(down.timestamp)), "missing before screenshot");
  assert.ok(screenshots.some(r => at(r.time) >= at(end.time)), "missing window-end screenshot");
  const names = new Set();
  for (const row of screenshots) {
    assert.match(row.request.name, /^[a-z0-9-]+\.png$/u); assert.ok(!names.has(row.request.name), "overwritten screenshot name"); names.add(row.request.name);
    assert.ok(row.result.startsWith(root + "evidence/") && path.basename(row.result) === row.request.name, "screenshot identity mismatch");
  }
  const observation = row => ({ at: row.time, inputDevice: row.result.inputDevice,
    retiredInstructions: row.result.scheduler.retiredInstructions, mtime: row.result.clock.mtime,
    framesReceived: row.result.display.framesReceived, successfulPresents: row.result.display.successfulPresents });
  return { kind: "diagnostic-only", desktopAcceptance: false, guestConsumptionProven: false,
    input: { code: "KeyX", downAt: down.timestamp, upAt: up.timestamp, trueAcknowledgements: 4,
      observationMs: at(end.time) - at(up.timestamp) }, before: observation(before), immediate: observation(immediate), end: observation(end),
    opaqueAgentMessages: startupAgent.length,
    process, processEvidence: samples.length ? "see explicit per-sample availability" : "UNPROVEN: no completed process sample",
    screenshots: screenshots.map(r => ({ name: r.request.name, filename: r.result, timestamp: r.time })),
    limitations: ["Queue counters are observations, not proof of Linux/compositor input consumption.",
      "Sequential proc reads do not identify the currently scheduled PID/PC; missing schedstat is not zero wait.",
      "Repeated agent traffic is length-only in the frozen observer; no byte-level agent-payload claim or sampler-free guest claim.",
      "Screenshot hashes bind files at audit time; the recorder did not hash at capture. Visual review is separate."] };
}

async function safeFile(root, rel) {
  relative(rel); const filename = path.join(root, rel);
  assert.ok((await fs.lstat(filename)).isFile(), `not a regular file: ${rel}`);
  assert.equal(await fs.realpath(filename), filename, `symlink/aliased path: ${rel}`); return filename;
}
async function fileIdentity(filename) {
  const digest = createHash("sha256"); let size = 0;
  for await (const bytes of createReadStream(filename)) { size += bytes.length; digest.update(bytes); }
  return { size, sha256: digest.digest("hex") };
}
export async function verifyReceipt(folder, repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")) {
  repo = await fs.realpath(repo); folder = path.resolve(folder);
  assert.equal(await fs.realpath(folder), folder, "aliased receipt directory");
  const raw = {}, digests = {};
  for (const name of ["identities.json", "wire.json", "diagnostic.json"]) {
    const filename = await safeFile(folder, name); assert.ok((await fs.stat(filename)).size <= 64 * 1024 * 1024, "oversized JSON receipt");
    const bytes = await fs.readFile(filename); raw[name] = JSON.parse(bytes); digests[name] = identity(bytes);
  }
  const identities = raw["identities.json"], wire = raw["wire.json"], diagnostic = raw["diagnostic.json"];
  const summary = validateObservations({ identities, wire, diagnostic });
  const cache = new Map();
  const readIdentity = async rel => {
    if (!cache.has(rel)) {
      const current = await fileIdentity(await safeFile(repo, rel));
      if (rel.startsWith("web/dist/") || HARNESS.includes(rel)) {
        const frozen = execFileSync("git", ["show", `${FROZEN_HEAD}:${relative(rel)}`], { cwd: repo, maxBuffer: 16 * 1024 * 1024 });
        sameIdentity(current, identity(frozen), `${rel}: disk versus frozen git blob`);
      }
      cache.set(rel, current);
    }
    return cache.get(rel);
  };
  // Bind pure parsers used by this audit to the same frozen versions as the run.
  for (const rel of ["tools/verify/omarchy-process-sample.mjs", "web/guest-rpc.js", "web/src/input/keymap.js"]) {
    const frozen = execFileSync("git", ["show", `${FROZEN_HEAD}:${rel}`], { cwd: repo, maxBuffer: 1024 * 1024 });
    sameIdentity(await fileIdentity(await safeFile(repo, rel)), identity(frozen), `audit dependency ${rel}`);
  }
  const manifest = JSON.parse(await fs.readFile(await safeFile(repo, R3.chunkManifest.path), "utf8"));
  const resources = await validateResources(identities, diagnostic.find(r => r.event === "ready").sourceReceipt, manifest, readIdentity);
  const evidenceRelative = relative(path.relative(repo, folder).split(path.sep).join("/"));
  const originalRoot = sourceRoot(diagnostic.find(r => r.event === "ready").sourceReceipt);
  for (const row of summary.screenshots) {
    assert.equal(row.filename, `${originalRoot}${evidenceRelative}/${row.name}`, "screenshot names a different recording folder");
    const filename = await safeFile(folder, row.name), handle = await fs.open(filename, "r");
    try { const prefix = Buffer.alloc(8); await handle.read(prefix, 0, 8, 0); assert.equal(prefix.toString("hex"), "89504e470d0a1a0a", "not a PNG"); }
    finally { await handle.close(); }
    const pin = await fileIdentity(filename); Object.assign(row, pin); digests[row.name] = pin;
  }
  // Refuse a torn snapshot if the live recorder overwrote any input during this audit.
  for (const [name, pin] of Object.entries(digests)) sameIdentity(await fileIdentity(await safeFile(folder, name)), pin, `receipt changed during audit: ${name}`);
  return { ...summary, frozenHead: FROZEN_HEAD, resources, digests };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.argv.length, 3, "usage: node tools/verify/omarchy-latency-receipt.mjs R2_FOLDER");
    console.log(JSON.stringify(await verifyReceipt(process.argv[2]), null, 2));
  } catch (error) { console.error(`UNPROVEN receipt: ${error.message}`); process.exitCode = 1; }
}
