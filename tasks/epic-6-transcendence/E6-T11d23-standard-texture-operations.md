---
id: E6-T11d23
epic: 6
title: Compile original 2D texture operations to native GPU instructions
priority: 525.027039000365
status: implemented
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

### 2026-10-10 — worker — original native texture compiler implemented

Frozen runtime/harness head `bd1f39244d74a86a811a064eaa4e9a8989bcee8c`; incremental sealing-only head `7eda9f021bdcbda82dc6c3bc1fc9b81a0bae41c8`. The final original compiler run and the one pristine scrubbed exact-head clone both passed:

```sh
VIRGL_STANDARD_TEXTURE_EVIDENCE_DIR=target/evidence/virgl-standard-texture-final make verify-E6-T11d23
python3 tools/virgl-standard-texture/cold.py --output target/evidence/virgl-standard-texture-cold-final
python3 tools/virgl-standard-texture/seal.py target/evidence/virgl-standard-texture-final target/evidence/virgl-standard-texture-cold-final evidence/virgl-standard-texture/worker
```

Each run records 932 complete original C/native-sanitized/fixed-memory Wasm cases (647 admitted, 285 refused), literal immediate words and texture operand/type/mask/modifier/target custody, 69+ sorted query bindings, 61 strict own-request refusals, source snapshots, independent memories and real heap/scratch exhaustion with recovery. All 932 historical public ABI responses are byte-identical to the actual predecessor module independently extracted from the authenticated D22 worker seal. Affected original uniform508/packed59/integer48 native/sanitized/Wasm gates pass at the frozen module. All 165 genuine allocation failures recover, with both original source strings owned before semantic allocations and no partial result. Optimized Wasm call-chain measurements are stage139488 and pair195184 bytes, below unchanged262144; memory remains fixed16777216 bytes. Pinned upstream70 files are unchanged.

Each actual headed M4 Max Metal run compiles909 complete accepted native stages and executes246 full8x8 frames (15744 pixels,62976 raw output words,29916 native image texels). Full/truncated17x9 mip chains, all legal vertex/fragment operations and sparse/high slots, nearest/linear signed-normalized and sRGB samples, fractional explicit LOD and integer negated-source fetch/query, masked preserved query lanes and query-only native elimination are recorded. The independent Python original-input audit reconstructs every output from literal shader immediates, original full image bodies and attributes. Real wrong native TEXTURE_BASE_LEVEL, gradient LOD clamp and integer level binding each complete a consumed GPU fence, then fail the unchanged full-pixel oracle. All healthy/fault programs clean up; zero browser/native errors. No undefined 2D query z numerical claim is made.

Complete source/served/generated/input/native identity and full nested LLVM/V8 counters accompany the recordings (12 V8 scripts,27 LLVM file records,94 line samples; full nested regions remain critic authority). The seven compiler files have39 exact reversible migrations in `tools/virgl-standard-texture/boundary.json`. D22 worker30256 and verifier1824 members are independently reread/authenticated; renderer/resource/transport/guest/demo bytes remain identical. All unchanged HELD image/lifetime evidence carries through that sealed dependency. The one final cold clone at `/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasm-vm-virgl-standard-texture-cold-msbfcjuu/wasm-vm` is clean before/after with scrubbed environment. No related runtime code changed after the recording. The subsequent sealing-only repair names the exact receipt stdout append and promotes its literal/tamper test; original recorded source identities and cold proof carry unchanged under incremental policy.

Sealed evidence: `evidence/virgl-standard-texture/worker/{manifest.json,records.json,recording.tar.gz}`. 5814 members, archive SHA256 `0e3941c6a1dc117bc27f4e319ca2f768357ec20e733841410d8ad74ac7b73e20` (27195344 bytes), index SHA256 `35159ac22757fd992efc8184a023207850eeef29286e7372f432a714ccbea792`, hot receipt `51b333ab4ed3b0812c74cb1550b8690a4f63a3428ad069ad6421fb67260cab42`, cold report `014be7a0dec5eb110f8055773986944404543e29cf2de833366f03f22088c92a`, cold receipt `b61c7abeccd10b0a5de14a765c876bbb783d1db136667593481ad4a053c1c6f9`.

The recording demonstrates only this explicitly selected original 2D/FLOAT compiler boundary and native execution of its owned output. It supplies no retained-image consumer or production resource authority. Complete API/capsets, actual guest Mesa/desktop offload, production GPU worker/scanout, live deployment and any performance figure remain later acceptance gates. A fresh verifier must judge this submission before a successor enters the active lane.
