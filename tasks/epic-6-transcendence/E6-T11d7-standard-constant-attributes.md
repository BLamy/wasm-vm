---
id: E6-T11d7
epic: 6
title: Fetch standard zero-stride attributes through owned GPU jobs
priority: 525.0270391
status: in-progress
depends_on: [E6-T11d6]
estimate: S
risk: high
capstone: false
---

## Boundary

Extend only the explicit standard async vertex-fetch facet with Gallium constant
attributes (vertex buffer stride zero). Fetch one R32/RG32/RGB32/RGBA32_FLOAT
record at buffer offset plus element source offset from actual retained GPU
storage. Set the native generic attribute and disable its array, preserving
missing lane defaults 0,0,0,1. A constant record remains constant for every
vertex and instance, regardless of its wire divisor. Restore generic values and
array enablement on every draw/context switch. Do not use CPU backing as the
fetch oracle or evaluate guest shaders on the CPU. Legacy factories still
reject active zero stride; nonzero fetch and D6 calls/budgets retain their boundary.

Batch the bounded constant reads and optional index read under existing opaque
storage tickets. A maximum of 16 active attributes plus one index read is allowed;
prove aggregate staging bytes against the existing job limit before beginning.
All tickets retain their resource generation/content revision until final draw,
and all are validated in the same task immediately before the native draw.
If an earlier collected source changes while another read is pending, reject.
Cancel, allocation-limit failure, reset/disposal and stale state must drain or
explicitly invalidate every read and release all staging/retained ownership.
Keep zero-timeout, once-per-later-task fence polls and no synchronous finish/read
escape. Record original component words, full byte end, resource identity and
native generic values/array state in bounded deterministic draw records.

No new primitive/restart/format/shader/storage/device/API authority is granted.
The standard facet remains isolated from production negotiation and the demo.

## Deterministic acceptance

`make verify-E6-T11d7` executes the actual fixed 16 MiB compiler and headed hardware
queued draws. Independently predict original GPU input bytes, float lane defaults,
native generic values and full pixels for all four component widths, nonzero
buffer and element offsets, mixed ordinary/constant/instanced attributes,
arrays/indexed wide indices, and a draw with every active attribute disabled.
Exercise zero/large/u32-max divisors, wire count0/1 and positive instances, A/B/A
restoration after native generic/divisor/array poisoning, and at least three
bounded later-task schedules.

Prove exact-end acceptance/one-byte-short rejection, staging-budget admission
and one-byte-below rejection before native draw. Change actual GPU source content
after one read is collected but another remains pending: the final draw must
reject and every fence drain. Cancel a multi-read job; retire/reuse a public
constant-buffer name; force bounded ticket exhaustion after a first real GPU
copy. Validate cleanup and no pending reads/staging. Mutating CPU backing without
GPU upload must not change constant values. A real native generic-value mutation
must fail its named independent pixel oracle.

Carry unchanged compiler/constants/sampler/resource/cache proof. Run the affected
legacy async gate and the retained full D6 standard draw gate once at the frozen
head, then the new acceptance in one final pristine exact-head clone. Seal original
packets, inputs, physical read snapshots, generic/array queries, full pixels,
native calls/fences, source identities and coverage. A fresh critic alone may
verify. No guest/API/performance or live-deployment claim follows from this slice.

## Adversarial verification

Predict first/last byte and generic missing-lane defaults before inspection.
Invent one independently seeded bounded mix with differing component widths,
constant offsets and actual wide indices, plus an exact-end/one-byte-short
countercase. Attack an already-collected source while a different read is pending,
resource name reuse, cancellation and partial read-allocation failure. Poison
native generic values/arrays/divisors across A/B/A and sabotage the promoted
pixel oracle once. Hold every changed hunk against recording or narrow waiver;
carry unrelated HELD boundaries forward without re-litigation.

## Verification log

(empty)
