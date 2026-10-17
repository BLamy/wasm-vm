---
id: E9-T11
epic: 9
title: Record guest-visible time and entropy observations
priority: 524.911
status: pending
depends_on: [E9-T09]
estimate: S
risk: high
capstone: false
---

## Goal

Make host time and random inputs reproducible at their original guest positions.

## Boundary

Clock/RTC updates, lifecycle rebases, idle/timer decisions and supplied entropy, using the contract inventory. Deterministically derived values need a frozen policy; externally supplied values need recorded bytes.

## Acceptance criteria

- [ ] A workload reading time and RNG around sleeps, pause/resume and tab lifecycle changes replays identical observations.
- [ ] Replay consumes recorded values without reading the current host clock or CSPRNG for guest-visible results.
- [ ] Malformed entropy lengths, clock-policy mismatches and exhausted records stop with a typed divergence error.

## Deterministic acceptance

`make verify-E9-T11`. This is a planned target to implement with this slice, not an existing passing command. It must record the assertions above and the risk-tier evidence required by AGENTS.md.

## Adversarial verification

Replay under a different wall clock and entropy provider, including background/resume transitions. Any influence from the replay host refutes the boundary.

## Verification log

(pending; no implementation or verification claim)
