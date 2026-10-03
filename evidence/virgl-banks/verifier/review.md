VERDICT: verified

Frozen runtime/harness `f88d7bb0c52cb4ac1189f7a05fb1dfdf77b03b91`,
worker claim `3f698836903fc9e455f29cb009f7a04d545f5be1`, diff from
activation `9ed66780d4e476634cbe4b5296b302ab0579feec`.

No runtime refutation or missing proof remains for the scoped frontend change.
The guard/frontend expands TEMP through117, CONST through45 and179 non-END
instructions. Command transport, production GPU negotiation, new original
workload execution and performance remain outside this verdict.

## Prediction outcomes

| Predictions | Result and evidence |
| --- | --- |
| P01–03 scope, inventory, unchanged originals | HELD. `binding-audit.json` reconstructs the original inventory and checks all19 original bytes and full native/Wasm results in worker and cold; exactly12 accepted/seven unsupported. `final-audit.json` checks every runtime/harness changed file against the frozen tree. |
| P04–10 address/range/numeric/lane/file isolation | HELD. Independent3,603-case sanitized run includes every admitted TEMP/CONST address, singleton/end ranges, all small-file neighbors, noncanonical numeric forms, partial lanes and cross-file isolation. `native.json:6315` is actual TEMP117 execution; all10,809 post-attack single/pair recovery results match. No ASan/UBSan diagnostic. |
| P11–13 budget and fixed allocations | HELD. Both stages and both pair positions distinguish179/180 with/without labels (`native.json:42140`, `:42414`); text/line neighbors retain bounds. Binding audit confirms32 maximum-pair repetitions with179 instructions and16KiB texts/stage,6115 fixed16MiB observations and bounded recorded output maxima. Stack/token/response limits remain unchanged. |
| P14–15 declared extent and host padding | HELD under the documented pre-evidence P15 amendment. Upstream produces46/47 by declaration order; the driver retains47. Both independently authored VS/FS arithmetic programs consume only0..45. Two different poison patterns in host-only element46 leave outputs identical (`gpu.json:13691` and feedback records); metadata is not clamped or rewritten. |
| P16–19 cross-target/hardware/pair/recovery | HELD.2,174 independently constructed complete native/Wasm results match; six additional exact hardware shaders also match native (`extra-native-parity.json`). Four hardware captures yield48 exact float32 words plus16 untouched guard words, and four draws yield1,024 exact pixels. The oracle was fixed in `predictions.md` before evidence: `(0.25,0.1875,0.75,0.75)`, RGBA `(64,48,191,191)`. Both stage anchors read CONST45/44/5 and preserve distinct TEMP17/117. |
| P20–21 unsupported syntax and hostile execution | HELD. ADDR, indirect operands, PRECISE and excluded opcodes reject. Four fresh mutation seeds, truncations and boundary cases are recorded, with14,415 native translations plus the six supplementary exact-stage parity translations. No crash/hang/poisoned result. |
| P22–23 evidence and pristine environment | HELD. Independent helper33,230 checks recompute frozen source, compiler/input/served Wasm hashes, all404 worker cases/four pairs/19originals,69 records per run and76 cold copies. It independently interprets arithmetic to reconstruct96 worker TF words and all five full framebuffer hashes, rather than trusting expected arrays. Final pristine run at frozen head passed first try, clean before/after. |
| P24 source coverage | HELD. All25 changed executable C lines have source-bound hits. Meaningful new branch outcomes execute. Two zero-width `isfinite` generic-type macro alternatives are compile-time-only; specific waivers and all31 changed-file classifications are in `coverage-review.md`. |
| P25 sabotage | HELD. Independent TEMP117→TEMP17 mutation changes only generated main-body operands, compiles and links cleanly, then fails the intended exact TF oracle (`gpu-sabotage.json:9448`): first y word expected `0x3e400000`, observed `0x3e800000`. Guard words remain unchanged. This is separate from worker CONST45→5 pixel sabotage. |
| P26–28 diagnostic additions | HELD. Well-formed excluded UINT32 float domains and recognized ADDR return unsupported-feature. Malformed/overflow/suffixed words and unknown file names retain parse-error. Both new error paths and success alternatives execute under source coverage and full native/Wasm parity. |

## Evidence identities

- Pre-evidence predictions: `e7c1c6e5ba959fd3cc3f599c97507cb22f1b18187fe379cb75533345951a9b87`.
- Pre-evidence frozen-diff supplement: `59c9ed85bf3a6037e0439cb03685a9bd046157b7b07f36c5ceadbfe3fb6b4bc8`.
- `native.json`: `55fa684f47c3cecb2ea46d271a9a1bedf512c6a605c313ef617e71fcd7d3d3e1`.
- `gpu.json`: `eb9a96bc1c3f21eff9152c3a94c76cdcf766abc6f37d4292f5db282cd3b3abea`.
- `gpu-sabotage.json`: `4649e8bfd22b2357832c30f0fbdc2685845d4e01a974dc4129d875d7828a7629`.
- `coverage-census.json`: `05f8d2b459756a7ffb328b850b468ec253d345aed1f429e4ab79055f42bfc60a`.
- `binding-audit.json`: `b204ddb3a1544a6d9a30a3519384460b7b2d7584cd2ba5569ac23b8da40b6929`.
- `final-audit.json`: `589315fe087ac9020166df1f3cb7f5ead210dbb970ff49069fe041a4df10ba06`.

The actual headed browser is Chrome154 on ANGLE Metal Apple M4 Max. Baseline
and deliberate-sabotage runs emit zero console/page/request errors. The baseline
screenshot was inspected. A supplemental audit script initially used Python's
newer `zip(strict=...)`; it was made compatible with the installed Python3.9
using explicit length equality, then passed. This changed verifier tooling only
and did not cause a runtime gate restart (`harness-calibration.json`).

## Reproduction and promoted artifacts

```sh
python3 evidence/virgl-banks/verifier/build-native.py
python3 evidence/virgl-banks/verifier/native-attacks.py
node evidence/virgl-banks/verifier/run-gpu.mjs
node evidence/virgl-banks/verifier/run-gpu.mjs temp-register-alias
python3 evidence/virgl-banks/verifier/extra-native-parity.py
python3 evidence/virgl-banks/verifier/binding-audit.py
python3 evidence/virgl-banks/verifier/final-audit.py
```

The independent native grammar/lane corpus and four seeds, fixed dyadic hardware
anchor, two-padding-poison replay and high-TEMP sabotage are retained as
reproducible verifier tests. Existing `make verify-E6-T12e3` remains the recurring
worker acceptance. Full native output is retained losslessly in
`native-output.jsonl.gz`; commands, compiler/source digests, coverage and screenshots
are committed alongside it. No implementation changes were needed.
