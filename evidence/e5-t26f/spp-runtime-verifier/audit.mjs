#!/usr/bin/env node
// Offline, read-only audit of the original closed cold/reuse pair. No harness imports.
// New output only; never reads the separate cpu/latency diagnostic directories.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const closed = path.join(repo, "evidence/e5-t26f/single-process-observer-96ecb801");
const output = path.join(here, "audit-result.json");
const head = "96ecb801fdf8b67af75cd150db82d115bcf046cd";
const nHead = "ba9910ab0bec9029368376888a34a629620c7dbd";
const expectedWasm = "84b2c17c9b6ab9d86c85912f82bd0b4b4533178fc27a0724d47565cb40974b4d";
const retained = "/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/e5-t26f-single-process-observer-oBnSX1";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const json = async file => JSON.parse(await readFile(file, "utf8"));
const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
async function hashFile(file) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest("hex");
}
async function tree(directory, include = () => true) {
  const entries = [];
  async function visit(relative) {
    for (const name of (await readdir(path.join(directory, relative))).sort()) {
      const next = path.join(relative, name), file = path.join(directory, next);
      if (!include(next)) continue;
      const stat = await lstat(file);
      assert.ok(!stat.isSymbolicLink(), `symlink in bound tree: ${file}`);
      if (stat.isDirectory()) await visit(next);
      else {
        assert.ok(stat.isFile(), `nonregular bound file: ${file}`);
        entries.push([next, stat.size, await hashFile(file)]);
      }
    }
  }
  await visit("");
  assert.ok(entries.length);
  return { sha256: sha(JSON.stringify(entries)), files: entries.length, entries };
}
const runtimeFilter = relative => ["src", "pkg", "bench"].includes(relative.split(path.sep)[0]) ||
  (!relative.includes(path.sep) && /\.(?:js|mjs|html|css|json)$/u.test(relative));

function decodeEnvelope(bytes) {
  assert.ok(bytes.length >= 60);
  assert.equal(bytes.subarray(0, 8).toString(), "WVMDESK1");
  assert.equal(bytes.readUInt16LE(8), 1);
  assert.equal(bytes.readUInt16LE(10), 0);
  const count = bytes.readUInt32LE(20);
  assert.ok(count > 0 && count <= 4);
  assert.equal(bytes.readUInt32LE(24), bytes.length - 60);
  assert.equal(sha(bytes.subarray(0, -32)), bytes.subarray(-32).toString("hex"));
  let offset = 28, sound;
  const sections = [], seen = new Set();
  for (let i = 0; i < count; i++) {
    assert.ok(offset + 40 <= bytes.length - 32);
    const tag = bytes.readUInt16LE(offset), version = bytes.readUInt16LE(offset + 2);
    const size = bytes.readUInt32LE(offset + 4);
    assert.ok([1, 2, 3, 4].includes(tag) && !seen.has(tag));
    assert.equal(version, 1);
    assert.ok(offset + 40 + size <= bytes.length - 32);
    const payload = bytes.subarray(offset + 40, offset + 40 + size);
    assert.equal(sha(payload), bytes.subarray(offset + 8, offset + 40).toString("hex"));
    sections.push({ tag, version, headerOffset: offset, payloadOffset: offset + 40, size, sha256: sha(payload) });
    seen.add(tag);
    if (tag === 3) sound = payload;
    offset += 40 + size;
  }
  assert.equal(offset, bytes.length - 32);
  assert.ok(sound && sound.length >= 184);
  assert.equal(sound.subarray(0, 8).toString(), "WVSND001");
  assert.equal(sound.readUInt16LE(8), 1);
  assert.equal(sound.readUInt16LE(10), 0);
  const eventCount = sound.readUInt32LE(164);
  assert.equal(sound.length, 184 + eventCount * 8);
  const state = {
    state: sound[48], paramsPresent: sound[49], parameterRequest: sound.readUInt32LE(52),
    streamId: sound.readUInt32LE(56), bufferBytes: sound.readUInt32LE(60), periodBytes: sound.readUInt32LE(64),
    channels: sound[72], format: sound[73], rate: sound[74],
    pendingTransfers: sound.readUInt32LE(104), pendingBytes: sound.readUInt32LE(108),
    releasePending: sound[120], nextXrunPresent: sound[124], eventCount,
    events: Array.from({ length: eventCount }, (_, i) => ({ code: sound.readUInt32LE(184 + i * 8), stream: sound.readUInt32LE(188 + i * 8) })),
    kicked: [...sound.subarray(176, 180)], resetPending: sound[180],
  };
  assert.deepEqual(state, {
    state: 2, paramsPresent: 1, parameterRequest: 257, streamId: 0, bufferBytes: 3840, periodBytes: 1920,
    channels: 2, format: 5, rate: 7, pendingTransfers: 0, pendingBytes: 0,
    releasePending: 0, nextXrunPresent: 0, eventCount: 0, events: [], kicked: [0, 0, 0, 0], resetPending: 0,
  });
  return { sections, sound: { envelopeSha256: sha(bytes), soundSha256: sha(sound), ...state } };
}

