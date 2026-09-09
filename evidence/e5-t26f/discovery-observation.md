# F discovery observation

This is a read-only localization increment within in-progress E5-T26f, not F
acceptance, a new prerequisite task, or a JIT-policy change. Prior K and F
functional HELD results carry; the original two-second interaction criterion
is unchanged. No production deployment or merge accompanies this experiment.

## Frozen inputs

Runtime/source commit: `690e23245b4b376c55c0b830f7690c8a0f72059e`.
Built source/dist WASM SHA-256:
`e5e73a60e2e05690e20ae8f40f54bdbd8d6987b1ae589952146d780c3e2266f4`.
The only runtime change copies ten existing discovery fields into the shared
WASM `jitStats()` result. Existing flat fields and all core producers, thresholds,
bounds, executor policy, guest clock, proper browser driver and image are unchanged.

The six real-WASM fixtures cover both wrappers, detached/read-only observations,
nomination/deduplication, CSR exclusion, queue overflow, cold-counter-map
exhaustion and restore behavior. Positive stale-request execution is not claimed:
that unchanged producer is covered here only by zero observation and inspected
direct-field projection. No arbitrary-u64 precision claim is made; consumers
refuse observed unsafe JavaScript numbers.

## Narrow submission

`make verify-E5-T26f-discovery-observation` passed WASM fmt/clippy, nine real-WASM
tests (six new discovery, three unchanged capacity) and 72 Node tests. Complete
recording: `discovery-gates/runtime.log`. `make web-dist` succeeded in
`discovery-gates/web-dist.log`; the two unrelated dist manifests were restored
byte-for-byte from their pre-existing backup and excluded from this commit.

The built-page Chromium smoke passed 126/126, zero console/page/HTTP errors,
and displays F as IN PROGRESS. Command:
`E5_DEMO_TASK=E5-T26f E5_DEMO_OUT=evidence/e5-t26f/discovery-demo node tools/verify/e5-t18e-demo-smoke.mjs`.
Canonical JSON and viewed screenshot are under `discovery-demo/`.

Fresh Daybreak source predictions and completed narrow-gate review are in
`discovery-verifier/preflight.md` and `discovery-verifier/gates.md`. Neither
claims F completion or an observed browser latency cause.

## Browser recording

`node evidence/e5-t26f/discovery-690e2324/run.mjs` starts one new headless
Chromium cold boot on origin `http://127.0.0.1:61633`, then one resident reuse
with explicit JIT1/repack-off24. Default decoded capacity4096, guest clock/divider,
physical `play` and 5-ms key edges remain unchanged. No CPU/guest/entry-cost
profiling, quiet output, COMPLETE mode, command override or pacing override.
The script scrubs inherited diagnostic/compiler overrides and refuses an existing
invocation output. Old checkpoints are never rebound.

The actual invocation, source hashes, fresh retained profile path, each raw
proper-runner record/PNG/server log and each child exit are retained under
`discovery-690e2324/`, with outer output at `discovery-690e2324.log`. The offline
collector reads the closed raw record and writes a new `observation.json` with
its input digest; it does not modify the canonical evidence.

The cold recording closed successfully at 13:00:02.658 UTC with a new sealed
profile `e5-t26f-discovery-XRWve7` under the platform temp directory. Its profile
digest is `68ee83c092ab7627523ac4fd4837dc845d27a62e27af7cb883ff6961c55fcb87`,
runtime tree `bf20ff6317d43a6069c49f85d84fd6167bb74bfd417e6ac873bf27d36810c440`,
and envelope `263ba774eb5dd211775ef26dc9896e2d784ccbb59f4866d9541ad20d19db34c6`
(2807910 bytes, CRC `80ab2d17`, overlay generation631).

Baseline reuse exits1 on the original cap: T0 `1210.7450000047684`, end
`5801.920000076294`, **4591.175000071526 ms**. It restores the matching CRC
without booting, delivers ten matching physical key events, and produces the
fresh green marker plus1440 written/non-silent PCM frames. The viewed PNG shows
the same prepared PID999/start28696, successful child Done and prompt.

| Actual discovery field | Before | After | Delta/type |
| --- | ---: | ---: | ---: |
| nominated | 271 | 3316 | 3045 |
| deduped | 552317 | 4124902 | 3572585 |
| droppedStale | 0 | 0 | 0 |
| droppedOverflow | 0 | 0 | 0 |
| countsDropped | 0 | 0 | 0 |
| excluded | 22 | 29 | 7 |
| queueDepth | 0 | 25 | gauge |
| queueHighWater | 137 | 137 | lifetime maximum |
| candidates | 3735 | 28425 | gauge |
| generation | 5 | 5 | unchanged |

