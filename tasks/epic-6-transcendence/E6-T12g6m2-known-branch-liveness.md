---
id: E6-T12g6m2
epic: 6
title: Exclude proved unreachable raw UIF edges after complete validation
priority: 525.027010587
status: verified
depends_on: [E6-T12g6m1]
estimate: S
risk: high
capstone: false
---

## Boundary

A live raw UIF condition with exact zero or a proved one bit can exclude one
edge without granting dynamic numeric authority. On one final whole-text retry,
first validate every declaration, opcode, operand, modifier, label/target and
size/depth/loop bound in the unmodified source, then omit only operations on
proved unreachable predecessors. UIF is integer/raw-word nonzero; raw negative
zero and nonzero NaN encodings are true. Preserve source swizzles/versions,
masked writes, joins, address initialization, nested parent liveness, terminating
discard and live output obligations. Unknown, overwritten and conflicting joins
retain both edges. No fake lane facts, captured CONST values or IN ranges follow.
Dead data/indirect reads retain declaration and grammar checking; unused ADDR
remains rejected unless an actual proved dead indirect use accounts for it.
Keep original instruction indexes and bounded IR sizes. Complete old successes
win byte-identically, with a strict owned wrapper for genuinely new admission.

This is one private compiler control-flow boundary. Full literal compositor
admission remains E6-T12g6m with all its numerical, uniform ownership, indirect,
reflection and hardware criteria. Public imports/negotiation stay disabled;
there is no live offload, FPS or MIPS claim.

## Deterministic acceptance

`make verify-E6-T12g6m2`: strict affected C/JS gates, ASan/UBSan original native
binary/profiles, exact complete native/Wasm singles/pairs, handwritten raw-UIF
branch predictions, actual physical raw words/RGBA pixels over three seeds,
owned strict metadata and consumer guards, zero errors/objects/budgets.
Cover known true/false with/without ELSE, +0/-0/NaN raw truth, swizzles and
masked producers, partial proved-one and exact-zero facts, overwritten and
unknown/joined controls, nested dead parents, live discard and fallthrough,
missing live TEMP/output/address writes, actual dead indirect uses, and every
complete dead-text opcode/operand/target/depth/instruction/source-size boundary.
Unrecognized loops remain unsupported, including within pruned arms. Preserve
all old admitted results and close every previously rejected extension with
complete source hashes; bind both larger unchanged original bodies and their
continued rejection. Record word/control source-fault sensitivity, complete
changed native/Node/browser source coverage, exact frozen source receipts and
one scrubbed pristine clone. Fresh critic must inspect the actual recording.

## Adversarial verification

Predict every liveness/word/initialization/metadata result before inspection.
Attack raw signed-zero truth, wrong source lane or source version, nested parent
liveness, terminating-discard joins, forged constants from observations,
unknown-bit controls, missing live output/address authority, unsupported or
malformed dead tails, loop certificates, complete target/size/depth bounds and
strict policy/accessor ownership. Execute all scoped angles and one bounded
novel attack; sabotage new tests. Interrogate original native/V8 coverage
against every changed runtime hunk; unexecuted behavior requires evidence or
deletion. Carry unchanged predecessor HELD evidence with explicit boundary and
recording digests. Full original requirements remain gated.

## Verification log

### 2026-10-05 — worker — activation

Known arithmetic predecessor verified at `97dc44d2fbc9284705ad81630998bb533186c9a1`;
its runtime and complete original evidence remain bound to `cba5ae02`. Three
read-only frozen-native diagnostics in `/tmp/wasm-vm-known-branch-prerequisite-plan.json`
show known-false, known-true and dynamic UIF bodies currently reject at an
unsafe SIN despite the first two having a provably unreachable edge. The
17 handwritten planning fixtures and implementation design under /tmp are
not acceptance evidence. This leaf proves raw known-predicate liveness;
full original uniform/geometry/address obligations stay with E6-T12g6m.

Primary UIF definition:
https://docs.mesa3d.org/gallium/tgsi.html#uif-bitwise-if (consulted 2026-10-05).

### 2026-10-05 — worker — recorded submission

Runtime commit `1363810b97aad6f6d93077fe466babec94311cab`; final recording
source `8e6e3848b2df4a3bf5703a517e33d345e3b0c96c`, above verified predecessor
`97dc44d2fbc9284705ad81630998bb533186c9a1`. The latter changes only the coverage
reader to consume the original browser recording envelope. No runtime changed
after the frozen implementation. The first frozen run passed product checks but
its reader failed on that envelope; it is not the acceptance claimed here.

Commands at the final recording source:

