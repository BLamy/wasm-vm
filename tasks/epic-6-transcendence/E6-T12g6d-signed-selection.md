---
id: E6-T12g6d
epic: 6
title: Admit bounded signed integer comparison and maximum
priority: 525.027010571
status: verified
depends_on: [E6-T12g6c]
estimate: S
risk: high
capstone: false
---

## Boundary

Add private raw-word ISLT and IMAX for two’s-complement signed32 semantics. Preserve uint arithmetic, canonical mask words and separate ordinary numeric/raster authority. No float casts or transcendental operations.

Production GPU negotiation, live demo imports and caps remain disabled. No FPS
or MIPS claim follows from this isolated compiler boundary.

## Deterministic acceptance

`make verify-E6-T12g6d`: Predict literal masks and selected signed words at INT_MIN/INT_MAX/negative/zero/positive boundaries, lane masks/swizzles/conditional joins and constant-bank ownership. Differential against pinned Mesa integer semantics, native/wasm and independent actual transform-feedback/readback words. Test wrong signedness and winner-source faults; arbitrary raw words must not gain numeric/output authority.

Use the narrow affected compiler/consumer gates, record final exact-source native,
wasm and physical hardware proof, numerical source-fault sensitivity, varied
seeds and one pristine clone. Preserve unchanged HELD results. Submit to a fresh
independent critic before any dependent activates.

## Adversarial verification

Predict each stated semantic/domain result before inspecting. Attack signedness,
source and destination versions, liveness, domain ownership/metadata, masks,
boundaries and actual hardware reflection. Run every scoped acceptance angle,
one bounded novel attack and test sabotage; no mock/inverse/self-derived pixel
oracle. Each finding names a report/trace point and digest. Unexecuted runtime
hunks need evidence or deletion; unsupported original paths stay gated.

## Verification log

### 2026-10-04 — worker — activation

Continued the user's guest graphics offload request above independently verified
G6c `04885468`, rather than unrelated E5.5 publication work. Only this S/high
compiler boundary occupies the active lane. The captured compositor uses ISLT
and IMAX on count words in its existing raw constant banks. Add these private
integer operations to the existing v2 integer profile, preserving metadata for
all prior programs and adding no numeric/raster domain grant. Explicit opcode
bits 41/42 avoid feature bit40 and preserve the fixed IR layout. Scope proof to
signed endpoints, masks/swizzles, aliased versions, joins, constant bank ownership,
pinned Mesa semantics and actual physical feedback/pixels. Production imports,
caps and negotiation stay disabled until their own integration acceptance.

### 2026-10-04 — worker — implementation and proof scope

Added the two bounded raw opcodes, portable unsigned sign-bit ordering, exact
source selection and conservative unknown-bit intersections. IMAX drops IN
float locators/domain origin; canonical zero/normal bit facts still supply the
preexisting safe-use policy. No allocation, IR layout, capacity, fixed heap/
stack, numerical contract or production consumer code changed.

Self-validation passes 432 public sanitized native cases, 392 actual pinned
TGSI signed-type/converter witnesses and 432 matching Wasm singles/pairs.
The first physical run passes 31,128 exact carrier words and 9,984 pixels,
including actual bank reflection, masks, aliases and both join predecessors.
The real shared renderer passes both stages' A/B/A replacement/restoration,
caller-byte mutation, sync/async submission ownership, unchanged nonfinite
packet rejection and zero disposal budgets. Wrong-signedness and wrong-winner
emitted-source faults both contradict actual feedback bytes.

The pinned reference has an independently observed limitation: its all-ones
ISLT mask passes through float TEMP and becomes canonical NaN `0x7fc00000`
on this GPU. Original word carriers predicted lower mantissa carrier1065353215
and observed1061158912 at vertex lane5 in the ephemeral Mesa comparison.
The owned emitter preserved the full mask. This is outside the changed owned
boundary: reference programs now explicitly use finite UCMP predicates for
ISLT and normal/zero IMAX selections; alias/masked references also require
normal/zero source words. No emitted reference source is rewritten. All owned
raw results still face the independent full-word BigInt oracle, including
NaN/subnormal encodings interpreted as signed integers. This limitation and
the unchanged guest constant-packet restriction are explicit in the proof README.

Final prescribed gates are the affected C syntax/guard checks, sanitized native
and fixed-memory Wasm compiler paths, prior literal/original/join guards,
three physical seeds and two actual source faults, authenticated receipt and
one pristine scrubbed exact-source clone. Unchanged prior renderer/resource/
capacity proofs remain HELD. No Rust or live web source/import changed.

