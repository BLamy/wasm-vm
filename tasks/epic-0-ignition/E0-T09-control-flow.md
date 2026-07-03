---
id: E0-T09
epic: 0
title: Control flow — JAL, JALR, conditional branches, FENCE, and target-misalignment traps
priority: 9
status: verified
depends_on: [E0-T07]
estimate: M
capstone: false
---

## Goal
`Hart::step` executes JAL, JALR, BEQ/BNE/BLT/BGE/BLTU/BGEU, and FENCE with exact
Unprivileged ISA §2.5 semantics: link value `pc + 4` written after target computation
(so `jalr rd == rs1` works), JALR target `(rs1 + sext(imm)) & !1`, and a *taken* transfer
to a non-4-byte-aligned target raising instruction-address-misaligned (cause 0,
`tval` = target) — since IALIGN=32 without the C extension.

## Context
§2.5: the misaligned-target exception is raised by the jump/branch itself, not by the
subsequent fetch; a *not-taken* branch with a misaligned target is not an exception.
FENCE is a no-op on a single in-order hart but must retire normally (it appears in real
crt0 code). `ret` is `jalr x0, 0(ra)` and `j` is `jal x0, imm` — the x0-write-discard
path gets exercised for real here. This completes the RV64I execution set apart from
ECALL/EBREAK (E0-T11).

## Deliverables
- Execution arms for all control-transfer instructions plus FENCE-as-nop.
- Tests: forward/backward branches, all six predicates at signed/unsigned boundaries
  (`i64::MIN` vs positive operands for BLT vs BLTU), B-type range edges (±4 KiB),
  JAL range edges (±1 MiB), JALR bit-0 clearing, `jalr x5, 0(x5)` self-link case.
- Misalignment tests: taken branch to `pc + 2` traps cause 0 with `tval` = target and
  writes no link register; not-taken branch with the same encoding retires normally.

## Acceptance criteria
- [ ] `jal x1, +8` sets `x1 = pc + 4` and `pc += 8`; `jal x0, 0` loops forever with PC
      stable over 1000 steps.
- [ ] `jalr x1, 3(x2)` with even `x2` targets `x2 + 2` after bit-0 clear — and therefore
      traps cause 0 (target % 4 == 2), with x1 unmodified.
- [ ] `jalr rd == rs1` uses the *old* rs1 for the target and then writes the link.
- [ ] BLT/BLTU disagree exactly when operand signs differ (table across boundary values).
- [ ] FENCE (any fm/pred/succ fields) retires as a no-op, PC += 4.
- [ ] All pass natively and under `wasm-pack test --node`.

