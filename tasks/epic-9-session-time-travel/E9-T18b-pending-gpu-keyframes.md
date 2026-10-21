---
id: E9-T18b
epic: 9
title: Restore genuine guest-pending GPU results across coherent keyframes
priority: 524.9182
status: pending
depends_on: [E9-T18a]
estimate: S
risk: high
capstone: false
---

## Goal

Retain real pending GPU guest work and its exact result frontier across restore.

## Boundary

The native pending-result/keyframe codec and ownership mapping. Persist the
descriptor chain, accepted control/resource/backing state, queue generation,
exchange/result cursor and owned ready completion. Physical GPU work may be
quiescent while a real guest fence remains pending; this distinction must be
explicit. No raw physical handles or fake drained-queue pending claim is allowed.

## Acceptance criteria

- [ ] Capture with an actual uncompleted guest fence, restore CPU/RAM/device/disk
  plus the owned GPU result frontier, and publish the exact bytes/ring/fence
  response once in the original order; no command or host side effect is reissued.
- [ ] Authenticate the logical-to-fresh-physical ownership mapping and revoke old
  callback leases even when numeric tags are reused. Guest-state witnesses retain
  all architectural GPU state; normalization of host tags is explicit and narrow.
- [ ] Corrupt/truncated/crosswired pending payloads, descriptor ranges, queue or
  context generations and unavailable physical work are refused before mutation.
  Existing quiescent T17 checkpoint semantics and clock identity remain intact.

## Deterministic acceptance

`make verify-E9-T18b`. Implement a deterministic pending-keyframe command with
original/restored guest traces and digests plus the high-risk submission required
by AGENTS.md. No passing command is claimed yet.

## Adversarial verification

Capture on both sides of scatter and guest fence publication; reorder callbacks,
seek twice to reuse numeric tags and inject an authentic old completion. Crosswire
descriptor/queue/result ownership, corrupt one saved result and require clean
refusal with the incumbent unchanged. Sabotage the new lease or pending codec
check once. Demonstrate a real pending guest effect, not an empty/drained queue.

## Verification log

(pending; no implementation or verification claim)
