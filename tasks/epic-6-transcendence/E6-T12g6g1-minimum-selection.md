---
id: E6-T12g6g1
epic: 6
title: Admit exact word-local minimum selection
priority: 525.027010574
status: implemented
depends_on: [E6-T12g6f]
estimate: S
risk: high
capstone: false
---

## Boundary

Add ordinary MIN and instruction-local MIN_PRECISE following the already separated MAX selection/precision model. Preserve exact operand selection/NaN/zero word contracts for private precise results and inherited ordinary output domains. No FRC_PRECISE.

Production GPU negotiation, live demo imports and caps remain disabled. No FPS
or MIPS claim follows from this isolated compiler boundary.

## Deterministic acceptance

`make verify-E6-T12g6g1`: Independent selected operand words at equal values, signed zeros, normal/subnormal and NaN payload boundaries; numeric plain-MIN pixels and exact private raw captures. Test all masks, source modifiers, aliases, adjacent precise/plain instructions and source-selection faults; carry old MAX/FSEQ/FSNE precision contracts unchanged.

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

Activated this S/high boundary above independently verified G6f `79cae493`.
The pinned TGSI definition gives component-wise MIN; ordinary numeric emission
uses unchanged GLSL `min` and retains existing finite numeric authority.
Instruction-local MIN_PRECISE follows the existing private MAX selection model:
choose the first original word only when it is ordered strictly smaller;
equal values, both signed zeros and unordered comparisons choose the second
original word. Negation applies before selection; private NaN payloads and
subnormals remain words and gain no new numeric/output authority. Preserve
whole previous precision, finite-bank, raster, arithmetic, conversion and
scalar obligations with one bounded outer contract. Record native/Wasm and
physical word/pixel proofs, masks/aliases/modifiers, adjacent precise/plain
instructions, source-selection sensitivity, varied seeds and one final cold
clone; submit to a fresh critic. Production negotiation and performance claims
remain gated by dependent integration tasks.

### 2026-10-04 — worker — implemented

Runtime/native harness frozen at `2412ecf2e4350cd21eadf10b3f022fdbd7e75e1d`;
final recording harness at `2be8709b05a9f6bcaf9f2a543a62d9eda37656ed`, above
verified parent `79cae493`. Ordinary MIN keeps inherited finite numeric authority
and GLSL `min`. MIN_PRECISE selects the original first word only for ordered
strictly-less comparisons, otherwise the original second word, after source
negation. The bounded v32 wrapper preserves each complete earlier policy and
does not alter old MAX/FSEQ/FSNE precision contracts, IR sizes, state consumers
or production negotiation.

Commands:

```sh
make verify-E6-T12g6g1
# Evidence-only GPU schedule/oracle and failed-report binding repair;
# repeat just the affected physical captures, retaining unchanged runtime proofs.
for seed in 1369979863 2804203833 3781791491; do
  node tools/virgl-minimum-selection/browser.mjs --output "target/evidence/virgl-minimum-selection/gpu-$seed" --seed "$seed"
done
node tools/virgl-minimum-selection/browser.mjs --output target/evidence/virgl-minimum-selection/fault-selection --fault selection
# The source fault must fail; receipt authenticates its actual failure and disposal.
python3 tools/virgl-minimum-selection/receipt.py target/evidence/virgl-minimum-selection
python3 tools/virgl-minimum-selection/cold.py --output target/evidence/virgl-minimum-selection-cold
python3 tools/virgl-minimum-selection/seal.py --hot target/evidence/virgl-minimum-selection --cold target/evidence/virgl-minimum-selection-cold --output evidence/virgl-minimum-selection/worker
```

The hot receipt records 961 native cases (917 accepted, 44 rejected), 913 actual
pinned-converter comparisons, 961 Wasm singles and pairs, 917 owned contracts,
661 metadata attacks, 16 banks and four complete inherited policy bases. All
402 bounds, 49 hexadecimal, 108 signed-integer, 1,575 signed-conversion and
1,427 scalar critic guards pass, as do 84 earlier precision cases. Retained
originals preserve 23/25 admissions; both unsupported full compositor bodies
remain rejected. The historical 112-body corpus retains its five admissions.

Three headed physical M4 Max runs independently check 166,752 words and 17,344
pixels, including all destination masks, swizzles, aliases, conditional versions,
source negations, signed zeros, private NaN/subnormal payloads, actual input and
bank updates, sync/async rendering, guard rejection before upload/draw, restoration
and disposal. Each seed checks 55,584 words; pixel counts are 6,464, 5,440 and
5,440. Unchanged primary GLSL participates only for normal/zero operands; ordinary
GLSL zero signs are unconstrained, while precise private zeros and unwritten
masked-copy lanes remain exact. Deliberately reversing the precise selection
helper fails `MIN_PRECISE/direct/owned/edge-MIN_PRECISE-0` at lane 6: expected
1056964608, observed 1056964609. Actual fault output and cleanup are recorded.

The initial full target completed runtime, native, Wasm, consumer and hardware
proofs but its receipt exposed a primary-reference schedule gap, then a failed-run
report-name binding error. Only the four declared recording/oracle files changed;
every runtime byte stayed frozen. The affected physical captures were repeated
at the final harness head; `gpu-refinement-final.log` preserves the successful
normal runs and deliberate failure. The initial `acceptance.log` and earlier
repair log are retained honestly. The receipt authenticates the two hot heads
and all unchanged runtime/source bytes rather than claiming a single original
full-target pass. One pristine clone at the final exact head, with RUST_LOG and
any RUSTFLAGS/CARGO_* removed, then passes the entire target; clean status before
and after is recorded. No second cold clone was needed.

Evidence: `evidence/virgl-minimum-selection/worker/{manifest.json,records.json,recording.tar.gz}`,
82 authenticated members, 17,813,706 archive bytes. Archive SHA-256:
`4cde54d259703ba0c62f7f70f88820fdb53faa06621f5b7b0d5f372066ebc394`;
index: `97bb60698f66009bfa1bf0fe498797b9c2601967693c61f7f9017bf18e6456a7`;
hot receipt: `1626d7928fba3db259e729293ba56fa1a0231b39be79cf4cebe04cbd86926895`;
cold receipt: `f15cf1cdaccf85b79393ecbb462cf93f8e58704ee93bbabd410ad03e7c2c37f1`.
Unsealed originals remain in `target/evidence/virgl-minimum-selection{,-cold}`.
Both actual sanitizer binaries and coverage profiles are sealed. This submission
claims only the isolated compiler/consumer boundary, with no guest boot, live
offload, FPS or MIPS claim. A fresh adversarial critic must decide verification.
