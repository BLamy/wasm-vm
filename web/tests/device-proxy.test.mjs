// E4-T23 — node unit tests for the split-device SPSC ring proxy + placement classification.
// Headless (SharedArrayBuffer + Atomics exist in node). The live cross-thread boot / throughput /
// budget legs run in the browser on `dev` (they OS-reap on macOS — see the ticket).
//
// Run: node --test web/tests/device-proxy.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SpscRing,
  createRing,
  KIND,
  classify,
  crosses,
  PLACE,
  MAP,
  WorkerDeviceRouter,
  MainDeviceServer,
  LatencyStats,
} from "../device-proxy.js";

// ── SPSC ring: basic producer/consumer correctness ──────────────────────────────────────────────
test("ring: fresh ring is empty; push then pop round-trips the payload", () => {
  const { sab, capacity } = createRing(8);
  const prod = new SpscRing(sab, capacity);
  const cons = new SpscRing(sab, capacity);
  assert.equal(cons.pop(), null, "empty ring pops null");
  assert.ok(prod.push({ kind: KIND.UART_TX, tag: 42, width: 1, value: 0x61n }));
  const item = cons.pop();
  assert.ok(item, "one item available");
  assert.equal(item.tag, 42);
  assert.equal(item.kind, KIND.UART_TX);
  assert.equal(item.value, 0x61n);
  assert.equal(cons.pop(), null, "drained");
});

test("ring: 64-bit addr/value survive the slot round-trip", () => {
  const { sab, capacity } = createRing(4);
  const p = new SpscRing(sab, capacity);
  const c = new SpscRing(sab, capacity);
  p.push({ kind: KIND.BLK_SUBMIT, tag: 7, addr: 0x1_0000_1050n, value: 0xdead_beef_0000_0042n });
  const it = c.pop();
  assert.equal(it.addr, 0x1_0000_1050n);
  assert.equal(it.value, 0xdead_beef_0000_0042n);
});

// ── Sequence tags: FIFO order, correlation, and no wrong-request match ───────────────────────────
test("ring: sequence tags preserve FIFO order across a full wrap", () => {
  const { sab, capacity } = createRing(4); // small → forces wraps
  const p = new SpscRing(sab, capacity);
  const c = new SpscRing(sab, capacity);
  let sent = 0;
  let recv = 0;
  // Interleave pushes and pops so the ring wraps many times; assert monotonically increasing tags.
  for (let round = 0; round < 1000; round++) {
    while (!p.isFull() && sent < 4000) {
      assert.ok(p.push({ kind: KIND.UART_TX, tag: sent, value: BigInt(sent) }));
      sent++;
    }
    let it;
    while ((it = c.pop())) {
      assert.equal(it.tag, recv, "tags must arrive in exact FIFO order (no reorder, no gap)");
      assert.equal(it.value, BigInt(recv), "payload matches its own tag (no cross-slot bleed)");
      recv++;
    }
  }
  while (!p.isEmpty()) {
    const it = c.pop();
    if (it) {
      assert.equal(it.tag, recv++);
    }
  }
  assert.equal(recv, sent, "every pushed item was consumed exactly once — no loss, no duplication");
});

// ── Adversarial #1: flood until the ring FILLS — no loss, no misorder, no deadlock ───────────────
test("adversarial #1: flood to full — overflow is signalled + backpressured, never silently lost", () => {
  const { sab, capacity } = createRing(16);
  const p = new SpscRing(sab, capacity);
  const c = new SpscRing(sab, capacity);

  // Phase 1: push WITHOUT consuming until the ring refuses. It must refuse at exactly `capacity`
  // and every refusal must be counted (backpressure signal), never an overwrite.
  let accepted = 0;
  let refused = 0;
  for (let i = 0; i < capacity * 4; i++) {
    if (p.push({ kind: KIND.UART_TX, tag: i, value: BigInt(i) })) accepted++;
    else refused++;
  }
  assert.equal(accepted, capacity, "ring accepts exactly capacity items before it is full");
  assert.equal(p.overflowCount(), refused, "every refused push is counted (no silent drop)");
  assert.ok(refused > 0, "the flood must actually hit the full condition");

  // Phase 2: the accepted items are intact and in order — a full ring did not corrupt or reorder.
  for (let i = 0; i < capacity; i++) {
    const it = c.pop();
    assert.ok(it, "an accepted item is still there");
    assert.equal(it.tag, i, "order preserved under the full-ring flood");
    assert.equal(it.value, BigInt(i), "the response for tag i carries tag i's payload — never mismatched");
  }
  assert.equal(c.pop(), null, "no phantom items");

  // Phase 3: no deadlock — after draining, the producer can push again (backpressure released).
  assert.ok(p.push({ kind: KIND.UART_TX, tag: 999, value: 999n }), "space freed → push succeeds again");
  assert.equal(c.pop().tag, 999);
});

