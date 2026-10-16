# E6-T12e4a independent verification

The independent predictions were written before the implementation was inspected
(`predictions.md`, SHA256 `86bf220049e1ef3e434c1adc7e2bb78e4e09e83795df3c9a6b3973c3c7e17469`).
This critic did not implement or repair product code. Runtime is frozen at
`347dc59d60fa7e77cec58b14a36bcc8adb88db8d`; final recording harness is
`2484d01736e15b6aee05cef12a3215f283705762`; worker submission is
`71dc9b428fbbc325f885f257c95e2fff8b9e8079`.

## Independent execution

`native_audit.py` generates its own cases and builds a separate streaming C driver
with ASan/UBSan. It executes 1,408 cases: 356 explicit admission/rejection cases,
1,024 independently seeded mutations, and 28 legacy cases compared as complete
objects against a separately compiled verified parent. Every case is followed by
an exact successful raw single conversion and mixed pair recovery: 4,224 calls,
2,816 recoveries. The browser compares all 1,408 complete native/Wasm **core**
results, plus the ordinary public wrapper result for printable input.

The first browser attempt assumed native and public-JS invalid-input error wording
was identical. That assumption was false in the unchanged parent: the public guard
has a different fixed message. This was a verifier-harness issue, preserved in
`hardware-initial-wrapper-assumption/`, not a product finding. The final proof
compares the full native result to the actual Wasm C export for every input, and
separately asserts the unchanged full public-JS error object for all 115 affected
control-character cases. No runtime changes were made.

`knowledge_attack.c` uses four additional seeds and 16 concrete value schedules
per abstract program. It executes 12,288 IR instructions over 128 trials and
checks 444,976 known-zero, known-one, origin-identity and output-admission
assertions under ASan/UBSan. The concrete evaluator computes unsigned results;
it does not copy the implementation's known-bit transfer functions.

The novel GPU attack has a new compound program combining overlapping masked
SHL, USHR, OR, AND, NOT, untouched raw neighbors, TEMP117/17/9 and CONST45/43/42/41/40.
Its first input is the prewritten alias prediction. Uniform data and per-lane
counts change across 12 vectors without recompiling the program. Four vertex
programs encode one complete result word into four normal-float byte carriers;
three actual vertices and four guard words are captured each time. A fragment
program uses 32 independent bit planes per vector. Python and separately written
BigInt oracles agree on all 96 complete words. All 40 actual GL objects are freed,
UBO reflection is 656 bytes with offset 640, memory remains 16 MiB, and Chrome
reports hardware ANGLE/Metal on the Apple M4 Max with zero browser errors.

A served-GLSL sabotage changes the overlapping SHL's `.y` source to `.x` while
leaving source TGSI, Wasm result and metadata intact. Both shaders compile and
link successfully. The first transform-feedback carrier then differs:
`hardware/report.json#/acceptance/vertex/0/vectors/0/rawWords/4` is
`0x3f7f8000`; `sabotage/report.json` at the same record is `0x3f008000`.
The correct complete result is `0xffffffff`, while the mutant carries
`0x80000001`. This proves actual readback sensitivity to the novel alias attack.

## Predictions

All record paths below are relative to this verifier directory unless prefixed
`../worker/` or `../cold-clone/`. The final `audit.json` binds their exact bytes.

