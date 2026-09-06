---
id: E5-T22g
epic: 5
title: Gate browser-JIT entry timing behind explicit profiling
priority: 522.295
status: implemented
depends_on: [E5-T22f]
estimate: S
risk: high
capstone: false
---

## Goal

Remove high-frequency `performance.now()` sampling from the normal browser-JIT
entry path while preserving the structural cost ledger and exact guest behavior.
Timing remains available when profiling is explicitly enabled. This is a measured
E5-T22c prerequisite, not a claim that resize now meets two seconds.

## Boundary

Own only the browser executor's optional entry-cost clock and propagation of the
existing profiling state across executor installation/replacement. Keep JIT
translation, chaining, cache policy, scheduler budgets, guest clocks, device
timing, architectural state, image/kernel and snapshot formats unchanged.

## Acceptance criteria

- [x] In an actual browser Web Worker with profiling off, compiled execution and
      all deterministic entry-work counters remain live while entry-timer reads
      and entry nanoseconds remain exactly zero. Prove this in Chromium and
      Firefox; WebKit is outside this task.
- [x] Enabling profiling before or after JIT attachment arms entry timing;
      disabling stops new reads immediately; re-enabling resumes them. Replacing
      an executor preserves the machine's current profiling state.
- [x] Identical fixed-retirement runs with timing off/on have equal outcomes,
      architectural registers and RAM digests. The default-off worker path still
      executes compiled blocks, and the profiling-on control records real reads.
- [x] The built demo passes 126/126 with zero browser/HTTP errors. Re-run the
      unchanged v7 desktop without either profiler, report all seven resize
      timings and retain client/mode/EDID/scanout/canvas agreement. Do not mark
      E5-T22c verified unless its own two-second gate passes.

## Verification command

make verify-E5-T22g

## Adversarial verification

Exercise profiling-before-executor, executor-before-profiling, disable/re-enable,
and executor replacement. Require independent timer-read deltas so zero elapsed
nanoseconds cannot masquerade as zero clock calls. Sabotage the default gate to
enabled and require the profiling-off browser test to fail. Compare fixed guest
state after the same work under both timing modes, and verify that guest/device
clocks and scheduler budgets are not routed through this diagnostic switch.

## Verification log

### 2026-09-06 — worker — in-progress

E5-T22f is independently verified. Its profiler-enabled maximum-resize capture
reduced PMP synchronization from 30.71% to 0.35%, then attributed 13.46% of total
sampled CPU to `performance.now()` through the browser-JIT entry timer. Source
inspection confirms the executor constructs and reads that timer even when the
machine profiler is off. Isolate that diagnostic clock behind the existing
profiling control; preserve C's complete timing requirement and immutable v7
desktop evidence.

### 2026-09-06 — worker — implemented

Frozen implementation head `9c7861d23bec091fa37f8da23cce830154dd1a83`
(`655abd86` runtime implementation plus `9c7861d2` history-independent cold
recipe/cache stamp) passed `make verify-E5-T22g` from the retained pristine clone
`target/e5-t22g/cold/sw-calc.uhTpTMvB/repo` under an otherwise empty environment
with only the trusted Rust/Node/system tool paths restored. The immutable external
v7 image and chunk manifest were SHA256 `811267cbf96c1e055e31063829580432d5e5e343cff1a975f5fc10664cc2e00e`
and `935a9fe2bf6022b01ac6147665b9ca59736930b6e265e33069318e4d9cc2ccaa`.
The complete transcript is `evidence/e5-t22g/cold-clone-final.log` (SHA256
`a4bf554d6b90113aa59dfc4dc89f338d8e6e3af14150afde5e5ed1b2ec26b3b2`);
the clone remained tracked-clean after the run.

Actual dedicated-Worker evidence is
`evidence/e5-t22g/cold/browser/results.json` (SHA256
`f435ae02b64b1e4df87df84a4fc35a1b9ddbcb66fe09450018794752355ddb64`):
system Chromium 152 and Firefox 132 each retired a fixed 400,000 instructions per
phase through compiled blocks. Profiling off recorded 3,175 host entries, 6,350
state-copy calls and 77,736 bytes but exactly zero timer reads and zero entry
nanoseconds. Profiling on recorded 19,056 timer reads in each browser; disable,
re-enable, enable-before-attachment, and executor replacement all held. The
always-off and toggled runs both retired 1,600,000 instructions with equal
registers and RAM digest
`6976cebc670e2c4165f17e942fa31dce90227428ff2885b790cc49d7dbfd5748`.
Both browsers also rejected the forced default-on sabotage at the profiling-off
assertion. Clean-build `web/pkg` and committed `web/dist/pkg` Wasm were byte-equal
(SHA256 `81584279aef8c6719c045b9d979bf532949b8e97c661732ee713112986b2ccab`).

The unchanged unprofiled v7 desktop result is
`evidence/e5-t22g/cold/desktop/results.json` (SHA256
`0dcae8efd09f40bbc5e29a058ffdac6cd9f4020f3ffbf1826af82e74b9a5eb8d`),
which records head `9c7861d2`, `profile=false`, `cpuProfile=false`, no browser
errors, and first-frame timings: 803x603 1878.89 ms; 640x480 1501.98 ms;
1280x800 2128.86 ms; 2560x1600 5267.67 ms; 801x601 2746.01 ms;
802x601 1774.20 ms; 1201x801 2221.27 ms. Every mode retained Weston PID
961, Foot PID 1018, EDID/GPU/scanout/canvas dimensions, and pixel digest
`5f514001ec640d0c264f7cc4937e33db530649fc873bb36512811cbd02ef3444`.
These timings deliberately do **not** satisfy E5-T22c, which remains blocked.
Finally, `evidence/e5-t22g/cold/demo/demo-suite.json` (SHA256
`4d79c86ecd6a41a664a91e670ca2d39bb2607efdba4e7d20337f613ea69ddbe4`)
records 126 passed, zero failed, zero page/console/HTTP errors.
