// Synthetic statistics exercise refusal/accounting only; no new browser evidence is created.
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

test("unitOnly successful-cap branch keeps nonacceptance and requires completion within its bound", () => {
  for (const elapsedMs of [1, 1999.5, 2000]) {
    const r = fixture();
    assert.equal(r.unitOnly, true);
    const m = r.milestones, start = m.postRestoreStart;
    m.postRestoreEnd = start + elapsedMs;
    m.jitBefore.requestedAt = start;
    m.jitBefore.receivedAt = start + 0.5;
    m.jitAfter.requestedAt = m.postRestoreEnd;
    m.jitAfter.receivedAt = m.postRestoreEnd + 1;
    m.normalRestore.checksPassed = true;
    delete r.error;
    const unchanged = structuredClone(r), out = discoveryObservation(r, 0);
    assert.equal(out.fTimingPassed, true);
    assert.equal(out.elapsedMs, elapsedMs);
    assert.equal(out.acceptance, false);
    assert.equal(out.fVerified, false);
    assert.deepEqual(r, unchanged);
    for (const mutate of [
      bad => { bad.milestones.normalRestore.checksPassed = false; },
      bad => { delete bad.milestones.normalRestore.checksPassed; },
      bad => { bad.error = { name: "AssertionError" }; },
      bad => {
        bad.milestones.postRestoreEnd = start + 2001;
        bad.milestones.jitAfter.requestedAt = start + 2001;
        bad.milestones.jitAfter.receivedAt = start + 2002;
      },
    ]) {
      const bad = structuredClone(r); mutate(bad);
      assert.throws(() => discoveryObservation(bad, 0));
    }
  }
});

function cliFixture(t, record = fixture()) {
  assert.equal(record.unitOnly, true, "CLI data is synthetic, not desktop performance evidence");
  const directory = mkdtempSync(path.join(tmpdir(), "e5-t26f-discovery-unit-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const input = path.join(directory, "unitOnly-input.json");
  const output = path.join(directory, "unitOnly-output.json");
  const bytes = Buffer.from(JSON.stringify(record, null, 2) + "\n\n");
  writeFileSync(input, bytes, { flag: "wx" });
  const helper = fileURLToPath(new URL("./e5-t26f-discovery-observation.mjs", import.meta.url));
  const sourceBytes = readFileSync(helper);
  return { input, output, bytes, run(destination = output) {
    const result = spawnSync(process.execPath, [helper, input, "1", destination], {
      encoding: "utf8", timeout: 10_000, maxBuffer: 1024 * 1024,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.deepEqual(readFileSync(input), bytes, "CLI modified input bytes");
    assert.deepEqual(readFileSync(helper), sourceBytes, "CLI modified helper source");
    return result;
  } };
}

test("CLI writes a new output bound to the exact unitOnly input bytes", t => {
  const f = cliFixture(t), result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const out = JSON.parse(readFileSync(f.output, "utf8"));
  assert.equal(out.record, f.input);
  assert.equal(out.recordSha256, createHash("sha256").update(f.bytes).digest("hex"));
  assert.equal(out.acceptance, false);
  assert.equal(out.fVerified, false);
  assert.equal(out.fTimingPassed, false);
  const printed = JSON.parse(result.stdout);
  assert.equal(printed.elapsedMs, out.elapsedMs);
  assert.deepEqual(printed.deltas, out.deltas);
});

test("CLI refuses existing output and input=output without overwriting either", t => {
  const f = cliFixture(t), protectedBytes = Buffer.from("unrelated output must survive\n");
  writeFileSync(f.output, protectedBytes, { flag: "wx" });
  const existing = f.run();
  assert.equal(existing.status, 1);
  assert.match(existing.stderr, /EEXIST/);
  assert.equal(existing.stdout, "");
  assert.deepEqual(readFileSync(f.output), protectedBytes);
  const same = f.run(f.input);
  assert.equal(same.status, 1);
  assert.match(same.stderr, /AssertionError/);
  assert.equal(same.stdout, "");
  assert.deepEqual(readFileSync(f.output), protectedBytes);
});

test("CLI refuses a non-cap failure before creating output", t => {
  const r = fixture(); r.error.message = "audio failed";
  const f = cliFixture(t, r), result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /AssertionError/);
  assert.equal(result.stdout, "");
  assert.equal(existsSync(f.output), false);
});
