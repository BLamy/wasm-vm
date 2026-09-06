# Repaired reuse guard predictions

Registered 2026-09-06T06:13:12.298Z, before the adapted attacks or expanded actual-clone check.
Reviewed working-tree harness is based on HEAD
5506f2a514a6a7b90d83eafe8cf39e6d3ff4fd1b, SHA-256
ac413df34da56adb631a5c4f2215626683142de37041af31f0dea686c0086112. The frozen browser clone remains on the earlier harness.

- Q1: Unchanged synthetic prior/current repositories pass the repaired actual
  reuse branch; a committed change ONLY inside verify-E5-T18e's recipe also
  passes. This positive control exercises the Makefile masking itself.
- Q2: Working anchor replacement (including both working records) and old-record-
  only replacement are rejected against the named HEAD blob. The sourcePaths
  HEAD guard and the branch-local anchor comparison are tested separately.
- Q3: Dirty and committed changes to wvrun, static-agent build scripts, their
  linker wrapper, tracked .cargo configuration, and tracked toolchain files
  are rejected. A newly introduced optional, untracked build configuration or
  toolchain file must not silently satisfy a claim that build inputs match.
- Q4: Dirty and committed changes to a non-proof Makefile recipe or a global
  Makefile variable are rejected; task-proof-only recipe changes remain allowed.
- Q5: Ordinary old-source, compiled-WASM and inline-JIT rejection controls carry
  HELD without repeating them; cache calibration, cache regressions and their
  mutation result carry HELD while the cache module hash is unchanged.
- Q6: In the real frozen current/old clone pair, the committed anchor, expanded
  tracked build-input trees, non-proof Makefile text, and actual working bytes
  will still match. Check read-only; do not invoke the full reuse branch on real
  clones because it copies files and installs observer dependencies.

All fixtures and git commits are disposable test inputs only. No user-repository
commit, status, queue, runtime, image, browser boot or frozen clone source changes.
Preserve the original attack records and write this rerun to new evidence paths.
