// Read-only evidence checks for F's real prepared-player fixture; no guest control.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { guestProfileRequested } from "./e5-t26f-guest-profile.mjs";
import { decodedCacheRequested } from "./e5-t26k-decoded-cache.mjs";

export const RESIDENT_KIND = "resident-aplay-v1";
export const OBSERVER_KIND = "resident-observer-v1";
export const OBSERVER_SOURCE = "tools/guest/e5-t26f-observer.c";
export const OBSERVER_HELPER = "tools/guest/e5-t26f-resident-observer.sh";
export const OBSERVER_GUEST_PATH = "/usr/libexec/wasm-vm/e5t26f-observe";
export const RESIDENT_BASE_SHA = "5530d6585776cf61fcedb98f7a2e75b4293d5f805809e5107cc181fa5dc62550";
export const RESIDENT_GUEST_PATH = "/usr/libexec/wasm-vm/e5t26f-resident.sh";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

export function residentFixtureRequested(env) {
  const value = env.E5_T26F_FIXTURE;
  assert.ok(value === undefined || value === RESIDENT_KIND || value === OBSERVER_KIND, "unknown F fixture; omission preserves the original process-launch fixture");
  if (value === undefined) return false;
  if (env.E5_T26F_DIAGNOSTIC_DECODED_CACHE_ENTRIES !== undefined) {
    decodedCacheRequested(env);
    return true;
  }
  if (env.E5_T26F_DIAGNOSTIC_JIT !== undefined || env.E5_T26F_DIAGNOSTIC_RESIDENCY !== undefined) {
    // Isolated existing-policy comparison only, never a resident default or acceptance knob.
    assert.equal(env.E5_T26F_DIAGNOSTIC, "reuse", "resident residency requires exact diagnostic reuse");
    assert.equal(env.E5_T26F_DIAGNOSTIC_JIT, "1", "resident residency requires explicit JIT=1");
    assert.ok(["repack-off", "cap-256"].includes(env.E5_T26F_DIAGNOSTIC_RESIDENCY),
      "resident residency requires explicit repack-off or cap-256");
    for (const key of ["COMPLETE", "CPU", "LATENCY", "GUEST_PROFILE", "GUEST_CLOCK",
      "ICOUNT_DIVIDER", "COMMAND", "KEY_DELAY_MS"]) {
      assert.equal(env[`E5_T26F_DIAGNOSTIC_${key}`], undefined,
        "resident residency requires isolated unchanged command/pacing and no other diagnostic overrides");
    }
    return true;
  }
  if (env.E5_T26F_DIAGNOSTIC_GUEST_PROFILE !== undefined) guestProfileRequested(env);
  for (const key of ["KEY_DELAY_MS", "JIT", "RESIDENCY", "GUEST_CLOCK", "ICOUNT_DIVIDER"]) {
    assert.equal(env[`E5_T26F_DIAGNOSTIC_${key}`], undefined, "resident playback requires fixed command/pacing and unchanged default runtime policies");
  }
  if (env.E5_T26F_DIAGNOSTIC_COMMAND !== undefined) {
    assert.ok(["times;e5_observe;times;play", "times;e5_print_observation post;times;play", "times;play;times",
      "grep -Hs 7fff9b /proc/[0-9]*/maps;play"].includes(env.E5_T26F_DIAGNOSTIC_COMMAND) &&
      env.E5_T26F_DIAGNOSTIC === "reuse" && env.E5_T26F_DIAGNOSTIC_COMPLETE === undefined,
    "resident command probes are exact diagnostic reuse only; no acceptance command override");
  }
  // Observation-only inner loop after a failed frozen run. The runner labels
  // reuse nonacceptance, and make refuses diagnostics before any work. Never
  // admit profiling to cold creation, normal acceptance or COMPLETE evidence.
  for (const key of ["CPU", "LATENCY"]) {
    const option = env[`E5_T26F_DIAGNOSTIC_${key}`];
    if (option === undefined) continue;
    assert.ok(option === "1" && env.E5_T26F_DIAGNOSTIC === "reuse" && env.E5_T26F_DIAGNOSTIC_COMPLETE === undefined,
      "resident observation requires exact diagnostic reuse only; no cold, acceptance or completion profiling");
  }
  return true;
}

