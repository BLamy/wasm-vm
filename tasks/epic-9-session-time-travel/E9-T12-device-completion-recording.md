---
id: E9-T12
epic: 9
title: Record asynchronous device payloads and completion order
priority: 524.912
status: pending
depends_on: [E9-T09]
estimate: S
risk: high
capstone: false
---

## Goal

Prevent host scheduling of I/O from changing the recorded guest execution.

## Boundary

Record external completion delivery and any guest-visible bytes/DMA writes for supported block, console/file-agent and audio-input adapters. GPU results are reserved for T18, and unrecorded adapters must refuse recording.

## Acceptance criteria

- [ ] Separate immutable base-disk payload references from nondeterministic completion delivery; identify each request and record exactly one accepted completion.
- [ ] Replay payload bytes, completion sequence and interrupt effects under deliberately different host callback schedules.
- [ ] Include pending adapter state and event cursors in checkpoints; cancellations and stale-generation replies cannot mutate a restored guest.

## Deterministic acceptance

`make verify-E9-T12`. This is a planned target to implement with this slice, not an existing passing command. It must record the assertions above and the risk-tier evidence required by AGENTS.md.

## Adversarial verification

Reorder and delay host callbacks, cancel an in-flight request at a checkpoint and inject an old completion after restore. Compare guest memory and queue/interrupt witnesses.

## Verification log

(pending; no implementation or verification claim)