test("adversarial #1: simultaneous UART flood + blk submits interleaved stay correlated", () => {
  // Two logical streams multiplexed onto one request ring; tags carry the stream+seq so a wrong
  // match is detectable. Drain must return each item to its own stream, in that stream's order.
  const { sab, capacity } = createRing(8);
  const p = new SpscRing(sab, capacity);
  const c = new SpscRing(sab, capacity);
  const expectUart = [];
  const expectBlk = [];
  let uSeq = 0;
  let bSeq = 0;
  let sentU = 0;
  let sentB = 0;
  for (let round = 0; round < 500; round++) {
    // Alternate producing UART bytes and blk submits, retrying on backpressure (no drop).
    for (let k = 0; k < 3; k++) {
      if (p.push({ kind: KIND.UART_TX, tag: (uSeq << 1) | 0, value: BigInt(uSeq) })) {
        expectUart.push(uSeq);
        uSeq++;
        sentU++;
      }
      if (p.push({ kind: KIND.BLK_SUBMIT, tag: (bSeq << 1) | 1, value: BigInt(bSeq) })) {
        expectBlk.push(bSeq);
        bSeq++;
        sentB++;
      }
    }
    let it;
    while ((it = c.pop())) {
      if (it.kind === KIND.UART_TX) {
        assert.equal(it.value, BigInt(expectUart.shift()), "uart stream FIFO order preserved");
      } else {
        assert.equal(it.kind, KIND.BLK_SUBMIT);
        assert.equal(it.value, BigInt(expectBlk.shift()), "blk stream FIFO order preserved");
      }
    }
  }
  assert.ok(sentU > 100 && sentB > 100, "both streams actually flowed");
  assert.equal(expectUart.length, 0, "every uart byte consumed — none lost");
  assert.equal(expectBlk.length, 0, "every blk submit consumed — none lost");
});

// ── Placement classification (the source of truth the audit + AC2 consult) ───────────────────────
test("classify: CLINT / PLIC / virtio-ring are worker-local; only UART-THR + queue-notify cross", () => {
  assert.equal(classify(MAP.CLINT_BASE + 0xbff8n, false), PLACE.CLINT); // mtime read
  assert.equal(crosses(MAP.CLINT_BASE + 0xbff8n, false), false);
  assert.equal(classify(MAP.PLIC_BASE + 0x200004n, false), PLACE.PLIC); // claim
  assert.equal(crosses(MAP.PLIC_BASE + 0x200004n, false), false);
  assert.equal(classify(MAP.UART0_BASE + 0x0n, true), PLACE.UART_TX); // THR write → crosses
  assert.equal(crosses(MAP.UART0_BASE + 0x0n, true), true);
  assert.equal(classify(MAP.UART0_BASE + 0x5n, false), PLACE.UART_LOCAL); // LSR read → local
  assert.equal(classify(MAP.VIRTIO_BASE + 0x70n, true), PLACE.VIRTIO_RING); // queue setup → local
  assert.equal(classify(MAP.VIRTIO_BASE + 0x50n, true), PLACE.VIRTIO_IO); // QueueNotify → crosses
  assert.equal(crosses(MAP.VIRTIO_BASE + 0x50n, true), true);
});