const paths = Object.fromEntries(Object.entries({
  invocation: "invocation.json", cold: "cold/diagnostic-checkpoint.json", coldPng: "cold/resident-prepared.png",
  coldLog: "cold/run.log", coldExit: "cold/exit.json",
  reuse: "reuse/failure-post-restore-interaction-checks.json",
  reusePng: "reuse/failure-post-restore-interaction-checks.png",
  reuseServer: "reuse/failure-post-restore-interaction-checks-server.log",
  postRestore: "reuse/post-restore.json", postPng: "reuse/post-restore.png", postServer: "reuse/post-restore-server.log",
  reuseLog: "reuse/run.log", reuseExit: "reuse/exit.json", observation: "observation.json",
}).map(([key, relative]) => [key, path.join(closed, relative)]));
Object.assign(paths, {
  plan: path.join(here, "plan.md"), auditSource: fileURLToPath(import.meta.url),
  owner: path.join(retained, "e5-t26f-owner.json"), checkpoint: path.join(retained, "normal-checkpoint.json"),
  nVerdict: path.join(repo, "evidence/e5-t26n/verifier/final-verdict.md"),
});
const hashes = {};
for (const [key, file] of Object.entries(paths)) hashes[key] = await hashFile(file);
assert.equal(git("rev-parse", "HEAD").trim(), head);
assert.equal(git("branch", "--show-current").trim(), "codex/e5-t26f-spp-browser-proof");
assert.equal(sha(git("show", `${head}:evidence/e5-t26f/spp-runtime-verifier/plan.md`)), hashes.plan);
git("merge-base", "--is-ancestor", nHead, head);
assert.equal(sha(git("show", `${nHead}:evidence/e5-t26n/verifier/final-verdict.md`)), hashes.nVerdict);
assert.match(await readFile(paths.nVerdict, "utf8"), /^VERDICT: verified\b/u);
const changesSinceN = git("diff", "--name-only", nHead, head).trim().split("\n").filter(Boolean);
const activationMetadata = ["web/tasks.json", "web/dist/tasks.json", "web/dist/sw.js"];
assert.ok(changesSinceN.every(file => file.startsWith("evidence/") || file.startsWith("tasks/") || activationMetadata.includes(file)), "unexpected production change since N verdict");
const swWithoutVersion = text => text.replace(/const VERSION = "[a-f0-9]+";/u, 'const VERSION = "BUILD-HASH";');
assert.equal(swWithoutVersion(git("show", `${nHead}:web/dist/sw.js`)), swWithoutVersion(git("show", `${head}:web/dist/sw.js`)));

const [inv, cold, raw, obs, coldExit, reuseExit, checkpoint, owner] = await Promise.all(
  ["invocation", "cold", "reuse", "observation", "coldExit", "reuseExit", "checkpoint", "owner"].map(key => json(paths[key])));
