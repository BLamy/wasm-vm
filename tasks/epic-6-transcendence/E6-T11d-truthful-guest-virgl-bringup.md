---
id: E6-T11d
epic: 6
title: Advertise proven VirGL capabilities and initialize real guest Mesa
priority: 525.02704
status: implemented
depends_on: [E6-T12i, E6-T11d1, E6-T11d2, E6-T11d3, E6-T11d4, E6-T11d5, E6-T11d6, E6-T11d7, E6-T11d8, E6-T11d9, E6-T11d10, E6-T11d11, E6-T11d12, E6-T11d13, E6-T11d14, E6-T11d15, E6-T11d16, E6-T11d17, E6-T11d18, E6-T11d19, E6-T11d20, E6-T11d21, E6-T11d22, E6-T11d23, E6-T11d24, E6-T11d25, E6-T11d26, E6-T11d27, E6-T11d28, E6-T11d29, E6-T11d30, E6-T11d31, E6-T11d32, E6-T11d33, E6-T11d34, E6-T11d35, E6-T11d36, E6-T11d37, E6-T11d38, E6-T11d39, E6-T11d40, E6-T11d41, E6-T11d42, E6-T11d43, E6-T11d44, E6-T11d45, E6-T11d46, E6-T11d47, E6-T11d48, E6-T11d49, E6-T11d50, E6-T11d51, E6-T11d52, E6-T11d53, E6-T11d54, E6-T11d55, E6-T11d56, E6-T11d57, E6-T11d58, E6-T11d59, E6-T11d60, E6-T11d61, E6-T11d62, E6-T11d63, E6-T11d64, E6-T11d65, E6-T11d66, E6-T11d67, E6-T11d68, E6-T11d69a, E6-T11d69b, E6-T11d70, E6-T11d71, E6-T11d74d]
estimate: S
risk: high
capstone: false
---

## Boundary

Activate VIRTIO_GPU_F_VIRGL and GET_CAPSET_INFO/GET_CAPSET only for the qualified
WebGL2/backend profile proven by prerequisites. Generate capset bytes from typed
Rust fields with pinned independent ABI/mask checks, not hand-written hex or
native-layout assumptions. Limits, API/GLSL level, formats and every feature bit
must reflect implemented browser behavior and actual host limits. No null
renderer may justify positive production capabilities. Unsupported hosts remain
explicitly gated. Record guest package/kernel/driver pins and bring-up steps.

## Deterministic acceptance

`make verify-E6-T11d` boots the actual guest in the built browser and proves
virgl acceleration enabled in dmesg, card0/renderD128 present, and eglinfo/es2_info
finishing with the intended Mesa virgl renderer and no llvmpipe fallback. Remove
llvmpipe in a disposable guest overlay and repeat. Compare Mesa initialization
control-command coverage against QEMU plus pinned virglrenderer, allowing order
differences but no missing handshake. Run kmscube through at least 1000 submits;
the original command log must contain contexts, resource creates, transfers and
DRAW_VBO and remain correctly framed to the end with explicit errors for any
unsupported packet. A feature gap blocks bring-up until an ordered S fix is
verified; do not over-advertise to coax initialization past it.

Run affected native/wasm/browser gates and final clean clone, record guest traces
and source/image identities, and preserve the Epic5 desktop boot/2D regression.
Surface this newly proven device capability and submit/fence/byte counters in
the demo, run the repository's built-page acceptance and deploy/verify the live
site per AGENTS.md. Performance remains a later, independently measured claim.

## Adversarial verification

Probe every positive capset bit/format/limit at and beyond its boundary; compare
reported extension/API strings to executable support. Reject hidden CPU fallback,
speculative capabilities and unknown-opcode skipping. Attack unsupported browsers
and stale qualification state. Sabotage a cap bit or handshake response and
require the guest/ABI oracle to fail rather than accept an invalid profile.

## Verification log

### 2026-10-09 — worker — negative readiness; ordered prerequisite

Cache dependency E6-T12i is independently verified at
`fcb908e756a5e2fe7eb6f29864e23b0e46652b37`. The first minimum API check cannot
currently justify an ES2 profile: the ordinary vertex bridge and state reflection
stop at 46 guest constant vectors (47 including the upstream inaccessible suffix),
while GLES2 requires at least 128 vertex uniform vectors (Khronos ES2 table 6.20).
The actual generated Wasm rejects a direct slot127 read before producing ESSL.
No production capability or guest execution is claimed. The negative record
`evidence/virgl-production-readiness/constant-floor.json` binds complete source,
Wasm and source-head hashes to the result. Exact repro on this head:

```sh
node --input-type=module <<'JS'
import {createVirglShaderBridge} from './renderer/virgl-shader/index.mjs';
const bridge=await createVirglShaderBridge();
console.log(bridge.translate({stage:'vertex',text:'VERT\nDCL CONST[0..127]\nDCL OUT[0], POSITION\n0: MOV OUT[0], CONST[127]\n1: END\n'}));
JS
```

Observed `ok:false`, `unsupported-feature`, complete source rejected. Typed caps
must not overstate this backend floor. Ordered S prerequisite E6-T11d1 implements
and physically proves bounded ordinary vertex slot127 capacity while retaining
private raw/certificate limits; it grants no positive production capability by
itself. Resume bring-up after that fresh verification, then test the full actual
qualification/handshake. Normal entry also rejects complete92cb/c580 sources;
private numerical proof is not live admission. Any additional gap found during
bring-up follows the same ordered-fix rule.

### 2026-10-09 — worker — constant floor verified; next baseline boundary

E6-T11d1 is independently verified at `3c6295a9`. Its 128-vector capacity does
not qualify the complete API. The next direct readiness probe submits a BLEND
object for additive ONE/ZERO in both RGB and alpha. It still returns
`unsupported-feature: Only standard additive alpha blending is supported.`
Reproduce with `node --input-type=module` importing `decodeSubmission` from
`renderer/virgl-command/decoder.mjs` and decoding the little-endian dwords
`[721153,777,0,0,2084708881,0,0,0,0,0,0,0]`. This is a core valid blend operation
under the pinned Gallium enum and GLES2 contract. Ordered S prerequisite
E6-T11d2 covers single-target equations/factors, including WebGL’s mixed constant
restriction; it cannot grant production capsets by itself. The explicit user
request to finish guest graphics continues this ordered graphics chain.

### 2026-10-09 — worker — blend verified; next vertex-fetch boundary

E6-T11d2 is independently verified at `bcdb8206`. The original scalar/four-lane
float vertex formats 28/31 still reject, while 29/30 admit. The negative record
`evidence/virgl-production-readiness/float-vertex-gap.json` binds original bytes
and pinned source identities. Reproduce via `decodeSubmission` on little-endian
dwords `[(5<<16)|(5<<8)|1,777,0,0,0,28]` and the same with final word 31. Both
return `unsupported-feature: Only per-vertex RG32/RGB32_FLOAT elements are
supported.` Ordered S prerequisite E6-T11d3 closes the scalar/four-component
fetch family and independently proves missing lanes, fourth alpha and clip W.
No complete API, production negotiation or guest rendering is claimed here.

### 2026-10-09 — worker — float fetch verified; ordinary shader boundary

E6-T11d3 is independently verified at `97ed2ca3`. Standard uniform-fed SIN,
EX2, LG2 and POW shaders still reject through the existing exact proof facet;
so does a legal position plus eight generic outputs. Reproduce each complete
source in `evidence/virgl-production-readiness/standard-shader-gap.json` through
`createVirglShaderBridge().translate({stage,text})`. Its negative result binds
the unchanged compiler source closure, actual Wasm and Mesa26.2.2 source pin.
E6-T11d4 adds a distinct bounded standard compiler facet, preserving existing
exact/raw/private admission. It grants no positive capsets.

The captured Hyprland0.56.2 source requests GLES3.2 and falls back only to
GLES3.0 (OpenGL.cpp184..203 at pinned revisionefb50993780079460b0cbed1363e2166a2de1d9f).
`evidence/virgl-production-readiness/compositor-api-floor.json` binds that source
and the original reference log. GLES2-only kmscube admission cannot complete
the requested desktop offload. This source/readiness observation does not claim
that the browser supports the complete API. Remaining actual GLES3 storage,
state, texture, draw and typed qualification gates remain ordered successors.
The explicit user instruction continues this graphics chain instead of the
unrelated general queue entry.

### 2026-10-09 — worker — standard compiler verified; command consumer gap

E6-T11d4 is independently verified at `9323b44519710dfb2c8a324fe115872b79d274f0`.
The complete original compositor programs and standard arithmetic/word semantics
are proven in the isolated compiler, while production still has no VirGL caps.
The existing state parser rejects standard metadata, and its finite constant
decoder rejects a valid 2048-word fragment slot0 bank. The negative recording
`evidence/virgl-production-readiness/standard-renderer-gap.json` pins unchanged
state/decoder/compiler source and actual Wasm at `8101e82c`; those runtime bytes
remain unchanged through the verified compiler head. Reproduce by translating
its complete `text` through `createVirglStandardShaderBridge`, passing the returned
metadata to `parseConstantDomain(metadata, 'fragment')`, and decoding its exact
`packetHex` with `decodeSubmission`. Observed errors are `shader-domain-error`
(unknown/accessor property) and `limit-exceeded` (array exceeds profile limit).

Ordered S task E6-T11d5 adds a host-selected standard async consumer and separate
raw-word decoder. It executes full original compositor bodies through renderer
jobs and preserves old exact/private facets. It does not qualify the full API or
enable the production device. The user's instruction continues this graphics
chain; actual guest Mesa initialization, API gaps and scanout remain later gates.

### 2026-10-10 — worker — standard bindings verified; draw prerequisite

E6-T11d5 is independently verified at
`761a912a88823954e3424f7b003c15887e7c9034`. The next actual decoder
readiness probe still rejects instance counts above one, positive element
divisors, and u32 index bindings. The unchanged decoder digest and literal
negative packets are in
`evidence/virgl-production-readiness/standard-draw-gap.json`; decode each
`packetHex` with `decodeStandardSubmission` to reproduce. The same file pins
Mesa26.2.2's encoder and unconditional instance-ID/divisor promises.

Ordered S prerequisite E6-T11d6 implements this one vertex-fetch boundary,
including actual wide-index and per-instance bounds, restore and native calls.
The explicit user request to finish production guest graphics keeps this
graphics chain ahead of unrelated general-queue work. Other core topology,
constant-stride, restart, storage and framebuffer/API gates remain ordered
successors. No positive production capability or guest draw follows from this
negative readiness observation.

### 2026-10-10 — worker — instanced draws verified; constant attribute gap

E6-T11d6 is independently verified at
`67220bb5ed0dfab2e06563b6353fd6975f9696b9`. The next actual hardware
readiness probe binds active IN1 with stride zero and submits its original
instanced draw. It rejects with `unsupported-draw: Gallium constant attributes
with stride zero are unsupported.` No native draw executes. Original wire,
source/compiler identities and physical GPU identity are in
`evidence/virgl-production-readiness/standard-constant-stride-gap.json`.
To reproduce, use the pinned standard fixture's `specimen({instances:3})`,
submit `setup`, then `packet(6,0,[16,16,3,0,32,4,16,16,5])` plus
`drawPacket(spec)` through its actual headed standard async `rig`.

Ordered S prerequisite E6-T11d7 implements this one fetch boundary through
retained GPU reads and native generic attributes, including their batch lifetime.
The user's production-graphics request keeps this ordered chain ahead of the
unrelated queue. This negative observation grants no production capsets,
complete API, guest execution or performance claim.

