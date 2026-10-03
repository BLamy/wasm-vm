---
id: E6-T10d
epic: 6
title: Execute the captured textured-scene shaders through the bounded browser bridge
priority: 525.02691
status: in-progress
depends_on: [E6-T10c]
estimate: S
risk: high
capstone: false
---

## Boundary

Expand only the existing bounded straight-line shader grammar enough to accept
both unmodified E6-T10b textured-scene TGSI bodies. Keep eight-register limits,
fixed shader keys, current opcodes, one render target and zero guest capsets.
This is shader execution, not a VirGL command executor or guest device.

Allowed additions: bounded TEMP-only declaration ranges; `.xy` GENERIC declarations;
MOV-to-OUT masks `.xy/.z/.w`; four-component source swizzles; checked UINT32
immediate words with finite float-bit interpretation; exactly the fragment
FS_COLOR0_WRITES_ALL_CBUFS=1 property. Preserve full-write-before-read TEMP rules,
complete POSITION/COLOR output writes and complete declared generic components.
Reject PRECISE, loops, address registers, integer instructions, partial TEMP
writes, CONST ranges, other interpolation and shader-key overrides. Expose
component masks in versioned metadata and verify actual compiled IO types.

## Deterministic acceptance

`make verify-E6-T10d` is the complete risk-tier submission for this isolated C/Wasm
frontend. It runs the existing native/sanitizer/Wasm/browser bridge gauntlet plus
bounded new grammar attacks, exact captured TGSI hash checks and all 19 captured
body outcomes. No Rust, production web or guest-device semantics change.

The exact captured vertex body e96102a3202dde8b0b05ffa142eb6064c5fe916b673bbf1d31464bcbac56fb33
and fragment body 80d6db6a6f10b93770698cfdd47232fed0fca94f4cb07ba7381bb38563de9808
must translate unchanged natively and in Wasm, compile/link in headed hardware
Chrome, and reproduce all three textured-scene phases: two-component attributes,
u16 indexed triangles, nearest sampling, tint, quarter-alpha blending and 768
exact independent interior pixels. Do not substitute or normalize TGSI bytes.
Record generated GLSL, metadata/reflection, input/output hashes, screenshot and
zero browser errors. Run final acceptance once in a scrubbed pristine clone.

The E6-T10c inventory must report actual newly accepted/rejected shader hashes
without claiming full corpus compatibility. Preserve its nine literal draw
regressions and explicit PRECISE/Z32_UNORM rejection. Current production 3D stays
disabled. Update only affected contract expectations when proven behavior changes.

## Adversarial verification

Fresh verifier predicts before reading evidence. Attack each new boundary:
reversed/overlapping/oversized ranges, unsigned overflow/long words/NaN/Inf/subnormal
immediates, short/long/invalid swizzles, undeclared component reads, missing POSITION.w
and generic output components, partial TEMP writes and invalid properties.
Require repeated reject-to-valid recovery, native ASan/UBSan mutation runs and
Wasm bounds/recovery. Sabotage the VS one-bit immediate selection or one texture
texel; independent pixel acceptance must fail. Inspect every changed guard branch
for evidence or a justified coverage waiver. Carry unchanged T10a proofs forward;
do not demand complete guest command replay or performance before this boundary.

## Verification log

### 2026-10-03 — worker — activated (UTC)

Parent d0a5b1fc independently verified the browser contract, published as PR #405.
This S frontend task continues the explicitly requested graphics-offload lane.
It adds actual captured-shader execution while the broad command renderer and
transport planning containers remain inactive. No other task is active.