const c = cold.milestones, m = raw.milestones, binding = c.run.binding;
assert.equal(inv.head, head);
assert.equal(raw.head, head);
assert.equal(obs.head, head);
assert.equal(inv.retained, retained);
assert.equal(obs.retained, retained);
assert.deepEqual(inv.order, ["cold", "reuse-default4096-repack-off24"]);
assert.deepEqual(coldExit, { code: 0, signal: null });
assert.deepEqual(reuseExit, { code: 1, signal: null });
assert.equal(hashes.reuse, obs.recordSha256);
assert.equal(path.join(repo, obs.record), paths.reuse);
assert.equal(hashes.coldPng, c.residentCheckpoint.screenshot.sha256);
assert.equal(hashes.reusePng, hashes.postPng);
assert.equal(hashes.reuseServer, hashes.postServer);
for (const actual of [binding, m.run.binding, owner.binding, obs.binding]) {
  assert.equal(actual.head, head);
  assert.deepEqual(actual, binding);
}
assert.equal(binding.origin, "http://127.0.0.1:61637");
assert.deepEqual(obs.sourceBindings, inv.sourceBindings);
assert.equal(inv.command, "tools/verify/e5-t26f-browser-roundtrip.mjs");
assert.equal(inv.common.E5_T26F_REQUIRE_HEAD, head);
assert.equal(inv.common.E5_T26F_DIAGNOSTIC_PROFILE, retained);
const sources = {};
for (const [relative, expected] of Object.entries(inv.sourceBindings)) {
  sources[relative] = await hashFile(path.join(repo, relative));
  assert.equal(sources[relative], expected, `source pin: ${relative}`);
}
assert.equal(sources[inv.command], "7f8b58f7e3f6e0f16b7b6cb91b8593e625ed058e7aa764df428e9990f85100a1");
assert.equal(sources["tools/verify/e5-t26f-browser-single-process-observer.mjs"], "3be35665f7d403f9c291b5b81b1c07449ef526d171a53f5e7a69b087e79c416d");
const webTree = await tree(path.join(repo, "web"), runtimeFilter);
assert.equal(webTree.sha256, binding.runtimeSha256);
const wasm = {};
for (const relative of ["web/pkg/wasm_vm_wasm_bg.wasm", "web/dist/pkg/wasm_vm_wasm_bg.wasm"]) {
  wasm[relative] = await hashFile(path.join(repo, relative));
  assert.equal(wasm[relative], expectedWasm);
}
const kernelDeclaration = (await json(path.join(repo, "web/artifacts-alpine.json"))).artifacts.kernel;
const kernelUrl = new URL(kernelDeclaration.url, `${binding.origin}/desktop-cursor.html`);
assert.equal(kernelUrl.origin, binding.origin);
const kernelRoot = kernelUrl.pathname.startsWith("/releases/") ? repo : path.join(repo, "web");
const kernelPath = path.resolve(kernelRoot, `.${kernelUrl.pathname}`);
assert.ok(kernelPath.startsWith(`${kernelRoot}${path.sep}`));
const kernel = { file: kernelPath, sha256: await hashFile(kernelPath), bytes: (await lstat(kernelPath)).size };
assert.equal(kernel.sha256, binding.kernelSha256);
assert.equal(kernel.sha256, kernelDeclaration.sha256);
assert.equal(kernel.bytes, kernelDeclaration.size);
const imagePath = path.join(repo, inv.common.E5_T26F_IMAGE);
const image = { file: imagePath, sha256: await hashFile(imagePath), bytes: (await lstat(imagePath)).size };
assert.equal(image.sha256, binding.imageSha256);
assert.equal(image.sha256, "d2fc4eab9bc1b5fe528a2956b58faefb20fcf18e2505c499ecafa8824d390f72");
assert.equal(image.bytes, binding.imageBytes);
assert.equal(sources[`${inv.common.E5_T26F_DESKTOP_ASSET_DIR}/manifest.json`], binding.manifestSha256);
const fixture = binding.fixture;
assert.equal(fixture.kind, "resident-observer-v1");
assert.equal(fixture.helperSha256, sources["tools/guest/e5-t26f-resident-observer.sh"]);
assert.equal(fixture.observer.sourceSha256, sources[fixture.observer.sourcePath]);
assert.equal(fixture.observer.sha256, sources[fixture.observer.binaryPath]);
assert.equal(fixture.observer.buildInfoSha256, sources[fixture.observer.buildInfoPath]);
assert.equal(fixture.observer.readbackSha256, fixture.observer.sha256);
assert.equal((await lstat(path.join(repo, fixture.observer.binaryPath))).size, fixture.observer.size);
for (const actual of [c.run.fixture, m.run.fixture, checkpoint.resident.fixture]) assert.deepEqual(actual, fixture);