```
VIRGL_KNOWN_BRANCHES_EVIDENCE_DIR=target/evidence/virgl-known-branches-final-2 make verify-E6-T12g6m2
python3 tools/virgl-known-branches/cold.py --output target/evidence/virgl-known-branches-cold
python3 tools/virgl-known-branches/seal.py --hot target/evidence/virgl-known-branches-final-2 --cold target/evidence/virgl-known-branches-cold --output evidence/virgl-known-branches/worker
```

Both complete acceptance runs passed. Their deterministic requests record 253
complete singles/pairs, eight independent raw predicate states and two zero
arithmetic identities under all four host rounding modes. Original ASan/UBSan
stderr is empty; storage remains `[111744,112,32448]`. All complete native and
Wasm C results agree, including errors. The unchanged JavaScript facade's
pre-existing invalid-ASCII/NUL diagnostic differs from the C diagnostic; both
are recorded, with complete parity for all other facade results.

The literal schedule covers exact/partial raw proof, signed zero and nonzero
NaN truth, swizzles, masked/source-version writes, unknown and conflicting joins,
parent liveness, discard/fallthrough, missing live initialization and output,
actual dead indirect uses, full dead-text grammar, source/instruction/depth
boundaries, certified dead/live loops, texture and inherited raster/coordinate/
conversion contracts. Sixteen prior literal fixtures keep their original
successful profiles. The consumer records 627 owned-policy attacks with zero
getter calls, descending base validation, copied/frozen safe banks and retained
inherited range guards. The original authenticated predecessor native/Wasm
artifacts compare 10,717 complete results (10,464 historical plus 253 new) and
2,683 pairs. All 177 new extensions have closed full-source hashes and the v41
policy; all other results remain exact. Both larger original fragment bodies
and their full pairs remain unchanged and rejected, recorded in `native/` and
the full original cases. Their admission is not claimed.

Each headed physical Chrome/Apple M4 Max ANGLE/Metal seed (`608135816`,
`2242054355`, `320440878`) records 480 exact raw words and 1,968 exact byte
pixels, totaling 1,440/5,904 per acceptance. Readback covers selected literal
carriers, signed conversion, live/dead discard, dynamic negative discard,
live/dead sampler and certified loop paths. Actual sync/async renderer bank
copy/restore passes; finite out-of-range updates remain CPU-only and nonfinite
wire updates reject atomically. Browser errors, GL errors, objects and retained
state/resource budgets finish at zero. Deliberately changed submitted shader
sources fail with one word-fault and eleven control-fault contradictions;
`capture-fault-*.json` recomputes the observed words independently. Raw readback,
submitted source events, original V8 profiles and screenshots are retained.

`coverage-audit.json` cites 25 original native sites, four original Node V8
sites and three original browser profiles against the changed runtime hunk
inventory. The touched inherited arithmetic supplement additionally records
four exact prior literal singles/pairs, five specific native and two specific
V8 regions, using unique original-source anchors in place of stale offsets.
Original binaries, raw/merged profiles and source digests are preserved. The
fresh critic must judge complete hunk sufficiency and the stated invariant
waivers; the worker does not set verified status.

The pristine clone ran the same complete command once at the exact final source
with the configured environment scrubbed, empty before/after status and exit 0.
Its original receipt is `cold/acceptance/receipt.json`, SHA256
`d3c887a96eb313b6f7ddb1cc18dfdcc3093ca22d38af6152701f0ae330bd70d1`.
Hot receipt SHA256:
`fc9eb62c7d9607b326790ed245bc3488a67d7fb949950abad7adece096f81ccc`.

Sealed evidence: `evidence/virgl-known-branches/worker/`, 146 indexed original
members, 13,227,552 archive bytes. Authentication checks every member, receipt
record and non-generated source digest. Both actual sanitizer binaries are
included, hot SHA256
`f6b310eca0495cc3a12601b8ab6a05c9c531c5284224b557bbfdbf2bd5915070`
and pristine-clone SHA256
`b2c7b6a3e32c0d172975fe98922e967a66ffa1f3e18a6a52044e3553387cfdd5`.

- Manifest `3060fcc17713548f4ccc9e266c401449156c3fbe25d3a9885a4b3506117a1b11`.
- Archive `c5cf668e9591991c253a976104e2bf7a9f95825e4baac6aa645897164fc23e29`.
- Index `3e984daf15c2d029330251a1653d69efbd07f1e5df6d5fb29fa1cdb44ce21da3`.