| Prediction | Result | Concrete evidence |
|---|---|---|
| P01 backend and legacy identity | HELD | `native-report.json` records 28 complete parent comparisons; `binding-audit.json` checks every original, legacy regression object and native/Wasm fixture. Raw-domain literals alone remain legacy rejections. |
| P02 private raw storage | HELD | Owned emitter uses unsigned private arrays and expressions; `worker-semantics.json` checks every raw hardware shader. Native edge fixtures and actual TF/bit-plane reconstructions retain all bits, including NaN/Inf/subnormal encodings. |
| P03 operations/count masking | HELD | `hardware/report.json#/acceptance/vertex` and `/fragment` execute the combined integer operations with dynamic counts; worker probes cover every operation separately in both stages. `worker-semantics.json` independently checks 480 worker words and explicit count masking in emitted sources. |
| P04 consumed lanes | HELD | `audit-native.jsonl:190` rejects the independently authored consumed-uninitialized lane. The adjacent positive cases execute all destination/source lane combinations; the emitter fills unused RHS lanes with zero instead of reading them. |
| P05 alias and neighbors | HELD | `audit-native.jsonl:157` admits the partial SHL alias. Hardware vector `prediction-alias` gives `[0xffffffff,2,0x7f800001,0xfffffffe]`; the third raw NaN word survives the partial write and all its bits are reconstructed. Alias sabotage fails actual TF output. |
| P06 UINT32 grammar | HELD | `audit-native.jsonl:283` rejects 4294967296. Every component position also rejects sign/hex/exponent/suffix/11-digit forms, followed by exact recovery. Full raw UINT32 domain is accepted only in the owned profile. |
| P07 excluded semantics | HELD | Independent raw-plus-ADD/MUL/MAD/TEX and later integer families reject in both stages; worker guard fixtures cover modifiers/control/ADDR/PRECISE. Vendor source identity is unchanged. |
| P08 output known bits | HELD | `audit-native.jsonl:967` rejects unsafe NaN output. Dynamic unknown CONST rejects, while normal/zero carriers succeed; 444,976 independently sampled knowledge/origin assertions hold. `raw_outputs_safe` excludes possible all-one exponents and nonzero subnormal mantissas. |
| P09 float origins | HELD | `audit-native.jsonl:469` rejects raw overwrite of an input-origin lane; line 472 succeeds after an explicit safe origin replacement. Origin propagation is MOV-only and the independent concrete schedules agree with every retained origin. |
| P10 float IO/wire scope | HELD | Raw emitted inputs/GENERIC outputs retain vec4 float types, including partial masks. Host-uniform probes are explicitly distinguished from finite guest wire admission; unchanged constant/async renderer regressions pass. |
| P11 complete observation | HELD | `worker-semantics.json` reinterprets each exact authored TGSI and checks 240 TF captures and 1,920 bit planes, including raw bytes/digests; all 480 words reconstruct. The new hardware attack independently checks another 96 words and guards. |
| P12 dynamic novel attack | HELD | One linked program receives all 12 vectors per probe; uniform words and compile records are retained. Counts change from the prewritten alias vector to independent large-count vectors, with exact Python/BigInt/GL results. |
| P13 capacities | HELD | `audit-native.jsonl:1027` accepts 179 instructions, line 1030 rejects 180, line 1036 rejects 16385 bytes. Native/Wasm parity and original boundary regressions hold; maximal worker programs execute and repeated padded pairs retain fixed memory. |
| P14 allocation/stack | HELD | Compile-time profile/conversion bounds and heap IR allocation avoid doubling new IR on the stack. Worker actual Wasm pressure reaches both allocation classes in vertex/fragment/raw pairs and restores capacity; `../worker/hardware/report.json#/acceptance/allocationPressure`. Native stack observations are not relabeled Wasm totals. |
| P15 pair interfaces | HELD | Full result/FS equality, 18 positive and four negative pair outcomes, partial xy/xyz mixed pairs and 15 real interpolation draws are checked by worker and binding audit. Profile selection is per stage; sorted keys and guarded request fields remain unchanged. |
| P16 reflection contract | HELD | Actual 656/640 system-block reflection and both y orientations pass. The worker records declared47/active47 but uploads46, unchanged poison padding, and genuinely absent unused arrays; constant names/types stay unchanged. |
| P17 ownership/recovery | HELD | Independent 2,816 complete native recovery objects, retained browser results, fixed memory identity, worker failed-pair recovery, and 4 KiB-granularity allocator capacity restoration all hold. |
| P18 sabotage | HELD | Worker dynamic `&31u` to `&30u` sabotage and the independent alias-source sabotage both compile/link and fail an exact actual readback. Neither verdict depends on merely searching emitted text. |
| P19 head/cold binding | HELD | `binding-audit.json` independently rechecks runtime347dc/harness2484, the exact two-file harness-only delta, served Wasm identities, complete worker/native results, and pristine-clone records at2484. |
| P20 coverage/scope | HELD | `worker-semantics.json` lists all 213 changed executable C lines: 212 executed, one guard-excluded switch default narrowly waived. Unchanged command/device/web/runtime scope is documented; no guest acceleration, full-corpus execution or MIPS/FPS claim is made. |

## Coverage judgment

The native LLVM record binds the actual frozen C files. Every changed executable
line executes except `raw_bits.c:107`, the switch default for operand kinds
excluded by the checked source grammar. That branch represents enum-dispatch
bookkeeping, not admitted behavior; it is waived. New structs, declarations,
static assertions, docs and task metadata are non-executable.

Two inline native-unseen OOM paths are independently exercised through actual
fixed-memory Wasm pressure: raw IR allocation at `bridge.c:455` and raw GLSL
allocation propagated at `bridge.c:481`/`raw_bits.c:114`. The owned allocations
are 26,232 and 65,537 bytes, each larger than the 4 KiB capacity measurement unit.
Cleanup and recovery cover either stage and raw/raw pair failure, then both mixed
pairs; no new upstream-vendor OOM guarantee is inferred.

The fixed-format writer's overflow/libc-error branches (`raw_bits.c:83,88,167`)
are defensive and waived narrowly. The longest possible instruction is 318 bytes
(four `floatBitsToUint(vso_g7.x)` shift lanes); 179 such instructions use at most
56,922 bytes. All bounded declarations/templates/output assignments add less than
6,000 bytes, below 65,536 total. The guard never emits arbitrary source strings.
A negative `vsnprintf` return is outside this fixed valid-format guest grammar.
The cap is retained as defense in depth. Existing upstream defensive branches
carry forward prior evidence; no unchanged failure policy is silently expanded.

## Commands and permanent artifacts

```sh
python3 evidence/virgl-raw-bits/verifier/hardware_fixture.py
python3 evidence/virgl-raw-bits/verifier/native_audit.py
node evidence/virgl-raw-bits/verifier/run_browser.mjs --output evidence/virgl-raw-bits/verifier/hardware
node evidence/virgl-raw-bits/verifier/run_browser.mjs --output evidence/virgl-raw-bits/verifier/sabotage --sabotage alias
clang -std=gnu11 -g -O1 -fsanitize=address,undefined -Irenderer/virgl-shader renderer/virgl-shader/raw_bits.c evidence/virgl-raw-bits/verifier/knowledge_attack.c -o evidence/virgl-raw-bits/verifier/knowledge-attack
ASAN_OPTIONS=abort_on_error=1 UBSAN_OPTIONS=halt_on_error=1 evidence/virgl-raw-bits/verifier/knowledge-attack
python3 evidence/virgl-raw-bits/verifier/worker_semantics.py
```

The sabotage command must exit nonzero after successful compile/link. Exact full
compiler commands, input bytes, results and seeds are retained. Independently
authored native cases, IR-knowledge test, GPU fixtures/harness and interpreter are
permanent replay artifacts here; the task's `make verify-E6-T12e4a` remains the
recurring acceptance target. Generated host binaries/dSYM directories need not
be committed and can be rebuilt from the recorded commands.