assert.equal(owner.schema, "wasm-vm.e5-t26f.diagnostic-profile.v1");
assert.equal(checkpoint.schema, owner.schema);
assert.equal(checkpoint.session.key, "wasm-vm.desktop-snapshot.v1");
const seedPath = path.join(retained, "checkpoint-profile");
const seed = await tree(seedPath);
assert.equal(checkpoint.profileSha256, seed.sha256);
assert.equal(obs.profileSha256, seed.sha256);
assert.equal(c.run.profile, seedPath);
assert.notEqual(m.run.profile, seedPath);
assert.equal(path.dirname(path.dirname(m.run.profile)), retained);
assert.match(path.basename(path.dirname(m.run.profile)), /^iteration-[A-Za-z0-9]+$/u);
assert.equal(path.basename(m.run.profile), "profile");
assert.ok((await lstat(m.run.profile)).isDirectory());
for (const run of [c.run, m.run]) {
  assert.equal(run.creatorHead, head);
  assert.equal(run.currentHead, head);
  assert.equal(run.profileSha256, seed.sha256);
  assert.equal(run.checkpointFile, paths.checkpoint);
}
assert.equal(m.run.checkpointCreatedAt, checkpoint.createdAt);
assert.deepEqual(checkpoint.browser, { name: "chromium", version: "Chrome/152.0.7977.76", headless: true });
assert.deepEqual(checkpoint.normalSnapshot, c.normalSnapshot);
assert.deepEqual(m.normalSnapshot, c.normalSnapshot);
assert.deepEqual(checkpoint.resident, c.residentCheckpoint);
assert.deepEqual(m.residentCheckpoint, checkpoint.resident);
assert.equal(obs.snapshotSha256, checkpoint.normalSnapshot.sha256);
const envelope = JSON.parse(checkpoint.session.value), bytes = Buffer.from(envelope.bytes, "base64");
assert.equal(envelope.schema, "wasm-vm.e5-t26f.desktop-snapshot.v1");
assert.equal(sha(bytes), envelope.sha256);
assert.equal(bytes.length, envelope.byteLength);
for (const key of ["sha256", "byteLength", "preFrontBufferCrc", "machineResume"])
  assert.deepEqual(envelope[key], checkpoint.normalSnapshot[key]);
const decoded = decodeEnvelope(bytes);
assert.deepEqual(decoded.sound, checkpoint.resident.sound);
assert.equal(envelope.machineResume.persisted, true);
assert.equal(envelope.machineResume.paused, true);
assert.equal(envelope.machineResume.preFrontBufferCrc, envelope.preFrontBufferCrc);
assert.equal(c.normalCheckpointBeforeReload.status, "passed");
const paused = c.normalCheckpointBeforeReload.observed;
assert.equal(paused.isPaused, true);
assert.equal(paused.stillPaused, true);
assert.equal(paused.decision, "resume");
assert.equal(paused.generation, envelope.machineResume.overlayGeneration);
assert.equal(paused.finalGeneration, paused.generation);
assert.equal(paused.envelopeSha256, envelope.sha256);

