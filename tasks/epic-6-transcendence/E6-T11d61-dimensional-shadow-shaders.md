---
id: E6-T11d61
epic: 6
title: Compile original cube and array comparison texture shaders
priority: 525.027039000398
status: in-progress
depends_on: [E6-T11d60, E6-T11d57, E6-T11d49]
estimate: S
risk: high
capstone: false
---

## Boundary

One explicitly selected C/Wasm compiler facet for original FLOAT SHADOWCUBE
and SHADOW2D_ARRAY declarations and instructions. Both vertex and fragment
stages admit TEX, TXD and TXQ with dimension-correct native comparison samplers.
Fragment cube bias uses original TXB2: src0.w remains the comparison reference,
and src1.x is a separate bias. Original input text/tokens, stage/slot identity,
source words/modifiers, result masks, qualifiers and query/comparison metadata
retain their independent custody. One slot must have consistent declaration and
instruction dimensions and compatible ordinary/comparison use.

Cube/array TXL/TXL2 have no core ESSL3.00 comparison overload and remain refused.
Refuse ordinary TXB for these shadows, array bias, vertex bias, dimensional
projection/fetch, shadow volumes, cube arrays, multisamples and offsets. Size
queries remain neutral between ordinary and comparison use, with native ivec2
cube and ivec3 array results. All seven qualified compiler factories/entry points
retain false selection and complete prior response bytes.

Add one distinct JS factory and stage/pair C exports. This compiler contract
carries no resource, sampler-state/consumer, decoder, framebuffer, submission,
capset or production Linux renderer authority. Dimensional depth storage and
ordinary views remain separately qualified by D59/D60. Guest offload and MIPS
are unproven until their actual integration acceptance.

## Deterministic acceptance

`make verify-E6-T11d61`

Optimized native C, ASan/UBSan C and the actual fixed-memory Wasm module must
agree on complete stage/pair responses. Independently parse original TGSI
tokens and predict sampler dimensions/types, query levels and comparison masks.
Exercise both stages, both dimensions, slots0/7/15, plain and explicit-shadow
views, legal operations, source modifiers, write masks, qualifiers, query/use
order, unrelated samplers and host input/output selections. Preserve complete
historical responses against the authenticated D57 compiler for all seven
prior facets, including new-dimension refusals and ordinary/shadow2D behavior.

Use actual headed M4 Max Metal WebGL2 for compile/link/reflection and complete
fenced RGBA32UI output planes from literal depth cube and array textures.
Distinguish every face/layer/mip, nonzero last layers, rounded/clamped array
indices, original fourth-lane reference, cube projected xyz gradients, ignored
array derivative z, fragment implicit derivatives and separate cube TXB2 bias.
Run three deterministic independent seeds/schedules. A physical reference-lane
or native-layer fault must fail the unchanged independent oracle after native
GPU completion. Preserve whole original inputs and raw outputs.

Refuse target/return/declaration conflicts, one-slot mixed dimensions or
ordinary/comparison samples, unsupported signatures, malformed/oversized text,
request/reflection traps, incompatible host masks and null/stage ABI inputs
without partial success. Exercise genuine allocation failures and exact
recovery, own source text before allocation, independently owned module memories,
fixed16MiB heap and262144-byte optimized stack. Audit finest changed LLVM/V8
regions; every changed hunk executes, is unchanged HELD or is statically waived.

Run one final scrubbed pristine clone at the frozen source head and seal/reopen
all complete recordings and source/module pins. Carry unchanged Rust/consumer
gates within their proven boundary. Surface truthful partial progress in the
built and live demo, preserving127/0 and zero browser errors. A fresh critic
must interrogate the diff and evidence before setting verified.

## Adversarial verification

P1: Predict original tokens, native sampler names, stages/slots and independent
query/comparison masks before reading results. All seven historical entry points
must refuse new shadows and preserve complete responses.
P2: Predict whole native output planes from literal face/layer/mip depth fields;
attack reference versus bias custody, cube projected gradients, array ignored
derivative z and layer neighbors, query dimensions and levels.
P3: Predict bounded complete refusals for unsupported signatures, target/type
contradictions, ordinary/comparison conflicts, malformed requests and host masks.
No implicit fallback or partial success may inherit consumer authority.
P4: Predict genuine allocation failure and exact subsequent recovery, immutable
owned input during caller mutation, fixed heap/stack and module isolation.
P5: Authenticate all complete evidence bodies, final clean-clone provenance and
finest changed regions; carry exact unchanged HELD boundaries. Invent one bounded
semantic attack and sabotage-check a physical GPU input against the same oracle.
P6: Built/live127/0 and actual partial roadmap state remain truthful, with default
production capability negotiation disabled and no complete guest-rendering claim.

## Verification log

### 2026-10-12 — worker — verified-head readiness; planned compiler boundary

D60 is independently verified at04ab18042036bf0ab19864bbe38e787dd4aadf48.
At that exact tracked-clean head, the actual unchanged D57 Wasm compiler refuses
16 original cube/array comparison TEX/TXQ programs across both stages and both
plain/explicit-shadow declarations. Six ordinary cube/array and shadow2D positive
controls pass with predicted native sampler names. Complete inputs, responses,
source bodies, generated module and runner remain in
`/tmp/wasmvm-dimensional-shadow-gap-04ab1804`.
Exact command:
`node /tmp/wasmvm-dimensional-shadow-readiness.mjs 04ab18042036bf0ab19864bbe38e787dd4aadf48 /tmp/wasmvm-dimensional-shadow-gap-04ab1804`.

Pinned primary authority is Mesa26.2.2 TGSI plus virglrenderer1.3.0 and Khronos
ESSL3.00 revision6. Both new comparison coordinates are vec4; cube gradients are
xyz and array gradients xy. Cube TXB2 carries a separate bias. New explicit-LOD
comparison overloads are absent. Consumer acceptance and production integration
remain later independently proven boundaries. Readiness and D60 publication are sealed in
`evidence/virgl-production-readiness/dimensional-shadow-compiler-gap/`:38
complete reopened bodies; manifestSHA256`b4e2f002125e4420a3d1497069d35b9ce0d46238bb90e0cfca4f2c2601ff9adb`,
indexSHA256`0147aa5ae15604247a240a4b155a5349ce093f055984a7aff97b886fad58d03e`,
archiveSHA256`c4ba827ff1c855cc1ab2e9f44a04224048b9a298bbb0afdc946ef05a57448c13`. PR538 appends to stack500 above
PR537. Both native stack identities and all138 earlier PR identities, order,
heads, bases and open/draft/unmerged state are unchanged. The app attachment
attempt reached its100-entry limit; existing attachments are preserved. Owned
clone cleanup authenticated every31,219 existing recorded body against retained
custody before removing the disposable checkout; all raw and sealed recordings
remain available.
