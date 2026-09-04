---
id: E5-T06c
epic: 5
title: Presentation benchmark and measured backend decision
priority: 506.3
status: in-progress
depends_on: [E5-T06a, E5-T06b]
estimate: S
risk: medium
capstone: false
---

## Goal
Measure Canvas2D and WebGL2 on the same deterministic workloads and publish a data-backed
default choice with a documented fallback order.

## Boundary
This slice owns only `web/bench/present-bench.html`, its machine-readable result schema, and
`docs/perf/present-paths.md`. It consumes the two backend contracts but does not change runtime
selection or context-loss behavior; E5-T06d owns that integration.

## Deliverables

- Full-frame and 64x64 damage workloads at 1280x800 and 2560x1600, each reporting at least 300
  frames, p50/p95 present time, and copies per frame.
- A repeatable browser harness whose JSON output is stable enough to compare runs and whose
  results identify browser, DPR, backend, workload, and sample count.
- A performance document recording the measured default, its margin for the 1280x800 damage
  workload, and the conditions under which staging/fallback is required.

## Acceptance criteria

- [ ] The benchmark emits valid machine-readable JSON for all four backend/workload combinations.
- [ ] The committed matrix includes the supported browser runs and at least 300 samples per cell.
- [ ] The default is the measured faster path for 1280x800 damage, with the margin and variance
      recorded in `docs/perf/present-paths.md`.
- [ ] Copy counts and the warm-up/sample policy are explicit, so reruns cannot hide setup cost.

## Verification command

`node tools/verify/e5-t06c-present-bench.mjs`

## Adversarial verification

Repeat with DPR=2, a backgrounded tab, and a throttled CPU. If the ranking changes, the document
must record the inversion and the runtime policy must remain honest. Reject runs with fewer than
300 samples or missing backend/workload/browser fields.

## Verification log

(empty)
