---
id: E6-T11d11
epic: 6
title: Execute bounded standard native point primitives and shader built-ins
priority: 525.0270390002
status: verified
depends_on: [E6-T11d10]
estimate: S
risk: high
capstone: false
---

## Boundary

One native point pipeline in the selected standard async renderer. Admit original
Gallium POINTS and validated finite positive rasterizer point size/per-vertex
selection. Extend only the standard compiler with vertex PSIZE and fragment
PCOORD in its original input and system-value forms. Preserve full original TGSI
register/instruction identity; execute those bodies on the GPU. PCOORD is a native
point-coordinate vec4 with z=0 and w=1 and the pinned GLES winsys-Y convention.
Keep PSIZE output words until native float point size is selected. Bind fixed or
per-vertex size and orientation using explicitly typed compiler metadata and
reflected native uniforms; no reuse of reserved system-block bytes, certificates,
CPU shader evaluation or hidden generic coordinate replacement.

The old pinned converter lacks PCOORD system-value support. A bounded internal
TGSI adapter may map just that builtin to one unused fragment input for upstream
validation; original tokens remain the emitter and public metadata authority.
No vendor patch, opcode replacement, source trimming, speculative admission or
silent warning acceptance. All scratch remains bounded by the fixed compiler
memory and is released on every failure.

Preserve original fetch/divisor/generic/restart/batch ownership limits and GPU
completion. Native point sizes clamp through actual GLES hardware; shader values
outside defined native domains retain standard undefined-domain authority only.
Every newly admitted original raster state participates in retained draw state
and A/B/A restoration. Legacy factories and decoder remain unchanged. This does
not activate complete API qualification, Rust production caps or guest graphics.

## Deterministic acceptance

`make verify-E6-T11d11` checks source inventory, compiler C warnings, native and
ASan/UBSan results, actual fixed-memory Wasm, literal packet/ABI and typed metadata
against independent pinned TGSI parsing. Include PSIZE full and x-only output
registers, PCOORD input/system aliases, original physical register collisions,
partials, duplicate/wrong-stage semantics, missing or forged raster metadata and
bounded OOM/recovery. Record new C coverage and actual served source custody.
Retain directly affected standard compiler and list/restart acceptance under
incremental verification; unchanged earlier records keep their original heads.

Actual headed hardware point draws must independently check native mode/arguments,
original IDs/indices/bounds, fixed/per-vertex/default size, PCOORD xyzw, positive
and negative viewport orientation, fractional sizes, native clamp, scissor,
near/far clip-center rejection, culling, overlap order, instancing/divisors/generics,
u8/u16/u32 exact/custom/disabled restart, offsets and tails. Full framebuffer
pixels are derived only from literal original wire/uploads and declared GLES
raster rules. Use off-boundary geometry so no unexplained edge waiver can hide
size/orientation failures. Original point-size output must affect covered pixel
area and original coordinate orientation must affect physical interior pixels.

Attack source revision/name reuse, cancellation and later fence schedules with
bounded source/read/work limits. Poison reflected uniforms and VAO/native state
between A/B/A contexts; verify original values before every native draw. Two
actual served regressions (size selection and coordinate Y) must complete a native
draw/fence and fail the independent original pixel oracle. Retained budgets must
return to zero. Seal hot recordings and one final pristine exact-head acceptance
with scrubbed environment. Only a fresh critic may verify.

## Adversarial verification

Predict original point size, area, coordinates, source IDs and native arguments
before opening the evidence. Independently seed one point-size/coordinate pattern
and delayed-fence schedule; exercise system/input physical register collisions,
fixed/per-vertex selection, near/far clipping and host clamp. Sabotage the promoted oracle
through real native GPU execution. Audit new C and JS runtime hunks and scratch
release on failure; authenticate original bytes, Wasm, browser custody and cold
head. Carry unchanged HELD results; no unrelated compiler arithmetic re-litigation.

## Verification log

### 2026-10-10 — worker — activated native point boundary

E6-T11d10 is verified at `c810cbef23caa7a19b090491ccc30c093d432518`.
The next readiness record `evidence/virgl-production-readiness/standard-point-gap.json`
binds the complete compiler/runtime source closure and generated Wasm to original
POINTS and rasterizer packets plus original PSIZE, PCOORD input and PCOORD system
TGSI. Each rejects with `unsupported-feature`. Decode each recorded packet through
`decodeStandardSubmission` and translate each complete shader through
`createVirglStandardShaderBridge().translate` to reproduce. This one coupled point
pipeline proceeds under the explicit production-graphics instruction. No positive
capset, complete API, actual guest offload or performance claim is made.

