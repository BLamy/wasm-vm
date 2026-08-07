# E4-T23 — Split-device placement: what runs where, and why

The CPU dispatch loop (interpreter + JIT) runs on a dedicated Web Worker against a shared
`WebAssembly.Memory` (E4-T22). The main thread keeps the DOM / xterm.js / real backends. Every MMIO
round trip that crosses that thread boundary is a potential 100 µs+ stall of guest execution, so the
design minimises *crossings*, not just crossing cost. This document is the authoritative device
**placement matrix**; `web/device-proxy.js#classify()` is its executable form, and the placement
audit (`tools/worker-device-audit.mjs`, adversarial #5, wired into CI) fails the build if worker-side
device code ever reaches a main-thread-only API. The implementation MUST match this table.

## Placement matrix

| Device / region | Base (guest phys) | Where it runs | Why | Crosses? |
|---|---|---|---|---|
| **CLINT** (mtime / mtimecmp / msip) | `0x0200_0000` | **CPU worker (local)** | `mtime` reads are the single hottest MMIO in a booted Linux (every scheduler tick, every `ktime` read). A cross-thread round trip here would dominate the profile. The timer has no backend — it is pure register state derived from the retire clock. | **NEVER** |
| **PLIC** (priority / enable / threshold / claim / complete) | `0x0C00_0000` | **CPU worker (local)** | The interrupt controller is queried on *every* trap and every claim/complete handshake. Its pending bitmap is fed by device *levels*; the worker owns the whole gateway. Interrupt injection sets a source's pending *level* here (see below). | **NEVER** |
| **virtio-mmio ring bookkeeping** (queue setup, status, config, avail/used ring walks) | `0x1000_1000` + `i*0x1000` | **CPU worker (local)** | The virtqueues live in guest RAM, which is *already shared*. The worker parses descriptors, walks the avail/used rings, and updates ring indices locally. Only the moment a request must actually hit a backend does anything cross. | **NEVER** |
| **virtio-mmio `QueueNotify`** (reg `0x50` write) | (as above, offset `0x50`) | **crosses → main / I/O worker** | This is the "kick": submit the assembled descriptor chain to the real backend (block → IndexedDB/OPFS, net → fetch/WebSocket). The only virtio access that is genuine backend I/O. | **yes** (`BLK_SUBMIT` / `NET_TX`) |
| **UART16550 status + RX** (LSR, IER, IIR, MCR, RBR read) | `0x1000_0000` | **CPU worker (local)** | Status registers are mirrored worker-side; the RX byte is served from a worker-local FIFO the main thread fills on a keypress (a keypress crosses main→worker as data + an IRQ, never as a synchronous read). | **NEVER** |
| **UART16550 TX** (THR write, reg `0x0`) | `0x1000_0000` | **crosses → main** | A transmitted byte must reach the xterm.js endpoint, which is a DOM object on the main thread. | **yes** (`UART_TX`) |
| **RTC (goldfish)** | `0x0010_1000` | CPU worker (local) | Read-mostly wall-clock; derived from a shared time base, no backend. | NEVER |
| Guest RAM | `0x8000_0000` | shared SAB | Not MMIO; both threads map the same `WebAssembly.Memory`. | n/a |

**Backends (main-thread-owned):** xterm.js UART endpoint, IndexedDB / OPFS block storage, network
(slirp/fetch/WebSocket). These are the only things that pull a crossing.

## The OPFS-SyncAccessHandle decision

`FileSystemSyncAccessHandle` — the only *synchronous* (and fast) OPFS path — is **worker-only**: it
throws on the main thread. That pulls the block backend toward a worker, not the main thread. Two
options were considered:

1. **Block I/O on the main thread** via async OPFS (`createWritable`) or IndexedDB. Simple (one place
   owns all backends) but gives up the synchronous, low-overhead SyncAccessHandle path and puts disk
   I/O on the same thread as the UI.
2. **A dedicated I/O worker** that owns the OPFS SyncAccessHandles, reachable from the CPU worker
   *without a main-thread hop*.

**Decision: a dedicated I/O worker owns OPFS SyncAccessHandles**, and the CPU worker reaches it over
the *same SPSC ring protocol* used for the main thread (the ring SAB is just shared with the I/O
worker instead of, or in addition to, the main thread). Rationale:

- Keeps the fast synchronous OPFS path (SyncAccessHandle) available — it is the whole performance
  argument for OPFS over IndexedDB.
- Avoids a CPU-worker → main → I/O-worker double hop for every block request; the CPU worker's
  `BLK_SUBMIT` crossing lands directly on the I/O worker.
- Keeps disk I/O off the main thread entirely, so a slow flush cannot jank the UI (AC4).

The UART tx / keystroke path still crosses to the **main** thread (xterm.js is DOM). So there are two
consumer ends: the main thread (UART, net-via-fetch) and the I/O worker (block via OPFS). Both are
plain `MainDeviceServer`-shaped consumers of an SPSC request ring; the classification in
`classify()` decides which ring a crossing goes to. IndexedDB remains the fallback block backend when
OPFS is unavailable (older browsers), serviced on the main thread — same protocol, different consumer.

## Crossing protocol (SPSC rings)

`web/device-proxy.js`. Two lock-free single-producer/single-consumer rings per consumer, in a
SharedArrayBuffer:

- **REQUEST ring** (CPU worker → consumer): `UART_TX`, `BLK_SUBMIT`, `NET_TX`.
- **RESPONSE ring** (consumer → CPU worker): `RESP_OK` (a read result) and `RESP_IRQ` (a device
  completion that injects an interrupt).

Each slot is **cache-line padded** (64 B = 16×`i32`); the ring's HEAD (producer) and TAIL (consumer)
live on **separate cache lines** to avoid false sharing. Every slot carries:

- a **sequence tag** `S_SEQ` = its ring position + 1, written *last* (release) so a consumer never
  reads a half-published slot and can detect a stale/wrapped slot; and
- a **correlation tag** `S_TAG` the request generates and the response echoes, so a response can
  never be applied to the wrong request.

**Overflow is signalled, never silent.** When the ring is full (`HEAD − TAIL == capacity`) `push`
refuses and bumps an `OVERFLOW` counter — the producer backpressures (retries), it never overwrites
an unconsumed slot. This is what the adversarial ring-flood test asserts: under a simultaneous UART +
blk flood the ring fills, every refusal is counted, no MMIO is lost, no response is matched to the
wrong request, and draining releases the backpressure (no deadlock).

**Consumer parks with `Atomics.waitAsync`** on the request ring's HEAD — legal on the main thread
(`Atomics.wait` throws there). The worker side, on the rare synchronous read that has no local mirror,
uses `Atomics.wait` on the response cell with a deadline (so a janked main thread hits the deadline
fallback instead of stalling the guest — adversarial #4, deferred to the browser leg).

## Interrupt injection

A backend completion (block read done, frame received) does **not** cross as a return value. Instead:

1. The consumer (main / I/O worker) pushes a `RESP_IRQ` carrying the device's **PLIC source id**.
2. The CPU worker drains the response ring, calls the worker-local PLIC to set that source's pending
   **level** (`set_level(id, true)` — PLIC state is worker-side, so claim/complete never crosses),
   and bumps + `Atomics.notify`s the WFI cell (`cpu-control-block` IRQ counter).
3. A parked worker (WFI) wakes; a running worker picks it up at the next block boundary.

**Delivery inside a JIT chain.** The E4-T18 chained executor re-checks the interrupt budget at every
block→block link. E4-T23 adds `sync_plic()` to that per-link poll (`crates/core/src/lib.rs`
`try_jit_block`) alongside `sync_clint`/`sync_sbi_timer`, so an injected device completion is mirrored
into `mip.MEIP`/`mip.SEIP` and delivered within **one block (≤128 ops)** of becoming pending — even
inside a fully-chained hot loop. Without it a device IRQ was only sampled when the chain happened to
exit to dispatch, delaying a blk completion by thousands of loop iterations; the native directed test
`device_completion_fires_inside_chained_loop` (in `crates/jit-runtime/tests/chaining.rs`) is the
regression guard (loop advances ≤ 64 iterations between injection and delivery, vs ~30 000 before).

## Latency instrumentation

`web/device-proxy.js#LatencyStats` — per-crossing-type log2-bucketed nanosecond histograms
(`uart_tx`, `blk`, `net`), the JS-side ProfStats (the crossings physically happen in JS). p50 is read
off the cumulative distribution. Budgets (enforced in the browser CI leg on `dev`): UART char
round-trip p50 < 100 µs (worker-local echo path), virtio-blk 4 KiB read submit→completion p50 < 2 ms
(IndexedDB) / faster on OPFS, keystroke→guest-visible < 5 ms.

## What is verified where

- **Headless (node / native, verified here):** SPSC ring protocol + sequence tags + flood/no-loss
  (`web/tests/device-proxy.test.mjs`), zero-crossing CLINT counter (AC2, same file), interrupt
  injection under JIT chaining (AC5, `crates/jit-runtime/tests/chaining.rs`), placement audit
  (`tools/worker-device-audit.mjs`, adversarial #5).
- **Browser / `dev` box (deferred — macOS OS-reaps the cross-thread boot):** Alpine boot on the split
  arch + `dd` throughput ≥ 90 % of E3 + typing echo (AC1), Chrome+Firefox budget tests (AC3), main
  <1 % idle CPU / no busy-wait (AC4), and adversarials #2 (10 k-completion flood), #3 (50× teardown
  race), #4 (janked-main sync-read deadline). Playwright specs are committed under `web/tests/` so
  they drop in on `dev`; NO fabricated numbers are recorded.