### 2026-10-10 — worker — constant fetch verified; core topology gap

E6-T11d7 is independently verified at
`64b246220bbf3ed5e1a6f1ed7371535ed5ec5c56`. The original decoder still
rejects Gallium LINES, LINE_LOOP, LINE_STRIP and TRIANGLE_FAN (modes1,2,3,6).
The literal packets and authenticated source closure are in
`evidence/virgl-production-readiness/standard-topology-gap.json`; decode each
`packetHex` with `decodeStandardSubmission` to reproduce the recorded
`unsupported-feature`. Its original39a9d14b runtime bytes remain identical at
the D7 verdict. No native or guest draw is claimed by this negative probe.

Ordered S prerequisite E6-T11d8 extends only the standard native primitive
selection, holding actual fetch/work and async storage ownership unchanged.
The user explicitly requested continuing through production graphics, so this
ordered graphics chain remains ahead of unrelated queue work. Complete GLES3,
typed capsets, actual guest initialization/offload and the demo remain later
gates; this negative result grants none of their authority.

### 2026-10-10 — worker — topology verified; restart normalization gap

E6-T11d8 is independently verified at
`bef7040804a1c71ad37112e35adcfebefbc4be21`. Every original restart packet in
`evidence/virgl-production-readiness/standard-restart-gap.json` still rejects;
decode its `packetHex` with `decodeStandardSubmission` to reproduce. The
recorded decoder/state/compiler bytes are unchanged through the verdict.
Mesa26.2.2 promises custom and fixed restart together through one capability
bit, while WebGL2 always interprets the native type's maximum as fixed restart.
Ordered S prerequisite E6-T11d9 lowers only actual owned index streams and
preserves valid disabled-restart u8/u16 maximum vertices. The explicit request
continues this graphics chain; complete API, typed caps, actual guest rendering
and production deployment remain later gates.

### 2026-10-10 — worker — restart verified; original provoking identity gap

E6-T11d9 is independently verified at
`c378b55516f74a2da3612462104785fe6997fca1`. It deliberately grants no
per-vertex provoking-state authority. The planning-only native flat-uvec4 probe
in `evidence/virgl-production-readiness/standard-provoking-gap.json` records
complete shaders, original indices/positions and full pixels on M4 Metal.
Even with explicit LAST state, LINE_LOOP uses its first vertex and TRIANGLE_FAN
uses the center. GLES3 table2.12 requires loop i+1 (closing vertex1) and fan i+2.
Reproduce by writing that record's exact `script` to a local .mjs and running
Node on this host; the record preserves its script digest and native pixels.
This is a negative readiness observation, not a complete API or guest claim.

Ordered S prerequisite E6-T11d10 selects bounded native line/triangle lists,
restores LAST before native draws, and proves original vertex identities and
flat/smooth outputs through original packets and physical GPU buffers. Its
historical default native facet remains isolated and unchanged. The user's
instruction continues this graphics chain; points, complete profile/typed caps,
real guest initialization, scanout and demo deployment remain later gates.

### 2026-10-10 — worker — primitive assembly verified; point pipeline gap

E6-T11d10 is independently verified at
`c810cbef23caa7a19b090491ccc30c093d432518`. The original POINTS packet, fixed
size4 and per-vertex rasterizer state still reject, as do complete original vertex
PSIZE and fragment PCOORD input/system-value shaders. The authenticated negative
record `evidence/virgl-production-readiness/standard-point-gap.json` names the
complete compiler/runtime source closure and actual Wasm. Decode each `packetHex`
with `decodeStandardSubmission` or translate each `stage`/`text` through
`createVirglStandardShaderBridge().translate` to reproduce `unsupported-feature`.
Ordered S prerequisite E6-T11d11 closes this single native point pipeline. The
user's explicit request continues this graphics chain; complete API, typed caps,
real guest initialization, scanout and demo deployment remain later gates.

### 2026-10-10 — worker — native points verified; compact vertex fetch blocked

E6-T11d11 is independently verified at
`1fbdfa7e53ebe6e8ed4a80935687d8b71a797f42`. Pinned Mesa26.2.2's GLES3 predicate
requires half-float vertex support, and its VirGL vertex-format predicate admits
plain formats. The actual selected decoder still rejects all twenty original
R/RG/RGB/RGBA16_FLOAT, 8_UNORM/SNORM and 16_UNORM/SNORM formats. Complete source
and original packet identities are recorded in
`evidence/virgl-production-readiness/standard-compact-vertex-gap.json`. Repro:

```sh
node --input-type=module <<'JS'
import {decodeStandardSubmission} from './renderer/virgl-command/decoder.mjs';
for(const base of [48,56,64,74,91])for(let n=0;n<4;n++){
 const bytes=new Uint8Array(24),v=new DataView(bytes.buffer);
 [0x50501,777,0,0,0,base+n].forEach((w,i)=>v.setUint32(i*4,w,true));
 console.log(base+n,decodeStandardSubmission(bytes));
}
JS
```

Each result is `ok:false`, `unsupported-feature`. Ordered S prerequisite E6-T11d12
adds native compact fetches and bounded stride-zero scalar conversion while
retaining float32 and legacy admission. Additional full-API gaps stay gated; no
capset, guest offload, deployment or performance claim follows. The production
graphics chain remains ahead of unrelated queue work under the user's request.

### 2026-10-10 — worker — compact fetch verified; scalar conversion boundary

E6-T11d12 is independently verified at
`b98847797f109b0a3af6171fd0a8c21983e1057b`. The actual standard decoder still
rejects the original normalized32 and scaled8/16/32 R/RG/RGB/RGBA floating-input
formats. Decode every literal `packetHex` in
`evidence/virgl-production-readiness/standard-scalar-vertex-gap.json` with
`decodeStandardSubmission` to reproduce the 32 unsupported-feature results at
that verified head. The record pins complete renderer/compiler source and actual
fixed-memory Wasm. Ordered S/high prerequisite E6-T11d13 preserves original GPU
storage and native floating conversion while closing this scalar family. Pure
integer and packed inputs, storage/framebuffer/API qualification and real guest
bring-up remain ordered successors. The user's instruction continues this
graphics chain; isolated format results do not activate a production capset.

### 2026-10-10 — worker — scalar fetch verified; pure integer input gap

E6-T11d13 is independently verified at `8037ede91b4c8450e696811d33ac7d34235388ba`. The original 24 pure integer vertex formats177..200 still fail standard wire admission and the compiler has no host typed pair method. The negative recording `evidence/virgl-production-readiness/standard-integer-vertex-gap.json` binds their literal packets and complete source/generated identities at that verified head. Decode each `packetHex` with `decodeStandardSubmission` to reproduce. Ordered S/high E6-T11d14 closes the raw integer input boundary across the actual compiler, format-derived native shader variants, original GPU pointers and retained constant words. Packed formats, storage/framebuffer/API qualification and actual guest bring-up remain ordered successors. The explicit user instruction continues this chain; no speculative production capset is granted.

### 2026-10-10 — worker — integer boundary verified; packed fetch remains

E6-T11d14 is independently verified at `23bf410f9e152d53e83e674717c647a4164dcde7`. The next direct original vertex-element probe still rejects the four native packed R10G10B10A2 forms. `evidence/virgl-production-readiness/standard-packed-vertex-gap.json` records their original packets and exact source/generated identities at that verified head. Reproduce at that head by importing `decodeStandardSubmission` from `renderer/virgl-command/decoder.mjs` and passing each literal `packetHex` as `Buffer.from(packetHex, 'hex')`; each returns `unsupported-feature`. Original formats 8/123/172/173 are UNORM/USCALED/SSCALED/SNORM with four fields in one four-byte element. Ordered S/high E6-T11d15 adds original native fetch and bounded retained constants; it grants no texture/API/capset or production guest claim.


### 2026-10-10 — worker — packed fetch verified; dimensional constants gap

E6-T11d15 is independently verified at `e118e4c2ddf83b2641fcca267025b1a6ef8fdad9`. The verified-head negative `evidence/virgl-production-readiness/standard-uniform-buffer-gap.json` pins six original dimensional constant shaders, original opcode27 and resource binding64, complete source/Wasm closure and Mesa26.2.2 source identities. Reproduce by calling the standard bridge on each recorded programs entry, `decodeStandardSubmission` on packetHex, and `computeTransferLayout` on its complete resource record. Dimensional constants reject unsupported-feature; opcode27 rejects unsupported-command; constant storage rejects unsupported-resource. Mesa's actual setter sends opcode27 for any GPU buffer, including slot0, and opcode12 for inline/unbind. Original TGSI brackets select slot first and vector second.

Ordered S/high E6-T11d16 proves actual C/Wasm dimensional uniform-block emission. Original retained uniform-buffer bindings and WebGL buffer-role reuse are separate successors. The primary WebGL2 specification also forbids index/other-data cross-class copies; qualification must use proven storage adaptation, never assume direct GPU copies can cross those classes. No positive capset or actual guest draw follows from this negative observation. The user's production graphics request continues the ordered chain.


### 2026-10-10 — worker — uniform compiler verified; original retained binding gap

E6-T11d16 is independently verified at `3ec060c46a9743a62306ae409d0bf1a548d4a616`, with its exclusive lease released and verdict published in open PR492. The historical standard decoder and resource factory still reject original opcode27 and target0/format64/bind64. Reproduce by decoding little-endian dwords `[0x5001b,0,1,16,16384,777]` through `decodeStandardSubmission`, or submitting the pinned uniform-buffer metadata in `evidence/virgl-production-readiness/standard-uniform-buffer-gap.json` to `computeTransferLayout`; command/resource runtime is unchanged through D16. Ordered S/high E6-T11d17 connects this one original packet-to-native retained range boundary. Element-array/data reuse, full GLES3/API/caps, actual RISC-V guest Mesa/kmscube/desktop, production worker scanout and live demo remain later qualification; no positive caps or guest rendering is claimed here.

### 2026-10-10 — worker — uniform ranges verified; original buffer role reuse

D17 is independently verified at `f489b8ed5599dfe9afeb7d7d1463655e768af418`. Its selected facet still rejects original index/other-data reuse, zero/combined creation hints. `node evidence/virgl-production-readiness/standard-buffer-role-gap.mjs` reproduces every negative role result on the unchanged old factories; source bytes and original metadata are pinned in the adjacent JSON. Ordered S task D18 closes this original allocation boundary using the existing fenced index read and private u32 normalization path. WebGL cross-class binding/copy restrictions forbid direct native aliasing. Production API/caps, actual guest Mesa/compositor and worker scanout/live deployment remain unqualified. The explicit user instruction continues this graphics chain ahead of unrelated general queue work.

### 2026-10-10 — worker — buffer identity verified; sampler state gap

E6-T11d18 is independently verified at `bdad14aff93ba70c09d60ab308df4d2024dce4ba`. The unchanged standard sampler decoder still rejects 25 of the 27 original REPEAT/CLAMP_TO_EDGE/MIRROR_REPEAT address combinations, and all original mip-filter states. `evidence/virgl-production-readiness/standard-sampler-gap.json` binds the literal packet probe and unchanged decoder/pinned enum/encoder/renderer hashes. Decode each packetHex using `decodeStandardUniformSubmission` to reproduce. Ordered S prerequisite E6-T11d19 executes these original core state fields through native samplers, preserving finite legacy admissions. GLES leaves reversed LOD bounds sampling undefined; their source words and native parameter values must be preserved without a fabricated pixel claim. Actual storage/API/capset qualification, RISC-V guest Mesa/compositor execution, production worker scanout and live deployment remain successors under the explicit user instruction to finish production guest graphics.

