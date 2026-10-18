---
id: E9-T11
epic: 9
title: Record guest-visible time and entropy observations
priority: 524.911
status: in-progress
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

### 2026-10-18 — worker — begin

E9-T11 is the first eligible task after independently verified E9-T10. Risk is high
because external clock samples and random bytes affect guest architectural state.
The slice will freeze the admitted ICount policy, intercept actual RTC observations
(including alarm polling) and entropy fills at ordered observation positions, and
prove the same workload consumes recorded values under different host providers.
Complete provider replay remains gated by T12–T14. No implementation or verification
claim is made by this activation entry.
