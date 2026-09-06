# Final bounded reuse-guard proof — all identified findings closed

Exact main head: `0d966c1fb8ef31e05c2bca52e1a191d9de235af3`.
Harness SHA-256:
`e4aba2537476b5ed093cf729991693f1dd0adf581dcaa390f8284620566df816`.
This closes the identified reuse-preflight findings only; it is not the final
E5-T18e verdict or an independent sign-off on the ongoing 27-case browser matrix.

## Final delta — HELD

`reuse-final-guard-attack.json` records 11 cases, each run twice against the actual
extracted branch, with real fs/git calls on disposable fixtures. The final npm
install is the only stub. Source and predictions are preserved in
`reuse-final-guard.snapshot.txt` and `reuse-final-guard-predictions.md`.

- U1: An unchanged pair passes. Dirty old generated dist manifests and sw.js also
  pass; no exception is made for the reused runtime files' separate hash checks.
- U2: New .cargo/config and rust-toolchain are rejected in both current and old
  checkouts. All four variants also reject when hidden by .git/info/exclude:
  eight negatives total, exercising the deliberately unfiltered ls-files check.
- U3: A dirty tools/build-file-agent.sh in the old checkout is rejected by the
  added old tracked-input diff. That script is absent from previous.sources,
  so the rejection specifically exercises the new transitive-input condition.
- U4: The exact added old-checkout git diff passes on the real original 9ed clone
  with zero output when generated web/dist is excluded, as recorded in the JSON.

All 11 predictions HELD. The runner exits zero only when all its cases match
their expected acceptance/rejection. No browser, guest boot or image build ran.

## Incremental carry

The preceding 22 HELD repair cases remain held: named-HEAD anchor checks,
tracked current/committed wvrun/build-agent/linker/Cargo/toolchain changes,
non-proof Makefile rejection, and proof-recipe-only acceptance. Their underlying
checks are unchanged; this final delta adds the untracked and old-checkout checks.
The two previously failing optional-input cases are superseded by U2 above.

`reuse-final-guard-delta.json` independently confirms that:

- The tested harness bytes equal the 0d966 committed blob.
- Expanded build/runtime input trees have no diff from frozen 5506 to 0d966.
- Only the permitted proof recipe differs in Makefile after masking.
- The cache module remains SHA-256
  `056054b90fe110a99d8847c0e3c0f944835d7a83ae6ca877a3216584a46ef845`.

Carry the actual frozen input checks in reuse-repair-frozen-check.json, including
absence of untracked/ignored Cargo/toolchain overrides in both real clones.
The old dist-only generated differences are explicitly documented there and do
not invalidate the reused runtime hashes or corrected browser proof assumptions.

Carry the prior cache calibration, direct real-worker observations, two promoted
regressions and successful cold-guard mutation check without rerunning them.
Runtime, image/rebuild, Docker drills, original functional observations and all
unchanged T18a-d results remain HELD. The 5506 browser clone stayed untouched.
Its remaining cases and final report still require independent evidence audit;
this report neither assumes their outcome nor demands another boot matrix.

## Durable paths and command

Run: `node evidence/e5-t18e/verifier/reuse-final-guard-attack.mjs`.
Disposable fixture paths and both repetitions' full results are in its JSON.
The earlier repair evidence is preserved under reuse-repair-*; original findings
remain historical observations rather than being rewritten as passes.
Both repair bundles have separate SHA256SUMS files, checked after preservation.
No implementation, task status, queue, original clone, image or user-repository
commit was changed by the verifier. The parent owns the recorded main commits.
