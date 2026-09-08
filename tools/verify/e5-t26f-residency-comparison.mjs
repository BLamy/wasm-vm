#!/usr/bin/env node
// Existing JIT policy control, not an F acceptance command or a default-policy decision.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertResidentImage, assertFreshLockedPcm } from "./e5-t26f-resident-proof.mjs";

function residencyOptions(input) {
  const fixture = input.E5_T26F_RESIDENCY_FIXTURE;
  assert.ok(fixture === undefined || fixture === "resident-aplay-v1", "unknown residency fixture");
  if (fixture !== undefined) {
    for (const field of ["CHECKPOINT", "IMAGE", "IMAGE_INFO", "ASSET_DIR", "PORT"]) {
      const value = input[`E5_T26F_RESIDENCY_${field}`];
      assert.ok(typeof value === "string" && value.length > 0 && value.trim() === value,
        `resident residency requires explicit ${field}`);
    }
    const checkpoint = input.E5_T26F_RESIDENCY_CHECKPOINT, port = input.E5_T26F_RESIDENCY_PORT;
    assert.ok(path.isAbsolute(checkpoint) && path.resolve(checkpoint) === checkpoint && checkpoint !== path.parse(checkpoint).root,
      "resident checkpoint must be an absolute normalized existing directory");
    assert.ok(/^[1-9][0-9]{3,4}$/u.test(port) && Number(port) >= 1024 && Number(port) <= 65535,
      "resident residency requires a valid explicit port");
  }
  return { fixture, checkpoint: input.E5_T26F_RESIDENCY_CHECKPOINT,
    port: input.E5_T26F_RESIDENCY_PORT || "61629",
    image: input.E5_T26F_RESIDENCY_IMAGE || "target/e5-t26f/desktop-image-aplay-noresize/alpine-rootfs.ext4",
    imageInfo: input.E5_T26F_RESIDENCY_IMAGE_INFO || "target/e5-t26f/desktop-image-aplay-noresize/desktop-info.json",
    assetDir: input.E5_T26F_RESIDENCY_ASSET_DIR || "target/e5-t26f/chunks/desktop-aplay-noresize" };
}

function childEnvironment(input, options, head, retained) {
  const clean = Object.fromEntries(Object.entries(input).filter(([key]) =>
    !key.startsWith("E5_T26F_") && !key.startsWith("CARGO_") && key !== "RUSTFLAGS" && key !== "RUST_LOG"));
  // The resident checkpoint was sealed headless; preserve that immutable launch mode.
  return { ...clean, E5_T26F_REQUIRE_HEAD: head, E5_T26F_HEADED: options.fixture ? "0" : "1",
    E5_T26F_DIAGNOSTIC_PROFILE: retained, E5_T26F_DIAGNOSTIC_PORT: options.port,
    E5_T26F_IMAGE: options.image, E5_T26F_IMAGE_INFO: options.imageInfo,
    E5_T26F_DESKTOP_ASSET_DIR: options.assetDir,
    ...(options.fixture ? { E5_T26F_FIXTURE: options.fixture } : {}) };
}

function armSettings(policy, fixture) {
  assert.ok(policy === "repack-off" || policy === "cap-256", "unknown ABBA policy");
  return { E5_T26F_DIAGNOSTIC: "reuse", E5_T26F_DIAGNOSTIC_JIT: "1", E5_T26F_DIAGNOSTIC_RESIDENCY: policy,
    // Resident admission owns play/5-ms pacing and leaves the production clock untouched.
    ...(fixture ? {} : { E5_T26F_DIAGNOSTIC_GUEST_CLOCK: "icount", E5_T26F_DIAGNOSTIC_KEY_DELAY_MS: "5" }) };
}

