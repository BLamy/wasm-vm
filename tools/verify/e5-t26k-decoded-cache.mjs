// Bounded observation/collection for K, never an F acceptance or default-policy decision.
import assert from "node:assert/strict";

export function decodedCacheRequested(env) {
  const value = env.E5_T26F_DIAGNOSTIC_DECODED_CACHE_ENTRIES;
  if (value === undefined) return undefined;
  assert.equal(env.E5_T26F_FIXTURE, "resident-aplay-v1", "decoded-cache comparison requires the resident fixture");
  assert.equal(env.E5_T26F_DIAGNOSTIC, "reuse", "decoded-cache comparison requires diagnostic reuse");
  assert.ok(value === "4096" || value === "16384", "decoded-cache entries must be exactly 4096 or 16384");
  for (const key of ["COMPLETE", "CPU", "LATENCY", "GUEST_PROFILE", "GUEST_CLOCK", "ICOUNT_DIVIDER",
    "COMMAND", "KEY_DELAY_MS", "JIT", "RESIDENCY"]) {
    assert.equal(env[`E5_T26F_DIAGNOSTIC_${key}`], undefined, "decoded-cache comparison must be isolated with unchanged runtime policies and input");
  }
  return Number(value);
}

export const DECODED_COUNTERS = Object.freeze(["guestRetired", "retiredViaJit", "blockEntryHits", "blockBuilds",
  "jitCacheInstalls", "jitCacheRetranslations", "jitCacheEvictions", "decodedCacheFlushes", "decodedBlocksDiscarded"]);

export function validateDecodedCacheSample(sample, entries) {
  assert.ok(entries === 4096 || entries === 16384);
  assert.ok(Number.isFinite(sample?.requestedAt) && Number.isFinite(sample.receivedAt) && sample.receivedAt >= sample.requestedAt);
  const { jit, clock } = sample;
  assert.equal(jit?.decodedCacheEntries, entries, "requested decoded capacity did not reach the actual worker");
  assert.equal(jit.hasExecutor, true);
  assert.equal(jit.jitResidencyPolicy, "repack-off"); assert.equal(jit.jitResidencyCap, 24);
  assert.equal(jit.jitRegionChaining, true); assert.equal(jit.jitDynamicChaining, true);
  assert.equal(jit.entryCost?.timingEnabled, false, "comparison must be unprofiled");
  for (const key of DECODED_COUNTERS) assert.ok(Number.isSafeInteger(jit[key]) && jit[key] >= 0, `invalid ${key}`);
  assert.equal(clock?.mode, "icount"); assert.equal(clock.clockDiv, 10); assert.equal(clock.timebaseHz, 10_000_000);
  assert.match(clock.mtime, /^(?:0|[1-9][0-9]*)$/u);
  assert.ok(BigInt(clock.mtime) <= 0xffff_ffff_ffff_ffffn);
}

export function decodedCacheDeltas(before, after, entries, start, end) {
  validateDecodedCacheSample(before, entries); validateDecodedCacheSample(after, entries);
  assert.ok(Number.isFinite(start) && Number.isFinite(end) && end > start);
  assert.ok(before.requestedAt >= start && after.requestedAt >= end && after.requestedAt > before.receivedAt,
    "decoded-cache observers cannot replace or move original restore/end boundaries");
  assert.ok(BigInt(after.clock.mtime) >= BigInt(before.clock.mtime), "guest time regressed");
  const deltas = {};
  for (const key of DECODED_COUNTERS) {
    deltas[key] = after.jit[key] - before.jit[key];
    assert.ok(deltas[key] >= 0, `${key} regressed`);
  }
  assert.ok(deltas.guestRetired > 0 && deltas.retiredViaJit > 0, "actual guest/JIT progress required");
  return deltas;
}

export async function recordDecodedCache(page, milestones, key, entries) {
  assert.ok(key === "decodedCacheBefore" || key === "decodedCacheAfter");
  try {
    milestones[key] = await page.evaluate(async () => {
      const requestedAt = performance.now(), controller = window.__desktopController;
      if (typeof controller?.jitStats !== "function" || typeof controller?.guestClockState !== "function") {
        throw new Error("actual worker cache/clock observations unavailable");
      }
      // Sequential raw RPCs, not atomic or an exact timed-work interval.
      const jit = await controller.jitStats(), clock = await controller.guestClockState();
      return { requestedAt, receivedAt: performance.now(), jit, clock };
    });
    validateDecodedCacheSample(milestones[key], entries);
    if (key === "decodedCacheAfter") {
      milestones.decodedCacheDeltas = decodedCacheDeltas(milestones.decodedCacheBefore, milestones[key], entries,
        milestones.postRestoreStart, milestones.postRestoreEnd);
    }
  } catch (error) {
    // Keep any raw endpoint that arrived before an assertion rejected it.
    milestones.decodedCacheError = { key, message: String(error?.message || error).slice(0, 500) };
    throw error;
  }
}

