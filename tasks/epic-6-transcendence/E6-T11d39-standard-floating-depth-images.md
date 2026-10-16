---
id: E6-T11d39
epic: 6
title: Preserve original floating depth and stencil image transfers and retained ranges
priority: 525.027039000379
status: verified
depends_on: [E6-T11d38]
estimate: S
risk: high
capstone: false
---

## Boundary

One explicitly selected original floating-depth resource/backend boundary for
Z32_FLOAT=18 and Z32_FLOAT_S8X24_UINT=126. Pin the complete original format
descriptors, public words, independent primary conversion rules and native
depth/stencil storage. Preserve historical Z16 storage and every preceding
selected color owner/backend, compiler, command consumer and production device.
Checked original 2D depth/sampler/combined roles, NPOT full/truncated mip chains,
boxes, row padding, segmented backing and private native ranges must charge
logical, physical, scratch, conversion and staging bytes before any work.

Use qualified native DEPTH_COMPONENT32F and DEPTH32F_STENCIL8 textures, with
126's persistent per-resource pixel-unpack buffer charged before allocation; no CPU
texture, depth or stencil mirror or rasterizer fallback. Original finite depth
uploads follow pinned GLES clamp/conversion rules; zero/denormal and nonfinite
inputs have only their defined public guarantee. 126's unused X24 lane is explicit
canonical padding, with no invented preservation claim. The WebGL packed
ArrayBufferView restriction cannot be ignored: qualify its numeric-offset PBO
route physically before selecting it. GPU field packing and actual fixed-function
stencil extraction provide checked native readback. Preserve attachment and
helper state without feedback, and prove native failures unwind every allocation.

Retained matching-format depth/stencil ranges use actual native copies, original
level remapping, GPU-only refresh, old generation ownership, queued transfer
fences, cancellation/disposal and unequal ID reuse. This selected storage
boundary does not grant depth/stencil shader, sampler/surface command, stencil
state, complete API, capability, real guest, demo or throughput authority. Those
consumers and actual Mesa bring-up remain independently ordered successors.

## Deterministic acceptance

`make verify-E6-T11d39`

Bind exact source and generated compiler identities, original enums, metadata,
full words, transfer fields and complete segmented input backing. Predict every
finite native depth word and stencil value, public padding and byte footprint
independently before inspecting the final recordings. Record complete native
planes, public transfers, allocations, copy ranges, read/pack buffers and actual
consumed physical fences. Cover both formats and depth/sampler/combined binds;
base, NPOT full/truncated chains, nonzero partial boxes, padding/segmentation,
private ranges and refresh after GPU-only mutation with unchanged backing;
asynchronous old generations and changed-format ID reuse; all terminal paths.
Undefined float fields prove bounded safety/custody without value invention.

Pure strict-data, dimensions/level/bind/stride/overflow and one-byte budget
refusals precede allocations. Physical allocation, pack/copy, upload/read/fence
failures release charges and ownership. At least three varied physical schedules
exercise both formats. Actual completed wrong native depth precision, wrong
stencil selection and corrupted native field controls must fail unchanged
independent inverses. Seal every original input/native/public blob, source body,
browser metadata/log/screenshot and governing nested V8 coverage partition.
Selected affected syntax/build/native/browser gates and one final exact-head
scrubbed pristine cold run precede worker submission and a fresh critic.
Carry unchanged previous proof only when its code, boundary and digest match.

## Adversarial verification

Predict and independently authenticate all storage conversions, complete original
fields, geometry, range identity, reservations and native fence custody. Attack
partial nonzero mip boxes, opposite-format replacement IDs, old retained
depth/stencil generations and private refresh without backing updates; check
every changed executable partition against full original recordings. Invent one
bounded original-field/range attack with independent seeds, promote useful
deterministic coverage and sabotage it once through an actual completed native
field mutation after a distinct second physical fence. Preserve successful prior
predictions at unchanged boundaries. No runtime fixes or unqualified API/guest
authority in the critic session.

## Verification log

### 2026-10-11 — worker — original readiness and native preparation

