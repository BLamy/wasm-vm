---
id: E6-T12e1
epic: 6
title: Admit bounded declaration ranges and initialized component writes
priority: 525.0269901
status: verified
depends_on: [E6-T11c]
estimate: S
risk: high
capstone: false
---

## Boundary

Extend the existing straight-line MOV/ADD/MUL/MAD/TEX/END profile only enough
to accept these four unchanged original bodies:

- `003270109615e05345631cf8a2273ebc1bf3d86c7590e05ddc8424c441db7605`
- `9819066def2df1cd09f36f142fd2bc6b659395aa21bea6db7f58fbcc122c7c83`
- `403b0529c632d3d2ffe4584ede810f5745e8b76ca2ab4f575e1073d8f29fcf0c`
- `e9bc6d3b61e3cda2c215ac8b44a432e2eb1bd4891cfa921c6f914fd3fd86b551`

Add CONST declaration ranges within the existing constant bank and TEMP
indices through 9. Preserve existing IN/OUT/IMM/SAMP/SVIEW limits. Add GENERIC
xyz declarations and x/y/z/w, xy and xyz destination masks for MOV/ADD/MUL;
keep the existing full-vector operation forms. Unsupported noncontiguous,
duplicate or unordered destination/declaration masks remain rejected.

Track initialized lanes per register. Determine each instruction's consumed
source lanes from its opcode and destination mask before applying its source
swizzle: componentwise arithmetic consumes the destination lanes, and 2D TEX
consumes xy. A repeated source swizzle may select already initialized lanes;
unconsumed source lanes must not create false uninitialized-read failures.
Every lane consumed by an admitted instruction must be declared and initialized,
and all declared output lanes must be written before END.

Keep 16 KiB text, 8192 tokens and 128 instructions. Do not add opcodes,
modifiers, flat interpolation, integer interpretation, structured control flow,
ADDR, indirect indexing or PRECISE. Do not rewrite captured text.

## Deterministic acceptance

`make verify-E6-T12e1` hashes every original body and requires exactly 11 of
19 to translate: the existing seven plus the four hashes above. Record every
remaining rejection by hash and reason. Require native sanitizer/Wasm output
and metadata parity, actual ESSL300 compile/link, and independent pixels for
both original texture fragments and both original affine/matrix vertex bodies.
Use distinct non-identity constants and components so a dropped xyz lane or
wrong source swizzle cannot pass. Preserve the prior nine literal draws and
three captured textured-scene phases. Record final exact-head and clean-clone
evidence. Production negotiation and full-workload compatibility stay unchanged.

## Adversarial verification

Attack reversed/overlapping/oversized declaration ranges, numeric overflow,
TEMP9 versus TEMP10, existing per-file index boundaries, missing selected lanes,
read-before-write, repeated source swizzles, malformed masks and incomplete
outputs. Sabotage one consumed-lane computation or masked write and require an
independent pixel/native assertion to fail. The flat fragment and every
PRECISE-bearing original must remain rejected.

## Verification log

### 2026-10-03 — worker — activated

The independently verified T11c parent is `fa7114021eef485be362754320cce4c06583d695`
(PR414). The original-hash inventory selects this smallest declaration/lane
boundary before integer, flow and precision work. No other task is active.
Production GPU negotiation remains disabled. This isolated shader C/Wasm profile
uses the affected sanitizer/native/Wasm/hardware-browser risk-tier gates and a
final pristine clone; unchanged Rust and default-web targets carry forward.


### 2026-10-03 — worker — implemented

Frozen runtime/harness head: `ae3bdf0f1d707f239b00907269f5c783fcf597e5`.
The v3 guard accepts exactly the four unchanged originals named above, bringing
raw original outcomes to 11 translated, seven unsupported-feature (all PRECISE)
and one parse-error (the CONSTANT/flat fragment). No captured bytes or upstream
source were rewritten. TEMP 0–9 and CONST ranges 0–7 are bounded separately from
all other 0–7 banks. Ordered source selectors map consumed destination lanes
(or xy for 2D TEX) to required declared/initialized lanes. Writes publish only
after every source validates. MOV/ADD/MUL permit the listed masks; masked MAD/TEX,
noncontiguous masks, flat interpolation, modifiers, integer/control flow and
PRECISE remain rejected. LIMITS and metadata expose the v3 boundary.

Recorded commands:

```sh
EMCC=/tmp/wasm-vm-emsdk/wasm-vm-emcc \
VIRGL_COMPONENT_EVIDENCE_DIR=evidence/virgl-components/worker make verify-E6-T12e1
python3 tools/virgl-components/cold.py --output evidence/virgl-components/cold-clone
```

Both complete gates passed at the frozen head. Native ASan/UBSan evidence includes
249 explicit component cases (157 accepted/92 rejected), all 55 TEMP ranges,
all 36 CONST ranges, 64 selected-lane combinations, 1,548 truncations and 4,096
mutations across four independent fixed seeds: 29,469 translation calls and 23,572
exact four-original recoveries. The earlier hostile suite passed 8,769 calls/
4,096 mutations; the earlier captured suite passed 27,371 calls, 112 negatives,
302 positive boundaries, 8,192 mutations and 18,246 recoveries. Eleven now-valid
historical negative fixtures were replaced with adjacent still-invalid inputs;
the new fixture proves the admitted forms positively. No negative was silently
ignored. Strict guard warnings, Python/Node syntax and five contract negative
unit tests passed. Only the unchanged pinned upstream sprintf deprecation
warnings appeared in native builds.

Headed hardware Chrome 154.0.8037.93 on Apple M4 Max / ANGLE Metal compiled and
linked all four new originals in ten real draws: both texture/intensity
fragments at brightness 0,0.5,1, followed by affine and mirrored draws for each
vertex body. All 4,736 independently expected pixels matched (six 256-pixel
texture checks plus four 800-pixel geometric/depth checks). Native and Wasm
GLSL/metadata agree exactly for all 19 original bodies and every one of 249 shared
cases; 1,992 valid recovery conversions preserve output and metadata. The
receipt independently reconstructs pixel coordinates/colors using exact rational
geometry, not GPU output or shader text. The source omission control successfully
compiled the original affine VS with its xyz write reduced to xy and z=0; it
failed the seventh draw at pixel(15,4), expected[255,64,128,255], observed
[0,0,255,255]. The exact generated-source rewrite and both hashes are recorded;
TGSI stays unchanged. Worker and cold screenshots were visually inspected.
All browser console/page/request error arrays are empty. The nine prior literal
draws/4,336 pixels and original textured-scene three phases/768 pixels also pass.

Served shader Wasm: 258,527 bytes, SHA-256
`f2d4c721eaccebe8d967f8ba3d87b62228e2b7add4066971d7ab5560c8ec45eb`.
The final pristine clone runs the complete acceptance with compiler/build/runtime
overrides scrubbed, begins/ends at the exact head with empty Git status, and
retains its checkout and all copied evidence. No repair or retry was needed.
The outer duplicate worker launcher log was moved outside the evidence directory
before receipt creation; the complete canonical acceptance.log remains recorded,
and completed receipt record digests were rechecked afterward.

This is an isolated C/Wasm shader frontend proof with original guest capture
bindings. No Rust/device/default web runtime or production capset changes, so
those unchanged targets and live deployment carry forward from verified T11c.
This establishes neither full Mesa/compositor support nor FPS/MIPS improvement.
The remaining eight originals and production 3D negotiation stay gated.

Evidence roots: `evidence/virgl-components/worker/` and
`evidence/virgl-components/cold-clone/`. SHA-256 anchors:

- `worker/receipt.json`: `2c9115baa9649dbf7b8f4dfe01227c99e61e66538e19d00ded00eb1ef8a5743a`.
- `worker/native/native-report.json`: `ce05328566885a05bdd623039710f942b895a3bbfb9564866942435d79823a35`.
- `worker/hardware/report.json`: `59b6cec2b10014e590a6c66926b5236b5fcc677d7631f3a438704a6b9e4c5f09`.
- `worker/hardware/browser.png`: `9073d69aaf69ce9fe9737ab2483a08f2a313a7b8cf9ac92885598257880642da`.
- `worker/sabotage/report.json`: `bedf2e2270fae14f0a4e74519e291af16a1594093983c4b342e5f98198dea642`.
- `worker/regression/receipt.json`: `9204e328038cbb4192f35c88dc57b3ebe91f39e957f6fbac7d3334ea44060ee3`.
- `cold-clone/report.json`: `342c6cab2d83e6ca7af732b9a703a5684e13890ec30f840c759521a966d9f976`.
- `cold-clone/acceptance/receipt.json`: `32d2d19d454a92d977bb52193faaa7e1291a1875559a56991d416273e10be7c5`.
- `cold-clone/acceptance/hardware/report.json`: `804cd605d72a3549afd5e58c971333cff793807f789f04c6be8b8dda326d9f4b`.
- `cold-clone/acceptance/hardware/browser.png`: `8c709a10d2419700f4e6118022b3e67b5bddf3d712a352eac6b43964f6dfc8ad`.