async function residentPreflight(options, repo) {
  if (!options.fixture) return null;
  for (const directory of [options.checkpoint, path.resolve(repo, options.assetDir)]) {
    const info = await lstat(directory);
    assert.ok(info.isDirectory() && !info.isSymbolicLink(), "resident inputs require real existing directories");
  }
  // The child authenticates the checkpoint seal and actual image bytes before booting.
  // Here, missing checkpoint/configuration refuses before even allocating an output arm.
  for (const file of [path.join(options.checkpoint, "normal-checkpoint.json"),
    path.resolve(repo, options.image), path.resolve(repo, options.imageInfo),
    path.resolve(repo, options.assetDir, "manifest.json")]) {
    const info = await lstat(file);
    assert.ok(info.isFile() && !info.isSymbolicLink(), "resident inputs require real existing files");
  }
  const imageInfo = JSON.parse(await readFile(path.resolve(repo, options.imageInfo), "utf8"));
  const hash = bytes => createHash("sha256").update(bytes).digest("hex");
  const fixture = assertResidentImage(imageInfo, hash(await readFile(path.join(repo, "tools/guest/e5-t26f-resident-aplay.sh"))));
  assert.match(imageInfo.image?.sha256, /^[0-9a-f]{64}$/u);
  assert.equal((await lstat(path.resolve(repo, options.image))).size, imageInfo.image.size, "resident image size differs from info");
  return { fixture, imageSha256: imageInfo.image.sha256,
    manifestSha256: hash(await readFile(path.resolve(repo, options.assetDir, "manifest.json"))),
    origin: `http://127.0.0.1:${options.port}`, checkpoint: options.checkpoint };
}

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
const options = residencyOptions(process.env);
const residentExpected = await residentPreflight(options, repo);
const out = path.resolve(process.env.E5_T26F_RESIDENCY_OUT || path.join(repo, "evidence/e5-t26f/residency"));
await mkdir(out, { recursive: true });
const retained = options.checkpoint || await mkdtemp(path.join(os.tmpdir(), "e5-t26f-residency-"));
const env = childEnvironment(process.env, options, head, retained);

async function run(label, settings) {
  const directory = path.join(out, label);
  await mkdir(directory); // Refuse to overwrite any prior result, including a failure.
  const child = spawn(process.execPath, ["tools/verify/e5-t26f-browser-roundtrip.mjs"], {
    cwd: repo, env: { ...env, ...settings, E5_T26F_OUT: directory }, stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => {
    log += chunk.toString();
    process.stderr.write(chunk);
  });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => signal ? reject(new Error(`${label}: ${signal}`)) : resolve(code));
  });
  await writeFile(path.join(directory, "run.log"), log, { flag: "wx" });
  return { directory, code };
}

if (!options.fixture && !options.checkpoint) {
  const created = await run("checkpoint", { E5_T26F_DIAGNOSTIC: "create" });
  assert.equal(created.code, 0, "cold checkpoint did not complete");
}

function collectResidencyRecord(record, child, policy, residentExpected) {
  const m = record.milestones;
  if (child.code !== 0) {
    assert.equal(child.code, 1);
    assert.equal(record.error?.message, "post-restore interaction exceeded 2 seconds",
      "a different failure is not a completed residency comparison");
    assert.equal(record.error.name, "AssertionError", "only the original cap AssertionError is admissible");
    assert.equal(record.error.code, "ERR_ASSERTION");
  }
  assert.equal(m.run.acceptance, false);
  assert.equal(m.run.diagnostic.jit, "1");
  assert.equal(m.run.diagnostic.residency, policy);
  assert.equal(m.run.diagnostic.cpu, false);
  assert.equal(m.run.diagnostic.latency, false);
  assert.equal(m.run.postRestoreCommand, residentExpected ? "play" : "sh /tmp/a");
  assert.equal(m.run.postRestoreKeyDelayMs, 5);
  assert.equal(m.normalRestore.displayChecksPassed, true);
  assert.equal(m.normalRestore.result.resume.restored, true);
  assert.equal(m.normalRestore.result.bootStates.some(({ state }) => state === "booting"), false);
  assert.equal(m.postRestoreAudioAfter.guestAttached, true);
  assert.ok(m.postRestoreAudioAfter.pcm.nonSilentFrames > 0);
  assert.ok(m.postRestoreAudioAfter.pcm.maxAbs > 0);
  assert.equal(m.postRestoreAplay.terminalMarkerSeen, true);
  assert.ok(m.postRestoreAplay.visualDiffPixels >= 2_000);
  if (residentExpected) validateResidentRecord(record, residentExpected);
  else {
    assert.deepEqual(m.guestClockErrors, { browser: [], http: [] });
    for (const sample of [m.guestClockBefore, m.guestClockAfter]) assert.equal(sample.state.mode, "icount");
  }
  const { jitBefore: before, jitAfter: after } = m;
  for (const sample of [before, after]) {
    assert.equal(sample.state.hasExecutor, true);
    assert.equal(sample.state.jitResidencyPolicy, policy);
    assert.equal(sample.state.jitResidencyCap, policy === "repack-off" ? 24 : 256);
    assert.ok(Number.isFinite(sample.requestedAt) && Number.isFinite(sample.receivedAt) && sample.receivedAt >= sample.requestedAt);
  }
  const deltas = {};
  for (const key of ["guestRetired", "retiredViaJit", "entryCost.hostEntries", "directChainEntries",
    "blockEntryHits", "blockBuilds", "jitCacheInstalls", "jitCacheRetranslations", "jitCacheEvictions",
    "decodedBlocksDiscarded", "decodedCacheFlushes"]) {
    const read = state => key.split(".").reduce((value, part) => value?.[part], state);
    const from = read(before.state), to = read(after.state);
    assert.ok(Number.isSafeInteger(from) && from >= 0 && Number.isSafeInteger(to), key);
    deltas[key] = to - from;
    assert.ok(deltas[key] >= 0, `${key} regressed`);
  }
  assert.ok(deltas.guestRetired > 0 && deltas.retiredViaJit > 0);
  assert.equal(m.postRestoreStart, m.normalRestore.result.completedAt);
  assert.ok(Number.isFinite(m.postRestoreStart) && Number.isFinite(m.postRestoreEnd) && m.postRestoreEnd > m.postRestoreStart);
  assert.ok(before.requestedAt >= m.postRestoreStart && after.requestedAt >= m.postRestoreEnd &&
    after.requestedAt > before.receivedAt, "JIT endpoints must retain original T0/end ordering");
  if (child.code !== 0) assert.ok(m.postRestoreEnd - m.postRestoreStart > 2_000, "cap error lacks an actual over-cap interval");
  else assert.ok(m.postRestoreEnd - m.postRestoreStart <= 2_000, "successful child exceeded the unchanged cap");
  return {
    binding: m.run.binding, profileSha256: m.run.profileSha256,
    snapshotSha256: m.normalSnapshot.sha256, workerBefore: before, workerAfter: after, deltas,
    interactionMs: m.postRestoreEnd - m.postRestoreStart,
    fTimingPassed: m.postRestoreEnd - m.postRestoreStart <= 2_000, fVerified: false,
    ...(residentExpected ? { residentCheckpoint: m.residentCheckpoint,
      clockObservation: m.guestClockBefore || m.guestClockAfter ? "recorded-icount" : "not-recorded; no override requested" } : {}),
  };
}

