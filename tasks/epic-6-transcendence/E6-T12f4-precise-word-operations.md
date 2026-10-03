---
id: E6-T12f4
epic: 6
title: Preserve PRECISE comparison selection and copy semantics on the GPU
priority: 525.0269914
status: verified
depends_on: [E6-T12f1]
estimate: S
risk: high
capstone: false
---

## Boundary

Audit the pinned per-instruction TGSI PRECISE meaning and implement only
FSEQ_PRECISE, FSNE_PRECISE, MAX_PRECISE and MOV_PRECISE as checked exact word
operations. Retain the modifier in IR; do not strip it or assume an unavailable
ESSL300 precise qualifier. Preserve source order, consumed lanes, selected word
identity, signed-zero ties and required NaN behavior under an explicit contract.
Audit MAX against the pinned TGSI definition rather than inheriting GLSL max's
tie behavior. Preserve numeric/output authority and all bank/control obligations.

Instruction-local flags do not automatically create an exact backward RSQ/DP3
cone; justify the scope from pinned tokens and Mesa conversion behavior. Keep
ADD_PRECISE/MUL_PRECISE rejected until their separate arithmetic boundary. Any
newly accepted original must retain its original SHA and its domain contracts.

## Deterministic acceptance

`make verify-E6-T12f4` records the semantic audit, both-stage exact word oracles
for predicate/select/copy paths, signed-zero and NaN position witnesses, source
aliases, computed operands and newly supported original compile/link paths.
Require native sanitizer/Wasm parity, previous independent leaf regressions,
actual shared-renderer GPU proof, bounded output/storage and final cold clone.

## Adversarial verification

Swap MAX operands on equal/unordered inputs, conflate signed zeros with raw
integer equality, lose FSNE's unordered result, drop a PRECISE flag or erase an
obligation from a combined result. Actual compiler-source faults must fail the
independent word oracle. Do not promise NaN payloads/subnormals through raster
boundaries that only have the existing floating-output contract.

## Verification log

### 2026-10-03 — worker — activation

E6-T12f1 is verified at `2a0d0359de37452d5a78bb9ab6fbf8583c69cb7c`;
the preceding radial boundary is verified at
`220c2640d8c75df4decae10a3aa12a7be150897f`. Audit the pinned virglrenderer
1.3.0 instruction Precise bit, text suffix parser and upstream destination
qualifier behavior against the stable Mesa 24.2.8 TGSI definition. Retain a
per-instruction flag in checked IR and implement only the four exact word
operations named by this task. MAX selects the second source on equal or
unordered comparisons, preserving the selected word including its zero sign
or NaN payload. Do not infer exact upstream RSQ/DP3 arithmetic from a marked
copy or comparison. ADD_PRECISE and MUL_PRECISE remain separately gated.

Preserve every numeric/output and owned-bank/control obligation under a closed
precision contract. Record independent both-stage word oracles, consumed
swizzles and aliases, actual shared-renderer GPU results, real compiler-source
sabotage, sanitizer/Wasm parity, retained independent leaves, caps and a final
pristine clone. Original bodies retain their capture hashes. This isolated
compiler/shared-renderer slice neither enables guest negotiation nor claims
desktop 300 MIPS; original radial output authority remains its own boundary.

### 2026-10-03 — worker — fixed-heap refutation and semantic repair

The first canonical run at `b8743ae4f6417017fd3f15693ac11d6813ac5787`
passed the pinned token audit, native ASan/UBSan with 1,401,891 calls, and normal
Wasm agreement for all 19 originals, 4,428 cases and 511 pairs. It then failed
the unchanged fixed-memory pressure schedule: `wasm/calls.jsonl` line24440,
index24439, `profile-26-fragment-mixed-pair` returned `ok:true` with four
`(null)` source operands in its ordinary vertex GLSL. The complete call log
SHA-256 is `df4b20b9f9bf4bdadd65959f355d0d20279fd6deec23f29ea14aaa44685f9450`;
the serialized erroneous result digest is
`14ae1b6e8515afac1bc08b5d4e91e82cca71b49827e892c4564016df58d4beeb`.
The raw failed run remains in
`target/evidence/virgl-precise-word-worker-b8743ae4` and is retained with the
final evidence submission. This was a runtime refutation, not a proof-reader
repair; no final cold run has yet been counted.