### 2026-10-03 — independent verifier — VERDICT: verified

VERDICT: verified

- C01–C18 — HELD. Immutable predictions preceded worker evidence; exactly 11/19
  unchanged originals translate, including precisely the four task hashes. All
  seven PRECISE originals and the flat fragment remain rejected. Independent
  exhaustive initialized-lane/ordered-swizzle/destination-mask cases, TEX xy,
  aliasing, range/index/mask/grammar bounds and recovery survived falsification.
- Native/GPU — HELD. Own 34,498 cases produce 55,921 ASan/UBSan translations and
  21,423 exact recoveries with no sanitizer diagnostics. Actual hardware browser
  has exact native/Wasm parity for 845 cases, 7,146 assertions and 6,238 checked
  pixels; original affine/matrix clip vectors match all four preselected values.
  Actual native GL counters return zero; browser errors are empty. Screenshot
  was independently viewed. Prior nine literal draws and three captured phases
  remain held through the final same-source regression.
- C17 sensitivity — HELD. Independent consumed-selector source omission fails
  its intended native assertion. The helper identified that a z-only swizzle
  error could evade the worker's depth-threshold pixels; own hardware transform
  feedback closes this gap. Corrupting only the affine z selector changes
  expected z0.6875 to0.5625 and fails the exact vector assertion. The limitation
  and resolution are both retained; no runtime change or worker rerun occurred.
- COVERAGE — HELD. Source-bound Clang counters execute all 24 added executable
  C lines and every reachable changed condition. Nine non-executable lines and
  the single redundant parser-invariant outcome at bridge.c:230:58–69 have
  explicit narrow classifications in `verifier/coverage-review.md`; no accepted
  semantic behavior is waived.
- C18 evidence/isolation — HELD. Fresh helper binding audit passes 14,355 checks,
  main own-result audit 56,023. Worker and cold receipts bind exact frozen head
  `ae3bdf0f`; cold runs the complete gate clean before/after with scrubbed
  overrides. Unchanged upstream/Rust/default-web proof carries forward; no
  additional pristine clone was needed.
- SUITE: retain independent lane-set generator, targeted branches, original-body
  GPU vector/pixel tests, two sabotage controls and coverage/binding audits.
  Compiled binaries/objects/profiles remain under ignored `target/`. Production
  3D, full workloads and flat/flow/integer/PRECISE support remain unclaimed.

Full prediction points, exact commands, source/dependency classification,
verifier-harness refinement disclosures and verdict are in
`evidence/virgl-components/verifier/review.md` and `observations.md`. Commands:
`python3 evidence/virgl-components/verifier/build-native.py`, `native-attacks.py`,
`supplemental-native.py`; `node evidence/virgl-components/verifier/run-gpu.mjs`
with `baseline` and `wrong-z-swizzle`; `python3` on verifier `coverage-audit.py`,
`binding-audit.py`, `final-audit.py`. Only verification evidence/task/queue changed.
SHA-256 anchors:

- Predictions: `5fe2743631e39d7ae47169d728df315f41c368f82106f786ebe999e144896692`.
- Manifest: `29732710d1cf4fad10e7ea8af4aea3eb0d486f12025fb97bf4351832628e43e0`.
- Review: `a928013cf924db71cd48d077002bd1bcc9014e535aec7e08cbaefba036d8ae5f`.
- Native: `cfac6954f91e80a686513fb24bbf237d5a765ea4e830db1d965b2df62a5db484`.
- GPU: `5ac79a35607b9a660eef89dedb490fa09e5420b2ad9e676ee053849bccafa807`.
- Coverage: `47a81f85f752c30c771a358f8bf788552fb3bcc9c56653940530bd331585c4ef`.
- Final own audit: `20ab1d1508262e73ef4e75a978b54ee810193e8e94f0e9ed054b237138ddf872`.
- Binding audit: `f39f64bda2d0fc37d6b61e7b5d890e13241c96f6931d79431dcfb1033f1e0aef`.
- Final cold receipt: `32d2d19d454a92d977bb52193faaa7e1291a1875559a56991d416273e10be7c5`.