Zero since-reset drop totals do not support the discovery-overflow/exhaustion
hypothesis for this run. They say nothing about the separate compile-staging
queue. Nominations and submissions are different layers, not a unique-PC
conversion funnel. Guest/JIT retirement deltas are53475451/21041082; compiled
blocks95→130, installs584, retranslations237, evictions98 and decoded builds700099.
Sequential RPC spans are not the exact F interval. Both timing-enabled flags are
false; zero timing counters do not prove a compile-pause bound. The generic failed
JIT capture does not retain complete browser-error arrays. Coherence, subsequent
drag/restore and guest-hover checks are not reached by this failed-cap recording.

Daybreak independently recomputed the new seal/profile/runtime/envelope hashes,
viewed both PNGs and closed all five scoped observation predictions in
`discovery-verifier/browser-results.md`. F remains timing-failed, not verified.
Four incremental collector tests cover the successful-cap branch without F
verification, actual CLI input hashing, and output/input overwrite refusal:
`discovery-gates/collector-guards.log` records7 passed, independently reviewed in
the incremental section of `discovery-verifier/gates.md`.

## Existing latency probe on the same release

The first wrapper placed its invocation in the protected child output directory,
so the proper runner refused **before browser launch**. All source/log/exit files
under `discovery-690e2324/latency/` and `run-latency.mjs` are retained unchanged;
this is not a timing run. `run-latency-replay.mjs` fixes only the orchestration's
directory layout, keeping invocation/logs outside `latency-replay/record/`.

The corrected recording uses only the existing isolated `LATENCY=1` option and
the same authenticated checkpoint, command and5-ms key edges. It retains a new
profile copy; no runtime, policy, clock, image or deadline changes. The proper
child exits1 on the original cap **4726.939999938011 ms**. Original T0 is
`1171.2150000333786`, end `5898.15499997139`.

The50-ms observer last sees PCM writeIndex0 at3767.2400000095367 ms, then
sees1440 fresh non-silent frames at3818.1599999666214 ms. The first observed
green completion is4670.02999997139 ms. These are sampled bounds, not an exact
first-write instant or an unprofiled acceptance result. In this observed run,
waiting for the completion marker alone cannot explain the entire2-second miss.
All14 completed scheduler samples show continuing retirement, scheduler.postTask,
zero timer yields and zero fetch waits; the15th pending-at-stop is retained.
Do not interpret those scoped counters as proof of zero persistence/host delay.
The canonical JSON and viewed PNG retain the same CRC/identity/ten physical
events/green completion and1440 fresh PCM. Independent Daybreak review is closed
in `discovery-verifier/latency-results.md`: HELD as diagnostic evidence, original
F timing FAILED. It checked all77 PCM samples, all14 completed scheduler samples,
the pending15th sample, actual screenshots, source pins and refused attempt.

## Bounded next candidate: compile-staging priority

Luna's one native source-level reproducer under `compile-priority-reproducer/`
uses actual public discovery/queue types and the real decoded `jal x0, 0`.
Both jobs are staged with priority64; after1000 additional observations for the
later job, live priorities are64/1064 but stored priorities remain64/64 and the
older job still pops first. It has zero drops/stale events and valid bytes.
This composes the production staging API sequence; it does not execute Machine,
instantiate a JIT, model the desktop schedule or establish a browser cause.
The source phenomenon, command, log and unchanged pins are retained separately.
No runtime priority policy has changed in this PR.

The older already-closed profiled recording
`resident-jit-cost-73e7e4d9/failure-post-restore-interaction-checks.json` also
retains actual `guestProfileBefore/After.state.jitPause` fields. These profile
RPCs have runCount12→121 and totalAttemptedBlocks96→968, with the observed
maxRunAttemptedBlocks8 at both endpoints. Thus the109 recorded completed scopes
used872 attempts, saturating the existing8-attempt per-scope bound. Submitted
blocks96→700 are604 in that profile interval, not the603 delta from the later,
sequential `jitStats()` interval. Do not mix these endpoints or assign the gap
to a particular rejection cause. This is historical profiled evidence from
another checkpoint, not a new unprofiled measurement or current queue-depth
observation. Together with the source-level priority staleness, it motivates
a bounded scheduling candidate, not a predicted speedup or waived deadline.
