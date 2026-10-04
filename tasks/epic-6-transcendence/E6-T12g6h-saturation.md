---
id: E6-T12g6h
epic: 6
title: Admit bounded MOV and DIV saturation modifiers
priority: 525.027010576
status: implemented
depends_on: [E6-T12g6g2]
estimate: S
risk: high
capstone: false
---

## Boundary

Add only captured MOV_SAT/DIV_SAT spellings and apply the TGSI-defined clamp after the underlying numeric operation. Preserve modifier locality, masks, source authority and existing plain MOV/DIV semantics. Other unproved saturation/opcode combinations remain rejected.

Production GPU negotiation, live demo imports and caps remain disabled. No FPS
or MIPS claim follows from this isolated compiler boundary.

## Deterministic acceptance

`make verify-E6-T12g6h`: Independent clamp equations and actual words/pixels below0, at0/1, between, above1 and near rounding/divisor boundaries. Test numeric domain exclusions, all lanes, aliases, adjacent saturated/plain instructions and clamp order faults through native/wasm and WebGL2. No undefined division or raw-word authority shortcut.

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

### 2026-10-04 — worker — implemented

Frozen source `81dfb7c010eb117d93335bc3a7c91878546449f8`; runtime
`31641b3fb5fa4e09256531df67dfaaadf651b0ea`; verified predecessor
`bad92bfdaba16295b064a78c0767652da09be158`. The later two commits repair only
evidence: the ESSL-permitted interchange of numerical signed zeros and byte-set
comparison order. Raw ordinary MOV/copy predictions remain exact. No runtime
changed after the native/Wasm recording.

Commands: `make verify-E6-T12g6h` at the runtime head; after the evidence repair,
`node tools/virgl-saturation/browser.mjs --output target/evidence/virgl-saturation/gpu-$seed --seed $seed`
for seeds `1640573655`, `3073696041`, `3798507267`, and the same command with
`--output target/evidence/virgl-saturation/fault-$fault --fault $fault` for
`lower`, `upper`, `order` (all must fail); then
`python3 tools/virgl-saturation/receipt.py target/evidence/virgl-saturation`.
The acceptance target records syntax/guard checks, ASan/UBSan native and pinned
parser/converter witnesses, Wasm singles/pairs, retained originals, promoted
critic guards, consumer ownership, legacy responses and physical GPU results.

Cold command: `python3 tools/virgl-saturation/cold.py --output target/evidence/virgl-saturation-cold`.
One pristine clone at the frozen source passed native/Wasm/first-seed proof,
then lost Chrome's execution context during the second seed. Recovery command
`python3 /tmp/wasm-vm-saturation-cold-recovery.py` reran only the remaining two
seeds, three faults and receipt in that same scrubbed, unchanged clone. The
script, original failure, exact commands and clean before/after checks are
archived. No mathematical result was available from the interrupted attempt.

Seal command: `python3 tools/virgl-saturation/seal.py --hot target/evidence/virgl-saturation --cold target/evidence/virgl-saturation-cold --output evidence/virgl-saturation/worker`.
The seal contains 123 authenticated members and both actual sanitizer binaries.
Archive SHA256 `0f23bfac558168d1207a3841028243ba5d0d1c4cb9f34faac2d2ebf8fa220b53`;
index SHA256 `3652615c51b879418d967067e6394b978f30fa118085b0b04a3d4c6ef18b185b`.
Hot receipt SHA256 `0273c4d54a0d67f7fc2ea64c3f9eacb04c09f94205eda3f0a0b0ecf27620690f`;
cold receipt SHA256 `55e23cf85c16f7fcd7b1dcb5468e826c7c1be0aa322cbf21e6536b073da82ab3`.

The recordings demonstrate 1,313 native/Wasm singles and pairs, 1,245 actual
pinned witnesses, 2,933 unchanged whole predecessor responses, 836 metadata
attacks, 18 owned banks and four composed prior bases. Each hot/cold set checks
121,032 physical words and 79,872 pixels through both backends, four exact
captured statements, all masks, aliases, versions, bank A/B/A updates, restoration
and source modifiers. All three emitted-source faults contradict the independent
oracle; successful runs dispose all GL/renderer objects with zero errors. The
independent Fraction receipt authenticates predictions and readbacks. The
defensive unsafe-known-numerator branch is unexecuted after old numeric authority
rejects such sources; this premise is explicitly submitted for coverage review.

This boundary adds no computed F2I range facts. Complete original compositor
bodies, production negotiation and guest caps remain gated. No guest-offload,
FPS, MIPS or deployment claim is made; fresh verification is still required.
