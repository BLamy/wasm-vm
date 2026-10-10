---
id: E6-T11d
epic: 6
title: Advertise proven VirGL capabilities and initialize real guest Mesa
priority: 525.02704
status: blocked
depends_on: [E6-T12i, E6-T11d1, E6-T11d2, E6-T11d3, E6-T11d4, E6-T11d5, E6-T11d6, E6-T11d7, E6-T11d8, E6-T11d9, E6-T11d10, E6-T11d11, E6-T11d12, E6-T11d13, E6-T11d14, E6-T11d15, E6-T11d16, E6-T11d17, E6-T11d18, E6-T11d19]
blocked_on: E6-T11d19
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