function phases(log) {
  return log.split("\n").filter(line => line.startsWith('[e5-t26f] {"phase":'))
    .map(line => JSON.parse(line.slice("[e5-t26f] ".length)));
}
const coldLog = await readFile(paths.coldLog, "utf8"), reuseLog = await readFile(paths.reuseLog, "utf8");
const coldPhases = phases(coldLog), reusePhases = phases(reuseLog);
const nCommittedAt = git("show", "-s", "--format=%cI", nHead).trim();
const fCommittedAt = git("show", "-s", "--format=%cI", head).trim();
assert.ok(Date.parse(nCommittedAt) <= Date.parse(fCommittedAt));
assert.ok(Date.parse(fCommittedAt) < Date.parse(coldPhases[0].timestamp));
assert.ok(Date.parse(coldPhases[0].timestamp) < Date.parse(checkpoint.createdAt));
assert.ok(Date.parse(checkpoint.createdAt) < Date.parse(reusePhases[0].timestamp));
for (const [log, label, settings] of [[coldLog, "cold", { E5_T26F_DIAGNOSTIC: "create" }],
  [reuseLog, "reuse", { E5_T26F_DIAGNOSTIC: "reuse", E5_T26F_DIAGNOSTIC_JIT: "1", E5_T26F_DIAGNOSTIC_RESIDENCY: "repack-off" }]]) {
  const header = JSON.parse(log.split("\n")[0]);
  assert.equal(header.head, head);
  assert.equal(header.command, inv.command);
  assert.deepEqual(header.config, { ...inv.common, ...settings, E5_T26F_OUT: path.join(closed, label) });
}
for (const [run, mode, jit, residency] of [[c.run, "create", null, null], [m.run, "reuse", "1", "repack-off"]]) {
  assert.equal(run.acceptance, false);
  assert.deepEqual(run.diagnostic, { mode, directory: retained, port: 61637, origin: binding.origin,
    command: null, keyDelayMs: 0, latency: false, cpu: false, guestClock: null,
    jit, residency, complete: false, icountDivider: null });
  assert.equal(run.postRestoreCommand, "play");
  assert.equal(run.postRestoreKeyDelayMs, 5);
}
for (const command of [c.initialAplay, c.residentCheckpoint.prepared, m.postRestoreAplay]) {
  assert.equal(command.accepted, true);
  assert.equal(command.inputSequenceMatch, true);
  assert.equal(command.keyboardFrames, command.domEvents);
  assert.equal(command.terminalMarkerSeen, true);
  assert.equal(command.redMarkerSeen, false);
  assert.ok(command.visualDiffPixels >= 2000);
}
assert.ok(c.twoWindows);
assert.equal(c.initialCursor.rendered.matchedPixels, 94);
assert.deepEqual(cold.errors, { browser: [], http: [] });

const restore = m.normalRestore.result;
assert.equal(restore.snapshotSha256, envelope.sha256);
assert.equal(restore.snapshotBytes, envelope.byteLength);
assert.equal(restore.observation.firstPresent.crc32, envelope.preFrontBufferCrc);
assert.equal(restore.report.fullRepairFrame, true);
assert.equal(restore.report.agentRehandshake, true);
assert.equal(restore.handshake.version, 1);
assert.equal(restore.handshake.generation, 2);
assert.equal(restore.resume.restored, true);
assert.equal(restore.bootStates.some(item => item.state === "booting"), false);
assert.deepEqual(restore.presentation.errors, []);
assert.equal(m.normalRestore.displayChecksPassed, true);
assert.equal(m.normalRestore.checksPassed, false);
assert.equal(restore.coherenceAudit.status, "deferred");
assert.equal(m.postRestoreStart, restore.completedAt);
assert.equal(m.residentBeforeGesture.length, 2);
for (const sample of m.residentBeforeGesture) {
  assert.equal(sample.policy, "locked");
  assert.equal(sample.context, "suspended");
  for (const key of ["writeIndex", "readIndex", "fillFrames", "writtenFrames", "inspectedFrames", "nonSilentFrames", "maxAbs"])
    assert.equal(sample.pcm[key], 0);
}
assert.ok(m.residentBeforeGesture[1].observedAt > m.residentBeforeGesture[0].observedAt);
assert.equal(m.postRestoreAplay.command, "play");
assert.equal(m.postRestoreAplay.keyboardFrames, 10);
const terminal = raw.state.terminal;
assert.equal(terminal.focuses.length, 1);
assert.equal(terminal.focuses[0].accepted, true);
assert.equal(terminal.focuses[0].guestVisible, true);
assert.equal(terminal.focuses[0].guestVisibleCommand, m.postRestoreAplay.marker);
assert.equal(terminal.focuses[0].guestVisiblePixels, m.postRestoreAplay.visualDiffPixels);
assert.equal(terminal.pointerFrameSample[0].device, "tablet");
assert.deepEqual(terminal.keyboardFrameSample.map(event => [event.code, event.value]),
  ["KeyP", "KeyL", "KeyA", "KeyY", "Enter"].flatMap(code => [[code, 1], [code, 0]]));
