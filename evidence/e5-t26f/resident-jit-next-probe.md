# Resident F: next bounded JIT measurement, not an optimization claim

Read-only inspection at `3174e1c5013cb551f88ccd258ffb9c2e596139ea` (2026-09-08).
No browser, builds, installs, runtime/helper/image/runner edits or acceptance
waivers. This document is the only write. Render-path work is deliberately excluded.

## Findings: eligibility is clear; actual residency is not

The candidate ELF loop `0x4dcb6..0x4dcd6` is **eligible by its instruction content**:
four `lw`, four `sw`, two `addi`, and `bne` (11 instructions, 36 code bytes,
16 copied bytes per iteration). It has no CSR, WFI or unsupported operation,
fits the 128-op block bound and stays within one 4-KiB code page. Compressed
LW/SW/ADDI normalize to the same supported instructions. References:
`target/e5-t26f/guest-symbols.LIWp5R/memcpy-hot.txt:67`,
`crates/core/src/decode_c.rs:107,122,135`,
`crates/core/src/dispatch.rs:75`,
`crates/jit-translate/src/lib.rs:1861`.

This is not proof that the loop was installed or ran compiled. Discovery counts
**physical block entries**, nominates at the selected threshold, and can lose
counts/jobs to bounded capacity, invalidation or eviction; installation can also
refuse translation/module/instance creation. See `dispatch.rs:613,647`,
`core/src/lib.rs:4106`, `wasm/src/jit_browser.rs:1715,1751,1773`.
The loader selects threshold **512**, not the core default 64
(`web/loader.js:608`); an isolated stable 11-op loop reaches 512 entries after
roughly 5,632 interpreted loop instructions / 8 KiB copied, before queue delay.
That is a scale calculation, not a measurement of this guest's promotion.

The hot 64-byte region `0x7fff9b209cc0` maps *conditionally* to ELF offset
`0x4dcc0` under the separately observed musl mapping. It overlaps the loop and
tail, not a uniquely identified block. The PC profiler has no PID/SATP tag and
excludes JIT retirements (`core/src/lib.rs:4838`); it samples approximately one
in 1024 **interpreted** retirements. Preserve the critic's mapping/identity limits
in `resident-verifier/guest-profile-results.md:64`. Do not call 4.600391% of its
after histogram 4.6% of whole-guest or host CPU time, or assign it to a caller.

## Cold restore and inline memory: facts versus hypotheses

Successful whole-machine load **deliberately flushes predecode, resets discovery,
and invalidates all compiled code** (`core/src/lib.rs:3253`). Browser invalidation
also resets inline TLB and link caches (`wasm/src/jit_browser.rs:2030`). Therefore
fresh restore is cold by design; the unproven proposition is that coldness explains
most of the failing interaction interval. Do not preserve stale compiled code or
pre-warm by delaying/resetting the acceptance T0.

The production executor already selects `MemModel::InlineTlb`
(`wasm/src/lib.rs:530`, `wasm/src/jit_browser.rs:1043,1097`), not unconditional
load/store imports. Generated aligned hits perform raw RAM LW/SW; misses call
the real MMU and refill (`jit-translate/src/lib.rs:2681,2729`,
`wasm/src/jit_browser.rs:760,786`). This loop's aligned 32-bit accesses qualify
when the actual mappings are ordinary RAM with valid permissions/cache tags.

There are 256 direct-mapped entries per permission array; context changes clear
them (`jit_browser.rs:60,177,199,211`). Inline stores also append host commit
records, with capacity 128, and code-page writes can stop a chain
(`core/src/jit.rs:81`, `jit-translate/src/lib.rs:2771,2827`,
`jit_browser.rs:1632`). These mechanisms are possible costs, **not observed causes**.
Read/write arrays are separate, so equal-index source/destination pages alone do
not imply a read-versus-write collision. Nor does store-log fullness follow from
this loop alone: 128 retirements of an 11-op/four-store loop are fewer than 128
stores (`jit_browser.rs:64`). Do not prescribe a larger log or TLB from this lead.

## What the retained measurements already say

Recomputed from the **resident** `resident-profile-33a65efb/`
`failure-post-restore-interaction-checks.json`, JSON pointer
`/milestones/interactionLatency/schedulerSamples` (14 completed samples):

| JIT observation interval after original T0 | Guest retirements | JIT delta share | JIT retires/engine entry | Installs / evictions / retranslations |
| --- | ---: | ---: | ---: | --- |
| 918.335–4473.000 ms | 44,481,053 | 38.481% | 13.746 | 485 / 91 / 284 |
| 918.335–2583.220 ms | 22,988,982 | 48.136% | 18.594 | 256 / 49 / 131 |
| 2806.200–4473.000 ms | 18,992,936 | 28.303% | 9.375 | 205 / 42 / 132 |