D38 is freshly verified at `d79868fbfbb70ef215de0eaeee34cf3bee70a008` and
published on the existing open PR516; every verifier lease is released.
At that exact head, `node evidence/virgl-production-readiness/standard-floating-depth-image-gap.mjs`
records 24 original depth/sampler/combined, base/mip, upload/read layout refusals
for 18 and 126. The adjacent complete JSON binds each original metadata/transfer
input and every resource import to its original source digest. No native
allocation, command consumer, guest or capability authority follows.

Pinned Mesa26.2.2 `version.c` GLES3.0 and `st_extensions.c:832..836` require
both original floating depth formats with depth-surface and sampler support.
The complete original format YAML defines 126 little endian as F32/UP8/X24.
Read the primary [WebGL2 specification](https://registry.khronos.org/webgl/specs/2.0/)
and [GLES3.0.6 sections 2.1.1,3.8.3](https://registry.khronos.org/OpenGL/specs/es/3.0/es_spec_3.0.pdf).
Their packed ArrayBufferView restriction has a distinct numeric-offset PBO
upload route; defined depth conversion clamps finite values to [0,1], and unused
X24/nonfinite/denormal behavior must not acquire an invented bit promise.

The standalone source-only preparation in
`/tmp/wasmvm-production-api-plan/floating-depth-native-precheck/` used no
repository runtime. Its full original 36 pixels across both formats and three
mips passed an independent complete native-field inverse after 15 consumed
physical fences on Chrome 155.0.8059.39/M4 Max Metal. Report SHA256
`a00fadd1cf4617678b88723fab983043b17fe3e32f082339e1dc484575da0b5a`.
This is an inner-loop pre-check, not the final runtime submission. Exact primary
source pins and complete original native/source evidence will be frozen with
this task's acceptance. The user's explicit instruction continues this graphics
chain ahead of unrelated general queue work. Consumer/shadow/API/capset and real
guest Mesa/desktop/worker/scanout/demo deployment remain subsequent gates.

### 2026-10-11 — worker — frozen original floating depth storage submission

Frozen source: `2ef416185b8b4ddd85e39efd0913c8eb8eeb71e3`. Submission claims the selected original resource,
transfer and retained-range boundary only. The code changes `resources.mjs` and
two isolated floating-depth helpers; previous decoders/consumers, compiler,
default device, production negotiation and demo remain identical at the D38
verified boundary. Four preceding D37/D38 worker/critic seals authenticate
58,749 full members; the declared 25 historical HTTP module lists add only the
two imports, with unchanged historical test algorithms.

Exact final commands, all at the frozen source:

```sh
VIRGL_FLOATING_DEPTH_EVIDENCE_DIR=target/evidence/virgl-standard-floating-depth-images-final-hot EMCC=/Users/blamy/.cache/wasm-vm/emsdk/4.0.22/wasm-vm-emcc make verify-E6-T11d39
python3 tools/virgl-floating-depth/cold.py --output target/evidence/virgl-standard-floating-depth-images-final-cold
python3 tools/virgl-floating-depth/seal.py target/evidence/virgl-standard-floating-depth-images-final-hot target/evidence/virgl-standard-floating-depth-images-final-cold evidence/virgl-standard-floating-depth-images/worker
```

The complete source/native/packet/transfer fields are retained in
`evidence/virgl-standard-floating-depth-images/worker/{recording.tar.gz,records.json,manifest.json}`.
The full archive contains 21200 reopened unique members (77123950 bytes),
archive SHA256 `43ae2cd2d362ba708121e9d3d23789eae24c738324b43a2261f29e3bf5ebdc16`, index `b853257bc25b5e71da6854ed8c35fb55ffe61b3e3c0cffc34942ed4e1f797891`, manifest `fbee164ddf5646594c79aeaf5237a3a0465bcc75cc73cd1dcff9b7e8a2cc9f4a`.
Hot receipt `1eb6a28ecd0210a6a4e1b428d1488b623a93bbd5def3689d566fa21645a8d576`; cold receipt `2aae0643d3c37f90ffc75f8be70c0261e69f52f3f131e272d593265e54cefa99`; cold report `da27f6a07f8d0d375949cdbac5e84f33f3ecd065815bb1ff314ac03b6abb3028`.
The report binds the pristine detached source head and empty tracked/untracked
status before and after acceptance, with Rust/Cargo/Node/Python/compiler/VirGL
environment overrides scrubbed. All recorded immutable source bodies and
generated C/Wasm identities are included. Generated MJS SHA256
`6bb07a0b2a056d21ae52b22d7700ce10577854c1cdcf0877dd80be938e30e0fa`,
Wasm `acbe036afcdc4f1d8aa8cfb0fb107f48ba27759a6af4a7b9d6c83e3aa679d6cc`.

Hot and cold each pass the same original wire predictions (144 previous owner,
132 previous layout and six consumer refusal cases), the 32 native image cases,
and 47 boundary cases under each of seeds `0xa5471e03`, `0x13579bdf`,
`0x9e3779b9`. The independent Python inverse uses literal upstream format and
IEEE/GLES rules, importing no product code: 176 complete runs, 8,310 native
pixels, 47,988 public bytes, 9,764 padding bytes and all 256 stencil values.
Original finite F32, S8 and canonical X24 public fields hold; original
nonfinite words prove bounded complete custody only, and zero/denormal values
have only the pinned specification alternatives. Both formats, all three roles,
NPOT/full/truncated mip geometry, nonzero boxes, segmented padded backing,
private remapping and GPU-only refresh with unchanged backing execute.
Persistent original 126 upload PBOs and every logical/physical/scratch/staging
reservation are charged before allocation. Physical allocation/upload/pack/copy,
shader/link/uniform, buffer/fence/collection failures, strict refusal limits,
queued old generations, opposite-format ID reuse, cancellation, disposal,
missing indexed extension and actual context loss unwind once with zero final
charges. Native readbacks use consumed physical fences; full native planes use
an independently compiled integer-lane depth diagnostic and exhaustive
fixed-function stencil reference selection.

All three real completed corruption controls are refuted after physical
completion: `fault-depth-precision/report.json:partial.runs[0].planes[0]` has
depth word 1051372203 instead of original 1051372373; `fault-completed-depth`
has 1063256064 instead; `fault-stencil-selection` has public stencil 86
instead of 169 at its first original pixel. Wrong native depth clears use a
distinct second completed fence before the unchanged independent plane inverse.
The governing nested V8 partitions over every changed runtime line have
1,108 positive partitions and zero unproven ones. Exact text/SHA waivers cover
four whitespace spans and one unchanged historical RGB9_E5 cleanup operand;
full source bodies and all original nested regions remain the authority.

Syntax, task policy, actual pinned C/Wasm build, original wire/native/browser
checks and ten affected historical native storage/job gates pass on headed
Chrome155.0.8059.39 using physical Apple M4 Max Metal, with no software flags
and zero console/page/request errors. The historical Z16 gate includes all
65,536 UN16 encodings and real asynchronous readback. This is a worker claim
awaiting a fresh critic; it grants no consumer/shadow/stencil-state, API/capset,
real guest, production offload, demo/deployment or throughput authority.

### 2026-10-11 — fresh adversarial verifier

VERDICT: verified

This fresh session read the task and the exact D38-to-frozen-source diff before
opening worker evidence. `critic/orientation.json`, `critic/predictions.txt` and
the complete independent original matrix vectors were frozen outside the
repository first. Production runtime remains
`2ef416185b8b4ddd85e39efd0913c8eb8eeb71e3`; the final promoted verifier harness
is `9eddf5859b3d6456d3be8d16332c19a8183ed9ca`. Earlier successful recordings
retain their own exact source bodies and heads at the unchanged runtime boundary.

- P1 custody/cold — **HELD**. Independently reopened all 21,200 full worker
  members (759,680,972 bytes), all 880 immutable source identities and both
  generated compiler bodies. Archive/index/manifest match the worker pins above.
  The sole cold proof binds the exact frozen clone head and empty status before
  and after; `worker:cold/report.json:14`, SHA256
  `da27f6a07f8d0d375949cdbac5e84f33f3ecd065815bb1ff314ac03b6abb3028`.
- P2 original formats — **HELD**. Literal original enum and complete Mesa
  descriptors, numeric packed PBO overload, native internal formats and every
  native upload field agree. All ten complete primary bodies were independently
  fetched from their pinned revisions and hashed; `critic/format-audit.json`
  and `critic/primary-authentication.json` retain exact fields and source pins.
- P3 finite depth/stencil/public X24 — **HELD**. The fresh Python inverse imports
  neither product code nor worker oracle. Both full hot/cold phases, schedules
  and controls cover 16,296 native pixels, 106,896 public bytes and 930 consumed
  physical fence points; all 256 original stencil values occur. Positive normal
  words and finite clamp rules match exactly; zero/denormal fields receive only
  defined alternatives, nonfinite fields only bounded custody. Complete original
  native/public points: `worker:hot/hardware-matrix/report.json:2742` and `:3196`,
  report SHA256 `fb8102cc30d4009739bef11ff06e3771ea9b826f2165bc3f41da1d2dec4e2127`.
- P4 original packets/geometry — **HELD**. Independently predicted every original
  matrix word, metadata/packet field, nonzero mip box, row padding and complete
  segmented backing before inspection. Native adjacent fields and untouched
  backing remain exact; complete backing point at the same matrix report `:2718`.
  Each hot/cold wire record additionally holds 1,517 strict original predicates.
- P5 reservations — **HELD**. Logical/native/private/scratch/conversion/PBO
  charges match independently counted pixels before allocation; exact bounds
  pass and one-byte-short refusals allocate nothing. Original 126 owns its
  persistent upload PBO. The explicit short scratch path is
  `worker:hot/hardware-boundaries-0x13579bdf/report.json:134112`, SHA256
  `30db58491451d3be526abe953a63cb75c26cdc7d736cde353bf288fbdafb1ebe`.
- P6 native ranges — **HELD**. Full views alias their source, private levels map
  to original levels and use matching-format NEAREST native depth/stencil blits.
  GPU-only refresh changes native fields while complete backing stays unchanged;
  the full original matrix range point is `worker:hot/hardware-matrix/report.json:2853`.
- P7 generations/fences/terminal ownership — **HELD**. Old private ranges and
  queued source reads survive opposite-format same-ID/context reuse without
  publishing into replacement backing. Actual consumed completion precedes
  release; every owned native object/sync retires once and terminal charges are
  zero. Original replacement point: the boundary report above `:2912`.
- P8 failures/helper state — **HELD**. Allocation, upload/read/collection/copy,
  framebuffer/program/shader/uniform/fence failures, cancellation, disposal and
  actual context loss refuse explicitly and unwind ownership; native failure
  cases begin at the same boundary report `:100931`. Fresh nondefault caller
  qualification also preserves actual numeric program/VAO/FBO/attachment,
  texture/sampler identities and all new helper-touched depth/stencil/indexed
  blend/mask fields in both formats. `fresh/states/report.json:3016`, `:3490`,
  `:4179`, `:4882`, SHA256
  `09ba67733b9b95cc1efc0813328221b838f4b9032c7f26e2c8710e0119425d34`.
- P9 native controls — **HELD**. All three worker controls fail the unchanged
  fresh inverse at physically completed original fields. The promoted control
  additionally performs an actual private stencil clear: original level2/local1
  pixel4 must be 219 and becomes 220 at native blob byte112. Its distinct second
  consumed fence is sync88/turn88 after refresh sync86/turn82, both actual
  ALREADY_SIGNALED. `fresh/fault-completed-private-stencil/report.json:4278` and
  `:4304`, report SHA256
  `0b46a2e9caeaaf03931447057b6d2625b59f5aa0a748cabca2885b7b07248019`,
  native blob `6e1156662d97460b2fb9a21898fcb67035f4e70cfb65f02b0db24802c18309ef`.
- P10 coverage/retained authority — **HELD**. Independently recomputed all
  governing innermost partitions from complete original nested V8 ranges and
  source bodies, including the affected historical gates and original Node wire
  record: 1,108 positive partitions and zero unproven per phase. Four whitespace
  spans and one text-identical historical RGB9_E5 cleanup operand are precisely
  waived; `critic/coverage-audit.json:10`, SHA256
  `e4916fef8c50f7ce834789c1fb5660f9fe047d851b4f3dd070aec4475440bbdf`.
  Declarative snapshots/metadata/import lists are authenticated data; recorded
  syntax/build/native/browser/cold commands exercise the affected acceptance
  tooling. The four unchanged prior seals retain 58,749 independently reopened
  members and their original HELD boundaries; `critic/source-audit.json`.
- P11 bounded novel original-field/range attack — **HELD**. Independently prepared
  SHA256-domain seeds `0x6b49172d`, `0xd42087e1` cover both formats on 15x9 NPOT
  full chains and private [1,2], a nonzero original level1 box, GPU-only level2
  refresh with unchanged backing, queued old reads and unequal replacement.
  `fresh/novel/report.json:4146`, `:4263`, `:4542`, SHA256
  `8dc0c4f53b320d70390280f29fe85706d2ef45875ec9df491d8d5dc0067812c7`.
  All 47 task attack paths were rerun under fresh physical schedules
  `0x271c9350`, `0x5e71d954`, `0xb82fa27d`. Complete pre-run originals authenticate
  all 138 image cases, 189 input blobs and 357 actual native uploads. The final
  fresh inverse totals 1,772 native pixels, 12,780 public bytes and 93 consumed
  completion points, with error-free headed Chrome/M4 Max Metal records.

The additional P8A probe is fully retained. Two setup failures were corrected
only in the verifier fixture (required shader type and permanent WebGL
element/other-data buffer classes). A valid broader pixel-restoration probe
then observed the exact inherited `pixelState()` reset; this extra restoration
requirement is outside the selected helper claim. D38's literal transfer
prologue, staging read-FBO binding and collection COPY_READ binding are
byte-identical and independently authenticated in
`critic/historical-transfer-state-authentication.json`. Fresh scoped predictions
preceded the next physical run; all changed helper state and original fields
held. The earlier broad probe remains at
`fresh/probe-historical-pixel-reset/report.json:3474`, SHA256
`bcbf279008d9d00a86eb8916d5677f142dbdfa303eef8304e310f1f0aa192a1d`.
No runtime fix or failing changed predicate was hidden.

SUITE: promoted `verify-E6-T11d39-critic`, complete independent arbitrary-original
range fixtures, nondefault native caller identities and the standalone Python
inverse. The actual second-fence native sabotage fails as required. No additional
cold clone or unrelated workspace gate was repeated for test-only refinements.
The selected storage proof grants no compiler, default-device, command consumer,
shader/stencil-state, API/capset, real guest, production graphics, demo or
throughput authority.

Final exact-harness commands:

```sh
make verify-E6-T11d39-critic
python3 tools/virgl-floating-depth/critic.py --boundaries target/evidence/virgl-standard-floating-depth-critic --novel target/evidence/virgl-standard-floating-depth-critic --states target/evidence/virgl-standard-floating-depth-critic --output target/evidence/virgl-standard-floating-depth-critic/independent-fresh-fields.json
python3 tools/virgl-floating-depth/critic-seal.py --fresh target/evidence/virgl-standard-floating-depth-critic --scratch /var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasmvm-e6-t11d39-critic-0251zq3y --output evidence/virgl-standard-floating-depth-images/verifier
```

Fresh evidence in `evidence/virgl-standard-floating-depth-images/verifier/`
contains all original raw/native/source/V8/fence records, browser errors and
screenshots, earlier complete probes, predictions, independent audits and
reopenable file/line/digest/byte points. All 7,139 members were reopened
(303,732,156 full bytes; 49,297,435 archive bytes). Archive SHA256
`90ac4d8e042eeaec80843e474e608d1ef84509fe0038a73642c41869089a798e`,
index `c433f077dd5d3d26920ad212400741e80940d12a3eeea05fa8d613a27df7ca26`,
manifest `8c5ec5d64cdd2cb72e843f6780549beb620395b6f418ab5c3c77e7100e46a6cd`.
The full worker seal above is an immutable authenticated dependency; its archive
is retained rather than duplicated. No refutation or sufficiency gap remains.