export function residentSourceInputs(kind, info) {
  assert.ok([RESIDENT_KIND, OBSERVER_KIND].includes(kind), "unknown resident source kind");
  if (kind === RESIDENT_KIND) return { helper: "tools/guest/e5-t26f-resident-aplay.sh" };
  const observer = info.fixture?.observer;
  assert.ok(observer, "single-process image needs binary provenance");
  for (const [key, filename] of [["binaryPath", "e5t26f-observe"], ["buildInfoPath", "build-info.json"]]) {
    const value = observer[key];
    assert.equal(typeof value, "string");
    assert.ok(value.startsWith("target/e5-t26f/") && value.endsWith(`/${filename}`), "observer input must be a task-owned build artifact");
    assert.ok(value.split("/").every(part => part && part !== "." && part !== ".."), "observer input traversal refused");
    assert.doesNotMatch(value, /[\\\r\n\0]/u);
  }
  assert.equal(observer.binaryPath.slice(0, -"e5t26f-observe".length),
    observer.buildInfoPath.slice(0, -"build-info.json".length), "observer build artifacts must share one directory");
  return { helper: OBSERVER_HELPER, observerSource: OBSERVER_SOURCE,
    observerBinary: observer.binaryPath, observerBuildInfo: observer.buildInfoPath };
}

export function assertResidentImage(info, helperSha256, { kind = RESIDENT_KIND, inputs = {} } = {}) {
  assert.match(helperSha256, /^[0-9a-f]{64}$/u);
  assert.ok([RESIDENT_KIND, OBSERVER_KIND].includes(kind), "unknown resident image kind");
  assert.equal(info.fixture?.kind, kind, "image does not contain the selected resident fixture");
  assert.equal(info.fixture.helperSha256, helperSha256, "fixture helper differs from frozen source");
  assert.equal(info.fixture.baseSha256, RESIDENT_BASE_SHA, "fixture base image differs");
  assert.equal(info.fixture.guestPath, RESIDENT_GUEST_PATH, "fixture install path differs");
  const binding = { kind, helperSha256, baseSha256: RESIDENT_BASE_SHA, guestPath: RESIDENT_GUEST_PATH };
  if (kind === OBSERVER_KIND) {
    residentSourceInputs(kind, info);
    const observer = info.fixture.observer;
    assert.equal(info.fixture.helperPath, OBSERVER_HELPER);
    assert.equal(observer.sourcePath, OBSERVER_SOURCE);
    assert.equal(observer.guestPath, OBSERVER_GUEST_PATH);
    assert.equal(observer.mode, "0555");
    assert.ok(Number.isSafeInteger(observer.size) && observer.size > 0);
    for (const [field, key] of [["sourceSha256", "observerSource"], ["sha256", "observerBinary"], ["buildInfoSha256", "observerBuildInfo"]]) {
      assert.match(inputs[key] ?? "", /^[0-9a-f]{64}$/u, "missing actual observer input hash");
      assert.equal(observer[field], inputs[key], `observer ${field} differs from frozen input`);
    }
    binding.observer = { ...observer };
  }
  return binding;
}