Predecessor HELD evidence remains immutable: known-arithmetic worker manifest
`e211633f326cd8e43e37a1585d9c892f84fa8d1eea5f13ac00bcf98d4104d15f`,
worker supplement `eafc73232ac1d2d807bde62ad21c8a11473b985c3ad06ee85ce3194d9c7a4841`,
and fresh final critic `b09541da5a384c3b1edf283e6ec25725616e865cfd55eb29bc9f516192ffe532`.
The new full original-result replay and supplement exercise the changed
dependency surface without replacing those recordings. All 4,202 historical
untracked paths retain filename-list SHA256
`17fd92fd454a14a44fddc4db0beadc4246a92f4ff749e57a8e2762aca638f8ac`.

This submission claims only private proved-raw UIF liveness after complete
validation. No new dynamic numeric/bank/geometry authority, public capability,
guest execution, live offload, FPS or MIPS improvement follows. No web/demo
surface or production negotiation was enabled, and no deployment is claimed.

### 2026-10-05 — fresh adversarial verifier — VERDICT: verified

VERDICT: verified

- P1 custody — HELD. Predicted the actual indexed original archive would authenticate at the submitted frozen source. Authenticated all 146 regular, unique, safe members, every size/digest and receipt binding; source8e6 and submitted126f runtime/harness bytes agree. `custody.json` and `reexport.json` bind both actual retained sanitizer executables and their actual original profiles; raw-to-profdata remerges and full LLVM reexports match. No rebuilt binary was paired with an earlier profile.
- P2 raw predicates — HELD. Predicted post-swizzle raw zero=false, proved one=true, unknown/contradictory/numeric-shadow facts=unknown. Original hot/cold `native/native.log:1` records all eight handwritten states; the native source fixtures exercise both zero ADD identities in four host rounding modes. Independent `attacks-complete/report.json` cases0–111 and explicit-raw-truth cases132–134 check both new seeds, overwritten/disjoint masks, arbitrary proved bits, negative-zero and two nonzero NaN encodings, with complete native/Wasm equality and zero sanitizer stderr.
- P3 joins, dead parents and publication — HELD. Predicted no dead address/output/data facts or discard side effects; every live predecessor still contributes its masks. Independent cases112–116 check aliased simultaneous masked swizzles, a terminating discard survivor, nonterminal negative-zero discard and invalid dead destination syntax. Remaining independently authored join/output/address cases reject missing live authority and conflicting joins, while common-one and valid initialized indirect cases pass. `attacks-complete/predictions.json` precedes execution and contains every literal/prediction.
- P4 full original grammar/certificates — HELD. Predicted malformed dead opcodes, declarations, modifiers, targets, tails and unrecognized/corrupted loops reject; exact valid 16/768/512/49152/511 depth/instruction/line/source/register boundaries pass and their first out-of-range counterparts reject. Independent complete-labelled and complete-bound cases hold, including case157 `dead-malformed-loop-frame`, which exercises original syntax rejection at bridge.c:807. Original full bodies remain unchanged and rejected at worker native cases230/231: c5806d5f… 14,786 bytes and 92cb866a… 39,261 bytes, with entire original single/pair results bound by `result-audit.json`.
- P5 strict owned consumers — HELD. Predicted v41 permits only its exact own-data contract with a descending v1–v40 base, and retains every inherited policy. Independently checked original 627 rejected metadata attacks/getters=0, then ran 25 new strict value/accessor/base attacks/getters=0. Removing inherited raster obligations rejects. Actual hardware owned sync/async safe banks are copied/restored; finite unsafe F2I words stay on CPU and never upload; nonfinite wire updates reject with zero commands and unchanged snapshots. `capture-audit.json` cites each original `acceptance.consumers[i]` point and raw packet/readback.
- P6 priority and lineage — HELD. Predicted whole previous successful results win exactly and every new admission belongs to the closed v41 extension inventory. `result-audit.json` reconstructs 10,464 historical complete-result bindings from actual authenticated predecessor archive members, verifies all 253 new native/Wasm C single/pair/facade results and original native stdout points, 2,683 pair hashes and exactly 177 closed extensions. Old discard/coordinate priority cases130/131 and complete radial-loop old/composed cases126–129 independently hold. Four unchanged inherited arithmetic supplement singles/pairs also equal actual preceding results on hot/cold native/Wasm recordings. Carry unchanged HELD proofs from worker e211633f…, supplement eafc7323… and final critic b09541da…; affected bridge/emitter/policy dependencies have new complete-result and coverage proof.
- P7 physical recording — HELD. Predicted literal selected raw carriers and RGBA bytes on actual headed Chrome/Apple M4 Max ANGLE Metal. Independently reconstructed all six hot/cold seeded recordings: each has 480 words, 1,968 pixels, empty browser errors, actual submitted source/reflection/system blocks and all 1,127 created GL objects deleted. Viewed the authenticated original screenshot. `capture-audit.json` recomputes original little-endian bytes/SHA256 and numeric conversions from input literals. Actual submitted word/control faults produce exactly1/11 contradictions at `acceptance.vertices[0].vectors[0]`; their raw bytes and mutated source are retained in the immutable worker archive.
- P8 sufficiency — HELD after narrow independent closure. `coverage-audit.json` holds all82 diff hunks, 123 changed native lines and 105 conditional branch sites against actual original hot/cold LLVM, Node and browser recordings, plus the retained original binary's new independent profile. It evaluates conditional child regions separately. Initially unexecuted v16 selection at `stage_result1694:62–89` now hits16; unknown raster false arm at `raster_graph587:24–44` hits4; v39/v38 suffix child regions hit4 each; malformed loop-frame return at807:128–140 hits12. Other reachable new regions execute. Enumerated waivers only cover static signatures/flags/layout and proved CONST-mask, certified BRK/ENDLOOP semantic and first-success retry invariants; each exact zero alternative has its proof in the report. Touched arithmetic helper migration is independently authenticated: same four literal cases, five exact positive native regions and two exact positive original V8 regions from unique source anchors. No worker line-site list was accepted as a substitute for subregion inspection.
- P9 mocks/environment/storage — HELD. Predicted no ignored/debug-disabled shortcut, fake GPU, hidden observed-bank oracle or inherited Rust/Cargo configuration dependency. Original sources/fixture bytes and independent integer/byte calculations support the result. Inspected the authenticated pristine clone at source8e6: exact detached head, empty before/after tracked/untracked status, scrubber removes Rust/Cargo and relevant compiler/Node/GPU overrides, exit0 for the complete acceptance command. `cold/cold.log:1,3,102,106,109,144,146,148,185–188` records the actual gates; its digest is2c51f43c6ea9aeadcfd911fe7412a4154e04a46fb36debd21a66657723da7495. Original LAYOUT [111744,112,32448] holds on hot/cold and independent runs. No new runtime or portability finding requires repeating that proof.
- P10 independent suite/sabotage — HELD. Promoted `tools/virgl-known-branches/critic.mjs`: 174 complete native/Wasm singles/pairs, seeds0xa4093822/0x299f31d0, 25 strict owned-policy attacks, novel aliased masked producer and discard-join regressions, complete original bounds/certificates and profile-composition regressions. The optional scratch-module sabotage removes only the strict branch-condition value comparison. Running the exact promoted source then fails with `forged branch policy condition: true !== false`; `sabotage/complete/report.json` and stderr cite the assertion and actual passed native/Wasm cases preceding it. The initial critic typo used undeclared fragment IN[0] in a full inherited fixture; its correctly rejected run is preserved at `attacks-malformed-declaration/`, then only the independent fixture was corrected to the declared IN[1]. Implementation code was never edited.

