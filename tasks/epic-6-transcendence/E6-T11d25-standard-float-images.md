---
id: E6-T11d25
epic: 6
title: Preserve original F16 and F32 2D image transfers and retained views
priority: 525.027039000367
status: pending
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
