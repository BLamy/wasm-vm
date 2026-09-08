// All numbers/records here are synthetic unit fixtures, never browser evidence.
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COMPILE_QUEUE_COUNTERS, validateCompileQueue, compileQueueObservation } from "./e5-t26f-compile-queue-observation.mjs";

function fixture() {
  const head = "a".repeat(40);
  const state = i => ({ hasExecutor: true, decodedCacheEntries: 4096,
    jitResidencyPolicy: "repack-off", jitResidencyCap: 24, entryCost: { timingEnabled: false },
    discoveryGeneration: 5, guestRetired: 10 + i, retiredViaJit: 5 + i, jitSubmittedMembers: 40 + 7 * i,
    discovery: { generation: 5, nominated: 100 + 30 * i, deduped: 10 + i, droppedStale: 2 + i,
      droppedOverflow: 1 + i, countsDropped: 0, excluded: 0, queueDepth: 2 + 2 * i,
      queueHighWater: 4, candidates: 50 },
    compileQueue: { admitted: 80 + 20 * i, droppedBackpressure: 20 + 16 * i,
      cancelledStale: 2, popped: 50 + 8 * i, queueDepth: 10 + 4 * i, queueHighWater: 32, capacity: 256 } });
  return { unitOnly: true, head, error: { name: "AssertionError", code: "ERR_ASSERTION",
    message: "post-restore interaction exceeded 2 seconds" }, milestones: {
    run: { acceptance: false, fixture: { kind: "resident-aplay-v1" }, postRestoreCommand: "play",
      postRestoreKeyDelayMs: 5, binding: { head }, diagnostic: { mode: "reuse", jit: "1", residency: "repack-off",
        command: null, guestClock: null, icountDivider: null, cpu: false, latency: false, complete: false, keyDelayMs: 0 } },
    jitBefore: { requestedAt: 101, receivedAt: 102, state: state(0) },
    jitAfter: { requestedAt: 4200, receivedAt: 4201, state: state(1) },
    normalRestore: { result: { completedAt: 100 } }, normalSnapshot: { sha256: "unitOnly" },
    postRestoreStart: 100, postRestoreEnd: 4200,
  } };
}

test("coherent exact accounting splits both backpressure cases without subtracting discovery refusals", () => {
  const r = fixture(), original = structuredClone(r), out = compileQueueObservation(r, 1);
  assert.deepEqual(out.accounting, { staged: 28, submitted: 7, pendingDepthDelta: 4,
    droppedBackpressure: 16, cancelledStale: 0, popped: 8, poppedUnsubmitted: 1,
    incomingRejected: 8, residentDisplaced: 8 });
  assert.equal(out.fVerified, false); assert.equal(out.acceptance, false);
  assert.equal(out.fTimingPassed, false); assert.equal(out.backpressureObservedLifetime, true);
  assert.deepEqual(r, original);
});

test("negative resident-depth delta and lifetime drops with zero interval drops remain valid", () => {
  const drain = fixture(); drain.milestones.jitAfter.state.compileQueue.queueDepth = 7;
  drain.milestones.jitAfter.state.discovery.nominated = 123;
  const out = compileQueueObservation(drain, 1);
  assert.equal(out.accounting.pendingDepthDelta, -3);
  assert.equal(out.accounting.staged, 21); assert.equal(out.accounting.residentDisplaced, 15);
  const zero = fixture(), a = zero.milestones.jitAfter.state;
  a.compileQueue.droppedBackpressure = 20; a.compileQueue.admitted = 92;
  a.discovery.nominated = 114;
  const z = compileQueueObservation(zero, 1);
  assert.equal(z.accounting.droppedBackpressure, 0); assert.equal(z.backpressureObservedLifetime, true);
  assert.equal(z.accounting.incomingRejected, 0); assert.equal(z.accounting.residentDisplaced, 0);
});