### 2026-10-10 — worker — bounded self-validation before freeze

The isolated selected renderer executes original POINTS, PSIZE at OUT31 and PCOORD
as input, system value, or both at the same original physical index. Standard
metadata adds typed POINT_SIZE vec2 and optional POINT_COORD_Y float bindings;
reflection checks their native types and stage component budgets. A bounded
32768-byte private TGSI arena maps only a system PCOORD alias for pinned upstream
validation. Original tokens remain emission/public metadata authority, and every
allocation failure releases scratch without partial output. Vendor and legacy C
prefix remain unchanged.

Ephemeral self-validation passes 118 original compiler cases with exact native/
Wasm results, ASan/UBSan equality, 78 allocation faults/recoveries, 38 literal
packet cases and 24 forged metadata rejects. The headed M4 Metal point matrix
passes 128 frames, 38400 full-frame pixels, 128 native draws and 25 private-buffer
captures. Both served native uniform regressions complete a draw/final fence and
fail the original pixel oracle. These pre-checks are not the frozen submission.

The first point matrix exposed an oracle error: GLES3 section2.18 clips point
centers against near/far planes, while an XY-outside point square may cover the
framebuffer. Corrected the literal oracle from the primary specification
<https://registry.khronos.org/OpenGL/specs/es/3.0/es_spec_3.0.pdf> and added explicit
near/far rejection alongside XY-outside coverage. No runtime workaround or
unjustified edge waiver was added. A pending-read fixture was also corrected to
exercise both actual waiting-index and waiting-attributes phases. The final
submission must run the full task gate and pristine clone once at the frozen head.

### 2026-10-10 — worker — submitted original native point evidence

Runtime/compiler freeze: `53e01e081ca7495960c6c51a15b585d4b66c64fe`.
Final receipt/harness freeze: `8ccd2036305321645d7f8b47cf7e2c1bcdced863`.
The runtime is byte-identical between these heads. The hot original full
`VIRGL_STANDARD_POINTS_EVIDENCE_DIR=target/evidence/virgl-standard-points-final
make verify-E6-T11d11` exited 2 after its directly affected compiler submission
passed: macOS Bash 3.2 rejected an empty flags array under `set -u`. Commit
`b49bc887b60fe9d13eba84684d20598d4217d3ec` changes only the wrapper/receipt
and resumes that passed compiler with `bash tools/verify-virgl-standard-points.sh
--resume-compiler`. All remaining native/ABI, Wasm, original-point and retained
list/restart hardware checks passed at b49bc887. Its final receipt then rejected
the retained compiler's log: that historical receipt prints its one success line
after hashing the log. Commit 8ccd2036 changes only the receipt; it authenticates
that exact appended line against the claimed prefix digest and keeps its own
receipt silent. It carries the unchanged b49bc887 physical recording under an
explicit ancestor/diff/source check. Both original failures, commands and heads
remain in the seal (`hot/harness-original-acceptance.log`,
`hot/harness-receipt-failure.log`, `hot/harness-correction.json`). No failed full
hot make is presented as successful.

The corrected narrow receipt command passed. One final pristine clone runs the
default complete `make verify-E6-T11d11` at 8ccd2036, with scrubbed environment;
exit 0 and empty checkout status before/after. Command:
`python3 tools/virgl-command/standard-point-cold.py --output
target/evidence/virgl-standard-points-final-cold`. The hot/cold results each hold
118 native/sanitized/original-Wasm point compiler cases, 78 actual allocation
faults/recoveries including the bounded PCOORD validation arena, 38 literal wire
cases, 24 typed metadata forgeries, 128 actual headed M4 Metal point frames,
38400 independently derived full-frame pixels, 128 native point draws and 25
private native index-buffer captures. Both source-uniform regressions finish
native point draws/fences and fail the original size/Y pixel oracle. Read
revision/reuse/cancellation, disposal, fixed/per-vertex selection and A/B/A state
restoration preserve original uploads and release bounded ownership. New C/V8
coverage, actual served source hashes, full blobs and screenshots are retained.
Directly affected compiler 669/129-frame acceptance, legacy/raw/private anchors,
retained 304-frame list and 189-frame default restart checks passed; historical
HELD seals are byte-identical to c810cbef.

