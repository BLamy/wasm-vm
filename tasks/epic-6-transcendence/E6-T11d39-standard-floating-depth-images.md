---
id: E6-T11d39
epic: 6
title: Preserve original floating depth and stencil image transfers and retained ranges
priority: 525.027039000379
status: in-progress
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
