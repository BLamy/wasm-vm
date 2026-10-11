---
id: E6-T11d46
epic: 6
title: Preserve original instance IDs with a host-owned compiler offset
status: verified
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

### 2026-10-11 — worker — implemented; exact-head recorded submission

Frozen implementation head: `28e5e7ab42ae52c75713b96ffad37727cceb05d6`.
The selected high-risk gate ran once hot and once in a pristine same-head clone:

```sh
VIRGL_INSTANCE_BASE_EVIDENCE_DIR=target/evidence/virgl-instance-base-frozen-28e5 EMCC=/Users/blamy/.cache/wasm-vm/emsdk/4.0.22/wasm-vm-emcc make verify-E6-T11d46
python3 tools/virgl-instance-base/cold.py --output target/evidence/virgl-instance-base-cold-28e5
python3 tools/virgl-instance-base/seal.py target/evidence/virgl-instance-base-frozen-28e5 target/evidence/virgl-instance-base-cold-28e5 evidence/virgl-instance-base/worker
```

Both gates passed at that exact head; the clone had empty status before and
following the same deterministic acceptance command with build/runtime override
variables scrubbed. The complete recordings demonstrate 4313 byte-equal native,
ASan/UBSan and Wasm responses,2586 historical response-byte comparisons,239
strict facade/custody checks,165 genuine allocation faults with exact recovery,
2107 actual Metal stage compiles,60 whole raw native planes and the physically
refuted completed wrong-offset draw. Every changed executable governing partition
was positive (33 JS,87 native; zero executable gaps). Delivered-source O2 frame
measurements retain selected sums139568(stage)/195280(pair) bytes below the
262144-byte Wasm setting; the actual module completes the whole matrix with its
fixed16777216-byte memory. Old renderer/decoder/storage/guest/web boundaries are
unchanged and their D45 facts carry by complete authenticated bodies. This is
compiler authority only; production guest graphics remains unfinished.

Concrete point: hot `hardware/report.json`, frame
`raw/base4294967295/index32`, draw event15438, fence handle2415 created15440 and
consumed15443, complete output digest
`28bc7696ab333cb05d5d17db5afa0da30d60fbff976a4fedcfdad106a90d88b1`.
Its original u32 indices4099/17/2051/7 survive and its original INSTANCEID rows
are4294967295/0/1. Hot `fault-wrong-offset/report.json` uses actual uniform1ui(18)
with unchanged original base17, draw84, distinct sync14 created86/consumed90;
all12 original instance lanes fail after completion. Corrupt output digest:
`fc7438fe93d359172f4475746d913c8b28d887da12717cebdf4f54c530087153`.
Native calls, full original/upload/readback bytes, shaders, parser words,
reflections, fences, console results and captures are all in the worker seal.

The published worker seal at `evidence/virgl-instance-base/worker` contains2584
complete indexed/reopened members plus both complete nested D45 seals whose91389
logical members were authenticated in each run. Archive97678160 bytes (six
bounded parts), full SHA256
`f746e58d61505392aa5b7f23fe919e2585187be0925e86f3158282052076df0e`;
record index SHA256
`e9ff82d91a2f6d8e6310e971ef87357a5aa22237f5eaf25facad465351ee29b9`.
Hot receipt SHA256
`64d0d99ac40db4cfec61f68a6b7002557be9c1fcfcc85b063b8c38b94fb521ea`;
cold receipt SHA256
`49d938be6065ddff1c54edb0faa6155ba1a81511266219b738cfa890d791b4ea`;
cold report SHA256
`c0a9217a198080474b3beb9a6f024c139684c29026e4905036a525148ef9236e`.
A fresh independent adversarial verdict is required before verification.

Worker manifest SHA256: `649def87b9a04660ba795de462f7ff1773bf0d9db9b89c501b6a417accddf5ce`.

### 2026-10-11 — fresh independent verifier — VERDICT: verified

The critic did not implement D46 or change runtime. Falsifiable predictions were
committed before concrete state at `cb74ee09550ef3aeb75eb1ea6fcefb49930ff821`;
the promoted critic source/gate was frozen before the final fresh run at
`52e42114e8f89607da7c449d9682aa3c769c56a9`. Runtime remains byte-identical to
`28e5e7ab42ae52c75713b96ffad37727cceb05d6`. Full per-prediction state/digest/
event citations are in `evidence/virgl-instance-base/verifier/VERDICT.md`.