Seal command: `python3 tools/virgl-command/standard-point-seal.py
target/evidence/virgl-standard-points-final
target/evidence/virgl-standard-points-final-cold
evidence/virgl-standard-points/worker`. The committed worker seal has 13269
records; archive SHA256
`797426c742a74686db9e4dbdf02135a58b8d30fec3433cd17a4f73e3bb78f846`,
index SHA256 `a0b3157348f6575e700686d6339c84a5c47b0b6ff236ccb6ff655481cba07ea4`.
Hot receipt SHA256 `764c953dc19ebbedd340ea45cbcba9ddf64175114cd7ec140623db2ae140717a`;
cold receipt SHA256 `99193c7b041e0e80638afb85af4501502e89b5bf801ab50e342552eb6726a0b0`.
Inspect manifest/records and the sealed hot/cold paths to reproduce every result.
This is an isolated standard native point claim. Complete API qualification,
typed production capsets, actual guest offload, deployment and throughput remain
outside its authority. Only a fresh critic may set verified.

### 2026-10-10 — fresh verifier — VERDICT: verified

Diff audited from `c810cbef23caa7a19b090491ccc30c093d432518` to worker submission
`3d9cfcd03f2eabe900c50173242834aa6ce5f0e6`. Predictions were recorded before
opening worker evidence in `evidence/virgl-standard-points/verifier/predictions.json`.
No implementation changes were made. All scoped predictions survived; findings
are empty in `verifier/verdict.json`.

- Custody — HELD. Predicted every archive member, receipt and current source
  hash would match. Authenticated all 13269 worker records, 13243 receipt files,
  517 source-closure files and 22 generated artifacts, including the original
  served Wasm. Runtime/compiler bytes remain identical from 53e01e08 through
  submission. Citation: `verifier/authentication.json`, worker archive SHA256
  `797426c742a74686db9e4dbdf02135a58b8d30fec3433cd17a4f73e3bb78f846`.
- Original compiler and bounded scratch — HELD. Predicted original full/x PSIZE
  slots 1/7/31, PCOORD IN/SV and physical aliases would preserve public register
  and instruction identity, agree across native/sanitized/fixed-16-MiB Wasm,
  and reject invalid stage/index/interpolation/duplicate built-ins. All 118
  cases agree (98 accepted); 78 actual allocation faults recover exactly with
  no partial output. The large 768-instruction adapter case stays inside its
  fixed 8192-token arena. Actual arena failure/recovery is at sealed
  `hot/retained-compiler/native/allocations.jsonl:65` and `:81`; upstream failure
  and successful scratch frees were inspected against LLVM segments.
  Citation: `verifier/checks.json`, sealed `hot/native/node.json`, compiler
  point/matrix/allocation coverage; identical cold records.
- Typed raster contract — HELD. Predicted POINT_SIZE FLOAT_VEC2 and PCOORD-Y
  FLOAT reflection, legitimate unused-Y optimization, stage component budgets
  and rejection before drawing. The 24 metadata forgeries reject; the novel
  unused PCOORD SV[1] shader executes with inactive Y. Original POINTS with
  constant-color blending exercises combined raster/blend bindings. Two
  instrumented host-limit attacks record actual and delivered limits and reject
  with zero draws. Citation: sealed critic `novel/report.json`, frames
  `critic-unused-point-coord`, `critic-point-blend-budget`, and host-limit
  rejections; `verifier/coverage-audit.json`, state.mjs:540, :621-622, :645.
- Native geometry and pixels — HELD. Predicted original IDs [7,9,12], native
  POINTS mode 0, type 5123, offset 12/count 3, sizes [2,4,5.25], exactly 45
  covered pixels, RGBA [119,223,32,128] at (2,3) and [119,96,159,128] at (3,4).
  Observed agreement within one native quantization unit. The separate literal
  oracle imports no worker point or renderer model and audits 256 hot/cold
  frames, 76800 full pixels and 59503458 original/native bytes. Fixed size 2048
  stays bound unchanged and clamps through measured native [1,511]; negative
  viewport uses Y=-1, near/far-outside centers cover zero, and a large XY-outside
  point covers the framebuffer. Citation: sealed worker
  `hot/hardware/report.json:135045`, `verifier/independent-replay.json` per-frame
  source/pixel digests and numeric predictions.
- Retained native ownership — HELD. Predicted original offsets, source indices,
  u8/u16/u32 restart/disabled maxima, divisors, generics and bounded work would
  survive. Independently decoded uploads equal actual VBO/EBO bytes; normalized
  indices substitute only the restart marker. Waiting-index/attributes retain
  one/two active reads; revision, reuse, cancellation and disposal preserve the
  recorded generation until real completion/drain, then all budgets are zero.
  Poisoned uniforms/VAO/EBO/raster state restore before native draws; A/B/A
  first/final pixels agree. Citation: `verifier/independent-replay.json`, sealed
  worker hardware frames/read/fence records and `verifier/novel-replay.json`.
