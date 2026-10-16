---
id: E6-T12g6f
epic: 6
title: Admit bounded scalar truncation and sign operations
priority: 525.027010573
status: verified
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


### 2026-10-04 — verifier — VERDICT: verified

VERDICT: verified. Fresh adversarial session, never the implementer. Read the
complete task and scoped diff before recording the falsifiable predictions in
`evidence/virgl-scalar-operations/verifier/predictions.json`. Runtime/harness
freeze remains `ad0bf0267ce7a53e2e5ab6a2f6a5b2ee0a2383f4`, above independently
verified G6e `58601f91`. No runtime implementation, branch or commit was edited.

All11 predictions HELD; 0 FAILED; 0 NEEDS EVIDENCE. Report points below are
relative to `evidence/virgl-scalar-operations/verifier/`.

- P1 — HELD. All81members,223hot/218cold source rows, actual binaries/profiles and pristine scrubbed cold proof authenticate at the frozen source head. Citations: authentication.json#members,sources.hot,sources.cold,coldReport,receipts (SHA256 88a90744bb142db6a377bd0872a1fff11fffc6f22920aa09208cec86cf27d6ce)
- P2 — HELD. TRUNC rounds towardzero at fractions/integer neighbors/exponents and preserves source zero sign, as independently interpreted from TGSI and physical bytes. Citations: source-semantics.json#runs[].vertices[].scalarInstructions,predictedWords,all32bits,resultSha256 (SHA256 b3494476497fe9f0007cdf7fb29213b5ef616dd6349ca1b961794598a25f964b); independent-regressions.json#native/wasm:TRUNC-known-result bit projections (SHA256 622b2f6a027a8b8f807bed273344503f422980c4f917a64ca1b15931c8b2bfec)
- P3 — HELD. SSG yields exact-1/+1/canonical+0; dynamic subnormals retain their sign. Owned comparisons have one exact zero; primary-only mathematical zeros use the documented sign freedom. Citations: source-semantics.json#runs[].vertices:SSG,finite-bank-subnormal;fragments[].expectedRGBA (SHA256 b3494476497fe9f0007cdf7fb29213b5ef616dd6349ca1b961794598a25f964b); source-semantics-policy.json#GLSLES300 (SHA256 f852facbbd39efd868028ab8135454d61c8f2ef1d8ac63fc36cb0537c1e0c8c6)
- P4 — HELD. Masks consume post-swizzle lanes, aliases use old sources, negation precedes the scalar operation, and saved/killed versions and joins preserve provenance. Citations: independent-regressions.json#native/wasm:killed-lane,aliased-private-lane,finite-bank-negated,saved-version,predecessors (SHA256 622b2f6a027a8b8f807bed273344503f422980c4f917a64ca1b15931c8b2bfec); source-semantics.json#runs[].vertices:alias,masked,swizzled,join,modifier (SHA256 b3494476497fe9f0007cdf7fb29213b5ef616dd6349ca1b961794598a25f964b)
- P5 — HELD. Raw private words gain no numeric authority; literal nonzero subnormals/nonfinite values reject, typed I2F restores authority, and unknown F2I integers cannot launder it. Existing dynamic bank and component range obligations remain. Citations: independent-regressions.json#native/wasm:raw-numeric-denial,private-f2i,i2f-restores,ssg-result-integer,trunc-computed-range (SHA256 622b2f6a027a8b8f807bed273344503f422980c4f917a64ca1b15931c8b2bfec); consumer-attacks.json#banks[].predicted/result (SHA256 0ea690429b90ca82d41ba739d664a0a0d615cdda7c6d5e604e5502188e67859b)
- P6 — HELD. 1598native/Wasm singles/pairs,1562actual pinned float->float witnesses and740unique physical sources bind exact source/results and unchanged primary physical shaderSource; rejections remain closed. Citations: native-source-parity.json#nativeCases,primaryWitnesses,physicalSources,gpu[].bindings (SHA256 b26dbc51acebf664b05f9528e3567a8c2038806834b5d1dda9831e5282210b6a); carry-forward.json#retained (SHA256 d74c54faf94028137467b43341105025554af59c66b37b0ac8f8f5d8dc91a7ac)
- P7 — HELD. Strict own-data scalar policy rejects2008independent metadata attacks without getters,26parsed snapshots stay owned/frozen, and every old wrapper obligation remains. Citations: consumer-attacks.json#metadata,banks,ownership,getterCalls (SHA256 0ea690429b90ca82d41ba739d664a0a0d615cdda7c6d5e604e5502188e67859b); authentication.json#members:hot/consumer.json,cold/acceptance/consumer.json (SHA256 88a90744bb142db6a377bd0872a1fff11fffc6f22920aa09208cec86cf27d6ce)
- P8 — HELD. Both stages and sync/async actual consumers preserve complete prefixes/restoration/reflection and owned waits. Unsafe banks preserve CPU/GPU state before upload/index/draw; all objects/budgets endzero. Citations: source-semantics.json#runs[].draws,guardedAttacks,asyncWaits (SHA256 b3494476497fe9f0007cdf7fb29213b5ef616dd6349ca1b961794598a25f964b); fourth-seed-semantics.json#runs[0].draws,guardedAttacks,asyncWaits (SHA256 7a0cc3c8bd05a69f12c8007c4a58225b8126a7a3c126ac38f8376b64b4915d3b); cleanup.json#matchingOwnedProcesses,physicalLiveObjects,stateBudgets,drawBudgets (SHA256 c1adbca5663ff5aa436fac0f73f8dacf9512b064004040616e69d4e3197fa425)
- P9 — HELD. Every one of23runtime hunks/103added lines executes or has an explicit static-data/structure waiver. Actual recorded LLVM exports reproduce10/10helper lines,6/6branches,21/21regions; no dead or missing runtime path. Citations: coverage-audit.json#hunks,runtimeAddedLines,binaryBindings,helperCoverage,needsEvidence,dead (SHA256 c863c6b32fa5017e8841bd76b5134bf92ea037ba7165d3ae4f2282bc64c672f0); independent-regressions.json#native/wasm[1425..1426].result.metadata.scalarWordContract.operations (SHA256 622b2f6a027a8b8f807bed273344503f422980c4f917a64ca1b15931c8b2bfec)
- P10 — HELD. Four actual emitted-source numerical faults contradict independent physical word predictions; the isolated real C-helper mutation improperly admits negativezero bit31 and the promoted test catches it. Citations: sensitivity.json#physicalFaults[0..3],sabotage.case (SHA256 1a64b8f09da36abb3875ff17fede2bf7769af55557792d1cea1eb5a056634f6d); sabotage-regressions.json#failure.counterexample (SHA256 9e382a116276a3f053c183165f744535748f7c5185404cf4f81b3d98ee325811)
- P11 — HELD. 1427novel deterministic bit/lane/version/provenance cases have full native/Wasm parity; new fourth Apple M4 Max seed independently reproduces29088words/13632pixels and retains all guard/wait behavior. Citations: independent-regressions.json#cases,native,wasm,testSha256,nativeBinary (SHA256 622b2f6a027a8b8f807bed273344503f422980c4f917a64ca1b15931c8b2bfec); fourth-seed-semantics.json#runs[0] (SHA256 7a0cc3c8bd05a69f12c8007c4a58225b8126a7a3c126ac38f8376b64b4915d3b); source-semantics-policy.json#fourthSeed.changeWaiver (SHA256 f852facbbd39efd868028ab8135454d61c8f2ef1d8ac63fc36cb0537c1e0c8c6)