assert.equal(m.postRestoreCursor.rendered.x, 684);
assert.equal(m.postRestoreCursor.rendered.y, 392);
assert.equal(m.postRestoreCursor.rendered.matchedPixels, 94);
const pcm = m.postRestorePcmAtCompletion.pcm;
assert.ok(pcm.writtenFrames > 0 && pcm.inspectedFrames > 0 && pcm.nonSilentFrames > 0 && pcm.maxAbs > 0);
assert.ok(pcm.nonSilentFrames <= pcm.inspectedFrames && pcm.inspectedFrames <= pcm.capacityFrames);
assert.equal(m.postRestoreAudioAfter.guestAttached, true);
assert.equal(m.postRestoreAudioAfter.policy, "unlocked");
assert.equal(m.postRestoreAudioAfter.context, "running");
assert.ok(m.postRestoreAudioAfter.renderedFrames > m.postRestoreAudioBefore.renderedFrames);
assert.deepEqual(m.postRestoreInteraction.heldButtons, []);
assert.equal(m.postRestoreInteraction.pointerFrames, 3);
assert.equal(m.postRestoreInteraction.keyboardFrames, 10);
const elapsedMs = m.postRestoreEnd - m.postRestoreStart;
assert.ok(Number.isFinite(elapsedMs) && elapsedMs > 2000);
assert.equal(obs.elapsedMs, elapsedMs);
assert.equal(obs.fTimingPassed, false);
for (const value of [inv.acceptance, cold.acceptance, obs.acceptance, obs.fVerified]) assert.equal(value, false);
assert.deepEqual({ name: raw.error.name, code: raw.error.code, message: raw.error.message }, {
  name: "AssertionError", code: "ERR_ASSERTION", message: "post-restore interaction exceeded 2 seconds",
});
assert.match(raw.error.stack, /e5-t26f-browser-roundtrip\.mjs:1930:12/u);
assert.equal(reusePhases.at(-1).phase, "post-restore:interaction-checks");
assert.equal(reusePhases.at(-1).event, "failed");
assert.equal(reusePhases.some(item => item.phase.startsWith("drag:")), false);
assert.equal(Object.keys(m).some(key => /drag|latency|cpu|guestProfile/iu.test(key)), false);

// Independent exact arithmetic from the two raw RPC samples, not collector functions.
const before = m.jitBefore.state, after = m.jitAfter.state;
for (const sample of [before, after]) {
  assert.equal(sample.hasExecutor, true);
  assert.equal(sample.decodedCacheEntries, 4096);
  assert.equal(sample.jitResidencyPolicy, "repack-off");
  assert.equal(sample.jitResidencyCap, 24);
  assert.equal(sample.compileQueue.capacity, 256);
  assert.equal(sample.entryCost.timingEnabled, false);
  assert.equal(sample.entryCost.timerReads, 0);
  assert.equal(sample.discovery.generation, 5);
  assert.equal(sample.decodedBlocksDiscarded, 0);
  assert.equal(sample.decodedCacheFlushes, 4);
  assert.equal(sample.dynamicLinkAttempts, sample.dynamicLinkHits + sample.dynamicLinkRefusals);
  for (const values of [sample.compileQueue, sample.discovery])
    for (const count of Object.values(values)) assert.ok(Number.isSafeInteger(count) && count >= 0);
  assert.ok(sample.compileQueue.queueDepth <= sample.compileQueue.queueHighWater && sample.compileQueue.queueHighWater <= 256);
}
const delta = (a, b, signed = false) => {
  assert.ok(Number.isSafeInteger(a) && Number.isSafeInteger(b));
  const value = BigInt(b) - BigInt(a);
  assert.ok(value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= (signed ? -BigInt(Number.MAX_SAFE_INTEGER) : 0n));
  return Number(value);
};
const discoveryDeltas = Object.fromEntries(Object.keys(obs.deltas).map(key => [key, delta(before.discovery[key], after.discovery[key])]));
assert.deepEqual(discoveryDeltas, obs.deltas);
const qBefore = before.compileQueue, qAfter = after.compileQueue;
const queueDeltas = Object.fromEntries(["admitted", "droppedBackpressure", "cancelledStale", "popped"]
  .map(key => [key, delta(qBefore[key], qAfter[key])]));
