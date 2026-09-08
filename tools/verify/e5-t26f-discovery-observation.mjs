// Read existing counters from a closed proper-runner record; never an F acceptance verdict.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DISCOVERY_COUNTERS = Object.freeze([
  "nominated", "deduped", "droppedStale", "droppedOverflow", "countsDropped", "excluded",
]);
export function validateDiscovery(state) {
  const d = state?.discovery;
  assert.ok(d && typeof d === "object", "actual discovery counters missing");
  for (const key of [...DISCOVERY_COUNTERS, "queueDepth", "queueHighWater", "candidates", "generation"]) {
    assert.ok(Number.isSafeInteger(d[key]) && d[key] >= 0, `unsafe discovery ${key}`);
  }
  assert.equal(d.generation, state.discoveryGeneration, "inconsistent actual generation");
  assert.ok(d.queueDepth <= d.queueHighWater && d.queueHighWater <= 4096, "queue bound violated");
  assert.ok(d.candidates <= 65536, "counter-map bound violated");
  assert.equal(state.hasExecutor, true);
  assert.equal(state.decodedCacheEntries, 4096);
  assert.equal(state.jitResidencyPolicy, "repack-off");
  assert.equal(state.jitResidencyCap, 24);
  assert.equal(state.entryCost?.timingEnabled, false);
  return d;
}

export function discoveryObservation(record, exitCode) {
  const m = record.milestones, run = m.run, d = run.diagnostic;
  assert.equal(run.acceptance, false);
  assert.equal(run.fixture?.kind, "resident-aplay-v1");
  assert.equal(run.postRestoreCommand, "play"); assert.equal(run.postRestoreKeyDelayMs, 5);
  assert.equal(d.mode, "reuse"); assert.equal(d.jit, "1"); assert.equal(d.residency, "repack-off");
  for (const key of ["command", "guestClock", "icountDivider"]) assert.equal(d[key], null);
  for (const key of ["cpu", "latency", "complete"]) assert.equal(d[key], false);
  assert.equal(d.keyDelayMs, 0); assert.equal(d.guestProfile, undefined); assert.equal(d.decodedCacheEntries, undefined);
  const before = m.jitBefore, after = m.jitAfter;
  for (const sample of [before, after]) {
    assert.ok(Number.isFinite(sample?.requestedAt) && Number.isFinite(sample.receivedAt) && sample.receivedAt >= sample.requestedAt);
    validateDiscovery(sample.state);
  }
  assert.equal(before.state.discovery.generation, after.state.discovery.generation,
    "generation changed; retain raw counters but do not subtract across invalidation/reset");
  const start = m.postRestoreStart, end = m.postRestoreEnd;
  assert.equal(start, m.normalRestore.result.completedAt);
  assert.ok(Number.isFinite(start) && Number.isFinite(end) && end > start);
  assert.ok(before.requestedAt >= start && before.receivedAt < end && after.requestedAt >= end);
  for (const key of ["guestRetired", "retiredViaJit"]) {
    assert.ok(Number.isSafeInteger(before.state[key]) && before.state[key] >= 0 &&
      Number.isSafeInteger(after.state[key]) && after.state[key] > before.state[key], `missing ${key} progress`);
  }
  const elapsedMs = end - start;
  if (exitCode === 1) {
    assert.equal(record.error?.name, "AssertionError"); assert.equal(record.error.code, "ERR_ASSERTION");
    assert.equal(record.error.message, "post-restore interaction exceeded 2 seconds"); assert.ok(elapsedMs > 2000);
  } else {
    assert.equal(exitCode, 0); assert.equal(record.error, undefined); assert.ok(elapsedMs <= 2000);
    assert.equal(m.normalRestore.checksPassed, true);
  }
  const deltas = {};
  for (const key of DISCOVERY_COUNTERS) {
    deltas[key] = after.state.discovery[key] - before.state.discovery[key];
    assert.ok(deltas[key] >= 0, `discovery ${key} regressed`);
  }
  return { schema: "wasm-vm.e5-t26f.discovery-observation.v1", head: record.head,
    acceptance: false, fVerified: false, fTimingPassed: elapsedMs <= 2000, elapsedMs,
    binding: run.binding, profileSha256: run.profileSha256, snapshotSha256: m.normalSnapshot.sha256,
    before, after, deltas,
    // Lifetime values matter: zero interval delta must not hide an earlier recorded drop.
    overflowObservedSinceReset: after.state.discovery.droppedOverflow > 0,
    counterExhaustionObservedSinceReset: after.state.discovery.countsDropped > 0,
    limits: "Read-only aggregate counters, not per-PC compiled membership or causal host-time attribution. Sequential RPC spans are not the exact F interaction interval." };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 5, "usage: discovery-observation.mjs RECORD EXIT_CODE NEW_OUTPUT");
  const input = path.resolve(process.argv[2]), output = path.resolve(process.argv[4]);
  assert.notEqual(input, output); assert.ok(["0", "1"].includes(process.argv[3]));
  const bytes = await readFile(input);
  const result = discoveryObservation(JSON.parse(bytes), Number(process.argv[3]));
  result.record = input; result.recordSha256 = createHash("sha256").update(bytes).digest("hex");
  await writeFile(output, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ elapsedMs: result.elapsedMs, deltas: result.deltas,
    overflowObservedSinceReset: result.overflowObservedSinceReset,
    counterExhaustionObservedSinceReset: result.counterExhaustionObservedSinceReset }));
}
