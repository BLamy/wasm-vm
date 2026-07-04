---
id: E1-T26
epic: 1
title: Misaligned load/store support — ma_data (Priv §3.6.3 / Unpriv §2.6)
priority: 126
status: pending
depends_on: [E1-T25]
estimate: M
capstone: false
---

## Goal
Support misaligned loads and stores to regular (main-memory) regions so that
`rv64ui-p-ma_data` passes, burning that entry from `tests/riscv-tests-allowlist.txt`. A
Level-1 RV64GC machine that will host xv6/Linux must not fault every unaligned access.

## Context
E0-T08 chose to fault ALL misaligned data accesses (the `ma_data` allowlist entry documents
this as deliberate). The spec permits an implementation to either handle misaligned accesses
in hardware OR trap them for emulation; a hosted OS expects them to WORK for normal memory.
This task makes misaligned accesses to RAM succeed (decomposed into aligned sub-accesses,
preserving byte order and atomicity-at-XLEN-not-required semantics), while still faulting
misaligned accesses that cross into a region where they are not permitted (MMIO, PMP
boundary) with the correct §3.7.1 priority (hence the E1-T25 dependency).

Interaction with E1-T25: once misaligned accesses to RAM succeed, the misaligned-vs-fault
priority only applies to misaligned accesses that ALSO fault for another reason — E1-T25
must land first so this task doesn't reintroduce an ordering ambiguity.

## Deliverables
- Misaligned data-access handling in the load/store path: an access to a valid, permitted
  RAM range completes even when `va & (len-1) != 0`, with correct little-endian byte
  assembly; MMIO / cross-region / PMP-denied misaligned accesses still fault per §3.7.1.
- `AMO`/LR-SC misalignment still faults `Load/StoreAddrMisaligned` (atomics require natural
  alignment — Unpriv §8.2), verified.
- Remove `rv64ui-p-ma_data` from `tests/riscv-tests-allowlist.txt`.
- Regression tests: misaligned lw/ld/sh/sd/lh crossing word/page boundaries within RAM;
  misaligned AMO still faults; misaligned access straddling a PMP boundary faults.

## Acceptance criteria
- [ ] `rv64ui-p-ma_data` passes end-to-end; allowlist entry removed; the riscv-tests CI
      wall (E1-T19) stays green with the smaller allowlist.
- [ ] Misaligned AMO/LR/SC still raise the misaligned trap (alignment required for atomics).
- [ ] `cargo test --workspace` and `make riscof` green; the trace fingerprint (T22) stays
      native==wasm for a misaligned-access program.

## Adversarial verification
Attack byte order: a misaligned store then aligned loads of the overlapping bytes must read
back exactly what a byte-wise model predicts (compare against Spike). Attack the boundary: a
misaligned access with its low half in RAM and high half past RAM-end must fault, not read
garbage. Attack atomics: confirm misaligned `amoadd`/`lr`/`sc` still fault. Fuzz (E1-T21,
once loads/stores land in the generator) misaligned accesses against Spike. Confirm the
determinism fingerprint is identical native vs wasm for a misaligned-heavy program.

## Verification log
(empty)
