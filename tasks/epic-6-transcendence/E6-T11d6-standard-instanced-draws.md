---
id: E6-T11d6
epic: 6
title: Execute standard instanced and wide-index vertex draws
priority: 525.027039
status: in-progress
depends_on: [E6-T11d5]
estimate: S
risk: high
capstone: false
---

## Boundary

Extend only the explicit standard command/async renderer facet's existing vertex
fetch boundary. Admit positive instance counts with per-element u32 divisors,
u8/u16/u32 index bindings, and issue the native instanced or ordinary calls that
preserve pinned VirGL1.3's wire convention (instanceCount=0 still executes
one ordinary instance). Counts zero/one use equivalent ordinary native calls;
counts above one use native instanced calls. Preserve old factory grammar and behavior. No provenance, compiler
metadata or caller option selects the facet. Triangle/strip mode, zero base
vertex/base instance, nonempty counts and no restart stay the current boundary;
constant stride, other core topologies and restart lowering are ordered gaps.

Derive per-vertex fetches from actual owned index bytes and per-instance fetches
from floor((effectiveInstanceCount-1)/divisor). Never use wire min/max hints as
bounds. Prove offsets, component width, byte end, signed GL call dimensions,
actual MAX_ELEMENT_INDEX and total vertex-instance work before issuing a draw.
Index staging bytes are count*indexSize, with subtraction/division bounds before
arithmetic. Keep the existing per-submission budget by charging count times the
effective instance count, including cumulative draws. The existing later-task storage read retains and validates the same
resource generation/content revision through native draw; reset/cancellation
must drain and release it. Reject fixed restart sentinel explicitly until the
ordered restart slice exists, since WebGL2 always enables restart.

Restore every native divisor on each draw and context switch; include divisor,
instance/index width and native fetch ranges in deterministic draw recording.
Use native gl_InstanceID and gl_VertexID without CPU shader evaluation. This
slice does not grant positive caps or connect production device paths.

## Deterministic acceptance

`make verify-E6-T11d6` records independent literal packet/fetch predictions and
actual fixed-memory compiler plus hardware queued draws. Cover ordinary and
instanced arrays/indexed calls, sizes1/2/4, nonzero bound offsets, divisors0/1/2/
large/u32-max and active attribute15. Use independent seeded geometry and
native instance/vertex IDs to predict disjoint per-instance tiles and exact
flat colors before inspecting full pixels. Exercise effective count0 wire
convention, partial last divisor groups, A/B/A restoration after native state
poisoning, retained resource name reuse, later-task schedules and cancellation.

Prove both triangle and strip calls, an actually fetched u32 index above 65535,
and exact total-work-budget admission followed by one-above rejection.

A too-short per-instance buffer, final actual vertex fetch, partial index extent,
index-size alignment, host max-element-index and total draw work must fail
before native draw. False min/max hints must neither accept an out-of-bounds
fetch nor reject a valid actual fetch. Malformed tail rejects whole snapshot.
A real native divisor/fetch corruption must fail its named pixel oracle.

Carry unchanged D5 compiler/constants/samplers/ownership proofs. Run the directly
affected old decoder/draw/async/float paths once and the new gate at frozen head;
record one pristine exact-head clone, seal original packet/index/vertex bytes,
GPU calls, native bindings, pixels, sources/coverage and fences, then submit to a
fresh adversarial critic. This isolated factory is not demo reachable yet.

## Adversarial verification

Predict actual per-vertex/per-instance byte ends and native divisor/ID pixels
before inspection. Invent one bounded independently seeded mix of differing
attribute divisors and wide indices, and one exact-end/one-byte-short countercase.
Attack forged wire range hints, large multiplication, stale index revision,
resource generations, divisor restoration and cancellation while GPU index
read is pending. Distinguish real native observations from proxy assumptions;
sabotage the promoted pixel oracle once. Hold each changed hunk against recorded
execution or a narrow waiver. Do not add full API/guest boot/performance criteria
before the subsequent qualification boundary.
