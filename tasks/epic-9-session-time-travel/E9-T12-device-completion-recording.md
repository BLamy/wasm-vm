---
id: E9-T12
epic: 9
title: Record asynchronous device payloads and completion order
priority: 524.912
status: in-progress
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

## Qualified adapter contract

The core adapters are installed with Machine::enable_session_devices and the ordinary
bare-metal browser machine's installDeviceSession API before execution. The block
adapter uses a frozen immutable manifest and sector-aligned local COW state. Existing
unrecorded block/audio/console transports are rejected at installation; persistent host
writeback, live worklet playback, GPU results and the existing Linux provider assembly
are not implicitly admitted. T14 composes executable Linux replay after T13 supplies
the network boundary. The demo retains an explicitly incomplete capture prefix.

Each missing immutable base chunk, posted named-agent receive buffer and due capture
quantum creates a non-wrapping request ID. A private allocation identity revokes callback
leases on restore even when saved request IDs rewind. An accepted owned completion is
a common before-transition event (channel 19), with request intent and result distinct
from its guest position. The durable journal puts base payload bytes in their own
content-addressed object; delivery metadata references those bytes without incorporating
callback timing into the immutable identity. Replay accepts recorded envelopes at exact
positions and refuses live leases.

The frozen v1 profile bounds individual payloads to 1 MiB minus 256 bytes, pending
requests to 256, immutable cache bytes to 16 MiB and local COW sectors to 256 MiB.
Eviction follows accepted completion order and preserves chunks pinned by pending reads.
Capture uses guest ICount time and S16 mono/stereo at 48 kHz; unavailable or short
quantums retain their real status/XRUN behavior. An awaiting owned capture result leaves
DMA, status and the used ring untouched. Active playback refuses this profile.

Native section 20 preserves pending requests, complete cache/COW state, request/event
cursors, capture result state and parked block descriptors. The qualified sound codec
preserves capture descriptors and deadlines; ordinary legacy audio snapshots keep their
existing host-ring repair policy. Restore validates the whole envelope before mutation
and replaces the callback incarnation only after a successful commit.

## Deterministic acceptance

`make verify-E9-T12`. This is a planned target to implement with this slice, not an existing passing command. It must record the assertions above and the risk-tier evidence required by AGENTS.md.

## Adversarial verification

Reorder and delay host callbacks, cancel an in-flight request at a checkpoint and inject an old completion after restore. Compare guest memory and queue/interrupt witnesses.

## Verification log

### 2026-10-18 — worker — begin

E9-T12 is the top eligible queue task after independently verified and published
E9-T11. Risk is high: completion ordering, guest DMA/interrupts and persisted pending
requests cross architectural and asynchronous state boundaries. The slice will bind
accepted completions to exact guest positions and request identities, keep immutable
base payload references separate, and restore pending state/cursors while revoking
stale callback generations. Supported block, console/file-agent and audio-input
adapters must record their actual results; unsupported adapters remain gated. GPU
results stay in T18. The final command will exercise delayed/reordered callbacks,
cancellation and restore with guest memory/ring/IRQ witnesses. No implementation
or verification claim is made by this activation entry.

### 2026-10-18 — worker — respond to fresh checkpoint refutation

The fresh critic reproduced an accepted malformed checkpoint at runtime 76b56b01:
erasing capture_pending while retaining capture request 4 revoked live leases and
issued duplicate request 5 at the next transition. Its independently rechecked point
is /Volumes/e9-t11-cold-scratch/e9-t12-verifier/recheck.log:6–8, mutant SHA-256
bb64f5b8a82261207e0cae4a36acfebce483c9a357f64f14ec5d627f1064473b.
The task remains in-progress. The initial cold/browser recordings and successful
publication 48988385 remain historical evidence; no verified claim is made for them.

The worker repair validates reciprocal ownership between the broker pending map,
capture owner/result and actual due sound descriptor before any restore commit or
lease revocation. A missing owner cannot leave a pending capture behind, and removing
both owner and request cannot erase the obligation of a real due descriptor. Future
and stopped capture descriptors retain their proper scheduling behavior. The original
regression fails before the fix; all eight then-existing adapter tests and the new
future-descriptor round trip pass afterward. Exact red/green logs and raw frames are
retained losslessly in evidence/e9-t12/repair-precheck/receipt.json. These are worker
prechecks. The frozen repaired head must earn a new high-risk submission and fresh
critic verdict before this task can become verified.
