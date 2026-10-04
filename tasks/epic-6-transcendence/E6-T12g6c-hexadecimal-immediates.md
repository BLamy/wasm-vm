---
id: E6-T12g6c
epic: 6
title: Decode captured hexadecimal FLT32 immediates without numeric reinterpretation
priority: 525.02701057
status: verified
depends_on: [E6-T12g6b]
estimate: S
risk: high
capstone: false
---

## Boundary

Admit only the pinned TGSI hexadecimal FLT32 bit spelling needed by c5806d5f. Decode exact 32-bit words; preserve the decimal/UINT32 grammar and contiguous immediate declarations. No new numeric opcode or raster input.

Production GPU negotiation, live demo imports and caps remain disabled. No FPS
or MIPS claim follows from this isolated compiler boundary.

## Deterministic acceptance

`make verify-E6-T12g6c`: Literal pinned upstream parser/spec comparisons, all zero/sign/subnormal/finite encodings in raw private operations, malformed/truncated/overflow/noncanonical hex, native/wasm equality and independent physical word captures. Numerical-use and output-domain restrictions remain enforced; hex spelling must not grant authority to NaN/infinity/subnormal copied raster lanes.

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

### 2026-10-04 — worker — activate hexadecimal FLT32 grammar

The human graphics continuation authorizes this ordered compiler boundary after
E6-T12g6b was independently verified at `500ebfde1262e4615c9e15dbc96ecf1c407870f0`. Its frozen capacity proof,
402-case promoted guard and unchanged original-program results remain HELD.
This high-risk S task adds only the pinned `0x` plus eight hexadecimal digits
spelling for FLT32 immediates. The primary source is the pinned
`vendor/src/gallium/auxiliary/tgsi/tgsi_text.c:252-267`: hexadecimal words are
reinterpreted as binary32 bits, not numerically converted from an integer.
Canonical syntax, immediate ordering and prior decimal/UINT32 grammar stay
bounded. Raw private operations may consume exact exceptional encodings;
existing numerical and raster-output authority checks still decide their uses.
The complete c5806d5f/92cb866a programs remain rejected for later capabilities.
Production negotiation, imports, caps and deployment remain gated.

### 2026-10-04 — worker — freeze scoped literal implementation

The only runtime hunk is `bridge.c:literal_float`: eight checked ASCII digits
produce the binary32 word before the pinned parser runs. Raw consumers keep
the existing word/domain analysis; legacy conversion applies the existing
UINT32 normal-or-zero/finite/magnitude gate. Canonical letter case is accepted;
uppercase prefix, signs, short/long forms, C hex floats, suffixes and malformed
terminators reject. Existing decimal/UINT32 parsing and immediate order remain
unchanged. The pinned parser is queried only with complete canonical witnesses.

The affected high-risk submission is `make verify-E6-T12g6c`: strict owned C,
native ASan/UBSan/coverage, 676 singles with 512 primary-token comparisons,
Wasm singles and pairs, 25 unchanged original bodies, the promoted 402-case
G6b guard, three hardware seeds, exact carrier words and bit-plane pixels,
and two emitted-source fault captures. Legacy GLSL differs by immediate type,
so its metadata and physical pixels are compared instead of assuming identical
source. One frozen-head pristine clone follows. G6b's unchanged capacities,
allocation/stack/fixed-memory proofs and other renderer boundaries stay HELD.
This isolated compiler has no production import; the demo/deployment gate does
not apply. No guest graphics or throughput result is claimed.

### 2026-10-04 — worker — claim submitted for independent criticism

Runtime and all acceptance sources were frozen at
`5a039d16b2bfd756f6908a718ea063ad7c619905` (base verified G6b:
`500ebfde1262e4615c9e15dbc96ecf1c407870f0`). The only later worker changes
are this claim/status, regenerated queue and immutable recording artifacts.
Commands:

```sh
make verify-E6-T12g6c
python3 tools/virgl-hex-literals/cold.py --output target/evidence/virgl-hex-literals-cold
python3 tools/virgl-hex-literals/seal.py --hot target/evidence/virgl-hex-literals --cold target/evidence/virgl-hex-literals-cold --output evidence/virgl-hex-literals/worker
```

