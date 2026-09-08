# E5-T26o provisional source/coverage audit

No source-safety refutation. P0–P6 HELD for the bounded selector claim; this is not a final
verdict or task-status change. Final proof awaits Main's promoted test/gate head, one pristine
clone, and implemented submission. No F latency or speedup inference is made.

Read the complete task, frozen verifier plan and `6950a0f7..02c79f5672c3f1a08a3429f7b32dce4e051a41ec`
source/test diff before evidence. The only subsequent tracked code/gate change through
`a7240d6d41dd030e6b715b9a5aa38ce7ff9b9a89` is the core-lib-test `trace,gpu-trace` feature fix.
The critic's new files ran atop a7240 with the frozen runtime and worker-fixture hashes unchanged.

## Predictions and observed coverage

- **P0 HELD.** `crates/core/src/dev/plic.rs:167` is the only production hunk: four additions,
  five deletions, confined to the local selector. A nonzero u32 has a least set bit in0..31;
  masking0 restricts that to1..31. Clearing that bit strictly decreases the finite mask and
  cannot underflow under the guard. Ascending visits plus unchanged strict unsigned comparison
  preserve ties and thresholds. EIP still delegates at160; pending, snapshot decoding,
  claim/complete, polling, clocks, APIs and state layout are unchanged.
- **P1 HELD.** Worker `support/plic_sparse_cases.rs:53` is an independent full-range oracle over
  raw fields, not new EIP versus new claim. Gate03:94–97 records12 explicit +64 seeded states,
  both contexts,152 context cases; assertions at208–245 check claims, behavioral bytes and all
  counts. Explicit empty/disabled,31, sparse/dense, tie, threshold-equality/zero/MAX/high-bit
  cases exercise zero-iteration, every visited-bit operation, both threshold outcomes and both
  priority-update outcomes. The critic completes the literal tie1-then31 prediction in both
  banks (variant-raw:361), without changing the worker harness.
- **P2 HELD.** Tests feed156 actual little-endian bytes through public ComponentSnapshot restore.
  Hostile rows at worker source166–177 cover bit0-only and bit0-MAX plus31-MAX-1; complete
  post-claim bytes detect normalization. The real-bus raw reads preserve priority0/enable/
  pending bytes; dirty restore resets counts (gate03:68; existing snapshot tests:12–15).
  The independent variant also restores all39 arbitrary words and compares exact pre/post
  state, using full-u32 values and no privileged test API.
- **P3 HELD.** Gate03:68–69 records27 MMIO hits, count31=2 before dirty restore and all-zero
  counts afterward. Worker source267–378 supplies the real-bus threshold, gateway, invalid
  completion, held-high/deasserted and readback assertions with one hit per access. Its initial
  context1 is threshold-masked; that empty claim alone would not prove cross-bank suppression.
  P6 independently supplies both-eligible contexts and exact whole-state/count/hit checkpoints,
  closing that bounded coverage concern without another sequence campaign.
- **P4 HELD.** Gate03:59–67 records two intentional caught bounds panics at runtime167, for
  empty and pending direct context2. The enable-array access remains before the empty guard,
  so other invalid indices follow the same unchanged bounds check; no wasm panic capture or
  wider invalid-index sweep is claimed. Invalid MMIO context2 threshold read/write remains
  zero/no-op with ordinary hit accounting (worker source364–371).
- **P5 HELD.** `guest-source-predictions.md` records word-derived checkpoints before raw logs
  or Main's oracle were opened. Gate03:66 and71–92 matches the M trap and all21 canonical retire
  records exactly; `record-crosscheck.log:3` compares the entire trace to the source-reviewed
  hand oracle. The native test passes at93; the same shared fixture executes in actual WASM
  at131–140. The claim load returns31 atPC0x80000104; the next store completes after authentic
  device-level deassertion. Source assertions at487–543 separately prove PC/MEPC/cause/mode,
  MSTATUS0xa00001880 then0xa00000088, x10/x11=31, count31=1, pending31=0 and cycles/retirements21.
  RAM-only SHA256 is `c055e21cdc4ae3b9a55ddee3919d9bbc6fe2d7340a5830370a4aa3d79f6bc891`,
  independently recomputed from literal words in zeroed64KiB, not emulator output. It does not
  hash CPU/CSR/device state. The unchanged chain regression passes at107–109: its existing
  handler, link/dispatch and ≤64-iteration bound is carried, not exact JIT/interpreter counters.
