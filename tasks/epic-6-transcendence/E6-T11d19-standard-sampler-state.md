---
id: E6-T11d19
epic: 6
title: Execute original core sampler address filter and LOD state
priority: 525.02703900038
status: implemented
depends_on: [E6-T11d18]
estimate: S
risk: high
capstone: false
---

## Boundary

One original sampler-state boundary in the host-selected standard command/rendering facets. Accept original core REPEAT/CLAMP_TO_EDGE/MIRROR_REPEAT S/T/R modes, both image filters and the three original mip-filter enums. Preserve exact finite minimum/maximum LOD values, including signed and reversed bounds (reversed bounds have undefined sampling in GLES and are proven by parameter round-trip only), and inactive original border/compare words without granting unsupported border, shadow, anisotropy or LOD-bias behavior. Map admitted state to native WebGL sampler parameters using pinned Gallium and virglrenderer enums. Legacy finite factories retain their admissions and public shapes. Texture storage remains the independently proven one-level profile; this change alone cannot claim multilevel/cube/array/shadow storage or a complete API.

## Deterministic acceptance

`make verify-E6-T11d19`

Record original CREATE_OBJECT sampler-state, view/bind/transfer/draw bytes and complete C/Wasm shader bodies. Independent literal enums and sampling formulas predict native parameters and full pixels before observing them. Actual headed M4 Metal draws cover all admitted wrap/filter combinations, seams and negative/multiple-period coordinates, magnification and minification, both-stage samplers, non-power-of-two textures, original swizzles/alpha and native min/max LOD clamping. Record complete uploaded/read GPU texels and zero unexpected errors. Exercise native sampler allocation/parameter failures and cleanup, public name replacement/deletion, exact retained identities, poisoned ambient sampler bindings, queued draws, context/subcontext/cache restoration and varied later-task fence schedules. All final ownership budgets retire. Sabotage one real native wrap mapping and one filter mapping; the unchanged pixel oracle must fail after a completed actual draw/fence. Record full source/served/generated/Wasm/V8 custody, affected old sampler/state gates once at frozen head, one pristine scrubbed exact-head clone, sealed evidence, and submit to a fresh critic. No production capabilities or actual guest/deployment authority follow from this isolated prerequisite.

## Adversarial verification

Predict original word fields, native sampler identities/parameters, full texture bytes and pixels. Authenticate complete hot/cold custody and changed nested V8 regions. Attack admitted boundaries under independent schedules/seeds, invent one bounded physical seam/state-restoration attack, sabotage its original oracle after completed native fence and promote the recurring test. Carry unchanged HELD resource/shader/buffer claims by dependency/evidence digests. Verifier never fixes implementation.

## Verification log

### 2026-10-10 — worker — negative readiness planning