### 2026-10-04 — worker — recorded submission

Claim: at frozen runtime/harness source
`bc360945be9b9f20cc6cb2dc29475857b58f2382` above verified G6c
`0488546825fa63ee5740844c045ae7be0d43eeb9`, ISLT/IMAX admit exact private
signed32 comparisons/maximum without changing prior output/numeric authority
or storage limits. The record executes both signed endpoints, every pair of
16 literal special/endpoint classes, three seeded sets, masks/swizzles/aliases,
both conditional predecessors and real changing constant banks. Independent
BigInt source equations and a separately recomputed Python receipt agree with
every captured hardware word/pixel. Pinned parser/converter types and explicit
finite predicate/selection references agree in their documented reference
domain. All prior originals, join/literal guards and unsupported full compositor
outcomes remain unchanged. Production imports/caps/negotiation are disabled;
no MIPS, FPS or accelerated desktop claim is made.

Final exact-source commands all passed:

```sh
make verify-E6-T12g6d
python3 tools/virgl-signed-integers/cold.py --output target/evidence/virgl-signed-integers-cold
python3 tools/virgl-signed-integers/seal.py --hot target/evidence/virgl-signed-integers --cold target/evidence/virgl-signed-integers-cold --output evidence/virgl-signed-integers/worker
```

Each hot/cold run records 432 ASan/UBSan native cases (empty diagnostics), 392
actual pinned signed-type/GLSL witnesses, 432 equal Wasm singles/pairs, 25
original bodies retaining23 admissions, 112 historical grammar cases retaining5
explicit admissions, 402 promoted join/bank guards and49 promoted literal guards.
Three hardware seeds1369979863/2804203833/3781791491 produce93,384 exact words and
29,696 exact pixels;72,576 words and27,648 pixels exercise unrestricted owned
integer results, the remainder the documented pinned reference domain. Actual
transform-feedback reflection, uniforms, source hashes, GPU identity and empty
console/page/request/GL errors are captured. Each seed also runs four real shared
renderer rigs (both operations, sync/async), six captured A/B/A replacement/
restoration snapshots each, caller-byte mutation, unchanged atomic nonfinite
packet rejection and zero final renderer/resource/native object budgets.

Both emitted-source faults fail on actual `edge-0-8` feedback: removing signed
bias changes ISLT lane 4 from 1065353215 to 1056964608; changing IMAX's winning
source changes lane 8 from 1056964608 to 1056964864. Failure captures dispose all
objects and retain zero errors. Fault report digests:
`7f5487d1c4775fc9b98c184fec451be3d920f8bc65f8a32be1a5fc03c1d5ef95`
and `0526735e83bafd5847cb0966faa9afae56af03f15c68dcc54dc7ddb1b21871de`.

Evidence of record:
`evidence/virgl-signed-integers/worker/{manifest.json,records.json,recording.tar.gz}`.
The deterministic archive has65 members,8,055,540 bytes, SHA-256
`ebba6b455cd12786a95b4531d6936e72906b9d5716a0f8234e9e5cffea95fb88`;
the record index SHA-256 is
`bd2f737b4ae5b7ea03f87b4ce0c0c43c7e03cdf554beff461661142f81ab1741`.
Hot receipt SHA-256:
`067a3bd147ae5b363edfad861ebe8d1545a247bf2d396d93c8e2e56ab98629dc`;
cold report:
`f021e5f3c4eaec1c881612b1e315f7b6a223f3f93b53d0e1943560dc8f4446aa`;
cold receipt:
`be44d0e519fdd2976ae62a3b06a26b4fe7922890d7373b49a44cbef7132f517b`.
Receipts bind203 source/generated hashes and27 diagnostic/capture records each.
The pristine clone has exact source HEAD and empty status before/after:
`/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasm-vm-virgl-signed-integers-cold-g43t1yxk/wasm-vm`.
Cold log digest:
`f09316f95ce6f29b2e9cb95b19469b7c18d22a18e22a24f6dd16e371019f8e0c`.
Expanded recordings are in `target/evidence/virgl-signed-integers` and
`target/evidence/virgl-signed-integers-cold`; physical byte captures, actual
primary GLSL, fixed fixture bytes, native binary/profiles, coverage, screenshots
and consumer snapshots are sealed for a fresh adversarial verifier.