- **P6 HELD.** Reserved seed0x260f0031,64 states/128 context claims,69 nonempty and59 empty;
  final seed0x7d5407845a7c6ff1 (variant-raw:232–360). Reversed completion preserves context0's
  held claim; only releasing both banks admits31. A context1 claim suppresses both, wrong-bank
  completion is inert, owner completion reopens31 (362–367). Raw source0 remains pending1
  while31 is claimed; no sanitization is allowed. Counts finish only31=1;139 hits comprise128
  seeded claims +6 tie claims +5 directed operations. Exact snapshots/all32 counts/both EIPs
  and hit totals are checked at each stop. Native1/1 at370 and actual-WASM1/1 at446; scoped
  fmt and both clippies pass. No worker file or production API was edited.

## Remaining submission boundary

**P7 HELD on Main's record, not a second critic sabotage.** Gate06:83–95 fails the selector test
at worker source220: actual EIP false, independent expected true. Fixed-order source identifies
the disambiguating explicit row11 (source0MAX hiding eligible31); the raw failure itself does
not print a row number. Bit0-only is not the discriminator. Gate05 is a missing-workspace-member
setup failure before tests, not a second semantic run. The critic's read-only crosscheck records
both Main and restored scratch source hashes as9f5def69… and byte comparison succeeds.

**P8 NEEDS EVIDENCE only for the final promoted-head submission/clone.** Completed gate03 passes
30 native tests (2 snapshot +13 IRQ +10 PLIC +4 worker +1 chain),3 actual-WASM tests, scoped
format/clippy/builds. Gate01 stopped before tests because the existing GPU test calls a method
behind `gpu-trace`; Makefile adds that existing feature to the lib-test command only, not a GPU
runtime fix. Demo JSON records126/0, no non-favicon errors/HTTP errors, and taskO present; the
critic viewed the retained PNG confirming those visible counters and task. No browser was opened.
The unchanged production hunk is fully exercised; new wrappers' cfg/import/declaration lines,
types, comments and constants are non-executable scaffolding, not missing runtime behavior.
No added ignore, semantics-altering cfg(test), mock selector, or output-derived oracle was found.

One reporting correction remains for submission: worker `source-scope.md` lists the older
shared-fixture hash b5a88a79…; frozen and executed source is8d9e49aa… after the seed spelling
format repair. Correct the narrative digest; no implementation change or repeat old gates needed.

## Promotion and retained records

Main may promote these NEW paths and include `--test plic_sparse_verifier` in the existing native/
WASM test and clippy commands. Expected final totals are31 native and4 WASM. Main owns all git,
task metadata and the single final clone; this critic has not changed them.

| Artifact | SHA-256 |
| --- | --- |
| `crates/core/tests/plic_sparse_verifier.rs` | `ee20dd7699a4620df73cb9e892d8b51624300257bca2d97afac47d0d8dc7c87b` |
| `crates/core/tests/support/plic_sparse_verifier_cases.rs` | `f30fd3a6e154ff0422a964345671385a5b36fa94e3e5c192ce0e272cb6d4084e` |
| `crates/wasm/tests/plic_sparse_verifier.rs` | `4ab40edc364fff64fe521656ffadc76474bc9612e4f15e5d990a4e1ddd1e5c65` |
| `verifier/variant-raw.log` | `975f508b96760be1509adeb776705fffdaf7fb23778daf0eb62b097dae2a6a3e` |
| `main-gates/03-corrected-gate.log` | `036a1b0a0162a6c84c53b93e44e3a9c51a203af367810a901876ac07449e0f89` |
| `main-gates/06-mask-sabotage-complete.log` | `964edaac68021bd2ee95d221818fe5db40c69c2d0fd0401246fea9fe0102b1b9` |
| `demo-02c79f56/demo-suite.json` | `ee502ad7af5e3aa3841102a3ba1249efd87debb02d504b7b6f90c2dc6196b61e` |
| `demo-02c79f56/demo-suite.png` | `46a753395058747ae625cdc575bcabb1ecfb0700d4f960e01d1536a25dda88a6` |

Evidence paths above are relative to `evidence/e5-t26o/` unless starting with `crates/`.
Reproduction: `bash evidence/e5-t26o/verifier/run-variant.sh <isolated-target-directory>`.
Executed once per target using `/private/tmp/e5-t26o-verifier-target.0CBXZGLc`; this is build
output isolation, not another clone. Existing M/N, image, observer, polling and F harness
boundaries carry unchanged. No old-task replay, F boot, deployment or speedup claim is added.
