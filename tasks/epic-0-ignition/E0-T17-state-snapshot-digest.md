---
id: E0-T17
epic: 0
title: Machine state snapshot and deterministic digest for test assertions
priority: 17
status: implemented
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
### 2026-07-03 — worker claim — branch task/e0-t17-snapshot (stacked on e0-t16)
Deliverables: crates/core/src/snapshot.rs — Snapshot{pc:u64, xregs:[u64;32], mem_digest:[u8;32]}
(Clone, PartialEq, Eq, Debug-as-hex), Machine::snapshot() (&self, pure), Snapshot::hex_digest()
-> String (alloc, always avail — crate links alloc unconditionally, no feature gate), and
Snapshot::state_sha256_line() = "state sha256=<64 hex>" (frozen final line the CLI --dump-state
prints after the E0-T05 XRegs dump; flag wiring is the E0-T18 integration point, mirroring how
E0-T16 shipped the trace serializer and deferred --trace). Ram::as_bytes() added as the canonical
digest input (whole byte array in address order; device+hart state are struct fields, NOT digest
input). Digest = SHA-256 via sha2 0.10 default-features=false (no_std; crypto hash chosen over a
fast one because cross-platform bit-stability is the whole point of an assertion helper).
KNOWN-ANSWER independence: KAT digests computed OUTSIDE the crate in Python (hashlib.sha256): 1 MiB
of byte[i]=i%251 -> 631b8402...e4f769; 1 MiB zeros -> 30e14955...9fcb58.
Tests (crates/core/tests/snapshot.rs, 6): (1) KAT — fresh 1 MiB hashes to the zero-buffer answer,
seeded mod-251 to the committed Python answer, hex_digest==mem_digest; (2) flip-sensitivity — 100
offsets incl. 0 and size-1, each single-byte flip changes the digest and restore returns it; (3)
tail coverage — poking the LAST RAM byte changes the digest (kills digest-only-loaded-segments);
(4) stability — two zero-step snapshots identical, x0 image always 0; (5) cross-build golden —
loops.elf @ 1 MiB -> exact pc/all-32-xregs/digest (0a18330c...376a48), asserted identically by the
wasm32 test so native==wasm transitively; (6) PURITY — loops traced uninterrupted vs. snapshot()
every 100 steps: identical retired-instruction trace AND identical final Snapshot.
wasm crates/wasm/tests/snapshot.rs asserts the same 1-MiB golden on wasm32 (pc 0x80000040, x2=sp
0x80002090, x10=1, digest 0a18330c…).
sha2 no_std: cargo tree --no-default-features shows sha2 pulled WITHOUT its std/asm features.
128 MiB digest timing (informational, no threshold): ~0.55 s release; documented in snapshot.rs.
Gates: fmt clean; clippy --workspace --all-targets --all-features -D warnings exit 0 (fixed a
manual-is_multiple_of lint); native default 0 FAILED; native trace 0 FAILED; workspace 0 FAILED;
snapshot suite 6/6; wasm-pack test --node all green incl. the wasm snapshot golden; all 4 native +
2 wasm32 feature combos build; check-zero-cost --selftest OK.
rr: N/A locally (macOS); no unsafe introduced (Ram::as_bytes is &self.data) so miri adds nothing
over the suite and CI runs no miri step. Verifier angles left open: independent shasum -a 256 of a
RAM dump vs mem_digest (angle 1), 10k-instr memops native-vs-wasm Snapshot (angle 3), and a
partial-coverage mutation (digest only loaded segments / skip last page) — flip+tail tests target
exactly that.
