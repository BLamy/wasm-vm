---
id: E5-T25b
epic: 5
title: Measure repeatable real-window drag FPS and bottleneck counters
priority: 525.2
status: pending
depends_on: [E5-T25a]
estimate: S
risk: medium
capstone: false
---

## Goal

Build the headed Playwright scenario that drags a real Foot window across the T18
desktop and measures drawn presents over wall time. The result must expose the guest
execution, upload, and present buckets needed by the later baseline instead of
reporting a browser-only animation rate.

## Boundary

Own the deterministic 300-step pointer script, warm-up policy, five-run aggregation,
and machine-readable drag result. Do not implement input hooks or latency-to-photon
measurement; consume T25a's frozen boundary only.

## Deliverables

- `web/bench/desktop-perf.ts` drag scenario and JSON output with FPS p50/p95,
  bytes/frame, instructions/frame, and guest/transfer/present durations.
- A headed pinned-browser runner that records the exact viewport, DPR, browser,
  image, and commit.
- Five retained runs with coefficient of variation and a deterministic null-sink
  attack result.

## Acceptance criteria

- [ ] Five unattended drag runs each complete 300 smooth moves and report CV < 15%
      under the named dev-machine configuration.
- [ ] The real drawn-present counter, not requestAnimationFrame callbacks alone,
      determines FPS; the result includes nonzero attribution counters.
- [ ] The null-sink attack materially craters or rejects the drawn-FPS result and
      cannot pass by counting acknowledged-but-undrawn presents.
- [ ] The result is reproducible from `make verify-E5-T25b` with no inherited
      `RUSTFLAGS`, `CARGO_*`, or logging environment.

## Verification command

make verify-E5-T25b

## Adversarial verification

Run with the null sink, a busy guest, 4x CPU throttle, and DPR 2. Compare the full
present and attribution records, not just the summary FPS, and document which values
are baseline configuration versus stress observations. A window that does not move,
or a run that draws no damage, must fail rather than produce a plausible number.

## Verification log

(empty)
