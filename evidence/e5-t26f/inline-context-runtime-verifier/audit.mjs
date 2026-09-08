#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const closed = path.join(repo, "evidence/e5-t26f/single-process-observer-657fb5a2");
const output = path.join(here, "audit-result.json");
const head = "657fb5a23b411bf02832b2d10ef943b43d0becf1";
const wasmSha = "18e53caa2e160819d16a6e0bf376530d45234e28f315c89b5042c48b1d791cc4";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const json = async file => JSON.parse(await readFile(file, "utf8"));
async function hashFile(file) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest("hex");
}
async function treeDigest(directory, include = () => true) {
  const entries = [];
  async function visit(relative) {
    for (const name of (await readdir(path.join(directory, relative))).sort()) {
      const next = path.join(relative, name), file = path.join(directory, next);
      if (!include(next)) continue;
      const info = await lstat(file);
      assert.ok(!info.isSymbolicLink(), `tree binding refuses symlink: ${file}`);
      if (info.isDirectory()) await visit(next);
      else {
        assert.ok(info.isFile(), `tree binding requires regular file: ${file}`);
        entries.push([next, info.size, await hashFile(file)]);
      }
    }
  }
  await visit("");
  assert.ok(entries.length, `empty tree binding: ${directory}`);
  return { sha256: sha(JSON.stringify(entries)), files: entries.length, entries };
}
function parseSound(envelopeBytes, expectedEnvelopeSha) {
  const bytes = Buffer.from(envelopeBytes);
  assert.equal(sha(bytes), expectedEnvelopeSha);
  assert.equal(bytes.subarray(0, 8).toString(), "WVMDESK1");
  assert.equal(bytes.readUInt16LE(8), 1);
  assert.equal(bytes.readUInt16LE(10), 0);
  const count = bytes.readUInt32LE(20), length = bytes.readUInt32LE(24);
  assert.ok(count > 0 && count <= 4);
  assert.equal(length, bytes.length - 60);
  assert.equal(sha(bytes.subarray(0, -32)), bytes.subarray(-32).toString("hex"));
  let offset = 28, sound = null;
  const tags = new Set();
  for (let index = 0; index < count; index++) {
    assert.ok(offset + 40 <= bytes.length - 32);
    const tag = bytes.readUInt16LE(offset), version = bytes.readUInt16LE(offset + 2);
    const size = bytes.readUInt32LE(offset + 4);
    assert.ok([1, 2, 3, 4].includes(tag) && !tags.has(tag));
    tags.add(tag);
    assert.equal(version, 1);
    assert.ok(offset + 40 + size <= bytes.length - 32);
    const payload = bytes.subarray(offset + 40, offset + 40 + size);
    assert.equal(sha(payload), bytes.subarray(offset + 8, offset + 40).toString("hex"));
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
  const events = Array.from({ length: eventCount }, (_, index) => ({
    code: sound.readUInt32LE(184 + index * 8),
    stream: sound.readUInt32LE(188 + index * 8),
  }));
  const result = {
    envelopeSha256: expectedEnvelopeSha,
    soundSha256: sha(sound),
    state: sound[48], paramsPresent: sound[49], parameterRequest: sound.readUInt32LE(52),
    streamId: sound.readUInt32LE(56), bufferBytes: sound.readUInt32LE(60),
    periodBytes: sound.readUInt32LE(64), channels: sound[72], format: sound[73], rate: sound[74],
    pendingTransfers: sound.readUInt32LE(104), pendingBytes: sound.readUInt32LE(108),
    releasePending: sound[120], nextXrunPresent: sound[124], eventCount, events,
    kicked: [...sound.subarray(176, 180)], resetPending: sound[180],
  };
  assert.deepEqual(result, {
    envelopeSha256: expectedEnvelopeSha,
    soundSha256: "330d02f9e91a4e67239bd3386715f87ca45cb0ea8052c387276a6c5450eeeafc",
    state: 2, paramsPresent: 1, parameterRequest: 257, streamId: 0,
    bufferBytes: 3840, periodBytes: 1920, channels: 2, format: 5, rate: 7,
    pendingTransfers: 0, pendingBytes: 0, releasePending: 0, nextXrunPresent: 0,
    eventCount: 0, events: [], kicked: [0, 0, 0, 0], resetPending: 0,
  });
  return result;
}

const files = {
  invocation: path.join(closed, "invocation.json"),
  cold: path.join(closed, "cold/diagnostic-checkpoint.json"),
  coldPng: path.join(closed, "cold/resident-prepared.png"),
  coldLog: path.join(closed, "cold/run.log"),
  coldExit: path.join(closed, "cold/exit.json"),
  reuse: path.join(closed, "reuse/failure-post-restore-interaction-checks.json"),
  reusePng: path.join(closed, "reuse/failure-post-restore-interaction-checks.png"),
  postPng: path.join(closed, "reuse/post-restore.png"),
  reuseLog: path.join(closed, "reuse/run.log"),
  reuseExit: path.join(closed, "reuse/exit.json"),
  observation: path.join(closed, "observation.json"),
};
const [invocation, cold, reuse, observation, coldExit, reuseExit] = await Promise.all([
  json(files.invocation), json(files.cold), json(files.reuse), json(files.observation),
  json(files.coldExit), json(files.reuseExit),
]);

assert.equal(invocation.head, head);
assert.equal(invocation.acceptance, false);
assert.deepEqual(coldExit, { code: 0, signal: null });
assert.deepEqual(reuseExit, { code: 1, signal: null });
for (const actual of [cold.milestones.run.binding, reuse.milestones.run.binding, observation.binding]) {
  assert.equal(actual.head, head);
  assert.deepEqual(actual, cold.milestones.run.binding);
}
assert.equal(reuse.head, head);
assert.equal(observation.head, head);
assert.equal(observation.acceptance, false);
assert.equal(observation.fVerified, false);
assert.equal(observation.fTimingPassed, false);

const hashes = {};
for (const [label, file] of Object.entries(files)) hashes[label] = await hashFile(file);
assert.equal(hashes.reuse, observation.recordSha256);
assert.equal(hashes.coldPng, cold.milestones.residentCheckpoint.screenshot.sha256);
assert.equal(hashes.reusePng, hashes.postPng);

const sourceBindings = {};
for (const [relative, expected] of Object.entries(invocation.sourceBindings)) {
  const actual = await hashFile(path.join(repo, relative));
  assert.equal(actual, expected, `source binding changed: ${relative}`);
  sourceBindings[relative] = actual;
}
const webTree = await treeDigest(path.join(repo, "web"), relative =>
  ["src", "pkg", "bench"].includes(relative.split(path.sep)[0]) ||
  (!relative.includes(path.sep) && /\.(?:js|mjs|html|css|json)$/u.test(relative)));
assert.equal(webTree.sha256, observation.binding.runtimeSha256);
const wasm = {
  source: await hashFile(path.join(repo, "web/pkg/wasm_vm_wasm_bg.wasm")),
  dist: await hashFile(path.join(repo, "web/dist/pkg/wasm_vm_wasm_bg.wasm")),
};
assert.equal(wasm.source, wasmSha);
assert.equal(wasm.dist, wasmSha);

const imagePath = path.join(repo, invocation.common.E5_T26F_IMAGE);
const image = { sha256: await hashFile(imagePath), bytes: (await lstat(imagePath)).size };
assert.equal(image.sha256, observation.binding.imageSha256);
assert.equal(image.bytes, observation.binding.imageBytes);
const profile = await treeDigest(path.join(invocation.retained, "checkpoint-profile"));
assert.equal(profile.sha256, observation.profileSha256);
const checkpoint = await json(path.join(invocation.retained, "normal-checkpoint.json"));
assert.equal(checkpoint.profileSha256, profile.sha256);
assert.equal(checkpoint.schema, "wasm-vm.e5-t26f.diagnostic-profile.v1");
assert.deepEqual(checkpoint.browser, { name: "chromium", version: "Chrome/152.0.7977.76", headless: true });
assert.deepEqual(checkpoint.normalSnapshot, cold.milestones.normalSnapshot);
const envelope = JSON.parse(checkpoint.session.value);
const envelopeBytes = Buffer.from(envelope.bytes, "base64");
assert.equal(sha(envelopeBytes), envelope.sha256);
assert.equal(envelopeBytes.length, envelope.byteLength);
for (const key of ["sha256", "byteLength", "preFrontBufferCrc", "machineResume"])
  assert.deepEqual(envelope[key], checkpoint.normalSnapshot[key]);
const sound = parseSound(envelopeBytes, envelope.sha256);

const m = reuse.milestones, restore = m.normalRestore.result;
assert.equal(restore.snapshotSha256, m.normalSnapshot.sha256);
assert.equal(restore.observation.firstPresent.crc32, m.normalSnapshot.preFrontBufferCrc);
assert.equal(restore.report.fullRepairFrame, true);
assert.equal(restore.report.agentRehandshake, true);
assert.equal(restore.handshake.version, 1);
assert.equal(restore.handshake.generation, 2);
assert.equal(restore.bootStates.some(({ state }) => state === "booting"), false);
assert.equal(restore.resume.restored, true);
assert.equal(m.normalRestore.displayChecksPassed, true);
assert.equal(m.normalRestore.checksPassed, false);
assert.equal(m.postRestoreStart, restore.completedAt);
const elapsedMs = m.postRestoreEnd - m.postRestoreStart;
assert.equal(elapsedMs, 3701.9950000047684);
assert.equal(observation.elapsedMs, elapsedMs);
assert.deepEqual(reuse.error && { name: reuse.error.name, code: reuse.error.code, message: reuse.error.message }, {
  name: "AssertionError", code: "ERR_ASSERTION", message: "post-restore interaction exceeded 2 seconds",
});
assert.match(reuse.error.stack, /e5-t26f-browser-roundtrip\.mjs:1930:12/u);
assert.equal(restore.coherenceAudit.status, "deferred");
assert.equal(m.dragRestore, undefined);

assert.equal(m.run.acceptance, false);
assert.deepEqual(m.run.diagnostic, {
  mode: "reuse", directory: invocation.retained, port: 61637, origin: "http://127.0.0.1:61637",
  command: null, keyDelayMs: 0, latency: false, cpu: false, guestClock: null,
  jit: "1", residency: "repack-off", complete: false, icountDivider: null,
});
assert.equal(m.run.postRestoreCommand, "play");
assert.equal(m.run.postRestoreKeyDelayMs, 5);
assert.equal(m.jitBefore.state.hasExecutor, true);
for (const sample of [m.jitBefore, m.jitAfter]) {
  assert.equal(sample.state.decodedCacheEntries, 4096);
  assert.equal(sample.state.jitResidencyPolicy, "repack-off");
  assert.equal(sample.state.jitResidencyCap, 24);
  assert.equal(sample.state.compileQueue.capacity, 256);
  assert.equal(sample.state.entryCost.timingEnabled, false);
  assert.equal(sample.state.discovery.generation, 5);
}
for (const sample of m.residentBeforeGesture) {
  assert.equal(sample.policy, "locked");
  assert.equal(sample.context, "suspended");
  for (const key of ["writeIndex", "readIndex", "fillFrames", "writtenFrames", "nonSilentFrames", "maxAbs"])
    assert.equal(sample.pcm[key], 0);
}
assert.equal(m.postRestoreCursor.rendered.x, 684);
assert.equal(m.postRestoreCursor.rendered.y, 392);
assert.equal(m.postRestoreCursor.rendered.matchedPixels, 94);
assert.equal(m.postRestoreAplay.command, "play");
assert.equal(m.postRestoreAplay.accepted, true);
assert.equal(m.postRestoreAplay.inputSequenceMatch, true);
assert.equal(m.postRestoreAplay.keyboardFrames, 10);
assert.equal(m.postRestoreAplay.domEvents, 10);
assert.equal(m.postRestoreAplay.terminalMarkerSeen, true);
assert.equal(m.postRestoreAplay.redMarkerSeen, false);
assert.equal(m.postRestoreAplay.visualDiffPixels, 8500);
assert.equal(m.postRestorePcmAtCompletion.pcm.writtenFrames, 4320);
assert.equal(m.postRestorePcmAtCompletion.pcm.nonSilentFrames, 2656);
assert.equal(m.postRestorePcmAtCompletion.pcm.maxAbs, 0.999969482421875);
assert.equal(m.postRestoreAudioAfter.guestAttached, true);
assert.equal(m.postRestoreAudioAfter.policy, "unlocked");
assert.equal(m.postRestoreAudioAfter.context, "running");
assert.ok(m.postRestoreAudioAfter.renderedFrames > m.postRestoreAudioBefore.renderedFrames);
assert.deepEqual(m.postRestoreInteraction.heldButtons, []);
assert.equal(m.postRestoreInteraction.pointerFrames, 3);
assert.equal(m.postRestoreInteraction.keyboardFrames, 10);

const counters = {
  guestRetired: [m.jitBefore.state.guestRetired, m.jitAfter.state.guestRetired],
  retiredViaJit: [m.jitBefore.state.retiredViaJit, m.jitAfter.state.retiredViaJit],
  dynamicLinkHits: [m.jitBefore.state.dynamicLinkHits, m.jitAfter.state.dynamicLinkHits],
  blockBuilds: [m.jitBefore.state.blockBuilds, m.jitAfter.state.blockBuilds],
  compileQueue: observation.compileQueue,
  discovery: { before: m.jitBefore.state.discovery, after: m.jitAfter.state.discovery, deltas: observation.deltas },
  accounting: observation.accounting,
};

const result = {
  schema: "wasm-vm.e5-t26f.inline-context-runtime-verifier.v1",
  head, hashes, sourceBindings, webTree: { sha256: webTree.sha256, files: webTree.files },
  wasm, image, profile: { sha256: profile.sha256, files: profile.files },
  checkpoint: { createdAt: checkpoint.createdAt, browser: checkpoint.browser,
    snapshot: checkpoint.normalSnapshot, sound },
  reached: {
    coldExit, reuseExit, firstPresentCrc: restore.observation.firstPresent.crc32,
    hello: restore.handshake, bootStates: restore.bootStates,
    preGesture: m.residentBeforeGesture, cursor: m.postRestoreCursor,
    command: m.postRestoreAplay, pcm: m.postRestorePcmAtCompletion,
    audioBefore: m.postRestoreAudioBefore, audioAfter: m.postRestoreAudioAfter,
    interaction: m.postRestoreInteraction,
  },
  timing: { start: m.postRestoreStart, end: m.postRestoreEnd, elapsedMs, limitMs: 2000,
    passed: false, failpoint: "tools/verify/e5-t26f-browser-roundtrip.mjs:1930:12" },
  counters,
  limitations: {
    acceptance: false, fVerified: false, profileEnabled: false,
    fullReuseErrorArraysPresent: Object.hasOwn(reuse, "errors"),
    coherence: restore.coherenceAudit.status, dragReached: false,
    exact1440FrameSubpredictionHeld: false,
  },
};
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ output: path.relative(repo, output), elapsedMs, hashes: {
  reuseRaw: hashes.reuse, auditPending: true }, pcm: result.reached.pcm.pcm, accounting: observation.accounting }));
