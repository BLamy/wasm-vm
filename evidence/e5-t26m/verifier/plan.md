# E5-T26m fresh-verifier prediction plan

Prepared: 2026-09-08, before frozen worker diff/evidence  
Activation baseline: `aa03fe85933e9b9730bb747d903bba57c9b13f36`  
Role: critic only; no implementation or acceptance runs performed

## Carried result

**HELD, not re-litigated:** the source preflight's safe condition for excluding exactly
`SIE|MIE|SPIE|MPIE` from `InlineTlbContext` equality. At frozen-head review I will only check that
its code/dependency boundary is unchanged: architectural `mstatus`, sampling, translator support,
chain budgets, and the retained context inputs must remain untouched. F, old latency gates, and any
performance multiplier are outside this verdict.

## Predictions made before evidence

- **P1 — exact 64-bit partition.** In the private real-wasm cache test, individual flips of bits
  1, 3, 5, and 7 will return `context_changed == false` and preserve seeded inline words. Each of
  the other 60 flips will return `true` and clear the words. The hart's architectural `mstatus`
  will retain the value written for every case. Any fifth ignored bit is a refutation.
- **P2 — production link reuse.** For both an actual cross-batch static edge and actual dynamic
  JALR link, each isolated flip of 1/3/5/7 will still enter the compiled target exactly once. The
  dynamic hit count will increase by one per invocation and its live count will remain stable.
  Flipping SUM alone will prevent target entry in that invocation and clear dynamic publication.
- **P3 — M interrupt precedence.** With MTIP pending and globally masked, the guest CSR terminator
  enabling MIE will retire. On the next bounded slot, before the precompiled successor executes,
  core will enter `mtvec` with `mcause = interrupt|7`, `mepc = successor PC`, `MIE=0`, `MPIE=1`,
  and no successor side effect. The interpreter oracle will match those fields exactly.
- **P4 — S interrupt precedence.** With delegated STIP pending in S mode, the guest CSR terminator
  enabling SIE will retire. On the next bounded slot, core will enter `stvec` with
  `scause = interrupt|5`, `sepc = successor PC`, `SIE=0`, `SPIE=1`, and no successor side effect.
  The interpreter oracle will match exactly.
- **P5 — retained authority boundary.** Frozen source will still compare full `satp`, privilege
  mode, PMP revision, TLB flush count, trigger-idle state, and all non-1/3/5/7 `mstatus` bits. A
  genuine mismatch will still clear inline read/write/exec words, dynamic entries, and published
  static words before compiled invocation.
- **P6 — sabotage sensitivity.** In the recorded temporary mutation that also ignores SUM, both
  the exact-mask test and the real-link SUM negative control will fail. The frozen final source and
  evidence digest will be restored to the four-bit mask before acceptance recording.

## One bounded combined-bit attack

From an established warm context, toggle
`SIE|MIE|SPIE|MPIE|SUM` simultaneously, with no pending interrupt, satp/mode/PMP/flush/trigger
change. Prediction: SUM makes this a genuine mismatch despite all four ignored bits also changing.
The seeded inline word is cleared, dynamic live entries become zero, both static and dynamic target
side effects remain absent for that invocation, and ordinary host-visible exit/fallback occurs.

This specifically kills an incorrect implementation shaped like `diff & INTERRUPT_MASK != 0 =>
equal`; the only acceptable classification is `diff & !INTERRUPT_MASK == 0`.

## Frozen review sequence

1. Bind task, diff, logs, screenshot, pristine-clone record, and sabotage record to the same final
   head/digests. Reject stale or post-sabotage evidence.
2. Audit every changed hunk against the task boundary and the three new tests; carry unchanged
   preflight conditions and existing authority regressions forward rather than rerunning their
   design review.
3. Inspect the semantic real-Node WebAssembly record from
   `wasm-pack test --node crates/wasm --lib --test jit_browser_parity -- --nocapture`, then the
   grouped `make verify-E5-T26m` record, scoped browser result, and pristine-clone result required by
   the task.
4. Run only the combined-bit attack above as the fresh bounded novel attack. Recheck any finding
   against an exact diff line/test assertion before verdict.

Verdict remains pending frozen diff and evidence. No F timing or 2x prediction is made.
