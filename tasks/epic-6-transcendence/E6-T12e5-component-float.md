---
id: E6-T12e5
epic: 6
title: Preserve the remaining componentwise float operations and negation
priority: 525.0269905
status: implemented
depends_on: [E6-T12e4c2]
estimate: S
risk: high
capstone: false
---

## Boundary

Admit inventoried plain DIV, MAX, FRC and LRP and captured scalar/source negate
syntax. Preserve opcode operand order, TGSI definitions, consumed lane masks and
modifier ordering. Explicitly enumerate the accepted finite/numeric domains and
the pinned TGSI/WebGL guarantees for each operation. Do not add unused absolute,
saturate or other modifiers incidentally. PRECISE remains rejected.

## Deterministic acceptance

`make verify-E6-T12e5` records native sanitizer/Wasm parity and actual ESSL300
execution using independent expected values: unequal LRP endpoints, negative
FRC arguments, distinct per-lane divisors/MAX operands and negated swizzles.
Use exact binary-fraction pixels where possible and documented bit/ULP limits
where the admitted semantics require them. Test every newly admitted operation
and modifier; preserve previous gates and 12/19 original outcomes. Record
exact-head and pristine-clone proof.

## Adversarial verification

Attack operand reversal, negative FRC truncation-versus-floor, signed zero and
denominator/exceptional-value boundaries only according to the explicit admitted
contract, modifier order and partial writes. Sabotage one operator or negate
application and require an independent oracle failure.

## Preparation notes

Keep this as one atomic checked componentwise-arithmetic boundary. Use the
ordinary float contract from E6-T12e4c2. Original IN values, existing computed or
sampled shadows, and raw words proved finite normal or signed zero are authorized
numeric sources. Do not add magnitude, finite-value, nonzero-divisor or
interpolation-weight admission guards on ordinary IN/shadows. Such guards are
not imposed by the pinned TGSI equations and would exclude valid captured
programs. The specified finite/range conditions instead limit quantitative
accuracy claims and independent test oracles. Unknown raw numeric CONST/TEMP
inputs remain rejected; the separate constant-domain integration before Mesa
is still required.

Use the pinned VirGL mappings: DIV `src0/src1`, MAX `max(src0,src1)`, FRC
`fract(src0)`, and LRP `mix(src2,src1,src0)`. Preserve source and modifier order,
partial masks, consumed-lane validation, both pre-write snapshots and bounded
storage. Only validated new operations or numeric modifiers select the new
owned profile; pure new-op/negative numeric programs without an integer token
must enter that checked path. Earlier programs retain their exact profiles and
full outputs except explicitly bound historical admissions.

Unary minus is supported only for numeric operands, including TEX coordinates.
Keep MOV, UCMP selector/payload, raw comparisons, bitwise/integer sources and
samplers unmodified. Keep absolute, saturation, repeated signs, unary plus,
PRECISE and LEGACY_MATH_RULES rejected. The latter has a distinct zero-times-
infinity rule, including the multiplications implied by LRP. These are not
silently covered by ordinary ESSL lowering.

The original inventory contains 39 plain operations across five bodies:
17 DIV, 8 FRC, 8 LRP and 6 MAX. All six source negations occur as MAX's second
operand: four `-TEMP[n].xxxx` and two `-CONST[4].xxxx`. Preserve those two CONST
sites in the compatibility inventory even though unknown raw numeric constant
admission remains a later boundary. Every full original still contains other
unsupported semantics, including PRECISE; keep the exact 12/19 outcomes.

Use independent rational dyadics for MAX/FRC/LRP/negation, including unequal
endpoints, extrapolating LRP weights, negative FRC, source-position permutations,
swizzles, aliases and numeric/sample shadows. DIV output must be checked with
an outward rational enclosure covering the GLSL ES3.00 accuracy guarantee for
the chosen denominator range. An exact mathematical quotient does not by itself
require exact output bits. Do not infer NaN payload, signed-zero or subnormal
preservation after ordinary arithmetic, or exact CPU-executor equivalence.

Six historical C2 rejection bodies become explicit positives: negated ADD-IN,
MAX-IN and DIV-IN in both stages. Preserve each exact body in the new fixture,
and bind each adjacent replacement used to retain historical rejection slots.
The malformed two-source FRC cases must still reject; bind any unavoidable
structured error migration explicitly. All raw FSLT/FSGE modifier rejections
remain unchanged.

## Verification log

### 2026-10-03 — worker — implemented

Frozen implementation/harness head: `6a8d3841e18379d665af4c7d8f9449322529636f` (parent verified
numeric-shadow head `67ca333c05fb70d719c49b3dc5cb8c1f8bb2f6de`). No runtime
or harness changes were made during the final recorded runs.

Commands:

- `bash renderer/virgl-shader/build.sh guard-check`
- `python3 -m py_compile tools/virgl-component-floats/*.py`
- `node --check renderer/virgl-shader/tests/component-floats.mjs`
- `node --check tools/verify-virgl-component-floats.mjs`
- `git diff --check`
- `VIRGL_COMPONENT_FLOATS_EVIDENCE_DIR=evidence/virgl-component-floats/worker make verify-E6-T12e5`
- `python3 tools/virgl-component-floats/cold.py --output evidence/virgl-component-floats/cold-clone`

The final gate passed native ASan/UBSan and actual Wasm/GPU execution. It records
2,083 native cases, 162 pairs, 316,282 public calls, 164,916 standalone and
137,430 pair recoveries, 7,240 truncations, 324 hostile cases and 4,096 mutations
across four fixed seeds. All 574 new shared/hardware inputs have exact full native/
Wasm result parity. The six intended historical admissions have source-bound
positive bodies and adjacent negative replacements; all other retained full
results and all nineteen original bodies remain unchanged (12 accepted, 7
unsupported). The instruction stays 112 bytes, the IR 26,232 bytes, and actual
Wasm allocation/stress/recovery stays in the fixed 16 MiB memory.

Independent rational GPU checks cover 406 exact words, 42 quotient words inside
specified error enclosures, 96 exceptional-value observations with only supported
class assertions, 60 joint float/raw consumer draws, 4,096 texture pixels and
29,760 interpolation pixels across 30 mixed-profile/partial-interface frames.
The two orientation captures use actual +/-1 UBO values. All GL objects are
released and all five browser runs have zero console/page/request errors. Each
of LRP operand reversal, FRC truncation, DIV reversal and removed numeric minus
fails at a source-bound actual GPU result; altered source still compiles/links.
The unchanged full C2 gate and its complete earlier regression chain also pass,
with the six explicit historical substitutions independently reconstructed.

Evidence (paths are relative to `evidence/virgl-component-floats/`):

- `worker/receipt.json`: `170666b1f0a6dd52b5dc53f4206162711e1c596001a891b0f974cf78c7f4a365` — binds 251 sources and 169 records.
- `worker/native/native-report.json`: `f7a06c2b645275543ee25324646bf79b48fb62a42f528ec396d728be6c891267`.
- `worker/native/native.log`, `native-input.bin`, `coverage.json`, `coverage-show.txt`,
  `native.profraw` and `native.profdata` preserve the complete source-bound run.
- `worker/hardware/report.json`: `9ef2fa3cef2493e9fcc2f562ee283d76a4491e6cc170a6b5981840cf1fb1ec74`.
- `worker/hardware/browser.png`: `54bc442520f43566d6c38e41160976a053d415cddc5a18bee70980fecfd7bf60`; visually inspected.
- `worker/sabotage-lrp-order/report.json`: `8ead0f79866b89b521a838f21e435f9d0fc5cdb4f43808a83b7abf5b2da82ff6`.
- `worker/sabotage-frc-floor/report.json`: `bdc1ef8690f31fb7e1a3eabe22a65e1d31a2bcdccf83b9a241628795fe6d30e0`.
- `worker/sabotage-div-operands/report.json`: `b09a6872e3e60e6689e73da0af365c6b2b1f539bece4fb7d763d52a68e525d85`.
- `worker/sabotage-numeric-negate/report.json`: `47aac68285723872f9e20aeaa8851bac5bede2f5a6701be1f7d01678d1aee4e2`.
- `cold-clone/report.json`: `7e36542bdb098a38c476ef444eaf2f7f73d295e775ee61a36aecf000471a5c4e`.
- `cold-clone/acceptance/receipt.json`: `8846e747513422097b14b490383b68e5326f835c3e77e6d434425cd19f1f9286`.
- `cold-clone/acceptance/native/native-report.json`: `62f1b55d8984afe37f8e24384cbb77c44648ffdc7cc536183313cfc8cb9d8c41`.
- `cold-clone/acceptance/hardware/report.json`: `064512e6b1d6abb94dcabf453ce51667bc8b0cce52f44370aac5375adb8610d2`.
- `cold-clone/cold.log`: `c748ceee707635fc7c61a734c510dc5bbec78f325fc24b3c209dc2160903a8b7`.

The cold run checked out the exact frozen head in a pristine clone with compiler,
Node, Python, Cargo/Rust and graphics overrides scrubbed. It passed the complete
same command, remained clean before and after, and preserves 179 acceptance files.
The worker sanitizer binary SHA is `092c0d36e83b10946fe7ee9f06ae15ec32bd30fb417ad60c65905ce33e9376a0`;
the actual Wasm SHA is `96c1a85b59f9a6d8d05ae6074ac19010773d4df0d6327e9efb5195c8d7a044a7`. Native debug-path
binary identity is recorded separately for the clone; no reproducible-native-
binary claim is made.

This is the isolated shader compiler boundary, with direct hardware proof.
Production guest negotiation, guest constant transport and the demo remain
unchanged; this claim does not include a Mesa boot, deployed desktop acceleration,
FPS improvement, PRECISE, numeric unknown-CONST admission or a 300-MIPS result.
No web/demo source changed, so no demo deployment is needed for this layer.
