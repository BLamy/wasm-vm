---
id: E0-T03
epic: 0
title: Guest physical RAM model and system bus trait with 1, 2, 4, and 8-byte accessors
priority: 3
status: in-progress
depends_on: [E0-T01]
estimate: M
capstone: false
---

## Goal
`wasm-vm-core` gains the machine's memory substrate: a `Bus` trait exposing fallible
little-endian `load8/16/32/64` and `store8/16/32/64`, a `Ram` implementation backed by a
heap-allocated byte slice, and the canonical guest physical memory map
(`DRAM_BASE = 0x8000_0000`, default 128 MiB) matching QEMU `virt` and Spike defaults.

## Context
Everything — fetch, load/store, MMIO, the ELF loader — goes through this trait. Choosing
`DRAM_BASE = 0x8000_0000` keeps us bit-compatible with Spike/QEMU so differential traces
(E0-T20) need no address translation. Policy decisions locked here: the bus requires
natural alignment (misaligned access returns `BusFault::Misaligned`, matching Spike's
default of raising misaligned exceptions), and out-of-range access returns
`BusFault::Access`. The CPU maps these to architectural traps in E0-T07/T08.

## Deliverables
- `crates/core/src/bus.rs`: `Bus` trait, `BusFault { Access, Misaligned }`, memory-map
  constants module (`mmap::DRAM_BASE`, `mmap::DRAM_SIZE_DEFAULT`).
- `crates/core/src/ram.rs`: `Ram::new(bytes)`, `Bus` impl, plus a `read_slice`/`write_slice`
  escape hatch for the loader; all bounds-checked with `u64` arithmetic (no `usize` wrap).
- Unit tests for every width at every interesting boundary; wasm-side mirror tests in
  `crates/wasm` via `wasm-bindgen-test` (run with `wasm-pack test --node`).

## Acceptance criteria
- [ ] All 8 accessors round-trip at `DRAM_BASE` and at the last naturally-aligned slot of RAM.
- [ ] A `load64` at `DRAM_BASE + size - 4` (straddling the end) returns `Access`, not a panic.
- [ ] Misaligned access at each width (addr % width != 0) returns `Misaligned`.
- [ ] `store32(a, 0xDEAD_BEEF)` then `load8` of a..a+4 yields `EF BE AD DE` (little-endian).
- [ ] Address arithmetic near `u64::MAX` returns `Access` without overflow panics
      (test with `debug_assertions` on).
- [ ] Same test suite passes natively and under `wasm-pack test --node`.

## Adversarial verification
Attack the boundaries. (1) Fuzz addresses around `DRAM_BASE - 8 .. DRAM_BASE + 8` and
`end - 8 .. end + 8` for all widths — any panic or wrong-variant fault refutes; (2) probe
`0x0`, `0x7FFF_FFFF_FFFF_FFF8`, and `u64::MAX - 7` in a debug build to force overflow
panics; (3) verify a faulting store leaves RAM bit-identical (snapshot before/after);
(4) run the suite under `cargo miri test -p wasm-vm-core` — UB findings refute; (5) confirm
wasm tests actually execute (check `wasm-pack test --node` output lists the boundary tests,
not 0 tests); (6) check `Ram::new(0)` and absurd sizes fail cleanly.

## Verification log
(empty)
