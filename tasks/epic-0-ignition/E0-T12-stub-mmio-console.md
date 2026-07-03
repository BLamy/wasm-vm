---
id: E0-T12
epic: 0
title: Stub MMIO console device for guest putchar output
priority: 12
status: implemented
depends_on: [E0-T04]
estimate: S
capstone: false
---

## Goal
A minimal write-only console device mapped at `0x1000_0000` (UART0 on the QEMU `virt`
board) that forwards every byte stored at offset 0 to a host-provided `ConsoleSink`
trait — the output organ the capstone's "Hello from RV64" travels through, in both the
native CLI (stdout) and the browser (JS callback → xterm.js).

## Context
Offset 0 is the 16550 THR, and we return `0x60` (THR empty + transmitter idle, bits 5|6 of
LSR) for reads at offset 5 so naive polling loops (`while (!(lsr & 0x20));`) terminate.
This makes the stub forward-compatible: Level 2 (E2) replaces it with a full 16550 model
at the same base address without relinking guest binaries. The sink is a core trait so the
core stays browser-ignorant (bet #2). Note for E0-T20: Spike has no device here, so
differential runs map this page as plain RAM on the Spike side (`spike -m`), keeping
instruction traces aligned while output only materializes on our side.

## Deliverables
- `crates/core/src/dev/console.rs`: `ConsoleSink { fn put_byte(&mut self, b: u8); }`,
  `Uart0Stub<S: ConsoleSink>` implementing `MmioDevice`; constant `mmap::UART0_BASE =
  0x1000_0000`, window length `0x100`.
- Semantics: writes to offset 0 emit the low byte regardless of access width (documented);
  writes to other offsets are ignored (debug-logged once per offset); reads return 0
  except offset 5 ⇒ `0x60`.
- `VecSink` test double; stdout sink lives in the CLI crate (std-only), JS-callback sink
  in the wasm crate (E0-T22).

## Acceptance criteria
- [ ] A guest loop `sb`-ing the bytes of "Hi\n\0\xFF" produces exactly `48 69 0A 00 FF`
      in `VecSink` — binary-safe, no UTF-8 validation, no newline translation.
- [ ] `sw`/`sd` to offset 0 emit exactly one byte (the low byte) — tested at every width.
- [ ] Reads at offset 0 return 0; at offset 5 return `0x60`; neither faults.
- [ ] A 1 MiB output flood completes; the sink contract documents that buffering policy
      belongs to the sink, not the device (no growth inside `Uart0Stub`).
- [ ] Tests pass natively and under `wasm-pack test --node`.

## Adversarial verification
(1) Byte-exactness attack: emit all 256 byte values and `cmp` the sink capture against the
expected 256-byte file — any translation (CRLF, lossy UTF-8) refutes. (2) Width attack:
`sd 0x4141414141414142` to offset 0 must yield a single `B` (0x42), not eight bytes.
(3) Boundary attack: store at `UART0_BASE + 0x100` (one past window) must be a bus access
fault, not a silent ignore. (4) Once E0-T18/T22 land, run the same guest under CLI and
under `wasm-pack test --node` and byte-compare captured output — divergence refutes.
(5) Check the once-per-offset logging can't allocate unboundedly under a hostile guest
writing to all 255 unused offsets in a loop.

## Verification log

### 2026-07-02 — worker claim — commit f331f8a (branch task/e0-t12-console, stacked on e0-t11)
Deliverables: crates/core/src/dev/console.rs — ConsoleSink{put_byte(&mut,u8)} CORE trait
(bet #2, browser-ignorant); Uart0Stub<S: ConsoleSink> impls MmioDevice; mmap::UART0_BASE=
0x1000_0000, UART0_LEN=0x100 (added to bus::mmap alongside DRAM_BASE). Semantics: writes to
THR (offset 0) emit the LOW byte at ANY access width (documented; sd of an 8-byte word →
ONE byte); writes to other offsets ignored + noted-once via a bounded [u64;4] bitmask (256
bits, no growth — a hostile guest hammering all 255 unused offsets costs O(1) device state,
angle 5); reads return 0 except LSR (offset 5) → 0x60 = THR-empty|tx-idle so naive
`while(!(lsr&0x20));` loops terminate; reads and writes NEVER fault. VecSink test double
(Rc<RefCell<Vec<u8>>> capture, crate-level so wasm mirrors + verifiers share it). Note for
E0-T20: Spike maps this page as RAM (spike -m) so traces align; output only on our side.
Tests: 3 core unit (low-byte-every-width, LSR-ready/THR-zero/no-faults incl. the misaligned
word-at-offset-5 fault, other-offset-ignored-logged-once) + 6 integration (binary-safe
Hi\n\0\xFF → 48 69 0A 00 FF; ALL 256 byte values byte-exact vs (0..=255).collect, angle 1
proactive; every-width-one-low-byte with len==4; one-past-window UART0_BASE+0x100 access
fault vs last-offset-ignored, angle 3; 1M flood + all-offsets hammer with device state
bounded; a GUEST PROGRAM printing "Hi!\n" via an li/sb loop stepped through the real hart)
+ 3 wasm32 mirrors. miri 11/11 lib + 6/6 integration (flood cfg(miri)-reduced 1M→5k).
Gates: fmt / clippy exit 0 / all native suites 0 FAILED (grep-checked per the local-gate
lesson) + wasm 0 FAILED / no_std wasm32 / CI green run 28631679218.
rr: SKIPPED locally (macOS/no PMU). Angle 4 (CLI vs wasm byte-compare) recorded for
E0-T18/E0-T22 when the stdout + JS sinks land.