An owned wrapper now compiles the unchanged pinned translator with checked
nonzero malloc/realloc failure latching. It safely initializes ignored strbuf
failures and reserves lazily grown operand storage before formatting. The
bridge resets and checks the latch around each ordinary conversion, before
another stage can clear it or a partial shader can be published. The pinned
so_info calloc is unreachable with the bridge's zeroed, owned shader-info key;
it is not a new allocation API. Production exposes no fault-injection control.

Strict guard checking and ASan/UBSan smoke preserve every complete healthy
original/case/pair result, exercise 209 existing owned allocation failures plus
all 20 malloc/realloc sites in four ordinary/mixed witnesses, and recover every
58 single/56 paired profile anchor. The selected high-risk submission will be
repeated at the repaired frozen head, including LLVM counters for the wrapper,
the original fixed-heap pressure schedule and the final pristine clone.

### 2026-10-03 — worker — implemented with recorded exact-source proof

The repaired frozen source is `09afcaa29bda5206b98fb14e019f41395d669fec`. Commands:

```sh
VIRGL_PRECISE_WORD_EVIDENCE_DIR=target/evidence/virgl-precise-word-worker-09afcaa2 make verify-E6-T12f4
python3 tools/virgl-precise-word/cold.py --output target/evidence/virgl-precise-word-cold-09afcaa2
```

Both commands pass directly. The worker and final scrubbed pristine-clone runs
each record 1,404,199 ASan/UBSan native calls across all 19 original bodies,
4,428 single cases and 511 pairs. They exercise 229 real allocation failures,
including 20 upstream malloc/realloc sites, with all 58 single and 56 paired
profile anchors recovering after every failure. LLVM records the entire owned
wrapper (44/44 lines), both existing owned C sources, full raw profiles and
stack usage. The repaired fixed-heap witness at `wasm/calls.jsonl` line24440
returns a bounded rejection, then recovers; no incomplete GLSL is published.

Wasm records 24,556 calls with complete native result agreement, preserved
owned responses, 64 maximum-size stress calls and 31 actual fixed-heap pressure
calls. Initial/final memory is 16 MiB and the backing buffer remains identical.
The instruction/IR/profile/flow bounds are unchanged; maximum native single/
paired results are 63,369/109,235 bytes and maximum stage GLSL is 58,201 bytes.

The pinned token parser records both stages' per-instruction flags. The
independent rational interpreter predicts 830 actual shared-renderer hardware
draws before readback; all 3,320 words and 3,399,680 pixels agree.
Recordings include literal shaders, compiler results, actual shaderSource/link
events, geometry and uniform readbacks, all RGBA bytes, V8 counters, zero browser
errors, hardware identity and released object budgets. Three actual compiler
source changes are rejected by physical word mismatches: reversed MAX order,
conflated zero encodings and erased unordered inequality. Twenty profile
contracts, 334 malformed records, 24 combined obligations and 20 ownership
records pass their independent consumer checks. Retained equality, selected
definedness, radial hardware captures and promoted radial regressions all pass.

Lossless evidence is committed under `evidence/virgl-precise-word/`:

- `worker.tar.gz`: `dc704cd8aa90f33d75163fd4620c0d102c280cd2d4a1c3e02e3ea19810cbd99f` (526 files).
- `cold.tar.gz`: `0994986417bfa37e01157a7151858f2bf91b662ccd9fde388e0bbbf360caeb09` (528 files).
- `refuted-b8743ae4.tar.gz`: `e969f935363d2d1e829980c5c91aaea5c25782fba8f44500cc66512e8bcb4acb` (16 files), preserving the earlier runtime failure.
- `worker-receipt.json`: `4aa1d0b0ac90ad2588d70edff530458a8c1dd4d5bd77db8d1ec66fbb7aeb2e5a`.
- `cold-receipt.json`: `f579d9fd37c22a01484568861d5294928be097af034ca6ea4316b5d2daba14ca`.
- `cold-report.json`: `9b7c780d15f71cdb7ca2d32d8aff2b61c0e8b1c0284995d9a84ef420c3865017`.

`manifest.json` also binds both native LLVM binaries, pinned token binaries,
generated Wasm/mjs artifacts and the screenshot. Each archive member was
streamed and compared with its original size and SHA-256, then the original
files were checked again. The cold report cites its exact detached clone,
clean status before/after, full canonical log, removed environment names and
every acceptance-file digest. Evidence/status packaging changes no runtime or
recording-harness source from the frozen head.

