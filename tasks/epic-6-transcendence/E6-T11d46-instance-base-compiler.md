---
id: E6-T11d46
epic: 6
title: Preserve original instance IDs with a host-owned compiler offset
status: in-progress
estimate: S
risk: high
priority: 525.027039000384
depends_on: [E6-T11d45]
capstone: false
---

## Boundary

One explicitly selected C/native/Wasm compiler facet. Original TGSI INSTANCEID
reads become native unsigned instance ID plus one host-owned unsigned offset.
The guest cannot select that offset through shader text or request fields.
VERTEXID, original TGSI declarations/instructions/words, register storage and
the private VirglBlock656 layout remain intact. Existing compiler entry points
retain their entire byte-identical responses against the authenticated actual
predecessor module. All grammar, heap, stack and interface limits remain bounded.

The selected facet composes the existing typed/packed vertex, dimensional and
buffered slot-zero constant, texture operation and integer image/output selectors.
Expose selected stage/pair exports and a factory with the existing strict own-data
request methods. Emit a distinct profile and separately owned INSTANCE_BASE
uniform metadata, with default zero, only for a vertex INSTANCEID declaration.
Unused declarations may be optimized out by the native driver; metadata cannot
invent native liveness. Fragment stages never own an instance offset uniform.
Every old factory and entry initializes the new selected flag false.

No renderer/decoder/storage/transport/capset/guest/demo/performance change belongs
to this boundary. Its qualified consumer is a later ordered S task.

## Deterministic acceptance

`make verify-E6-T11d46`

Compare complete native, ASan/UBSan and actual fixed-memory Wasm responses and
original parser tokens for both system-value slot orders, INSTANCEID alone,
VERTEXID alone, both, absent and declared-unused system values. Exercise original
swizzles/modifiers/raw words, interface matching, sparse outputs, inherited vertex/
uniform/image selectors, all strict request and source-size bounds, actual arena/
emitter/upstream allocation faults with exact recovery, caller custody and distinct
Wasm memories. Authenticate and extract the actual old module from the complete
D45 worker seal; compare all affected historical stage/pair response bytes.

Compile C-emitted ESSL on actual headed Apple Metal WebGL2. Reflect the offset
uniform as native highp uint, verify zero initialization and explicit uniform1ui
values, and preserve original VirglBlock656 offsets. Execute arrays and original
non-monotonic u8/u16/u32 indexed instanced draws, with ordinary/one-instance and
multiple-instance calls. Original vertex and instance IDs must reach whole raw
integer output planes, including sparse original vertex indices, offset0/1/17/
65535/high-bit/max-u32 and defined low32 wrap. Independently derive expected
words from original input bytes and actual native call fields; no float surrogate
or shader-produced expected value. Cover absent/unused system values, modifiers,
typed/packed attributes, dimensional/buffered constants and integer image/output
composition. Keep physical input/output bytes, native reflection and full fence
identities with the complete source/compiler closure.

A real wrong instance-offset binding or served emission must complete a distinct
post-writer native fence before the unchanged original-word expectation fails.
Native compile/type errors are separate negative checks. Preserve actual normal
and corrupt full bodies and their source identities.

Record finest governing LLVM/V8 ranges and classify every changed executable
partition. Keep no new uncovered runtime operand under a declaration waiver.
Measure actual optimized Wasm stack within262144 and fixed16MiB heap, run the
selected affected gates once at the frozen head, final exact-head recorded hot
and same-command pristine scrubbed cold once, seal/reopen every complete indexed
member, and submit to a fresh independent verifier.

## Adversarial verification

Predict original INSTANCEID/VERTEXID words and native offset reflection before
reading evidence. Reopen the whole predecessor/worker archives and source pins.
Reparse original parser declarations/source operands and compare native/Wasm
responses with actual historical module bytes. Attack stage/slot/selector bounds,
unused declarations, duplicate system-value declarations, getter/proxy/caller
lifetime, actual allocation failures and independent fixed memories. Invent one
bounded original native instance/vertex/modifier case and physically sabotage a
completed offset result. Audit every changed finest LLVM/V8 region. Carry unchanged
HELD renderer/storage/decoder facts and final cold by their exact boundaries.
The critic may change tests/evidence/log/status; it never edits runtime.

## Primary source pins

GLES3.0.6 sections2.9.3 and2.11.9: original instanced draws execute instance-major;
the instance value is native gl_InstanceID and non-instanced draws use zero.
The existing pinned complete PDF is
`tools/virgl-floating-depth/primary/es-3.0.6.pdf`.
GLSL ES3.00 revision6 sections4.1.3 and7.1 define native highp integer width,
low-order overflow results and the zero ID for ordinary draws. Pin the complete
original PDF and relevant unchanged Gallium semantics before implementation.

## Verification log

### 2026-10-11 — worker — verified prerequisite and original compiler gap

D45 is independently verified at
`2a55ba679abda640781b854d83726d35fca1d98d`, with all verifier leases released.
PR523 continues existing native upper stack500; a live audit held all123 previous
PR identities/order/heads/bases and every PR remains open/draft/unmerged.

At that exact verified head the actual generated old compiler accepts the full
original VERTEXID+INSTANCEID integer-output pair but emits
`uvec4(uint(gl_InstanceID))`, without any owned instance-base uniform. The complete
response and compiler/generated/source identities are recorded in
`evidence/virgl-production-readiness/standard-instance-base-gap.json`; reproduce
with its adjacent `.mjs` script. This is compiler/source readiness, explicitly
without native draw, guest or production authority. D45's verified original
asymmetric-S8 instancing refusal remains held. The human instruction to finish
production graphics continues this prerequisite ahead of unrelated queue work.

### 2026-10-11 — worker — implementation self-validation before frozen recording

The selected C stage/pair exports and strict factory preserve raw original
INSTANCEID words with a separately owned native highp uint offset. Historical
entries explicitly leave the flag false. No renderer, decoder, storage, transport,
guest, capset, demo or production authority changed. The native/Wasm pre-check
compared 4313 complete responses (3385 admitted,928 refused), including2586
byte-identical historical responses and all four historical factories. The
original source-size boundaries49151/49152 admit and49153 refuses. All165
actual allocation faults reject without partial results and recover exactly.

Sixty actual headed Metal raw integer planes passed, including both system slot
orders, high-bit and wrapping offsets, original sparse/non-monotonic u8/u16/u32
indices, ordinary/single/multiple instancing, modifiers, absent/unused values,
typed/packed inputs and original dimensional/buffered constants and UINT image
composition. A physical uniform1ui(18) control retained the original base17
expectation, completed its own native fence and failed on all12 instance lanes.
The independent Python byte reconstruction held. Finest governing changed runtime
coverage had33 positive JS and87 positive native partitions, with no executable
zero partition. These runs are self-validation only; final exact-head hot/cold
recordings and a fresh adversarial verdict remain required.
