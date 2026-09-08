// Read-only evidence checks for F's real prepared-player fixture; no guest control.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const RESIDENT_KIND = "resident-aplay-v1";
export const RESIDENT_BASE_SHA = "5530d6585776cf61fcedb98f7a2e75b4293d5f805809e5107cc181fa5dc62550";
export const RESIDENT_GUEST_PATH = "/usr/libexec/wasm-vm/e5t26f-resident.sh";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

export function residentFixtureRequested(env) {
  const value = env.E5_T26F_FIXTURE;
  assert.ok(value === undefined || value === RESIDENT_KIND, "unknown F fixture; omission preserves the original process-launch fixture");
  if (value === undefined) return false;
  for (const key of ["COMMAND", "KEY_DELAY_MS", "JIT", "RESIDENCY", "GUEST_CLOCK", "CPU", "LATENCY", "ICOUNT_DIVIDER"]) {
    assert.equal(env[`E5_T26F_DIAGNOSTIC_${key}`], undefined, "resident playback requires fixed command/pacing and unprofiled default runtime policies");
  }
  return true;
}

export function assertResidentImage(info, helperSha256) {
  assert.match(helperSha256, /^[0-9a-f]{64}$/u);
  assert.equal(info.fixture?.kind, RESIDENT_KIND, "image does not contain the resident fixture");
  assert.equal(info.fixture.helperSha256, helperSha256, "fixture helper differs from frozen source");
  assert.equal(info.fixture.baseSha256, RESIDENT_BASE_SHA, "fixture base image differs");
  assert.equal(info.fixture.guestPath, RESIDENT_GUEST_PATH, "fixture install path differs");
  return { kind: RESIDENT_KIND, helperSha256, baseSha256: RESIDENT_BASE_SHA, guestPath: RESIDENT_GUEST_PATH };
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
