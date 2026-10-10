---
id: E6-T11d
epic: 6
title: Advertise proven VirGL capabilities and initialize real guest Mesa
priority: 525.02704
status: blocked
depends_on: [E6-T12i, E6-T11d1, E6-T11d2, E6-T11d3, E6-T11d4, E6-T11d5, E6-T11d6, E6-T11d7]
blocked_on: E6-T11d7
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
