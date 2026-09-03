---
id: E4-T28c
epic: 4
title: Browser CoreMark uplift and guest/host clock honesty
priority: 429.3
status: verified
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

### 2026-09-03 — verifier — VERDICT: verified (user-directed debt closure)

Implementation commit: `b4de2bf9021185750c164c4103707d7eecb54c3c`.

The exact-head Chromium interpreter control passed in `8.9m` with a fresh persistent profile,
the pinned CoreMark ELF uploaded through the guest file-transfer path, zero request/console errors,
and the guest validation line intact. The guest reported `Iterations: 6000`, seed CRC
`0xe9f5`, `Total time (secs): 22.106`, and `Iterations/Sec: 271.419524`. The host elapsed
`466471.345ms` against `22106ms` guest time, a host/guest ratio of `21.1015717452x`, so the
two-percent clock gate is not satisfied.

Evidence: `evidence/e4-t28c/coremark-browser-2026-09-03.json`, SHA-256
`cea325b2fc1023a800713eb83c6e02c27863f772c07e2a21780b905409cbc3de`.
Exact frozen-head control command:
`PW_DISABLE_TS_ESM=1 PLAYWRIGHT_PORT=8133 PLAYWRIGHT_REUSE_SERVER=1 E4T28C_SAMPLES=1 E4T28C_CONTROLS=interpreter npx playwright test tests/e4-t28-coremark.spec.js --project=chromium`.
The source ELF hash is `4db593b8110e588b4fba7e526d3b838365cc5ad50ae6cd1592be2dc483a08937`;
the served Node chunk manifest matched `ac6a298883c36d170534a679fd976c5681a20f1fa48ef2d587e6bc124e70b1c1`.
No immutable browser Level-3 CoreMark row exists in `bench/ledger.json`, so the required 10x
ratio is not evaluated and no misleading ledger baseline was appended.

The exact-head JIT attempt using
`PW_DISABLE_TS_ESM=1 PLAYWRIGHT_PORT=8133 PLAYWRIGHT_REUSE_SERVER=1 E4T28C_SAMPLES=1 npx playwright test tests/e4-t28-coremark.spec.js --project=chromium`
stopped the guest while the CoreMark RPC was pending after `11.6m`; no JIT score is claimed.
Per the user's explicit instruction to close the verification debt, the ticket is promoted with
the missing browser baseline, failed JIT attempt, and guest/host clock gap recorded. WebKit,
independent machines, and host-layer rr evidence are excluded by user direction.
