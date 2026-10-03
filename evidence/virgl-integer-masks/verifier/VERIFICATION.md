VERDICT: verified

E6-T12e4b, implementation frozen at `1e8f2586a125efd91460db3a7e11049855acb495`,
worker submission `8c2644f8`, prior verified boundary
`98314e2ddb082cf372a46ab90871b7cfdb77d587`. This is a fresh critic session.
`predictions.md` was written before any worker output was opened; SHA256
`bff2edc72af60100ba0641e6a8752ad545b839cc325f14cbafeb5911b4d805c9`.

The claim survived all scoped attacks. No implementation or worker harness was
changed by this critic. Production guest GPU negotiation stays disabled; no live
Mesa, guest offload, frame-rate or MIPS claim is verified here.

## Prediction ledger

All references below are relative to `evidence/virgl-integer-masks/`, except
explicit source paths. JSON pointers identify concrete recorded state. The
manifest binds the verifier records; worker and cold receipts bind their runs.

| Prediction | Verdict and concrete point |
|---|---|
| P01 wrapping addition | HELD. `worker/hardware/report.json#/acceptance/vertexProbes/0` and `fragmentProbes/0` reconstruct all four words for eight vectors. `verifier/worker-semantics.json` independently executes fixture TGSI, including wrap and the long UADD program, against every GPU carrier/plane. |
| P02 signed ISGE | HELD. Both stage `isge` probes match independent mathematical signed32 arithmetic; `worker/sabotage-signed-compare/report.json#/acceptance/vertexProbes` records actual compiled unsigned-order corruption failing the edges vector. |
| P03 exact comparison masks | HELD. Both-stage `useq`/`usne` probes reconstruct full words, including raw signed zeros and NaN payload equality. Worker mask sabotage changes true from `ffffffff` to `1`, compiles/links, then fails the signed vector's fourth byte carrier. |
| P04 any-nonzero UCMP | HELD. `worker/hardware/report.json#/acceptance/vertexProbes/4` and `fragmentProbes/4` cover per-lane noncanonical conditions and arbitrary private payloads. Eight direct finite selections per stage also pass (`verifier/hardware-details.json`). |
| P05 snapshot aliasing | HELD. Worker alias-condition/true/false and masked-sentinel probes agree with the independent TGSI interpreter. The separate composed five-op alias probe in `verifier/hardware/report.json#/acceptance/vertex` and `/fragment` passes 128 complete words across16 new vectors, three positions and retained TF guard words. |
| P06 consumed initialization | HELD. `verifier/native-cases.json` entries `*-src3-consumed-*`, `*-src3-uninitialized-*`, `*-dead-arm-init-*` and `*-UCMP-arity-*` have exact native/Wasm outcomes. A statically excluded arm still must be initialized; only consumed lanes matter. Source3 invalid banks, indexes, modifiers and syntax reject. |
| P07 integer known bits | HELD. `verifier/knowledge-report.json` records51,200 instructions over800 trials, five fresh seeds and32 concrete schedules. All3,500,032 zero/one consistency checks hold;456,032 exact-known checks hold. Native `*-no-origin-*` rejects unsafe unknown integer outputs. |
| P08 selection facts/origins | HELD. The same independent abstract attack checks112,288 propagated input origins and45,248 safe-output samples, including partial writes and8,070 aliased sources. Native tests distinguish same source/component from different source/component origins; known-zero/nonzero selectors retain only their selected origin. |
| P09 float output safety | HELD. Independent exact UADD output cases admit finite normal/zero words and reject subnormals/NaN/Inf. Unknown arithmetic and mismatched-origin selection reject. Both known branches and unknown joins execute in native LLVM coverage. |
| P10 internal profiles | HELD. Full-result checks retain v5/v1 without new operations; valid new operations publish v2. Mixed profiles are per stage. Malformed/new suffixes and unsupported controls never publish successful output. `verifier/binding-audit.json` binds all426 new native outcomes and full browser parity. |
| P11 compatibility | HELD. Separately built baseline/current sanitizer binaries agree on298 complete old results:279 old raw corpus inputs plus all19 original captured shaders. All19 retain their exact GLSL/metadata or error;12 accept. Worker additionally preserves22 old pair results; complete current E4a gate is freshly recorded. |
| P12 migrated inputs | HELD. Exact old captured UADD→MOV source now succeeds as v2. Exact two old one-operand UADD bank inputs produce parse-error. Binding audit confirms only those unsupported-op fixture slots become UMUL and all three original byte strings survive in new explicit cases. |
| P13 mixed pairing | HELD. Eighteen actual full/partial smooth/flat v5/v1/v2 draws match17,856 independently recomputed non-diagonal pixels (`verifier/hardware-details.json`). Standalone FS and derived interface results match complete native pair objects; four malformed-stage pairs reject. |
| P14 bounds/layout | HELD. Native layout records source24/instruction112/IR26232/profile7608 bytes. Old limits and fixed Wasm heap/stack remain. Max179 UCMP and the excessive GLSL fixtures execute; `glsl-output-bound-{vertex,fragment}` return translation-error. The preserved destination grammar accepts single lanes, xy and xyz; noncontiguous/full explicit masks remain rejected. |
| P15 cleanup/recovery | HELD. Worker84,167 calls include45,870 standalone and30,580 pair recoveries. Independent1,586 cases add3,172 full recovery comparisons. Browser pressure hits both owned allocation failures, restores capacity within the same module and complete mixed results. All362 worker GL objects are deleted. |
| P16 native/Wasm parity | HELD. Independent1,586 full core result objects match across sanitizer native/Wasm, with public ASCII guard checked separately; no sanitizer diagnostic. All705 worker cases and47 pair stream entries bind to complete logged results. Legacy system/float ABI remains; orientation UBO uses656 bytes/offset640. |
| P17 actual independent GPU proof | HELD. Worker704 words were independently recomputed from TGSI instruction semantics, not from the worker's named-operation oracle:352 complete TF captures and2,816 FS planes. Independent128-word composed program runs on headed Chrome/ANGLE Metal M4 Max. Worker browser errors are empty and PNG inspected visually. |
| P18 sabotage sensitivity | HELD. All three worker corruptions compile/link then contradict full-bit expected results. Independent arm swap in `verifier/sabotage/report.json#/acceptance/omissions/0` changes only the selected UCMP expression; actual compiled TF reports first carrier `3f000000` instead of `3f7f8000` at `/acceptance/vertex/0/vectors/0/rawWords/4`, with position and trailing guard words intact. |
| P19 changed-line sufficiency | HELD. Independent diff-to-LLVM mapping finds56 changed executable C lines, all executed.22 added non-executable source/header lines are individually listed in `verifier/worker-semantics.json#/nonExecutableChangedLines`. Proof/build/doc classification is below. |
| P20 frozen/cold binding | HELD. Independent binding audit passes37,282 structural/value/hash assertions,9,439 file bindings (including repeated nested references), every source against frozen Git,127 copied cold artifacts against retained clone originals, complete native/GPU equality and identical Wasm `d007009e9fd7a2685dfe87f83fd69da1ed3fd35d178a856e73485e4a19d328cc`. Pristine clone remains clean at the frozen head. Synthetic poisoned environment names are removed by the parsed scrub block and scrubbed env reaches the child gate. |