### 2026-10-10 — worker — sampler verified; original mip storage gap

E6-T11d19 is independently verified at `52d3cc4e2f0f28d82a2900ff33ab855ae118e66e`. The original metadata and op9/43/45 packets in `evidence/virgl-production-readiness/standard-texture-gap.json` still reject nonzero lastLevel/level. Reproduce with its complete script against the pinned unchanged resource/decoder bytes. Ordered S/high E6-T11d20 adds checked original mip storage and transfers. Sampler views, framebuffer subresources, complete API and typed caps, real guest Mesa/rendering and deployment remain gated. The explicit user instruction continues this production graphics chain; this prerequisite cannot grant their authority.

### 2026-10-10 — worker — mip storage verified; original image boundary

D20 is independently verified at `c0488902039a5fb5f9efc8c62101798668b2ce4a`. Its selected storage-only decoder still rejects original SAMPLER_VIEW [1,2] and SURFACE level2 packets. `evidence/virgl-production-readiness/standard-image-gap.json` binds their original words and unchanged source/Wasm through this verified head; reproduce with `decodeStandardTextureSubmission(Buffer.from(packetHex,'hex'))`. Ordered S/high D21 qualifies original native view ranges and framebuffer planes with bounded GPU copies and completion lifetime. The explicit instruction continues this production graphics chain; complete API, capsets, actual guest Mesa/compositor and worker/scanout/deployment remain later gates.

### 2026-10-10 — worker — image ranges verified; byte-color storage gap

D21 is independently verified at `ac916b7fd0b194c088fe5d54800b24a80a4679ac`. Its original image decoder/store still reject 24 normalized-byte/sRGB families. `standard-byte-color-gap.json` and `standard-byte-color-storage-gap.json` under `evidence/virgl-production-readiness` bind 48 literal view/surface packets and 24 original metadata records, each refused before native allocation, to the exact unchanged source/Wasm and pinned Mesa/VirGL descriptors. Reproduce by decoding each `packetHex` through `decodeStandardImageSubmission` and passing each original metadata record to `createStandardImageResourceStore` with its qualified predecessor backend. Ordered S/high D22 closes one original byte-color image/transfer boundary with physical signed and sRGB semantics, padded storage charging and original memory orders. The explicit user instruction continues this graphics chain; typed caps, complete API, actual RISC-V guest Mesa/compositor, worker scanout and live deployment remain successors.

### 2026-10-10 — worker — byte-color verified; original texture operation gap

E6-T11d22 is independently verified at `ac2b1ed7a77e82afb21321d6dfdabe0b2da12d4c`. The complete original TXL/TXF/TXD/TXB/TXQ shaders still reject at the unchanged standard/uniform compiler, including legal fragment forms and vertex forms other than TXB. `evidence/virgl-production-readiness/standard-texture-operation-gap.json` binds twenty complete literal inputs, all responses, pinned parser/converter sources and the actual predecessor Wasm SHA256 `fc479ec92133f8b75d26043d20fca97d00b1a1556481abf5c5daf23b66e00fca`. Exact repro: iterate its `rows`, select `createVirglStandardShaderBridge` or `createVirglStandardUniformShaderBridge` from `renderer/virgl-shader/standard.mjs` according to `profile`, and call `translate({stage,text})`; all return unsupported-feature.

Ordered S/high E6-T11d23 closes only the original 2D/FLOAT native texture compiler boundary, with a distinct selected profile and owned native level-query metadata. A following retained-image consumer must bind this metadata from validated original views. The user's production graphics request keeps this chain ahead of unrelated queue work. No capset, full API, guest draw, deployment or performance authority follows from the prerequisite.

### 2026-10-10 — worker — texture compiler verified; retained-image consumer gap

D23 is independently verified at `71853cd302a2a39cd8f5af001fd8ad1b791b7da6`. Five complete original pairs in `evidence/virgl-production-readiness/standard-texture-consumer-gap.json` produce owned texture metadata, but the unchanged uniform consumer rejects it and the pair with unknown/accessor-property errors. Its complete inputs, responses and runtime/generated digests were reproduced at that exact head. Reproduce by translating each original pair through `createVirglStandardTextureShaderBridge`, then calling `parseStandardUniformShaderMetadata` and `normalizeStandardUniformShaderPair`. Ordered S task D24 binds the original native texture operations and integer queries to retained views. Actual API/caps, worker/scanout, guest Mesa/desktop and live offload remain unqualified.

### 2026-10-10 — worker — texture consumer verified; original float storage gap

D24 is independently verified at `6ec464d9b9d1daecd01a0dd5ac58d31ac23910fe`, with its exclusive lease released. The eight complete original F16/F32 R/RG/RGB/RGBA multilevel layouts still reject through the historical byte-color boundary. `evidence/virgl-production-readiness/standard-float-image-gap.json` binds the original metadata, transfer fields, enum values and unchanged source hashes to that exact head. Reproduce by importing `computeStandardColorTransferLayout` from `renderer/virgl-command/resources.mjs` and applying each recorded row's `metadata`, `fields` and `backingByteLength`; all return `unsupported-resource` before allocation.

Ordered S/high D25 preserves these original floating image storage/transfer representations and retained ranges through a separate selected owner/backend. A native sampling/output consumer follows separately. The user's request continues the ordered production graphics chain; full API/caps, actual guest Mesa/compositor, production GPU worker/scanout and live deployment remain gated.

### 2026-10-10 — worker — float storage verified; original consumer prerequisite

E6-T11d25 is independently verified at `7a58efee480e38ebad14dedcc57bde0e747088ae`; original F16/F32 words, native planes, public transfers, ranges and generations retain their sealed proof. At this verified head, all sixteen original floating sampler-view/surface packets still refuse through the historical byte consumer. `evidence/virgl-production-readiness/float-consumer-gap.json` records the full original bytes and exact source closure; reproduce each `hex` with `decodeStandardColorSubmission`. The selected original floating consumer E6-T11d26 is the next ordered S prerequisite. It must prove actual shaders, native float filtering/blending/outputs and retained ranges before production can report that API behavior. The explicit request continues the production graphics chain; the device remains disabled and the actual guest integration remains later work.


### 2026-10-10 — worker — original packed storage floor remains gated

E6-T11d26 is independently verified at `a5085b5491f24b3c700fb7cef7b1629c2efef914`; its original floating consumer and complete hot/cold seals are retained. At this verified head, both original packed formats124/125 still refuse in the selected float storage layout and original view/surface decoder. `evidence/virgl-production-readiness/standard-packed-float-image-gap.json` pins all six original metadata/packet inputs and exact source closure (SHA256 `4b0df56d9582b14af84df2feccf84fdee94d8ff4d0e48fa8d86116d90db129d4`). Exact repro: pass each metadata/fields row to `computeStandardFloatColorTransferLayout(metadata, fields, 4096)` and each literal `hex` row to `decodeStandardFloatImageSubmission`; all return refusal. Original R11G11B10 storage E6-T11d27 is the next ordered S boundary, followed by its original consumer. RGB9E5 and the remaining GLES3 floor remain later independent prerequisites; no production capset or guest graphics authority is granted.


### 2026-10-10 — worker — packed storage verified; original consumer remains gated

D27 is independently verified at `ed846a71801b74986e903f4f029b225df9545134`; the original R11G11B10 owner/storage/transfer/range qualification does not admit sampler/surface packets. The exact-head negative original range1..3 view and mip2 surface still return `unsupported-feature` through `decodeStandardFloatImageSubmission`, recorded in `evidence/virgl-production-readiness/standard-packed-float-consumer-gap.json`. Ordered S prerequisite D28 adds that selected original native packed consumer without modifying storage/compiler or advertising capabilities. Its literal repro is recorded in the D28 task; RGB9E5 and the rest of the pinned Mesa GLES3 floor remain later prerequisites. Production guest graphics remains blocked.

### 2026-10-10 — worker — packed consumer verified; shared-exponent storage gap

D28 is independently verified at `cd59854e79cedf31abe35585bbe1fe616a8fc7ae`. All four literal original125 storage/layout/range/surface negatives are recorded in `evidence/virgl-production-readiness/standard-shared-exponent-gap.json`; its adjacent script reproduces the historical qualified owner and decoder refusals, with zero native allocation. Ordered S/high D29 closes original RGB9E5 storage, GPU range copies and canonical public transfers. Its selected sampler consumer and remaining actual GLES3 floor follow separately. The user request keeps production graphics work ahead of unrelated general queue tasks; no capset, guest acceleration, worker scanout or live production authority is granted by this prerequisite.

### 2026-10-10 — worker — shared-exponent storage verified; original consumer gap

D29 is independently verified at `b76fa7d63703e3cf2a3dfc3b2d7c835c3f3db5e1` with complete original-bit, native GPU transfer, retained generation, caller state, budget and physical failure evidence. Its original125 storage authority does not admit original sampler packets. `evidence/virgl-production-readiness/standard-shared-exponent-consumer-gap.json` pins two original125 range1..3/swizzle views and a mip2 surface; exact repro at the recorded head is `node evidence/virgl-production-readiness/standard-shared-exponent-consumer-gap.mjs`. All three return unsupported-feature. Ordered S/high D30 qualifies the selected original125 sampler consumer while leaving125 surfaces closed. Remaining actual GLES3 floors, typed capsets, real guest rendering and worker scanout remain successors. The explicit request keeps this production graphics chain ahead of unrelated general queue entries; it does not grant any unproven capability.

### 2026-10-10 — worker — RGB9E5 consumer verified; integer storage remains

D30 is independently verified at `131f7ec39a56b747e4107f9b2e5077e8215434f0`,
with native original sampling, retained generations, full hot/cold seals and all130
nested coverage partitions held. The24 original UINT/SINT image formats177..200
still refuse before allocation through the shared-exponent storage profile. Exact
repro at that head: `node evidence/virgl-production-readiness/standard-integer-image-gap.mjs`.
The adjacent JSON records144 complete base/mip/render/sampler/combined metadata
refusals and pins unchanged source and original enums. Ordered S/high D31 qualifies
only original integer storage/transfer/range representation. Original typed sampler/
output compiler and retained command consumer follow separately. Full API/capsets,
actual RISC-V guest Mesa/compositor and production worker scanout/live deployment
remain successors under the explicit instruction to finish production guest graphics.

### 2026-10-10 — worker — integer storage verified; compiler boundary

D31 is independently verified at `d8d510a689cfb5440cc8b3b65fd94adb9baee109`
and published on existing open PR509. The generated compiler still rejects22
original signed/unsigned sampler texts in the adjacent
`standard-integer-image-shader-gap.json` negative record. Reproduce by running
its standalone script at that source head; complete original texts and actual
C/Wasm/source hashes are retained. Ordered S/high D32 implements this one
selected compiler boundary: native integer samplers/raw sampled words and
host format-selected fragment output types. Original packet consumption, the
remaining GLES3/API/capset floors, actual guest bring-up and worker/scanout/demo
deployment remain gated. Production guest graphics and 300 MIPS are not claimed.

### 2026-10-10 — worker — integer compiler verified; original consumer gap

D32 is independently verified and published on the existing PR510 at
c64c3325c15d8978f455d57fc103559eec1b9d20. At that exact head run
`node evidence/virgl-production-readiness/standard-integer-image-consumer-gap.mjs`.
Authenticated sealed compilation admits24 original stage/pair programs, but the
FLOAT-only consumer contract refuses them and all48 original integer view/surface
packets refuse. Complete texts, actual compiler bodies, wire bytes and hashes are
recorded in the adjacent JSON. Ordered S/high D33 composes the owned contract,
retained images and async native draws into one selected single-color consumer.
Production capability floors, actual guest Mesa/compositor, worker/scanout/demo
and throughput acceptance remain successors; this gap is no guest authority.