The exact-source hot and pristine-clone submissions passed. Each records 676
native ASan/UBSan cases, 512 canonical complete primary-parser word comparisons,
676 matching public Wasm singles and 676 compatible/rejected pairs. Decimal and
UINT32 controls preserve their existing admission/domain outcomes; the raw
path's emitted GLSL and metadata match UINT32 exactly. Malformed/truncated,
overlong, signed/prefixed/suffixed hex and immediate ordering violations reject
without partial source. Exceptional bits survive only in permitted private
operations; their copied/numerical uses retain the prior UINT32 restrictions.
Native LLVM coverage executes all branches/statements in the new hexadecimal
runtime hunk (`native/coverage.json`, bridge.c:246–275; comments waived).

Physical headed Chrome/Apple WebGL2 seeds `883475089`, `2552332019` and
`3860417495` each check 13,344 exact feedback words (including every exponent
class and full reconstruction of literal bits) and 5,184 pixels from all 32
bit planes and legacy controls. All GL objects are physically deleted; console,
page, request and GL error checks are empty. Vertex source corruption changes
expected word `1056964609` to observed `1056964610` at edge-0 vector0 lane6.
Fragment source corruption changes expected RGBA `[0,0,255,255]` to observed
`[0,0,0,255]` at edge-0-plane-0 pixel0. Both are caught by independent oracles.
The promoted 402-case join/bank guard passes in native and Wasm; all 25 complete
original bodies retain 23 admissions and unchanged GLSL/metadata. The two
larger originals stay rejected. G6b resource/arena/stack claims and unchanged
renderer leaves remain HELD; no new authority or production import is present.

Evidence of record: `evidence/virgl-hex-literals/worker/{manifest.json,
records.json,recording.tar.gz}`. The deterministic archive has 62 members,
4,479,069 bytes and SHA-256
`6aa1b74273563be5ae6aabaef307904b2362a1584edd344a7b27bc9281ac1ace`;
the record index SHA-256 is
`e83b840de0bac0804cf99e649549fb58f50b5b261f803418ffaeecbcaa708577`.
Hot receipt SHA-256:
`de1d05fd7fc216affbdb70addbef8ca9df10fd6bddecad1ac3b2795423117dba`;
cold report:
`e69c7e9ee574419d4f26778154468c20210214ddfbe370ff2cfbbca98decb40b`;
cold receipt:
`fa724009f00209e7fbd0217d118a172d77552edcd1a8bd55fbf10b3bd23f286d`.
Both receipts bind 195 source/generated hashes and complete diagnostic/capture
records. The cold clone has exact source HEAD and empty status before/after;
its log digest is
`51edce23aa2e8662d18caad9736f00b620063f0c0fcd080a73ab08c9434112bf`.
Expanded diagnostics are in `target/evidence/virgl-hex-literals` and
`target/evidence/virgl-hex-literals-cold`. Screenshots, actual framebuffer and
feedback bytes, pinned-parser words, fixed input fixtures, sanitizer profiles
and browser coverage are sealed for a fresh adversarial verifier. No throughput
or accelerated desktop claim is made.


### 2026-10-04 — independent verifier — VERDICT: verified

VERDICT: verified. Nineteen predictions were written before evidence inspection:
19 HELD, 0 FAILED, 0 NEEDS EVIDENCE. The verified boundary is the 30-line
`bridge.c:246-275` hexadecimal parser addition at frozen source
`5a039d16b2bfd756f6908a718ea063ad7c619905`, submitted in
`d264649c8407f546530556e5dff9edc4b81bc9e2` above verified G6b
`500ebfde1262e4615c9e15dbc96ecf1c407870f0`. I did not change implementation
or worker acceptance sources.

- P01–P02 provenance/pristine proof — HELD. All 62 archive members, both
  195-row source/generated hash sets, record index, receipts, screenshots and
  actual cold generated artifacts authenticate. The cold sanitizer binary's
  differing hash is the captured clone-path build; it was authenticated at the
  retained pristine clone, and its recorded LLVM coverage recomputes exactly.
  Only task/queue/evidence commits follow the frozen source. The actual retained
  cold checkout also has frozen HEAD and empty status. Point:
  `authentication.json#/coldGenerated` / digest `1838d507abff1492461471147822061a45963685d69ea1794006a3de6750506d`;
  worker archive `6aa1b74273563be5ae6aabaef307904b2362a1584edd344a7b27bc9281ac1ace`.
