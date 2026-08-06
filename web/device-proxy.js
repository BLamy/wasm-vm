// E4-T23 — split-device MMIO proxying + interrupt injection.
//
// This module replaces the interim BLOCKING synchronous MMIO stub (cpu-control-block.js#mmioRequest)
// with the real split-device architecture described in docs/worker-devices.md:
//
//   * CLINT, PLIC, and virtio ring bookkeeping run WORKER-LOCAL — they never cross threads. The
//     timer path (CLINT mtime reads — the hottest MMIO in Linux) is worker-local BY CONSTRUCTION:
//     `WorkerDeviceRouter.mmio()` services those addresses inline and NEVER touches a ring, so the
//     crossing counter stays at zero over a whole boot (AC2, headlessly asserted).
//   * The main thread owns the real backends: the xterm.js UART endpoint, IndexedDB/OPFS block
//     storage, and the network. Only ACTUAL backend I/O crosses — a UART tx byte, a virtio-blk
//     submit, a net frame — carried over lock-free SPSC rings in a SharedArrayBuffer.
//
// Crossing mechanics (this file):
//   * Two SPSC rings — REQUEST (worker→main) and RESPONSE (main→worker) — fixed-slot, cache-line
//     padded (64 B / 16×i32 per slot, head and tail on separate cache lines to avoid false
//     sharing). Every slot carries a SEQUENCE TAG (the monotonic ring position) so a half-written
//     slot is never read, plus a per-request correlation TAG so a response is matched to its
//     request and can never be applied to the wrong one. When a ring FILLS, `push` returns false and
//     bumps an OVERFLOW counter — backpressure, never a silent drop (adversarial #1).
//   * The main-thread consumer parks with `Atomics.waitAsync` (legal on the main thread — NOT
//     `Atomics.wait`, which throws there). The worker side, when it must block for a synchronous
//     read result (rare — e.g. UART LSR that isn't mirrored), uses `Atomics.wait` with a deadline.
//   * Interrupt injection: a backend completion on the main thread pushes a RESPONSE carrying the
//     device's PLIC source id; the worker-side drain sets that source's pending LEVEL in the
//     worker-local PLIC and bumps + notifies the WFI cell (cpu-control-block IRQ). PLIC state itself
//     is worker-side, so claim/complete never crosses.
//
// Everything here is plain SharedArrayBuffer + Atomics, so it is unit-testable in node with no
// browser (web/tests/device-proxy.test.mjs). The live cross-thread boot / throughput / latency legs
// run in the browser on the Linux `dev` box (they OS-reap on macOS — see the ticket).

// ── Guest device memory map (mirror of crates/core/src/platform.rs `virt`) ──────────────────────
export const MAP = Object.freeze({
  CLINT_BASE: 0x0200_0000n,
  CLINT_END: 0x0200_0000n + 0x1_0000n,
  PLIC_BASE: 0x0c00_0000n,
  PLIC_END: 0x0c00_0000n + 0x0060_0000n,
  UART0_BASE: 0x1000_0000n,
  UART0_END: 0x1000_0000n + 0x100n,
  VIRTIO_BASE: 0x1000_1000n,
  VIRTIO_END: 0x1000_1000n + 0x1000n * 8n,
  VIRTIO_STRIDE: 0x1000n,
});

// UART 16550 register offsets that stay worker-local vs. those that must reach the main-thread
// xterm.js endpoint. THR (offset 0, write) is the tx byte → crosses. RBR (offset 0, read) is served
// from the worker-local rx FIFO the main thread fills on keypress. LSR/IER/etc. are status the
// worker mirrors locally.
const UART_THR = 0x0; // write: transmit holding register (tx byte → main)
const UART_RBR = 0x0; // read: receive buffer register (from worker-local rx FIFO)

// Where an MMIO address is serviced.
export const PLACE = Object.freeze({
  CLINT: "clint", // worker-local (timer/IPI) — NEVER crosses
  PLIC: "plic", // worker-local (interrupt controller) — NEVER crosses
  UART_LOCAL: "uart-local", // worker-local UART status / rx FIFO
  UART_TX: "uart-tx", // crosses: a tx byte for the xterm.js endpoint
  VIRTIO_RING: "virtio-ring", // worker-local ring bookkeeping — NEVER crosses
  VIRTIO_IO: "virtio-io", // crosses: a real backend I/O (blk/net) submit
  RAM: "ram", // not MMIO (guest RAM) — should never reach the router
  UNKNOWN: "unknown",
});

