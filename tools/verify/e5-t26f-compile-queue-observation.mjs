// Closed-record accounting only; neither a timing cause nor an F acceptance verdict.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { discoveryObservation } from "./e5-t26f-discovery-observation.mjs";

export const COMPILE_QUEUE_COUNTERS = Object.freeze([
  "admitted", "droppedBackpressure", "cancelledStale", "popped",
]);
function safe(value, label) {
  assert.ok(Number.isSafeInteger(value) && value >= 0, `unsafe ${label}`);
  return value;
}
function exact(value, label, signed = false) {
  assert.ok(value <= BigInt(Number.MAX_SAFE_INTEGER) &&
    value >= (signed ? -BigInt(Number.MAX_SAFE_INTEGER) : 0n), `impossible/unsafe ${label}`);
  return Number(value);
}
export function validateCompileQueue(state) {
  const q = state?.compileQueue;
  assert.ok(q && typeof q === "object", "actual compile queue counters missing");
  for (const key of [...COMPILE_QUEUE_COUNTERS, "queueDepth", "queueHighWater", "capacity"])
    safe(q[key], `compileQueue.${key}`);
  assert.equal(q.capacity, 256, "unexpected compile queue policy");
  assert.ok(q.queueDepth <= q.queueHighWater && q.queueHighWater <= q.capacity, "compile queue bound violated");
  safe(state.jitSubmittedMembers, "jitSubmittedMembers");
  return q;
}

export function compileQueueObservation(record, exitCode) {
  const base = discoveryObservation(record, exitCode);
  const head = record.milestones.run.binding?.head;
  assert.match(head ?? "", /^[a-f0-9]{40}$/, "missing authenticated head");
  if (Object.hasOwn(record, "head")) assert.equal(record.head, head, "inconsistent record head");
  const before = validateCompileQueue(base.before.state), after = validateCompileQueue(base.after.state);
  assert.ok(after.queueHighWater >= before.queueHighWater, "compile queue high-water regressed");
  const deltas = Object.fromEntries(COMPILE_QUEUE_COUNTERS.map(key =>
    [key, exact(BigInt(after[key]) - BigInt(before[key]), `compileQueue.${key} delta`)]));
  const depthDelta = exact(BigInt(after.queueDepth) - BigInt(before.queueDepth), "depth delta", true);
  const discoveryDepthDelta = base.after.state.discovery.queueDepth - base.before.state.discovery.queueDepth;
  // nominated counts successful FIFO insertion only. Overflow was never added to it;
  // droppedStale is a later install-validation refusal, not a second FIFO consumer.
  const staged = exact(BigInt(base.deltas.nominated) - BigInt(discoveryDepthDelta), "staged");
  const submitted = exact(BigInt(base.after.state.jitSubmittedMembers) -
    BigInt(base.before.state.jitSubmittedMembers), "submitted delta");
  const accounted = BigInt(depthDelta) + BigInt(deltas.droppedBackpressure) +
    BigInt(deltas.cancelledStale) + BigInt(deltas.popped);
  assert.equal(BigInt(staged), accounted, "staging conservation failed; do not infer missing jobs");
  const poppedUnsubmitted = exact(BigInt(deltas.popped) - BigInt(submitted), "popped minus submitted");
  const incomingRejected = exact(BigInt(staged) - BigInt(deltas.admitted), "incoming rejections");
  const residentDisplaced = exact(BigInt(deltas.admitted) - BigInt(depthDelta) -
    BigInt(deltas.cancelledStale) - BigInt(deltas.popped), "resident displacements");
  assert.equal(BigInt(incomingRejected) + BigInt(residentDisplaced), BigInt(deltas.droppedBackpressure));
  return { ...base, schema: "wasm-vm.e5-t26f.compile-queue-observation.v1", head,
    compileQueue: { before, after, deltas, depthDelta },
    accounting: { staged, submitted, pendingDepthDelta: depthDelta,
      droppedBackpressure: deltas.droppedBackpressure, cancelledStale: deltas.cancelledStale,
      popped: deltas.popped, poppedUnsubmitted, incomingRejected, residentDisplaced },
    backpressureObservedLifetime: after.droppedBackpressure > 0,
    limits: "Same-Machine, completed-pump snapshots; same discovery generation, no other FIFO consumer, unsaturated safe counters. Queue counters are lifetime values, not discovery-reset values. Sequential RPC spans are not the exact F interval. Counts are jobs, not unique PCs; poppedUnsubmitted is pre-submission refusal, not compilation failure or a proven timing cause. F remains unverified." };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 5, "usage: compile-queue-observation.mjs RECORD EXIT_CODE NEW_OUTPUT");
  const input = path.resolve(process.argv[2]), output = path.resolve(process.argv[4]);
  assert.notEqual(input, output); assert.ok(["0", "1"].includes(process.argv[3]));
  const bytes = await readFile(input);
  const result = compileQueueObservation(JSON.parse(bytes), Number(process.argv[3]));
  result.record = input; result.recordSha256 = createHash("sha256").update(bytes).digest("hex");
  await writeFile(output, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ elapsedMs: result.elapsedMs, accounting: result.accounting, fVerified: false }));
}
