// Synthetic refusal/accounting fixtures plus an unchanged closed-record regression;
// none of these tests creates new browser evidence.
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

const observerRecordPath = fileURLToPath(new URL("../../evidence/e5-t26f/single-process-observer-05b82bc6/reuse/failure-post-restore-interaction-checks.json", import.meta.url));
const observerRecordSha256 = "0881a4aa55808bd0884b5a6ef2f05af4da9601b119e188390cef94b4c667002a";
function observerRecord() {
  const bytes = readFileSync(observerRecordPath);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), observerRecordSha256);
  return JSON.parse(bytes);
}

test("unchanged closed observer record retains actual provenance, counters and failed timing", () => {
  const r = observerRecord(), unchanged = structuredClone(r), out = discoveryObservation(r, 1);
  assert.equal(r.unitOnly, undefined);
  assert.equal(out.head, "05b82bc688a34e6a1abef7b6c761c01bf4a3f7c6");
  assert.equal(out.binding.fixture.kind, "resident-observer-v1");
  assert.deepEqual(out.binding, r.milestones.run.binding);
  assert.deepEqual(out.deltas, { nominated: 2707, deduped: 3394545,
    droppedStale: 0, droppedOverflow: 0, countsDropped: 0, excluded: 9 });
  assert.deepEqual(out.before, r.milestones.jitBefore);
  assert.deepEqual(out.after, r.milestones.jitAfter);
  assert.equal(out.elapsedMs, 4362.199999928474);
  assert.equal(out.fTimingPassed, false); assert.equal(out.acceptance, false); assert.equal(out.fVerified, false);
  assert.deepEqual(r, unchanged);
  assert.throws(() => discoveryObservation(r, 0));
  const nonCap = structuredClone(r); nonCap.error.message = "observer identity failed";
  assert.throws(() => discoveryObservation(nonCap, 1));
});

test("observer requires coherent run/binding pins and an explicit supported fixture kind", () => {
  for (const value of [undefined, null, "", "resident-observer-v2", "RESIDENT-OBSERVER-V1", "resident-observer-v1 ", 1]) {
    const r = observerRecord(); r.milestones.run.fixture.kind = value;
    assert.throws(() => discoveryObservation(r, 1), /unsupported observation fixture/);
  }
  for (const mutate of [
    run => { delete run.fixture; }, run => { delete run.binding; },
    run => { delete run.binding.fixture; },
    run => { run.binding.fixture.kind = "resident-aplay-v1"; },
    run => { run.binding.fixture.helperSha256 = "a".repeat(64); },
    ...["sourceSha256", "sha256", "buildInfoSha256", "readbackSha256"].map(key =>
      run => { run.binding.fixture.observer[key] = "a".repeat(64); }),
    run => { run.binding.fixture.observer.binaryPath = "target/e5-t26f/other/e5t26f-observe"; },
    run => { run.binding.fixture.observer.buildInfoPath = "target/e5-t26f/other/build-info.json"; },
  ]) {
    const r = observerRecord(); mutate(r.milestones.run);
    assert.throws(() => discoveryObservation(r, 1));
  }
});

test("matching copies still refuse missing or malformed observer provenance and unequal readback", () => {
  const refuse = mutate => {
    const r = observerRecord(); mutate(r.milestones.run.fixture);
    r.milestones.run.binding.fixture = structuredClone(r.milestones.run.fixture);
    assert.throws(() => discoveryObservation(r, 1));
  };
  for (const value of [undefined, null, "", "a".repeat(63), "G".repeat(64), "a".repeat(64) + "\n", 123]) {
    refuse(f => { f.helperSha256 = value; });
    for (const key of ["sourceSha256", "sha256", "buildInfoSha256", "readbackSha256"]) {
      refuse(f => { f.observer[key] = value; });
    }
  }
  for (const mutate of [
    f => { delete f.observer; }, f => { delete f.baseSha256; },
    f => { f.baseSha256 = "a".repeat(64); }, f => { delete f.guestPath; },
    f => { f.guestPath = "/tmp/resident.sh"; }, f => { f.helperPath = "tools/guest/other.sh"; },
    f => { delete f.observer.sourcePath; }, f => { f.observer.sourcePath = "tools/guest/other.c"; },
    f => { delete f.observer.guestPath; }, f => { f.observer.guestPath = "/tmp/observe"; },
    f => { delete f.observer.mode; }, f => { f.observer.mode = "0755"; },
    f => { f.observer.readbackSha256 = "a".repeat(64); },
    ...[undefined, null, "30960", 0, -1, .5, NaN, Infinity, 2 ** 53].map(value => f => { f.observer.size = value; }),
  ]) refuse(mutate);
  for (const [key, filename] of [["binaryPath", "e5t26f-observe"], ["buildInfoPath", "build-info.json"]]) {
    for (const value of [undefined, null, "", 1, `/tmp/${filename}`, `target/e5-t26f/../${filename}`,
      `target/e5-t26f//${filename}`, `target/e5-t26f/./${filename}`, `target/e5-t26f/other/${filename}`,
      `target/e5-t26f/bad\\name/${filename}`, `target/e5-t26f/bad\nname/${filename}`]) {
      refuse(f => { f.observer[key] = value; });
    }
  }
});

test("CLI postprocesses the original observer record bytes without rewriting fixture or evidence", t => {
  const bytes = readFileSync(observerRecordPath);
  observerRecord(); // Pin the actual closed input before invoking the real CLI.
  const directory = mkdtempSync(path.join(tmpdir(), "e5-t26f-observer-collector-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const output = path.join(directory, "summary.json");
  const helper = fileURLToPath(new URL("./e5-t26f-discovery-observation.mjs", import.meta.url));
  const sourceBytes = readFileSync(helper);
  const result = spawnSync(process.execPath, [helper, observerRecordPath, "1", output],
    { encoding: "utf8", timeout: 10_000, maxBuffer: 1024 * 1024 });
  assert.equal(result.error, undefined); assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
  const out = JSON.parse(readFileSync(output));
  assert.equal(out.record, observerRecordPath); assert.equal(out.recordSha256, observerRecordSha256);
  assert.deepEqual(out.binding, observerRecord().milestones.run.binding);
  assert.equal(out.elapsedMs, 4362.199999928474);
  assert.equal(out.fTimingPassed, false); assert.equal(out.acceptance, false); assert.equal(out.fVerified, false);
  assert.deepEqual(readFileSync(observerRecordPath), bytes);
  assert.deepEqual(readFileSync(helper), sourceBytes);
});

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
