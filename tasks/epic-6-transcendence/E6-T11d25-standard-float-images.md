---
id: E6-T11d25
epic: 6
title: Preserve original F16 and F32 2D image transfers and retained views
priority: 525.027039000367
status: implemented
depends_on: [E6-T11d24]
estimate: S
risk: high
capstone: false
---

## Boundary

One explicitly selected resource/backend boundary for original F16 and F32 R/RG/RGB/RGBA 2D image storage. Pin original formats 28–31/91–94 and their public lane/bit semantics. Preserve the current historical resource/backend admissions, exact raw buffer readbacks, native byte-color conversions and all shader/renderer/guest boundaries. A distinct owner/layout/transfer selection validates original metadata and full/truncated NPOT mip chains, rejects invalid dimensions/levels/binds/boxes/overflow/host support, owns complete segmented backing and charges logical/physical/scratch/staging bytes before work.

Use actual qualified native float storage, original upload representation and native full-plane readback/copy; no CPU texture/shader shadow or fallback. Native required extensions and format render/filter restrictions govern selection. RGB's implicit fourth component, binary16 rounding and binary32 value/word custody follow the original public representation. Defined finite values retain their original representation subject to the public GL denormal/zero guarantees. Original nonfinite inputs prove bounded safety and custody where GL leaves values unspecified; no NaN payload or source classification/readback equivalence is invented. Private retained range copies, revision refresh, transfer tickets, old generation ownership, cancellation/disposal and unequal ID reuse remain bounded. This isolated image boundary enables no draw consumer/API/capset/guest authority; a following consumer must qualify native sampling and output behavior.

## Deterministic acceptance

`make verify-E6-T11d25`

Record original full words/metadata/commands/backing, independently predicted float conversion and exact byte footprints, complete native planes and public transfer output; all actual consumed fences and physical allocation/copy events. Cover F16/F32 every channel count, missing/implicit components, finite signed/extreme/subnormal/rounding values, full/truncated NPOT chains/row padding/segmentation/private ranges, native refresh without backing change, old generations and varied queued schedules, destruction/reuse/cancellation/disposal. Strict own data and overflow/one-byte budget/native failure boundaries. A real wrong native type or lane selection must finish a physical GPU fence and fail the unchanged independent original-value oracle. Authentication and full nested coverage for every changed region; affected native/wasm/renderer gates, one final exact-head pristine clone, sealed submission and fresh critic. Carry unchanged original compiler, wire/cache/renderer and historical pixel proof only when their code/dependency/digest is unchanged.

## Adversarial verification

Predict complete original storage values, native type/plane geometry and all memory footprints before inspecting evidence. Interrogate every changed region and original generation/lifetime boundary. Add one bounded independent float representation/range experiment and a real wrong native selection control. Promote recurring deterministic coverage and seal a verdict; never extend this resource task into a claim about unqualified guest/API draws. The critic does not edit runtime code.

## Verification log

### 2026-10-10 — worker — preparation only

The complete eight original17×9/F16–F32/multilevel transfer inputs in `/tmp/wasmvm-original-float-image-readiness.json` all reject `unsupported-resource` through the current selected byte-color layout function. Original enums and unchanged source digests are bound to this read-only negative probe. The pinned Mesa26.2.2 GLES3.0 floor includes OES_texture_float/half_float/half_float_linear. This preparation occurred outside the repository until D24 was independently verified and its lease released; no runtime, GPU or guest proof follows from the preparation.

### 2026-10-10 — worker — public floating representation preparation