Authenticated all81 worker members,223hot/218cold source rows, both actual
sanitizer binaries/profiles and the existing pristine exact-source cold proof.
All prior HELD seals, unchanged renderer/consumer/conversion dependency bytes,
402 bounds/49 hex/108 signed/1575 conversion guards and25 literal originals
(23 admissions) carry forward. No duplicate cold clone or unrelated gauntlet
was run; rr/ssh dev remains waived by the September policy update.

Independent TGSI interpretation reproduces176,832 words /83,840 pixels across
the6 frozen hot/cold runs. Fourth headed Apple M4 Max seed2718281828 reproduces
29,088 words /13,632 pixels,20 guarded range attacks and2 actual immutable
waiting-index plans. Every served compiler/probe/consumer/Wasm source remains
frozen. Its broad inventory included the untracked critic guard at its earlier
1425case version; that file was never served/imported. The exact inventoried
snapshot is preserved, and the final1427case guard has separate full
native/Wasm proof. See source-semantics-policy.json#fourthSeed.changeWaiver.

Coverage:23 runtime hunks /103 added lines execute or have explicit static
declaration/data/structure waivers; needsEvidence=[] and dead=[]. Re-exporting
both actual LLVM recordings reproduces10/10 helper lines,6/6 branches and
21/21 regions. Function signatures bind to body-entry counts3108/6158/6158.
Both-operation native metadata also executes in the new guard at
native/wasm[1425..1426]. All scoped semantic/domain/ownership/hardware angles,
one bounded novel attack and real-source test sabotage pass. Four actual
emitted-source faults independently contradict the predicted physical words.

