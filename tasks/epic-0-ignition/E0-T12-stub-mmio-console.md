---
id: E0-T12
epic: 0
title: Stub MMIO console device for guest putchar output
priority: 12
status: in-progress
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
(empty)
