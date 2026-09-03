// E4-T22 — node tests for the shared control-block signalling (no browser; SharedArrayBuffer and
// Atomics exist in node). The worker-thread cases below exercise the blocking halves
// (wfiPark/mmioRequest) without blocking the test runner's main thread.
//
// Run: node --test web/tests/cpu-control-block.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { Worker } from "node:worker_threads";

import {
  createControlBlock,
  attachControlBlock,
  raiseIrq,
  irqCount,
  mmioPending,
  mmioRespond,
  CELL,
  STATE,
  CONTROL_CELLS,
} from "../cpu-control-block.js";

const workerUrl = new URL("./helpers/e4-t22c-control-block-worker.mjs", import.meta.url);

function startWorker(sab, dataSab) {
  return new Worker(workerUrl, { workerData: { controlSab: sab, dataSab } });
}

test("control block: fresh IRQ counter is zero, raiseIrq is monotonic", () => {
  const { cells } = createControlBlock();
  assert.equal(irqCount(cells), 0);
  raiseIrq(cells);
  raiseIrq(cells);
  assert.equal(irqCount(cells), 2);
});

test("attachControlBlock shares the same buffer (worker sees main-thread writes)", () => {
  const { sab, cells } = createControlBlock();
  const worker = attachControlBlock(sab);
  Atomics.store(cells, CELL.STATE, STATE.PARKED);
  assert.equal(Atomics.load(worker, CELL.STATE), STATE.PARKED);
  raiseIrq(worker);
  assert.equal(irqCount(cells), 1); // visible back on the main-thread view
});

test("MMIO: no request pending when RESP == REQ", () => {
  const { cells } = createControlBlock();
  assert.equal(mmioPending(cells), null);
});

test("MMIO: main thread observes an encoded request and responds with a 64-bit result", () => {
  const { cells } = createControlBlock();
  // Simulate what the worker's mmioRequest() publishes (without the blocking wait).
  const addr = 0x1000_0004n; // a UART data register, say
  Atomics.store(cells, CELL.MMIO_ADDR_LO, Number(addr & 0xffff_ffffn) | 0);
  Atomics.store(cells, CELL.MMIO_ADDR_HI, Number((addr >> 32n) & 0xffff_ffffn) | 0);
  Atomics.store(cells, CELL.MMIO_WIDTH, 4);
  Atomics.store(cells, CELL.MMIO_WRITE, 0);
  Atomics.add(cells, CELL.MMIO_REQ, 1); // publish request #1

  const pend = mmioPending(cells);
  assert.ok(pend, "a request must be visible");
  assert.equal(pend.addr, addr);
  assert.equal(pend.width, 4);
  assert.equal(pend.write, false);
  assert.equal(pend.req, 1);

  mmioRespond(cells, pend.req, 0xdead_beef_0000_0042n);
  assert.equal(mmioPending(cells), null, "serviced request is no longer pending");
  const lo = BigInt(Atomics.load(cells, CELL.MMIO_VAL_LO) >>> 0);
  const hi = BigInt(Atomics.load(cells, CELL.MMIO_VAL_HI) >>> 0);
  assert.equal((hi << 32n) | lo, 0xdead_beef_0000_0042n, "full 64-bit result round-trips");
});

test("control block has headroom past the highest defined cell index", () => {
  const maxIndex = Math.max(...Object.values(CELL));
  assert.ok(CONTROL_CELLS > maxIndex, "CONTROL_CELLS must exceed the highest CELL index");
});

test("worker WFI observes data written before the atomic IRQ wake", async () => {
  const { sab, cells } = createControlBlock();
  const data = new Int32Array(new SharedArrayBuffer(4));
  const worker = startWorker(sab, data.buffer);
  try {
    worker.postMessage({ op: "park", seen: 0 });
    assert.deepEqual(await once(worker, "message"), [{ type: "waiting", seen: 0 }]);
    Atomics.store(data, 0, 0x1234_5678);
    assert.equal(raiseIrq(cells), 1);
    const [result] = await once(worker, "message");
    assert.match(result.status, /^(ok|not-equal)$/);
    assert.equal(result.value, 0x1234_5678);
    assert.equal(result.irq, 1);
  } finally {
    await worker.terminate();
  }
});

test("worker WFI loop ignores a spurious notify and rechecks the IRQ counter", async () => {
  const { sab, cells } = createControlBlock();
  const data = new Int32Array(new SharedArrayBuffer(4));
  const worker = startWorker(sab, data.buffer);
  try {
    worker.postMessage({ op: "park-loop", seen: 0 });
    assert.deepEqual(await once(worker, "message"), [{ type: "waiting", seen: 0 }]);
    assert.equal(Atomics.notify(cells, CELL.IRQ), 1);
    assert.deepEqual(await once(worker, "message"), [{ type: "spurious", wakeups: 1 }]);
    Atomics.store(data, 0, 0x5566_7788);
    assert.equal(raiseIrq(cells), 1);
    const [result] = await once(worker, "message");
    assert.equal(result.type, "loop-woke");
    assert.equal(result.wakeups, 2);
    assert.equal(result.irq, 1);
    assert.equal(result.value, 0x5566_7788);
  } finally {
    await worker.terminate();
  }
});

test("worker MMIO wait matches sequential request tags and preserves 64-bit values", async () => {
  const { sab, cells } = createControlBlock();
  const worker = startWorker(sab, new SharedArrayBuffer(4));
  const waitForPending = async () => {
    for (;;) {
      const pending = mmioPending(cells);
      if (pending) return pending;
      await new Promise((resolve) => setImmediate(resolve));
    }
  };
  try {
    worker.postMessage({ op: "mmio" });
    assert.deepEqual(await once(worker, "message"), [{ type: "mmio-start" }]);

    const first = await waitForPending();
    assert.equal(first.req, 1);
    assert.equal(first.addr, 0x1_0000_0004n);
    assert.equal(first.width, 8);
    assert.equal(first.write, false);
    mmioRespond(cells, first.req, 0xdead_beef_0000_0042n);
    const [firstResult] = await once(worker, "message");
    assert.deepEqual(firstResult, { type: "mmio-result", req: 1, value: "deadbeef00000042" });

    const second = await waitForPending();
    assert.equal(second.req, 2);
    assert.equal(second.addr, 0x1_0000_0010n);
    assert.equal(second.width, 4);
    assert.equal(second.write, true);
    assert.equal(second.value, 0xaabb_ccddn);
    mmioRespond(cells, second.req, 0n);
    const [done] = await once(worker, "message");
    assert.deepEqual(done, { type: "mmio-done", req: 2 });
    assert.equal(mmioPending(cells), null);
  } finally {
    await worker.terminate();
  }
});
