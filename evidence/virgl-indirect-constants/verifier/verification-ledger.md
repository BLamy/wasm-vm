# E6-T12e8 independent verifier ledger

VERDICT: verified

Frozen source: `b4ee940d78f651553c2b900be95f8b083085cdf9`.
Predictions were written in `predictions.md` before inspecting any E8 run evidence.
The verifier did not implement this task or edit product/worker harness code.

## Prediction outcomes

- **P1/P2/P3 HELD — unsigned bounds, UARL and predecessors.** Independently authored
  public-C-API matrix:9088 cases;3265 admitted with exact complete index sets and
  5823 rejected. It enumerates all64x64 six-bit AND/OR masks per stage, plus768
  random predecessor joins (seeds0xBE19E8/0xBE19E9), literal/swizzled UINT32
  boundaries, declaration holes, nested/one-sided joins, wrong banks/address
  syntax and stale addresses. Exact transcripts are compressed JSONL, one case
  per line, with SHA256s in `independent-case-bindings.json`. For example line4097
  has a possible address53 and correctly rejects. The private-source join
  sabotage admits that case and yields544 counterexamples total. The actual
  current compiler source hashes equal the frozen Git blobs; see
  `independent-source-bindings.json`. The first two verifier test mistakes were
  corrected as documented in `receipt-findings.md`; neither was a product finding.
- **P4/P5 HELD — closed contract and complete bank.** Independent consumer audit
  passed3603 typed metadata/prefix/finite/ownership cases (seed0xA869D7E1), covering
  every declared count1..47, each missing complete register, all184 poisoned lanes
  and both raw/finite policies. Frozen worker consumer recording independently
  reconstructs206 schema cases,290 bank cases and3 ownership cases. Current
  `constant-domain.mjs` and `state.mjs` are directly source-bound and covered.
- **P6 HELD — immutable actual draws.** The frozen hardware record contains both
  stage short-bank rejections with no sync GL events, preserved whole renderer
  state and unchanged pixels; decoder-bypass proof reaches the consumer and
  rejects poisoned unselected/suffix lanes. Both asynchronous schedules
  (0x7c1209ad and0xea016f35) expose waiting-index, reject concurrent begin/restore/
  destroy as busy and restore externally poisoned GPU uniforms from validated
  owned words. Completion-only fences during rejected async jobs are explicitly
  distinguished from draw allocation/upload/read/dispatch. The two schedules
  record60 fences and90 withheld polls together.
- **P7 HELD — real hardware and retained outcomes.** `worker/hardware/report.json`
  SHA256 `e841e61df5b8c7e303f5ff3a933447298042f6f625061a59461a13897b1d9c18`:
  Apple M4 Max ANGLE/Metal, headed hardware mode, zero console/page/request errors,
  31 draws,1216 words,126976 pixels. First/interior/last are distinct in both raw
  stage atlases: first0 starts1015021568, interior23-reverse starts1029177344,
  last45 starts1060634624. Entire independently reconstructed atlas words and
  pixels match. The actual index-offset compiler fault produces48 word mismatches
  (orientation intact); it does not dispatch the invalid-address-bound fault.
  All3466 historical complete cases/236 pairs and12/19 captured originals retain
  exact full results; all7 PRECISE originals reject. The whole successor receipt
  was independently rerun and passed (`independent-aggregate.json`).
- **P8 HELD — fixed budgets, recovery, parity.** `worker/native/native.log` SHA256
  `0f54d1b8de22c89579998e1b3355c1db2350e008c8163af4d9275e00d90122b9`:
  line1 actual layout, line4117 actual flow arena, line4118 derived totals.
  603728 native calls,3814 cases/252 pairs,4096 seeded mutations,4579 truncations,
  324 hostile calls,26 allocation faults,308136 standalone and282458 pair
  recoveries. Raw IR26256, profile7616, arena52612 remain below their bounds.
  Wasm records21165 calls,3814/252 full-result parity,33 pressure phases and stable
  16777216-byte memory. Native evidence landmarks: first0 vertex line3739,
  interior23 fragment3926, last45 fragment3948, one-past rejection3856, unwritten
  address3862, one-sided fragment4027, numeric indirect ADD3841.
- **P9 HELD — warm and pristine proof.** Four independent final clean controls
  (native/Wasm/profiles/consumer) pass;13 deliberately corrupted copied records
  reject, including float maxima/counters, bool counters/metadata, omitted source
  and changed result types. Three browser-specific corrupted observations also
  reject (draw count float, access slot bool, observed word bool), after a clean
  actual-GPU proof control. See `final-receipt-attacks.json` and
  `browser-receipt-attacks.json`. Three pre-freeze proof-schema gaps were found,
  reproduced, fixed by the workers and independently retested against the final
  frozen proof. No runtime semantics were changed to resolve them.
- **P10 HELD — changed runtime coverage.** `coverage-audit.json` maps all178 added
  lines in the five runtime/type files:160 recorded executed,18 narrowly waived,
  zero unexplained gaps. Waivers are header enum/type/layout assertions,
  comments/blank lines, two C struct fields and the exhaustive RAW_UARL switch
  arm unreachable after the dedicated handler returns. LLVM actual counters and
  browser/Node innermost V8 ranges cover both changed consumers. Defensive
  impossible subconditions (contradictory known bits/empty candidate set after a
  consistent bounded cube) are invariants, not unexecuted additional behavior.

## Final pristine proof

`cold-audit.json` checks all152 copied acceptance files and379 frozen-source
bindings. The pristine checkout starts and finishes clean at the frozen source
head with build-affecting environment variables scrubbed. All4085 complete native
case/pair entries, exact native statistics/layout, Wasm counts and every hardware
pixel byte match the warm proof. Cold receipt SHA256:
`b8aba573e74f650d1737c4fabc15ffa10922615348bc451c95be71b2bfd96946`.
The aggregate is independently re-evaluated inside the preserved clone so its
absolute artifact paths are interpreted in their recording checkout.

The independent cold aggregate passed in its preserved checkout. The worker
claim and both recordings landed in `c4e7683c989c5fab3adb1b492d47071d9fbaeb53`
without runtime/harness changes from the frozen source. All ten predictions
hold; no semantic refutation or unresolved sufficiency finding remains.

## Permanent artifacts

Retain the native independent attack generator, consumer attack, receipt
corruption runner and coverage mapper with their compact reports/transcripts.
Their independently authored cases, private-source join sabotage and exact JSON
counter/metadata attacks add proof value beyond a producer's summary. Retain the
new deterministic `make verify-E6-T12e8` target and source-bound worker oracles.
Compiled private dylibs, dSYM trees, private source copies and mutated receipt
scratch directories are reproducible scratch; do not commit them.
