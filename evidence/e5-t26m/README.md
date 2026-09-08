# E5-T26m — interrupt-only inline-cache context changes

Status: verified by fresh Daybreak critic in
`a438e53930ec9aabcb829cf50d4a578769e3c84a`; see
`verifier/final-verdict.md`. No speedup or F-acceptance claim.
Task: `tasks/epic-5-the-window/E5-T26m-inline-context-interrupt-bits.md`.
Activation commit: `aa03fe85933e9b9730bb747d903bba57c9b13f36`.

The only proposed product change is excluding mstatus bits1/3/5/7 from the
browser inline-cache comparison. Live architectural status, all other cached
authority inputs, interrupt sampling, translator support and chain budgets stay
unchanged. Luna owns code/tests; fresh Daybreak owns adversarial review. Main
coordinates frozen gates, the built-page proof and the single final clean clone.

Preflight: `../e5-t26f/inline-context-candidate/critic-preflight.md`.
Predictions made before worker evidence: `verifier/plan.md`. Both forbid causal
attribution of the existing timing failures or claiming F passes from this task.

Prior closed layers remain distinct:

- PR368, `0c9abdac4e4dcde60eb4815b3fab0fa2d629c25b`: observer correctness and
  actual restore/audio evidence hold; original4.362200-second endpoint fails.
- PR369, `f8ac2c99f5f6bc5f9941fca75af9af5afac32343`: the single print-only
  counterfactual fails at4.101870seconds and is closed. No repeat or promotion.
- Its separate existing guest-PC sampler reports many compiled-engine entries
  and few dynamic-link hits, but does not isolate context invalidation as a
  cause. Kernel-PC labels and all sampling limitations are retained there.

The current task changes an execution-cache boundary, so its final source must
earn its own scoped native/actual-WASM regression proof and built-page screenshot.
Unchanged older tasks and guest-image/C-observer proofs are carried, not rerun.
After this task is independently verified, F still requires fresh exact-runtime
browser evidence and its unchanged two-second, restore/drag/input/audio criteria.
No merge, production release, Omarchy mutation or Epic6 work follows completion
of this prerequisite alone.

## Frozen worker submission

Runtime/test/build freeze: `deb595c78aa96cbcbc674fa3cbe30a7e53dd522f`.
Diff baseline: activation `aa03fe85933e9b9730bb747d903bba57c9b13f36`.
Exact inputs are recorded in `main-gates/08-frozen-inputs.sha256` and the
command head in `main-gates/08-frozen-head.txt`.

`make verify-E5-T26m` exits0 (`main-gates/08-frozen-runtime.log`):

- affected format and actual wasm32 library/parity-test clippy pass;
- native interrupt13 + privilege11 + PMP audit4 + seeded adversarial1 =29 pass;
- core no-default-features wasm32 and real-CSR wasm builds pass;
- actual Node WebAssembly library9 + parity37 =46 pass,0 fail. The one ignored
  long E4-T33 externref/eviction churn test is unchanged and not claimed here;
- actual compiled static/dynamic targets survive each interrupt-only status
  change, SUM clears dynamic publication, and live M/S pending-interrupt
  state matches interpreter before the compiled successor can execute;
- existing inline memory, page-write/PMP/execute-remap/static/dynamic link,
  bounded chain, precise-fault and host-memory-growth regression paths pass.

Main viewed `demo-deb595c7/demo-suite.png`. Its adjacent JSON records the same
built runtime's126 passed/0 failed, empty console/page error and HTTP-error
arrays, and the visible E5-T26m task as in progress. Runtime WASM SHA-256 is
`18e53caa2e160819d16a6e0bf376530d45234e28f315c89b5042c48b1d791cc4`.
The unchanged F harness, observer/image and all performance thresholds are
outside this successful scoped claim. Negative-control provenance and the
immediate post-sabotage source restoration are in `main-gates/README.md`.

Luna's late `worker/inner-loop-*.log` files contain narrative results rather
than raw process output; they were not needed, committed or relied on for this
submission. Main's raw logs preserve all executed integration/frozen commands.

## Final promoted-test freeze and clean clone

Head `7f007bd28e0d8a73ed46d03c7f9bd803449157ee` promotes only the independent
combined-bit test. Its parity source matches the critic's executed scratch
digest `73fdbf1c2b5e730e932910e8af4d05be0dd8d275ac63c698854f0eb4308e5bac`.
The affected actual-WASM harness passes9+38=47 tests,0 failed,1 unchanged ignored
(`main-gates/09-promoted-harness.log`). Runtime, Makefile and the viewed demo
bundle are byte-identical to the prior freeze.

The one final command is
`bash evidence/e5-t26m/run-final-clone.sh 7f007bd28e0d8a73ed46d03c7f9bd803449157ee`.
`main-gates/10-final-clone.log` records a no-local clone, detached exact head, no
object alternates, initially/finally clean checkout and fresh default target.
The scrubbed-environment make target passes29 native+47 actual-WASM tests and
all scoped format/clippy/target-build checks, exit0. Retained checkout:
`/private/tmp/e5-t26m-final.fpoX9HG8/repo`. No second clone or old task suite ran.