The recording demonstrates instruction-local FSEQ_PRECISE, FSNE_PRECISE,
MAX_PRECISE and MOV_PRECISE in both stages, source aliases and consumed swizzles,
equal/unordered source-order ties, signed zeros, internal exceptional word
identity and mandatory combined bank/control/precision obligations. All 19
original hashes/bodies and complete results are preserved; 12/19 remain
accepted. New arithmetic, mask and output-authority boundaries remain separate.
No arbitrary NaN/subnormal raster transport, exact backward RSQ/DP3 cone,
production guest GPU negotiation, deployment or desktop 300 MIPS is claimed.
The fresh verifier must judge this diff and recording before setting verified.

### 2026-10-03 — independent verifier

VERDICT: verified

Frozen implementation/harness: `09afcaa29bda5206b98fb14e019f41395d669fec`;
base `220c2640d8c75df4decae10a3aa12a7be150897f`; worker submission
`8322ee6c6c6fc2148d7b4bc70cc567f09879e87b`. Read the whole task and diff
before evidence and recorded ten falsifiable predictions before inspection.
All ten are HELD; no refutation or unexecuted product hunk remains.
[Structured verdict](../../evidence/virgl-precise-word/verifier-verdict.json)
binds each observation and exact raw citation.

- SEMANTICS — HELD. Predicted per-instruction flags without backward propagation;
  `worker.tar.gz::semantic/tokens.jsonl` lines1–2 show four true then five false
  flags in each stage (SHA-256 `d182d2523fc925ecb08526914ad48fc6ed90b1daa2dd77b385ad891898c550f8`). The pinned Mesa strict ordered MAX
  definition agrees with source1 selection on ties/unordered. Arithmetic suffixes
  remain gated. No further evidence demanded.
- WORDS / ALIASES — HELD. Predicted source1 word identity, opposite-zero equality,
  unordered inequality and pre-write aliases. Re-read all 830 actual hardware
  draws, 3,320 words and 3,399,680 RGBA pixels. In `worker.tar.gz::gpu/report.json`,
  line34120 gives MAX zero ties `[80000000,00000000,00000000,80000000]`;
  line67122 retains source1 NaN words; line2997852 gives all-one FSEQ zero masks;
  line4408423 gives all-one FSNE two-NaN masks; line5736477 retains MOV signaling
  NaNs internally. GPU report SHA-256 `c1635f95ff92cf161653afcfa3088c9d1e5d95c21acb191383de8b8b50b9b003`; `verifier.tar.gz::trace-points.jsonl`
  supplies 90 line/pointer/word/readback citations. Carry 131,136 independent host
  checks and both independent seeds (`ae95384f`, `6b31fdc9`, each 828 draws/3,312
  words) across unchanged precision code. The bounded novel negated MAX,
  partial-destination alias and bank-authority attack passes 72 draws/288 words.
  No arbitrary exceptional floating raster transport is inferred.
- CONTRACTS / REGRESSIONS — HELD. Predicted all simultaneous precision, finite,
  indirect, count and radial obligations remain mandatory. All ten new profiles
  in both stages pass; independent attacks accept 300 valid operation subsets,
  reject 314 hostile variants, preserve 20 owned frozen records and invoke zero
  getters (`verifier.tar.gz::metadata-attack-report.json`, digest in the verdict).
  Unauthorized output, undefined lanes and gated arithmetic/suffixes reject.
  All 19 original bodies/hashes remain identical (12 accepted); full predecessor
  results survive apart from inventoried migrations. Canonical retained equality
  640 words, selected 1,216 words/1,245,184 pixels, and radial 565,248 pixels pass;
  full result arrays match cold (`final-review-record-audit.json`,
  `final-review-cold-audit.json` in the verifier archive). No further evidence demanded.
- ALLOCATION — HELD at repaired source. Predicted every nonzero actual upstream
  allocation failure rejects without publishing partial GLSL and fully recovers.
  Canonical 229 failures include 20 upstream sites; every 58 single/56 pair anchor
  recovers. Independent ten-witness attack rejects 455 malloc/realloc failures
  with 4,550 full recoveries. `verifier.tar.gz::allocation-attack.jsonl` line37
  rejects an ignored 128-byte texture constructor (SHA-256
  `98154dbae79848fa2b553accabadc224e0466c6ae3d97dec7e1a0cbf6d235fb1`).
  `worker.tar.gz::wasm/calls.jsonl` line24440 now rejects and line24441 fully
  recovers (SHA-256 `7b2ca5b7078b2d1ffd045e4cf46bf800c2a60ad8cb9c2cc4a160095c3f850b95`).
  The prior b874 FAILED outcome is retained separately; no allocation result is
  carried across that repair. Removing the actual latch reproduces forbidden
  partial success and trips the regression.
