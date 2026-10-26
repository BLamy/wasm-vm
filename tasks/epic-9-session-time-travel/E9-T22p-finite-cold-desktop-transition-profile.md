---
id: E9-T22p
epic: 9
title: Qualify a finite supported cold-desktop transition allowance
priority: 524.9220299
status: pending
depends_on: [E9-T22o]
estimate: S
risk: medium
capstone: false
---

## Goal

Admit a finite original-cold qualification window informed by E9-T22o's
measured first-frame frontier, without changing the frozen workloads.

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
