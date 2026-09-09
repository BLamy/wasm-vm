# Reuse guard repair — bounded recheck, no final verdict

Reviewed working harness SHA-256:
`ac413df34da56adb631a5c4f2215626683142de37041af31f0dea686c0086112`,
based on `5506f2a514a6a7b90d83eafe8cf39e6d3ff4fd1b`. Snapshot:
`reuse-guard-repaired.snapshot.txt`. Predictions preceded execution in
`reuse-repair-predictions.md`.

## Repaired findings — HELD

`reuse-repair-attack.json` contains 24 independently constructed fs/git fixtures,
each checked twice against the actual extracted new branch and source-path HEAD
guard. Only the final npm install is stubbed; no image/build/browser is invoked.

22 cases HELD:

- Unchanged repository pair accepted; a committed proof-recipe-only Makefile
  change also accepted. The Makefile masking is exercised, not merely inspected.
- Replacing both working publication copies is rejected by the HEAD guard.
  The same attack, independently routed directly to the reuse branch, is rejected
  by its new named-HEAD anchor comparison. Old-publication-only changes fail too.
- Both dirty and committed edits are rejected for wvrun, each of the three agent
  build scripts, the Zig linker wrapper, tracked toolchain.toml and tracked
  .cargo/config.toml (14 cases).
- Dirty/committed non-proof Makefile recipe edits and a committed global variable
  change are rejected (3 cases).

Thus the earlier mutable-anchor and omitted-tracked-build-input findings are
repaired for this source snapshot. Ordinary old-source/WASM/JIT mutation controls
and the unchanged cache guard's real-worker/mutation results carry HELD; they were
not rerun. The cache module hash remains
`056054b90fe110a99d8847c0e3c0f944835d7a83ae6ca877a3216584a46ef845`.

## Remaining bounded input gap — untracked configuration

At `tools/verify/e5-t18e-desktop-bringup.mjs:89-92`, the expanded git diffs still
do not inspect untracked files. Both pre-registered optional-input cases fail:

- `new-untracked-cargo-config`: add .cargo/config containing a build.rustflags
  setting, without changing the tracked .cargo/config.toml.
- `new-untracked-toolchain`: add rust-toolchain containing nightly, without
  changing tracked rust-toolchain.toml.

Both fixtures are accepted twice and report `buildInputsUnchanged: true`, while
their recorded git status explicitly lists the added input. This is a reuse
preflight gap, not a runtime or image semantic finding.

Demand: reject undeclared optional Cargo/toolchain files, including ignored ones,
within those protected paths. Do not require cleanup of unrelated/generated dist
outputs. Recheck only these cheap negatives and the positive control when that
guard changes; the 22 HELD cases need not be restarted if their boundary is intact.

## Actual frozen inputs — HELD, no boot restart

`reuse-repair-frozen-check.json` independently checks the expanded conditions
read-only on the 5506 frozen clone and the original 9ed clone:

- Named-head, working and prior publication bytes agree at SHA-256
  `c0ae77aa9eb3680153802bc22fd05ca0d379ca73179165912ee5ce9c7673a3c5`;
  the prior binding recomputes exactly.
- Expanded previous-to-current tracked build trees have no diff; the frozen
  current working inputs and expanded source-path HEAD guard also have no diff.
- Actual Makefiles match after only the task's proof recipe is masked.
- Neither clone has untracked or ignored optional Cargo/toolchain inputs.

The extra whole-old-working-tree scan found generated dist artifacts-node-alpine,
artifacts.json and the service-worker VERSION change. They are not part of the
reused 14-file runtime map or source map and are not served in the corrected run.
This additional scan is not a predicate in the repaired guard. Its preliminary
nonzero output is preserved as `reuse-repair-frozen-check.preliminary.json`; the
completed check records the exact diff and its bounded classification rather
than misrepresenting the old working tree as entirely clean.

The current run's checked input assumptions therefore remain HELD. Its ongoing
browser evidence is not re-run or invalidated by these fixture-only findings.
Runtime/image/rebuild, earlier drills and all unchanged T18a-d results carry HELD.
No final 27-case verdict is implied.

Commands: `node evidence/e5-t18e/verifier/reuse-repair-attack.mjs` and
`node evidence/e5-t18e/verifier/reuse-repair-frozen-check.mjs`.
The parent added the promoted cache test to Makefile and reports 30 passing
selected tests. The older unit-tests.log still contains the earlier 23-test
recording; the new 30-test recording has not been independently inspected here.
Main worker files, the frozen
clones, image, task status, queue and commits were not changed by the verifier.
Prior hash-bound audit files remain unchanged. This repair delta is covered by
`reuse-repair-review.SHA256SUMS`.
