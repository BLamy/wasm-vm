---
id: E5-T09d
epic: 5
title: Hidden-tab presentation fallback and metrics surface
priority: 509.4
status: pending
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

(empty)
