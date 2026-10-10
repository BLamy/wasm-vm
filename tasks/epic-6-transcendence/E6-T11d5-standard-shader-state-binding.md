---
id: E6-T11d5
epic: 6
title: Execute standard guest shader bindings through owned renderer jobs
priority: 525.027038
status: pending
depends_on: [E6-T11d4]
estimate: S
risk: high
capstone: false
---

## Boundary

Add an explicit host-selected `createVirglStandardAsyncRenderer` factory using
the existing resource/state/cache/job engine. Keep the old factories, command
profile, exact/private metadata admission and strict constant contracts intact.
No packet, provenance label, metadata fact or caller option may select a weaker
facet. This is the one standard shader-binding boundary; production device
negotiation, full GLES API support and live guest boot remain gated successors.

Own and validate the standard compiler's complete metadata with descriptor-only
records and dense bounded arrays. Admit native highp semantics, word uniforms,
GENERIC 0..15 at physical IO 0..31, smooth/flat word interfaces, native fragment
coordinates/discard, the measured system block, and checked 2D sampler slots 0..15
in both stages. Derive the pair interface internally and validate paired stage
outputs before linking. Restrict execution to the existing single COLOR0 target;
compiler support for other targets/broadcast must fail explicitly at this slice.

Add a separate standard submission decoder sharing the bounded packet grammar.
Only this decoder admits up to 2048 raw words in VS/FS slot0, including arbitrary
32-bit encodings; the old finite-word decoder and limits stay unchanged. Upload
exact owned words through active reflected uvec4 arrays, bounded by declared
extent and actual host component limits. Zero every absent active word so a
short/reset/unbound bank cannot borrow stale native state. Reflection can remove
unused native uniforms/samplers without inventing exact numerical authority.

Both-stage sampler view specialization, raw flat linkage and shader variants
participate in owned generation/cache keys and byte accounting. Reuse existing
leases, actual vertex/index fetch checks, async input/output exchanges, later-task
zero-timeout fence polls, cancellation/drain and complete state restoration.
Native undefined shader domains retain standard behavior; there is no GPU loop
termination or exact floating-point certificate.

## Deterministic acceptance

`make verify-E6-T11d5` records independent literal wire/metadata predictions,
actual fixed-memory compiler results and hardware renderer-job draws. Cover
VS/FS slots 511 and 2048-word bounds, nonfinite raw words, malformed tails with
zero mutation, short/reset bank zeroing, maximum physical/generic indices,
fragment-derived smooth/flat interfaces and native coordinates/discard. Probe
both-stage slot15 samplers with distinct real images and nonidentity/all-constant
views; record actual bound units, uploaded/read native words, sources, reflection,
buffer bytes and independently recomputed full pixels.

Execute complete captured 92cb and c580 sources and authentic original banks via
queued wire commands and real transfers/draws rather than private exact admission.
Record A/B/A restoration, cached relinking and variant changes, retained selector
identity/handle reuse, job input ownership and varied later-task schedules. Fail
wrong-facet/accessor/oversized/spoofed metadata before native draw. Quotas/errors
must clean up all owned objects and retain useful structured provenance.

A real uniform upload, vertex view or flat linkage mutation must fail its named
independent pixel oracle. Carry unchanged compiler/native/transport proofs and
run affected old renderer regressions. At a frozen head record the complete
submission once, run one final pristine exact-head clone with scrubbed environment,
seal original bytes/source/coverage/browser records, and submit to a fresh critic.
This isolated renderer factory is not imported by the production demo yet.

## Adversarial verification

Predict uploaded native words, reflected array extent, interstage types, texture
units and specific pixels before inspection. Attack getter/proxy/sparse/foreign
metadata, old exact authority in the new facet or standard metadata in the old
facet, over-limit counts/IO and incompatible paired metadata. Independently choose
one well-defined shader/texture combination; attack shortening/reset after a
previous full bank, stage/context swaps, optimized-out reads, view changes,
cache eviction and handle reuse. Exercise varied job schedules and prove no
readback/consumed request escapes its fence or owned identity. Hold every changed
runtime hunk against deterministic/physical evidence or a narrow justified waiver.
Sabotage the promoted oracle once. Do not impose full API/guest boot/throughput
claims on this isolated binding slice.

## Verification log

### 2026-10-09 — worker — pending readiness boundary

The standard compiler can emit a fragment uniform array with 512 raw vectors,
while `parseConstantDomain` rejects its metadata and `decodeSubmission` rejects
an otherwise valid2048-word inline FS constant bank. A new explicit consumer and
host-selected decoder are required; weakening the existing exact facet would
confuse its numerical/word proof. Activate only after E6-T11d4 is verified.