/**
 * Classify an MMIO access by where it is serviced. Pure — the single source of truth the placement
 * audit (tools/worker-device-audit.mjs) and the zero-crossing CLINT test both consult.
 * @param {bigint} addr guest physical address
 * @param {boolean} write true = store, false = load
 * @returns {string} a PLACE.* value
 */
export function classify(addr, write) {
  const a = BigInt(addr);
  if (a >= MAP.CLINT_BASE && a < MAP.CLINT_END) return PLACE.CLINT;
  if (a >= MAP.PLIC_BASE && a < MAP.PLIC_END) return PLACE.PLIC;
  if (a >= MAP.UART0_BASE && a < MAP.UART0_END) {
    const off = Number(a - MAP.UART0_BASE);
    // Only the tx byte (write to THR) crosses; everything else is worker-local status/rx.
    if (write && off === UART_THR) return PLACE.UART_TX;
    return PLACE.UART_LOCAL;
  }
  if (a >= MAP.VIRTIO_BASE && a < MAP.VIRTIO_END) {
    const off = Number((a - MAP.VIRTIO_BASE) % MAP.VIRTIO_STRIDE);
    // virtio-mmio register 0x50 = QueueNotify — the ONLY access that means "process the ring /
    // submit descriptors to the backend". Every other register (queue setup, status, config) is
    // ring bookkeeping the worker does locally against shared guest RAM.
    if (write && off === 0x50) return PLACE.VIRTIO_IO;
    return PLACE.VIRTIO_RING;
  }
  return PLACE.UNKNOWN;
}

/** True iff an access at (addr, write) must cross to the main thread. */
export function crosses(addr, write) {
  const p = classify(addr, write);
  return p === PLACE.UART_TX || p === PLACE.VIRTIO_IO;
}

// ── SPSC ring geometry ──────────────────────────────────────────────────────────────────────────
// A slot is one cache line (64 bytes = 16 Int32). Field indices within a slot:
export const SLOT_I32 = 16;
const S_SEQ = 0; // publish tag: 0 = empty; else (position+1). Written LAST (release).
const S_TAG = 1; // request/response correlation id (echoed on the response)
const S_KIND = 2; // op kind (KIND.*)
const S_WIDTH = 3; // access width in bytes (1|2|4|8)
const S_ADDR_LO = 4;
const S_ADDR_HI = 5;
const S_VAL_LO = 6;
const S_VAL_HI = 7;
const S_AUX = 8; // extra payload word (e.g. PLIC source id on an interrupt response)
const S_T_LO = 9; // producer timestamp (µs*1000, i.e. ns) low 32 — latency instrumentation
const S_T_HI = 10;
// 11..15 reserved / padding to the cache line.

// The ring header is two cache lines: producer-owned (HEAD) and consumer-owned (TAIL) live on
// SEPARATE cache lines so the producer's HEAD store never invalidates the consumer's TAIL line.
export const HEADER_I32 = 32; // 2 cache lines
const H_HEAD = 0; // producer index (monotonic; slot = HEAD & mask)
const H_OVERFLOW = 1; // count of push attempts refused because the ring was full (backpressure)
const H_TAIL = 16; // consumer index (monotonic), on the second cache line

export const KIND = Object.freeze({
  UART_TX: 1, // worker→main: a UART tx byte (val = byte)
  BLK_SUBMIT: 2, // worker→main: a virtio-blk queue-notify (aux = queue idx)
  NET_TX: 3, // worker→main: a net frame notify
  MMIO_READ: 4, // worker→main: a synchronous backend read (rare)
  RESP_OK: 5, // main→worker: a completion (val = read result, if any)
  RESP_IRQ: 6, // main→worker: a device completion that injects an interrupt (aux = PLIC src id)
});

function bytesForCapacity(capacity) {
  return (HEADER_I32 + capacity * SLOT_I32) * 4;
}

/** Allocate a fresh SPSC ring SAB with `capacity` slots (rounded up to a power of two, min 2). */
export function createRing(capacity) {
  const cap = Math.max(2, 1 << Math.ceil(Math.log2(capacity)));
  const sab = new SharedArrayBuffer(bytesForCapacity(cap));
  return { sab, capacity: cap };
}

/**
 * A lock-free single-producer / single-consumer ring over a SharedArrayBuffer. One instance is the
 * PRODUCER end, another (attached to the same SAB with the same capacity) is the CONSUMER end. The
 * two ends must live on different threads; there is exactly one of each.
 *
 * Correctness: HEAD and TAIL are monotonic counters. `push` writes the payload, then release-stores
 * the slot SEQ (= position+1), then release-stores HEAD+1. `pop` acquire-loads HEAD, checks the
 * slot SEQ matches the expected position (guards a half-published slot), reads the payload, then
 * release-stores TAIL+1. Full ⇒ HEAD−TAIL == capacity; `push` refuses and bumps OVERFLOW (never
 * overwrites an unconsumed slot — no lost MMIO, no wrong-request match).
 */