### 2026-10-10 — worker — integer consumer verified; multiple attachments remain

D33 is independently verified at1206a5beb3026de10457cd395d249daf8aff9966
and published to existing open PR511. At that exact head run
`node evidence/virgl-production-readiness/standard-multiple-color-gap.mjs`.
Both complete seals authenticate161233 members. Six original framebuffer/clear
packets and twelve original actual-compiler metadata/pair contracts refuse;
the compiler already admits six corresponding explicit/sparse/broadcast programs.
Ordered S/high D34 qualifies one native multiple-color framebuffer transaction,
including per-target types, masks, blending and retained native completion.
Remaining original API/format/capacity floors, typed capsets, actual guest Mesa/
compositor and worker/scanout/demo deployment stay gated under the user's explicit
production graphics objective. Production graphics and 300 MIPS remain unproven.

### 2026-10-11 — worker — multiple attachments verified; packed normalized storage

D34 is independently verified at `b57c3ae04e0bd306e6bb5877ff94c5d8f4d6df06`
and published on existing open PR512. The exact-head command
`node evidence/virgl-production-readiness/standard-packed-normalized-image-gap.mjs`
records 78 original metadata/layout refusals for 13 packed UNORM formats, with
zero native allocations. The adjacent JSON retains every input and source hash.
Ordered S/high D35 preserves those original words through native packed storage,
transfers, mip levels and retained GPU range copies. Its original command consumer,
remaining actual API/capacity floors, truthful capsets, guest Mesa/compositor and
worker/scanout/demo deployment follow separately. The explicit user instruction
continues this production graphics chain ahead of unrelated queue work. No
production graphics or throughput authority follows from these prerequisites.

### 2026-10-11 — worker — packed storage verified; original consumers remain

D35 is independently verified at `3e5e41429aadc9acbe68fade926d2763d1e2a356`
and published on existing open PR513. At that exact head,
`node evidence/virgl-production-readiness/standard-packed-normalized-consumer-gap.mjs`
records 39 complete original base/mip/swizzled sampler and mip-surface refusals
for the thirteen now-qualified packed normalized formats. The adjacent JSON
retains original wire bytes, metadata and source/pin digests. Ordered S/high D36
admits them through a separately selected original multiple-color command
consumer while preserving compiler and qualified storage bytes. The user's
production graphics objective continues ahead of unrelated queue work; actual
API/capacity floors, truthful capsets and real guest/compositor/deployment proof
remain gated. No production or throughput authority follows from private tests.

### 2026-10-11 — worker — packed UNORM consumer verified; packed UINT storage gap

E6-T11d36 is independently verified at
`ec96d7544bb86c9defda0b7abc60e447a0a634b9`. The next pinned resource probe is
`node evidence/virgl-production-readiness/standard-packed-unsigned-image-gap.mjs`.
Its committed complete record binds twelve original B10G10R10A2_UINT=225 and
R10G10B10A2_UINT=253 metadata/transfer refusals to that head and source digests,
with zero allocations. Selected storage and layout return unsupported-resource.
E6-T11d37 qualifies that four-byte storage/sixteen-byte native read boundary;
consumer admission is a subsequent ordered prerequisite. The present refusal
does not authorize any positive production capability or guest execution.

### 2026-10-11 — worker — packed UINT storage verified; original consumer gap

E6-T11d37 is independently verified at
`f9f479c20d37d89d0d6da18675777a4a8fd7a7b9`. The existing original command
consumer still refuses both packed UINT sampler aliases and mip color surfaces.
Reproduce the six complete pinned refusals with
`node evidence/virgl-production-readiness/standard-packed-unsigned-consumer-gap.mjs`.
Ordered S prerequisite E6-T11d38 qualifies that selected consumer boundary while
holding the compiler and D37 storage unchanged. Typed production capabilities,
complete API, actual guest Mesa/desktop offload and demo deployment remain gated.


### 2026-10-11 — worker — packed UINT consumer verified; floating-depth storage

D38 is independently verified at `d79868fbfbb70ef215de0eaeee34cf3bee70a008`
and published on the existing open PR516. The exact-head command
`node evidence/virgl-production-readiness/standard-floating-depth-image-gap.mjs`
records 24 complete original 18/126 depth/sampler/combined, base/mip and upload/read
layout refusals. Its adjacent JSON binds each full input and resource source
closure. Pinned Mesa26.2.2 requires both formats for ARB_depth_buffer_float in its
GLES3.0 floor. Ordered S/high D39 qualifies one selected native floating-depth
storage/transfer/range boundary; native consumer/shadow/API/capset and actual
guest Mesa/compositor/worker/scanout/demo deployment remain successors. The
user's production graphics request continues this chain. No guest or 300 MIPS
claim follows from these isolated prerequisites.

### 2026-10-11 — worker — floating depth storage verified; command refusal

D39 is independently verified at
`50b98a3ab6652e9d23f3eaac5eb1095023f9898d`. The original source-pinned six-packet
probe `evidence/virgl-production-readiness/standard-floating-depth-consumer-gap.json`
still refuses formats18/126 at base/private mip sampler views and nonzero depth
surfaces through D38's unchanged selected command profile. Reproduce with the
adjacent `.mjs` command. Ordered S prerequisite E6-T11d40 connects that one
original packet-to-native consumer boundary. Storage and actual C/Wasm remain
held; default caps, complete API, guest graphics and throughput await their
real acceptance. The explicit user instruction continues this graphics chain.

### 2026-10-11 — worker — desktop linear depth sampling remains unqualified

D40 hardware self-validation and whole GLES3.0.6 section3.8.13 (PDF174 /
printed161) show native non-comparison depth samples cannot use linear filters.
D40 explicitly refuses those original sampler states before private copy/draw.
Production must qualify desktop linear depth semantics in a shader/storage
boundary before claiming the API floor; native zero samples are not acceptance.


### 2026-10-11 — worker — floating depth consumer verified; original UN16 gap

D40 is independently verified at
`d64b2f5e782fee2090f7a0f435bdb0ea7a0a1081` and remains on existing open PR518.
The original source-pinned `standard-unorm-depth-image-gap.json` records thirteen
storage/view/mip-surface refusals for original Z16_UNORM=16, while three legacy
base-depth admissions remain held. Reproduce with its adjacent `.mjs` command.
Ordered S/high E6-T11d41 qualifies this one UN16 storage/transfer/view/surface
path through an opt-in factory and unchanged compiler/GPU helpers. Parent
full API, shadow/stencil/linear semantics, actual guest/compositor, caps,
worker/scanout/demo deployment and measured throughput remain unproven.

### 2026-10-11 — worker — UN16 verified; packed UN24 storage gap

D41 is independently verified at `c34b00e91f6e84501f0eff731a74857a10eb4250`
and published on existing open PR519. Every verifier lease is released. At that
verified head, the complete original packed-depth readiness recording has24
layout and6 sampler/surface refusals for original20/21. Reproduce with
`node evidence/virgl-production-readiness/standard-packed-depth-image-gap.mjs`
at that head. Ordered S/high E6-T11d42 closes the storage/transfer/native-range
boundary; the guest consumer remains a separate successor. Full API, shadow/
stencil/desktop-linear semantics, capacities/caps and actual guest/compositor/
worker/scanout/demo production offload and 300 MIPS remain unproven.

### 2026-10-11 — worker — packed UN24 storage verified; original consumer gap

D42 is independently verified at `c60bf20abcd42c1c10fb1863c2666a344d5c8e70` and remains on existing open PR520. Its fresh critic released every lease. Exact-head `node evidence/virgl-production-readiness/standard-packed-depth-consumer-gap.mjs` records six complete original20/21 view/mip-depth-surface refusals and24 held qualified storage layouts. The adjacent JSON retains all original inputs/wires and runtime/primary/generated identities. Ordered S/high E6-T11d43 connects this one selected original command consumer while preserving the verified storage and actual compiler. Full API, shadow/stencil/desktop-linear semantics, capacities/caps and actual guest/compositor/worker/scanout/demo production offload and 300 MIPS remain unproven. The existing native stack 500 and every prior PR remain intact under the user's continuing production graphics request.

### 2026-10-11 — worker — packed consumers verified; native stencil prerequisite

D43 is independently verified at `5a0d9fc9655f1e0956154763bda420aec721865a` and published on the existing open PR521. The original selected decoder still rejects the ten complete DSA/CLEAR bodies in `evidence/virgl-production-readiness/standard-stencil-consumer-gap.json` (SHA256 `c97ec6894299fe104b6b6bb06bb206ebd490c5846b1ff2aca1692db98b1dcbd9`). Run its adjacent recorder at that verified predecessor to reproduce. Legal original references and 20/126 views/surfaces already admit. The actual native M4 Metal precheck confirms WebGL's enabled-S8 common-reference/value-mask/write-mask restriction while disabled/asymmetric and absent-S8 draws remain legal.

Ordered S/high task E6-T11d44 closes native original S8 state/clear execution with common effective per-face masks/references. Unsupported asymmetric active-S8 draws are refused before draw and require later ordered native translation; the full original stencil/API floor is not yet qualified. The user's production-graphics instruction continues this boundary. Native stack 500 is continued; all 121 earlier PR identities/order/heads/bases remain preserved and open. Actual guest Mesa initialization, full API/caps, worker/scanout/demo/deployment and 300 MIPS remain unproven.


### 2026-10-11 — worker — native stencil verified; original ordered face translation remains

D44 is independently verified at `ff80836249c9f235cae516421498a574b51b6f9c` and published in existing open PR522. Its fresh critic holds all14 criteria, including complete original native state/clear, active asymmetry refusals, live absent-S8 attachment switches, three fresh lifetime schedules, full custody/coverage and real second-fence S8 sabotage. The runtime remains exactde; all leases are explicitly released.

The actual original asymmetric20/126 draws still fail at DRAW byteOffset40 before native draw/blit. Exact original repro before source changes is `node evidence/virgl-production-readiness/standard-ordered-stencil-gap.mjs`; the adjacent JSON binds six full original packet refusals, all510 original source bodies and the completely reopened938-member native recording at the exact verifiedff head. Original refs/value/write masks need ordered face selection to bypass the real WebGL restriction without changing guest output. S/high D45 provides one native face-selection/primitive-order boundary; split-call original INSTANCEID remains a later prerequisite. Common/inactive/absent paths stay held. The explicit user instruction continues production guest graphics. Existing upper native stack500 is continued; no previous PR was recreated or merged. Complete production API/caps, actual Mesa/compositor, worker/scanout/demo/deployment and300 MIPS remain unproven.

### 2026-10-11 — worker — ordered stencil verified; instance-ID compiler gap

D45 is independently verified at `2a55ba679abda640781b854d83726d35fca1d98d`.
Its unculled asymmetric-S8 triangles retain original primitive order, but
original instance counts above one remain explicitly refused. The exact-head
actual C/Wasm response in
`evidence/virgl-production-readiness/standard-instance-base-gap.json` confirms
that the existing original INSTANCEID source maps directly to native
`gl_InstanceID`, without any host-owned offset. A split native call therefore
cannot preserve a later original guest instance ID. The adjacent script
reproduces the original full pair and pins source/generated identities; it
claims no native or guest draw. Pinned GLES3.0.6 sections2.9.3/2.11.9 and
GLSL ES3.00 revision6 section7.1 confirm native instance-major IDs and zero for
ordinary draws.

