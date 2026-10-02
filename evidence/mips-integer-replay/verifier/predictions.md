# E5.5-T03bf verifier predictions (before evidence inspection)

Recorded 2026-10-02 by the fresh verifier session. Orientation only: read the task,
parent-to-working-tree runtime diff against `a6ae84fd1c71c76ecadcff9000c40ed6319ef4b5`,
and unchanged capture/classification/replay context. Initial checkout HEAD was
`87d6bc05191cf0634f3fa35fb4b58a31d0fe432b`; runtime and worker fixtures were still
uncommitted. No worker run output, browser capture, benchmark measurements, guest
trace or new integer fixture was inspected before these predictions.

This file fixes predictions before inspection. Results belong in a separate report
with concrete file/line/digest citations. Runtime freeze and worker evidence handoff
are prerequisites for a verdict.

## Architectural predictions

- P1 — Each of the 43 specialized instruction variants listed by
  `dispatch::retire_deferrable` has precisely one integer semantic expression shared
  by cached deferred replay and ordinary `Hart::execute`. No allow-listed opcode
  reaches the new `expect` failure, and no noninteger opcode is accepted. Every
  moved semantic arm has execution evidence, including the branch alternatives of
  signed division/remainder and unsigned division/remainder.
- P2 — For 64-bit DIV/REM with divisor zero, the quotient is all ones and the
  remainder is the dividend. For signed MIN/-1, the quotient is MIN and remainder
  zero. Their W forms first truncate to 32 bits and sign-extend the result. MULH,
  MULHSU and MULHU high halves agree with an independent wider-product oracle,
  including negative rs1 and unsigned rs2 with bit 63 set. A cached-vs-uncached
  comparison alone is insufficient for these moved arms because both now share
  `integer_result`; use parent output or independent expected values as well.
- P3 — Every W result is sign-extended from bit 31. Register shift amounts are
  masked to 6 bits (RV64) or 5 bits (W); immediate shifts preserve decoded valid
  widths. Signed comparisons and arithmetic shifts retain signed interpretation.
  Test operands include zero, all ones, bit 31, bit 63, mixed high/low halves and
  oversized register shift amounts. Source/destination aliasing reads the old
  source values before writeback.
- P4 — x0 remains zero after every specialization and its retirement record has
  no destination write. Compressed instructions advance PC by 2, full instructions
  by 4, with wrapping addition. AUIPC computes its value from the architectural
  pre-instruction PC, including a high virtual address or wrap boundary, not a
  cached physical address or next PC. Trace PC/raw bits remain the originally
  fetched instruction and the record contains no memory operation for integers.
- P5 — Pure integer execution changes only its architectural destination, PC and
  normal retirement accounting. Seeded F registers, fflags/FS, unrelated CSRs,
  LR/SC reservation and RAM are unchanged. Ordinary execution with FP disabled
  still accepts integer instructions; the noninteger fallback still traps for
  illegal FP operations without retiring or modifying architectural state.
- P6 — Cached traced, cached untraced and reference execution have identical
  architectural state after each prefix for budgets 0, 1, inside a tail, at a
  terminator and across multiple resumes. Counter/clock increments equal actual
  retirement, and tracing does not change execution. A trap after an integer
  prefix reports the same PC/cause/tval and excludes the faulting instruction
  from the retire trace; already-retired integer counters are settled first.
- P7 — A host or guest code write invalidates a saved integer tail before a
  subsequent instruction can replay stale bytes. Decode/fetch traps and all
  memory/FP/CSR/control instructions retain the ordinary fallback behavior.

## Performance and publication predictions

- P8 — Recomputed parent/candidate host-clock ratios from alternating samples
  show a repeated positive cached-integer throughput gain separately for native
  and browser. Samples compare the actual stack-parent artifact with the frozen
  implementation, identical fixed guest work, clocks and accounting. Repeated
  boot/shell workload ratios have no material regression greater than 5%; any
  inconclusive or slower result is reported as such rather than as a gain.
- P9 — Fixed-RTC parent and frozen-candidate guest trace/state digests match.
  Manifest hashes resolve to the actual code/artifacts tested. No missing asset,
  hidden RUSTFLAGS/CARGO environment or local-only artifact is required by the
  deterministic acceptance command in one scrubbed-env pristine clone.
- P10 — Affected native and wasm tests, strict clippy, native/wasm builds and the
  prescribed local gauntlet succeed or identify exact pre-existing platform
  failures. No new ignored tests or debug-assert disabling hides a failure.
- P11 — The built demo exposes the measured change through its roadmap, the ISA
  suite reaches the declared total with zero failures and no unexpected console
  errors, the recorded screenshot is from the tested artifact, committed dist
  matches it, and the deployed Cloudflare artifact hashes match the claimed build.
  Integer MIPS are not presented as proof of desktop interaction latency.

## Changed-hunk coverage expectations

1. `hart/mod.rs::integer_result`: all 43 accepted variants and the None fallback;
   branch outcomes for zero/nonzero/overflow DIV/REM; wide multiply extrema;
   integer semantics under both capture modes.
2. `hart/mod.rs::execute`: new early result branch under ordinary one-step and
   uncached execution; preserved noninteger fallback; unreachable allow-list arm
   waived only if the identical allow-list relationship is proven structurally.
3. `lib.rs::retire_cached_op`: defer=true under traced and untraced cached tail;
   defer=false through the general executor; writeback, PC, capture and return.
   A test that disables replay or uses only one-instruction run calls does not
   cover the defer=true hunk.
4. Test/build/demo/evidence-only changes: classify after final diff; do not demand
   runtime execution from comments, generated metadata or manifest rows.

## Planned bounded novel attack

Use two Sv39 virtual aliases for the same cached physical code containing AUIPC
and an integer dependency chain. Warm the block at one alias, execute it at the
other alias with different split budgets and mixed traced/untraced calls, and
compare against independently calculated virtual-PC AUIPC results and a cache-off
reference. Prediction: cache reuse never substitutes physical/warmed PC, integer
writeback respects source aliasing, and final counters/state are identical. If
fixture feasibility changes, record an alternative before running it.

## Planned sabotage check

In an isolated scratch checkout of the frozen head, deliberately zero-extend a
W result (prefer DIVUW's result) inside `integer_result` while leaving the fixture
unchanged. Prediction: at least one new deterministic regression test fails with
an expected-versus-observed architectural value, even though cached and uncached
paths share the corrupted implementation. Record the patch, command, failure
location and exit code; never apply the mutation to the worker checkout. If only
a cached-vs-uncached equality test passes, that is a real oracle sufficiency gap.
