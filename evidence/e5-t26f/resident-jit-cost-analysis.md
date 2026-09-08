# Resident JIT-cost probe — failed timing, diagnostic only

Source head: `73e7e4d9a9cdcf8df1b463fced753267759c0367`; capture: 2026-09-08T10:58:16.618Z.
This is a `reuse`, `acceptance:false`, guest-profile diagnostic with physically typed
`play` at 5-ms key edges. **F remains timing-failed, not verified.**

## Outcome and measurement boundary

The [failure JSON](resident-jit-cost-73e7e4d9/failure-post-restore-interaction-checks.json)
records `postRestoreStart=1139.0249999761581` and
`postRestoreEnd=6082.97000002861`: **4943.945000052452 ms**, exceeding 2000 ms.
The separately sampled `postRestoreInteraction.elapsedMs=4944.360000014305` is not
the cap's subtraction. `postRestoreAplay.accepted=true`, ten keyboard transitions
match, and completion PCM has **1440 written/non-silent frames**, with read/write
indices both 1440. The [PNG](resident-jit-cost-73e7e4d9/failure-post-restore-interaction-checks.png)
shows the upper terminal's retained PID 999/start 27744, post-check PREPARED/zero
pointers, green `e5t26f-aplay`, `[1]+ Done`, and prompt. The lower terminal's old
underrun text is not the resident command's output.

Both `milestones.guestProfile{Before,After}.checksPassed` are true; both nested JIT
reads are available, with null errors, no timeout, and empty `invalidFields`.
Profile request→receive intervals are **1407.805→1418.930** and
**6084.125→6135.070 ms**; JIT intervals are **1418.930→1466.200** and
**6135.070→6186.340 ms** (rounded). These sequential RPCs are not atomic samples:
the first read is after original T0, and the second follows frozen end. Do not
divide these deltas by the cap duration as an exact throughput measurement.

## Retained scalars

Counter values below are exact `guestProfileAfter.jit.deltas`, checked against
endpoint subtraction. Ratios below are derived from interval counts,
not differences of cumulative ratios.

| Counter or group | Interval value |
| --- | ---: |
| `guestRetired` / `retiredViaJit` | 54,474,955 / 21,224,304 |
| Non-JIT remainder / JIT retirement share | 33,250,651 / 38.9616% |
| `executedBlocks` = `jitEngineCalls` = `entryCost.hostEntries` | 1,562,290 |
| `directChainEntries` / `directChainLinks` | 4,066,425 / 2,504,180 |
| JIT retires / logical blocks per engine call | 13.5854 / 2.60286 |
| `jitCacheInstalls` / `jitCacheRetranslations` / `jitCacheEvictions` | 602 / 305 / 98 |
| `jitSubmittedMembers` / `jitCompilePauseSamples` | 603 / 109 |
| `jitCompilePauseNs` | 26,684,999 ns (26.684999 ms) |
| `decodedCacheFlushes` / `decodedBlocksDiscarded` | 0 / 0 |
| `blockBuilds` / `blockEntryHits` | 774,152 / 5,891,249 |
| `dynamicLinkAttempts` / hits / refusals / installs / retargets | 504,942 / 45,074 / 459,868 / 328,592 / 0 |
| `chainDispatchEntries` / `chainLinksFollowed` / made / cut | 981,962 / 1,511,778 / 213 / 181 |
| `entryCost.stateCopyCalls` / bytes / ns | 3,124,580 / 278,263,752 / 142,349,942 |
| `entryCost.engineEntryNs` / `timerReads` | 561,609,915 / 9,962,960 |
| `entryCost.indirectTableDispatches` / `authorityChecks` | 355,604 / 1,538,084 |
| `entryCost.memorySplitExits` / `deviceBoundaries` / `deviceBoundaryNs` | 17,606 / 0 / 0 |

Configuration stays executor-on, region/dynamic chaining-on, `repack-off`, cap 24,
and `entryCost.timingEnabled=true`. Live gauges: compiled blocks **103→137**, batches
**15→24**, code bytes **1,213,249→1,830,193**, dynamic live entries **7→9**.
High-water chain depth **9→27**, compile-pause maximum **1,645,001 ns unchanged**;
discovery generation **5→5**. These are gauges/ordinals, not interval work counters.

## What this does and does not establish

- Zero decoded flush/discard deltas and unchanged generation rule out **recorded
  bulk decoded invalidation within this endpoint interval**, not earlier restore
  invalidation, capacity/conflict replacement, or poor working-set reuse. Builds
  are 11.6145% of builds-plus-entry-hits; that is not a universal cache miss rate.
- JIT eviction/retranslation activity is real; its cause and lost execution
  coverage are not localized. Two endpoints establish neither warmup trajectory
  nor per-PC compiled membership, including the prior memcpy candidate.
- State-copy time is **142.349942 ms**, engine-entry time **561.609915 ms**; these
  instrumented measurements and compile time are not a complete, disjoint
  wall-time decomposition. Nearly ten million timer reads also make this a
  profiled run, not an uninstrumented performance baseline.
- **17,606 memory-split exits are not TLB misses. Zero device boundaries is not
  zero TLB misses**, nor proof of no whole-machine device work. The interpreted-only,
  sampled, cumulative top-10 PC histogram cannot assign whole-guest CPU shares.
  Its interval totals are 30,605 samples, 684,268 walks, 1,581 collisions, and
  4,704,605,007 ns; do not add that time to the JIT timers.

The single count-grounded candidate worth isolating is repeated decoded-block
construction (774,152 builds despite no bulk invalidation). Its host cost and
capacity/conflict cause remain unmeasured: these results alone justify neither
changing the cache/probe limit nor predicting a speedup. No optimization is claimed.

## SHA-256 provenance

Computed from the retained files; runtime binding is reported by the JSON, not
recomputed against a possibly newer live build. The [server log](resident-jit-cost-73e7e4d9/failure-post-restore-interaction-checks-server.log)
records the actual `linux-worker.js?profile=1` request.

```text
failure-post-restore-interaction-checks.json
3bf07a9e6fb184d929805c889ac13908fe2579143aef99394e18c08971ea7b50
failure-post-restore-interaction-checks.png (also post-restore.png)
d4537508f5cb7f9be48b0819bf90eea066d5bf4a699d670fcdf004554cec8bd6
failure-post-restore-interaction-checks-server.log (also post-restore-server.log)
4719527b1e1d24e6d30abf21aacf33c541d1d1068a1fa6d16f3b863cca4a4637
post-restore.json
61b70f77495ca3770dabd3b965a8940dbeee10cbda495576275e899996f18c21
reported runtime binding
42aced7a2dfc4d0a69e1ea5a15685f5d9a605f797f8df1c5db89f95051ba0425
reported kernel / image
af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce
27c2e8f2789b18efac214837c295dbfb22559beea350fb5788f71edfdc0f0a8e
```
