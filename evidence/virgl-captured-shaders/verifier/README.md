# E6-T10d fresh adversarial verification

VERDICT: verified

Runtime under review: `8759a30622e6604b8cd3d5c35d110260c6fd1943`.
Worker handoff: `b29ef95e`. Review base: `d0a5b1fc`.
Predictions in `predictions.md` were saved before reading worker evidence.
No implementation file was edited. Verifier browser reports show the handoff
head; the runtime sources, captured inputs and Wasm equal the frozen head.
`digests.json` binds every verifier artifact below.

## Results

- P1 HELD: the exact captured bytes, generated native/Wasm outputs, all 102
  receipt source hashes, six compiler hashes, subordinate reports and screenshots
  match. Final scrubbed pristine clone is clean before/after and passed the full
  prescribed gate. See `receipt-audit.md`, its independent checker and JSON.
- P2 HELD: fresh headed Chrome hardware run produced 768 literal exact pixels
  in three indexed u16 draws from the unchanged captured pair. Reflected vec4
  inputs use original two-component attributes; generic declaration/written masks
  are xy while actual varying remains vec4. Sampler2D, one COLOR0 output, tint,
  nearest sampling and quarter-alpha blend match the original source workload.
  `captured/report.json` records input/output hashes, reflection and zero browser
  errors; `captured/browser.png` was visually inspected.
- P3/P4 HELD: reseeded native ASan/UBSan run passed all 112 malformed fixtures,
  302 valid boundary cases, 517 truncations, 8,192 mutations and 18,246 exact
  captured-pair recoveries. Seeds: 61706c65, 7ea053bd, 2468ace1, dd00f123.
  `native-independent.log:115-125` and `native-independent.json` bind the run.
  The captured browser repeats 112 malformed fixtures and 1,792 recoveries.
- P5 HELD: all 19 captured native body outcomes independently replayed, seven
  translated / twelve rejected. Only the captured pair has this task's rendering
  claim. Nine original draws/4,336 pixels and all six original GLSL hashes remain
  identical to T10a. PRECISE/Z32_UNORM stay rejected and production 3D stays off.
- P6 HELD: independently reran texture-texel sabotage. Exit 1 at phase 0,
  pixel(4,4), expected [255,0,0,255], observed [0,0,0,255], with clean WebGL/browser
  state. `sabotage/report.json:905` and its failure screenshot preserve the point.
- P7 HELD: independent IEEE sign/exponent/mantissa predicate predicts native and
  Wasm results for all sign/exponent combinations at three mantissa boundaries,
  zero padding and overflow aliases. All 256 swizzles of xy-only fragment input
  accept exactly when every selected lane is declared. Adjacent source/destination
  range, immediate ordering and file-kind guards also reject. Total 1,850 cases:
  914 accepted, 936 rejected, 7,400 unchanged recovery outputs. Full case names,
  predictions, observations and result/input hashes are in `numeric-attack.json`.

The numeric oracle uses integer IEEE layout and the independently specified
1e6 boundary (0x49742400), not bridge output. The rendering oracle is the literal
original workload quadrant data, not another translator or readback golden.
Recovery compares with the initial successful conversion only to detect state
corruption; the initial pair's semantics are independently checked by pixels.

## Coverage held against the diff

LLVM source coverage comes from the frozen bridge with observational counters,
ASan/UBSan, the reseeded native harness and numeric/component stream attack.
`changed-coverage.json` lists each of 93 added lines: all 81 instrumented lines
execute, and the remaining 12 are comments/types/structure. `bridge-coverage.txt`
records line and branch hit counts.

| Changed runtime hunk | Evidence / classification |
| --- | --- |
| Register/profile fields and operand kind | Declarative types; exercised by all succeeding runtime paths. |
| TEMP declaration range guard (bridge.c 118-133) | All 36 bounded ranges accept; reversed, overlapping, oversized, non-TEMP and operand ranges reject. Both outcomes of every added dynamic range guard execute. |
| Masks/swizzles (134-165) | All 256 source swizzles, valid xy/z/w destinations and xy declarations; malformed lengths/order/lanes and undeclared component reads reject. Full TEMP-before-read remains enforced. All new dynamic branch outcomes execute. |
| UINT32 parser (181-196) | Overflow and >10 digits reject before arithmetic; zero/normal bounds pass; subnormal, nonfinite and >1e6 reject. Both dynamic branches execute. Clang's `isfinite` expansion has compile-time folded arms: waived, not an untested runtime alternative. |
| Declaration components (198-233) | Overlap and declaration ranges, component masks and non-GENERIC masks execute. `r.mask != 3` at line 223 cannot be true after the preceding declaration parser restricts masks to 15 or 3: waived defensive redundancy. |
| Destination and sampler guards (236-259) | Complete and masked MOV output writes pass; partial TEMP, masked arithmetic/TEX, undeclared components and swizzled sampler reject. Both new dynamic outcomes execute. |
| Immediate/property/output validation (277-315) | Both FLT32/UINT32 paths execute, including mixed valid declarations; order/format failures reject. Invalid/duplicate/late/vertex properties reject; correct fragment property succeeds. Missing POSITION/COLOR/generic components reject. |
| Metadata (328-335, 381-392) | Native/Wasm captured output equality plus actual hardware reflection and version/mask assertions. Both IN/OUT metadata branches execute. |
| Native test additions/legacy case replacements | All success paths execute under reseeded sanitizers. Failure-only test assertion diagnostics are waived harness reporting. Old newly valid negative expectations are replaced by independently tested invalid neighbors. |
| Browser captured suite | Translation, input hashes, all negative/recovery loops, reflection, bindings, three pixel phases, success screenshot and resource cleanup execute; sabotage executes pixel-failure/screenshot branch. Allocation/reflection/network/assertion failure-only diagnostics are waived harness reporting. |
| Build/scripts/shared runner/contract/docs | Per-hunk executions and diagnostic-only waivers are documented in `receipt-audit.md`. No production web, Rust, upstream source, fixed key or guest-device diff exists. |

Unchanged T10a evidence digests and dependency boundaries carry forward only as
listed by `receipt-audit.md`; the old grammar coverage is not used to excuse new
branches. No requested behavior remains unexecuted or refuted.

## Replay and promoted artifacts

From the repository root:

```sh
python3 evidence/virgl-captured-shaders/verifier/native-coverage.py
node evidence/virgl-captured-shaders/verifier/numeric-attack.mjs
python3 evidence/virgl-captured-shaders/verifier/coverage-report.py
python3 evidence/virgl-captured-shaders/verifier/receipt-audit.py
node tools/verify-virgl-captured-shaders.mjs --output target/evidence/t10d-verifier-render
node tools/verify-virgl-captured-shaders.mjs --output target/evidence/t10d-verifier-sabotage --sabotage texture-texel
```

The last command must exit 1 at the exact predicted pixel; an unrelated failure
does not pass. The Wasm build and local Chrome are prerequisites (the prescribed
`make verify-E6-T10d` builds/checks them). The receipt checker reads the retained
cold-clone binary; preserve that clone or rerun the cold acceptance if it is gone.

SUITE: retain `make verify-E6-T10d`, shared 112-case fixture and pixel sabotage,
and promote the verifier IEEE/component sweep and four independent seeds here.
No unrelated guest-command replay, performance or production deployment gate is
added to this isolated frontend claim.
