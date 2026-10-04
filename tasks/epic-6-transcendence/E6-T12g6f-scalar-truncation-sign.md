---
id: E6-T12g6f
epic: 6
title: Admit bounded scalar truncation and sign operations
priority: 525.027010573
status: implemented
depends_on: [E6-T12g6e]
estimate: S
risk: high
capstone: false
---

## Boundary

Add finite numeric TRUNC/SSG and preserve existing numeric versus raw private authority. State signed-zero and result-domain behavior from the pinned TGSI primary source. No precise floor/fract or saturating modifier.

Production GPU negotiation, live demo imports and caps remain disabled. No FPS
or MIPS claim follows from this isolated compiler boundary.

## Deterministic acceptance

`make verify-E6-T12g6f`: Literal scalar word/pixel predictions for negative/positive fractions, integer neighbors, both zeros, lane/swizzle/modifier cases and inherited finite input restrictions. Native/wasm and independent actual hardware outputs, raw-sign/subnormal/domain attacks, source-fault sensitivity and existing numeric profiles.

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

Activated this S/high boundary above independently verified G6e `58601f91`.
Pinned TGSI defines component-wise TRUNC as dropping fractional bits toward
zero and SSG as +1/-1/0 for positive/negative/zero inputs. This bounded owned
profile preserves the TRUNC source zero sign and gives SSG canonical positive
zero for both input zero signs. Ordinary unmodified Mesa GLSL comparisons
permit either encoding of a mathematical zero, following the pinned GLSL ES
floating contract; owned full-word checks require the declared exact policy.
Both operations require existing finite numeric authority; raw private
integer encodings gain no new numeric access. Preserve prior finite-bank,
input, mask/swizzle/modifier, alias/version/join and conversion obligations.
Implement unsigned word helpers over approved source encodings, one bounded
outer profile, native/Wasm and actual physical-word/pixel evidence, varied
seeds, real source faults and one final pristine clone. Production negotiation,
complete captured compositor admission and FPS/MIPS remain gated. Fresh
independent verification must hold before the next dependent activates.


### 2026-10-04 — worker — final exact-source submission

Frozen runtime/harness head `ad0bf0267ce7a53e2e5ab6a2f6a5b2ee0a2383f4`;
parent independently verified G6e `58601f91`. Commands: `make
verify-E6-T12g6f`; `python3 tools/virgl-scalar-operations/cold.py --output
target/evidence/virgl-scalar-operations-cold`; `python3
tools/virgl-scalar-operations/seal.py --hot target/evidence/virgl-scalar-operations
--cold target/evidence/virgl-scalar-operations-cold --output
evidence/virgl-scalar-operations/worker`. Pristine clone started and ended
clean at the exact frozen head with scrubbed environment. No runtime changes
were applied during or after recording. Guard syntax checks, ASan/UBSan,
repeat/recovery, 1,598 native public cases, 1,562 actual pinned TGSI parser/
converter witnesses and all1,598 Wasm singles/pairs passed. All25 original
shader bodies retain23 byte-identical admissions; the two complete captured
compositors remain rejected. The unchanged 402 bounds,49 hex,108 signed and
1,575 conversion critic guards pass. Native LLVM records cover all10 helper
lines,6 branches and21 regions. Existing IR sizes remain112/111744 bytes.

Each hot/cold physical recording covers seeds1369979863,2804203833 and
3781791491:29,472 words each and14,656/13,632/13,632 pixels respectively;
total88,416 words /41,920 pixels per run. All32 result bits/planes include
fractions, every native exponent class, integer boundaries, both zeros,
source swizzles/negation, masks, aliases, joins, dynamic bank subnormals,
actual input attributes and unchanged Mesa GLSL. Owned zero predictions
remain exact; ordinary primary zero comparisons retain the documented
mathematical ±zero allowance. Metadata consumers record1,554 contracts,
706 malformed-contract attacks,8 owned banks and4 complete preserved
loop/radial/raster/arithmetic/conversion bases, with zero getter calls.
Four real sync/async indexed-draw rigs preserve complete bank ownership,
changing A/B/A values, restoration, reflection pruning, caller mutation,
held waiting-index plans and unchanged F2I range checks before every upload/
index read/draw. Unsafe banks leave CPU snapshots and physical pixels
unchanged; all native objects and state/resource budgets end at0.

Deliberate source faults contradict independent mathematical predictions:
`hot/fault-truncate/report.json`, TRUNC carrier lane4 expected1056964608,
observed1056964609 (SHA `fc61d9a3eb6244bb8c23832c9c52cc86b1f659be554d62bc294aa738d0a4d357`);
`hot/fault-sign/report.json`, SSG lane9 expected1056964991,
observed1056964735 (SHA `aa0fa7daec04b670d862e9de16d4792295a167c5078886a0b1fe3d76926864dd`).
The separate Python receipt recomputes every captured word, bit plane and
actual indexed pixel from source values; no emitted shader supplies its
predictions. Both actual sanitizer binaries/profiles are retained for
independent coverage re-export.

Worker seal: `evidence/virgl-scalar-operations/worker/{manifest.json,records.json,
recording.tar.gz}`; 81 authenticated members,
archive13380867 bytes /SHA `619627d6ed0a2f3f62d461e0f3699bc1da7c04cfa4a9f1f2d18dd0a2e1fdbb68`;
index SHA `65f3c277eb411b162186fed14447a80a30b07c41d02daef5ae018312a9099959`;
hot receipt `8bae5711c6563483291b810084b953f76f338f834cbfef7317c2ebf9ee79ea4b`;
cold receipt `ab14fda9273a9aebb4e56efd8442dce01fdc9fe6937081c180058eb0c9c58ba9`.
This proves only the private finite scalar compiler/consumer boundary.
Complete compositor admission, production imports/caps, guest boot and
MIPS/FPS remain gated. A fresh adversarial session must set the verdict.