const depthDelta = delta(qBefore.queueDepth, qAfter.queueDepth, true);
const discoveryDepthDelta = delta(before.discovery.queueDepth, after.discovery.queueDepth, true);
const staged = discoveryDeltas.nominated - discoveryDepthDelta;
const submitted = delta(before.jitSubmittedMembers, after.jitSubmittedMembers);
const accounted = depthDelta + queueDeltas.droppedBackpressure + queueDeltas.cancelledStale + queueDeltas.popped;
assert.equal(staged, accounted);
const accounting = { staged, submitted, pendingDepthDelta: depthDelta, droppedBackpressure: queueDeltas.droppedBackpressure,
  cancelledStale: queueDeltas.cancelledStale, popped: queueDeltas.popped,
  poppedUnsubmitted: queueDeltas.popped - submitted, incomingRejected: staged - queueDeltas.admitted,
  residentDisplaced: queueDeltas.admitted - depthDelta - queueDeltas.cancelledStale - queueDeltas.popped };
assert.ok(Object.values(accounting).every(value => Number.isSafeInteger(value) && value >= 0));
assert.equal(accounting.incomingRejected + accounting.residentDisplaced, accounting.droppedBackpressure);
assert.deepEqual(obs.accounting, accounting);
assert.deepEqual(obs.compileQueue, { before: qBefore, after: qAfter, deltas: queueDeltas, depthDelta });
assert.deepEqual(obs.before, m.jitBefore);
assert.deepEqual(obs.after, m.jitAfter);
for (const key of ["droppedStale", "droppedOverflow", "countsDropped"])
  assert.equal(before.discovery[key] + after.discovery[key], 0);

// Recheck immutable inputs and sealed baseline; no running copied profile is read or written.
for (const [key, file] of Object.entries(paths)) assert.equal(await hashFile(file), hashes[key], `audit input changed: ${key}`);
for (const [relative, expected] of Object.entries(sources))
  assert.equal(await hashFile(path.join(repo, relative)), expected, `source changed during audit: ${relative}`);
assert.equal((await tree(seedPath)).sha256, seed.sha256);
assert.equal((await tree(path.join(repo, "web"), runtimeFilter)).sha256, webTree.sha256);
assert.equal(git("rev-parse", "HEAD").trim(), head);

