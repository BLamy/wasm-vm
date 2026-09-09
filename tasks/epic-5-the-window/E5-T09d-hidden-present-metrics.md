---
id: E5-T09d
epic: 5
title: Hidden-tab presentation fallback and metrics surface
priority: 509.4
status: verified
depends_on: [E5-T09c]
estimate: S
risk: medium
capstone: false
---

## Goal

Keep guest output and serial progress alive when the document is hidden by switching the presentation
drain from rAF to a bounded 250 ms timer, and expose the scheduler/tile counters to the page.

## Boundary

This slice owns visibility detection, timer fallback, counter snapshots, and the page-facing
`vm.stats.gpu` shape. It does not own the final scroll/cursor proof or performance appendix.

## Deliverables

- A visibility-aware drain that uses rAF when visible and one bounded timer when hidden.
- Resume logic that returns to rAF without duplicate chains and presents a pending cursor update.
- A serializable metrics snapshot covering presents, coalescing, uploaded bytes, skips, and overruns.

## Acceptance criteria

- With `document.hidden` forced true, a queued frame is presented within the 250 ms fallback period,
  serial output continues, and the guest is never blocked on a display callback.
- Visibility transitions while a timer/rAF callback is pending leave exactly one scheduler chain and
  deliver the latest pending frame after resume.
- The page and T25 harness can read `vm.stats.gpu` with stable numeric fields and no host object or
  canvas references.

## Verification command

`node tools/verify/e5-t09d-hidden-present.mjs`

## Adversarial verification

Alternate forced hidden/visible state on every callback for 1,000 cycles, inject a delayed timer,
and assert bounded pending work, monotonic counters, and a presented final cursor frame.

## Verification log

### 2026-09-04 — verifier — VERDICT: verified

- P1 hidden drain — HELD. Predicted that a hidden queued frame would remain bounded to one pending
  plan, drain through one 250 ms timer, and let producer/serial work continue; the recorded test
  passed with the hidden timer path and continued producer progress.
- P2 visibility transition — HELD. Predicted that a visibility flip with a stale timer or rAF callback
  pending would invalidate the old chain, schedule exactly one chain in the new mode, and deliver the
  latest plan; the recorded transition test passed.
- P3 adversarial lifecycle — HELD. Predicted that 1,000 alternating hidden/visible callbacks with a
  delayed timer injection would keep pending work bounded, counters monotonic, and the final cursor
  delivered; the recorded adversarial test passed.
- P4 metrics surface — HELD. Predicted that `vm.stats.gpu` would expose fresh JSON-safe numeric fields
  for presents, coalescing, uploaded bytes, skips, overruns, pending work, and dimensions without
  canvas or backend references; the recorded controller test passed.
- P5 coverage — HELD. The exact final implementation head was
  `47ef46df0c7d55eeff0365006f2e505e0504e458`; `node tools/verify/e5-t09d-hidden-present.mjs`
  ran the four-test suite with 4 passed and 0 failed. Evidence is
  `evidence/e5-t09d/hidden-present.json`, SHA-256
  `dfae15366423484f869b58cfdd028b12f261f9e53a284dc6ce70dde89e029c1f`.

The user explicitly waived independent-machine and WebKit coverage; host rr is also waived by the
repository evidence policy. The remaining end-to-end cursor/scroll and performance appendix are the
scope of E5-T09e.