### 2026-10-04 — verifier — fresh independent critic

VERDICT: verified

Predictions P1–P8 were recorded before evidence inspection. Verified only the
private signed32 ISLT/IMAX boundary at frozen runtime/harness source
`bc360945be9b9f20cc6cb2dc29475857b58f2382`, worker submission `d38d2870`, above
verified G6c `0488546825fa63ee5740844c045ae7be0d43eeb9`. No implementation was
edited and no duplicate pristine-clone acceptance was run.

- P1 authenticity — HELD. Predicted exact head/member/source binding. Independently
  authenticated all 65 unique archive members, all 203 source/generated hashes
  and all 27 child records per hot/cold receipt, including retained cold binaries.
  Both complete source sets match frozen Git plus generated files. Cold head,
  command exit 0, scrub record, empty before/after statuses and log/receipt digests
  agree. Point: verifier archive `authentication.json`, worker archive SHA-256
  `ebba6b455cd12786a95b4531d6936e72906b9d5716a0f8234e9e5cffea95fb88`.
- P2 signed words — HELD. Predicted INT_MIN<0 gives `0xffffffff` and
  IMAX(INT_MIN,0) gives 0. Independently interpreted literal TGSI/control flow and
  captured constant banks using signed `int.from_bytes`, then compared every
  actual feedback byte and RGBA byte, never using `expectedWords` as the oracle.
  All hot/cold recordings agree: 93,384 words / 29,696 pixels each, including
  72,576 unrestricted owned words / 27,648 owned pixels. Every pair of the 16
  endpoint/special classes executes. Point: hot `gpu-1369979863/report.json`
  `acceptance.vertices[4].vectors[0]` reconstructs the all-ones ISLT mask;
  vertex 155 reconstructs IMAX winners 0/1/2/65535. Report SHA-256
  `1900d41c971ca3db99501b406491410f79a68697748792fd139ac8a9faeba2a1`;
  byte points and digests are in verifier `interrogation.json`.
- P3 masks/versions/joins — HELD. Predicted simultaneous old aliased/swizzled
  source reads and preservation of unmasked lanes. The source interpreter agrees
  with all actual carriers for masked and alias variants. Each operation has 144
  recorded vectors at each condition 0/`0xffffffff` per seed, independently
  selecting the correct predecessor. Old private versions, missing lanes and
  unsafe/missing predecessors reject in native/Wasm. Point: verifier
  `interrogation.json` totals/points plus `guards.json` named version/join cases.
- P4 authority and novel attack — HELD. Predicted unknown IMAX keeps only common
  bit facts and drops input-float authority. All 108 critic-owned native/Wasm
  guards pass; ASan/UBSan returns identical results with empty diagnostics.
  Across all 15 destination masks, complementary one-sided exponent facts reject
  direct output/numeric use; common normal facts admit. Input locators and
  escaped old versions remain private. Point: `guards.json` native[0],
  `imax-complementary-facts-output-mask-x`, predicted false/observed false.
  Guard report SHA-256
  `f6262d1474d6c8a3f0f03f960676849188ac485f53e20c3c616dd0d35da5a439`;
  sanitized fixture SHA-256
  `bf5c28f89b96c641d34b48786bbfcf05fc0a7da56c9c29290ae5b38139026cdc`.
- P5 independent reference/API/retained contract — HELD. All 432 native results
  match 432 Wasm singles/pairs; rejection closes source/metadata. The 392 actual
  pinned parser/converter witnesses carry signed32 source/destination types.
  Native GL receives exact unrevised primary GLSL. ISLT references explicitly
  map masks through finite UCMP predicates; IMAX references select normal/zero
  words, with normal/zero alias/masked inputs. All owned raw words face the full
  independent oracle. Original source hashes and complete old source/metadata
  agree: 25 originals retain 23 admissions, 112 historical cases retain 5 explicit
  admissions, and prior 402 join / 49 literal guards remain unchanged. Point:
  verifier `interrogation.json`, authenticated native/Wasm/retained reports.
