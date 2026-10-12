---
id: E6-T11d57
epic: 6
title: Compile original volume, cube and array texture shaders for native GLES3
priority: 525.027039000396
status: in-progress
depends_on: [E6-T11d56, E6-T11d48, E6-T11d49]
estimate: S
risk: high
capstone: false
---

## Boundary

One host-selected C/Wasm shader compiler facet for original TGSI 3D, CUBE
and2D_ARRAY homogeneous FLOAT/SINT/UINT sampler views. Preserve original
text/tokens, stage/slot identities, source words/modifiers, result write masks,
qualifiers and separately owned query metadata. Admit TEX, TXL, TXD,
fragment TXB, volume/array TXF, volume TXP and dimensional TXQ. Cube TXF,
cube/array TXP, vertex TXB, dimensional shadows/cube arrays/multisample/offsets
remain refused. Do not invent GLES signatures or flatten native dimensions.

Add one distinct JS factory and stage/pair C exports; all historical entry
points retain their original false selection and complete response bytes.
This compiler facet carries no resource, view/surface, decoder, submission,
capset or production Linux renderer authority. D55/D56 storage/DMA remain
qualified independently. Production guest offload and MIPS remain unproven.

## Deterministic acceptance

`make verify-E6-T11d57`

Exercise both stages, all three dimensional targets and homogeneous returns,
slots0/7/15, original declarations and instruction targets, all legal texture
operations, masks, modifiers, qualifiers, queries and unrelated sampler slots.
Literal independent text/token metadata must equal complete original parser
tokens; optimized native, sanitized native and actual Wasm responses agree.
Every historical compiler entry/factory response must match the authenticated
unchanged D56 compiler, including dimensional refusals and ordinary/shadow2D.

Use actual headed M4 Max Metal WebGL2 for compile/link/reflection and complete
RGBA32UI output planes from literal FLOAT/SINT/UINT volume, cube and array
textures. Distinguish each mip, cube face and array/volume layer, nonzero final
layers, rounded/clamped array indices, explicit LOD, original gradients
(xyz for volume/cube, xy for array), volume projection and all TXQ dimensions.
Use varying triangles to prove fragment bias/implicit derivatives. Fence actual
GPU completion before every raw readback; preserve full input/output bodies.
Run three schedules/seeds and a physically wrong-layer binding sabotage against
the unchanged oracle. Refuse target/declaration conflicts, mixed targets at one
slot, unsupported signatures, malformed/oversized inputs, request/reflection
traps, incompatible host masks and null/stage ABI errors without partial success.

Exercise genuine allocation failures/recovery and owned text before allocation;
prove fixed16MiB Wasm memory and262144-byte optimized stack limits. Audit the
finest changed LLVM/V8 regions; every changed hunk is exercised, explicitly held
from an unchanged dependency or statically waived. Use one final scrubbed clean
clone at the frozen runtime head, seal/reopen all recording bodies, and submit
to a fresh adversarial critic. Update/build/commit/deploy the demo with suite
127/0 and truthful partial graphics. Carry unrelated native/Rust gates unchanged.

## Adversarial verification

P1: Independently predict original dimension/return/stage/slot/token metadata;
all six legacy facets refuse new dimensions and preserve complete responses.
P2: Predict full raw GPU planes from literal data for every mip/face/layer and
legal operation; attack z-only volume gradients, cube projected gradients,
array gradients/layer neighbors, volume w projection and query z/levels.
P3: Predict complete refusal for declaration/instruction conflicts, one-slot
mixed targets, unsupported shadows/signatures, malicious request shapes and
host masks. No partial metadata/GLSL or inherited caller resource authority.
P4: Genuine allocation faults produce bounded failures and exact recovery;
caller text mutation during allocation cannot alter the already owned source.
Fixed heap/stack and independent module memories remain bounded.
P5: Authenticate every complete recording body and finest changed code region;
carry exact unchanged HELD dependencies. Invent one bounded semantic attack
and sabotage-check a physical wrong layer using the unchanged full-byte oracle.
P6: Final clean-clone receipt and built/live127/0 demo prove exact source identity,
zero browser errors, partial graphics and disabled production negotiation.

## Verification log

### 2026-10-12 — worker — verified-head dimensional shader refusal; planned slice

D56 is independently verified at48b2ba0c7ee90d13093f7782e5a2502e44095753.
At that exact clean head all six historical JS compiler factories refuse the
original volume/cube/array TEX/TXL/TXQ programs in both stages (108 cases),
while six ordinary2D positive controls pass. Full original source, generated
compiler module, requests/results and runner are retained in the dimensional
shader readiness recording. The first diagnostic mistakenly expected error
code unsupported-profile; actual refusal is unsupported-feature. That failed
attempt and corrected final run are retained without a runtime change.

Exact repro: `node /tmp/wasmvm-dimensional-texture-readiness.mjs`.
The recording is sealed in
`evidence/virgl-production-readiness/dimensional-texture-compiler-gap/`:
19 complete reopened bodies; manifestSHA256
`4fa23f26ae6816805cd9352cb672666ac56710a47358f7db86c920dad7ab32e1`,
indexSHA256`f95d57ef50e660cfb5c71f22bd65ba28c1041220325362bc08337f7f8bfd6db7`,
archiveSHA256`696b34e4d158f119066d2562a89f64199a30ea5d2fa28b55e31fb94aa333885b`.
PR534 continues existing stack500 abovePR533; both stack identities and all134
prior PR identities/order/heads/bases are unchanged, all135open/draft/unmerged.
The app attachment attempt failed at its100-entry limit; no attachment removed.
Primary
contracts are pinned Mesa26.2.2 TGSI and virglrenderer1.3.0 plus Khronos ESSL
3.00 revision6, already held in D48/D55. Native sampler signatures admit xyz
volume/cube/array coordinates, xyz volume/cube gradients, xy array gradients,
ivec3 volume/array fetch and volume projection; cube fetch and cube/array
projection have no core ESSL3.00 signatures and stay refused in this slice.