export function collectDecodedCacheRecord(record, exitCode, entries) {
  const m = record.milestones, d = m.run.diagnostic;
  assert.equal(m.run.acceptance, false); assert.equal(d.mode, "reuse");
  assert.equal(d.decodedCacheEntries, entries);
  assert.equal(m.run.fixture?.kind, "resident-aplay-v1");
  assert.equal(m.run.postRestoreCommand, "play"); assert.equal(m.run.postRestoreKeyDelayMs, 5);
  for (const key of ["jit", "residency", "guestClock", "icountDivider", "command"]) assert.equal(d[key], null);
  for (const key of ["cpu", "latency", "complete"]) assert.equal(d[key], false);
  assert.equal(d.guestProfile, undefined); assert.equal(d.keyDelayMs, 0);
  const restore = m.normalRestore.result;
  assert.equal(m.normalRestore.displayChecksPassed, true); assert.equal(restore.resume.restored, true);
  assert.equal(restore.bootStates.some(({ state }) => state === "booting"), false);
  assert.equal(restore.snapshotSha256, m.normalSnapshot.sha256);
  assert.match(m.normalSnapshot.preFrontBufferCrc, /^[0-9a-f]{8}$/u);
  assert.equal(restore.observation.firstPresent.crc32, m.normalSnapshot.preFrontBufferCrc);
  assert.equal(m.postRestoreAplay.accepted, true); assert.equal(m.postRestoreAplay.command, "play");
  assert.equal(m.postRestoreAplay.keyboardFrames, 10); assert.equal(m.postRestoreAplay.domEvents, 10);
  assert.equal(m.postRestoreAplay.inputSequenceMatch, true); assert.equal(m.postRestoreAplay.terminalMarkerSeen, true);
  assert.equal(m.postRestoreAplay.redMarkerSeen, false); assert.ok(m.postRestoreAplay.visualDiffPixels >= 2000);
  const audio = m.postRestoreAudioAfter, completion = m.postRestorePcmAtCompletion;
  assert.equal(audio.guestAttached, true); assert.equal(audio.policy, "unlocked"); assert.equal(audio.context, "running");
  assert.deepEqual(audio.pcm, completion.pcm);
  for (const key of ["writtenFrames", "inspectedFrames", "nonSilentFrames"]) {
    assert.ok(Number.isSafeInteger(audio.pcm[key]) && audio.pcm[key] > 0);
  }
  assert.ok(Number.isFinite(audio.pcm.maxAbs) && audio.pcm.maxAbs > 0 && audio.pcm.maxAbs <= 1);
  assert.ok(completion.observedAt >= m.postRestoreStart && completion.observedAt <= m.postRestoreEnd);
  assert.deepEqual(m.decodedCacheErrors, { browser: [], http: [] });
  assert.equal(m.decodedCacheError, undefined);
  assert.equal(m.postRestoreStart, restore.completedAt);
  const deltas = decodedCacheDeltas(m.decodedCacheBefore, m.decodedCacheAfter, entries, m.postRestoreStart, m.postRestoreEnd);
  assert.deepEqual(m.decodedCacheDeltas, deltas);
  const elapsedMs = m.postRestoreEnd - m.postRestoreStart;
  if (exitCode === 1) {
    assert.equal(record.error?.name, "AssertionError"); assert.equal(record.error.code, "ERR_ASSERTION");
    assert.equal(record.error.message, "post-restore interaction exceeded 2 seconds"); assert.ok(elapsedMs > 2000);
  } else {
    assert.equal(exitCode, 0); assert.ok(elapsedMs <= 2000); assert.equal(m.normalRestore.checksPassed, true);
  }
  return { entries, elapsedMs, deltas, before: m.decodedCacheBefore, after: m.decodedCacheAfter,
    binding: m.run.binding, profileSha256: m.run.profileSha256, snapshotSha256: m.normalSnapshot.sha256,
    residentCheckpoint: m.residentCheckpoint, fTimingPassed: elapsedMs <= 2000, fVerified: false };
}
