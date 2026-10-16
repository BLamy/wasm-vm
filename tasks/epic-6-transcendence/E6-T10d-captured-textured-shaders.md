---
id: E6-T10d
epic: 6
title: Execute the captured textured-scene shaders through the bounded browser bridge
priority: 525.02691
status: verified
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

### 2026-10-03 — worker — implemented (UTC)

Frozen runtime/harness commit `8759a30622e6604b8cd3d5c35d110260c6fd1943` adds
only the bounded v2 grammar listed above. TEMP writes remain full; all source
swizzle lanes must be declared even if unused by the destination; POSITION/COLOR
and declared generic components must be fully written. UINT32 decimal words are
checked before arithmetic and interpreted as finite binary32 bits (magnitude at
most 1e6, no nonzero subnormals). Metadata exposes component/written masks while
actual upstream IO types remain vec4. No opcode, register budget, shader-key,
production web, Rust crate or guest capset is added.

Recorded final command:
`EMCC=/tmp/wasm-vm-emsdk/wasm-vm-emcc VIRGL_CAPTURED_SHADER_EVIDENCE_DIR=evidence/virgl-captured-shaders/worker make verify-E6-T10d`.
Worker receipt `evidence/virgl-captured-shaders/worker/receipt.json` SHA256
`4ca04003a640edd49425923a2f64435cb1dbe3a8d7aef1a8d3be22e069192a0b`
binds changed sources, compiler identities and all nested reports. Served Wasm
SHA256 is `ef4e5567cee381cffc19aece8c92671dca3707e7c8f21feb15a3eaa55f71642f`
(258304 bytes). The two captured shader source hashes are unchanged and native
and Wasm generated GLSL/metadata match exactly.

Acceptance passed: strict guard C warnings/syntax, Python/Node syntax, four
contract negative tests, pinned native/Wasm builds; prior native sanitizer gate
(8769 calls, 4096 mutations); new native ASan/UBSan gate (27371 calls, 302 positive
boundaries, 112 explicit negatives, 517 truncations, 8192 mutations and 18246
exact captured-pair recoveries). Headed Chrome154.0.8037.93 / Apple M4 Max passed
the unchanged nine literal draws/4336 exact pixels and the captured two bodies
with original two-component interleaved geometry, u16 indices, same linked
program, three tint/blend phases and 768 exact pixels. Wasm rejected all112
malformed cases and recovered1792 subsequent pair translations identically.
All browser console/page/request error lists are empty. The trusted texture-texel
sabotage exited1 specifically at phase0 pixel(4,4), expected[255,0,0,255],
observed[0,0,0,255]; its failure screenshot/report are retained. The contract
browser's four API probes and raw corpus matrix gate also passed. Seven of19
bodies now translate; five have no execution claim. Twelve remain rejected
(11 unsupported-feature, one parse-error), including the strict PRECISE boundary.

Final pristine clone: `/tmp/virgl-captured-cold-proof.py` (copied into evidence)
cloned the exact frozen head with `git clone --shared --branch
codex/virgl-captured-shaders`, scrubbed RUSTFLAGS/RUST_LOG/CARGO_* and Python/compiler
injection variables, and ran `make verify-E6-T10d` using the pinned EMCC wrapper.
`evidence/virgl-captured-shaders/cold-clone/report.json` records empty Git status
before and after. Its acceptance receipt SHA256 is
`b25814661f1f65a47a6c0431749178ba43b69dfb9f87a38d336c2d8edb188ba3`;
log SHA256 is `da2ecf78813df2b56fd3c096ece5a2917a7aad23258778603c7b1ce072b2123a`.
The complete cold acceptance reports/logs/screenshots are copied beside it;
the retained clone path is recorded in that report.

The evidence proves captured shader execution through explicit original workload
bindings. It does not replay VirGL commands, initialize Mesa in the emulator,
accelerate the desktop, or establish MIPS/FPS gains. Production VIRGL remains
disabled. The affected high-risk frontend gauntlet and final cold clone ran at
the frozen head; unchanged Rust/production web targets do not require unrelated
workspace or deployment runs. Two obsolete v1 negative tests (newly valid MOV
mask/source swizzle) were replaced with adjacent still-invalid ADD mask/short
swizzle cases; new tests cover the expanded boundary instead of suppressing it.