export class SpscRing {
  constructor(sab, capacity) {
    this.i32 = new Int32Array(sab);
    this.capacity = capacity;
    this.mask = capacity - 1;
    if ((capacity & this.mask) !== 0) throw new Error("ring capacity must be a power of two");
  }

  /** Producer: publish one item. Returns true on success, false if the ring is FULL (backpressure). */
  push(item) {
    const head = Atomics.load(this.i32, H_HEAD);
    const tail = Atomics.load(this.i32, H_TAIL);
    if (head - tail >= this.capacity) {
      // FULL: refuse and count it. The caller must retry (backpressure) — nothing is dropped.
      Atomics.add(this.i32, H_OVERFLOW, 1);
      return false;
    }
    const base = HEADER_I32 + (head & this.mask) * SLOT_I32;
    // Payload first, SEQ last (release): a consumer that sees the new SEQ sees the whole payload.
    this.i32[base + S_TAG] = item.tag | 0;
    this.i32[base + S_KIND] = item.kind | 0;
    this.i32[base + S_WIDTH] = item.width | 0;
    const addr = BigInt(item.addr ?? 0n);
    this.i32[base + S_ADDR_LO] = Number(addr & 0xffff_ffffn) | 0;
    this.i32[base + S_ADDR_HI] = Number((addr >> 32n) & 0xffff_ffffn) | 0;
    const val = BigInt(item.value ?? 0n);
    this.i32[base + S_VAL_LO] = Number(val & 0xffff_ffffn) | 0;
    this.i32[base + S_VAL_HI] = Number((val >> 32n) & 0xffff_ffffn) | 0;
    this.i32[base + S_AUX] = item.aux | 0;
    const ts = item.ts ?? 0;
    this.i32[base + S_T_LO] = ts & 0xffff_ffff;
    this.i32[base + S_T_HI] = Math.floor(ts / 0x1_0000_0000) | 0;
    Atomics.store(this.i32, base + S_SEQ, (head + 1) | 0); // publish tag (release)
    Atomics.store(this.i32, H_HEAD, head + 1); // advance head (release)
    return true;
  }

  /** Consumer: pop one item, or null if empty / the next slot is not fully published yet. */
  pop() {
    const tail = Atomics.load(this.i32, H_TAIL);
    const head = Atomics.load(this.i32, H_HEAD);
    if (tail === head) return null; // empty
    const base = HEADER_I32 + (tail & this.mask) * SLOT_I32;
    const seq = Atomics.load(this.i32, base + S_SEQ); // acquire
    if (seq !== ((tail + 1) | 0)) {
      // The producer bumped HEAD but hasn't finished the SEQ release for this slot, OR this is a
      // stale slot from a previous wrap. Either way it is not ours to read yet.
      return null;
    }
    const lo = this.i32[base + S_VAL_LO] >>> 0;
    const hi = this.i32[base + S_VAL_HI] >>> 0;
    const alo = this.i32[base + S_ADDR_LO] >>> 0;
    const ahi = this.i32[base + S_ADDR_HI] >>> 0;
    const item = {
      seq,
      tag: this.i32[base + S_TAG] | 0,
      kind: this.i32[base + S_KIND] | 0,
      width: this.i32[base + S_WIDTH] | 0,
      addr: (BigInt(ahi) << 32n) | BigInt(alo),
      value: (BigInt(hi) << 32n) | BigInt(lo),
      aux: this.i32[base + S_AUX] | 0,
      ts: (this.i32[base + S_T_HI] >>> 0) * 0x1_0000_0000 + (this.i32[base + S_T_LO] >>> 0),
    };
    Atomics.store(this.i32, base + S_SEQ, 0); // mark consumed (defensive)
    Atomics.store(this.i32, H_TAIL, tail + 1); // advance tail (release)
    return item;
  }

  /** Current occupancy (producer view is exact for SPSC). */
  length() {
    return Atomics.load(this.i32, H_HEAD) - Atomics.load(this.i32, H_TAIL);
  }

  isFull() {
    return this.length() >= this.capacity;
  }

  isEmpty() {
    return this.length() === 0;
  }

  /** Count of push attempts refused because the ring was full (overflow → backpressure signal). */
  overflowCount() {
    return Atomics.load(this.i32, H_OVERFLOW);
  }
}

