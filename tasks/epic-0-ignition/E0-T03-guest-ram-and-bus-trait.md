---
id: E0-T03
epic: 0
title: Guest physical RAM model and system bus trait with 1, 2, 4, and 8-byte accessors
priority: 3
status: verified
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

### 2026-07-02 — worker claim — commit 3b61fa4 (branch task/e0-t03-ram-bus, stacked on e0-t02)
Deliverables complete: `bus.rs` (Bus trait with fallible LE load/store at 8/16/32/64,
BusFault{Access,Misaligned}, mmap::DRAM_BASE=0x8000_0000 + DRAM_SIZE_DEFAULT=128MiB),
`ram.rs` (Ram::new/with_base through try_reserve_exact so absurd sizes are Err(OutOfMemory)
not aborts; read_slice/write_slice loader escape hatches; all bounds checks in checked u64).
POLICY DECISION locked in bus.rs docs: fault precedence Access-beats-Misaligned — required
for the acceptance pair (straddling load64 at base+size-4 → Access even though that address
is also 8-misaligned; in-range misaligned → Misaligned). Loads take &mut self (device reads
have side effects; E0-T04 MMIO implements the same trait).
Evidence, all green locally: cargo fmt/clippy(-D warnings)/test (12 native tests: round-trip
all widths at base and last slot, straddle→Access, misaligned→Misaligned per width, LE byte
order EF BE AD DE, extreme addrs 0x0/0x7FFF_FFFF_FFFF_FFF8/u64::MAX-7/u64::MAX with
debug_assertions on, faulting-store-leaves-RAM-identical, slice hatches, Ram::new(0) +
Ram::new(usize::MAX)→OutOfMemory); wasm-pack test --node crates/wasm (6 mirror tests
executed on wasm32/Node — count visible in output, not 0); cargo +nightly-2026-05-06 miri
test -p wasm-vm-core → 12/12, zero UB findings (73s).
Lockstep extension of E0-T02 deliverables: `wasm-pack test --node crates/wasm` appended to
BOTH ci.yml wasm job and Makefile wasm target (command-set parity preserved).
rr: SKIPPED locally (macOS/no PMU per AGENTS.md); deterministic native+miri+wasm test
output is the evidence layer; CI (Linux) run linked in PR.

