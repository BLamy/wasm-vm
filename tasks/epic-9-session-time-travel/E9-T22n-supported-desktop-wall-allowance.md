---
id: E9-T22n
epic: 9
title: Qualify a finite desktop host-wall allowance
priority: 524.92202975
status: pending
depends_on: [E9-T22m]
estimate: S
risk: medium
capstone: false
---

## Goal

Let the unchanged full Omarchy qualification reach its frozen guest-transition
bound without the host wall expiring first during durable checkpoint I/O.

## Boundary

Create a version-11 qualification profile chained to v10 that changes only the
desktop harness's host wall allowance from 8 to 16 hours. The exact C run at
`a161b0f8d6a4e7e4d19de7170fe7ad52a2f416f6` failed on that eight-hour
guard at transition 17,550,000,000 while still waiting for a first frame. The
recent 15.0B-to-15.45B segment ran at about 0.77B transitions/hour; reaching
the unchanged 20B cap at that rate takes about 12.8 hours from boot, so 16
hours is a finite allowance with host and storage headroom. This is an
execution allowance, not a performance budget or a promise that C will pass.
Keep the 20B transition cap, 50M checkpoint cadence, ICount/64 clock, original
Omarchy image and COW, 16 GiB retention, probe, workloads, replay rules, asset
pins and all original numeric performance budgets unchanged. E9-T22c owns the
next complete real-workload attempt; this task cannot pass C from a prefix.

## Acceptance criteria

- [ ] Authenticate the original eight-hour failure report and retained graph:
      17,550,000,000 transitions, 351 periodic checkpoints, 2,472 receipts,
      10,320 physical chunks, 2,822 reachable objects, no first frame and no
      other failure. Preserve the report and saved graph.
- [ ] Seal v11 to v10 by SHA-256 and prove that the only qualification change
      is the finite host-wall allowance, while the 20B guest-transition guard,
      clock/cadence, workload, source/asset pins, retention and original
      performance budgets remain unchanged.
- [ ] Prove the production desktop harness uses the declared wall allowance.
      A deterministic fake-clock boundary check must show that the old 8-hour
      point would refuse, 16 hours minus one millisecond admits and exactly 16
      hours refuses; reject a tampered profile or unbounded allowance.
- [ ] Record medium-risk affected harness/browser/build evidence at a clean
      exact head and obtain a fresh Daybreak verdict with one bounded novel
      clock-boundary attack. Do not claim full desktop qualification or timing.

## Deterministic acceptance

`make verify-E9-T22n` proves the retained exact-prefix oracle, v11/v10 policy
chain, fake-clock boundaries and affected built browser path. Run its selected
medium-risk gate once on the final frozen head. The next full acceptance is
still `make verify-E9-T22c` after this prerequisite is independently verified.

## Adversarial verification

Change the elapsed clock at the exact boundary; tamper with the predecessor
digest, wall field, transition ceiling or workload pins; omit a retained chunk;
try to pass by replaying only the incomplete prefix or by presenting a timing
claim. Check the active browser source actually consults the sealed profile.

## Verification log

(pending; no implementation or verification claim)