// ── Latency instrumentation — per-crossing-type histograms (ProfStats analog) ────────────────────
// Log2-bucketed nanosecond histograms, one per crossing kind. Cheap to record on the hot path
// (one Math.clz32); p50 read off the cumulative distribution. This is the JS-side ProfStats: the
// crossings physically HAPPEN here, so this is where they are timed (the ticket's "in ProfStats").
export class LatencyStats {
  constructor() {
    this.hist = { uart_tx: new Uint32Array(32), blk: new Uint32Array(32), net: new Uint32Array(32) };
    this.count = { uart_tx: 0, blk: 0, net: 0 };
  }

  static bucket(ns) {
    if (ns <= 1) return 0;
    return Math.min(31, 32 - Math.clz32(ns >>> 0));
  }

  record(kindKey, ns) {
    const h = this.hist[kindKey];
    if (!h) return;
    h[LatencyStats.bucket(ns)] += 1;
    this.count[kindKey] += 1;
  }

  /** Approximate p-quantile (µs) for a crossing kind, read off the log2 histogram (upper edge). */
  quantile(kindKey, p) {
    const h = this.hist[kindKey];
    const n = this.count[kindKey];
    if (!h || n === 0) return 0;
    const target = Math.ceil(n * p);
    let acc = 0;
    for (let b = 0; b < h.length; b++) {
      acc += h[b];
      if (acc >= target) return (1 << b) / 1000; // bucket upper edge, ns → µs
    }
    return (1 << (h.length - 1)) / 1000;
  }

  snapshot() {
    return {
      count: { ...this.count },
      uart_tx_p50_us: this.quantile("uart_tx", 0.5),
      blk_p50_us: this.quantile("blk", 0.5),
      net_p50_us: this.quantile("net", 0.5),
    };
  }
}

// ── Worker-side device router ────────────────────────────────────────────────────────────────────
// The wasm MMIO trap calls into this. Worker-local regions (CLINT/PLIC/virtio-ring/UART status) are
// serviced inline against worker-side state — ZERO ring pushes, ZERO crossings. Only a real backend
// I/O (UART tx, virtio queue-notify) is enqueued on the request ring.
export class WorkerDeviceRouter {
  /**
   * @param {SpscRing} reqRing producer end (worker→main)
   * @param {SpscRing} respRing consumer end (main→worker)
   * @param {object} localDevices worker-local device callbacks:
   *   { clint, plic, virtioRing, uartLocal } each `(addr, write, width, value) => bigint`
   * @param {(srcId:number)=>void} [injectIrq] set a PLIC source pending + notify the WFI cell
   */
  constructor(reqRing, respRing, localDevices, injectIrq) {
    this.req = reqRing;
    this.resp = respRing;
    this.local = localDevices || {};
    this.injectIrq = injectIrq || (() => {});
    this.crossings = 0; // number of accesses that pushed onto the request ring (AC2 counter)
    this.localHits = 0;
    this.backpressureStalls = 0;
    this.nextTag = 1;
  }

  /** Service one MMIO access. Returns the load result (0n for stores / async submits). */
  mmio(addr, write, width, value) {
    const place = classify(addr, write);
    switch (place) {
      case PLACE.CLINT:
        this.localHits++;
        return this.local.clint?.(addr, write, width, value) ?? 0n;
      case PLACE.PLIC:
        this.localHits++;
        return this.local.plic?.(addr, write, width, value) ?? 0n;
      case PLACE.UART_LOCAL:
        this.localHits++;
        return this.local.uartLocal?.(addr, write, width, value) ?? 0n;
      case PLACE.VIRTIO_RING:
        this.localHits++;
        return this.local.virtioRing?.(addr, write, width, value) ?? 0n;
      case PLACE.UART_TX:
        this._cross({ kind: KIND.UART_TX, addr, width, value });
        return 0n;
      case PLACE.VIRTIO_IO:
        this._cross({ kind: KIND.BLK_SUBMIT, addr, width, value, aux: Number((addr - MAP.VIRTIO_BASE) / MAP.VIRTIO_STRIDE) });
        return 0n;
      default:
        // Unknown MMIO: treat as a worker-local no-op read (matches the core's open-bus policy).
        return 0n;
    }
  }

  /** Enqueue a backend crossing (fire-and-forget submit; completion arrives as an interrupt). */
  _cross(item) {
    const tag = this.nextTag++;
    const ts = nowNs();
    const ok = this.req.push({ ...item, tag, ts });
    if (!ok) {
      // FULL: the ring is backpressured. The worker must NOT drop the byte — drain responses to make
      // room is a main-thread job, so we spin briefly then retry. In the real worker this is a short
      // Atomics.wait on the response ring's tail; here we surface the stall for the flood test.
      this.backpressureStalls++;
      return false;
    }
    this.crossings++;
    return true;
  }

