---
id: E6-T11d26
epic: 6
title: Execute original floating image samples and framebuffer outputs
priority: 525.027039000368
status: in-progress
depends_on: [E6-T11d25]
estimate: S
risk: high
capstone: false
---

## Boundary

One explicitly selected original floating 2D image consumer for the D25 retained owner. Admit the original F16/F32 R/RG/RGB/RGBA sampler-view and surface packets, with exact metadata/range ownership, through a separate decoder and async renderer. Preserve all historical consumer/decoder admissions and compiler/word/cache/resource boundaries. Native original FLOAT operations, local dimensions/count queries, original swizzles and nearest/linear/mip filtering bind actual retained float planes; finite output/clear/blend values remain unclamped with correct missing/implicit channels and alpha. Actual native floating storage, float blend and float-linear extension support is checked before consumer allocation. No software shader, CPU image shadow or fallback.

Original framebuffer mip planes and GPU-only refresh retain the resource generation across queued contexts, destruction/reuse, cancellation/disposal and bounded failures. Native transfers retain their original float representations and charged storage from D25. No integer/packed/depth/array/MRT or complete API/capset/guest authority is acquired here. Production integration follows only when its actual remaining floor is independently qualified.

## Deterministic acceptance

`make verify-E6-T11d26`

Record literal original view/surface packets and complete original TGSI programs through the actual unchanged fixed-memory C/Wasm bridge, actual async renderer/native objects, full source/target planes, output transfer words and consumed physical fences. An independent original-input inverse must predict finite negative/out-of-unit outputs, nearest/linear/mip samples, every channel/missing alpha and view swizzle, retained local queries, float clear/write masks/blending and every admitted original storage precision. Include full/truncated NPOT source/target mips, native-only refresh, first/warm native draws, retained old generations and unequal public ID reuse. All eight formats, both shader stages, varied queued schedules, strict own data/range/feedback/budget/extension/native-error boundaries. Real wrong native precision, sampler or alpha controls must finish a physical fence and fail the unchanged inverse.

Authenticate all original programs, full nested runtime coverage and actual served/native closures. Run affected historical compiler/decoder/renderer/byte/float paths; one final pristine exact-head clone, full seal and fresh critic. Carry unchanged original storage/compiler evidence only when its dependency boundary and complete digest are unchanged. The production device and guest remain unqualified.

## Adversarial verification

Predict original range/float behavior before inspecting complete native outputs. Attack each changed interval and generation/lifetime boundary, add one bounded novel independent range/precision/filter/output experiment, and prove an actual wrong native selection fails after consumed physical fences. Promote recurring tests and seal a verdict. The critic never edits runtime implementation or extends this isolated consumer into a guest claim.

## Verification log

### 2026-10-10 — worker — preparation outside the active lane

The sixteen complete original F16/F32 view/surface packets in `evidence/virgl-production-readiness/float-consumer-gap.json` all refuse through the historical selected byte-color decoder. D25 storage is independently verified at `7a58efee480e38ebad14dedcc57bde0e747088ae`; this preparation grants no runtime/browser/guest authority and was prepared outside the active lane.

The primary WebGL [EXT_color_buffer_float](https://registry.khronos.org/webgl/extensions/EXT_color_buffer_float/) specification makes the selected floating targets renderable, permits RGBA/FLOAT readback and leaves shader outputs unclamped. [EXT_float_blend](https://registry.khronos.org/webgl/extensions/EXT_float_blend/) qualifies blending into 32-bit float attachments and is implicitly enabled by the color-buffer extension on supported systems. [OES_texture_float_linear](https://registry.khronos.org/webgl/extensions/OES_texture_float_linear/) adds float linear/mip filtering. A selected consumer must check support and physically prove this behavior; the float storage proof alone does not establish it.

The isolated preparation subsequently compiles all 368 complete original pairs with the copied frozen 16 MiB C/Wasm compiler and decodes complete setup/view/draw/output-read packets. This is a grammar and harness pre-check only; native floating output/filter/blend behavior is still awaiting actual GPU recording after activation in the now-released worktree.

The selected floating clear uses `ClearBufferfv` as specified by [OpenGL ES 3.0.6 §4.2.3](https://registry.khronos.org/OpenGL/specs/es/3.0/es_spec_3.0.pdf); historical clear selection is preserved. Finite fixture coordinates use exact binary fractions so the unchanged original-input inverse has a concrete absolute/relative output budget of `2e-6 * max(1, abs(expected))`, with exactly representable half-target output values.
