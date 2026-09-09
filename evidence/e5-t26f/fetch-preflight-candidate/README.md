# Fetch-preflight candidate — exploratory, not adopted

The current production runtime is unchanged. E5-T26f remains in progress; its
latest ordinary browser restore screen is still 3591.965ms against a 2000ms
limit. This candidate has not passed that acceptance command, the focused
semantic matrix, or a production-bundle/browser comparison.

## Result and scope

Luna's isolated WASM probe removes a duplicate successful address translation
after an uncompiled JIT entry. A private, same-dispatch physical-address hint
is consumed by the decoded interpreter; no public compatibility API is added.
The candidate changes only scratch `crates/core/src/lib.rs`.

Three baseline/candidate/candidate/baseline quartets in one Node/V8 process
produce six samples per version/case, 24 total. The all-miss mean decreases
from 422.5387638333332ms to 369.2915833333334ms (12.602%). The JIT-off control
changes from 325.01343749999984ms to 325.5477778333334ms (+0.164%). These
are synthetic all-miss loop measurements, not an Omarchy or desktop speedup.

The modules use the emulator core compiled to WASM, but not BrowserExecutor
or the packaged production module. Node24.20.0/V8 13.6.233.17-node.53 runs
with `--no-liftoff --no-wasm-lazy-compilation`; Rust1.96.0 uses opt-level3,
16 codegen units and debuginfo2, without a wasm-opt pass. Compile and wrapper
setup, post-run checks, checksums and teardown are outside timing; checks and
allocations internal to the emulator's run remain timed. The fixture has permissive
PMP, a warm Sv39 mapping/decoded cache, 10000 warmup instructions and a
12000000-instruction timed loop, with a synthetic always-missing executor.

Every row checks retirement and exact miss count. The equal digest covers
only integer registers, PC and MINSTRET, not RAM, other CSRs, FP or devices.
It is not proof of full architectural equivalence. The preserved older native
experiment used concurrent executables and is not a controlled cross-version
timing comparison; its limitations are corrected in `wasm-probe/README.md`.

## Source and evidence identity

The paired source trees were seeded with `git archive` from
`415db223733214b6c6e7b69b0ad331150969be56`, not pristine verification clones.
The complete experiment remains at
`/private/tmp/e5-t26f-fetch-probe.83cUcL`.

- Baseline core lib: `9e2d235163d528112ab0375886e2bdf4e602c0dbdceaf7e486abad0b6d78b053`.
- Candidate core lib: `a63eb5b34305c4554ddc87b36bc0c9821df414b915ddbccd83b6c654daf655ce`.
- Baseline WASM: `dad5ef710880bab481d9679601c11c8397627a598280a16f290d2cb679ebaaad`.
- Candidate WASM: `4eabd93506b2dc778a1a7276854b351d1abd87a4aa6c8fe9b9188a289d0bfcee`.
- Raw build log: `c6842a8bcc374f1720f4eb904d8954a65053600b3d23e616212f1259185b65eb`.
- Raw timing log: `fc54cc6a86ee23297da423d8a0d2d09d719f77ef12da5b3bdc87e67706256c27`.

`probe-evidence.tar.gz` preserves both modules, adapter/native fixture sources,
paired core libraries, lock/config inputs, build/run scripts, raw records,
the original native report, and Daybreak's source-only review. It excludes
compiler caches and unrelated repository/user files. `wasm-probe/SHA256SUMS`
inside the bundle authenticates the original worker files. Rebuilding requires
the rest of the frozen source tree from the commit above; the bundle is evidence,
not a standalone source distribution. Existing binaries can be replayed using
the pinned engine and the command in the bundled worker README.

Bundle SHA256: `fe51363e03fee97af0ac416dc694adb14ee249ce7c4d510df1480cc5d63af8e9`;
5368168 bytes, 28 members. The coordinator checked the paths and verified all
19 worker digests by reading the corresponding members from the archive,
without another build or benchmark.

## Independent review and next boundary

Daybreak's source-only report gives GO for a bounded proposal, not verification
or adoption. SHA256:
`e9ea72994e77e00a93d582f12d85a274edea485e99335b6757542c67d7660048`.
Its literal preregistered no-interposed-drain prediction failed: a cache drain
does occur. A separately labeled, post-inspection source argument establishes
that this drain changes cache metadata, not guest translation state. The
original prediction is preserved; the GO is not an all-predictions-held claim.

Before any adoption, prove successful-entry translation count, fetch/PMP faults,
other JIT refusal paths, SFENCE/PMP/code-write coherence, execute-trigger ordering,
counters and both record-requiring and `wants_records()==false` traced callbacks.
Then apply the task's risk-tier gates to the exact adopted source. No further
browser boot or task activation is justified merely by this synthetic result.

The user's clean-release direction is recorded separately in E5-T28a: remove
obsolete production launchers and old-version compatibility branches, keep the
current optimized entry, and preserve architecture, integrity and user data.

Daybreak independently reviewed the saved WASM artifacts and recomputed the
statistics without rerunning the probe. `wasm-results.md` gives sound support
for considering the bounded proposal; SHA256
`e6570093e09bcec7147bd645cdd6bd5f72e1c11b2e119c8af0202934b0b2a594`.
Its separate pre-inspection predictions are in `wasm-predictions.md`, SHA256
`43ca02e4e937dab5210cba31629c856c7baf6c2686c84f7f45dffbe9569f7b13`.
These two review files are alongside the bundle, not inside it. The report
explicitly limits exhaustive build provenance and independently observed warmup
timing: the saved evidence does not establish either. It does corroborate the
identified modules, symmetric recorded inputs, measured order and arithmetic.
No hermetic-build, statistical-equivalence or production-performance claim is made.
