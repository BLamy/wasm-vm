# Finite scalar evidence — E6-T12g6f

`make verify-E6-T12g6f` records the isolated compiler boundary. It does not
boot a guest, enable production GPU negotiation or claim desktop FPS/MIPS.

The pinned Mesa 24.2.8 TGSI primary text is
`renderer/virgl-shader/tests/mesa-24.2.8-tgsi.rst`: SSG at line673 returns
+1/-1/0 after comparisons to zero; TRUNC at line898 drops fractional bits
toward zero. The unchanged pinned virglrenderer converter emits GLSL
`trunc()` and `sign()` at `vendor/src/vrend/vrend_shader.c:5706/5710`.
All primary GLSL is recorded from that converter and passed unmodified to
physical Chrome shaderSource. No primary fixture supplies owned predictions.

The owned contract chooses exact TRUNC source-sign preservation for zero
(including negative fractions truncated to zero), and canonical +0 for SSG
on both zero signs. The ordinary GLSL ES3.00 common-function definitions
specify numerical truncation and sign; they do not specify a zero bit sign.
The [Khronos primary specification](https://registry.khronos.org/OpenGL/specs/es/3.0/GLSL_ES_Specification_3.00.pdf),
page94, therefore permits either zero encoding in ordinary primary comparisons.
Every owned word and pixel comparison still requires its one exact declared
policy. Primary TEMP paths can flush subnormal values; their comparisons use
normal/zero source words. Owned dynamic finite-bank probes retain all32 bits
for positive and negative subnormals. Literal private subnormal/nonfinite
numeric reads reject under the unchanged existing numeric authority.

The native sanitizer fixture records 1,598 predetermined public results,
1,562 actual pinned-parser operand-type/converter witnesses, repeat/recovery
and closed rejection. Wasm singles and linked pairs have exact native parity.
The separate source-only JavaScript mathematical oracle uses binary32
decode plus Math.trunc/comparison; the Python receipt independently uses
struct unpack/pack, math.trunc and explicit copysign. Neither reads emitted
GLSL to compute predictions. The planned source/vector/position schedule
is compared against all recorded transform-feedback words and all32 RGBA8
bit planes. Only primary mathematical zero has the explicit two-word set.

Physical sync/async consumers retain complete owned prefixes, A/B/A bank
changes, caller-byte mutation, reflection-pruned uniforms, restoration and
actual waiting-index plans. Four actual indexed-draw rigs run I2F/TRUNC/SSG/
F2I chains above the unchanged direct F2I range guard. Unsafe banks reject
before uploads, index reads and draws; budgets and physical objects end at0.
Independent intercepts would stop an unsafe effect before reaching nativeGL.

The target reruns the unchanged 402 bounds, 49 hex, 108 signed integer and
1,575 signed conversion critic guards, plus the original corpus partition.
Real emitted-helper faults omit fraction removal or the sign bit, and must
fail against source-derived hardware words. Actual LLVM coverage records
every scalar C helper line/branch/region. Browser coverage and captures are
bound to served sources and the exact frozen Git head.

Freeze source, run the acceptance target once, then
`python3 tools/virgl-scalar-operations/cold.py --output <cold-dir>` for the
one pristine exact-head clone with a scrubbed environment. Seal both runs
with `seal.py --hot <hot-dir> --cold <cold-dir> --output <worker-dir>`.
The archive retains both actual sanitizer binaries and their profiles so a
fresh critic can re-export coverage. No rr/ssh dev proof is required.
