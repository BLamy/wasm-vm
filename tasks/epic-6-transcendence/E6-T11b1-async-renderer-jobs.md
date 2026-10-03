---
id: E6-T11b1
epic: 6
title: Execute renderer jobs with staged GPU readback and explicit DMA handshakes
priority: 525.026971
status: implemented
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


### 2026-10-03 — worker submission (independent verdict pending)

Frozen runtime and harness: `5dc0c408b105b432b9558b8dbaa7928998378123`,
compared with activation `5ec8846b`. This change introduces the explicit
`createVirglAsyncRenderer` entry point, staged backend/resource access and a
single bounded job/exchange lifecycle. Existing synchronous factories retain
their behavior. The asynchronous factory has no synchronous submission method.

The recording replays all eight unchanged captured submissions (210 commands),
three actual hardware draws and the original readbacks. It checks 768 literal
interior pixels, independently supplied fresh input rows, exact output rows and
attach-time resource/backing identities. Its 479,438 assertions include 93
rejection/failure cases: bounded command and byte budgets, ownership across
suspension, actual index-content mutation, delayed readiness, poisoned GL state,
context/backing reuse, cancellation, allocation/wait failures and both disposal
orders. Output-reference poisoning changes 12,288 reference bytes without changing
actual frame hashes. All three deterministic readiness schedules preserve pixels.

The original hardware trace has 22 host turns, 11 fences, three actual index
staging copies, three PBO texture reads and six collections after observed fence
signals; the independent heartbeat advances 24 times. Counts of polls/turns and
wall time are diagnostics, not a throughput budget. Final state/resource byte
budgets, asynchronous accesses, GL objects and syncs are zero. Browser errors are
zero. Source omissions of required waiting and correct index buffer class each
fail at their intended sequencing assertion, with mutated served-source hashes,
coverage and failure captures retained.

Exact final commands (both exited zero):

```sh
EMCC=/tmp/wasm-vm-emsdk/wasm-vm-emcc VIRGL_ASYNC_EVIDENCE_DIR=evidence/virgl-async/worker make verify-E6-T11b1
python3 tools/virgl-command/async-cold.py --output evidence/virgl-async/cold-clone
```

The gate includes JS/Python/shell validation, the pinned shader build (70 source
hashes), Node decoder/resource tests and the affected synchronous hardware
resource/state/draw regressions. Worker receipt:
`evidence/virgl-async/worker/receipt.json`, SHA-256
`a2da723555c9de7ad5efcf96721095d9a2c3159b3c5626c0ebd6c32c73e9f049`.
Hardware report SHA:
`dfa18d598e359395bd2658dbbc0cadc372302b00847231ed246931ea4ad24ba6`;
visually inspected `worker/hardware/browser.png` SHA:
`063554c73a0225d42278885e7212a41d81070ab61ee0b17b003bd6badc940ca2`.

The pristine clone at
`/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasm-vm-virgl-async-cold-3bk36tdn/wasm-vm`
remained clean before and after the same gate at the frozen head. Environment
build overrides were scrubbed. `cold-clone/report.json` SHA:
`73ed25d376d872aaf245f3418936fb96ac3a7c8430517453058fae7151096468`;
cold receipt SHA:
`d45407818f2514ee7d8e5c3fc15202bef13377d8ad285ec182d0e67b6f4cffcb`;
cold log SHA:
`a304d78efbf4c28e18adbd41e80994e975cb06fd5b91b324fedb1b1779a439f3`.

Two development corrections are disclosed. Cancelling an empty/END-only job's
initial final fence formerly confused serial zero with observed completion;
completion now starts at -1 and cannot reuse an outstanding sync. Raw WebGL
reproductions exposed deferred Chrome 154/ANGLE errors for element-buffer staging
with READ usage hints. Buffer-copy staging uses DYNAMIC_COPY, preserving the
same actual copy/fence/read path and strict GL error checks. The raw diagnosis in
`evidence/virgl-async/development/` is separate from final acceptance evidence.

This proves asynchronous renderer jobs and owned simulated-RAM handshakes.
Physical guest DMA and virtqueue completion remain E6-T11b2. Production negotiation,
scanout, live Mesa and FPS/MIPS are not claimed. No default web/Wasm artifact is
changed by this renderer-only layer; the prior production 127/127 proof and
ordinary no-VIRGL gating remain unchanged.
