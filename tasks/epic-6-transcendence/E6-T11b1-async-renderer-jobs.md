---
id: E6-T11b1
epic: 6
title: Execute renderer jobs with staged GPU readback and explicit DMA handshakes
priority: 525.026971
status: in-progress
depends_on: [E6-T11a]
estimate: S
risk: high
capstone: false
---

## Boundary

Replace the renderer-side half of E6-T11b with one bounded asynchronous job
lifecycle. Add an explicit asynchronous renderer entry point while preserving
the verified synchronous resource/state/draw APIs. Decode the entire raw
submission before mutation, preserve whole-submission quotas and applied-prefix
errors, and execute the same actual WebGL drawing and transfer semantics.

An owned, opaque job yields for fresh upload bytes, GPU readiness, or readback
scatter acknowledgement. Upload input is owned dense rows supplied when the
transfer executes, never the stale bytes copied at resource attachment. Readback
output is actual GPU data with precise destination row layout and resource and
backing generations; wait for acknowledgement before continuing. One active
renderer job and one outstanding input/output exchange are sufficient. Bound
command storage, CPU scratch, GPU staging and output ownership. Reject stale,
foreign, duplicate and overlapping operations explicitly.

Texture readback must enqueue readPixels into a PIXEL_PACK_BUFFER before fencing.
Buffer/index reads use private staging with matching WebGL buffer classes. Poll
with clientWaitSync(sync, 0, 0) from later browser tasks and collect bytes only
after a real signal; do not call finish, positive-timeout waits, or a synchronous
readback fallback on this path. Final success requires a completion fence, not
merely issued commands. Step work has a deterministic command budget so a long
submission yields even when it contains no readbacks.

Revalidate context/subcontext/resource/backing identities after yielding. Public
store uploads cannot replace index contents between staged validation and draw:
enforce ownership or check a content revision immediately before drawing.
Cancellation, context destruction, disposal and context loss release owned
staging buffers, sync objects and leases. Failed jobs retain explicit successful
prefix diagnostics; there is no rollback claim.

This slice does not implement virtqueue ownership, guest RAM access, fence-ID
responses, scanout or production 3D negotiation. Those remain ordered successors.

## Deterministic acceptance

`make verify-E6-T11b1` runs affected JavaScript checks, the existing synchronous
resource/state/draw regression paths and a recorded headed hardware-WebGL2 job
harness. Replay all eight original tiny-scene submissions (210 commands, three
actual draws and readbacks), verify the 768 independent literal interior pixels,
and record source hashes, GPU command/fence/copy counters, result bytes and a
browser capture with zero console errors. Output snapshots from the reference
capture must never initialize backing or define the literal pixel oracle.

Instrument the actual GL calls to prove PBO texture reads and correctly typed
index staging occur before their fences, no CPU collection occurs before a
signal, every wait has zero timeout, and a browser heartbeat progresses while
work is pending. Exercise explicit fresh input, exact padded rows, input/output
ownership and acknowledgement, job/byte budgets, cancellation and cleanup with
varied deterministic schedules. Record a final pristine-clone run at the frozen
runtime head. The ordinary demo continues to advertise no production VIRGL.

## Adversarial verification

Mutate source arrays after submission/input handoff. Delay or fail readiness;
reject malformed tails before applying any command. Destroy/reuse contexts,
resources, membership and backing while paused, including mutation of the live
index allocation after its staging copy. Reject stale tokens and duplicate
input/output acknowledgements without advancing another job. Poison reference
output snapshots and preserve the independent pixels. Check exact row padding
and final allocation accounting. Introduce a bounded omission of required GPU
waiting and require the sequencing oracle to fail. The fresh reviewer adds one
bounded independent correctness case and records changed-hunk coverage.

## Verification log

### 2026-10-03 — worker activation

Dependency E6-T11a is verified at `26834baa`. Implement one asynchronous
renderer job boundary on `codex/virgl-async-renderer-jobs`; production device
negotiation and guest DMA remain in their dependent tasks.