- P03–P07 literal words, admission and authority — HELD. Independently decoded
  input spelling equals all 512 actual pinned-parser `.Uint` records. Every
  binary fixture and native CASE line binds its source/result: 676 requests,
  412 admissions and 264 closed rejects. All 676 Wasm singles/pairs agree;
  rejected pairs expose neither shader nor metadata. Every raw UINT32 control
  has exact source/metadata equality. The 108 exceptional copy/use cases keep
  UINT32 authority; legacy safe metadata/pixels match and legacy magnitude,
  normal-or-zero and finite restrictions hold. The existing raw max-finite
  numeric policy remains unchanged. Points: `audit.json#/points/0,1,9,10`
  (including native.log CASE/PRIMARY line citations) / digest `78c1e23cf5dc7ce6c06c0835ce6d20eed22cf3a2a3bd6703d8cc30631caee8a8`.
- P08 runtime coverage — HELD. Both LLVM coverage reports recompute exactly from
  authenticated binary/profile bytes. All executable statements and both
  outcomes of each actual source condition in `bridge.c:246-275` execute.
  Comments, braces/blank lines and zero-length `isfinite` compiler-expansion
  branches are waived. Changed harness/config/docs hunks are classified in
  `hunk-coverage.json` / digest `2db032242ff0978169ff4cdf6ed434413e337a812f095df21b94d57756791d34`; report point:
  `coverage-authentication.json#/reports` / digest `daf002e3d3a25a753618399b0c1995674b502bf75511adf380120353bef72bbd`.
- P09–P12 physical proof and sensitivity — HELD. Recomputed every actual
  feedback/framebuffer byte from source literals, independently of recorded
  expectedWords/counters: all exponent classes, all 32 planes in the stated
  groups, three physical vec4 feedback outputs, 13,344 words and 5,184 pixels
  per seed. Real headed Apple M4 Max hardware, actual compile/link/reflection,
  empty console/page/request errors and exact object creation/deletion pairing
  hold in successful and faulty captures. Exact emitted-source corruption
  changes edge-0 vector0 lane6 from expected1056964609 to observed1056964610;
  fragment edge-0-plane-0 pixel0 changes `[0,0,255,255]` to `[0,0,0,255]`.
  Points: `audit.json#/points/4..8,13..17`; worker fault report digests
  `057830d9fe7d11fae1df9cf749367ec56d8e42a9ed5c17624d57c5102ad1c135`
  and `861404b785f842903fb5c94abc9ac15406e53111ed3908466b60fb9641ed07be`.
- P13–P14 prior proofs — HELD. All 25 hash-bound complete originals retain
  23 admissions and prior source/metadata; c5806d5f/92cb866a stay rejected.
  The promoted 402-case native/Wasm join/bank guard remains equal. Unchanged
  G6b capacity/arena/stack/fixed-memory and other renderer proofs carry forward.
  Point: `audit.json#/points/3,12` and retained report digest
  `72c463115114aa9b9f705424725a81b9c193d116f516054b0c3b0b45015198d7`.
- P15–P18 fresh bounded attack/sabotage — HELD. Owned frozen-source ASan/UBSan
  build passes 725 requests (676 recorded plus 49 new grammar/domain guards),
  all 512 primary token comparisons and exact response equality, with empty
  stderr. The 49 native/Wasm probes cover Unicode/NUL and unusual delimiters,
  mixed decimal/hex signed zero, canonical indices/line limits, partial masks,
  stale/new source versions, alias snapshots, both join predecessors, liveness,
  signed interpretation and exceptional numerical/output authority. A scratch
  `<<4` to `<<3` decoder fault fails the positive admission guard and the finite
  carrier's exact UINT32 source oracle: emitted GLSL line18 contains16515073
  instead of required2139095041. A fourth seed1821720247 passes 13,344 independently
  recomputed words and 5,184 pixels with actual reflection, disposal and zero
  errors. Points/digests: `fresh-native.json` `b401999b617f8c46cd8acca172710cc271c2bafe2c787469d12e2b4af80b6dfe`;
  `independent-guards.json` `ee630916adb090a9601c35d755b695e8c7322d8a7e2455906c8ef206905c8286`;
  `sabotage.json#/carrier` `9711eb7b784b4bb408eca2e6168bcbfc744b6ca9734d19a9d4d5d359958269e6`;
  `gpu-critic/report.json` `6d2588ccc233113c9de3c35d1a8d7d1ad758280c5689260880e5540d1ac2f8ca`.
