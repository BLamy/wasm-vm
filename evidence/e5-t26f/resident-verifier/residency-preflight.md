# Resident existing-policy ABBA — preflight predictions

Scope: diagnostic admission/collector changes in
`tools/verify/e5-t26f-resident-proof.{mjs,test.mjs}` and
`tools/verify/e5-t26f-residency-comparison.{mjs,test.mjs}` only. No implementation,
browser run, broad gate, task status, queue or commit. Only this note is writable.
Prior unchanged H/I/J/T19a and F functional/diagnostic results carry under their
existing bindings. No new residency benefit or default-policy claim is assumed.

The following falsifiable predictions were written from the coordinator's
intended boundary **before inspecting the pending diff or new evidence**. Both
workers are still finishing; inspect their completed patch after the coordinator's
freeze notice, not intermediate edits. Every prediction is currently UNCHECKED.

## Prediction ledger

1. **Narrow admission.** Resident policy comparison requires explicit diagnostic
   `reuse`, explicit JIT `1`, and exactly `repack-off` or `cap-256`. Missing,
   malformed or conflicting selections fail before browser work. The new branch
   does not admit this comparison to cold creation or normal acceptance, widen
   supported resident labels to `cap-1024`, or change existing default behavior.
   Assess unchanged legacy diagnostic routes separately, not as new permissions.

2. **Isolation.** The new resident comparison rejects profiler, command, explicit
   pacing, clock/divider and COMPLETE overrides, including conflicting inherited
   environment variables. It retains physically typed resident `play` at 5 ms,
   the prepared-player guards, finite feed/close and same-child successful wait.
   The quiet runner's independent strict admission remains effective: this module
   change must not inadvertently authorize tuning its RAM-modified quiet fixture.

3. **Actual policy endpoints.** Every arm requires actual worker `hasExecutor=true`
   and requested residency policy/cap at both endpoints: `repack-off`/24 or
   `cap-256`/256. URL/env labels alone cannot satisfy this. Missing, malformed,
   mismatched or stale observations fail closed; existing positive-retirement
   freshness checks survive. Counter extraction uses real nested field shapes
   (including `entryCost.hostEntries`), not a fabricated top-level equivalent.

4. **Unchanged time and playback.** Actual restore completion remains original T0,
   and the literal all-success cap remains 2,000 ms. No observer time is subtracted,
   no clock is reset, and no first-PCM observation substitutes for completed
   playback. Each usable arm still requires actual guest-visible input, focus,
   cursor/gesture, positive fresh non-silent PCM and conditional successful player
   completion. The collector does not convert an early functional failure into a
   usable timing result merely because a later PCM field is positive.

5. **Four genuinely matched arms.** The resident path uses one authenticated
   prepared checkpoint and distinct copied profiles in A/B/B/A order
   (24/256/256/24). All four agree on actual runtime, kernel/image/manifest/helper,
   original snapshot/profile binding, browser/configuration, command and pacing;
   only the declared existing residency selection differs. The source seal is
   not modified/rebound, and an interrupted or incomplete run is not reported as
   completed ABBA. Existing nonresident behavior is not silently relabeled resident.

6. **Failure retention and classification.** Original child exit/error and raw
   canonical JSON/PNG/logs remain intact. A nonzero child is usable only for the
   exact expected F cap failure after required functional checks, with a finite
   original end-minus-start above 2,000 ms. Wrong phase/error, missing evidence,
   policy/identity failure, or another functional failure aborts aggregation.
   Accepting a cap-only child for this diagnostic does not label that child or
   the comparison F acceptance; successful child paths still require their proof.

7. **Truthful counters and conclusions.** The collector preserves raw endpoint
   values and derives valid deltas without treating live `compiledBlocks` growth
   as compilation count. Endpoint RPCs may include execution beyond the frozen
   interaction window; do not label their deltas exact timed-window costs or
   convert sample/counter shares into causal attribution. A completed four-arm
   diagnostic—particularly one where all arms miss the cap—is not a statistically
   established improvement, an F pass, or authority for default promotion.

## Planned bounded checks after freeze

- Read the completed four-file diff and its tests; map changed admission and
  collector branches to the predictions without rerunning held native/browser
  suites or inspecting the separate 73e JIT-cost record.
- Inspect negative coverage for forbidden flag combinations, live policy/cap
  mismatch, stale/malformed counter endpoints, binding drift, incomplete ABBA
  and non-cap failure masquerading as an eligible arm. Use only a narrow offline
  reproduction if a concrete uncovered ambiguity needs falsification.
- Record exact inspected source/test hashes and concrete findings before any
  inference from future browser outcomes. No finding or successful preflight is
  presumed while the patch is unfinished.

## Finished admission patch — incremental review

Reviewed the actual 13-line module addition and all changed tests after the
coordinator reported that worker finished. Collector remains in progress and
has not been inspected. No admission blocker found at the hashes below.

- P1 — admission HELD. `residentFixtureRequested` lines 15–27 requires the exact
  paired selection `reuse` + JIT `1` + `repack-off`/`cap-256`. Supplying either
  tuning key alone enters the strict branch and rejects; `cap-1024`, coerced,
  malformed, empty or missing counterparts do not enter the resident comparison.
  Normal resident omission and prior nonresident policies remain unchanged.