const result = {
  schema: "wasm-vm.e5-t26f.spp-runtime-verifier.v1", head,
  verdict: "F timing FAILED; bounded reached functionality HELD; F not verified",
  predictionStatus: { P1: "HELD", P2: "HELD", P3: "HELD", P4: "HELD", P5: "HELD", P6: "FAILED",
    P7: "HELD boundary; NEEDS EVIDENCE for later coverage", P8: "HELD boundary; F acceptance NEEDS EVIDENCE" },
  paths, hashes, sources, wasm, binding, kernel, image, webTree, seed,
  provenance: { nHead, nCommittedAt, fCommittedAt, changesSinceN, planCommittedBeforeCold: true,
    coldStartedAt: coldPhases[0].timestamp, checkpointCreatedAt: checkpoint.createdAt, reuseStartedAt: reusePhases[0].timestamp,
    ownerMatches: true, creatorAndCurrentHeadMatch: true, baselineProfile: seedPath, reusedCopy: m.run.profile,
    browser: checkpoint.browser, browserIdentityEvidence: "Actual saved identity, authenticated by unchanged runner equality at line 1511 before reached reuse phases; failure JSON omits browser field",
    environmentEvidence: "Logged child config and source-enforced E5/CARGO/RUSTFLAGS/RUST_LOG scrub. Outer RUSTDOCFLAGS unset is supplied launch provenance, not a full raw environment capture." },
  snapshot: { ...checkpoint.normalSnapshot, ...decoded },
  visualInspection: {
    method: "Critic viewed both original PNGs; following values are manual transcription, not machine OCR or independently serialized /proc data",
    coldPngSha256: hashes.coldPng, postPngSha256: hashes.reusePng,
    pre1Pre2Post: { pid: 999, starttime: 28938, executable: "/usr/bin/aplay(inode-match)", wchan: "pipe_read",
      fifoFd: 3, fifoFlags: "0100000", readOnly: 1, parentFd: 3, parentFlags: "0100002", childWriters: 0,
      pcmFd: 4, pcmOwner: 999, pcmState: "PREPARED", hwPtr: 0, applPtr: 0 },
    cold: "Two terminals, pre-1/pre-2 observations, green e5t26f-prepared and custom cursor",
    reuse: "Same post identity, typed play, green e5t26f-aplay, [1]+ Done, shell prompt, moved cursor",
    identityLimits: "Parent PID/inode numbers/full e5_seen string are not printed; their equality is supported by unchanged held helper/C guards and conditional success, not invented numeric values",
  },
  cold: { exit: coldExit, initialReadiness: c.initialReadiness, twoWindows: c.twoWindows, initialAplay: c.initialAplay,
    initialAudio: c.initialAudio, prepared: c.residentCheckpoint.prepared, cursor: c.initialCursor,
    pause: c.normalSnapshotPause, coherence: c.normalCheckpointBeforeReload, errors: cold.errors },
  reached: { exit: reuseExit, restore, beforeGesture: m.residentBeforeGesture, cursor: m.postRestoreCursor,
    focus: terminal.focuses, pointerFrames: terminal.pointerFrameSample, keyboardFrames: terminal.keyboardFrameSample,
    domEvents: terminal.keyboardEventSample, aplay: m.postRestoreAplay, pcm: m.postRestorePcmAtCompletion,
    output: m.postRestoreOutputAttached, audioBefore: m.postRestoreAudioBefore, audioAfter: m.postRestoreAudioAfter,
    interaction: m.postRestoreInteraction, phases: reusePhases },
  timing: { start: m.postRestoreStart, end: m.postRestoreEnd, elapsedMs, limitMs: 2000, passed: false,
    laterInteractionElapsed: m.postRestoreInteraction.elapsedMs, failpoint: "tools/verify/e5-t26f-browser-roundtrip.mjs:1930:12", error: raw.error },
  counters: { before: m.jitBefore, after: m.jitAfter, discoveryDeltas, discoveryDepthDelta, queueDeltas, depthDelta, accounting,
    conservation: `${staged} = ${depthDelta} + ${queueDeltas.droppedBackpressure} + ${queueDeltas.cancelledStale} + ${queueDeltas.popped}` },
  limits: { acceptance: false, fVerified: false, coherenceAudit: restore.coherenceAudit.status, dragReached: false,
    fullReuseErrorArraysPresent: Object.hasOwn(raw, "errors"), presentationLocalErrors: restore.presentation.errors,
    counters: "Same-generation unsaturated lifetime/completed-pump job counters across sequential RPC spans, not exact F interval or unique PCs; no causal, first-arrival or speedup claim",
    requiredForAcceptance: "Complete normal non-diagnostic make verify-E5-T26f at frozen head with independent review",
    carried: "N verified cached bits 1/3/5/7/8 and guest safety; unchanged held image/observer/helper proofs. None rerun here.",
    otherDiagnostics: "Not inspected; explicit original cold/reuse input allowlist only" },
};
await writeFile(output, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ output, elapsedMs, rawSha256: hashes.reuse, resultSha256: await hashFile(output),
  webFiles: webTree.files, seedFiles: seed.files, accounting, pcm }, null, 2));