// ── AC2: zero-crossing CLINT — timer reads generate ZERO thread crossings over a read stream ─────
test("AC2: a stream of CLINT mtime reads produces ZERO ring crossings (timer path is worker-local)", () => {
  const reqSab = createRing(64);
  const respSab = createRing(64);
  const req = new SpscRing(reqSab.sab, reqSab.capacity);
  const resp = new SpscRing(respSab.sab, respSab.capacity);
  let mtime = 0n;
  const router = new WorkerDeviceRouter(req, resp, {
    clint: (_addr, write) => {
      if (!write) return mtime++; // mtime read advances a local counter
      return 0n;
    },
  });
  // Simulate the boot's hottest MMIO: 100k CLINT mtime reads (and a few mtimecmp writes).
  for (let i = 0; i < 100_000; i++) {
    router.mmio(MAP.CLINT_BASE + 0xbff8n, false, 8, 0n); // mtime read
    if (i % 1000 === 0) router.mmio(MAP.CLINT_BASE + 0x4000n, true, 8, BigInt(i)); // mtimecmp write
  }
  assert.equal(router.crossings, 0, "CLINT timer MMIO must NEVER cross threads");
  assert.equal(req.length(), 0, "nothing was ever enqueued on the request ring");
  assert.ok(router.localHits >= 100_000, "every timer access was serviced worker-local");
});

// ── Interrupt injection: a backend blk completion injects the PLIC source + wakes WFI ────────────
test("interrupt injection: blk completion → RESP_IRQ → worker sets PLIC pending + notifies", () => {
  const reqSab = createRing(16);
  const respSab = createRing(16);
  // Worker end.
  const wReq = new SpscRing(reqSab.sab, reqSab.capacity);
  const wResp = new SpscRing(respSab.sab, respSab.capacity);
  // Main end (same SABs, opposite roles).
  const mReq = new SpscRing(reqSab.sab, reqSab.capacity);
  const mResp = new SpscRing(respSab.sab, respSab.capacity);

  const pending = new Set(); // stand-in for worker-local PLIC pending bitmap
  let notifies = 0;
  const router = new WorkerDeviceRouter(wReq, wResp, {}, (srcId) => {
    pending.add(srcId); // set PLIC source pending (worker-local)
    notifies++; // Atomics.notify(WFI) analog
  });

  const server = new MainDeviceServer(mReq, mResp, {
    blkSubmit: () => {}, // synchronous backend for the test
  }, { blk: 1, net: 2 });

  // Guest kicks a virtio-blk queue-notify → crosses.
  const r = router.mmio(MAP.VIRTIO_BASE + 0x50n, true, 4, 1n);
  assert.equal(r, 0n, "a submit returns immediately (completion arrives as an interrupt)");
  assert.equal(router.crossings, 1);

  // Main thread services it and pushes the completion interrupt.
  assert.equal(server.drainOnce(), 1, "main serviced exactly one submit");

  // Worker drains the response ring → injects the interrupt.
  const latency = new LatencyStats();
  const n = router.drainResponses(latency);
  assert.equal(n, 1, "one completion drained");
  assert.ok(pending.has(1), "the blk PLIC source (1) is now pending — interrupt injected");
  assert.equal(notifies, 1, "the WFI cell was notified exactly once");
});

// ── LatencyStats: histogram + p50 sanity ─────────────────────────────────────────────────────────
test("LatencyStats: records per-crossing histograms and reports a plausible p50", () => {
  const s = new LatencyStats();
  for (let i = 0; i < 1000; i++) s.record("uart_tx", 50_000); // 50 µs each
  for (let i = 0; i < 1000; i++) s.record("blk", 1_500_000); // 1.5 ms each
  const snap = s.snapshot();
  assert.equal(snap.count.uart_tx, 1000);
  assert.ok(snap.uart_tx_p50_us >= 32 && snap.uart_tx_p50_us <= 128, `uart p50 ~50µs, got ${snap.uart_tx_p50_us}`);
  assert.ok(snap.blk_p50_us >= 1000 && snap.blk_p50_us <= 4000, `blk p50 ~1.5ms, got ${snap.blk_p50_us}`);
});
