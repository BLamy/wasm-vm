---
id: E9-T22d
epic: 9
title: Measure the unchanged complete replay performance budgets
priority: 524.92204
status: cancelled
depends_on: [E9-T15, E9-T16, E9-T19, E9-T22c]
estimate: S
risk: medium
capstone: false
---

## User scope amendment — 2026-10-28

The user explicitly requested: “can we please just skip the cold boot and replay you have been working on that one ticket for days”.

The complete two-profile performance campaign is deferred with its waived original-cold qualification prerequisite. No recording-overhead, storage-growth, memory or replay-latency budget is declared passed. Status `cancelled` records removed scope, not a successful
verification verdict. The original criteria and all prior failures remain below
for audit. Do not restart this long boot/replay campaign without a new user
request. Continue E9-T23 recovery and E9-T24 bounded user-flow integration;
functional seeking/replay tests remain required for those product behaviors.

## Goal

Prove every unchanged T01 recording, storage-growth, memory and seek budget.

## Boundary

The complete equal-work measurement campaign after genuine OFF, shared real
networking and both real workloads are independently verified. This is the
original E9-T22 measurement obligation. No requirement was removed by splitting
its missing runtime prerequisites.

## Acceptance criteria

- [ ] Publish raw repeated samples, p50/p95 preview/restore/replay-forward latencies, cancellation acknowledgement, genuine recording OFF/ON wall ratios, actual peak additional recorder memory, bytes/minute and checkpoint cadence for both full pinned profiles.
- [ ] Complete seed17, 100 inputs at offsets500000/stride500000, ten rewrites, ten exact1KiB HTTP responses, 20 frozen LCG seeks, the full600000ms observation window and five alternating A/B pairs per profile. Preserve every unfavorable/first-load attempt and equal actual work; no truncation or idle/bare-MMIO substitution.
- [ ] Report short/long histories and initial/cached loads separately; distinguish thumbnails from actual restored state. Verify the required CPU/RAM/device/disk/clock/pending/cursor/file/entropy/HTTP/GPU witnesses and zero replay egress while measuring real completed work.
- [ ] Apply all original T01 numeric budgets unchanged. Any later failed-budget change requires an explicit revised contract and preserved failures; no MIPS or instant-scrubbing claim follows from a thumbnail.
- [ ] Freeze and record the selected medium-risk gates plus final campaign at the exact head; obtain fresh actual Daybreak acceptance/coverage and one bounded novel attack, then push the native PR open and publish any browser-impacting result on the main Cloudflare URL.

## Deterministic acceptance

`make verify-E9-T22d`; retain `make verify-E9-T22` as the complete-campaign entry
point. Both are planned targets to implement with this task, never placeholders
that pass using an offline setup prefix or only a subset of profiles/metrics.

## Adversarial verification

Repeat dirty RAM, sustained files/network and actual GPU readback with independent
seeds. Keep first loads and slow samples, inspect raw timing/memory/growth
accounting and real seek readiness, and independently recompute every statistic
against the frozen budgets. Fabricated idle-only wins, requested-work counters,
changed workload amounts or recorder-active OFF baselines refute the task.

## Verification log

(pending; no implementation or verification claim)
