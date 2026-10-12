---
id: E6-T11d50
epic: 6
title: Retain the compositor's original resources within a bounded native store
priority: 525.027039000397
status: implemented
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

### 2026-10-12 — worker — implemented; frozen recording submitted

Runtime/harness head: `64bf6ed58a27a52a20e1548166e12d09dd719031`.
Final commands, all expected statuses satisfied:

```sh
VIRGL_RESOURCE_CAPACITY_EVIDENCE_DIR=target/evidence/virgl-resource-capacity-final/hot-2 make verify-E6-T11d50
python3 tools/virgl-resource-capacity/cold.py --output target/evidence/virgl-resource-capacity-final/cold
python3 tools/virgl-resource-capacity/seal.py target/evidence/virgl-resource-capacity-final/hot-2 target/evidence/virgl-resource-capacity-final/cold evidence/virgl-resource-capacity/worker
```

Selected native replay passes the compositor's complete56 and kmscube's eight
Mesa lifetime calls. Glmark2 advances beyond old event463, reaches25 live
resources, and explicitly refuses original format17/event3025 before allocating.
Selected/old controls contain156 original calls; independent original-event
counts/byte models agree throughout. All15 historical native factories match
the authentic predecessor, including16/17 ceilings. There are33 limit/budget/
host-failure cases, three lifetime seeds `0x501bc239/0x98ef03a7/0xdd31658b`,
81,408 independently compared native GPU bytes and15 completed fence citations.
Sixty-four buffers still count after unref while leases/reads retain storage;
final release admits one distinct-generation replacement, and disposal/cancel
returns every budget to zero. Count sabotage physically allocates65 and fails.
Byte sabotage follows a clean64-buffer baseline and a distinct completed fence;
the independent oracle catches resource1032/byte17. Browser/GL errors are zero,
headed Chrome155 uses native M4 Metal, and inherited E6-T12b decoder/transfers
and both original-input fault controls pass. Its browser server required one
already-qualified UN16/UN24 endpoint; that harness repair is in the frozen head.

Finest V8 covers all nine changed runtime lines with five exact non-runtime
comment/whitespace/delimiter waivers and zero uncovered operands. The pristine
clone `/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasm-vm-resource-capacity-cold-4zv577h6/wasm-vm`
starts/ends clean at the same frozen head and passes the same gates/controls.
Rust/web/compiler/guest boundaries are unchanged;290 carried shader/decoder/
state source hashes, generated Wasm/MJS identities and D49 indexes remain held.
This unimported host factory grants no new demo capability or production capset
and skips dist/deployment. A fresh critic must judge the worker's claim.

The worker seal under `evidence/virgl-resource-capacity/worker/` completely
reopens642 logical bodies. SHA256 identities:

- manifest `59cea015984012bb2bbd8c8ac469e509ae272c5ca10814dbf80af669566dbdd7`
- index `4a948c805eaf6d5c165a88694e81d575a630069d49292098274de625e4f1c4c8`
- archive (2,620,778 bytes) `7abb50b55a92b45ceec07aa52a95f0a024c94837dc0a44773465e3d4d3999420`
- hot receipt `f2ceeba4ee501604914fd07fc58fa987ad8a7a85b42b280b8c949afee72ba54c`
- cold report `d338595e16870b8821da10e31ab57265603380f5e235e5176de660dcd507165f`
- cold receipt `6c62e09123dd6721772db5091a025afb9ebc54125fd7a37bf5f8f4a132dc8ffc`

Claim: the selected bounded store closes the original compositor's live-count
gap within existing storage and byte ceilings, including hidden holds and real
GPU bytes; old factories remain unchanged. Full GLES/capsets, actual guest
Mesa/compositor, transport/worker/scanout/demo/deployment and300MIPS remain
unproven parent acceptance.
