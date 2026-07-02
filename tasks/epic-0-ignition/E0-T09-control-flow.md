---
id: E0-T09
epic: 0
title: Control flow — JAL, JALR, conditional branches, FENCE, and target-misalignment traps
priority: 9
status: in-progress
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
(empty)