- P19 scope — HELD. No new opcode, capacity/arena, input/domain grant,
  production import or negotiation. Decimal/UINT32 parsing is unchanged.
  No MIPS, FPS, deployment or accelerated desktop result is claimed.
- SUITE: promoted `renderer/virgl-shader/tests/hex-literal-regressions.mjs`
  (49 deterministic independent guards; SHA-256
  `91000d19f71a851b94ea21d974e6d250ceb96e654b3aa5765d0b7a39321c770e`).
  Keep generated builds/scratch products under target. No redundant cold clone
  or unrelated workspace wall was run. Owned browser/server/process resources
  exited and closed.

Critic commands (complete spawned inputs/environment and coverage commands are
also sealed in `commands.json`):

```sh
python3 target/evidence/virgl-hex-literals-verifier/authenticate.py
python3 target/evidence/virgl-hex-literals-verifier/audit.py
node renderer/virgl-shader/tests/hex-literal-regressions.mjs --native target/evidence/virgl-hex-literals-verifier/source/renderer/virgl-shader/build/native/virgl-shader --root target/evidence/virgl-hex-literals-verifier/source --output target/evidence/virgl-hex-literals-verifier/independent-guards.json
# Inside the owned frozen-source checkout:
bash renderer/virgl-shader/build.sh hex-literals-sanitize
bash renderer/virgl-shader/build.sh native
node tools/virgl-hex-literals/browser.mjs --output ../gpu-critic --seed 1821720247
# Owned scratch decoder sabotage: build native, run promoted guard (expected exit1),
# then finite-carrier subset (exact source/control mismatch); recorded in sabotage.json.
python3 target/evidence/virgl-hex-literals-verifier/seal.py
node --check renderer/virgl-shader/tests/hex-literal-regressions.mjs
git diff --check
```

Critic evidence of record:
`evidence/virgl-hex-literals/verifier/{manifest.json,records.json,recording.tar.gz}`.
The deterministic archive has 30 members, 562,502 bytes, SHA-256
`bb25e10d6b31a6efe547c8468a6b4d0f560b40c60650e85c6133bcbe33aa184d`;
index SHA-256 `e684ae0b0a697a59a89c57f01c15c8347fa2d2853d7233b269ee6a8ce0618977`.
Per-prediction concrete report points and digests are in `predictions.json`;
pre-inspection predictions digest
`d7e3d511c17a36227b6088ffe5108f158461bdf21862732c4a3f790b624b7ea6`.
Expanded critic reports are in `target/evidence/virgl-hex-literals-verifier`.

### 2026-10-04 — worker — critic guard integration

Authenticated all 30 critic archive members, the archive/index digests above
and the promoted guard source digest. Added the unchanged 49-case critic guard
to the recurring acceptance and receipt, including native/Wasm input/result
parity and native binary authentication. This test-only promotion does not
change runtime semantics; the frozen runtime, final cold proof and critic HELD
results remain unchanged. Narrow incremental checks passed:

```sh
node --check renderer/virgl-shader/tests/hex-literal-regressions.mjs
node renderer/virgl-shader/tests/hex-literal-regressions.mjs --native renderer/virgl-shader/build/native/virgl-shader --output target/evidence/virgl-hex-literals-promoted-guards.json
python3 -m py_compile tools/virgl-hex-literals/receipt.py
bash -n tools/verify-virgl-hex-literals.sh
git diff --check
```

All 49 native/Wasm guards passed; report SHA-256
`d52202d9894adc1475b9ec5b8706f061a95ee29c20a6e7b015cb2c1a3d9503ca`.