function validateResidentRecord(record, expected) {
  const m = record.milestones, diagnostic = m.run.diagnostic, restore = m.normalRestore.result;
  assert.equal(diagnostic.mode, "reuse");
  assert.equal(diagnostic.directory, expected.checkpoint, "resident checkpoint selection differs");
  assert.equal(diagnostic.command, null); assert.equal(diagnostic.keyDelayMs, 0);
  assert.equal(diagnostic.guestClock, null); assert.equal(diagnostic.icountDivider, null);
  assert.equal(diagnostic.complete, false); assert.equal(diagnostic.guestProfile, undefined);
  for (const fixture of [m.run.fixture, m.run.binding?.fixture, m.residentCheckpoint?.fixture]) {
    assert.deepEqual(fixture, expected.fixture, "resident fixture binding differs or is missing");
  }
  for (const field of ["imageSha256", "manifestSha256", "origin"]) {
    assert.equal(m.run.binding[field], expected[field], `resident configured ${field} differs`);
  }
  assert.equal(diagnostic.origin, expected.origin);
  for (const value of [m.run.profileSha256, m.normalSnapshot.sha256, m.run.binding.runtimeSha256,
    m.run.binding.kernelSha256, m.residentCheckpoint.sound?.soundSha256]) assert.match(value, /^[0-9a-f]{64}$/u);
  assert.equal(m.residentCheckpoint.sound.envelopeSha256, m.normalSnapshot.sha256);
  assert.equal(m.residentCheckpoint.prepared?.accepted, true, "resident preparation was not accepted");
  const sound = m.residentCheckpoint.sound;
  for (const [field, value] of Object.entries({ state: 2, paramsPresent: 1, parameterRequest: 257, streamId: 0,
    bufferBytes: 3840, periodBytes: 1920, channels: 2, format: 5, rate: 7, pendingTransfers: 0,
    pendingBytes: 0, releasePending: 0, nextXrunPresent: 0, resetPending: 0 })) {
    assert.equal(sound[field], value, `resident prepared sound ${field} differs`);
  }
  assert.equal(sound.kicked?.[2], 0, "resident checkpoint has queued TX");
  assert.equal(restore.snapshotSha256, m.normalSnapshot.sha256);
  assert.equal(m.normalSnapshot.machineResume?.persisted, true);
  assert.equal(restore.machineResume?.persisted, true);
  assert.match(m.normalSnapshot.preFrontBufferCrc, /^[0-9a-f]{8}$/u);
  assert.equal(restore.preFrontBufferCrc, m.normalSnapshot.preFrontBufferCrc);
  assert.equal(m.normalSnapshot.machineResume.preFrontBufferCrc, m.normalSnapshot.preFrontBufferCrc);
  assert.equal(restore.machineResume.preFrontBufferCrc, m.normalSnapshot.preFrontBufferCrc);
  assert.equal(restore.observation?.firstPresent?.crc32, m.normalSnapshot.preFrontBufferCrc, "resident first restored CRC differs");
  assert.ok(restore.bootStates.some(({ state }) => state === "restored"), "resident restore lacks restored boot state");
  const played = m.postRestoreAplay;
  assert.equal(played.command, "play"); assert.equal(played.accepted, true);
  assert.equal(played.keyboardFrames, 10); assert.equal(played.domEvents, 10);
  assert.equal(played.inputSequenceMatch, true); assert.equal(played.redMarkerSeen, false);
  assert.equal(played.visualChange, true);
  assert.ok(Number.isSafeInteger(played.beforeFrame) && Number.isSafeInteger(played.afterFrame) &&
    played.afterFrame > played.beforeFrame, "resident green must be in a fresh frame");
  assert.equal(m.residentBeforeGesture?.length, 2, "two actual fresh locked PCM observations required");
  for (const sample of m.residentBeforeGesture) {
    assertFreshLockedPcm(sample);
    assert.ok(sample.observedAt >= m.postRestoreStart && sample.observedAt < m.postRestoreEnd);
  }
  assert.ok(m.residentBeforeGesture[1].observedAt > m.residentBeforeGesture[0].observedAt);
  const completion = m.postRestorePcmAtCompletion;
  assert.ok(Number.isFinite(completion?.observedAt) && completion.observedAt > m.residentBeforeGesture[1].observedAt &&
    completion.observedAt <= m.postRestoreEnd, "resident PCM must precede frozen end");
  assert.equal(m.postRestoreAudioAfter.policy, "unlocked"); assert.equal(m.postRestoreAudioAfter.context, "running");
  assert.deepEqual(m.postRestoreAudioAfter.pcm, completion.pcm, "resident completion PCM differs from the frozen observation");
  assert.equal(completion.pcm.available, true);
  for (const field of ["writtenFrames", "inspectedFrames", "nonSilentFrames"]) {
    assert.ok(Number.isSafeInteger(completion.pcm[field]) && completion.pcm[field] > 0, `invalid resident PCM ${field}`);
  }
  assert.ok(completion.pcm.nonSilentFrames <= completion.pcm.inspectedFrames &&
    completion.pcm.inspectedFrames <= completion.pcm.writtenFrames);
  assert.ok(Number.isFinite(completion.pcm.maxAbs) && completion.pcm.maxAbs > 0 && completion.pcm.maxAbs <= 1);
  // No clock RPC or invented clock receipt. Validate existing samples only if retained.
  for (const sample of [m.guestClockBefore, m.guestClockAfter]) if (sample !== undefined) {
    assert.equal(sample?.state?.mode, "icount"); assert.equal(sample.state.clockDiv, 10);
    assert.equal(sample.state.timebaseHz, 10_000_000);
  }
}