## Coverage and preserved boundaries

`verifier/worker-semantics.json#/coverage` cites each changed executable product
line and its native execution count. No changed executable product line needs a
waiver. Existing float interface/link logic, bounds, vendor implementation,
command transport and E4a bitwise behavior retain their prior HELD authority;
compact source layout and new profile selection were rechecked through old full
results, new attacks and the actual browser pipeline. All70 pinned upstream and
generated vendor digests are unchanged.

- `raw_bits.h`: enum/layout/macro/static assertions and comments are not executable;
  their sizes and use are exercised by both native and Wasm builds. New function
  signatures, braces, comments and blank lines have the same narrow waiver.
- `build.sh` new sanitizer mode and guard inclusion, and the Makefile acceptance
  target: executed in both frozen full gates. The changed invalid-command usage
  text is diagnostic-only, outside the compiler semantic claim.
- `native_tests/integer_masks.c` and native stream/report tooling: deterministic
  corpus, hostile/truncation/mutation loops and six single/four pair recovery
  anchors are bound to the771 full transcript results plus exact stats/layout.
  Failure-only assertion diagnostics are not compiler runtime claims.
- New browser proof and wrapper: source-bound JS coverage, translations, reflection,
  draws/readbacks, allocation pressure, success cleanup and all three semantic
  failure cleanups are recorded. Both fresh GPU sabotage and worker sabotages reach
  actual data mismatch after successful compile/link. Browser harness compile-error
  diagnostics do not assert a new compiler behavior and are waived as proof tooling.
- Receipt, regression and cold harnesses: both gates execute their success path;
  the independent audit imports none of their verification functions. CLI usage,
  malformed-evidence diagnostics and cold timeout cleanup are proof-tool failure
  scaffolding outside the product claim. Scrub behavior is independently attacked.
- JSON fixtures: every new377 shared input and49 hardware program is translated
  on both native/Wasm; all21 positive pairs plus4 negative pairs are bound. The
  three changed historical negatives are exact, explicitly audited migrations.
- Contract JSON, README and decision document: declarative claims only, checked
  against implementation, limits, per-stage metadata and disabled production
  fields. No default demo/guest activation is added by this slice.

## Independent runs and permanent artifacts

Commands from the repository root:

```sh
python3 evidence/virgl-integer-masks/verifier/hardware_fixture.py
python3 evidence/virgl-integer-masks/verifier/native_audit.py
node evidence/virgl-integer-masks/verifier/run_browser.mjs --output evidence/virgl-integer-masks/verifier/hardware
node evidence/virgl-integer-masks/verifier/run_browser.mjs --output evidence/virgl-integer-masks/verifier/sabotage --sabotage alias
python3 evidence/virgl-integer-masks/verifier/worker_semantics.py
python3 evidence/virgl-integer-masks/verifier/hardware_details.py
python3 evidence/virgl-integer-masks/verifier/binding-audit.py --cold
```

The sabotage command must fail. `knowledge-report.json#/command` records the
independent sanitizer compilation and execution of `knowledge_attack.c`. Binary
hashes are retained and binaries remain local; the reproducible drivers, inputs,
full transcripts, shaders, seeds, captured reports and source snapshots are kept.
The abstract attack and composed alias fixtures are promoted as deterministic
critic regressions; the existing task verify target remains the recurring gate.
No unrelated suite or performance requirement was added.