Read the primary [WebGL EXT_color_buffer_float specification](https://registry.khronos.org/webgl/extensions/EXT_color_buffer_float/) and [OpenGL ES3.0.6, sections2.1.1–2.1.2](https://registry.khronos.org/OpenGL/specs/es/3.0/es_spec_3.0.pdf). Native R/RG/RGBA16F and32F are renderable with the extension and read via RGBA/FLOAT; original RGB expands to RGBA with implicit alpha1. Ordinary finite exact original words are the oracle. Denormals may preserve or flush to zero; nonfinite command inputs are safety/custody experiments because their values are unspecified. This prevents an undefined NaN payload or classification promise from becoming a false production capability.

### 2026-10-10 — worker — selected implementation and gate selection

The new float owner/backend stays explicitly selected; historical byte-color/resource factories and all wire/compiler/renderer/guest surfaces retain their complete recorded admission. The full original Mesa format YAML is checked in with its pinned digest, alongside complete descriptor ranges and enums. Ephemeral self-validation passed the 96-run physical matrix, lifetime/native-failure boundaries, all 65,536 original half words and 190,474 independent rounding points. All three actual wrong native lane/precision/copy controls fail after consumed physical fences. These are inner-loop checks, not the final submission.

The prescribed high-risk submission is `make verify-E6-T11d25`: source/syntax/format checks; unchanged C/Wasm rebuild; pure own-data/layout/budget boundaries; independent representation oracle; physical matrix; three varied schedule/lifetime/native-error recordings; actual native controls; independent complete-plane/type/byte-footprint inverse; affected async/uniform/byte-color/texture browser gates; full V8 regions/source closures; one final pristine exact-head clone and full seal. Rust and the public demo/device are byte-identical to D24 and do not acquire production graphics authority from this isolated selected JavaScript storage boundary. Their broad regression walls remain outside this narrow submission; the production integration task still requires built demo, actual guest execution, scanout and deployment.

### 2026-10-10 — worker — frozen original floating image submission

Claimed source/harness head: `18ef4acfdebd30dd9edef9c3a1cca1e1fc4490dc`.
Exact hot command: `VIRGL_FLOAT_IMAGE_EVIDENCE_DIR=target/evidence/virgl-standard-float-images-final EMCC=/Users/blamy/.cache/wasm-vm/emsdk/4.0.22/wasm-vm-emcc make verify-E6-T11d25`.
Final pristine command, once: `python3 tools/virgl-command/standard-float-image-cold.py --output target/evidence/virgl-standard-float-images-cold-final`.
Seal command: `python3 tools/virgl-command/standard-float-image-seal.py target/evidence/virgl-standard-float-images-final target/evidence/virgl-standard-float-images-cold-final evidence/virgl-standard-float-images/worker`.

Both runs pass at the exact frozen head. Each includes 240 original own-data/layout/budget records; all 65,536 original binary16 words and 190,474 independent binary32 rounding patterns; 96 complete physical format/size/mip/exceptional transfer runs; three varied 16-run lifetime/native-failure schedules; and actual wrong native upload-lane/storage-precision/copy-level controls. The unchanged independent original-input oracle audits 50,908 native components, 111,476 public readback components, 107,808 complete native upload bytes, 24,672 untouched padding bytes and 10,345 logical/native/scratch footprint checks per run. Every physical negative control completes an actual GPU fence and fails that original-value inverse. Native-only revision refresh, retained old generations, unequal IDs, cancellation/disposal, zero terminal budgets and exactly-once native deletion are recorded. Nonfinite original inputs establish bounded safety and custody where GL values are unspecified, without a NaN payload/classification/readback equivalence claim.

The actual M4 Metal browser records have zero console/page/request errors. Async jobs, uniform binding smoke, the full historical byte-color matrix and retained texture-operation smoke pass. Full nested V8 records, all 80 added runtime-line samples, complete original command/backing/planes and immutable source/served/generated closures remain evidence; line samples do not substitute for the critic's full interval audit. The compiler/wire/cache/renderer/guest boundaries are unchanged. The authenticated inverse accounts for the explicitly selected resource migration and 26 dependency-only HTTP closures; D22/D24 worker/critic archive/index identities carry forward unchanged.

Hot receipt SHA256: `74626b8383d3a8ccea044bda25ae349ab0462a79b5fd2a29c5319ab639341982`.
Cold receipt SHA256: `11450209d60ffaeab8f6de9f416ad0b7567321d6f0d51d265388bbf7eb467eb4`.
Cold report SHA256: `69435d0be5916c036481cd50410839610446c7d423c01129d1f143b4457d1276`.
Cold clone: `/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasm-vm-float-image-cold-ujxnaawx/wasm-vm`, exact frozen HEAD, empty `statusBefore`/`statusAfter`, exit0. Every acceptance file and both generated compiler artifacts are retained in the full seal; source closures contain 531 files per run. The seal manifest records 43274 full members, archive SHA256 `560341ec9107b78c74be23176fc3d6a5bd988da08674e96f69855f2eec259eb9` and index SHA256 `dc9200c84fc4cbb006390265b5510f2c54343c87d6f609ce202b2e3c2d03f4dd`.

This is a worker claim submitted for a fresh adversarial verifier. It establishes only selected original F16/F32 image storage, transfers and retained ranges. It enables no draw consumer, production capset, guest graphics, worker/scanout, deployment or performance authority. The explicit production graphics request continues through the next ordered consumer and integration gates after independent verification.