function assertSameBindings(first, next) {
  for (const key of ["binding", "profileSha256", "snapshotSha256", "residentCheckpoint"]) {
    assert.deepEqual(first[key], next[key], `comparison changed ${key}`);
  }
}

const results = [];
// ABBA order screens an order effect without selecting the fastest observation.
for (const [index, policy] of ["repack-off", "cap-256", "cap-256", "repack-off"].entries()) {
  const child = await run(`${index + 1}-${policy}`, armSettings(policy, options.fixture));
  const file = path.join(child.directory, child.code === 0
    ? "diagnostic-iteration.json" : "failure-post-restore-interaction-checks.json");
  const bytes = await readFile(file);
  const observation = collectResidencyRecord(JSON.parse(bytes), child, policy, residentExpected);
  results.push({ index: index + 1, policy, record: path.relative(repo, file),
    sha256: createHash("sha256").update(bytes).digest("hex"), ...observation });
  assertSameBindings(results[0], results.at(-1));
}
assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(), head);
const report = { schema: "wasm-vm.e5-t26f.residency-comparison.v1", head, retained,
  ...(options.fixture ? { fixture: options.fixture } : {}),
  claim: "unprofiled ABBA control of existing policies; not F acceptance or a production default decision", results };
await writeFile(path.join(out, "comparison.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify(report, null, 2));
