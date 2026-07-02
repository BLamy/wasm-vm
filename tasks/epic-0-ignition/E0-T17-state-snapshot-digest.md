---
id: E0-T17
epic: 0
title: Machine state snapshot and deterministic digest for test assertions
priority: 17
status: pending
depends_on: [E0-T07]
estimate: S
capstone: false
---

## Goal
A `Machine::snapshot()` producing `Snapshot { pc: u64, xregs: [u64; 32], mem_digest:
[u8; 32] }` — the memory digest a SHA-256 over all of guest RAM — so any two runs (native
vs. wasm, trace-on vs. trace-off, before-refactor vs. after) can be asserted identical
with one comparison, platform-independently.

## Context
Cross-build determinism is Epic 0's core promise and this is its cheapest measuring
instrument: dozens of later tasks (JIT differential testing in E4, snapshot/restore in E3)
assert "same architectural state" and need a canonical definition *now*. SHA-256 via the
`sha2` crate (no_std-capable, `default-features = false`) rather than a fast
non-cryptographic hash: cross-platform stability and zero collision arguments matter more
than speed in an assertion helper. Digest input is exactly the RAM byte array in address
order — device and hart state are in the struct fields, not the digest.

## Deliverables
- `crates/core/src/snapshot.rs`: `Snapshot` (with `PartialEq`, `Debug`), `Machine::
  snapshot()`, and `Snapshot::hex_digest() -> String` (std/alloc-gated) for display.
- CLI flag `--dump-state` (E0-T18 integration point) printing pc, all registers in the
  E0-T05 dump format, and the hex digest as the final line `state sha256=<64 hex>`.
- Tests: digest sensitivity (flip one RAM byte anywhere ⇒ different digest), stability
  (snapshot twice with zero steps between ⇒ identical), and a committed known-answer test
  (fixed RAM contents ⇒ fixed digest hex).

## Acceptance criteria
- [ ] Known-answer test passes: seeded 1 MiB RAM pattern yields the committed SHA-256.
- [ ] Running `loops.elf` to completion natively and under `wasm-pack test --node` yields
      byte-identical `Snapshot` values (pc, all xregs, digest).
- [ ] Flipping any single sampled byte (fuzz 100 random offsets incl. offset 0 and
      `size - 1`) changes the digest.
- [ ] `snapshot()` does not mutate state: two consecutive calls are equal and a trace of
      subsequent execution is unchanged versus a run without snapshots.
- [ ] 128 MiB digest time measured and documented (informational, no threshold).

## Adversarial verification
(1) Independent recomputation: dump guest RAM to a file from the CLI and run system
`shasum -a 256` — mismatch with `mem_digest` refutes (this catches partial-coverage bugs
like digesting only loaded segments). (2) Tail coverage: load a small ELF, poke the *last*
byte of RAM through the bus, snapshot — unchanged digest refutes full-RAM coverage.
(3) Cross-build attack: run `memops.elf` for exactly 10,000 instructions on native and
wasm and compare snapshots — any field diverging refutes (pin down float/endian
assumptions; there should be none). (4) Purity attack: interleave `snapshot()` calls
every 100 steps of a 10k-step run and compare the final trace against an uninterrupted
run. (5) Verify `sha2` is compiled with `default-features = false` in the no_std build
(`cargo tree -p wasm-vm-core --no-default-features -e features`).

## Verification log
(empty)
