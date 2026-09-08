// Synthetic statistics exercise refusal/accounting only; no new browser evidence is created.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { DISCOVERY_COUNTERS, validateDiscovery, discoveryObservation } from "./e5-t26f-discovery-observation.mjs";

function fixture() {
  const r = JSON.parse(readFileSync(new URL("../../evidence/e5-t26f/resident-residency-replay-45bff942/1-repack-off/failure-post-restore-interaction-checks.json", import.meta.url)));
  r.unitOnly = true;
  for (const [i, sample] of [r.milestones.jitBefore, r.milestones.jitAfter].entries()) {
    sample.state.decodedCacheEntries = 4096;
    sample.state.discovery = { ...Object.fromEntries(DISCOVERY_COUNTERS.map(k => [k, 10 + i])),
      queueDepth: 2 - i, queueHighWater: 3, candidates: 8 - i, generation: sample.state.discoveryGeneration };
  }
  return r;
}

test("actual counters are mandatory safe integers, with bounded gauges and consistent generation", () => {
  const good = fixture().milestones.jitBefore.state;
  validateDiscovery(good);
  for (const key of [...DISCOVERY_COUNTERS, "queueDepth", "queueHighWater", "candidates", "generation"]) {
    for (const value of [undefined, null, "1", -1, .5, NaN, Infinity, 2 ** 53]) {
      const bad = structuredClone(good); bad.discovery[key] = value;
      assert.throws(() => validateDiscovery(bad));
    }
  }
  for (const patch of [{ queueDepth: 4 }, { queueHighWater: 4097 }, { candidates: 65537 }, { generation: 999 }]) {
    const bad = structuredClone(good); Object.assign(bad.discovery, patch); assert.throws(() => validateDiscovery(bad));
  }
});

test("collector subtracts counters, retains gauges/endpoints and does not erase earlier drops", () => {
  const r = fixture(), unchanged = structuredClone(r), out = discoveryObservation(r, 1);
  assert.deepEqual(out.deltas, Object.fromEntries(DISCOVERY_COUNTERS.map(k => [k, 1])));
  assert.equal(out.after.state.discovery.queueDepth, 1); assert.equal(out.before.state.discovery.queueDepth, 2);
  assert.equal(out.fTimingPassed, false); assert.equal(out.fVerified, false);
  assert.deepEqual(r, unchanged);
  for (const k of ["droppedOverflow", "countsDropped"]) r.milestones.jitAfter.state.discovery[k] = 10;
  const lifetime = discoveryObservation(r, 1);
  assert.equal(lifetime.deltas.droppedOverflow, 0); assert.equal(lifetime.overflowObservedSinceReset, true);
  assert.equal(lifetime.deltas.countsDropped, 0); assert.equal(lifetime.counterExhaustionObservedSinceReset, true);
  for (const sample of [r.milestones.jitBefore, r.milestones.jitAfter]) {
    sample.state.discovery.droppedOverflow = sample.state.discovery.countsDropped = 0;
  }
  assert.equal(discoveryObservation(r, 1).overflowObservedSinceReset, false);
});

test("mixed policies, non-cap failures, moved endpoints, changed generations and regressed counters refuse", () => {
  for (const mutate of [
    r => { r.error.message = "audio failed"; }, r => { r.milestones.run.acceptance = true; },
    r => { r.milestones.run.diagnostic.decodedCacheEntries = 4096; },
    r => { r.milestones.run.diagnostic.complete = true; },
    r => { r.milestones.run.diagnostic.guestProfile = true; },
    r => { r.milestones.run.diagnostic.command = "play"; },
    r => { r.milestones.run.postRestoreKeyDelayMs = 0; },
    r => { r.milestones.jitAfter.state.jitResidencyPolicy = "cap-256"; },
    r => { r.milestones.jitAfter.state.decodedCacheEntries = 16384; },
    r => { r.milestones.jitAfter.state.entryCost.timingEnabled = true; },
    r => { r.milestones.jitAfter.state.discoveryGeneration++; r.milestones.jitAfter.state.discovery.generation++; },
    r => { r.milestones.postRestoreStart++; },
    r => { r.milestones.jitBefore.requestedAt = 0; },
    r => { r.milestones.jitAfter.requestedAt = r.milestones.postRestoreEnd - 1; },
    ...DISCOVERY_COUNTERS.map(k => r => { r.milestones.jitAfter.state.discovery[k] = 0; }),
  ]) { const bad = fixture(); mutate(bad); assert.throws(() => discoveryObservation(bad, 1)); }
  for (const code of [0, 2, null, "1"]) assert.throws(() => discoveryObservation(fixture(), code));
});