- P2 — admission isolation HELD. All eight conflicting diagnostic flag families
  are checked for literal absence, including empty/null values. The function
  does not mutate/normalize flags. Actual runner selection retains `play`/5 ms
  and forwards the existing URL policy labels. Its quiet-text sibling still
  independently rejects both newly admitted policy combinations after the module
  returns true; no quiet fixture is accidentally authorized for this comparison.
- P3 — runner-side endpoint checks carried and exercised by the new tests. The
  actual extracted `recordDiagnosticJit` still checks executor, policy and numeric
  cap on both calls and positive safe guest-retirement progress at the after
  endpoint. Missing/fallback/mismatched before state is retained then rejected;
  identical before/after retirement counts reject. These are fake-RPC predicate
  tests, not observed browser policies. Collector validation remains unchecked.
- P4 — admission does not change timing/audio. The normal runner retains
  `jitBefore` after original T0, `jitAfter` after frozen end, and the literal
  2,000-ms assertion. No post-restore work is subtracted or PCM oracle changed.
  Counter endpoints therefore still span extra execution, not an exact frozen
  interaction window. Actual browser playback/timing is not inferred here.

Independently ran only the seven new admission/selection/endpoint tests:

```sh
node --test --test-name-pattern='resident .*requires isolated|resident residency|actual quiet scratch|outside the paired opt-in|admitted residency' tools/verify/e5-t26f-resident-proof.test.mjs
```

Exit 0; 7 tests passed, 0 failed/skipped. Did not repeat unchanged sound/parser,
quiet browser, calibration or broad gates. The reported 23/53 worker counts
are not represented as independently rerun. P5–P7 and collector aspects of
P3/P4 await the completed collector patch; this is not combined ABBA preflight
completion or a policy/acceptance claim.

| Inspected file | SHA-256 |
| --- | --- |
| tools/verify/e5-t26f-resident-proof.mjs | 452b861012761eb112e39097a05eff44cadcfabbcc89ac789f1e7c373cd4c4da |
| tools/verify/e5-t26f-resident-proof.test.mjs | 536e02a51ccbdcc46bc2ecdcb64b72eeb6f9e0ad1757752e10db740bcfddd55c |

## Final collector review — frozen after the manual arms

The earlier pending observations above are historical. Read the completed
collector and all 18 tests at the hashes below, including the resident headless
correction. No new blocking finding within this incremental diagnostic boundary.
This is not an F verification or an end-to-end run of the collector's spawner.

- P1/P2 — HELD for the changed selection boundary. `residencyOptions`,
  `childEnvironment` and `armSettings` require explicit resident inputs, scrub
  inherited task/compiler flags, select resident headless `0`, and emit only
  reuse/JIT1/policy controls. Resident command/pacing remain the proper runner's
  `play`/5 ms, not overrides. Legacy headed behavior and its explicit clock/pacing
  remain separate. Tests cover missing/malformed input, both policies, conflicting
  inherited flags and all four inherited HEADED variants. The actual earlier
  headed failure is retained, not silently converted into an arm.
- P3/P4 — HELD for collector assertions. `collectResidencyRecord` and
  `validateResidentRecord` check both live executor/policy/cap endpoints, safe
  nonregressing nested counters with positive retirements, original T0/end,
  physical command acceptance, current green, same restored CRC/no boot and
  two locked-zero PCM observations followed by fresh positive completion PCM.
  No clock receipt is invented where the run made no clock RPC. Tests deliberately
  corrupt each of these boundary families, including stale endpoints and false
  cap/error consistency.
- P5/P6 — HELD for the observed four-arm collection. Exact binding equality is
  enforced across runtime/image/fixture/profile/snapshot/prepared state; explicit
  inputs are preflighted, existing output refuses before spawn, and the source
  loop is ABBA. The actual experiment used four direct proper-runner invocations,
  not this top-level loop. Their distinct profile paths, settings, exit-1 cap
  errors and raw files were independently checked in `residency-results.md`.
  The extracted pure collector accepted all four unchanged records offline.
- P7 — HELD with the limits in the closed-results report: live gauges are not
  compilation counts, counter RPC spans are not the frozen interaction interval,
  and all four caps failed. No general benefit/default-policy/F claim follows.

Coverage accounting: the new resident test fixtures explicitly relabel a retained
profiled record for **unit-only** policy cases; they are not browser policy proof.
The closed raw ABBA supplies that independent evidence. Filesystem and spawn-refusal
tests use stubs; environment/option tests execute the actual extracted helpers.
Source assertions cover the loop wiring, not a real collector-spawn execution.
This distinction is sufficient for this offline collection claim; no new browser
run is requested. Old legacy counter tests remain unchanged. The coordinator's
52-test log was inspected (52 passed, zero failures/skips); its 18 collector tests
were read, not represented as a new independent suite rerun. No additional attack,
browser, build, broad gate, status/queue edit or K review was performed here.

| Final inspected file | SHA-256 |
| --- | --- |
| tools/verify/e5-t26f-residency-comparison.mjs | bfb6a63ff1450afbbd94fff579ed570d30495ad64dc55a3beece1f2f534ed610 |
| tools/verify/e5-t26f-residency-comparison.test.mjs | 2f5b667b38f9bb58e377e43703d71dd130b4dc785e1fce477e3a97624146bba4 |