test("missing, unsafe and out-of-bound actual queue fields refuse", () => {
  for (const key of [...COMPILE_QUEUE_COUNTERS, "queueDepth", "queueHighWater", "capacity"]) {
    for (const value of [undefined, null, "1", -1, .5, NaN, Infinity, 2 ** 53]) {
      const s = fixture().milestones.jitBefore.state; s.compileQueue[key] = value;
      assert.throws(() => validateCompileQueue(s));
    }
  }
  for (const patch of [{ capacity: 1024 }, { queueDepth: 33 }, { queueHighWater: 257 }]) {
    const s = fixture().milestones.jitBefore.state; Object.assign(s.compileQueue, patch);
    assert.throws(() => validateCompileQueue(s));
  }
  const s = fixture().milestones.jitBefore.state; delete s.compileQueue;
  assert.throws(() => validateCompileQueue(s));
});

test("impossible residuals, regressions, unsafe intermediate totals and mixed head/policy refuse", () => {
  for (const mutate of [
    ...COMPILE_QUEUE_COUNTERS.map(k => r => { r.milestones.jitAfter.state.compileQueue[k] = 0; }),
    r => { r.milestones.jitAfter.state.compileQueue.queueHighWater = 31; },
    r => { r.milestones.jitAfter.state.discovery.nominated++; },
    r => { r.milestones.jitAfter.state.compileQueue.admitted = 109; },
    r => { r.milestones.jitAfter.state.compileQueue.admitted = 91; },
    r => { r.milestones.jitAfter.state.jitSubmittedMembers = 49; },
    r => { r.milestones.jitAfter.state.jitSubmittedMembers = 39; },
    r => { r.milestones.jitAfter.state.jitSubmittedMembers = 2 ** 53; },
    r => { r.milestones.jitAfter.state.compileQueue.droppedBackpressure = Number.MAX_SAFE_INTEGER; },
    r => { r.milestones.jitAfter.state.discovery.generation++; r.milestones.jitAfter.state.discoveryGeneration++; },
    r => { r.milestones.run.binding.head = "b".repeat(40); },
    r => { delete r.milestones.run.binding; },
    r => { r.error.message = "other failure"; },
    r => { r.milestones.jitAfter.state.decodedCacheEntries = 16384; },
    r => { r.milestones.run.diagnostic.latency = true; },
    r => { r.milestones.postRestoreStart++; },
  ]) { const r = fixture(); mutate(r); assert.throws(() => compileQueueObservation(r, 1)); }
});

test("actual success producer shape uses only its nested head and never verifies F", () => {
  const r = fixture(); delete r.head; delete r.error;
  r.milestones.postRestoreEnd = 2100; r.milestones.normalRestore.checksPassed = true;
  const out = compileQueueObservation(r, 0);
  assert.equal(out.head, "a".repeat(40)); assert.equal(out.elapsedMs, 2000);
  assert.equal(out.fTimingPassed, true); assert.equal(out.fVerified, false);
  r.milestones.postRestoreEnd++;
  assert.throws(() => compileQueueObservation(r, 0));
});

test("CLI binds original bytes, preserves inputs/outputs and refuses bad accounting before output", t => {
  const dir = mkdtempSync(path.join(tmpdir(), "e5-t26f-compile-queue-unit-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const input = path.join(dir, "unitOnly-input.json"), output = path.join(dir, "unitOnly-output.json");
  const bytes = Buffer.from(JSON.stringify(fixture()) + "\n\n"); writeFileSync(input, bytes, { flag: "wx" });
  const helper = fileURLToPath(new URL("./e5-t26f-compile-queue-observation.mjs", import.meta.url));
  const run = (destination = output, source = input) => spawnSync(process.execPath, [helper, source, "1", destination],
    { encoding: "utf8", timeout: 10000 });
  const ok = run(); assert.equal(ok.status, 0, ok.stderr);
  const outputBytes = readFileSync(output), out = JSON.parse(outputBytes);
  assert.equal(out.recordSha256, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(out.record, input); assert.equal(out.fVerified, false);
  assert.equal(run().status, 1); assert.equal(run(input).status, 1);
  assert.deepEqual(readFileSync(input), bytes); assert.deepEqual(readFileSync(output), outputBytes);
  const bad = fixture(); bad.milestones.jitAfter.state.compileQueue.popped++;
  const badInput = path.join(dir, "unitOnly-bad.json"), absent = path.join(dir, "absent.json");
  writeFileSync(badInput, JSON.stringify(bad), { flag: "wx" });
  assert.equal(run(absent, badInput).status, 1); assert.equal(existsSync(absent), false);
});
