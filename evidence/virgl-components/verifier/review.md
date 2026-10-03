VERDICT: verified

The E6-T12e1 claim survives independent falsification, with the additional exact
vertex-coordinate proof retained as part of the acceptance evidence. All C01–C18
predictions are HELD (`observations.md`). Initial predictions preceded worker
results and retain SHA-256
`5fe2743631e39d7ae47169d728df315f41c368f82106f786ebe999e144896692`.
This verifier implemented no part of the shader runtime. A fresh independent
helper performed the binding sub-audit, not implementation workers.

- **Corpus/profile — HELD.** All 19 original bodies match their prior and frozen
  bytes. Exactly 11 translate: seven prior bodies and the four task hashes. The
  remaining seven PRECISE originals and one flat/CONSTANT fragment stay rejected.
  `binding-audit.json` independently binds native/Wasm outcomes and recorded
  rejection reasons by full hash. No captured text is rewritten.
- **Initialized/consumed lanes — HELD.** Own 34,474 generated cases and 24 targeted
  branch cases produce 55,921 ASan/UBSan translations, including 21,423 exact
  known-good recoveries. The 16 initialization subsets ×256 ordered selectors
  ×7 destination masks form an independent exhaustive MOV set oracle; TEX xy,
  self-aliasing MOV/ADD/MUL, all range endpoints and malformed syntax extend it.
  All expected outcomes hold with empty sanitizer stderr (`native.json`,
  `supplemental-native.json`). Actual browser comparison checks 845 native/Wasm
  results exactly, including GLSL/metadata (`gpu.json:168`).
- **Original shader execution — HELD.** `gpu.json:177` onward records both original
  fragments against preselected asymmetric texels, UV centers, half brightness
  and unequal alpha. The exact affine vector is `[0.5,-0.4375,0.6875,1]`
  (`:305`); the exact matrix vector is `[0.59375,-0.125,0.3125,1.375]` (`:392`).
  These expected constants/input/results were written before evidence. Actual
  hardware transform feedback observes all four coordinates and affine varying
  xy. Independent triangle geometry adds real canvas pixels at `:351` and `:441`.
  Total: 7,146 browser assertions, 6,238 pixel checks, zero browser/GL errors and
  all native GL object counters zero. The final screenshot `gpu.png` was viewed.
- **Oracle sensitivity — HELD.** The isolated native consumed-selector omission
  rejects the otherwise valid `lane-1-xxxx-w` case (`sabotage-native.json:4`).
  The hardware z-only swizzle corruption changes affine z from0.6875 to0.5625
  and fails the exact clip-vector assertion (`gpu-sabotage.json:359`). Both
  source controls bind their original/mutated artifacts and intended failure;
  no shared implementation file was edited. The worker's masked-write control
  independently fails its recorded foreground pixel.
- **Coverage — HELD with one narrow invariant waiver.** Source-bound Clang
  counters execute all24 added executable C lines and every reachable changed
  condition. Nine added lines are declarations/signatures/comments without
  executable counters. `bridge.c:230:58–69` retains an impossible redundant
  declaration-mask outcome: earlier parsing permits only15,3,7, and the preceding
  conditions already exclude15 and3. The supported inputs can only reach it with7.
  This is not an unused semantic fallback or waived acceptance behavior.
  `coverage-review.md` accounts for every changed runtime/harness hunk.
- **Recorded evidence and isolation — HELD.** The fresh helper's14,355 checks bind
  worker/cold source, toolchain, executable, served files, outcomes and pixels;
  the main own-result audit adds56,023 checks. The cold clone remains clean at
  the exact frozen head before/after the full gate, with configured environment
  overrides scrubbed. No additional clone was needed. Final same-source nine
  literal draws/4,336pixels and three captured phases/768pixels hold; unchanged
  upstream/Rust/default-web boundaries carry forward.

The helper identified a real limitation in the worker's depth-threshold pixel
oracle: a z-only source-swizzle error could preserve all its foreground/depth
choices. That limitation is not hidden or dismissed. This verifier's independent
actual clip-vector observations and the specific failing z-only corruption close
it without a runtime fix or another worker/cold run. Both the limitation and its
resolution remain in `binding-review.md`, `observations.md` and these recordings.

Runtime/harness: `ae3bdf0f1d707f239b00907269f5c783fcf597e5`; activation/base
`ebd18189`; formal worker submission `2b17963668dcd06f3378366478e6164b2ec2d6d4`.
The only verifier refinements were targeted harness inputs to reach missing-token
punctuation branches and to apply the vertex stage to the POSITION case. They
were rerun before final coverage; earlier profiles are isolated in ignored
`target/.../calibration`. Product and worker evidence were unchanged.

Replay from repository root, after the task's pinned build prerequisites:

```sh
python3 evidence/virgl-components/verifier/build-native.py > evidence/virgl-components/verifier/native-build.log 2>&1
python3 evidence/virgl-components/verifier/native-attacks.py
python3 evidence/virgl-components/verifier/supplemental-native.py
node evidence/virgl-components/verifier/run-gpu.mjs baseline
node evidence/virgl-components/verifier/run-gpu.mjs wrong-z-swizzle
python3 evidence/virgl-components/verifier/coverage-audit.py
python3 evidence/virgl-components/verifier/binding-audit.py
python3 evidence/virgl-components/verifier/final-audit.py
```

Keep earlier raw profiles separate before a fresh replay. Native code is built in
`target/virgl-components-verifier` with assertions, AddressSanitizer,
UndefinedBehaviorSanitizer and source coverage. Browser runs use headed actual
Chrome154 / Apple M4 Max / ANGLE Metal, with no software-GPU override. The exact
served Wasm matches the worker/cold artifact. Build objects/binaries/raw profiles
are excluded from the commit; source generators, structured recordings, coverage
exports and digest receipts are retained.

SHA-256 anchors:

- Native cases: `cfac6954f91e80a686513fb24bbf237d5a765ea4e830db1d965b2df62a5db484`.
- Actual GPU: `5ac79a35607b9a660eef89dedb490fa09e5420b2ad9e676ee053849bccafa807`.
- Binding audit: `f39f64bda2d0fc37d6b61e7b5d890e13241c96f6931d79431dcfb1033f1e0aef`.
- Coverage census: `47a81f85f752c30c771a358f8bf788552fb3bcc9c56653940530bd331585c4ef`.
- Worker receipt: `2c9115baa9649dbf7b8f4dfe01227c99e61e66538e19d00ded00eb1ef8a5743a`.
- Cold receipt: `32d2d19d454a92d977bb52193faaa7e1291a1875559a56991d416273e10be7c5`.

SUITE: retain the independent lane-set generator, targeted syntax/bank cases,
original-body transform-feedback and pixel tests, both sabotage controls and
coverage/binding audits as repeatable regression artifacts. No code fix is
required. This remains an isolated bounded straight-line shader proof; production
3D, flat/flow/integer/PRECISE support, full guest workloads and performance remain
unclaimed.