## Adversarial verification
(1) Diff against Spike on a branch-torture blob: 50+ instructions of nested loops and
computed jumps; compare full PC sequence via traces — one wrong branch decision refutes.
(2) Attack the misaligned-trap ordering: confirm the trap fires on the JAL itself (PC in
trap state = JAL's address, link register unwritten), not on the following fetch.
(3) Encode B-type immediates at exactly +4094 and -4096 and J-type at +1048574/-1048576;
off-by-one wrapping refutes the decoder/executor pair. (4) Place a taken branch in the
last word of RAM targeting `ram_end + 4` — expect the *next* step to fetch-fault cause 1
(target is aligned), distinguishing cause 0 vs 1 correctly. (5) Verify `ret`-heavy code:
call/return chain 3 deep, compare final register file with Spike.

## Verification log

### 2026-07-02 — worker claim — commit 831d0d1 (branch task/e0-t09-control-flow, stacked on e0-t08)
Deliverables: control-flow arms in Hart::execute — retire path restructured to
(rd, value, next_pc) with the single retirement point preserved. JAL: target=pc+imm;
JALR: target=(old_rs1+sext(imm)) & !1 (bit-0 clear BEFORE alignment check; rd==rs1 uses
the old rs1 because the link is written at retirement); both trap cause 0 tval=target
with NO link write on misaligned targets. Branches via one shared branch() helper: only
TAKEN transfers can trap on misalignment (§2.5); not-taken retires regardless of encoded
target. FENCE already retired as nop (E0-T07), re-asserted at three fm/pred/succ values.
The hart now executes the complete RV64I set except ECALL/EBREAK (E0-T11).
Tests (tests/hart_control.rs, 12): all six acceptance criteria as anchors (jal link+jump;
jal x0,0 1000-step stable self-loop; jalr x1,3(x2) bit-0-clear→trap cause 0 tval=x2+2
link unwritten; jalr x5,0(x5) old-value target then self-link; BLT/BLTU 8-row boundary
table incl. i64::MIN vs u64::MAX both ways; FENCE pc+4); §2.5 ordering (taken-vs-not-taken
SAME encoding; trap fires on the JAL itself with full state snapshot); cause-0-vs-cause-1
distinction at RAM end (angle 4 proactive: aligned out-of-RAM target retires, NEXT fetch
faults 1); B/J range edges (aligned extremes land: +4092/-4096, +1048572/-1048576; odd
extremes +4094/+1048574 trap cause 0 — angle 3 proactive); 3-deep call/return chain via
jal ra + ret; countdown loop with exact retirement count. 2 wasm32 mirrors.
Suite evolution (flagged for audit): jal/jalr/beq left both placeholder lists;
verifier_e0t07_angles.rs placeholder entries replaced with cause-0 misalignment purity
cases (taken beq→pc+2; jalr to odd sentinel target=X2_SENTINEL) — purity property
preserved and extended to the new trap paths; edit marked in-file.
Gates: fmt / clippy exit 0 / 17 native + 8 wasm suites green / miri hart_control 11/11
(+1 ignored: branch_and_jal_range_edges needs 4MiB native RAM for ±1MiB J-targets;
cfg(miri) RAM shrink per the E0-T07-established pattern, rationale in-file) / CI green
run 28626903893.
rr: SKIPPED locally (macOS/no PMU); spec-first-model precedent for angle 1 differential.

### 2026-07-02 — adversarial verifier (fresh session) — VERDICT: verified
- P1 cold-clone gates — HELD. fmt/clippy clean, 17 native suites, 118 tests, hart_control 12/12, scrubbed env.
- P2 suite-edit audit — HELD. The removed placeholder words retire per new semantics; replacement words hand-decoded from both scrambles AND via the project decoder (Beq{0,0,+2}; Jalr{1,2,+1} with target (X2_SENTINEL+1)&!1 = X2_SENTINEL ≡ 2 mod 4); purity-loop assertions unweakened.
- P3 angle-1 branch torture — HELD. 63-instruction blob (3-level nested loops, jal-anchored computed jump table, 3-deep call/return, 10-row predicate battery): 124 retirements, PC trace identical instruction-by-instruction vs spec-first Python model, all 32 final regs equal, x5=297 matches hand computation.
- P4 angle-2 misalignment ordering — HELD. Taken misaligned jal/jalr/all six predicates: cause 0, tval=target, pc=jump's address, full dump pure, link (incl. rd==rs1 jalr) unwritten; not-taken six retire pc+4 with the same encodings.
- P5 angle-3 range edges — HELD. Verifier encoder reproduces E0-T06 golden extremes bit-exact; +4094/+1048574 trap cause 0 with exact tval; -4096/-1048576/+1048572 land at exact pc.
- P6 angle-4 cause 0 vs 1 — HELD. jalr to aligned-unmapped retires (link written) then next fetch faults 1; jalr to odd-unmapped traps 0 immediately, link unwritten — alignment at the jump, mapping at the fetch, even when both would apply.
- P8 wasm+miri — HELD. 8 wasm suites green; miri 11/1 ignored in 299s; ignore rationale judged honest (±1MiB target physically cannot land in 64KiB miri RAM; scramble arithmetic miri-covered elsewhere).
- rr — SKIPPED loud (macOS/no PMU); Spike — SKIPPED per precedent, re-runs at E0-T13 with spec_model.py as seed.
- COVERAGE: 7/7 mutants KILLED by the COMMITTED suites alone (taken-falls-through, over-eager not-taken, no bit-0 clear, link-before-target, link-on-trap, blt↔bge flip, cause 1-not-0). Retire-restructure audit: all 40+ non-control arms uniformly pc4; single retirement point preserved.
- MOCK/HONESTY: both flagged audits pass; no self-licking goldens (encodings re-derived independently + cross-checked vs E0-T06 golden words); CI 28626903893 success at 831d0d1; claim commit tasks-only; all claimed counts reproduce.
- NOVEL: jalr bit-0 RESCUE (odd rs1 + imm 3 must LAND — wrong check order would trap) + wrapping targets (jalr to pc=0 → cause 1; jal -1MiB below RAM retires then cause 1). All held.
- SUITE: promote verifier_e0t09_angles.rs + torture_data.rs; promote spec_model.py as E0-T13 differential seed; discard mutate.py (campaign recorded here).

### 2026-07-02 — post-verdict actions (worker)
Promoted verifier_e0t09_angles.rs (6 tests) + torture_data.rs verbatim; spec_model.py
committed as tests/data/spec_model_e0t09.py (E0-T13 Spike-differential seed). Gates
re-earned: clippy exit 0, all native suites green (18 suites incl. the promotion).
