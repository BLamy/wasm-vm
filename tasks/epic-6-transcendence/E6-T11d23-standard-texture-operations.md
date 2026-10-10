---
id: E6-T11d23
epic: 6
title: Compile original 2D texture operations to native GPU instructions
priority: 525.027039000365
status: in-progress
depends_on: [E6-T11d22]
estimate: S
risk: high
capstone: false
---

## Boundary

One explicitly host-selected C/Wasm standard/uniform shader boundary, followed by a separate retained-image consumer. Admit complete original TGSI TXL (float coordinate w is explicit LOD), TXF (signed integer coordinate xy and w level), TXD (three numeric sources and final sampler), fragment TXB (float w bias), and TXQ (integer x LOD, native dimensions and selected-view accessible levels). Targets remain declared 2D/FLOAT samplers; additional targets, typed samplers, offsets, gather and LOD-query families remain refused. All historical compiler entries, facade request shapes, output/profile metadata and old consumer admissions retain their original behavior.

Lower the original operands through the pinned parser and word-storage emitter to native textureLod, texelFetch, textureGrad, texture bias and textureSize. Preserve masks, numeric source modifiers and stage restrictions. Original TXQ.w is last_level - first_level + 1 and therefore uses a distinct declared host integer uniform, tied to the original stage sampler in sorted owned metadata. It grants no guest resource/view authority; the following consumer must bind it from a retained selected image. Undefined 2D TXQ.z supplies no dimension or numerical claim; tests compare defined queried lanes and preserved masked lanes. Cross-check the pinned converter's query-level export before returning owned results.

Provide distinct stage/pair C exports and a strict selected JS factory composing existing vertex-format masks and dimensional/buffered-zero constant selectors. Retain the fixed 16 MiB memory, 262144-byte stack and existing text/token/instruction/output/scratch limits. No upstream patch, CPU shader execution, numeric/private certificate, implicit fallback, resource binding, API/capset or guest activation. This isolated compiler is outside the reachable demo until qualified production wiring.

## Deterministic acceptance

`make verify-E6-T11d23`

Native, ASan/UBSan and actual generated fixed-memory Wasm agree on complete responses. Record literal original opcode, target, operand file/index/type/modifier/swizzle/mask/offset custody. Cover both stages, sparse/high sampler slots, missing/invalid declarations and target/stage forms, all relevant masks and modifiers, dimensional and typed/packed vertex selector composition, query-only/all-constant/optimized declarations, complete source ownership, strict getters/proxies/unknown fields/caller mutation, independent memories and bounded OOM/recovery. Compare affected historical public ABIs with the independently authenticated predecessor module; old normalizers reject the distinct profile.

Run actual headed M4 Metal programs from the new C output, with full/truncated NPOT textures, all original stage slots, defined explicit levels/fetch addresses/gradients and implicit derivatives plus bias, signed-normalized and sRGB native samples, and defined query dimensions/accessible levels. Preserve complete original shader/attribute/texture bodies, all native planes, reflected integer query bindings, full outputs and consumed physical fences. Require real wrong native LOD/gradient state and wrong query-uniform controls to finish GPU execution and fail the unchanged independent original-input oracle. Do not assign numerical truth to undefined query dimensions, fetch addresses or derivatives.

Fail every genuine affected allocation site, recover byte-exactly, and prove source ownership before semantic allocation. Measure optimized Wasm call-chain stack within the unchanged bound. Bind full LLVM/V8 counters to source/served/generated/input/native custody, run the affected historical compiler gates once at the frozen head, carry unchanged verified image/transport/resource evidence by authenticated code/dependency/digest, and record one final scrubbed pristine exact-head clone. Seal and submit to a fresh critic. This prerequisite supplies no retained-image consumer or production draw authority.

## Adversarial verification

Predict complete original texture tokens, native operation selection, all defined sampled/query lanes, host integer reflection and exact native/Wasm response identity before inspecting. Authenticate sealed members and prior HELD dependencies. Interrogate every changed nested C/V8 region. Invent one bounded native mip/query/source-modifier attack with independent image words and stage/slot selections; require a real wrong native selection to complete a fence before original pixels fail. Check query-only native elimination, masked lane preservation, all genuine allocation/OOM recoveries and fixed-memory/source ownership. Carry unchanged historical results and the final pristine proof; never expand this compiler task into unimplemented guest/resource authority. Promote recurring deterministic proof and seal fresh captures. The critic never edits runtime code.

## Verification log

### 2026-10-10 — worker — prepared successor only

D22 byte-color task is independently verified at ac2b1ed7a77e82afb21321d6dfdabe0b2da12d4c, with its exclusive lease released and a clean tracked tree. Twenty complete constructed original TGSI inputs (five operations, both stages, both historical standard/uniform facets) are rejected unsupported-feature by the unchanged predecessor module, SHA256 fc479ec92133f8b75d26043d20fca97d00b1a1556481abf5c5daf23b66e00fca. The readiness record pins all complete inputs, compiler source and pinned original opcode/converter headers; it carries no native, guest or production authority.

Temporary source/C/Wasm prototypes and deterministic harness preparation remain outside the repository. This task may enter the active lane only after D22 is independently verified and its exclusive verifier lease is released. Primary original semantics: https://docs.mesa3d.org/gallium/tgsi.html and https://registry.khronos.org/OpenGL/specs/es/3.0/GLSL_ES_Specification_3.00.pdf. Pinned local original sources are bound by readiness digests; accessible levels are a selected-view fact, and the undefined 2D z dimension is not a pixel predicate.

### 2026-10-10 — worker — active original texture compiler boundary

D22 is verified, its lease is released, and this S/high task is the top eligible graphics prerequisite. Implementation proceeds on `codex/virgl-standard-texture-operations`. The old compiler and renderer dependency evidence remains unchanged at activation.
