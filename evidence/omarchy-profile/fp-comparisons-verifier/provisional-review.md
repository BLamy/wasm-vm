# E5.5-T03v provisional comparison review

No final verdict or task status change: final frozen source/artifact submission,
physical desktop trial, pristine-clone and Cloudflare receipts remain outstanding.
Predictions were written before implementation in `predictions.md`.

## Results that carry forward if boundary and evidence remain unchanged

- P1/P2/P3/P4 — HELD provisionally. `pre-freeze-native.log:6–15` runs
  2,016 literal/all-initial-flag and 4,608 seeded state/alias cases (1,152 disabled
  FP exits). `pre-freeze-wasm-verifier.log:18–21,35–38` produces identical
  native/private/shared FNV receipts: goldens 4642228140795119653; seeded
  5348346956590961504. Exact state assertions cover integer/FPR banks,
  signed zeros, ordering, infinities, subnormals, both NaN types/signs,
  malformed boxes, x0, frm 0..7, sticky flags 0..31, and precise FS-Off prefixes.
- P5/P6 — HELD provisionally. Native/private/shared control receipt
  14645582373884930759 covers real interpreted FCSR reads/replacements and
  FMV source updates between calls, plus precise load/store faults. Shared
  same-module generated calls are recorded at `pre-freeze-wasm-verifier.log:27–34`;
  corrected cross-module calls are at `cross-module-corrected.log:20–27`.
  Direct-entry/link counts are asserted. Fuel 2 refuses root, fuel 3 retires
  exactly root, fuel 6 reaches successor and preserves NV even on a later fault.
- P7 — HELD provisionally. `pre-freeze-wasm-verifier.log:23–26,40–43` records
  private/shared successful memory growth, growth-store fault and subsequent
  load fault. Each import executes once. Newly accrued flags=19 survive exit,
  then real interpreted FCSR replacement=2 survives the next clean comparison.
- P8 sensitivity — HELD provisionally. The isolated copy in
  `wrong-golden-check.py` changes only expected FEQ(+0,-0) from 1 to 0.
  `wrong-golden-wrong.log` fails at named assertion with actual1/expected0;
  `wrong-golden-restored.log` passes after restoring the test. Both processes
  exited normally with the expected codes (101/0). No implementation was edited.
- P8 exact head / P9 — NEEDS EVIDENCE until the frozen submission arrives.

## Exceptions found in verification machinery

The combined worker/verifier WASM run printed worker tests passed then failed to
terminate. `pre-freeze-wasm-stop.json` records the authorized stop after 4:32.
That process is incomplete evidence, not a successful exit; worker is isolating
its Node lifecycle. The independent verifier-only process did exit, exposing a
cross-module fixture setup error: changing FS after warming intentionally
invalidated the existing link context. `cross-module-fixture-correction.md`
records why the fixture was corrected. Only that missing case was rerun; it
passed with exact successor counters. No runtime contradiction was found.

## Changed runtime hunk coverage

- `core/src/jit.rs` accrued-flag commit: executed by all successful comparison
  cases and both precise fault paths; CSR-only clears then clean comparisons
  prove refreshed control does not resurrect stale NV. FS-Off covers no dirty
  commit. Existing FPR write-mask semantics carry forward from T03t/T03u.
- `jit-translate/src/lib.rs` integer write mask: comparison-only outputs and
  same/cross successors consuming x5/x31 prove publication through globals.
- Admission and FP classification: each FEQ/FLT/FLE generated module is asserted
  installed and executed; every FS value is tested with integer prefix/suffix.
- `emit_fp_compare`: literal/seeded cases execute valid/malformed boxes, ordered
  and NaN paths, quiet/signaling invalid branches, equal/opposite-sign/same-sign
  branches, both negative magnitude orderings, all three operators, and x0.
- Dispatch route: all real generated calls execute the new compare arm.
- Policy/docs/roadmap metadata are non-runtime and will be checked against final
  capability/suite screenshots. Makefile and browser harness require final run.

Prior independently verified T03t/T03u proofs remain HELD for unchanged code,
dependency boundaries and evidence digests. No unrelated gates were rerun.
