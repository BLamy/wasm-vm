# Cache guard and reuse-boundary attack predictions

Registered 2026-09-06T05:57:58.135Z, before executing these attacks. Candidate
5506f2a514a6a7b90d83eafe8cf39e6d3ff4fd1b. No boot reruns.
Original partial evidence stays unchanged; no final verdict or task status change.

Source snapshots under review:
- `tools/verify/e5-t18e-cache.mjs`: `056054b90fe110a99d8847c0e3c0f944835d7a83ae6ca877a3216584a46ef845`.
- `tools/verify/e5-t18e-cache.test.mjs`: `15b003abf15c4133d2f10d3fcec7e71d70bc967cd8792f159e347cdafdb82d11`.
- `tools/verify/e5-t18e-desktop-bringup.mjs`: `bbd686c740157b58520cb64c61b1b9bbdaeeca18a63d67c94477ca48114fb37e`.

The C1-C3 predictions in initial-run-cache-qualification.md carry forward.
Use the actual cache module for calibration and readWorkerCache; perform routing
sabotage only in a disposable copy. Also sabotage the cold-cache assertion in a
disposable module and require a promoted regression to fail.

Additional reuse predictions, before fixture execution:

- R1: An unchanged synthetic repository pair with a committed initial publication
  and matching old source/runtime digests must pass the actual extracted reuse
  branch (positive control). This executes no build, image hash or guest boot.
- R2: A changed tracked input under crates must be rejected (negative control).
- R3: Changing tools/guest/wvrun.sh or tools/build-file-agent.sh should be rejected
  as changed image-build input. Suspected failure: both are outside the branch's
  inputs allowlist at harness lines 87-91, although build-rootfs.sh invokes or
  mounts them (lines 51-57 and 72-73).
- R4: Mutating both working copies of the initial publication, while leaving the
  committed anchor untouched, should be rejected. Suspected failure: the guard
  reads its expected bytes from the working tree, not HEAD (lines 80-82), and
  that anchor is absent from sourcePaths.
- R5: An ordinary old-source or compiled-runtime byte mutation with the unchanged
  publication must be rejected by the old-file digest checks.
- R6: Mutating the old inline JIT snippet must be rejected against its git-bound
  digest, independent of the previous 14-file runtime map.

Exercise real fs/git calls in disposable miniature repositories, extracting the
reuse branch verbatim and using the real hash functions. Stub only the final npm
install (it is not a guard). Do not run the full harness or alter its sources,
the original clone, or any recorded image. Temporary fixture git commits are
solely inputs to testing the git-diff boundary; no commit will be made in the
user's repositories.
