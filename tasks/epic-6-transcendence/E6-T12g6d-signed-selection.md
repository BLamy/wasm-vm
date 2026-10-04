---
id: E6-T12g6d
epic: 6
title: Admit bounded signed integer comparison and maximum
priority: 525.027010571
status: implemented
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
bias changes ISLT lane4 from1065353215 to1056964608; changing IMAX's winning
source changes lane8 from1056964608 to1056964864. Failure captures dispose all
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
