import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { assertFailedInput, snapshotMeter, saveMachineExpression, pauseFailedInput } from "./omarchy-failure-checkpoint.mjs";

function report() { return { mode: "input-trial", result: "failed", trial: { outcome: "nonce-readback-failed", readbackMs: 120000 },
  keyboard: { typedAt: new Date(1000).toISOString(), enteredAtMs: 1000, deadlineAt: new Date(121000).toISOString(), verified: false } }; }
test("only an already-failed unchanged input deadline permits capture", () => {
  assert.ok(assertFailedInput(report(), 121000));
  assert.throws(() => assertFailedInput(report(), 120999), /precede/u);
  for (const mutate of [r => r.result = "passed", r => r.keyboard.verified = true,
    r => r.trial.readbackMs++, r => r.keyboard.enteredAtMs++, r => r.keyboard.typedAt = null]) {
    const r = report(); mutate(r); assert.throws(() => assertFailedInput(r, 121000));
  }
});
test("pause occurs first, once, without changing the verdict", async () => {
  const r = report(), before = assertFailedInput(r), calls = [];
  const page = { evaluate: async fn => { calls.push(fn.toString()); return calls.length === 2 ? true : undefined; } };
  await pauseFailedInput(page, r);
  assert.match(calls[0], /__linux.pause/u); assert.match(calls[1], /isPaused/u);
  assert.equal(assertFailedInput(r), before); assert.equal(r.failureCheckpoint.paused, true);
  assert.equal(r.failureCheckpoint.timeoutMs, 180000);
});
test("debugger expression rejects ambiguous/dead instances and calls the real save method once", () => {
  const save = Function(`return (${saveMachineExpression})`)();
  for (const instances of [[], [{ __wbg_ptr: 0 }], [{}, {}]]) assert.throws(() => save.call(instances), /ambiguous/u);
  let calls = 0;
  const bytes = new Uint8Array(1048576);
  assert.equal(save.call([{ __wbg_ptr: 1, saveSnapshot() { calls++; return bytes; } }]).bytes, bytes.length);
  assert.equal(calls, 1); assert.equal(globalThis.__omarchyFailureSnapshot, bytes);
  delete globalThis.__omarchyFailureSnapshot;
});
test("snapshot stream hashes exact bytes and rejects short/oversized bodies", async () => {
  const bytes = Buffer.alloc(1048576, 35), hash = createHash("sha256");
  const sink = () => new Writable({ write(_data, _enc, cb) { cb(); } });
  await pipeline(Readable.from([bytes.subarray(0, 200), bytes.subarray(200)]), snapshotMeter(bytes.length, hash), sink());
  assert.equal(hash.digest("hex"), createHash("sha256").update(bytes).digest("hex"));
  for (const size of [bytes.length - 1, bytes.length + 1]) await assert.rejects(
    pipeline(Readable.from([Buffer.alloc(size)]), snapshotMeter(bytes.length, createHash("sha256")), sink()), /truncated|exceeds/u);
});
