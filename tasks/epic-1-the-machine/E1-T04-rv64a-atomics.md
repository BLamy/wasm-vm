---
id: E1-T04
epic: 1
title: RV64A atomics — LR/SC reservation semantics and all AMO operations
priority: 104
status: verified
depends_on: [E1-T01]
estimate: M
capstone: false
---

## Goal
Full A-extension support: LR.W/LR.D with a reservation set, SC.W/SC.D with spec-legal
success/failure behavior, and all 18 AMO instructions (AMOSWAP/ADD/XOR/AND/OR/MIN/MAX/
MINU/MAXU × W/D) as atomic read-modify-writes, with aq/rl bits decoded (no-ops for a
single in-order hart, but preserved in the decoder for the Epic 6 SMP future).

## Context
Unprivileged spec "A" chapter. Linux's spinlocks, futexes, and refcounts are LR/SC and
AMO; a subtly wrong SC (e.g. one that always succeeds) boots further than you'd expect
and then corrupts userspace — this must be right *now*, not debugged at Level 2. Key
semantics: SC writes 0 on success, nonzero (we use 1) on failure; SC succeeds only against
a valid reservation from an earlier LR on the same hart covering the address; any store or
intervening SC invalidates the reservation; we additionally invalidate on traps and on
MRET/SRET (legal, and matches Spike's conservatism). AMOs and LR/SC to misaligned
addresses raise address-misaligned (cause 6/4 store/load AMO) — never rotate/split.

## Deliverables
- Reservation state on the hart: `Option<(addr, width)>` with documented invalidation
  points (store overlap, SC execution, trap entry, xRET, WFI).
- Decode + execute for LR/SC/AMO, W forms sign-extending loaded values per spec.
- AMO min/max signed vs unsigned arms with W-form 32-bit comparison (not 64-bit).
- Unit tests: LR→SC success; LR→store→SC fail; SC without LR fails; back-to-back SC
  (second fails); AMOMIN.W with negative values; misaligned AMO traps with correct mtval.
- rv64ua-p-* passing under the bare-metal harness.

## Acceptance criteria
- [ ] SC after matching LR returns 0 and performs the store; SC with no/invalidated
      reservation returns 1 and does not touch memory (asserted by memory readback).
- [ ] An ordinary store to the reserved doubleword between LR and SC forces SC failure.
- [ ] AMOADD.W to a location holding 0xFFFF_FFFF wraps 32-bit and sign-extends rd (old
      value) correctly; AMOMAXU.W treats 0x8000_0000 as large, AMOMAX.W as negative.
- [ ] LR.D/SC.D/AMO*.D at addr % 8 != 0 and W-forms at addr % 4 != 0 raise misaligned
      exceptions with mtval = the faulting address.
- [ ] All rv64ua-p tests pass; results identical native vs wasm32.

## Adversarial verification
Attack the reservation lifecycle: craft sequences Spike also runs and diff — LR.W then
SC.D to the same address (width mismatch: spec permits failure; we must at minimum match
our own documented policy and never *succeed with the wrong width write*); LR, take a
timer-less ECALL trap, MRET, SC (must fail per our documented policy); LR to address A,
SC to A+4 within the same reservation granule. Fuzz all AMOs against Spike with random
memory contents including sign-boundary values. Verify rd=rs1 aliasing for AMOs (old
value must land in rd even when rd==rs2 source register). Confirm the aq/rl bits are
accepted for every AMO encoding (all four combinations decode; an illegal-instruction
trap on aq=rl=1 is a refutation). Check that no AMO performs a partial write when it
traps on misalignment (memory unchanged).

## Verification log

### 2026-07-03 — worker (implementation claim)
LR.W/D, SC.W/D, and all 18 AMOs (SWAP/ADD/XOR/AND/OR/MIN/MAX/MINU/MAXU × W/D) as decode
variants + execute arms. Key design decisions:
- **Reservation state** `Hart::resv: Option<(addr, width_bytes)>`. Set by LR; SC succeeds
  only if `resv == Some((sc_addr, sc_width))` — an address OR width mismatch fails (LR.W
  then SC.D never does a wrong-width write). SC always consumes the reservation.
- **Invalidation** is centralized at the single retirement point: any *successful* store
  (ordinary SB..SD and the AMO writes) whose range overlaps the reservation granule clears
  it — so a faulting store never invalidates (trap purity). Also cleared on MRET and WFI
  (documented conservative policy; matches Spike's conservatism). Verified by the official
  `lrsc` test passing.
- **aq/rl** decoded (all four combinations legal, incl. aq=rl=1) but no-ops for one
  in-order hart — preserved for the Epic 6 SMP future.
- **Not feature-gated** (like M): AMO decodes in both default and `zicsr-stub` builds; the
  rv64ui-p path never executes atomics, so it is inert there (rv64ui-p still passes).
- **Misalignment:** LR faults on its load leg → cause 4 (load-misaligned); SC/AMO
  pre-check alignment → cause 6 (store/AMO-misaligned), `mtval` = faulting address, with NO
  partial write. LR requires `rs2 == 0` (reserved field; nonzero is illegal — keeps decode
  injective).
- **AMO** = load → op → store (atomic for a single hart); `rd` = OLD value, sign-extended
  for W. MIN/MAX use a 32-bit comparison for W (signed for MIN/MAX, unsigned for MINU/MAXU),
  64-bit for D.

Evidence (local, macOS + reference toolchain):
- `cargo test -p wasm-vm-core --test rv64a` — 13/13: LR→SC success; store-between-LR-SC
  failure (mem untouched); SC-without-LR; back-to-back SC (second fails); width-mismatch SC
  (no wrong-width write); MRET clears reservation; AMOADD.W 32-bit wrap + sign-extended rd;
  MIN/MAX/MINU/MAXU.W signedness; bitops/swap; AMO.D full-width; rd==rs1 and rd==rs2
  aliasing (old value lands in rd); misaligned AMO/SC → cause 6 no partial write;
  misaligned LR → cause 4.
- **Official riscv-tests rv64ua-p: all 19 ELFs pass** (18 AMO*_w/_d + `lrsc`) via `tohost`
  (`riscv_tests.rs::rv64ua_p_suite_all_pass`). Built reproducibly by
  `tools/riscv-tests/build-rv64ua.sh` (`-march=rv64ia_zicsr`), committed to
  `tests/riscv-tests-bin/`. rv64um-p + rv64ui-p still pass.
- wasm32: `crates/wasm/tests/rv64a.rs` passes under BOTH `wasm-pack test --node crates/wasm`
  and `--features zicsr-stub` — reservation + AMO semantics identical to native.
- Decoder space: exhaustive 2^32 release sweep passes with the updated analytic tally
  **238,723,077** (= 56·2^22 + 20·2^17 + 3·2^16 + 31·2^15 + 2^13 + 5; A-ext adds 2^13 LR +
  20·2^17 SC/AMO). `decode_props` round-trips all legal AMO words (LR/SC/AMO × W/D × all
  aq/rl) + a reserved-encoding negative (bad funct3, reserved funct5, LR rs2!=0);
  `decode_golden` updated.
- Gate: `cargo fmt --all --check` clean, `cargo clippy --workspace --all-targets` 0
  warnings, `cargo test --workspace` 0 FAILED.

### 2026-07-03 — adversarial verifier (fresh cold clone) — VERDICT: verified
Could not refute after all eight attacks.
- **rv64ua-p:** all 19 ELFs (18 AMO + `lrsc`) exit 0 under `spike --isa=rv64ia` (each ran
  individually) AND `rv64ua_p_suite_all_pass` passes (harness asserts 19 entries).
- **AMO differential, 600,000 ops, 0 divergences.** Independent Rust ISA oracle
  (`oracle_w`/`oracle_d` via `i32/i64::min/max`) vs `Hart::step`, random ops (9 × W/D),
  memory/rs2 biased to sign boundaries (0x8000_0000/0x7FFF_FFFF/0xFFFF_FFFF/i64::MIN/MAX/
  0/1/-1), rs1/rs2/rd aliasing (incl. rd==x0). Compared BOTH rd (sext old for W) and the
  resulting memory word. W MIN/MAX signedness confirmed a 32-bit compare (non-canonical
  upper bits truncated before compare).
- **Reservation lifecycle:** LR.W→SC.D width mismatch fails, no wrong-width write; LR to A
  → SC to A+4 fails; LR→WFI→SC fails (WFI clears resv), MRET-clears covered by committed
  test; non-overlapping adjacent store → SC succeeds, partially-overlapping store → SC
  fails (`overlaps()` correct); back-to-back SC second fails; success returns 0 + writes,
  failure returns 1 + writes nothing (readback confirmed).
- **Misalignment / no partial write:** LR→cause 4, SC/AMO→cause 6, mtval = faulting addr,
  memory byte-for-byte unchanged (pre-checked; the bus also enforces alignment and the AMO
  load precedes the store, so no partial write is possible even on the access-fault path).
- **aq/rl:** all 4 combinations (incl. aq=rl=1) of all 11 funct5 × both widths decode Ok.
- **Panic hunt:** none — AMO one-past-RAM-end → clean StoreAccessFault (7); overflow
  operands use `wrapping_add`; 2^32 decode sweep panics on nothing.
- **Mutation audit (7):** SC-always-succeeds, SC-ignores-width, AMOMIN.W-unsigned-compare,
  drop-sext32-on-AMO.W-rd, never-invalidate-on-overlapping-store, misaligned-AMO.W-cause-4
  — each caught by a committed test. The lone survivor (remove the AmoW misalign pre-check)
  is a **provably equivalent** mutation: the bus returns `BusFault::Misaligned` → cause 6
  via `store_fault`, and the load precedes the store, so cause + no-partial-write are
  unchanged. Not a bug.
- **Decoder tally:** 238,723,077 matches the brute-force 2^32 sweep; reserved AMO encodings
  (bad funct3, reserved funct5, LR rs2≠0) decode illegal.
- **Gate:** fmt --check exit 0; clippy 0 warnings; `cargo test --workspace` no FAILED;
  riscv_tests 3 passed; exhaustive passes. Working tree left clean.

VERIFIED — E1-T04 complete.
