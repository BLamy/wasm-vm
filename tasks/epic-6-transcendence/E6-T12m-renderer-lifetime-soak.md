---
id: E6-T12m
epic: 6
title: Close the renderer milestone with a measured 30-minute resource-lifetime soak
priority: 525.02709
status: pending
depends_on: [E6-T12l]
estimate: S
risk: high
capstone: false
---

## Boundary

Preserve the original 30-minute kmscube lifetime milestone after the functional,
performance and failure-recovery slices pass. Measure JS heap, GPU memory,
resource/program/cache residency and pending completion counts on the qualified
browser/GPU. Declare sampling, warmup and collection methodology before the run;
do not relabel unavailable GPU telemetry as a measured stability proof.

## Deterministic acceptance

`make verify-E6-T12m` records 30 continuous minutes of the actual guest kmscube
with charts and raw timestamped JS/GPU memory measurements, bounded cache and
resource counts, continued fence/presentation progress and zero unexpected
errors. Sustained monotonic growth after the declared warmup refutes the claim.
Release the workload and prove transient resource/pending-work reclamation.
Reproduce the relevant lifetime tests from the final clean clone; run affected
high-risk gates and relevant demo/deployment checks. An external telemetry or
runtime blocker must be named rather than weakening acceptance.

This task closes the replacement chain only when the original milestones remain
independently verified: live Mesa with no fallback, >=1000 valid submits, 1M
hostile-input cases, 100 ordered teardown fences, 2D regression, all 19 original
shader translations, 3-phase replay/guest gradient readback, 30 FPS demos and
reference differentials, >95% cache hits after frame 10, 10^4 blend toggles,
bounded eviction and actual WebGL context-loss survival. Carry unchanged exact
evidence forward; do not rerun unrelated proofs merely to aggregate this list.

## Adversarial verification

Inspect the raw samples and allocation/lifetime counters rather than only a
smoothed chart. Check GC/cache warmup cannot hide a persistent growth slope and
GPU resources are counted independently of JS object collection. Sabotage a
resource release and require the bounded-lifetime oracle to fail. Interrupted
or shortened runs do not establish the 30-minute claim. E6-T13 depends on this
final milestone, not on the cancelled planning containers.

## Verification log

(empty)
