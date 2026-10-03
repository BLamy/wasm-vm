---
id: E6-T12e4a
epic: 6
title: Preserve private raw shader lanes and masked bitwise operations
priority: 525.02699041
status: in-progress
depends_on: [E6-T12e3b]
estimate: S
risk: high
capstone: false
---

## Boundary

Add a bounded validated IR and an owned ESSL300 emitter for programs using AND,
OR, NOT, SHL or USHR. Keep private TEMP and immediate lanes as highp uvec4; MOV
preserves raw bits, and every shift masks its count with31 as TGSI requires.
Admit all checked decimal UINT32 words in these programs without applying the
legacy float-immediate predicate. Keep lane initialization, consumed swizzles,
partial writes and overlapping source/destination semantics exact.

Select this backend internally only when validated new bitwise operations occur.
Legacy-only programs retain their existing acceptance, full GLSL/metadata/error
results and v5 profile. New stages identify the owned path as
`virgl-webgl2-raw-bits-v1`; no caller backend/key overrides. The vendored compiler
stays untouched. Emit from validated operands and owned templates, never rewrite
arbitrary generated GLSL with text substitutions. Reject integer-bearing programs
that also use ADD/MUL/MAD/TEX until the later mixed-use boundary. UADD, comparisons,
UCMP, PRECISE, modifiers, control flow, ADDR and indirect access remain rejected.

The guarantee covers private raw lanes and integer use sites. Existing attributes,
GENERIC varyings and POSITION/COLOR remain the float ABI and do not become raw
integer channels. Track conservative known bits and float-origin lane identity:
raw outputs must be statically proven finite normal values or zero, otherwise
reject before emission. Existing float input values may pass through MOV under
the ordinary float-IO contract; this makes no NaN-payload or arbitrary raw-buffer
promise. Unknown raw CONST words are not automatically safe float outputs.
No new integer constant-command transport is admitted.

Keep all current capacities:179 non-END instructions, TEMP0..117, CONST0..45,
other banks0..7, eight immediates,16KiB text,8192 tokens,256 lines,512-byte lines,
64KiB GLSL, existing JSON bounds,16MiB fixed Wasm and256KiB stack. Explicitly account
for IR/storage and pair stack use. Both single and pair conversion must clean up
bounded allocation failures. Derive the same semantic/mask/interpolation key for
mixed legacy/owned pairs; preserve exact standalone FS output and only authorize
VS qualifier changes from the derived interface. Preserve the system-block and
uniform declaration/reflection contracts used by the command renderer.

## Deterministic acceptance

`make verify-E6-T12e4a` records native sanitizer and fixed-memory Wasm parity for
shared authored positive/negative shaders, all19 unchanged captured bodies, and
mixed-backend smooth/flat pair cases. Every newly admitted operation must execute
on actual WebGL2 in both stages with an independent raw-u32 reference oracle.
Use finite normal byte carriers and transform feedback for VS, and exact0/255
bit-plane pixel output for FS; reconstruct all32 bits. Include dynamic uniforms
so constant-folded literal results are not the only execution proof. Distinguish
such direct host-uniform probes from the unchanged finite guest wire boundary.
Record exact source/GLSL/metadata, raw output words/bytes, actual compile/link,
input ownership/recovery, unchanged bounds and maximal179-instruction execution.
Keep the12 accepted originals and7 PRECISE rejections; never strip PRECISE.
Record the final exact-head gate and one pristine clone proof. Production stays off.

## Adversarial verification

Attack0,1,0x7fffffff,0x80000000,0xffffffff, alternating bits, NaN/Inf encodings,
subnormal bits, signed zeros, high banks and initialized-lane neighbors. Test
shift counts0/1/31/32/33/63/0x80000000/0xffffffff, including dynamic per-lane counts.
Attack same-register swizzles and partial writes; unsafe raw-to-float output and
safe byte carriers; full UINT32 lexical overflow, signs, exponents and suffixes;
legacy-only rejection stability; mixed-backend pair interfaces and rollback.
Use independently authored native mutation seeds/recoveries and a bounded novel
hardware attack. Sabotage lost high bits, float-backed raw storage or shift-count
masking and require a failure in independently computed actual output. Account
for every changed executable hunk or demand missing evidence.

## Semantic sources

Pinned virglrenderer1.3.0 source `vrend_shader.c` declares float TEMP storage at
6642–6645, bitcasts integer results into floats at4308–4334 and emits unmasked
shifts at5768–5773. GLSL ES3.00 sections4.1.3,5.4.1,5.9 and8.3 govern integer
storage, conversions, shifts and the unspecified NaN/Inf float-bitcast domain:
<https://registry.khronos.org/OpenGL/specs/es/3.0/GLSL_ES_Specification_3.00.pdf>.
Exact captured Mesa26.2.2 TGSI docs explicitly mask shift counts with31:
<https://gitlab.freedesktop.org/mesa/mesa/-/raw/mesa-26.2.2/docs/gallium/tgsi.rst>
(lines1332–1375, SHA256
`6ec695d90ea0b3a5d471aab114352cc2431bcfc589f6b6e6ca88e4e1ca0caabe`).

## Verification log

### 2026-10-03 — worker — activation

Dependency E6-T12e3b is independently verified at
`f643c50d3379e4e27a1daf1784f67287fe36d562` and published as PR418. This slice
establishes raw private storage with observable bitwise operations; subsequent
arithmetic/masks and mixed float use stay in separate pending slices. The owned
emitter is required because merely admitting new opcodes into float-backed TEMP
storage cannot establish the requested all-bit guarantee. Legacy results remain
unchanged; no guest device or production behavior is activated.