- Independent seed and sabotage — HELD. Predicted a separately seeded original
  alias/size/coordinate pattern and delayed native fences would satisfy the
  promoted literal oracle. Seed 770354451, base 66384, marker 16777545 and
  original IDs [66387,66413,66445,66481] produce 14 actual headed M4 Metal
  frames/draws, 5632 full pixels and 40410440 authenticated original/native
  bytes. Both actual served uniform mutations complete POINTS draw and final
  fence, then fail that oracle: size binds [1,0]; Y binds +1 instead of -1
  (green 32 expected, 223 observed). Both failures were independently rechecked.
  Citation: sealed critic `novel/report.json`, `fault-size-selection/report.json`,
  `fault-coord-y/report.json`, `verifier/novel-replay.json`; served test SHA256
  `2d94376ad9873de253fb6b29876b5ab988b22b52d588764f0f45cfdf4a0d74e6`.
- Changed-hunk sufficiency — HELD. Exact-source LLVM/V8 coverage accounts for
  all 173 added runtime C/JS lines: 148 executable lines hit, 23 structural
  waivers (headers/enums/comments/signatures/braces), and two defensive waivers.
  bridge.c:2318 reparses immutable internal tokens already accepted by text
  translation/constant ordering/parse initialization; its failure requires
  corruption, and its free was inspected. bridge.c:2355 default is unreachable
  in the accepted DECL/IMM/PROPERTY/INSTRUCTION body grammar. The no-unused-input
  guard cannot fill 32 slots from POSITION+PCOORD+16 GENERIC inputs. No changed
  claimed behavior is dead or missing proof. Citation:
  `verifier/coverage-audit.json` (per-line counts/reasons and source digests).
- Cold and carry — HELD. Predicted one pristine exact-head default full make
  would pass with scrubbed environment and empty checkout before/after. It
  passes at `8ccd2036305321645d7f8b47cf7e2c1bcdced863`; sealed cold log SHA256
  `3071e6ec9e76f4a1ef8bd759e09d62d466240dee692eacc380c9b90b82205bfd`.
  The original hot full make failed, and the later hot receipt failed; both
  failures remain sealed. The receipt-only correction carries unchanged b49bc887
  physical bytes and authenticates precisely the retained compiler's success
  append after its original prefix hash. Directly affected 669-case/129-frame
  compiler, 304-frame list and 189-frame restart records hold. Historical
  draw/constant/topology/restart/assembly seals are byte-identical to c810cbef;
  unchanged HELD checks are carried without unrelated arithmetic reruns.
  Citation: `verifier/authentication.json`, `verifier/checks.json`, sealed
  `cold/report.json`, `hot/harness-correction.json` and both original failure logs.

SUITE: promoted `renderer/virgl-command/tests/standard-native-points-adversarial.mjs`,
`tools/virgl-command/standard-point-adversarial-oracle.mjs`,
`tools/virgl-command/standard-point-verifier.mjs` and recurring
`bash tools/verify-virgl-standard-points-adversarial.sh`. The recurring command
passed the independently seeded native run, both expected native sabotage
failures and offline audit; `STANDARD_POINTS_ADVERSARIAL_COMPLETE` is recorded.
Authentication/replay/coverage commands:
`python3 evidence/virgl-standard-points/verifier/authenticate.py`;
`node tools/virgl-command/standard-point-verifier.mjs
target/evidence/virgl-standard-points-critic/worker
target/evidence/virgl-standard-points-critic/independent-replay.json`;
the same replay tool with the critic root/output and `critic` argument;
`python3 evidence/virgl-standard-points/verifier/coverage_audit.py`.
Final promoted sources pass Node syntax, Bash syntax, Python compile and diff
whitespace checks. No unrelated acceptance suite was restarted.

Critic seal: `python3 evidence/virgl-standard-points/verifier/seal.py`.
`evidence/virgl-standard-points/verifier/recording.tar.gz` contains 360 records,
all independently reopened against `records.json`; archive SHA256
`47527ba78396a7efb9d1f0986665d32c3bef08b64038c857d610549926d5a7cd`,
index SHA256 `54d4c071a76a4188a5acac85f8046af3e727dd0f7d86c128ca5a233deda6833b`.
It retains predictions, authentication, per-hunk audit, both independent replay
results, novel/fault physical blobs/screenshots/coverage and the recurring run.
Worker archive custody is linked by digest rather than duplicated. These results
verify only isolated standard native points. Complete API/capsets, actual guest
offload, deployment and any MIPS claim remain outside this task's authority.
