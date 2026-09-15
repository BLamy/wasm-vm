import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { sections, decodeRam, Memory, walkList, unwind, pinned, pins } from "./omarchy-wait-checkpoint.mjs";

test("pinned layout rejects a changed task offset even with intact kernel identity", () => {
  const bytes = fs.readFileSync(new URL("../../evidence/omarchy-profile/checkpoint-wait-layout/layout.json", import.meta.url));
  pinned(bytes, pins.layout, "layout");
  const changed = JSON.parse(bytes);
  changed.offsets.TASK_PID += 4;
  assert.throws(() => pinned(Buffer.from(JSON.stringify(changed)), pins.layout, "layout"), /identity mismatch/u);
  const kernel = Buffer.from("independent kernel instruction bytes");
  assert.throws(() => pinned(kernel, changed.kernelFiles["arch/riscv/boot/Image"], "kernel"), /identity mismatch/u);
});

function container(parts = [[1, Buffer.alloc(1)], [2, Buffer.alloc(1)]]) {
  const header = Buffer.alloc(84); header.write("WVMRESU1"); header.writeUInt32LE(1, 8);
  return Buffer.concat([header, ...parts.flatMap(([tag, data]) => {
    const h = Buffer.alloc(8); h.writeUInt32LE(tag); h.writeUInt32LE(data.length, 4); return [h, data];
  })]);
}
test("container rejects duplicate, unknown, missing and truncated sections", () => {
  assert.equal(sections(container()).size, 2);
  for (const bytes of [container().subarray(0, -1), container([[1, Buffer.alloc(1)]]),
    container([[1, Buffer.alloc(1)], [1, Buffer.alloc(1)]]), container([[17, Buffer.alloc(1)]])]) {
    assert.throws(() => sections(bytes));
  }
});

test("sparse decoder respects literal, zero, truncation and total-size boundaries", () => {
  const good = Buffer.from([0, 3, 0, 0, 0, 1, 2, 0, 0, 0, 7, 8]);
  assert.deepEqual(decodeRam(good, 5), Buffer.from([0, 0, 0, 7, 8]));
  for (const [data, size] of [[good, 4], [good, 6], [good.subarray(0, -1), 5],
    [Buffer.from([2, 5, 0, 0, 0]), 5], [Buffer.from([0, 255, 255, 255, 255]), 16]]) {
    assert.throws(() => decodeRam(data, size));
  }
});

function pageFixture(mode = 10) {
  const ram = Buffer.alloc(4096 * 16), base = 0x80000000n, levels = mode - 5;
  const put = (offset, value) => ram.writeBigUInt64LE(value, offset);
  for (let i = 0; i < levels - 1; i++) put(i * 4096, ((base + BigInt((i + 1) * 4096)) >> 12n << 10n) | 1n);
  const leaf = (levels - 1) * 4096 + 2 * 8;
  put(leaf, ((base + 5n * 4096n) >> 12n << 10n) | 0x5bn);
  put(leaf + 8, ((base + 7n * 4096n) >> 12n << 10n) | 0x5bn);
  ram.fill(0xa1, 5 * 4096, 6 * 4096); ram.fill(0xb2, 7 * 4096, 8 * 4096);
  return { ram, base, leaf, put, m: new Memory(ram, base, mode) };
}
test("saved-mode page walks cover Sv39/Sv48/Sv57 and noncontiguous page reads", () => {
  for (const mode of [8, 9, 10]) {
    const { m, base } = pageFixture(mode);
    assert.equal(m.translate(0x2345n, base, { user: true, execute: true }).physical, base + 0x5345n);
    assert.deepEqual(m.read(0x2ffen, 4), Buffer.from([0xa1, 0xa1, 0xb2, 0xb2]));
    assert.throws(() => m.translate(1n << BigInt(12 + 9 * (mode - 5) - 1)), /noncanonical/u);
  }
});
test("page walks reject invalid/reserved/non-leaf PTEs and misaligned superpages", () => {
  for (const mutation of [
    f => f.put(f.leaf, 0n),
    f => f.put(f.leaf, f.ram.readBigUInt64LE(f.leaf) | (1n << 61n)),
    f => f.put(f.leaf, 5n),
    f => f.put(0, f.ram.readBigUInt64LE(0) | 64n),
    f => f.put(3 * 4096, ((f.base + 4096n) >> 12n << 10n) | 3n),
  ]) {
    const f = pageFixture(); mutation(f); assert.throws(() => f.m.translate(0x2000n));
  }
  const { m, base } = pageFixture();
  assert.throws(() => m.translate(0x2000n, base + 1n), /unaligned/u);
  assert.throws(() => m.translate(0x2000n, base + 0x100000n), /physical RAM bounds/u);
});

function linkedMemory(values) {
  return { u64(address) { assert.ok(values.has(address), "fixture address missing"); return values.get(address); },
    translate(address) { return { physical: address }; },
    witness(address) { return { virtual: `0x${address.toString(16)}`, value: `0x${this.u64(address).toString(16)}` }; } };
}
test("task-list traversal checks reciprocal closure, cycles and count bounds", () => {
  const entries = [[0x1000n, 0x2000n], [0x1008n, 0x3000n], [0x2000n, 0x3000n],
    [0x2008n, 0x1000n], [0x3000n, 0x1000n], [0x3008n, 0x2000n]];
  assert.equal(walkList(linkedMemory(new Map(entries)), 0x1000n).length, 2);
  for (const [address, value] of [[0x3008n, 0x1000n], [0x1008n, 0x2000n], [0x3000n, 0x2000n]]) {
    const data = new Map(entries); data.set(address, value);
    assert.throws(() => walkList(linkedMemory(data), 0x1000n));
  }
  assert.throws(() => walkList(linkedMemory(new Map(entries)), 0x1000n, 1), /bound/u);
});

function frameFixture() {
  const values = new Map([[0x10f0n, 0x1ee0n], [0x10f8n, 0x800022n],
    [0x1ed0n, 0x700000n], [0x1ed8n, 0x800044n]]);
  const settings = { sp: 0x1080n, fp: 0x1100n, pc: 0x800000n, stack: 0x1000n, size: 4096,
    trapSize: 288, exceptionReturn: 0x800044n };
  const symbolAt = pc => { assert.ok(pc >= 0x800000n && pc < 0x801000n, "outside kernel text"); return { name: "synthetic-kernel-function" }; };
  return { values, settings, symbolAt };
}
test("kernel unwind stops at the proven trap boundary and keeps saved context labeled", () => {
  const { values, settings, symbolAt } = frameFixture();
  const result = unwind(linkedMemory(values), settings, symbolAt);
  assert.equal(result.trapAddress, 0x1ee0n); assert.equal(result.frames.length, 3);
  assert.match(result.frames[0].source, /saved task.thread.ra/u);
  assert.match(result.termination, /user context reported separately/u);
});
test("kernel unwind rejects nonincreasing, unaligned, out-of-stack and non-text frames", () => {
  for (const mutate of [
    f => f.values.set(0x10f0n, 0x1100n),
    f => f.values.set(0x10f0n, 0x1ee1n),
    f => f.values.set(0x10f0n, 0x2010n),
    f => f.values.set(0x10f8n, 0x700000n),
    f => f.values.set(0x10f8n, f.settings.exceptionReturn),
    f => { f.settings.sp = 0x3000n; },
  ]) {
    const f = frameFixture(); mutate(f);
    assert.throws(() => unwind(linkedMemory(f.values), f.settings, f.symbolAt));
  }
});