Ordered S prerequisite E6-T11d46 qualifies a distinct host-offset compiler
facet, preserving every old compiler response and VirglBlock656. A later
consumer task will preserve original instance/divisor fetches and order.
Production negotiation, actual Mesa/compositor execution, worker/display
integration, demo/live deployment and throughput remain later acceptance.
The human request continues this graphics chain; all PRs remain open.


### 2026-10-11 — worker — instance compiler verified; original consumer still gated

D46 is independently verified at a19b49441e932e64446f756cefe0c18e6b5b71b3 and published on open/draft PR524 in unchanged native stack500. All124 previous PR identities/order/heads/bases remain held. The exact-head original metadata probe still records three new-profile consumer refusals and three old-profile admissions. Its adjacent native recording retains both original20/126 asymmetric two-instance refusals before native drawing, in1357 completely reopened members. See the standard-instanced-stencil-consumer-gap and standard-instanced-stencil-native-gap recorders/records under evidence/virgl-production-readiness for full commands and identities. Ordered S/high E6-T11d47 connects this one selected consumer while retaining original instance IDs, divisor phases, primitive order, work/fetch bounds, resource generations and asynchronous cleanup. The explicit human request continues production graphics. Full API/caps, actual guest Mesa/compositor, worker/scanout/demo/deployment and300MIPS remain unproven.

### 2026-10-11 — worker — instanced stencil verified; original shadow sampling gap

D47 is independently verified at41c1aa490d19d8c307ea7bdbb5647acf346681f4.
PR525 preserves both existing native stacks499/500 and every previous PR head,
base, identity and order. The original negative readiness script and full record
`evidence/virgl-production-readiness/standard-shadow-gap.{mjs,json}` reproduce22
compiler refusals and eight comparison-sampler refusals at that exact head;
ordinary shader/sampler controls pass. Complete request/packet/generated/source
identities are retained. No native shadow draw or guest execution was performed.

Ordered S prerequisite E6-T11d48 translates the original floating 2D-shadow
operations and separately owned view controls. Its compiler-only boundary does
not relax the decoder or execute original sampler state. A dependent consumer
qualification follows its fresh independent verdict; complete API/caps, actual
Mesa/compositor, production worker/scanout, demo and measured throughput remain
later gates. The explicit human graphics request continues this ordered chain.

### 2026-10-12 — worker — shadow compiler verified; sampler consumer gap

D48 is verified at `4e924b694715ec40e653e2e0c87ecc49c929d040`; PR526 extends
the existing stack500 with every prior identity/order/head/base preserved. The
actual original shadow stages now compile, but both renderer metadata parses
and all eight original comparison-mode sampler functions refuse. Exact repro:
`node evidence/virgl-production-readiness/standard-shadow-sampler-gap.mjs 4e924b694715ec40e653e2e0c87ecc49c929d040 evidence/virgl-production-readiness/standard-shadow-sampler-gap.json`.
Full bytes/responses and source/generated digests are retained in that record.
Ordered S/high prerequisite D49 fixes the native sampler consumer before this
production gate resumes; no guest/capset/deployment/performance claim is made.

### 2026-10-12 — worker — capacity verified; original control envelope gap

D50 is independently verified at `cf184d42823dd4d0d3640482d9b1379181d364fe`,
and PR528 extends existing stack500. The complete continuity audit preserves
both native stack identities and every128 earlier PR identity/order/head/base;
all129 PRs remain open/draft/unmerged. The new host store does not yet reach
the guest. The exact original native VirtIO packet probe
`evidence/virgl-production-readiness/standard-control-resource-gap.{py,json}`
records BGRA/scanout/shared refusals at compositor267, kmscube97 and
glmark2-es2 276, plus the old16/17 transport quota. Reproduce with
`python3 evidence/virgl-production-readiness/standard-control-resource-gap.py cf184d42823dd4d0d3640482d9b1379181d364fe evidence/virgl-production-readiness/standard-control-resource-gap.json`.
Ordered S/high D51 closes this selected control envelope before bring-up
resumes. It grants no complete API, guest renderer, worker/scanout/demo/live
or300MIPS claim. The human production-graphics instruction remains active.

### 2026-10-12 — worker — control verified; selected submission composition gap

D51 is independently verified at `0660eebf08a1b047109ed4e2e508132b68d103ba`;
PR529 continues the same stack500 with both stack identities and all129 prior
PRs preserved, all130 open/draft/unmerged. Its selected native envelope is not
yet assembled into the host submission bridge. The recorded hardware bridge
probe first refuses packed depth20 at compositor419 and glmark2 428, and still
uses the old16-resource quota; complete input/owner/GL records and runner are
sealed in `evidence/virgl-production-readiness/desktop-submit-bridge-gap/`.
Exact repro was `node /tmp/wasmvm-desktop-bridge-readiness.mjs` at0660eebf, with
manifest `c0e3e61ee34f77e48094fd901c318bb4fd90a1a1e1bc5340b1504e34f54b3eaa`.
Ordered S/high D52 composes the verified control/store/consumer with real Wasm
submission ownership. No complete API, positive capabilities, actual guest
boot, production worker/scanout or300MIPS is claimed.

### 2026-10-12 — worker — submission verified; native buffer-hint gap

D52 is independently verified at59bf446955cc2b78b84d94fcd03cb3f3f4f1c230
and published as open/draft PR530 on the existing stack500. The complete
negative readiness matrix at that head sends identical descriptions through
actual Wasm queues and the qualified hardware host store. Native control
refuses uniform bind64 and combined bind112 before host callbacks/publication;
the host allocates each64-byte original buffer. Full refusal state and GPU
ownership remain unchanged; every allocation is disposed.

The complete68-body recording is sealed in
`evidence/virgl-production-readiness/native-buffer-role-gap/`, manifest
00f3d741c0bee960f4c2839e922325963c80f21d802b7a480288657a6158e8e9.
Its retained runner reproduces the exact0x1205 responses,359 hardware GL calls
and zero browser errors. The same bounded matrix records additional image/mip
admission gaps; no guest DMA, shader draw, Linux boot or production capability
is claimed by this readiness run. Ordered S taskE6-T11d53 closes only original
byte-addressed buffer hints and proves their actual uniform-fed GPU submission.
The human's production graphics instruction continues this graphics chain.

### 2026-10-12 — worker — native buffers verified; native image layout gap

D53 is independently verified at0211566e662a3512b374c69ab915c563e7daf0cc
and published as open/draft PR531 on unchanged native stack500. All131 prior
PR identities/order/heads/bases and both stack identities are preserved.
Exact-head original RGBA8 mip, RG8, RGB8, floating RGBA and Z16 native requests
still refuse0x1205 before callback/allocation while the qualified host allocates
them. Repro and74 complete bodies are sealed in
`evidence/virgl-production-readiness/native-image-layout-gap/`; manifest
1e7cb6037ab84975c5010cc8a81016986de39401178acd9a42c35e6d099bbf25.
Ordered S/high E6-T11d54 connects the one immutable native2D layout/DMA
boundary, preserving original public words, actual GPU costs and historical
profiles. Typed caps/API, actual guest Mesa/Hyprland, production worker/scanout/
deployment and300MIPS remain unproven under the continuing human request.

### 2026-10-12 — worker — native images verified; dimensional storage gap

D54 is independently verified at37a6794437424049d38acb733191a16c1cdca998
and published as open/draft PR532 on unchanged native stack500. All132 prior
PR identities/order/heads/bases and both stack identities remain intact. At
that clean head original RGBA8 volume/cube/array metadata and their six original
vertex/fragment sampling programs still refuse while the2D mip control succeeds.
The100 complete-body readiness recording is sealed in
`evidence/virgl-production-readiness/dimensional-texture-gap/`; exact repro and
hashes are in D55. Ordered S/high E6-T11d55 closes the one original dimensional
storage/DMA boundary for format67; consumers/native layout/caps, actual guest
Mesa/Hyprland, production worker/scanout and throughput remain successors. The
human production graphics instruction continues the same ordered stack.

### 2026-10-12 — worker — dimensional storage verified; native layered DMA gap

D55 is independently verified at98187fdf222f393af27b2307667e10427027ad46,
and open/draft PR533 continues existing stack500. Both stack identities and
all133 previous PR identities/order/heads/bases remain held; all134 stay open,
draft and unmerged. The exact-head actual Wasm/hardware readiness probe now
admits every D55 host chain, while native metadata and the selected submission
consumer still reject all three dimensional original transfers. The99-body
complete recording and full API continuity are in
`evidence/virgl-production-readiness/native-dimensional-transport-gap/`;
exact repro/digests are in D56. Ordered S/high D56 closes this one original
native allocation and layered DMA boundary. Dimensional shader/surface consumers,
full API/caps, actual guest Mesa/Hyprland, production worker/scanout and300MIPS
remain unproven under the continuing human request.

### 2026-10-12 — worker — native layered DMA verified; dimensional compiler remains gated

D56 is independently verified at48b2ba0c7ee90d13093f7782e5a2502e44095753
and continues as open draftPR534 in existing stack500. Exact-head repro
`node /tmp/wasmvm-dimensional-texture-readiness.mjs` records108original
dimensional shader refusals across all six historical facets and six2D
positive controls. The complete runner/source/module/response recording is
sealed in`evidence/virgl-production-readiness/dimensional-texture-compiler-gap/`
(manifestSHA256`4fa23f26ae6816805cd9352cb672666ac56710a47358f7db86c920dad7ab32e1`).
D57 owns this next atomic compiler boundary. Native storage/DMA proof does
not authorize dimensional shader consumers, capsets or production Mesa; the
parent remains blocked until the named compiler boundary and subsequent actual
consumer/API/production qualifications are independently proven.

### 2026-10-12 — worker — dimensional compiler verified; view consumer remains gated

D57 is independently verified at `deb7b3113f9adeb2e6e80449a6710dd3295093ea`
and continues existing stack500 as open/draft PR535 above PR534. All135 earlier
PR identities, heads, bases, order and both stack identities remain unchanged;
no merge or restart occurred. The actual selected compiler passes54 original
dimensional cases while the existing consumer rejects all54 metadata records
and19 decoder entrypoints reject57 original dimensional view packets. All25
ordinary2D controls pass. Exact clean-head reproduction:

```sh
node /tmp/wasmvm-dimensional-view-readiness.mjs /tmp/wasmvm-dimensional-view-gap-deb7b311-final
```

The complete84-body source/input/output/primary/stack-custody seal is
`evidence/virgl-production-readiness/dimensional-sampler-view-gap/`, manifest
`b76764f40ad62136a835869e1adb88650ae58f8b6a56ce0284c42b8ff9f8c530`,
index `8a0f3e965d6fc8a515c2fb289c7b7e88cfcefc163b0ca2fe7225890e841351bf`,
archive `f087447c3ff9b16638724faffe0cf83c7a6f2979c37775e092f5fec2f2d6543a`.
Ordered S/high E6-T11d58 qualifies selected RGBA8 dimensional sampler views
and actual draws. Compiler-only Metal fixtures grant no production guest
acceleration or positive capsets; this parent remains blocked.

### 2026-10-12 — worker — dimensional views verified; original depth storage gap

D58 is independently verified at `fa4692ab33c0bd91e4d2cedddc8003df29354108`
and published as PR536 on the same native stack500. At that exact clean head,
30 original cube/array depth allocations refuse in both the actual Wasm control
owner (response0x1205 before callback) and the independent host owner; all15
2D depth controls and3 RGBA8 dimensional controls allocate and retire. The
pure public-layout probe records60 dimensional depth refusals over both
directions and30 qualified2D depth positives. Exact commands, source/native
Wasm, full GL/guest/ownership records and142 authenticated bodies are in
`evidence/virgl-production-readiness/dimensional-depth-gap/` and D59s log.
The original Mesa GLES3 depth-cube promise still lacks executable storage/DMA.
Ordered S task D59 couples that one original allocation/span/transfer contract
across native and host owners; it grants no sampler or production authority.
Real guest bring-up remains gated rather than over-advertising this API.

