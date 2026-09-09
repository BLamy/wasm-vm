# F discovery observation — fresh critic preflight

Base `4671c61bf0bc0f7cac151f4b4eb6955a45db1dd3`. Independent F critic,
never implementer. Read current F header, acceptance criteria and new log plus
the complete offline collector/tests before opening any new gate/browser evidence.
Existing K/H/I/J/T19a and unchanged F functional results carry HELD; F's original
2000-ms failure remains. This is projection/accounting review, not F verification.

## Predictions before evidence

1. **Read-only actual projection.** `jitStats().discovery` copies the existing
   core snapshot's named counters/gauges/generation; no counter increment/reset,
   queue drain, guest retirement, compilation, policy or snapshot mutation on a
   read. Fresh JS objects cannot mutate the machine or later observations.
2. **Exact accounting.** Positive nominated/deduped/overflow/count-map exhaustion
   and exclusion states project the matching core field, not another counter or
   a hardcoded zero. Gauges may fall; only cumulative counters are subtracted.
   Generation must match the existing actual discoveryGeneration field.
   A positive droppedStale execution is not assumed: zero plus direct-field
   mapping may carry that unchanged core producer, explicitly scoped as such.
3. **Fail-closed collection.** Missing, malformed, negative or unsafe integer
   fields, impossible queue/map bounds, changed generation, regressed cumulative
   counters, non-progressing guest/JIT endpoints or a different policy refuse.
   Nonzero since-reset drop totals remain visible even when interval deltas are
   zero. These aggregates cannot identify per-PC membership or a latency cause.
4. **Original observation boundary.** Only explicit resident reuse, JIT1,
   repack-off/24, default4096 and unprofiled physical `play` at5ms are admitted.
   Existing T0 equals actual restore completion; before lies inside the interval,
   after follows frozen end. No profiling/command/clock/pacing/COMPLETE changes,
   reset clock or subtraction of observer overhead. Only the exact original cap
   error may count as a completed negative measurement; no F verdict follows.
5. **New-byte provenance and limits.** The unchanged proper runner returns the
   full owned-worker snapshots; the offline helper preserves raw endpoints and
   input-file digest without overwriting raw evidence. New projection WASM gets
   a newly authenticated cold seal, never the old K seal rebound. Actual browser
   fields/identity/PCM and outcome await that recording. Narrow projection gates
   suffice for this increment; no broad K rerun/new pristine clone is presumed.

All new execution predictions are NEEDS EVIDENCE. Static findings and source
pins follow after reading the frozen projection; no new logs or browser records
have been inspected, and no tests/build/browser/status/commit action was taken.

## Completed source preflight — no critical pre-cold blocker

Read the frozen 20-line projection and all six new WASM test definitions after
writing the ledger. Compared the complete helper and three Node test definitions,
new Make target, existing core producers/reset and unchanged proper-driver RPC
ordering. No new runtime correctness or diagnostic-isolation refutation found.
Worker pass counts remain claims until the completed recordings are reviewed.

- **P1/P2 static support:** `crates/wasm/src/lib.rs:743` reuses the already-read
  `machine.discovery_stats()` snapshot. Ten direct named-field conversions build
  a fresh JS object; both wrappers use this shared getter. No new core call,
  setter, drain, reset or execution hook occurs. Existing discoveryGeneration
  uses that same snapshot. The only runtime diff is these 20 projection lines;
  core, policies and proper runner are unchanged. As with existing statistics,
  u64 values are converted to JS numbers; the offline consumer refuses values
  outside safe-integer range rather than asserting arbitrary-u64 exactness.
- **P2 semantics:** core `dispatch.rs:467` defines the six counters and three
  gauges. `stats()` derives queueDepth/candidates from live container lengths;
  bounds 4096/65536 match collector limits. `reset()` clears counters but retains
  the lifetime queue high-water mark, while invalidation can change generation
  without resetting totals. Requiring equal generations before subtraction is
  conservative and correct. Queue high-water is a historical maximum, not
  current backlog. `countsDropped` counts refused tracking attempts, not unique
  PCs; deduped includes already-Queued/Excluded entries, not solely compiled hits.
  Overflow's Queued marking at `dispatch.rs:663` is unchanged intentional
  anti-storm behavior. A positive total proves an event occurred since reset,
  not that a particular hot block remains suppressed or causes host latency.