### 2026-10-03 — fresh verifier — VERDICT: verified (UTC)

VERDICT: verified

Independent verifier session, frozen runtime `8759a30622e6604b8cd3d5c35d110260c6fd1943`
and worker handoff `b29ef95e`. Read the task and diff against `d0a5b1fc` first;
recorded predictions before inspecting worker evidence. Evidence below is under
`evidence/virgl-captured-shaders/verifier/`; `digests.json` binds 23 artifacts
(SHA256 `acbddd65a3faee6356e360214cde2479a5a181654f6499ab7f76c34bf506da14`).
No implementation changes were made.

- **P1 exact bytes/provenance — HELD.** Both captured hashes match; native/Wasm
  outputs agree. Independently recomputed 102 frozen source hashes, six compiler
  hashes, subordinate reports, screenshots, native binaries/logs, and all eight
  worker/cold browser report identities. The scrubbed cold clone is clean before
  and after its passing full acceptance (`receipt-audit.json`, `receipt-audit.md`).
- **P2 captured hardware semantics — HELD.** Fresh headed Chrome/Apple M4 Max
  execution matches 768 independent literal pixels in three u16 indexed draws.
  Actual vec4 attributes/varying, original two-component interleaved bindings,
  component/written masks, sampler2D and single COLOR0 output match the claim
  (`captured/report.json:695`, `:783`, `:2525`, `:2622`). Tint update and
  quarter-alpha blending use the same program. Browser errors are empty and the
  screenshot was inspected.
- **P3/P4 new guard boundaries/recovery — HELD.** All 112 malformed fixtures and
  302 positive boundaries pass under ASan/UBSan with four fresh seeds, 8,192
  mutations, 517 truncations and 18,246 exact captured-pair recoveries
  (`native-independent.log:115` through `:125`). The fresh hardware/Wasm run
  records 1,792 repeated recoveries. Range bounds/overlap, UINT32 overflow and
  nonfinite/subnormal values, invalid swizzles/masks, undeclared reads, missing
  output components, partial TEMP writes and invalid properties all reject.
- **P5 scope/regression — HELD.** Independently replayed all 19 native bodies:
  seven translate, eleven reject unsupported features, one rejects malformed
  syntax. Only the captured pair has this execution claim. All six original
  literal GLSL hashes and nine RGBA hashes/4,336 pixels match T10a. All 25 prior
  verifier evidence digests are intact; only unchanged boundary proofs carry
  forward. PRECISE/Z32_UNORM remain rejected and production 3D is disabled
  (`receipt-audit.json`, incremental proof table in `receipt-audit.md`).
- **P6 sabotage sensitivity — HELD.** Independently corrupted one texture texel.
  The compiled program fails at phase 0, pixel(4,4): expected [255,0,0,255],
  observed [0,0,0,255] (`sabotage/report.json:905`; exit 1, failure screenshot).
- **P7 bounded novel attack — HELD.** An independent integer IEEE-bit predicate
  and exhaustive 256-swizzle xy-declaration sweep predict all 1,850 native/Wasm
  cases: 914 accepted, 936 rejected, 7,400 identical valid recoveries
  (`numeric-attack.json:4`, `:7`). This includes every sign/exponent at three
  mantissa boundaries, padded words, overflowing aliases, and operand ranges.
- **COVERAGE — SUFFICIENT.** LLVM counters exercise all 81 added executable C
  lines; no changed executable line has zero hits (`changed-coverage.json`).
  Every new dynamic guard outcome is covered. The compiler-folded `isfinite`
  macro arms and declaration-mask defensive redundancy at bridge.c:223 are
  structurally unreachable and explicitly waived. README's per-hunk table and
  `receipt-audit.md` classify comments/types/config and harness-only diagnostic
  failures. No product-claim path is left unproven.
- **SUITE.** Retain `make verify-E6-T10d`, its 112-case grammar corpus and literal
  pixel sabotage; promote the verifier's IEEE/component sweep and four fresh
  mutation seeds. Replay commands, oracle independence and scope are in
  `README.md`. No findings requiring implementation changes remain.