- BOUNDS / COVERAGE — HELD. Predicted positive source-bound counters for every
  changed behavior and measured bounded storage. `worker.tar.gz::native/native.log`
  lines1/5197/5198 show IR26,480, instruction112, profile7,616, flow arena52,644
  within53,248/depth8 and 1,404,199 calls (SHA-256
  `a9a62f476d9bc867dfb0b7cad483eddf480964f11f9c66f7863165de730163a7`).
  Native result maxima63,369/109,235 and stage GLSL58,201 stay bounded. The 24,556
  Wasm calls retain the same 16 MiB backing buffer through 64 stress/31 pressure
  calls. All changed runtime C regions, ten profile arms and 44/44 owned-wrapper
  lines execute; most-specific V8 ranges cover every new consumer expression
  (`changed-c-coverage-09afcaa2.json`, SHA-256 `f339963b5b6f985c2fd0980ae28cab975d5073bcf5da5520840a4c227136a9c2`;
  `changed-v8-coverage.json`). `coverage-scope.md` classifies every remaining hunk:
  headers/constants/reference data and build configuration are static waivers;
  proof-tool setup/version/timeout diagnostics are infrastructure waivers.
  Zero-size allocation alternatives and pinned so_info calloc are unreachable
  under admitted positive allocations and the owned zeroed shader-info/key.
  Stack evidence is only per-function observation; no aggregate stack claim is made.
- FAULTS / COLD — HELD. Predicted actual source faults and digest-consistent proof
  forgeries are caught. Reversed MAX order, conflated zeros and erased FSNE
  unordered truth each produce physical mismatches. Dropped MOV flags and removed
  allocation latch trip promoted tests; eight receipt/schema attacks reject
  (`receipt-attack-report.json`, exact bindings in the verdict). Final canonical
  acceptance passes directly in a scrubbed clean detached clone at frozen09af;
  independently rechecked clean afterward. Entire native/Wasm transcripts are
  byte-identical to worker. All 526 worker, 528 cold and 16 refuted archive members,
  saved native/token/Wasm binaries and receipts are lossless and digest-bound
  (`final-review-cold-audit.json`, `final-review-package-audit.json`). No further
  broad acceptance run is needed for this evidence/test-only promotion.
- SUITE — promote `renderer/virgl-command/tests/precise-word-regressions.mjs` and
  `renderer/virgl-shader/native_tests/precise_upstream_allocations.{c,sh}`.
  Narrow validation passes 40 literal admissions, 174 hostile contract variants,
  20 ownership checks, zero getter calls; ASan/UBSan passes 54 real upstream
  failures/216 complete recoveries across four ordinary/mixed witnesses.
  Actual compiler flag/latch sabotage fails these tests at the intended assertion;
  raw binaries, source faults and outcomes are retained. These tests use literal
  assertions and actual allocation faults, not emitted GLSL as a numerical oracle.

Independent recordings, scripts, counters, predictions, raw hardware pixels and
source-fault proofs are losslessly committed in
[verifier.tar.gz](../../evidence/virgl-precise-word/verifier.tar.gz): 220 files,
SHA-256 `2b967384003681a3e96c7bd4a6064ecd81378e58c34a3a01a3631830eb5f2207`.
[verifier-manifest.json](../../evidence/virgl-precise-word/verifier-manifest.json)
binds every member; the final audit and verdict preserve the carry-forward boundary.
No runtime or shared build artifact was changed by this verifier.

Promotion commands:

```sh
node --check renderer/virgl-command/tests/precise-word-regressions.mjs
node renderer/virgl-command/tests/precise-word-regressions.mjs
bash -n renderer/virgl-shader/native_tests/precise_upstream_allocations.sh
bash renderer/virgl-shader/native_tests/precise_upstream_allocations.sh target/evidence/virgl-precise-word-verifier/final-promoted-native
```

The verified scope remains isolated instruction-local comparison/selection/copy
with original bank/control/output authority. Guest GPU negotiation, public deploy,
desktop throughput, ADD/MUL exact arithmetic and backward RSQ/DP3 precision are
outside this task. Update task policy and regenerate the queue before committing.
