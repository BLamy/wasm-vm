# E5.5-T03v independent verifier predictions

Recorded before worker runtime edits and before inspecting T03v run evidence.
Orientation head: `c7dfe5912f77e1368000c1a68e4bce2ee7449011`. Dependency: `0cc4c0c62540928301dcd8a56618d3b059f6c7ab`.
Read: AGENTS.md; complete T03v task; translator admission/FP guard/boxing/register
mask paths; core FPR, CSR, interpreter comparison and handoff; native executor
normal and precise-fault commits. T03v has no implementation diff at prediction time.

## Falsifiable predictions

- P1 — Ordering: FEQ(+0,-0)=1, FLT(+0,-0)=0, FLE(+0,-0)=1; the same holds
  for reversed zeros. -infinity < negative finite < -minimum subnormal < either
  zero < minimum subnormal < positive finite < +infinity. Negative magnitude
  order reverses. Equal finite/infinite operands produce (EQ,LT,LE)=(1,0,1).
  No finite/infinity/zero comparison adds a flag. These checks will use literal
  bit patterns and an integer-only independent oracle, never softfloat outputs.
- P2 — NaNs: every comparison with qNaN or sNaN returns 0. FEQ adds NV (0x10)
  only for a valid boxed sNaN; FLT/FLE add NV for any NaN. Either operand can be
  the NaN, with either sign. A malformed upper NaN box is canonical qNaN even
  when its low word resembles a signaling NaN, zero, or infinity: FEQ adds no NV,
  FLT/FLE add NV. All 64 source bits and every other FPR remain unchanged.
- P3 — State: with initial fflags=F and comparison invalid bit=N, exit flags are
  exactly F|N for all 32 initial flag combinations. Every frm in 0..7 survives
  unchanged, including reserved 5/6/7. FS=Initial/Clean/Dirty becomes Dirty and
  SD is set after an executed comparison, including rd=x0; x0 remains zero.
  Integer/FPR register-number aliases do not overwrite source FPRs.
- P4 — FS-Off: an integer prefix executes once, the first comparison returns
  IllegalInstruction with the original raw word and entry virtual PC+prefix
  bytes. No comparison result, suffix write, FP flag, frm, or FPR changes occur.
  Shared direct chains report the exact retired prefix; private/native retain
  their documented zero retired sentinel for caller accounting.
- P5 — Handoff: NV from a generated comparison survives the next generated
  block, same-module and cross-module direct successors, and a budget exit.
  A real interpreted CSR read sees it. A real interpreted CSR clear/replacement
  is refreshed at the next JIT invocation and cannot resurrect old NV. No FPR
  mutation is needed to trigger this control-state refresh.
- P6 — Precise fault: after a comparison accrues NV, a faulting following load
  or store returns the exact virtual fault PC and trap value. The comparison
  result/FS/fflags are committed once; the post-fault suffix does not run.
- P7 — Memory growth: a browser import grows linear memory after a comparison.
  Both successful and faulting exits preserve accumulated flags, exact FPR bits,
  integer prefix, and precise PC. A following invocation uses the refreshed
  view and newly interpreted flags. Test private and shared memory execution.
- P8 — Isolation/coverage: a deliberate wrong expected FEQ signed-zero result
  makes the isolated verifier test fail at its named assertion; restoring the
  test makes it pass. Every new runtime hunk is exercised or explicitly waived.
  Final commands pass from a scrubbed pristine clone at the submitted source
  head, and source/artifact/evidence hashes match the submitted claim.
- P9 — Product gate: record the actual Omarchy physical-keyboard nonce attempt
  against the unchanged 120-second deadline and inspect the application image.
  Only independent nonce readback AND visible response satisfy T03q; accepted
  event counts alone do not. T03v may document a failed retry as required by its
  slice while T03q remains pending. Full live ISA and compiled comparison guest
  pass, compiled bytes match the reviewed runtime, and Cloudflare serves them.

## Planned permanent artifacts

Shared critic test support for P1–P6 with native/private/shared wrappers;
browser-only import-driven growth test for P7. Use three fixed independent
xorshift seeds plus hardcoded goldens, record case counts and state digests.
Same/cross-module direct chaining and budget checks use executor telemetry to
prove the edge executed. The wrong-golden test is changed only in an isolated
copy. No worker implementation code is edited by this verifier.

## Carry-forward rule

T03t/T03u predictions whose code/dependency boundary/evidence digest remain
unchanged are HELD by their prior independent verdicts. This review adds only
the comparison and accrued-flag boundary; it does not rerun old memory authority,
move semantics, unrelated broad gates, or already identified platform failures.

## Results

Pending frozen worker submission; no T03v execution evidence inspected yet.
