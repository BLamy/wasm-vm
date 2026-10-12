---
id: E6-T11d50
epic: 6
title: Retain the compositor's original resources within a bounded native store
priority: 525.027039000397
status: in-progress
depends_on: [E6-T11d49]
estimate: S
risk: high
capstone: false
---

## Boundary

Add one explicitly selected desktop resource store with a 64 live/retained-resource
ceiling. Preserve every other existing resource, transfer, CPU/GPU/scratch,
context, ticket, lease and dimension limit; overrides may only tighten this
selected ceiling. Every existing public store retains its 16-resource ceiling,
input admission and deterministic results. Reuse the independently qualified
packed-depth backend and all its preceding storage families; do not change
formats, transfer algorithms, shader/command admission, transport or capsets.

The original reference compositor reaches 24 live Mesa resources and glmark2
reaches 35, excluding their recorded QEMU bootstrap 2D resource. At the verified
D49 head both stop at the first native-store count overflow. This task proves
the allocation/lifetime boundary alone. Full GLES, guest Mesa/worker/scanout,
the demo/live deployment and measured throughput remain parent acceptance.

## Deterministic acceptance

`make verify-E6-T11d50` authenticates the original compositor, glmark2-es2 and
kmscube event bytes against their published manifests, replays every original
Mesa create/unref pair in order up to completion or the first unrelated refusal,
through the actual selected store on headed
M4 Metal WebGL2, and matches independent live-resource/byte counters. It records
the one exact excluded bootstrap 2D call and does not skip any Mesa refusal.
All admitted native allocations must execute with zero GL/browser errors.
The compositor and kmscube pass their complete lifetime streams. Glmark2 must
advance beyond its old count-overflow event and stop at its complete original
Z32 format17 create (event3025), with an explicit unsupported-resource refusal
before allocation; retaining this separate format boundary is part of the
claim. Old-store controls still stop at the recorded count-overflow events.

Physically upload and independently read 64 distinct GPU allocations, including
slots above 16, using actual completed native fences. Refuse allocation 65
before a backend call. Unref while opaque leases and asynchronous reads retain
allocations; those hidden allocations must still count. Release one and admit
exactly one replacement with a distinct generation, without aliasing the old
allocation. Run three recorded independently seeded lifetime schedules and
dispose/cancel with outstanding holds; every resource, ticket, backing and
byte budget must return to zero. Sabotage count enforcement and a native
allocation's actual bytes separately; each control must fail its oracle after
a valid baseline (the byte attack needs a distinct completed fence).

Exercise all selected limit/default paths: 0/1/16/63/64 tightened counts,
65/negative/nonintegral/nonfinite/sparse/accessor/unknown limits, dimensions,
resource and aggregate byte limits, opaque-token misuse, failed backend
allocation rollback and inherited 16-resource factories. Compare all historical
factory outputs to the authentic verified predecessor module, without allowing
new-selected fields to leak into old results. Record full source closure,
original events, inputs/results/native bytes, finest-range V8 diff coverage,
browser screenshot and evidence digests. Every runtime hunk must execute or
have an exact reasoned waiver.

Run syntax/diff/policy checks and affected deterministic resource/browser gates
at the frozen head, then once in a pristine scrubbed exact-head clone. Unchanged
Rust, compiler, generated Wasm, image-family and D49 renderer facts carry
forward only with exact dependency/source/evidence digests. This isolated
unimported store is not yet a demo-reachable capability and does not deploy a
new production capset or imply a guest draw.

## Adversarial verification

Before looking at results predict concrete original overflow events, exact
selected/default ceilings, all retained/reused identities and zero final
budgets. Authenticate the full recording and original capture manifests;
independently reconstruct the create/unref model and native byte oracle.
Attack a capacity override, retained hidden-resource overflow and failed host
allocation; execute three new lifetime seeds, both sabotage checks and one
bounded novel attack. Audit each runtime hunk and carry held dependencies by
digest. The verifier must be fresh and must not modify implementation code.

## Verification log

### 2026-10-12 — worker — pending; original native refusal

At verified predecessor `e1066c663b64df546f9644f1a25508b4e71db636`, run
`node evidence/virgl-production-readiness/standard-resource-capacity-gap.mjs e1066c663b64df546f9644f1a25508b4e71db636 evidence/virgl-production-readiness/standard-resource-capacity-gap.json`.
The headed M4 Metal replay refuses compositor event454 and glmark2 event463
with `Live/retained resource count limit exceeded.` at exactly16 live resources,
without another native allocation. Kmscube's complete eight resource lifetime
calls pass. Original metadata and enter/return pairs are retained; only original
QEMU bootstrap resource2/event10/flags1 is identified as the separate 2D path.
This negative record makes no guest or production claim. Native stack500 is
continued above the existing D49 branch, preserving all128 previous PRs.

### 2026-10-12 — worker — scope held after original replay

The first self-validation of the selected capacity admits the compositor's
complete56 lifetime calls (peak24). Glmark2 passes the prior count overflow,
reaches25 live resources, then explicitly refuses original event3025/resource32,
format17, 800x600 depth storage. Its full stream peak35 includes this unqualified
format. The acceptance now requires that precise visible refusal and preserves
the single count boundary; this task does not add or pretend to prove format17.
The original source events remain fully authenticated and retained. Separate
ordered format work remains necessary before glmark2/full API qualification.