SUITE: promoted `renderer/virgl-shader/tests/scalar-operation-regressions.mjs`
(SHA `5bc2520293dc934249f91e962f6328f36053cf702960200a8731e068d122fba8`). It contains1427 deterministic
known-result-bit/lane/version/provenance/native/Wasm guards. Report schema
`virgl-scalar-operation-critic-guards-v1` has integer cases, complete native
and Wasm arrays, testSha256 and nativeBinary.sha256. Actual native binary SHA
`bd87ef36fa9951ab36bdb1b6f90006567fe4e77ef54e1c84893ddc571111533e`; complete guard report SHA
`622b2f6a027a8b8f807bed273344503f422980c4f917a64ca1b15931c8b2bfec`.
The isolated real C TRUNC helper fault replaces source-sign zero with+0:
`sabotage-regressions.json#failure.counterexample` predicts rejection for
`TRUNC-known-result-2147483648-bit-31`, but the mutant admits it. The promoted
test catches that source fault. The worktree implementation was never changed.

Additional direct attacks:2008 hostile metadata cases,872 bank/prefix cases
and26 immutable snapshots, with zero getter calls. Two critic expectation
corrections are retained explicitly: typed I2F requires its inherited F2I
component guard rather than a new whole finite domain; sparse bank extensions
must fail before numerical value checks. Neither was a product contradiction.
All owned browser processes, native objects and state/resource budgets close.

Commands and reopening instructions are in verifier README.md. Node/Python
syntax, source/record authentication, actual LLVM/V8 audit, exact native/Wasm
guards, source-derived physical words/pixels and git diff --check pass.

Verifier seal: `evidence/virgl-scalar-operations/verifier/{manifest.json,
records.json,recording.tar.gz}`;51 actual members,4,617,019 archive bytes,
archive SHA `c5fd50cd563707c31c5c6ac52e360e0a711cdb16c088a2fff64a8461381c06e4`;
index SHA `7ac5c0e5a368a575d0dbb1ac9607a357830a30d5198aaa0cce37e54c71f41b9a`;
verdict SHA `2fdbc8ae6450f90c36d0fce9863a2e8439f72c9872b480076e201061953f1909`.
Every sealed member was reopened and length/SHA authenticated. Worker and
prior HELD archive digests are retained as immutable dependencies. No remaining
semantic contradiction or proof gap. Production caps/imports, complete
captured compositor admission, guest boot and MIPS/FPS remain gated.


### 2026-10-04 — worker — permanent guard integration

Authenticated every one of the 51 final critic seal members and every verdict
citation, including archive SHA `c5fd50cd563707c31c5c6ac52e360e0a711cdb16c088a2fff64a8461381c06e4`.
Wired the critic's 1,427-case native/Wasm regression into the recurring
`make verify-E6-T12g6f` command; its receipt now authenticates the exact test
source digest and schema and requires complete native/Wasm result arrays.
Focused command: `node renderer/virgl-shader/tests/scalar-operation-regressions.mjs
--native renderer/virgl-shader/build/native/virgl-shader --output
target/evidence/virgl-scalar-promotion.json` — passed all 1,427 cases;
report SHA `5fb1bba137d94ed7090a4a099da4e2b8867475eaa69aad0e954bb45805376a1c`, test SHA
`5bc2520293dc934249f91e962f6328f36053cf702960200a8731e068d122fba8`.
Node/shell/Python syntax and `git diff --check` pass. These additions change
only the promoted regression and recording hooks; frozen runtime, original
worker recordings, pristine-clone proof and every independent HELD result
remain unchanged. No broad runtime gate or duplicate cold clone was needed.