### 2026-10-12 — worker — depth storage verified; retained consumer still closed

D59 is independently verified atbc2fb1e4, published as open/draft PR537, and
its default/live demo remains127/0 and partial. The original selected Wasm
queue now allocates cube/array depth owners, but original object6 views for
all five formats and sampler roles8/9 still return0x1205:20 recorded cases.
All10 matching2D depth and3 dimensional RGBA8 controls pass and retire; every
owner/budget and complete original packet/source/guest/GPU body is retained.
Repro is the exact verified-head command in E6-T11d60's Verification log;
sealed readiness is `evidence/virgl-production-readiness/dimensional-depth-view-gap/`.
This leaves the production parent blocked on the atomic retained consumer D60.
No production capability, actual Linux graphics or measured MIPS follows from
storage-only proof. All137 prior PRs and both native stack identities are held.

### 2026-10-12 — worker — verified dimensional depth views; comparison compiler gap

D60 is independently verified at04ab18042036bf0ab19864bbe38e787dd4aadf48
and published asPR538 abovePR537 in the unchanged native stack500. At that
exact clean head, the actual D57 compiler refuses16 original cube/array
comparison TEX/TXQ programs in both stages while six existing controls pass.
Exact repro:
`node /tmp/wasmvm-dimensional-shadow-readiness.mjs 04ab18042036bf0ab19864bbe38e787dd4aadf48 /tmp/wasmvm-dimensional-shadow-gap-04ab1804`.
Whole inputs/responses, source/module pins and append-only publication custody
are sealed in`evidence/virgl-production-readiness/dimensional-shadow-compiler-gap/`
(manifest`b4e2f002125e4420a3d1497069d35b9ce0d46238bb90e0cfca4f2c2601ff9adb`).
E6-T11d61 is the ordered S compiler boundary. Later selected comparison
consumers, dimensional surfaces, mandatory transform feedback and coherent
production Linux/control/submit/scanout integration remain independently gated.
No new positive capset, Mesa/Hyprland rendering or MIPS result is inferred.

### 2026-10-12 — worker — comparison compiler verified; selected consumer gap

D61 is independently verified at93021c5a and published as open/draft PR539 in
the unchanged native stack500. The exact-head original Wasm/hardware probe now
admits40 dimensional depth views and ordinary shaders, but all40 D61 comparison
shaders return0x1205 at the strict D60 consumer before native shader allocation.
Complete source/wire/response/native/guest custody and append-only publication
are sealed in `evidence/virgl-production-readiness/dimensional-shadow-consumer-gap/`.
Reproduce with the complete archived `/tmp/wasmvm-d62-readiness.mjs` command in
D62's log at93021c5a28b99357532844de6ea4944291774099. D62 is the ordered S/high
consumer dependency, using the qualified D61/D60/D49 authorities. No production
capability is advertised; actual Linux graphics and throughput remain unproven.

### 2026-10-13 — worker — comparison consumer verified; dimensional color surface gap

D62 is independently verified at `2691b24e6c00478f8d69f81180b6827761de246a`
and published as open/draft PR540 on the same native stack500. All140 older PR
identities/order/heads/bases/states and both stack identities are held. At that
exact clean head, the actual Wasm/Metal readiness run admits13 dimensional
allocations and13 matching2D mip-surface controls, then refuses77 original valid
single-layer dimensional surfaces with0x1205 before dimensional attachment work.
Complete original wire/source/served bodies, native calls, traces/digests and
publication custody are sealed in
`evidence/virgl-production-readiness/dimensional-color-surface-gap/`; exact repro
and digests are in D63's log. D63 closes the single-layer RGBA8 color boundary;
depth dimensional surfaces, transform feedback, honest qualification, production
worker/scanout and actual Mesa/Hyprland boot remain later gates. No production
acceleration or300-MIPS claim follows from the selected comparison consumer.

### 2026-10-13 — worker — color surfaces verified; dimensional depth successor

D63 is independently verified at2aca65e9328aa1433fb516511ca554fdd96b422d
and published as open/draft PR541 in the continued native stack500. Original
RGBA8 single-layer color attachments are proven; production remains disabled.
At that clean verified head, all60 valid cube/array depth surface requests still
refuse before native attachment publication while10 native dimensional storage
and10 matching2D mip-depth controls pass. Original queues, Metal/WebGL2 calls,
traces/digests, source/served bodies and a complete independent wire/ownership
audit are sealed in evidence/virgl-production-readiness/dimensional-depth-surface-gap.
See E6-T11d64 for exact commands and digests. It is the next ordered S boundary.
The explicitly requested reviewed website publication E0-T27 temporarily occupies
the sole active lane; the original instruction to finish guest graphics continues
after it. No capset, complete API, Linux renderer or300-MIPS claim is made.

### 2026-10-13 — worker — dimensional depth verified; original stream output

E6-T11d64 is independently verified at6f43010dfa7b3e08bfe62f62543b7ee0468e1a21
and published as draft PR543 above PR542 in native stack500. Both existing stack
identities and all143 prior PR identities/order/titles/bodies/heads/bases/open-draft
states are unchanged; no PR was merged. The verified partial marker is live at
Cloudflare deployment9724effa-3c8e-42ba-996a-1edf07049acb, with127/0 default tests
and zero browser errors. Its reopened deployment seal is committed.

Six valid original stream-output requests still refuse under the D64 decoder and
resource policy: nonzero original shader outputs, object10 target, opcode25 target
binding, rasterizer discard bit3, nonzero original count override and buffer
role2048. Reproduce with
`node target/evidence/transform-feedback-readiness-fb8c9241/readiness.mjs`
from the recorded readiness source. The complete packets, source pins and results
are recorded; this is JS-only readiness, with no native GPU or guest-queue claim.
The recorded fb8c9241 runtime is byte-identical at the D64 verifier head.

Pinned Mesa26.2.2 serializes four dword strides and two words per original output,
and reports64 separate/interleaved components. STREAM_OUTPUT is original VirGL
bind2048. The pinned virglrenderer1.3.0 source uses nonzero COUNT_FROM_SO directly
as the nonindexed count with start0, rather than as an object handle. Complete
primary source bodies, archive digests and67 matching vendored source pins are
recorded. Ordered S boundaries E6-T11d65 (typed capture compiler) and E6-T11d66
(original targets/native capture) close this API family before positive typed
capability negotiation and actual Mesa/Hyprland worker/scanout bring-up. The
user's explicit four-part request keeps this graphics chain ahead of unrelated
queue entries. No production acceleration or MIPS claim follows from readiness.


### 2026-10-13 — worker — production worker/scanout integration

D66 is independently verified at e092c647b8fad4948e3385d4fdca21c1ee4bc97a.
The user's explicit request continues production graphics ahead of the unrelated
queue entry. All dependencies are verified; this single integration boundary now
owns typed capability negotiation, production worker marshalling and actual guest
initialization/scanout. No new positive production capability is claimed by this
activation. The original native stack is continued above D66; existing PRs stay open.

The local immutable QEMU reference pre-check uses the shipped kernel
3cf8bed0d9a9941a6f2f81b7c8de86cefcba3e4e6bd5e5846bd395714a25642d and original
Omarchy image bfcde69e5eeb2b5baba96a451f0671092b5973e8cc3a7f581722adf513651200.
Pinned Mesa26.2.2 and virglrenderer1.3.0 render kmscube successfully. Its complete
288-event initialization/control log and source/library/package identities are
in target/evidence/production-integration-orientation/qemu-kmscube. This reference
pre-check is comparison data; it does not prove browser production rendering.

### 2026-10-13 — worker — concrete GLES floor gap; integration checkpoint

The independent public-route numeric probe reports `GL_MAX_SAMPLES=1`, below the
GLES 3.0 minimum of four. Exact reproduction: run the pinned binary
`target/evidence/critic-egl-index-03/egl-index` in the actual GPU Omarchy serial
shell after sourcing `/etc/environment.d/60-omarchy-browser.conf`. The transcript
`target/evidence/critic-omarchy-gpu-ui-local07-03/numeric-guest.log` records all 29
limits and `GL_CORE_NUMERIC_FAIL`. This task is blocked on ordered S prerequisite
E6-T11d67, which must add real native multisample storage and resolve before
raising the capability. Existing production integration is checkpointed without
a verified claim. The old four warm boots and the independent dimensional,
shader binding, WFI, and original-command boundary results remain held where
their source and evidence digests are unchanged.

### 2026-10-14 — worker — independently held components; default Omarchy still pending

D67 is independently verified at caccaf2b after its frozen runtime
3bb4ba9b93f19165cf61d4c2cea82f128430e1a6, real multisample/resolve and exact-head
pristine-clone proof. The parent resumed its integration lane; this entry does
not claim full production completion. Runtime integration checkpoints are
deab12b4 (reference-derived framebuffer origin/front-face), c43a7ce3 (coherent
public snapshot write draining and literal rejected-transfer tracing), and
1aa4e465962e119a632cec57768a383ffc411d5a (Quickshell-only GLES client format).

The completed component submission is sealed in
`evidence/virgl-production-bringup/worker/integration-components-and-fast-boots-01.tar.gz`
with SHA256 d6d7cb47a50dcc8280d0832b6a01bb377dc9761fe04a9228d0cd8fc58e54febb;
its paired JSON authenticates 95 files. Original acceptance21 demonstrates
actual Mesa, all29 numeric limits, required multisample formats and actual GL
resolve, a1000-frame kmscube run, Hyprland/Foot and readable upright GPU pixels.
Its guest digest is5a0121bc99fc6617714d737bdb0c7a24389838e07fc83e8318c3de29d155adde.
The archived QEMU comparison holds13 actual initialization/control families
and correctly framed original draws; implicit backing detach at resource-unref
is explicitly bound to pinned QEMU source. This private component run does not
substitute for the full default Omarchy session.

All four original software boot profiles pass initial/repeat launches in
`production-fast-boots-all-fixed-05`: BusyBox2.118/1.025 seconds; Alpine2.079/1.025;
Node Alpine2.066/2.028; Omarchy7.061/6.034. Both Alpine variants also preserve an
actual durable guest marker through public coherent snapshot save/reload. Actual
Node v20.15.1 runs on each launch. A paused public save drains a subsequently
queued guest write rather than bypassing disk/RAM generation coherence; the
recorded original write-in-flight refusal and four independent negative tests
remain preserved. These are gpu=0 software warm claims; accelerated guest boots
still intentionally require cold restart. Default built demo is127 passed/0
failed with zero console errors and no private proof VM/RAM exports.

Fresh adversarial intermediate inspection is sealed separately in
`evidence/virgl-production-bringup/verifier/independent-integration-inspections-01.tar.gz`,
SHA2562dcbf6c70d1d04eba422a62957299adbc9240f10f66a1162ece01b27db3e31f3,
251 files. It holds all12 asymmetric origin/culling cases, all-four warm boots,
public snapshot negative boundaries/sabotage, and the Quickshell client API
selection. Existing native capset/attachment/WFI and D67 results are carried
when their source/dependency/evidence identities are unchanged.

