VERDICT: verified

Fresh verifier, 2026-09-08. Worker-submission metadata head:
`5778e566d9d2bd56a6cf2fece26c9c2ef6a54448`; frozen product/test head:
`7f007bd28e0d8a73ed46d03c7f9bd803449157ee`; activation baseline:
`aa03fe85933e9b9730bb747d903bba57c9b13f36`. I reviewed the complete task,
frozen diff, source, tests, Make target, Main-owned records and their digests.
No implementation, test, browser, clone, runtime-gauntlet, F-status, deployment,
stack, push or merge action was performed during final review.

## Prediction results

- **P1 exact 64-bit partition — HELD.** The private real-WASM test passes and
  iterates all 64 positions: only 1/3/5/7 preserve each of the read/write/exec
  sentinel words; every other position clears all three; architectural
  `mstatus` remains exact. The original full-status comparison fails at bit 1,
  proving the positive case is discriminating. Points:
  `crates/wasm/src/jit_browser.rs:2364-2415`,
  `evidence/e5-t26m/main-gates/03-four-bit-reuse.log:21`, and
  `evidence/e5-t26m/main-gates/02-full-status-red.log:19-20`. Demand: none.
- **P2 generated static/dynamic reuse — HELD.** Actual generated static and
  dynamic targets execute across each isolated ignored bit; target side effects,
  static publication, dynamic hit count and live count are asserted. SUM alone
  prevents dynamic target entry and clears publication. Points:
  `crates/wasm/tests/jit_browser_parity.rs:1148-1225` and `:2012-2098`;
  `evidence/e5-t26m/main-gates/03-four-bit-reuse.log:30`. Demand: none.
- **P3 M/MTIP precedence — HELD.** The real Machine guest CSR-enable case
  matches the interpreter at cause 7, EPC, handler PC and MIE/MPIE, while the
  precompiled successor side effect remains absent. Points:
  `crates/wasm/tests/jit_browser_parity.rs:422-448` and
  `evidence/e5-t26m/main-gates/04-interrupt-preemption.log:20`. Demand: none.
- **P4 S/delegated-STIP precedence — HELD.** The same independently predicted
  table leg matches the interpreter at cause 5, EPC, handler PC and SIE/SPIE,
  with no compiled-successor side effect. Same points as P3. Demand: none.
- **P5 retained authority boundary — HELD.** Frozen source masks only bits
  1/3/5/7 in the cached copy. Full satp, mode, PMP revision, TLB flush count and
  trigger-idle state remain compared; mismatch still clears all inline words,
  dynamic links and published static words before compiled entry. Points:
  `crates/wasm/src/jit_browser.rs:123-135`, `:181-212`, and `:1928-1939`.
  Runtime source SHA-256 is
  `5a83c4269e73ba6cb8e66c27c8f2a4fc797e7e55b5abbd37f566e510f5ba24df`.
  Demand: none.
- **P6 SUM sabotage sensitivity — HELD.** Temporarily adding SUM to the ignored
  mask fails both layers: the private test reports retained bit 18 did not
  change context, and the generated dynamic-link test retires 4 rather than 2,
  showing stale target entry. Points:
  `evidence/e5-t26m/main-gates/05-sum-sabotage-private.log:19-20,79` and
  `evidence/e5-t26m/main-gates/06-sum-sabotage-dynamic.log:18-21,82`.
  The accepted source digest is restored before every final record. Demand: none.

## Novel combined-bit attack

**HELD.** The predeclared attack flips all four ignored bits plus SUM at once.
It warms real generated cross-batch static and dynamic links, then observes only
the two caller retirements, no target-register side effect, zero dynamic hits and
zero live entries, while preserving the complete architectural `mstatus`. The
scratch run passed 1/1; the exact promoted test digest
`73fdbf1c2b5e730e932910e8af4d05be0dd8d275ac63c698854f0eb4308e5bac`
passes in the promoted harness and final clone at
`evidence/e5-t26m/main-gates/09-promoted-harness.log:129-142` and
`evidence/e5-t26m/main-gates/10-final-clone.log:397-410`.

Scope is explicit: this novel test proves generated-link invalidation and target
non-entry; it does **not** seed private inline-cache words. Private sentinel-word
coverage is supplied separately by the original direct-cache test. That test
seeds all three read/write/exec arrays for every individual bit and its mixed
ignored+retained control, then requires all three to clear
(`crates/wasm/src/jit_browser.rs:2373-2415` and `:2417-2433`). The SUM sabotage
failure independently shows this sentinel control detects an overbroad mask.

## Sufficiency and final records

- Runtime mask/context hunk: directly covered by the 64-bit private test,
  generated static/dynamic tests, M/S interrupt test, combined attack and both
  semantic sabotages. No new production observation API exists.
- New real-WASM tests: all execute at final head. The promoted harness records
  9 library passes plus 38 parity passes and one unchanged E4-T33 ignore;
  SHA-256
  `9ec61974614f3a3994573ab4ea11d80c9f1c4e2dbbe448526c4740b7536e5195`.
- Make target: its scoped format/clippy, 29 native tests, two wasm32 builds and
  47 real-WASM tests all execute in the final clone. The clone identifies exact
  head `7f007bd2`, a clean checkout, no object alternates, fresh target and
  scrubbed compiler/test overrides before execution; it ends clean with exit 0
  at `evidence/e5-t26m/main-gates/10-final-clone.log:1-6,158-207,328,410-413`.
  Log SHA-256 is
  `24c45f6facf7f6943064d387e222d499ff0f74e38bb0840286be1239b888dcc2`.
- Existing authority regressions in the scoped harness cover unchanged
  memory/PMP/execute-remap/link invalidation boundaries. Failure-only and
  exceptional harness branches are defensive diagnostics, not new runtime
  claims. Evidence prose, hashes, scripts and generated task metadata are
  waived as non-runtime artifacts.
- Built demo evidence reports 126 passed, 0 failed and 126 done with empty
  collected error and HTTP-error arrays; the screenshot was viewed. JSON/PNG
  SHA-256 values are respectively
  `058f1535d77bd43da22a0978aab93d5c503517b7fc0c1f64ca44799ab66fd2ba`
  and `3841e60fd9f9857009ad40c150dad02f75675a53349595f242fa4e930f1563f7`.
  Built runtime WASM remains
  `18e53caa2e160819d16a6e0bf376530d45234e28f315c89b5042c48b1d791cc4`.

**SUITE:** retain the promoted combined-bit generated-link test, the private
64-bit/sentinel test, static/dynamic reuse and SUM control, pending M/S interrupt
oracle test, and `make verify-E5-T26m`. The single final clone is sufficient;
no duplicate clone or browser run is warranted.

This verdict verifies only E5-T26m's bounded cache-context prerequisite. It
makes no latency, speedup, F two-second, deployment, Epic 5 completion, or
production-release claim.