The all-interval throughput is 12.513 M retirements/host second. These are deltas
of actual JIT samples at their own completion timestamps, not scheduler snapshots
taken before the subsequent JIT RPC. The early/late slices are descriptive, not
matched workloads; they leave the inter-slice gap out. Both have real compiled
execution and continuing churn. This does **not** look like demonstrated simple
one-time warm-up followed by a stable hot cache. It cannot identify which physical
blocks were evicted or prove that retaining them would help.

The sampled CPU report `resident-profile-analysis/README.md` attributes only
0.341% self time to Module+Instance creation, while execution/selection and
interpreter costs are mixed. Thus “compilation itself consumes seconds” is not
established. The separate interpreted-PC run has 1671 cumulative samples in
`0x7fff9b209cc0`, but lacks this region in its before top ten. Never substitute
zero for that absent entry or splice its counts into the CPU-profile run.

## Next action: one observation-only default-policy reuse

Use the current sealed resident checkpoint, original physical **play / 5-ms**,
divider 10, original restore T0/cap, fresh PCM and all existing guards. No CPU
profiler simultaneously. Keep non-acceptance labeling and the failing cap.
Use the already admitted guest-profile mode (`E5_T26F_DIAGNOSTIC_GUEST_PROFILE=1`),
then have the coordinator's bounded collector read these existing controller APIs:

1. At the existing before/after profile endpoints, retain the full scalar
   `await controller.jitStats()` alongside `profileStats()`. Add at most two
   intermediate observations near T0+1 s and T0+2 s. One in-flight request only;
   skip an intermediate sample if still pending. Record request/receive times
   separately, timeout/fail explicitly, and never delay the immediate PCM/end
   capture behind a pending observation. All probing overhead remains recorded.
2. Keep `schedulerStats()`/`workerRpcStats()` as context if already collected;
   do not combine forbidden diagnostic flags or change worker/runtime code.
   APIs are already forwarded at `web/loader.js:1171` and
   `web/linux-worker-protocol.js:86`. Existing `guest-profile.mjs` arms and validates
   the actual worker profiler; no fabricated profile or new guest-control API.
3. Retain the fields below (the current latency picker at
   `browser-roundtrip.mjs:870` discards several already-exposed discriminators).

| Existing `jitStats()` fields | Falsifiable distinction |
| --- | --- |
| `hasExecutor`, `guestRetired`, `retiredViaJit`, `executedBlocks`, `compiledBlocks` | Actual execution versus merely enabled; interval JIT share and retires/entry. `compiledBlocks` is a live gauge, not a cumulative compile count. |
| `jitSubmittedMembers`, `jitCompilePauseNs`, `jitCompilePauseSamples`, `jitCacheInstalls`, `jitCacheRetranslations`, `jitCacheEvictions`, `jitCacheBatches`, `jitCacheCodeBytes`, policy/cap | Warm-up that settles versus sustained turnover; compile cost only when its timer is actually armed. |
| `blockEntryHits`, `blockBuilds`, `decodedBlocksDiscarded`, `decodedCacheFlushes`, `discoveryGeneration` | Compiled churn versus decoded-cache/context invalidation. |
| `directChainEntries`, `directChainLinks`, `entryCost.hostEntries`, `stateCopyCalls`, `stateCopyBytes`, `memorySplitExits`, `deviceBoundaries`, `indirectTableDispatches`, `authorityChecks`, `timingEnabled`, `timerReads` | Short entries and boundary frequency; no inference from disabled zero timers. These entry fields are nested under `entryCost`. |

The scalar implementation is `crates/wasm/src/lib.rs:547–756`; compute deltas
from raw counters, not differences of cumulative ratio fields. Require positive
guest progress and reject resets/missing fields. Check candidate virtual regions
in each actual `profileStats().regions`, preserving top-ten/collision limitations.

**Decision rule:** settling installs/evictions plus rising interval JIT share
supports a warm-up direction; sustained retranslations with falling live blocks
and short entries supports investigating residency/invalidations instead. High
JIT coverage with frequent memory/device splits supports a boundary-cost lead.
None alone proves this particular memcpy block's state or warrants optimization.

**Hard limit of existing APIs:** there is no exported per-PC `isCompiled`,
nomination/refusal reason, inline-TLB load/store hit/miss count, context-reset
count, or raw-store commit count. `memorySplitExits` is aggregate chain aborts,
not a TLB miss counter; an ordinary RAM refill need not abort a chain
(`jit_browser.rs:760,786,2013`). `profileStats().walkCount` likewise is not the
generated inline-TLB miss rate. Low split counts cannot falsify refill overhead.
If the bounded aggregate probe cannot distinguish the remaining hypotheses,
stop and request one narrowly authorized per-physical-block/inline-memory
measurement boundary; do not guess or start optimizing from the PC histogram.

## Inputs authenticated during this inspection

- `memcpy-hot.txt`: `caa59900c4c53285be86e9c92691285c5f3eef63231d26548746285183b9d4a1`.
- Resident guest-profile JSON: `2a6b016ba535eea9ce2d7860266d32aabc44904e6689e5e0a250650c63d86229`.
- Resident CPU/latency JSON: `8ac788611082e02b83711428731ec84c11ffc5af528223676067ae16716550c0`.
