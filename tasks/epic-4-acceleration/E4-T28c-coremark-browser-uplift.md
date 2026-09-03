---
id: E4-T28c
epic: 4
title: Browser CoreMark uplift and guest/host clock honesty
priority: 429.3
status: pending
depends_on: [E4-T28a, E4-T04, E4-T05, E4-T27]
estimate: S
risk: high
capstone: false
---

## Goal

Measure the shipping browser CoreMark workload from a cold profile and establish the Level-4
headline ratio against the exact ledgered `level3-interpreter` denominator, with an independent
host-wall-clock cross-check so guest time cannot inflate the score.

## Context

The parent threshold is a ratio, not an absolute score. Earlier work records native and component
baselines, while the capstone specifically requires the browser default configuration. This slice
owns the benchmark input, checksum, JIT controls, timing conversion, and ledger append; tuning or
other capstone workloads stay in their own slices.

## Deliverables

- `web/tests/e4-t28-coremark.spec.js` or an equivalent documented browser runner using the real
  CoreMark guest binary and its validation checksum.
- A `capstone: level4` ledger entry and evidence JSON with candidate/baseline commits, cold-profile
  controls, guest elapsed time, host elapsed time, score, ratio, and artifact hashes.

## Acceptance criteria

- `PW_DISABLE_TS_ESM=1 PLAYWRIGHT_PORT=8133 PLAYWRIGHT_REUSE_SERVER=1 npx playwright test tests/e4-t28-coremark.spec.js --project=chromium`
  passes in the default cold browser profile with CoreMark validation intact and a score at least
  10x the ledgered Level-3 browser interpreter baseline.
- Guest-reported elapsed time and host wall time differ by no more than 2% after fetch/boot overhead
  is excluded by the documented measurement boundary; the result carries the exact arithmetic for
  the ratio and the immutable baseline reference.
- Repeating the measurement with JIT disabled produces a separately labeled interpreter control;
  no result is accepted from a guessed iteration count, stale ledger row, or warmed translation
  cache.

## Adversarial verification

Recompute the denominator from its recorded commit and binary hash, mutate the guest checksum, and
replace the timer with a deliberately slow/fast clock in the harness. Run three cold contexts and
report the median, not the best, while checking host and guest clocks. Poison any JIT cache or
artifact and confirm the run fails closed. A score without a guest validation line, source commit,
or baseline identity is evidence-incomplete.

## Verification log