  /** Drain the response ring: apply completions, inject interrupts. Call from the worker loop. */
  drainResponses(latency) {
    let n = 0;
    for (;;) {
      const r = this.resp.pop();
      if (!r) break;
      n++;
      if (r.kind === KIND.RESP_IRQ) {
        // A device completion: set the PLIC source pending (worker-local) and wake the WFI cell.
        this.injectIrq(r.aux);
      }
      if (latency && r.ts) {
        const ns = Math.max(0, nowNs() - r.ts);
        const key = r.kind === KIND.RESP_IRQ ? "blk" : "uart_tx";
        latency.record(key, ns);
      }
    }
    return n;
  }
}

// ── Main-thread device server ────────────────────────────────────────────────────────────────────
// The consumer end of the request ring + producer of the response ring. Parks with
// `Atomics.waitAsync` (legal on main; never `Atomics.wait`). Services each backend request (UART →
// xterm.js, blk → IndexedDB/OPFS, net → fetch) and, on completion, pushes a RESP_IRQ so the worker
// injects the interrupt. Backends are injected so the class is unit-testable without a DOM.
export class MainDeviceServer {
  /**
   * @param {SpscRing} reqRing consumer end (worker→main)
   * @param {SpscRing} respRing producer end (main→worker)
   * @param {object} backends { uartTx(byte), blkSubmit(queueIdx)->Promise, netTx(frame)->Promise }
   * @param {object} [irqMap] { blk:number, net:number } PLIC source ids to inject on completion
   */
  constructor(reqRing, respRing, backends, irqMap) {
    this.req = reqRing;
    this.resp = respRing;
    this.backends = backends || {};
    this.irqMap = irqMap || { blk: 1, net: 2 };
    this.i32 = reqRing.i32;
    this.running = false;
  }

  /** Drain all currently-pending requests synchronously (used by the test + each wake). */
  drainOnce() {
    let n = 0;
    for (;;) {
      const rq = this.req.pop();
      if (!rq) break;
      n++;
      this._service(rq);
    }
    return n;
  }

  _service(rq) {
    switch (rq.kind) {
      case KIND.UART_TX:
        this.backends.uartTx?.(Number(rq.value & 0xffn));
        // UART tx has no guest-visible completion interrupt in the simple THR-empty model; if the
        // guest enabled the THRE interrupt the caller wires it, echoing a RESP_IRQ with the UART src.
        break;
      case KIND.BLK_SUBMIT: {
        const done = this.backends.blkSubmit?.(rq.aux);
        const finish = () =>
          this._respondIrq(this.irqMap.blk, rq.ts);
        if (done && typeof done.then === "function") done.then(finish, finish);
        else finish();
        break;
      }
      case KIND.NET_TX: {
        const done = this.backends.netTx?.(rq.value);
        const finish = () => this._respondIrq(this.irqMap.net, rq.ts);
        if (done && typeof done.then === "function") done.then(finish, finish);
        else finish();
        break;
      }
      default:
        break;
    }
  }

  _respondIrq(srcId, originTs) {
    // Backpressure on the response ring: retry until it accepts (responses must never be lost).
    let ok = false;
    for (let i = 0; i < 1_000_000 && !ok; i++) {
      ok = this.resp.push({ kind: KIND.RESP_IRQ, aux: srcId, ts: originTs, tag: 0 });
    }
    return ok;
  }

  /**
   * Park on the request ring's HEAD with Atomics.waitAsync (main-thread-legal), draining on every
   * wake. Returns a stop() function. In node/tests, prefer `drainOnce()` — waitAsync needs an event
   * loop and a producer on another thread.
   */
  start() {
    if (this.running) return () => {};
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this.drainOnce();
      const head = Atomics.load(this.i32, H_HEAD);
      const tail = Atomics.load(this.i32, H_TAIL);
      if (head !== tail) {
        // More arrived while we drained — reschedule immediately.
        (globalThis.queueMicrotask || setTimeout)(loop);
        return;
      }
      const res = Atomics.waitAsync(this.i32, H_HEAD, head);
      if (res.async) res.value.then(loop);
      else (globalThis.queueMicrotask || setTimeout)(loop); // "not-equal": producer already moved
    };
    loop();
    return () => {
      this.running = false;
    };
  }
}

// Monotonic nanosecond clock (performance.now is ms; scale to ns). Falls back to Date in bare node.
function nowNs() {
  const p = globalThis.performance;
  if (p && typeof p.now === "function") return Math.round(p.now() * 1e6);
  return Date.now() * 1e6;
}