The full Omarchy session remains unproven: its Qt6.11.2 desktop-GL default asks
EGL for renderable-bit8 and gets no config. The app-local public QSurfaceFormat
GLES3 selector instead requests bit64, gets three real configs and non-null
window surfaces. Independent ELF inspection holds original28 dependency order,
RPATH/RUNPATH and unchanged .text/.rodata. However, the original diagnostic
default bar has only two colors and eight host submission failures; the core
also rejects transfer commands. Candidate image12 installs that same narrowly
scoped adapter without LD_PRELOAD. Original-command trace captures and actual
default-session service logs are now required to identify the concrete remaining
failures. No parent/recovery/deployment verified verdict or300-MIPS claim is made.

The owned capture harness now waits for the public guest-ready boundary before
servicing diagnostic serial commands during desktop startup. Command injection
before that boundary could lose the request during kernel boot; this is a
capture orchestration correction. `node --check tools/virgl-production/critic-fast-boots.mjs`
and `node --test tools/virgl-production/critic-fast-boots-protocol.test.mjs` pass.

### 2026-10-14 — verifier — promoted default bar-content acceptance

The fresh verifier authored `critic-fast-boots-bar-content.mjs` and its four
bounded tests. Actual old blank-bar pixels from the sealed diagnostic screenshot
eebbda015d2dcc2e7d4f7ba240e59c53ef2400a8efb0e68719271d626834bd6e are the
authenticated negative fixture: foregroundPixels0, rejected. A cursor-sized
mark and a single horizontal divider also fail; separated literal glyph cells
pass. The helper captures unchanged RGBA and PNG from the same original canvas
frame inside the fresh actual compositor layer, excludes its border and refuses
overlapping visible clients. It demands distributed foreground contrast rather
than merely a positive-alpha mapped rectangle; readable text/icons still require
independent visual inspection. The existing public input proof invokes it after
trusted screensaver wake and confirmed original Foot focus, before typing the
trusted guest marker. `node --check tools/virgl-production/critic-fast-boots-input.mjs`
and `node --test tools/virgl-production/critic-fast-boots-bar-content.test.mjs`
pass. This promotes a proof requirement; actual final populated-bar acceptance
is still pending and no task status changes.

### 2026-10-14 — worker — original Qt indexed-start refusal; ordered S68

Actual installed candidate12 uses the unmodified default SDDM/uwsm/Hyprland/Foot/
Quickshell session at UID1000 and the scoped GLES3 initializer. Its original
production worker completes Mesa/Hyprland draws, but Quickshell submits eight
valid indexed draws with start1/count62/triangle-strip/primitive-restart. The
consumer returns unsupported-draw at state.mjs1627 before each native draw.
The first exact original words are
[786440,1,62,5,1,1,0,0,1,65535,0,4294967295,0], context9, sequence0183,
byteOffset4244: gpu.ndjson request1515/failure1517 in
target/evidence/production-omarchy-gpu-profile12-09. The complete failed streams
are preserved in target/evidence/production-omarchy-original-draw-failures-01.json.
At the original post-failure snapshot, all eight original0x207 requests receive
0x1205 and no0x205 request is rejected; the prior diagnostic transfer failures
are not reproduced by this installed default candidate.

Exact reproducer: CRITIC_FAST_BOOT_WEB_ROOT=web/dist CRITIC_FAST_BOOT_GPU=1
CRITIC_FAST_BOOT_GPU_TRACE=1 CRITIC_FAST_BOOT_GUESTS=omarchy
CRITIC_FAST_BOOT_PERSISTENCE=0 CRITIC_FAST_BOOT_HOLD_FAILURE=1
CRITIC_FAST_BOOT_IMAGE_DIRECTORY=target/virgl-production/image-12
node tools/virgl-production/critic-fast-boots.mjs OUTPUT. Original built runtime
and source hashes are in the capture's report/source records. The first mapped
bar has alpha0 before its real rendering; the capture preserves both that early
input-acceptance refusal and the subsequent eight actual GPU failures.

Pinned VirGL1.3.0 vrend_draw_vbo6139–6157 uses only sub_ctx->ib.offset for indexed
GL calls. DRAW.start is ignored, not multiplied into the byte offset. Ordered
S68 must allow that original production hint while preserving the independently
validated binding offset, count/span, actual fetched indices, private profile
refusals, GPU fences and ownership. Parent remains blocked until S68 is freshly
verified. No capset increase or completed production claim is justified here.

### 2026-10-14 — worker — independent mandatory query gap preserved

The independent actual GLES3 probe also refutes complete API admission: both
mandatory boolean query BEGIN calls return GL_INVALID_ENUM; transform-feedback
query admission has no GL error but its original result resource/commands are
refused. Ordered pending S69 records the separate query/result ownership
boundary after S68; positive numeric/format/source holds remain incremental.
The default-session negative is now sealed with94 original files in
`evidence/virgl-production-readiness/default-omarchy-indexed-and-query-gap/original-negative.tar.gz`,
SHA25602ff956cc3d933cf7dda9c0db44c4cf8d04878d5bae4bd84b78f5d4f8dbdaaaf.
The immutable candidate12 is staged on R2 with image SHA256
f0a72ae2e4433df266fe57dd2443a567dd93396b98c96825b5ce6b3dc4ac9e8c and manifest
87e23271916159e1aaed163df43caeec67cd568c4c7e8843527572412fec2c95:10422 existing
chunks were authenticated and112 were uploaded. The live pointer remains the
earlier candidate; this is artifact staging, not completed deployment.

Later original0x205 failures target texture75,1280x800 RGBA8, bind10, without
any attached backing. Their exact transferWords and resource control state are
preserved for comparison against the native renderer's iovec/bounds contract.
Do not suppress those errors or infer a valid transfer from its box alone. The
initial default bar still lacks proven content; final public input is pending.

### 2026-10-14 — planning — bounded query successors

Pending core-query planning69 is cancelled in favor of ordered69a(boolean
lifetime/result publication) and69b(real logical TF counts). Their exact
independent negative remains recorded; complete API/default Omarchy and final
recovery/deployment remain unclaimed.

### 2026-10-14 — worker — resume final default desktop integration

D69a and D69b are independently verified, including mandatory GLES queries;
D69b verdict commit `dd8cf845` retains frozen runtimeaa451b81. Continue the
existing native PR stack with one final desktop-acceptance layer. Parent scope
now proves original default image12/SDDM/UID1000/Quickshell/Foot startup and
trusted keyboard/cursor through the production worker and scanout. Previous
actual default keyboard, startup-heartbeat and post-query console scanout
budget negatives remain preserved and unclaimed.

First iteration changes only the acceptance harness: wake actual screensaver
before requiring visible bar; prove absent marker and fresh real Foot focus
immediately before trusted physical typing; preserve passive worker/timer
timestamps across fatal cleanup. No watchdog limit or runtime behavior is
weakened. Record the actual default run before choosing any runtime repair.

### 2026-10-14 — worker — default desktop input observed; freeze final readiness proof

At ordinary built head `b0655aba825d6ebbae5369d97c3aa2f70862823c`, the normal
SDDM/UID1000 image12 session initially produced an exactly blank mapped bar.
The first failure happened before any typing and is preserved in
`target/evidence/production-parent-omarchy-default01/public-desktop-input*` and
the fresh critic custody directory `critic-production-parent-default-firstpaint-negative01`.
The later owned retry `control-input-later-bar-trusted-input01` observed readable
bar glyphs/icons (830 contrasting pixels over12 rows), actual mapped/focused
Foot PID673 and trusted physical typing of `touch /tmp/gpukeyboard43touch`.
The marker was absent before typing and serial observation afterward returned
`TRUSTED_TOUCH_43`, exit0. This is supplemental evidence; the initial report
stays failed and the center-position check does not yet prove cursor movement.

The harness now waits up to360 seconds for actual distributed bar content,
preserves every exact probe crop, and fails immediately on invalid geometry
or occlusion. It observes the initial guest cursor, chooses a physically
distinct target and requires both final coordinates and actual displacement.
The local source descriptor stages the already published immutable image12
manifest `87e23271916159e1aaed163df43caeec67cd568c4c7e8843527572412fec2c95`;
the live Pages site remains on its previous descriptor until deployment.
No runtime semantics or watchdog have changed. Syntax checks, all6 existing
bar-content/protocol tests and `make web-dist` passed; outputs are
`target/parent-content-cursor-{checks,build}01.{stdout,stderr}`.
Final parent acceptance and clean-clone proof follow this frozen harness.

### 2026-10-14 — worker — clean-clone asset-resolution negative

`production-parent-cold01/production/fast-boot-images/report.json` refutes
portability of the old test-server resolver: Omarchy failed before restore
because the ignored198380324-byte boot snapshot was requested at its retired
legacy R2 URL (404). The published exact object is at
`sha256/0c34dc9389c52af167ed8e5f9e34c543b58c91205fc6b4e383bc3b0711ead256/releases/boot-snapshot/omarchy-ready.snap.gz`
(HTTP200 and matching extent observed by HEAD). Local cached fast-boot success
is insufficient for this portability claim. The resolver now tries the same
content-addressed R2 key used by deployment, falling back to the legacy key
only after404 for older small assets. Every returned release still must match
its original manifest size/SHA256. Each attempted URL/status and successful
byte digest is recorded; host harness hashes and current head are also explicit.
Cursor diagnostics now use the existing `window.__cursor.state()` API.
Syntax checks and all6 affected harness tests passed, outputs
`target/parent-r2-portability-checks01.{stdout,stderr}`. Runtime/image/dist bytes
are unchanged; the ongoing old-head actual Mesa/cube/compositor run is component
evidence, never relabelled. Record the repaired server in a new final cold clone
(the failed first clone is retained as the portability negative).

### 2026-10-14 — worker — preserve unexplained final transport rejection

The old-head full parent run reached actual VirGL-only Mesa,768 checked
textured pixels,1000 cube frames (6006 draws,2017 completions,1007 presents,
49301ms wall), Hyprland IPC and mapped Foot client, with zero failed GPU jobs
and no browser errors. It then failed the blanket assertion that every guest
transport response is below0x1200. `production-parent-frozen01/guest/failure.json`
and its original GPU/serial logs are preserved. This is not a passed run.
The prior unbacked-transfer finding is not assumed to explain this rejection.
The harness now persists the original final transport records, Hyprland output
and display screenshot before unchanged assertions. An explicitly labelled
diagnostic copy is installed into the running cold02 clone before its actual
guest phase; `supplemental-final-record-harness.json` records both source hashes
and disclaims pristine final acceptance. No error is whitelisted or suppressed.
`node --check tools/virgl-production/acceptance.mjs` passed.

### 2026-10-14 — worker — block on original fragmented-backing boundary

Fresh critic `critic-production-parent-sg-original-01` records256 valid tiny
nonoverlapping original backing entries accepted and physically round-tripped,
while257/420 entries receive0x1205 before host attachment despite known-valid
RAM addresses, lengths and padding and only1028/1680 total bytes. Exact repro:
`node target/evidence/critic-production-parent-sg-novel01/browser.mjs --output target/evidence/critic-production-parent-sg-original-repro --schedules 271828`.
The257 row is `run-0001.json.gz`, SHA256
c15566452a6171a3cd8734ac94c18974827be24b606d3b33dafdec972f0c8ebc;420 row
`run-0002.json.gz`, SHA2565b250f996a411fa64ea53a153a4c91ba62bce2e4bf7be5294e96cc697749d9a1.
Production32MiB byte capacity still inherits the historical256-entry guard in
both Rust and JS. The pinned native QEMU mapping ceiling is16384. Ordered
S/high E6-T11d70 closes this one original bounded attachment boundary and must
be independently verified before final bring-up resumes. Old frozen/cold/public
captures retain their original assets and identities; no rejection whitelist
and no production completion or deployment claim is made.

