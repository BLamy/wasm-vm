// E4-T22: the shared CONTROL BLOCK — a small SharedArrayBuffer of Int32 cells used for
// cross-thread signalling between the main thread (DOM/devices) and the CPU worker.
//
// This is deliberately SEPARATE from the guest's `WebAssembly.Memory` (which holds guest RAM +
// CpuState + TLBs). Keeping the signalling cells in their own SAB means the layout is stable and
// independent of the guest memory map, and `Atomics.wait`/`notify` targets are unambiguous.
//
// All multi-thread reads/writes go through `Atomics.*` so the SAB memory-model ordering holds:
// a release-store to a cell (e.g. IRQ) happens-after the device-buffer writes that precede it, and
// the worker's `Atomics.load`/wake observes those writes (adversarial angle #3 in the ticket).

// Int32 cell indices (byte offset = index * 4).
export const CELL = Object.freeze({
  // Worker lifecycle: 0=boot, 1=running, 2=parked(WFI), 3=fatal.
  STATE: 0,
  // WFI park/wake cell. Worker does Atomics.wait(cells, IRQ, seen, timeout); any thread that
  // raises an interrupt bumps this cell and Atomics.notify's it. Monotonic counter, never reset,
  // so a notify that races the park is never lost (worker re-reads and sees the new value).
  IRQ: 1,
  // Interim synchronous MMIO stub (replaced by the real device proxy in E4-T23).
  //   REQ:  worker bumps to N to publish request #N, then Atomics.wait(RESP != N-... ) style.
  //   RESP: main thread writes the same N back after servicing → wakes the worker.
  //   ADDR/WIDTH/WVAL/RVAL/WRITE carry the request/response payload.
  MMIO_REQ: 2,
  MMIO_RESP: 3,
  MMIO_ADDR_LO: 4,
  MMIO_ADDR_HI: 5,
  MMIO_WIDTH: 6, // 1|2|4|8 bytes
  MMIO_WRITE: 7, // 1 = store, 0 = load
  MMIO_VAL_LO: 8,
  MMIO_VAL_HI: 9,
});

export const STATE = Object.freeze({ BOOT: 0, RUNNING: 1, PARKED: 2, FATAL: 3 });

export const CONTROL_CELLS = 16; // headroom past the highest index above
export const CONTROL_BYTES = CONTROL_CELLS * 4;

/** Allocate the control block (main thread). Returns { sab, cells } sharing one buffer. */
export function createControlBlock() {
  const sab = new SharedArrayBuffer(CONTROL_BYTES);
  return { sab, cells: new Int32Array(sab) };
}

/** Reattach an Int32 view over a control-block SAB received in a worker. */
export function attachControlBlock(sab) {
  return new Int32Array(sab);
}

// ── WFI park/wake ────────────────────────────────────────────────────────────────────────────
// Only legal on a worker thread (Atomics.wait throws on the main thread).

/**
 * Park until the IRQ cell changes from `seenIrq` or `timeoutMs` elapses.
 * @returns {"ok"|"not-equal"|"timed-out"} the Atomics.wait status
 */
export function wfiPark(cells, seenIrq, timeoutMs) {
  // Infinity ⇒ block indefinitely (no pending timer deadline).
  return Atomics.wait(cells, CELL.IRQ, seenIrq, timeoutMs);
}

/** Read the current IRQ counter (either thread). */
export function irqCount(cells) {
  return Atomics.load(cells, CELL.IRQ);
}

/**
 * Raise an interrupt: bump the IRQ counter (release-store) and wake a parked worker.
 * Any preceding device-buffer writes are visible to the woken worker (SAB happens-before).
 * @returns number of workers woken
 */
export function raiseIrq(cells) {
  Atomics.add(cells, CELL.IRQ, 1);
  return Atomics.notify(cells, CELL.IRQ);
}

// ── Interim synchronous MMIO stub (worker side) ────────────────────────────────────────────────
// Blocks the worker until the main thread services the access. Real async device proxy = E4-T23.

/** Encode a request into the control cells and block until the main thread answers.
 * @returns {bigint} the load result (0n for stores)
 */
export function mmioRequest(cells, { addr, width, write, value }) {
  const a = BigInt(addr);
  Atomics.store(cells, CELL.MMIO_ADDR_LO, Number(a & 0xffff_ffffn) | 0);
  Atomics.store(cells, CELL.MMIO_ADDR_HI, Number((a >> 32n) & 0xffff_ffffn) | 0);
  Atomics.store(cells, CELL.MMIO_WIDTH, width | 0);
  Atomics.store(cells, CELL.MMIO_WRITE, write ? 1 : 0);
  const v = write ? BigInt(value) : 0n;
  Atomics.store(cells, CELL.MMIO_VAL_LO, Number(v & 0xffff_ffffn) | 0);
  Atomics.store(cells, CELL.MMIO_VAL_HI, Number((v >> 32n) & 0xffff_ffffn) | 0);

  const req = Atomics.add(cells, CELL.MMIO_REQ, 1) + 1; // published request id
  // Block until RESP catches up to REQ. Loop guards spurious wakeups.
  while (Atomics.load(cells, CELL.MMIO_RESP) !== req) {
    Atomics.wait(cells, CELL.MMIO_RESP, Atomics.load(cells, CELL.MMIO_RESP));
  }
  const lo = BigInt(Atomics.load(cells, CELL.MMIO_VAL_LO) >>> 0);
  const hi = BigInt(Atomics.load(cells, CELL.MMIO_VAL_HI) >>> 0);
  return (hi << 32n) | lo;
}

/** Main-thread side: is a request pending, and what is it? Returns null if none. */
export function mmioPending(cells) {
  const req = Atomics.load(cells, CELL.MMIO_REQ);
  if (Atomics.load(cells, CELL.MMIO_RESP) === req) return null; // already serviced
  const lo = BigInt(Atomics.load(cells, CELL.MMIO_ADDR_LO) >>> 0);
  const hi = BigInt(Atomics.load(cells, CELL.MMIO_ADDR_HI) >>> 0);
  const vlo = BigInt(Atomics.load(cells, CELL.MMIO_VAL_LO) >>> 0);
  const vhi = BigInt(Atomics.load(cells, CELL.MMIO_VAL_HI) >>> 0);
  return {
    req,
    addr: (hi << 32n) | lo,
    width: Atomics.load(cells, CELL.MMIO_WIDTH),
    write: Atomics.load(cells, CELL.MMIO_WRITE) === 1,
    value: (vhi << 32n) | vlo,
  };
}

/** Main-thread side: publish the load result (ignored for stores) and wake the worker. */
export function mmioRespond(cells, req, resultValue) {
  const v = BigInt(resultValue ?? 0);
  Atomics.store(cells, CELL.MMIO_VAL_LO, Number(v & 0xffff_ffffn) | 0);
  Atomics.store(cells, CELL.MMIO_VAL_HI, Number((v >> 32n) & 0xffff_ffffn) | 0);
  Atomics.store(cells, CELL.MMIO_RESP, req);
  Atomics.notify(cells, CELL.MMIO_RESP);
}
