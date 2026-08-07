// E4-T22 — node unit tests for the shared control-block signalling (no browser; SharedArrayBuffer
// and Atomics exist in node). Covers the non-blocking halves — IRQ counter and the main-thread MMIO
// servicing view. The blocking halves (wfiPark / mmioRequest via Atomics.wait) are exercised in the
// browser leg on `dev` (they park the calling agent by design).
//
// Run: node --test web/tests/cpu-control-block.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

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