- P1 custody — HELD: every2584 complete worker body and all91389 nested D45
  bodies authenticated, including exact earlier physical hardlinks and Git pins.
- P2 historical ABI — HELD: fresh manual ABI compared4313 literal native/Wasm
  response strings and2586 actual authenticated predecessor response strings.
- P3 original token semantics — HELD: each hot/cold run independently redecoded
  4969 original stages and144 system operands, with3385 admits/928 refusals.
- P4 reflection/composition — HELD: actual uint/default-zero/pruned liveness,
  queried C-emitted sources, raw attributes/constants/images and VirglBlock656.
- P5 strict custody — HELD:239 worker plus97 additional strict refusals,
  zero getters, mutation/proxy/host-field bounds and subsequent-call behavior.
- P6 allocation/memory — HELD:165 fresh actual fault sites and exact recoveries,
  fixed distinct16MiB memories, three independent peer schedules/pressure, and
  complete delivered O2 stack bodies below262144 on the selected call path.
- P7 original raw IDs — HELD: all60 hot and60 cold whole native planes,
  independently derived from original token/upload/index/native draw bytes.
- P8 completion/ownership — HELD: actual post-writer consumed syncs, native
  readbacks, full object retirement and headed M4 Max Metal/browser error lists.
- P9 completed negatives — HELD: worker original17/actual18 fails12 ID words;
  fresh second-draw corruption fails36 predicted x/z/w words after distinct sync.
- P10 finest coverage — HELD:33 JS/87 native positive governing partitions,
  zero executable gaps and11 exact non-executable declaration/signature waivers.
- P11 frozen cold/environment — HELD: exact28e5 pristine scrubbed cold and
  unchanged D45 dependency facts carry by complete authenticated identities.
- P12 bounded novel case — HELD: three fresh sparse u8/u16/u32 schedules and
  original INSTANCEID/VERTEXID MOV modifiers/XOR yield18 planes/756 correct words.
- P13 permanent suite — HELD: promoted `make verify-E6-T11d46-critic` passed
  once at the frozen critic head; complete normal/corrupt recordings retained.
- P14 scope — HELD: isolated compiler facet only; no production consumer,
  guest/caps/Mesa/compositor/display/deployment/throughput or PR-stack change.

The concrete fresh sabotage first completes original max-u32 draw82/sync14
created84/consumed87/read89. Actual uniform1ui(16) at91 preserves the original
base4294967295 expectation; second writer92/sync15 created94/consumed97/read99
refutes exactly36 raw words in lanes0/2/3. Complete corrupt output SHA256:
`7624ffe4dee7331283d18e90c997e7c283c7580e959223e89c53301ae133cf7b`.
The native report and independent original-token interpreter remain unchanged
in `fresh/fault-completed-offset` inside the seal. A compile/type refusal is
separate. An initial critic-only instruction-length assumption was corrected
against the complete original builder; its failed transcript is preserved.

Final commands (exit0):

```sh
VIRGL_INSTANCE_BASE_CRITIC_EVIDENCE_DIR=target/evidence/virgl-instance-base-critic/frozen-52e42114 make verify-E6-T11d46-critic
python3 tools/virgl-instance-base/critic_seal.py target/evidence/virgl-instance-base-critic/frozen-52e42114 evidence/virgl-instance-base/verifier
```

The full critic seal reopened3206 members/404126514 logical bytes/670 physical
bodies, with318 source and55 generated identities. Archive18359204 bytes in
two bounded parts, concatenated SHA256
`cf4cf5b9ced80cc4f379748bd199f9228d1cb4f6de8810adbef2f209aed70563`;
manifest SHA256
`8fc075d8d6e85a4078ddf507cb349282b5579093f5c047a3a14c2929d17f13b4`;
complete index SHA256
`2298b9fbb3e68cbe4d2996d92d335efeb891c552de5eb41f8d9ed531adc3dc58`;
full reopen audit SHA256
`ca631c3782a7438ffeb7c574adc02be51b2ff44117818a8c2f5e37f6ee58c30d`.
The worker and nested predecessor full archives remain committed and were all
reopened against their published pins. No product FAILED or NEEDS EVIDENCE
criterion remains. Policy is checked before queue regeneration; only verifier
evidence/tests/log/status/queue changes are committed. Production guest graphics
remains unfinished, and the root retains all publication/stack work.
