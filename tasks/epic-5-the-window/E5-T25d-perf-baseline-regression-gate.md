---
id: E5-T25d
epic: 5
title: Publish desktop performance baselines and the regression gate
priority: 525.4
status: pending
depends_on: [E5-T25b, E5-T25c]
estimate: S
risk: medium
capstone: false
---

## Goal

Turn the independently measured drag and input-latency records into the durable
desktop performance contract. Publish honest current-reality numbers when targets are
missed, identify the top guest/transfer/present cost, and add a smoke gate that can
actually reject a severe present regression.

## Boundary

Own only baseline selection, `docs/perf/desktop.md`, `tools/perf_gate.py`, the smoke
fixture, and the final T25 browser manifest entry. Do not retune the emulator or
silently discard T25b/T25c samples.

## Deliverables

- `docs/perf/desktop.md` with exact commit/config, browser/DPR/refresh details,
  drag FPS and latency p50/p95, full latency histogram, error sources, and
  guest/transfer/present attribution.
- `tools/perf_gate.py` comparing a run with documented noise margins.
- A CI-free local smoke target that passes on the baseline and fails with an
  artificial 10x present throttle.
- A verified roadmap/task-manifest entry tied to the retained JSON and screenshots.

## Acceptance criteria

- [ ] The report records five-run repeatability, the ≥15 FPS / ≤150 ms targets or an
      explicit measured gap, and the exact configuration used by the capstone.
- [ ] The report includes the complete latency histogram and names the current top
      cost from guest execution, transfer, or present.
- [ ] `tools/perf_gate.py` passes the normal retained run and fails the 10x-throttle
      sabotage with a nonzero exit status.
- [ ] `make verify-E5-T25d` reruns the gate and the built demo with zero browser/HTTP
      errors; release artifacts contain no test-only injection path.

## Verification command

make verify-E5-T25d

## Adversarial verification

Re-run the gate at DPR 2, under a busy guest, and with 4x CPU throttle. Check that
the report identifies the configuration rather than silently substituting the fastest
run. Perturb one bucket by 2x and confirm attribution changes; inject a bimodal
latency sample and confirm p95/histogram cannot hide it. Audit the final diff so the
baseline cannot be made green by weakening the gate threshold.

## Verification log

(empty)