The unchanged selected standard decoder admits only two of the 27 original core S/T/R wrap combinations. The literal probe `evidence/virgl-production-readiness/standard-sampler-gap.json` binds decoder, pinned Gallium header, Mesa26.2.2 original encoder and virglrenderer source hashes to the result at `dd2ba352e8c0d9f32198b02f552d9f785388ec2d`. A REPEAT/REPEAT/REPEAT packet rejects with `unsupported-feature: Only clamp-edge 2D nearest/linear non-mip samplers are supported.` Pinned encoder `virgl_encode.c:1131-1159` preserves each original field; pinned renderer `vrend_renderer.c:2515-2576,2588-2631` maps the core address/filter state to native sampler parameters. Khronos GLES3.0 specification sections3.8.2/3.8.10 define sampler state and filtering (https://registry.khronos.org/OpenGL/specs/es/3.0/es_spec_3.0.pdf). Actual resource/texture/API qualification, guest Mesa/compositor execution, worker scanout and live deployment remain ordered successors under the user's explicit instruction to finish production guest graphics.

The 72 direct native Metal prechecks in `/tmp/wasmvm-sampler-native-precheck.json` agree with the planned independent GLES equations for implicit fragment/vertex LOD, all three mip enums and signed LOD clamp changes. This is planning only; it is not the original decoder/renderer acceptance or final evidence.

### 2026-10-10 — worker — activation

Selected as the next ordered production-graphics prerequisite. D18 is verified at bdad14aff93ba70c09d60ab308df4d2024dce4ba and all prior graphics dependencies remain verified. Core native sampler address/filter/LOD state is the only active runtime boundary.

### 2026-10-10 — worker — frozen original sampler submission

Runtime and all acceptance sources are frozen at `4e13347405adf4926dd866b9ff434a08420b4784`, based on independently verified D18 `bdad14aff93ba70c09d60ab308df4d2024dce4ba`. Commands:

```sh
VIRGL_SAMPLER_STATE_EVIDENCE_DIR=target/evidence/virgl-standard-sampler-state-final make verify-E6-T11d19
python3 tools/virgl-command/standard-sampler-cold.py --output target/evidence/virgl-standard-sampler-state-cold-final
python3 tools/virgl-command/standard-sampler-seal.py target/evidence/virgl-standard-sampler-state-final target/evidence/virgl-standard-sampler-state-cold-final evidence/virgl-standard-sampler-state/worker
```

The frozen headed Chrome155/M4 Metal run contains 8,192 literal sampler enum probes, 288 signed/reversed/inactive raw-word probes, 832 positive frames, 834 actual native draws and 53,248 independently checked pixels. Both image filters, all three mip enums and every original core S/T/R combination execute under minification and magnification. Original vertex/fragment/combined-stage shaders, NPOT textures, swizzles and alpha, finite min/max LOD clamps, all eight inactive compare functions, 72 finite/reversed native parameter round-trips, public sampler deletion/replacement, ambient sampler poisoning, contexts/subcontexts/cache reset, queued draws and varied delayed fences execute. Actual native allocation and parameter faults reject/retire without publishing a sampler. Every final allocation, object, lease, job, uniform-snapshot and cache budget is zero; each actual sampler retires once. Both real native wrap/filter mapping faults complete draws and fences before the unchanged original full-pixel oracle rejects them. The independent audit binds original op1/op10/op18/op8 words and complete shader text to full native parameters, texture/vertex bytes and full pixels; it never derives expected pixels from observed GPU output. Complete source/served/generated/Wasm/V8 and native blobs are recorded. Each added JavaScript line has an execution sample; full nested V8 regions remain the critic's coverage authority. Seven documentation lines require no execution.

The affected old command-decoder, object-state and complete standard-state gates pass on the same frozen head. Compiler/Rust/production bytes and resources/cache/constant-domain bytes are unchanged. The receipt verifies byte-identical decoder code outside decodeSamplerState and state code outside the native type7 creation branch against D18; inherited buffer/ownership/compiler/range proofs carry by these exact dependency boundaries and authenticated D16/D17/D18 worker/critic digests. No unrelated runtime claim is expanded.

The one final pristine scrubbed clone passed the complete same command at the exact frozen head and remained clean before/after. Clone `/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasm-vm-sampler-state-cold-iw78x_6z/wasm-vm`; source/control environment was scrubbed and the complete acceptance log and copied receipt are sealed. Worker `evidence/virgl-standard-sampler-state/worker/recording.tar.gz` has 9750 records / 7988941 compressed bytes, SHA256 `aeffc0b3a43f7af0232248a1915961a62407002579f1bd69f52513b06c2e4f18`; record index SHA256 `15792ac21e635cf3b3e8ab028ad4b79cec13e96703ab20520dd4bf9a46f92e8f`. Hot receipt SHA256 `db8363b6db8492182ae70926e8985b532a4dd2df0bd3b404994c1c3dfafce744`; cold report `6912e094a3608245bf68f7f7d3e7a53469a55eceeddbc56aeee06aba97fd89ea`; cold receipt `5f06dde33d9ed440cacd370cb562e4b7f304bae40e2f4f483623971727439118`.

This isolates original core sampler state. Reversed LOD bounds have undefined GLES sampling and are proven by exact native parameter round-trip only. Actual multilevel/cube/array/shadow storage, API and typed capset qualification, guest Mesa/compositor execution, production worker/scanout, demo/deployment and performance remain successors. No positive production capability or guest/offload authority is claimed. Submit this diff and sealed evidence to a fresh adversarial verifier; only that session may mark verified.