export function parsePreparedSound(value, expectedSha256) {
  const bytes = Buffer.from(value);
  assert.ok(bytes.length >= 60 && bytes.length <= 64 * 1024 * 1024, "bounded desktop envelope required");
  assert.equal(hash(bytes), expectedSha256, "desktop evidence digest differs");
  assert.equal(bytes.subarray(0, 8).toString(), "WVMDESK1");
  assert.equal(bytes.readUInt16LE(8), 1);
  assert.equal(bytes.readUInt16LE(10), 0);
  const count = bytes.readUInt32LE(20), length = bytes.readUInt32LE(24);
  assert.ok(count > 0 && count <= 4, "unexpected desktop section count");
  assert.equal(length, bytes.length - 28 - 32);
  assert.equal(hash(bytes.subarray(0, -32)), bytes.subarray(-32).toString("hex"), "desktop trailer digest differs");
  let offset = 28, sound = null;
  const seen = new Set();
  for (let i = 0; i < count; i++) {
    assert.ok(offset + 40 <= bytes.length - 32, "truncated section header");
    const tag = bytes.readUInt16LE(offset), version = bytes.readUInt16LE(offset + 2), size = bytes.readUInt32LE(offset + 4);
    assert.ok([1, 2, 3, 4].includes(tag) && !seen.has(tag), "unknown or duplicate desktop section");
    seen.add(tag);
    assert.equal(version, 1);
    assert.ok(offset + 40 + size <= bytes.length - 32, "truncated section payload");
    const payload = bytes.subarray(offset + 40, offset + 40 + size);
    assert.equal(hash(payload), bytes.subarray(offset + 8, offset + 40).toString("hex"), "section digest differs");
    if (tag === 3) sound = payload;
    offset += 40 + size;
  }
  assert.equal(offset, bytes.length - 32);
  assert.ok(sound && sound.length >= 184, "missing sound checkpoint");
  assert.equal(sound.subarray(0, 8).toString(), "WVSND001");
  assert.equal(sound.readUInt16LE(8), 1);
  assert.equal(sound.readUInt16LE(10), 0);
  assert.equal(sound.length, 184 + sound.readUInt32LE(164) * 8, "sound event length differs");
  const eventCount = sound.readUInt32LE(164);
  assert.ok(eventCount <= 256, "sound event queue exceeds codec bound");
  const events = Array.from({ length: eventCount }, (_, index) => ({
    code: sound.readUInt32LE(184 + index * 8), stream: sound.readUInt32LE(188 + index * 8) }));
  assert.ok(sound[12] === 0 || sound[12] === 1, "invalid capture-enabled flag");
  for (const event of events) {
    assert.ok(event.code === 0x111 && [0, 1].includes(event.stream), "unsupported sound snapshot event");
    assert.notEqual(event.stream, 0, "prepared checkpoint has a queued playback XRUN");
    assert.equal(sound[12], 1, "capture event requires enabled capture");
  }
  const result = { envelopeSha256: expectedSha256, soundSha256: hash(sound),
    state: sound[48], paramsPresent: sound[49], parameterRequest: sound.readUInt32LE(52),
    streamId: sound.readUInt32LE(56), bufferBytes: sound.readUInt32LE(60), periodBytes: sound.readUInt32LE(64),
    channels: sound[72], format: sound[73], rate: sound[74],
    pendingTransfers: sound.readUInt32LE(104), pendingBytes: sound.readUInt32LE(108),
    releasePending: sound[120], nextXrunPresent: sound[124], eventCount, events,
    kicked: [...sound.subarray(176, 180)], resetPending: sound[180] };
  assert.deepEqual({ state: result.state, present: result.paramsPresent, request: result.parameterRequest,
    stream: result.streamId, buffer: result.bufferBytes, period: result.periodBytes,
    channels: result.channels, format: result.format, rate: result.rate },
  { state: 2, present: 1, request: 0x101, stream: 0, buffer: 3840, period: 1920, channels: 2, format: 5, rate: 7 },
  "actual sound stream must be prepared with the finite stereo fixture parameters");
  for (const key of ["pendingTransfers", "pendingBytes", "releasePending", "nextXrunPresent", "resetPending"]) {
    assert.equal(result[key], 0, `prepared checkpoint has ${key}`);
  }
  // Control/event/capture notifications are not queued playback. Retain them,
  // but fail on the actual TX virtqueue (index 2), even with no transferred PCM.
  assert.equal(result.kicked[2], 0, "prepared checkpoint has an unserviced TX kick");
  return result;
}

export function assertFreshLockedPcm(sample) {
  assert.ok(Number.isFinite(sample.observedAt) && sample.observedAt >= 0, "missing audio observation time");
  assert.equal(sample.policy, "locked");
  assert.equal(sample.context, "suspended");
  assert.equal(sample.pcm?.available, true);
  for (const key of ["writeIndex", "readIndex", "fillFrames", "nonSilentFrames", "maxAbs"]) {
    assert.equal(sample.pcm[key], 0, `pre-gesture ring has ${key}`);
  }
  return sample;
}
