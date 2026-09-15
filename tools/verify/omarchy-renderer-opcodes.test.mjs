import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validatePair, diagnosticSnapshot, recountProfile, recordProcess } from "./omarchy-renderer-opcodes.mjs";

// Explicit synthetic schema fixture. main() separately enforces immutable actual R3 file digests.
function pair() {
  const manifest = Buffer.from(JSON.stringify({ version: 1, image_len: 4294967296, chunk_size: 262144,
    layout: "split", chunks: Array(16384).fill("a".repeat(64)) }));
  const base = createHash("sha256").update(manifest).digest();
  const snapshot = Buffer.alloc(512, 0x5a); snapshot.write("WVMRESU1"); snapshot.writeUInt32LE(1, 8);
  snapshot.fill(0, 12, 44); snapshot.write("0.0.1", 12); base.copy(snapshot, 44); snapshot.writeBigUInt64LE(0n, 76);
  const delta = Buffer.alloc(61 + 2 * 4104); delta.write("WVOD1"); delta.writeUInt32LE(4096, 5);
  delta.writeBigUInt64LE(4294967296n, 9); base.copy(delta, 17); delta.writeUInt32LE(2, 57);
  delta.writeBigUInt64LE(0n, 61); delta.writeBigUInt64LE(1n, 61 + 4104);
  return { snapshot, delta, manifest };
}

test("pair binding rejects wrong identities and malformed, duplicate or out-of-range records", () => {
  const good = pair(); assert.equal(validatePair(good.snapshot, good.delta, good.manifest).blocks, 2);
  for (const mutate of [
    p => { p.snapshot[12] ^= 1; }, p => { p.snapshot[44] ^= 1; },
    p => { p.snapshot.writeBigUInt64LE(1n, 76); }, p => { p.delta[17] ^= 1; },
    p => { p.delta.writeBigUInt64LE(1n, 49); }, p => { p.delta.writeUInt32LE(3, 57); },
    p => { p.delta.writeBigUInt64LE(0n, 61 + 4104); },
    p => { p.delta.writeBigUInt64LE(1048576n, 61 + 4104); },
    p => { p.delta = p.delta.subarray(0, 60); },
  ]) {
    const bad = pair(); mutate(bad); assert.throws(() => validatePair(bad.snapshot, bad.delta, bad.manifest));
  }
});

test("diagnostic adaptation changes only the explicitly waived 64 identity bytes", () => {
  const { snapshot } = pair(), original = Buffer.from(snapshot);
  const receipt = diagnosticSnapshot(snapshot);
  assert.deepEqual(snapshot.subarray(12, 76), Buffer.alloc(64));
  assert.deepEqual(snapshot.subarray(0, 12), original.subarray(0, 12));
  assert.deepEqual(snapshot.subarray(76), original.subarray(76));
  assert.notEqual(receipt.before.sha256, receipt.afterSha256);
  assert.match(receipt.limitation, /do not prove restore acceptance/u);
});

function profile() {
  return { total_retired: 100, trace_retired: 100, fp: 25, fp_ldst: 5, fp_compute: 20,
    opcode7: { "0x13": 75, "0x53": 16, "0x43": 4, "0x07": 5 },
    op_fp_funct7: { "0x10": 16 }, fma_opcode7: { "0x43": 4 }, pair_hist_dropped: 0,
    fp_region64_distinct: 2, fp_region64_dropped: 0,
    fp_region64: [{ pc: "0x0000000000001000", total: 50, fp_compute: 20 },
      { pc: "0x0000000000001040", total: 50, fp_compute: 0 }] };
}

test("raw compute recount and regions reject count drift and preserve truncation", () => {
  const actual = recountProfile(profile()); assert.equal(actual.computePercent, 20);
  assert.equal(actual.policyReopenConditionObserved, true);
  assert.match(actual.loadStoreLimitation, /cannot be independently reconstructed/u);
  for (const mutate of [
    p => { p.opcode7["0x53"]++; }, p => { p.fp_compute--; },
    p => { p.op_fp_funct7["0x10"]--; }, p => { p.fma_opcode7["0x43"]--; },
    p => { p.fp_region64[0].total++; }, p => { p.fp_region64[0].fp_compute--; },
    p => { p.fp_region64[0].pc = p.fp_region64[1].pc; },
  ]) { const bad = profile(); mutate(bad); assert.throws(() => recountProfile(bad)); }
  const truncated = profile(); truncated.fp_region64[0].total -= 10; truncated.fp_region64_dropped = 10;
  assert.equal(recountProfile(truncated).truncation.regionSamplesDropped, 10);
  const integer = profile(); integer.opcode7 = { "0x13": 100 }; integer.op_fp_funct7 = {}; integer.fma_opcode7 = {};
  integer.fp = 0; integer.fp_ldst = 0; integer.fp_compute = 0; integer.fp_region64[0].fp_compute = 0;
  assert.equal(recountProfile(integer).policyReopenConditionObserved, false);
});

test("owned recorder preserves native exit/output and terminates a timed-out child", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omarchy-opcode-process-test-"));
  try {
    const normal = await recordProcess(process.execPath, ["-e", "process.stdout.write('observed'); process.exitCode=102"],
      path.join(dir, "normal"), process.env, 5000);
    assert.equal(normal.code, 102); assert.equal(normal.timedOut, false);
    assert.equal(await fs.readFile(path.join(dir, "normal.stdout"), "utf8"), "observed");
    const timeout = await recordProcess(process.execPath, ["-e", "setInterval(()=>{},1000)"], path.join(dir, "timeout"), process.env, 100);
    assert.equal(timeout.timedOut, true); assert.equal(timeout.signal, "SIGTERM");
    assert.throws(() => process.kill(timeout.pid, 0), /ESRCH/u);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