### 2026-10-14 — worker — resume after independently verified fragmented backing

D70 is independently verified at `3c4e653b7c9c6525765949eadbe06c34181f8121`
with original native/physical SG bytes, complete guarded GPU roundtrips, private
ceilings, separate-descriptor malformed-tail recovery, negative control and
final pristine clone. Resume the parent on its new verified production runtime.
The old default image12 capture now confirms sequence789 ATTACH_BACKING
resource45/424 entries returned0x1205 while all19 recorded bar crops were blank.
Its kernel error interrupted the monitors JSON response before typing; no
error filtering or parser workaround is introduced. Old cold02 confirms
resource55/358-entry rejection followed by rejected transfer, while all10
software warm phases and the exact198380324-byte immutable R2 snapshot download
passed. The original parent failure runs are sealed at
`target/evidence/production-parent-backing-negatives01/parent-original-backing-and-portability-negatives.tar.gz`,
8005532 bytes,240 members,SHA256
5e34795511002143829f202d0ade9823db29ae887454d32b61d54b5bec3a7b0c.
Final new-runtime parent and clean-clone acceptance follow; earlier component
holds survive only within their unchanged boundaries.

### 2026-10-14 — worker — post-fragmented-backing proof and keyboard prerequisite

Frozen runtime `5943a2df2e0e0d55290843fd1e89e5cdefe5fecf` passed all twelve
commands in `VIRGL_PRODUCTION_EVIDENCE_DIR=target/evidence/production-parent-frozen02
make verify-E6-T11d`. Actual guest Mesa/cube/Hyprland produced a complete original
command stream with 5021 successful core responses, correctly framed to the end.
All ten software fast-boot/repeat/persistence phases passed. The stock public
UID1000 desktop produced a readable package bar, actual Foot command typed by
sixty trusted events, and cursor movement. Its normal `gpuTrace=false` capture
proves visible rendering and input; transport-wide error freedom is claimed only
for the separately recorded actual-guest component. The brief hot debugger sample
is diagnostic, so the hot run does not substantiate a clean timing claim.

The untouched pristine command `python3 tools/virgl-production/cold.py --task
E6-T11d --output target/evidence/production-parent-cold03` passed preceding gates,
all software images, actual guest rendering and handshake. Its stock input check
failed: original sixty balanced DOM transitions and corresponding Linux evdev
frames spell `touch /tmp/gpukeyboard42touch`, but the final canvas shows
`touchhhhhhhh` and the guest marker remains absent. Exact failed screenshot
SHA256 `7d61ac2d511113e8c4654a4eea528e4bf57a5b98321439e85c2a0583c4032842`;
`public-desktop/public-desktop-input.json` records all twenty unsuccessful marker
reads. Fresh critic reproduced a related original held-key WFI gap with
`cargo test -p wasm-vm-core --features virgl-renderer,trace --test
production_keyboard_wfi_critic -- --nocapture`: one traced WFI jumps mtime0 to
500000 or5000000000 despite an original delivered H with no release. Both cache
modes reproduce. This identifies a clock boundary to repair, without claiming it
is the exclusive cause of the desktop repetition. Ordered S/high E6-T11d71 must
be independently verified before parent acceptance resumes.

Durable worker artifact
`evidence/virgl-production-bringup/worker/post-fragmented-backing-positive-and-clean-input-negative-02.tar.gz`
contains 327 original files plus its receipt, all reopened: 10582011 bytes,
SHA256 `1cc9f51f83fa84d30f2373130c6f49bf585d56f2e92fe6d7ab19f7f728a044b5`.
It also preserves the Cloudflare attempt: exact public artifact byte checks passed,
but Pages rejected the currently signed-in account. The user is switching Wrangler
back to the existing project account. No successful deployment or final parent
verification is claimed. Evidence-only live harness heads `6549a30b`/`ed63d292`
retain identical runtime and original artifact pins while adding actual HTTPS
body capture. Parent is blocked on the keyboard prerequisite; deployment remains
an additional acceptance requirement.

### 2026-10-15 — worker — resume final publishing after clock verification

The ordered keyboard and pacing prerequisites now have independent verdicts.
The final D72 worker/verifier archives carry actual production Mesa,1000 cube
frames, Hyprland/Foot scanout, original stock keyboard/bar/cursor and all four
software image fast-boot proofs at the unchanged ordinary d055 Wasm boundary.
D71 closure and D73 preserve native wait/idle predictions and controls. Parent
resumes for current marketing/docs/roadmap copy, deployable bundle and actual
Cloudflare publication/source/default/site/software checks. Native/rendering
and successful long-boot components carry by explicit code/dependency/digest
equivalence; failed historical wrappers remain failed. Context-loss recovery
remains E6-T11e and no300MIPS claim is introduced.

### 2026-10-15 — worker — published source, default boot follow-up

Cloudflare uploaded committedf0357748 successfully (deployment6f079192).
Declared narrow ledger supersession accounts for seven changed dist assets;
Bash exit0 and preupload/after inventory equality are recorded in
`target/evidence/production-parent-final-publishing03`. The old deployment13
outer wrapper remains failed at its stricter artifact-only postcondition.
Local03 docs/default127/0/site checks pass. First HTTPS default127/0 holds but
its recorder rejects Cloudflare's legitimate308 .html canonicalization; the
paused actual HTTPS GPU worker qualifies/JIT-attaches at0 retired but its
recording also assumed localrequire-corp rather than shippedcredentialless.
Preserved raw failures are not product passes; narrow recorder corrections
retain exact bodies/redirect destinations and the permitted favicon404.

The user reports that production Omarchy does not fast-boot. Exact current
repro: `/app?guest=omarchy&desktop=1#ide` omitsgpu, selectsGPU/cold boot in
main.js1983. The paired warm snapshot belongs tosoftwaregraphics. Ordered
S/mediumD74 makes the existing warm route default while preserving explicit
GPU selection. Parent publication waits for that independent verdict.

### 2026-10-15 — worker — retain accelerated default; implement real warm restore

The user clarified that GPU rendering must remain enabled for warm boots.
The unshipped software-default proposal is cancelled, with ordered native/host/
worker/public warm-checkpoint slices74a–d. Parent publication now waits for
74d; earlier rendering and source-delivery evidence is unchanged.


### 2026-10-15 — worker — resume final production closure after verified warm publication

E6-T11d74d is independently verified at
`2f16a7553bb721e770830f27b13984f3b577be49`. Resume the parent solely to close
its accumulated rendering/negotiation/production evidence. The runtime, image,
clock and public pair stay frozen. Under the incremental rule, unchanged
capability ABI, actual Mesa/no-software rendering and1000-frame/cube holds carry;
verified fragmented backing, timekeeping, production worker ownership, scanout,
capacity and warm-publication successors cover their changed boundaries. This
closure does not claim full Omarchy application coverage or failure survival;
the user has separately requested Chromium, LibreOffice and the compatible
upstream application set, and E6-T11e remains a separate ordered boundary.

Continue the same native stack above PR568 on
`codex/production-guest-gpu-closure`; no stack is replaced or PR merged.


### 2026-10-15 — worker — source-bound production parent closure submitted

Metadata source `423edd8c084f969f5171af93b683dbd1534f2fa8`; no runtime,
artifact or browser behavior changes. Closure capsule
`evidence/virgl-production-final-closure/worker/closure.tar.gz` is2313686bytes,
SHA256 `9b92e4b8a7d1471f92ec575654835e647a499a72111df36bf672db624d6591df`;
`records.json` SHA256
`8f7ae10758c136ff60e1d61a3931fbd4802816ea30a35213e5c82146418fe6a1`.
All25members were reopened/rehash checked. Exact read-only command
`python3 evidence/virgl-production-final-closure/worker/authenticate.py`
passes25member hashes, all38inherited file/manifest references without dropping
a reference, and current critical source bodies. Task/status changes are the
only implementation difference; the helper authenticates the composed claim.

The prepared map is the fresh critic's original13604-byte metadata record, SHA256
`0b8c766bb4755c0e7a70d549e8b04a49b079d0b680a6da527972d608dae00045`.
Its observed1a172cf3head is retained, not relabelled current. It maps unchanged
capability serializer SHA256
`4c05de5b32c0482ba3135967a067959d0f4c890767c64679531704fbceef2244`,
independent fixed caps oracle
`5d6843966a88cc394213808779f9daaadbab19ef7fe07b7d94c45368afc6cd3b`,
and decoder
`804134a7ba9a52c7335ec3ff14e5ac2a55a09307ed833e2c7266268ae7a704e2`
to the unchanged D72/e17 boundary. Changed worker/RAM/loader/journal/renderer/
capacity behavior is covered by verified successors, never by blanket equality.

The durable original D72 component is
`evidence/virgl-production-interactive-clock/worker/paced-keyboard-policy-submission.tar.gz`,
SHA256 `01f6feaca7b0079b0a4dfa83fc4bdfeb757ca8b258af26c9bd8882273374a37d`;
internal prefix `production-paced-policy-private-window04/`. It binds actual
Mesa26.2.2 GLES3 VirGL,768literal pixels,1000cube frames,13handshake families,
Hyprland/Foot and no software DRI. Original full GPU log SHA256
`a5aafe364806b475cbb7c437a31c26c6ef0e58ebe0d0b14b7672994645f2d6df`
contains31516DRAWs and1347fenced submits. The earlier cube-state point has
31192draws+1pending and is not described as drained. Guest digest is
`d27ddf4d5d4b6e6007ed6836750fbbaf31500d87a74f7747bd8431f83fe1faaa`.
Original report, acceptance, Mesa probe, cube state, full trace, QEMU/reference
handshake comparison and exact hashes remain in that published archive/map.

The independent capability-byte negative control is embedded verbatim under
`independent-capability-negative/` in this closure capsule. Its original sealed
archive is2005109bytes, SHA256
`ff5bc0b9f9f4bd0d68f96dd2e4bb860d446dca863b462fe3bcb4ea78dd9893e4`;
receipt SHA256
`d247387f1a137efa279b3f7de923daf5f0a47c320670eb3903ddaaaf8e7bdaf6`.
Healthy exits0; changing actual cap byte284 to3 contradicts independent oracle4
and exits101. This is the critic's test/evidence, not a worker-generated oracle.

Verified successors: D72 `8c902c70`, D73 `7e2739f2`,74c `baf3d103`,
74d1 `612b1b7b`,74d2 `3027442a`,74d `2f16a755`. Their task logs,
worker/verifier archives and digest manifests are bound in the capsule. The
final847full-pristine high-risk gauntlet and actual HTTPS923 GPU initial/repeat,
ten software fast-boot/persistence phases,127/0 and unified-site db04 recorder
closure are held by the fresh74d verdict. Runtime main/loader remain exactly847.
Production Pagesb320083f uses originalpair2aa173104561bytes/worker06622;
rawimagef0a72 and manifest87e232 identify distinct authenticated objects.

Claim: qualified, truthfully advertised production VirGL initializes real guest
Mesa/Hyprland and renders through the production worker/physical scanout, including
useful GPU warm restoration. No new runtime boundary changed, so the repository's
incremental rule carries unchanged high-risk/pristine/cube holds. Failed original
wrappers remain failed and their narrowly missing proofs are explicitly mapped.
This does not claim300MIPS, arbitrary host support, complete Omarchy applications
or recovery/context-loss survival. E6-T11e and the user's explicit Chromium/
LibreOffice/full-compatible-application image remain separate work. Fresh
`production_boundary_critic` receives this exact capsule/diff and owns the verdict.
