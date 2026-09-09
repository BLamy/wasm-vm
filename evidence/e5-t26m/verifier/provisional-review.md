# E5-T26m frozen source/evidence review and novel attack

Review date: 2026-09-08  
Diff: `aa03fe85933e9b9730bb747d903bba57c9b13f36..deb595c78aa96cbcbc674fa3cbe30a7e53dd522f`  
State: provisional; no task verdict or status change

## Source review

No implementation refutation found.

- The only runtime semantic change is the named mask at
  `crates/wasm/src/jit_browser.rs:133-135` and its application to the cached copy at line 184.
  It excludes exactly bits 1/3/5/7. The live hart field is neither masked nor rewritten.
- `satp`, privilege mode, PMP revision, TLB flush count, and trigger-idle state remain full context
  inputs at lines 181-193. `sync_context` still clears all inline words on mismatch at lines
  203-212; the unchanged invocation path still uses that result to reset dynamic and published
  static links before compiled entry.
- No core CSR, interrupt sampler, translator-support, chain-budget, clock, scheduling, snapshot, or
  guest-image source changed in the frozen diff. The accepted preflight dependency boundary is
  therefore unchanged and remains HELD.
- The private test exercises all 64 raw status positions against three cache-array sentinels and
  checks architectural status preservation. The actual-WASM parity additions exercise separate
  cross-batch static and dynamic generated calls, SUM invalidation, and M/MTIP plus delegated
  S/STIP delivery against interpreter state with the successor asserted compiled before execution.
- `make verify-E5-T26m` scopes format, wasm32 clippy, native interrupt/privilege/PMP tests, both
  affected wasm32 builds, and the complete real-Node WebAssembly lib/parity harness. The frozen
  runtime record ends with 37 passed, 0 failed, 1 intentionally pre-existing ignored test.

The two late `evidence/e5-t26f/inline-context-candidate/{candidate.patch,worker-plan.md}` files are
evidence-only, execute no code, and were not used for this review as directed. The generated wasm
and service-worker stamp are covered by `07-web-dist.log` and frozen hashes. Final roadmap/demo and
pristine-clone integration remain pending Main and are not adjudicated here.

## Pre-evidence predictions

- **P1 HELD.** `03-four-bit-reuse.log` records the private test passing 1/1. Source assertions
  partition 1/3/5/7 from the other 60 bits and preserve `hart.csr.mstatus`. The old full-status
  mutation fails at bit 1 in `02-full-status-red.log`, proving the regression is live.
- **P2 HELD.** The same record passes both static and dynamic production-link tests (2/2). Target
  effects and dynamic hit/live counters are asserted; SUM prevents the dynamic target and clears
  its live publication.
- **P3 HELD.** `04-interrupt-preemption.log` passes the M/MTIP browser-vs-interpreter leg inside the
  single table-driven test; frozen assertions pin interrupt cause 7, EPC, PC, MIE/MPIE, and absent
  target effect.
- **P4 HELD.** The same record passes the S/delegated-STIP leg; frozen assertions pin cause 5, EPC,
  PC, SIE/SPIE, and absent target effect.
- **P5 HELD.** Frozen source retains every named authority input and all genuine-mismatch reset
  branches. `08-frozen-runtime.log` passes the scoped native PMP/privilege/interrupt regressions and
  the established actual-WASM memory, PMP, execute-remap, and link invalidation tests.
- **P6 HELD.** Adding SUM to the ignored mask changes the runtime digest to
  `6d97a77c6b34cb874d8ea6338a646fdf62acc1b91bd8fa8910c53d325461a4d7` and fails both required
  controls: private line 2402 says bit 18 did not change context; dynamic line 2085 observes four
  retirements instead of two. Frozen source is restored to
  `5a83c4269e73ba6cb8e66c27c8f2a4fc797e7e55b5abbd37f566e510f5ba24df`.

## Fresh combined-bit attack

Prediction retained from `plan.md`: after warming each generated link, simultaneously flip
`SIE|MIE|SPIE|MPIE|SUM` with every other context input stable and no pending interrupt. SUM must
classify the transition as a genuine mismatch despite all four ignored changes.

The attack ran from a `git archive` scratch workspace rooted at frozen
`deb595c78aa96cbcbc674fa3cbe30a7e53dd522f`; it was not a portability clone. Shared runtime and
tests were untouched. Scratch runtime SHA-256 remained
`5a83c4269e73ba6cb8e66c27c8f2a4fc797e7e55b5abbd37f566e510f5ba24df`.

Command:

```sh
wasm-pack test --node crates/wasm --test jit_browser_parity -- \
  browser_inline_combined_interrupt_bits_plus_sum_invalidates_all_links --nocapture
```

**HELD: 1 passed, 0 failed.** The static and dynamic legs each observed `BranchTaken`, exactly two
caller retirements, `next_pc == TARGET`, and zero target-register effect. The dynamic leg also
observed zero hits and zero live entries after the transition. Architectural `mstatus` retained the
full mixed value. The formatted test patch passes `cargo fmt --check -p wasm-vm-wasm`.

Artifacts:

- `combined-bits-attack.patch` — SHA-256
  `c91ffebb68415b7f8375bb75a84b7df91d6edb846ebdb2af66cb36855da035b4`; reverse dry-run applies
  cleanly to the executed scratch test.
- `combined-bits-attack-final.log` — SHA-256
  `87eb1fa84b3c6171657c0f129a2836e37654ab377fd410ba622fb5cae9a1a894`.
- Executed scratch parity-test SHA-256 after applying the patch:
  `73fdbf1c2b5e730e932910e8af4d05be0dd8d275ac63c698854f0eb4308e5bac`.

## Promotion and remaining proof

**Promote the combined-bit test.** It adds the missing actual static-link negative control and
forces the all-four-ignored-plus-retained classification through both generated link mechanisms.
Main should apply the patch, refreeze, and rerun the affected real-WASM harness before its single
final pristine clone. The initial `combined-bits-attack.log` is superseded by the formatted
`combined-bits-attack-final.log`.

Still pending before verdict: promoted-test frozen hashes/run, Main's roadmap/built-demo record
(126 passed, 0 failed, zero non-favicon errors, screenshot), final evidence integration, and the one
Main-owned pristine clone. No F observer/image suite or performance criterion is requested.