SUITE: keep the independent regression runner and complete literal predictions/profiles; retain old worker/HELD seals unchanged. Commands: `node --check tools/virgl-known-branches/critic.mjs`; `node tools/virgl-known-branches/critic.mjs target/evidence/virgl-known-branches-critic/original target/evidence/virgl-known-branches-critic/attacks-complete`; original-binary `xcrun llvm-profdata merge -sparse` / `llvm-cov export`; independent archive, result, capture and granular coverage auditors. No new cold/GPU runs were performed. All4,202 historical untracked paths retain the exact NUL filename-list SHA25617fd92fd454a14a44fddc4db0beadc4246a92f4ff749e57a8e2762aca638f8ac.

This verdict proves only the private compiler branch-liveness boundary. The larger literal-program, public capability, guest GPU execution, deployment and performance requirements remain gated.

Independent critic seal: `evidence/virgl-known-branches/verifier/`, 74 actual authenticated
archive members, 4,041,486 bytes. Original worker and predecessor
evidence remain unchanged.

- Manifest SHA256 `a22609d4eac861edf0741af38399e6ed7fad95895e1b0dd4eae8648c44357d62`.
- Archive SHA256 `7015633108939a747138fdfe549982106c95164fa915874b554f802b6470ce08`.
- Index SHA256 `616e971e6b0f3758f57a72eb247feeae53849a508cd3cf97d1b0affb28d12e31`.
- Verdict SHA256 `ff972f4c075f145e203d367beaf2f78f7e76fb8970a5292528738ac6a9b6c0de` (`verdict.md` inside the seal).

Narrow promoted-harness syntax/regression gates passed; `python3
tools/check_task_policy.py` passed with active=none, then `python3
tools/build_queue.py` regenerated 603 tasks / 410 verified. `git diff --check`
passed. Verifier writes are limited to this verdict/status, queue, independent
critic seal and promoted regression runner/documentation; no implementation,
old evidence, deployment, PR or stack mutation was made.
