---
id: E9-T22p
epic: 9
title: Qualify a finite supported cold-desktop transition allowance
priority: 524.9220299
status: cancelled
depends_on: [E9-T22o, E9-T22s, E9-T22t, E9-T22u]
estimate: S
risk: medium
capstone: false
---

## User scope amendment — 2026-10-28

The user explicitly requested: “can we please just skip the cold boot and replay you have been working on that one ticket for days”.

The finite original-cold supported-profile amendment is deferred with the waived cold boot. No first-frame measurement or Chrome 156 supported-profile claim follows. Status `cancelled` records removed scope, not a successful
verification verdict. The original criteria and all prior failures remain below
for audit. Do not restart this long boot/replay campaign without a new user
request. Continue E9-T23 recovery and E9-T24 bounded user-flow integration;
functional seeking/replay tests remain required for those product behaviors.

## Goal

Admit a finite original-cold qualification window informed by E9-T22o's
measured first-frame frontier, without changing the frozen workloads.

E9-T22o ended at an exact no-frame failure frontier. E9-T22s must attribute
the original guest's first disk I/O rejection before a later exact run can
measure the first frame; this task cannot substitute a guessed allowance.
E9-T22t must correct the attributed bounded session-block transfer rejection
before that later run. E9-T22u records the corrected cold prefix from zero;
its measured frame or exact next obstruction is required before this allowance
can be set. The host's Chrome 155-to-156 auto-update is diagnostic environment
drift; the supported browser identity must be reconciled explicitly before
E9-T22c, rather than silently folded into this numeric allowance.

## Boundary

One explicit supported-profile amendment chained to the accepted v11 desktop
profile. The guest-transition, host-wall and retained-capacity allowances may
change only where the calibration and measured capacity require them. Retain
the old reference, failed C report and exact source/asset receipts. Do not
change the original image, ICount/64 clock, 50M checkpoint cadence, guest
service files, probe, replay policy or numeric performance budgets.

## Acceptance criteria

- [ ] Declare finite numeric bounds with arithmetic from the calibrated frame
  position, expected full workload tail, host elapsed rate and physical history
  growth; check actual browser quota and host free-space feasibility.
- [ ] Reject unamended/over-bound inputs and prove the declared boundary in
  deterministic tests and one built-browser proof. Keep the prior v11 profile
  immutable and the full original-cold run reserved for E9-T22c.
- [ ] Fresh Daybreak verification checks the chain, negative boundary cases,
  browser proof and unchanged frozen workload/asset receipts.

## Deterministic acceptance

`make verify-E9-T22p` on a clean exact head.

## Adversarial verification

Try to smuggle a changed image, clock, cadence, renderer, COW service profile,
workload, probe or numeric performance budget through the new version. Test
fractional wall clocks, exact boundary transitions, low quota and low disk
headroom. Refuse a generous cap without measured resource headroom.

## Verification log