### 2026-07-02 — adversarial verifier (fresh session) — VERDICT: verified
- P1 policy-forced (Access-beats-Misaligned) — HELD. Predicted criterion 2 unsatisfiable under opposite precedence: END-4 ≡ 4 (mod 8) for both test SIZE=64KiB (0x8000_FFFC) and DRAM_SIZE_DEFAULT=128MiB (0x87FF_FFFC). Mutation M1 (alignment checked first) turned straddling_the_end_is_access_not_panic red with observed Err(Misaligned) vs required Err(Access) at ram.rs:176, and the wasm mirror red at ram_bus.rs:42. The worker's "policy is forced by the acceptance pair" justification is arithmetic fact, honest.
- P2 boundary+random fuzz (task attack 1) — HELD. Predicted 0 mismatches/0 panics vs an independent u128 reference model; observed 0/0 across exhaustive [BASE-8,BASE+8] and [END-8,END+8] bands × 4 widths × load+store, 1.2M seeded random full-u64 cases (splitmix64, verifier seed 0x5EED_2026_0702_CAFE), and 300k slice-op fuzz cases (debug build, 0.29s).
- P3 overflow probes (task attack 2) — HELD. Predicted Err(Access), no panic, at 0x0, 0x7FFF_FFFF_FFFF_FFF8, u64::MAX-7 (w8), u64::MAX-3 (w4), u64::MAX-1 (w2), u64::MAX (all widths), plus read_slice(u64::MAX, 16B)/write_slice(u64::MAX-7, 16B)/zero-len-at-MAX; observed exactly that with debug_assertions asserted on in-test.
- P4 faulting stores bit-identical (task attack 3) — HELD. Predicted full-64KiB snapshot unchanged; observed identical before/after a model-guarded battery of faulting store8/16/32/64 + write_slice at both boundary bands, extremes, and misaligned-in-range. (First run flagged a mutation — traced to MY battery firing legitimately-valid stores (store8 at END-7 is in-range); fixed my test, implementation exonerated. Re-check done.)
- P5 miri (task attack 4) — HELD. Predicted clean; observed 12/12 worker tests (73.2s) plus 8/8 verifier adversarial tests (69.9s, 1000-case reduced fuzz) under cargo +nightly-2026-05-06 miri test -p wasm-vm-core, zero UB findings.
- P6 wasm execution (task attack 5) — HELD. Predicted 6 named tests, not 0; observed local cold-clone wasm-pack test --node crates/wasm: "running 6 tests" → all 6 names → "test result: ok. 6 passed; 0 failed", and CI run 28587670133 wasm job (ID 84763219825) log shows the same 6 names + "6 passed" at 2026-07-02T11:49:57Z. Sabotage-proof: under M1 the wasm suite went red (1 failed), so its assertions execute on wasm32.
- P7 zero/absurd sizes (task attack 6) — HELD. Ram::new(0) → Ok, every access/store at 0, BASE±1, u64::MAX faults Access; usize::MAX & isize::MAX → Err(OutOfMemory); 1<<50 and 1<<46 allocator-refused → clean Err(OutOfMemory); 1<<45 (32TiB) reservation GRANTED by macOS overcommit — allowed "working RAM" behavior per criterion; memset deliberately skipped to protect host.
- P8 mutations — HELD (3/3 killed). M1 precedence swap → 2 native + 1 wasm red; M2 DRAM_BASE→0x4000_0000 → default_map_constants red (constant pinned by literal, not tautology); M3 write_slice range check removed → slice_escape_hatch test red (panic ram.rs:91). All reverted.
- P9 claim accuracy — HELD with a wording note. "12 native tests" observed exactly, but 3 are pre-existing E0-T01 lib.rs tests; 9 are new to E0-T03. Count honest as suite total; phrasing mildly inflates task-specific coverage. Not a refutation.
- rr — SKIPPED loudly: macOS host, no PMU (AGENTS.md platform table). Mitigation layers all green: deterministic native 12/12, miri 20/20 zero-UB, wasm32-on-Node 6/6 local + CI Linux run 28587670133 (7/7 jobs). Host-layer rr interrogation begins with E0-T20/T25 on Linux.
- COVERAGE: ci.yml +1 — exercised by CI run 28587670133 wasm job; Makefile +1 — same command run locally; parity textually identical. Cargo.lock/wasm Cargo.toml — waived (manifests, exercised by the wasm run). lib.rs +3 — waived (module decls). bus.rs: both BusFault variants observed, mmap constants pinned (M2 kills), all 8 trait methods exercised via Ram. ram.rs: new/with_base/is_empty/base/index (all 3 fault arms + Ok; M1 kills)/range (M3 kills)/read_slice/write_slice/all 8 accessors — each has a killing test. len() was never called by any worker test — now asserted in the promoted verifier suite. No dead hunks.
- MOCK/HONESTY: no self-licking tests — all worker expectations are literals, never computed from the code under test; verifier model was independent u128 arithmetic. No #[ignore] in worker tests, no cfg(test) semantic leaks, no profile overrides, env scrubbed. Hashes honest: b074dec−3b61fa4 touches tasks/ only. Notes: (a) "12 native tests" phrasing per P9; (b) stale pre-existing lib.rs doc ("E0-T03 replaces the bare Vec") — Machine still holds Vec<u8>; not in this diff — informational, no-fire.
- NOVEL: (a) RAM ending exactly at u64::MAX (with_base(u64::MAX-15, 16)) — legal load8(u64::MAX)/load16(MAX-1)/load32(MAX-3)/load64(MAX-7) all Ok with correct LE bytes; a naive addr+width bound would spuriously fault; implementation survives — HELD, plus 150k fuzz cases at that base, miri-clean. (b) with_base where base+len exceeds u64::MAX: constructor permits an unaddressable tail; verified no wraparound access can ever reach it — safe; constructor validation unspecced, noted not raised.
- SUITE: promote — verifier_fuzz.rs (9 tests: u128-model boundary/random/slice fuzz, overflow probes, full-RAM faulting-store snapshot, top-of-address-space, no-wrap tail, zero-size, ignored absurd-size probe) into crates/core/tests/; it killed M1 on contact and closes the len() gap. promote — worker's 9 native + 6 wasm tests as committed (all proved live by mutation). promote — wasm-pack test --node in Makefile+CI stays as the standing verify target. discard — nothing.
Commands: cold clone (env scrubbed); cargo fmt/clippy/test; cargo test --test verifier_fuzz; cargo +nightly-2026-05-06 miri test -p wasm-vm-core (20 passed, 0 UB); wasm-pack test --node crates/wasm; gh run view 28587670133 (+ wasm job log); 3 mutations via sed + cargo test + git checkout; cargo clean.

### 2026-07-02 — post-verdict suite promotion (worker)
Promoted the verifier's suite verbatim into crates/core/tests/verifier_fuzz.rs with three
mechanical clippy fixes (values/semantics unchanged): hex literal regrouped 0x0DDB_A11→
0x00DD_BA11, addr % w != 0 → !addr.is_multiple_of(w), constant assert! → if+panic!.
Gates re-earned: fmt + clippy -D warnings + cargo test (12 unit + 8 fuzz + 1 ignored) green.