- **P3/P4 static support:** helper lines11–24 reject missing/unsafe fields,
  impossible bounds and nonmatching actual generation/policy/capacity. Lines28–63
  enforce reuse/fixture/command/pacing/isolation, real endpoint progress, original
  T0/end, stable generation and nonnegative six-counter deltas. A before reply
  must precede end; after request must follow end. Gauges/endpoints are retained,
  not subtracted. Lines69–71 preserve nonzero since-reset drops at delta0. The
  exact original cap error remains required for negative collection, while
  `fVerified` is always false. Nothing rewrites timing or adds live sampling.
- **P5 static support:** the unchanged proper runner at lines716–748 records the
  full awaited worker `jitStats()` object, retains raw bad observations and checks
  actual executor/residency/fresh retirement. Its existing before/after calls
  remain after T0 and after frozen end respectively. No new flag, hot-loop timer,
  worker RPC or clock export is introduced. Offline CLI lines75–85 hashes the
  actual input bytes and writes a new output with `wx`; it cannot overwrite the
  source record or an existing output. New bundle/cold authentication is still
  necessary and has not been inspected or inferred from the old K seal.

### Coverage required from the already-planned narrow recording

The six WASM fixtures use actual guest instructions and wrappers, not a mocked
DiscoveryStats struct: initial shape through both wrappers; real nomination,
dedup and compiled progress; CSR exclusion; a 5000-entry queue overflow with
non-draining repeated reads and restore; a 65537-entry cold-map flood; and
bare-metal shared projection. They assert snapshots/digests/clock/read stability
and mutation of a returned JS object not affecting subsequent observations.
Expected field values come from bounded guest behavior. Positive droppedStale is
explicitly not exercised: zero plus the inspected direct-field projection and
unchanged core producer is the bounded disposition, not a claimed new stale-job
execution proof. No per-PC observation is required for this aggregate layer.

The three Node fixtures modify an old real record with synthetic discovery
values, explicitly marked unitOnly. They cover field/bound refusal, subtraction,
falling gauges, preserved raw state, zero-delta lifetime drops, policy/interval/
generation regressions and non-cap errors. They prove collector accounting only,
not new browser counters. The CLI file-output path and positive-cap outcome are
source-reviewed here, not claimed as executed acceptance. The planned actual
negative or positive record must retain its raw file and exit outcome.

The collector is **not a replacement F acceptance/provenance validator**: it
carries binding/profile/snapshot fields and relies on the unchanged proper
runner for CRC, guest completion, fresh PCM and browser-error checks. Review
those canonical raw fields/PNG and the new seal independently alongside its
output. This is a scope limit, not a demand for new privileged/per-PC plumbing or
an unrelated gate. Missing actual records are pending evidence, not a pre-cold
source blocker. No causal policy fix or performance result is predicted.

The added Make target selects WASM fmt/clippy, discovery plus held capacity WASM
tests, helper syntax/tests and affected resident/worker plumbing. It correctly
labels the browser measurement separate and not F acceptance. No full K repeat,
new pristine clone, browser launch, gate run, implementation/status change or
commit was performed by this critic.

## Inspected worktree source SHA-256

Pins identify this preflight snapshot, not a final built release or run.

| File | SHA-256 |
| --- | --- |
| tasks/epic-5-the-window/E5-T26f-desktop-browser-roundtrip.md | 6249838bb10be555f6878e8a631f483415252a4a877051269172045591d5036c |
| crates/wasm/src/lib.rs | bd19b54e044ca5497d4624fe299ce561f9b676de6467b1f112a3bba58fd5f77a |
| crates/wasm/tests/discovery_stats.rs | ecb473af2ca60ebea0db3d2a6e16fbad0df9d4ed59560820fd62634c7b02f8e9 |
| crates/core/src/dispatch.rs | 5e6ccdd33f9dc9c948dde6e8daa4b69d8f008330169cdecbdfb3356b3d6dc04d |
| crates/core/src/lib.rs | 7f8c72c28cd51afaf44834fd809e9781ea6c27c6d8f6f2f97f1452bb77f9791a |
| tools/verify/e5-t26f-discovery-observation.mjs | 4bc9e00027a42465a37364cad1b707c87da78806a1c0d20d5729109728004d04 |
| tools/verify/e5-t26f-discovery-observation.test.mjs | 35eb06ea4a414d2cb9d68e4ec338b66e70e0715ba9cd91d5c6af392c9ba1d56b |
| tools/verify/e5-t26f-browser-roundtrip.mjs | bfcdc06f6d6ec330815d7ad12b7a0c101035a11d50348828fe2d39a7370cb219 |
| Makefile | 2bbbbeaf01938aa9790b33ecda680b2e819e9566d0c03ba8be7cfa0105b0b4d0 |