- P6 physical reflection/ownership/lifetime — HELD. Every seed reports enabled
  headed physical WebGL2 on Apple M4 Max and zero browser errors. Reflected
  feedback/banks match the checked vec4/uvec4 ABI. Independently decoded real
  wire packets bind both stages' A/B/A replacement/restoration snapshots and
  physical uniform words, including async caller mutation. Nonfinite packet
  rejection applies zero commands and preserves state. Renderer/resource/native
  objects dispose to zero. Owned fourth seed 967929221 also passes 30,912 words /
  9,856 pixels, including 24,192 owned words / 9,216 owned pixels; source/generated
  hashes bind the frozen source and the independent interpreter agrees.
  Point: verifier `gpu-independent/report.json`, SHA-256
  `c0690f816b6b32b557d2bff0c9e3690cdf5a07f62892a1e6ab502410441d9ea1`.
- P7 sensitivity/sabotage — HELD. Both authenticated emitted-source faults are
  supplied to native GL and contradict independent predictions: ISLT wrong
  signedness changes carrier lane 4 from 1065353215 to 1056964608; IMAX wrong winner
  changes lane 8 from 1056964608 to 1056964864 (worker fault digests above).
  An owned isolated build changes only unknown IMAX intersection to union. The
  promoted guard fails at native[0]: predicted rejection, observed admission;
  concrete A=positive-infinity and B=1 explain why one-sided facts are unsafe.
  Authentic controls pass. Point: verifier `sensitivity.json`, SHA-256
  `a1fdfcfbf53ee43d89184deeb94f3f17b2b509ea4e3f84bb4c80ea27418bf8a8`.
- P8 coverage — HELD. Independently regenerated exact hot and cold published
  LLVM exports from authenticated binaries/raw profiles. ISLT known/unknown
  branches hit 2000/146, IMAX 1040/134; IMAX source-winner branches 614/426.
  Every added executable runtime hunk in bridge.c/raw_bits.c executes, including
  parser/lexical dispatch, known comparisons, unknown intersection and both
  emitter branches. All 25 changed hunks are classified in `coverage-audit.json`:
  runtime/harness/build paths exercised; opcode macros/static assertions are
  compiled declarative waivers; documentation/task/queue are non-runtime
  waivers. Uncovered defensive assertion/failure handling belongs to the harness.
  No runtime hunk needs evidence or deletion. Audit SHA-256
  `f32a442457dcfb38474d423bbe11fc2366606024cc32d0596d6f91406e11ee48`.

SUITE: promoted `renderer/virgl-shader/tests/signed-integer-regressions.mjs`, 108
predetermined native/Wasm authority/mask/version/join/grammar guards; source
SHA-256 `3b3a460110a099530dd255b51fd79c2180f2ed98df084f58180518485ebf43a3`.
Root may add the following narrow recurring command to the acceptance harness:

```sh
node renderer/virgl-shader/tests/signed-integer-regressions.mjs --native renderer/virgl-shader/build/native/virgl-shader --output target/evidence/virgl-signed-integers/independent-signed-guards.json
```

Owned verifier evidence:
`evidence/virgl-signed-integers/verifier/{manifest.json,records.json,recording.tar.gz}`.
The deterministic archive has 37 members, 1,694,583 bytes, SHA-256
`3fb492e9b9addbecedf462e27ac08ad9dcbe7e22d10aa6f92cac25952c17b777`;
index SHA-256
`2d18d13e974bd8a5c95154db3f85adf5c43726f7c7013538f8f0d2837346d4a4`.
It seals predictions, independent audit scripts/results, physical fourth-seed
capture/coverage/screenshot, guard fixture/results/ASan profile, owned authentic
and sabotage native binaries/source, and cleanup proof. Exact commands and
reopenable points are in its README/reports. All owned browsers/processes closed.

Unchanged G6b/G6c/resource/storage proofs carry HELD; the verifier did not expand
this task into production negotiation/imports, guest transport of arbitrary
nonfinite words, guest boot, desktop acceleration or MIPS/FPS. The primary
reference limitation is an explicit scoped proof restriction, not a full-word
Mesa differential claim. All owned signed words are independently proven.

### 2026-10-04 — worker — incremental critic guard integration

Authenticated every member of the 37-member verifier seal and the exact promoted
guard source hash. Added the critic's 108 native/Wasm guards to the recurring
acceptance script and receipt completeness checks. The standalone guard command
passes again with report SHA-256
`5d2d5c2cfb732b0bc54ac00eac98f4f0868ac2a7b0e6b4988db68d28acd8b481`.
`node --check`, `bash -n`, receipt `py_compile` and `git diff --check` pass for
the touched harness. Runtime, dependencies and authenticated source evidence are
unchanged; all independently HELD results carry forward without another full
hot/cold recording. Production integration remains gated on the dependent tasks.
