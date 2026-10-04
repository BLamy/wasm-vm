---
id: E6-T12g6e
epic: 6
title: Admit bounded signed integer and float conversions
priority: 525.027010572
status: implemented
depends_on: [E6-T12g6d]
estimate: S
risk: high
capstone: false
---

## Boundary

Add I2F/F2I with explicit binary32 rounding and a documented TGSI-defined conversion domain. Preserve typed private/raw shadows and numeric/output provenance. Implement or reject out-of-domain values before any undefined GLSL conversion; no SIN/POW/TRUNC opcode.

Production GPU negotiation, live demo imports and caps remain disabled. No FPS
or MIPS claim follows from this isolated compiler boundary.

## Deterministic acceptance

`make verify-E6-T12g6e`: Independent word equations and pinned Mesa differentials for signed endpoints, representable neighbors, ties, fractional truncation, both zero signs and forbidden/nonfinite inputs. Native/wasm and physical GPU source/modifier/lane cases. Bind any required range/typed-bank contract through all synchronous/async consumers; unsafe runtime banks must not issue draws.

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

Continued the user's guest graphics offload work above independently verified
G6d `7f2cdec8`. Only this S/high conversion boundary occupies the active lane.
Pinned TGSI I2F suggests nearest-even while leaving rounding unspecified; this
profile chooses explicit binary32 nearest-even. F2I truncates toward zero only
for finite encodings below positive2^31 or at most negative2^31. Use bounded
unsigned word helpers and static known-bit range proofs; unknown direct,
unmodified constant operands require exact component-bank range guards before
all sync/async uploads, restorations and draws. Reject other unproven computed,
input or indirect sources. Float source modifiers apply only to range-proven
F2I encodings; integer I2F modifiers remain unsupported. Preserve the fixed IR
layout and all preexisting profile obligations in bounded conversion wrappers.
Integer outputs stay private; explicit I2F results receive normal/zero numeric
and output authority. Record endpoints, rounding ties, fractional truncation,
subnormals/zero signs, masked/swizzled aliases, source versions, joins, physical
words/pixels, changing banks and deliberate rounding/range/source faults. The
complete captured compositors remain gated until their own full-shape range
proof and remaining opcodes. No production imports/caps or MIPS/FPS claim.

### 2026-10-04 — worker — implementation freeze

Added unsigned C/GLSL conversion helpers, static bit-range proofs and direct
constant component obligations without enlarging the fixed IR. Conversion
profiles v29/v30 preserve their entire v1..v28 base metadata. The state renderer
uses one owned complete prefix for base and conversion checks before sync/async
uploads, restoration, index access and draws. Synthetic private browser paths
exercise source modifiers, input words, aliases, joins, masks, changing banks,
actual indexed draws, reflection pruning, held async plans and zero budgets.
The final recording target is `make verify-E6-T12g6e`; its source-only rational
oracle and independent Python binary32 receipt never derive expected pixels
from emitted GLSL. Deliberate rounding/truncation/helper and real range-guard
faults are rejected by those oracles. Pinned Mesa word differentials exclude
float-TEMP NaN/subnormal payload cases; owned evidence retains all defined
words. No production/demo import changes, so the public demo gate is not yet
applicable. Final exact-source evidence and independent verification follow.

### 2026-10-04 — worker — recorded submission

Frozen runtime/harness source `2e67fac91552702add11c701f61d6c4c0af2260c`
(runtime freeze `c4b811d7686e4fa59706324fcec6c3eecdc559d0`), above verified
G6d `7f2cdec89ca53b37bac120538bb168aaa153d62f`.

Commands: `make verify-E6-T12g6e`; evidence-only serialization repair followed
by `node tools/virgl-signed-conversions/consumer.mjs
 target/evidence/virgl-signed-conversions/native/report.json
 target/evidence/virgl-signed-conversions/consumer.json`, Node syntax/Python
compile checks, and `python3 tools/virgl-signed-conversions/receipt.py
 target/evidence/virgl-signed-conversions`; `python3
 tools/virgl-signed-conversions/cold.py --output
 target/evidence/virgl-signed-conversions-cold`; `python3
 tools/virgl-signed-conversions/seal.py --hot
 target/evidence/virgl-signed-conversions --cold
 target/evidence/virgl-signed-conversions-cold --output
 evidence/virgl-signed-conversions/worker`.

The original hot run passed every runtime/physical check but its receipt
caught evidence serialization invoking rejected metadata getters. The only
repair touched `consumer.mjs`/`receipt.py`; no runtime source changed. Reran
that missing proof (324 contracts /7,849 forgeries /9 owned banks /4 preserved
base wrappers /zero getter calls). The receipt carries earlier immutable
runtime recordings only after an ancestor diff restricted to those two
harness files and exact served-source digests. The final pristine scrubbed
clone ran the entire acceptance at `2e67fac9`, with clean checkout before/after.

The recording proves 364 native singles /325 actual pinned parser/converter
witnesses /364 exact Wasm singles and closed pairs; ASan/UBSan, repeat/recovery,
retained 25 originals with23 admissions and unchanged source/metadata;
402 bounds,49 hexadecimal and108 signed-selection promoted guards. Three
physical-GPU seeds checked 114,408 words and37,568 pixels, with no browser
errors and all native objects/budgets disposed. Each seed includes all32
result bits/planes, source modifiers/versions/aliases/joins, actual input
attributes, four changing-bank consumer rigs and four actual indexed-draw
rigs. Unsafe finite F2I banks reject before upload/index access/draw, complete
prefix checks survive reflection pruning, and approved snapshots survive
caller mutation and actual async index waits. All prior loop/radial/raster/
precise obligations remain intact. Independently recomputed helper coverage
from the authenticated binary/profile records is in
`hot/native/coverage-helpers.json`: all29 lines /28 branches /61 regions
executed; helper counts1,414 I2F /1,342 range proofs /1,158 F2I.

Deliberate fault points: `hot/fault-rounding/report.json` carrier lane5
expected1056964610, observed1056964609 (SHA
`41df8851b593bf668b0568c8bd0e5956e56f102b9d92add975a530cd95723024`);
`hot/fault-truncate/report.json` lane5 expected1065353215,
observed1056964609 (SHA
`f007f0e9d01ddc18daedfcaf90510996d20de7102e0f1c4724850d1c14f89115`);
`hot/fault-range/report.json` independent intercept stopped
`uniform4uiv` at bank word181 =0x4f000000 before any unsafe native effect
(SHA `6eef61c9afa4b348e8cc60b1c77445cd1fb70b3687d17b03f5e4b8ed18229e16`).

Evidence: `evidence/virgl-signed-conversions/worker/{manifest.json,records.json,
recording.tar.gz}`:81 authenticated members, archive11,907,860 bytes /SHA
`0302fd33c25937206456e6549502f89122fdb73f622c920c573be8bc4da6b336`;
index SHA `b7028f12a864bc0b716ce20ad870caaa0a771a617bf82df1c17696e720edc833`;
hot receipt `07ee905bfc1214795cef35cee3d0766508f994b0362203ab55d5a9781a21379d`;
cold receipt `d049394dc76b82cb6cb58715db4cd7c0a7dae7f2ce2b6c8006c09c63ed8b80fb`.
Pinned Mesa raw TEMP comparisons remain restricted as documented; owned
checks cover all defined words. The two complete compositor programs,
production imports/caps, guest boots and MIPS/FPS remain outside this claim.
A fresh critic must set the verdict before G6f can activate.
