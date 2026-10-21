---
id: E9-T18c
epic: 9
title: Replay durable GPU session results through the real browser bridge
priority: 524.9183
status: in-progress
depends_on: [E9-T18b, E9-T17, E9-T09, E9-T14]
estimate: S
risk: high
capstone: false
---

## Goal

Complete E9-T18's graphics nondeterminism adapter in the admitted Wasm profile.

## Boundary

Connect the accepted native result/pending boundary to the real production GPU
transport, durable session tape and replay controller. Preserve exact guest
results separately from physical rendering witnesses. Full desktop performance
and final product integration remain required by E9-T22/E9-T24.

## Acceptance criteria

- [ ] Record every admitted guest-visible result, shared-memory write and
  query/error/fence completion in bounded durable history. Reopen and replay exact
  bytes/order, including genuine pending work across a keyframe, using the
  existing version/identity and committed-prefix rules.
- [ ] An actual RV64 GPU workload through the production Wasm/physical GPU bridge
  produces matching replay CPU/RAM/device/disk/result witnesses and documented
  physical scanout. Vary live GPU results/timing during replay; no physical
  cross-GPU bit-identical pixel claim or software/canned-frame substitution.
- [ ] Missing/corrupt results, unsupported host/build/clock profiles, context loss
  and authentic stale replies after seek resolve explicitly without live result
  substitution, stranded fences, corruption of the original or replay egress.
  T17 paced-on-keyboard sessions remain checkpoints-only unless their exact clock
  policy is admitted; do not rewrite authenticated configuration or the T01
  unsupported-clock/performance contract.

## Deterministic acceptance

`make verify-E9-T18c` (and final aggregate `make verify-E9-T18`). Implement the
bounded real hardware-browser acceptance, retained raw results/keyframes,
trace/screenshots and final pristine-clone proof plus the high-risk submission
required by AGENTS.md. No passing command is claimed yet.

## Adversarial verification

Independently change upload/draw/readback completion schedules and host results,
corrupt a recorded readback, remove a required payload and seek while an old GPU
reply is pending. Inspect actual guest state/physical witnesses and original
history. Fail on silent live substitution, a stale owner changing new state,
stranded control or a falsely enabled replay profile. Sabotage one new bridge
generation/result check. All original E9-T18 criteria remain required here or in
its verified a/b predecessors.

## Verification log

### 2026-10-21 — worker — start the production GPU replay adapter

Selected from Next up after T18b was independently verified (`17d45b8d6`) and
published to the main URL as `c50b963d`; production receipt is `5ddba9c2d`.
Risk remains high. This slice connects the accepted native result/frontier
boundary to the admitted Wasm profile, durable session data and physical browser
bridge. T17 paced keyboard histories retain their authenticated checkpoint-only
policy. No browser GPU replay, performance or completion claim is made yet.
