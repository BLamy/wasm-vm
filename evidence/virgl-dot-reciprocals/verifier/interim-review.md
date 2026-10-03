# Interim adversarial review — final verdict deferred

Predictions were written before inspecting current test outputs in `predictions.md`.
Runtime/library source binding is in `initial-runtime-digests.json` and `builds.json`.
The primary-source review and independent oracle rationales are in
`primary-source-notes.md`. Current evidence digests are in `interim-bindings.json`.

- P1/P4/P9 HELD: 4,032 independent initialization/authority attacks across every
  supported destination mask and24 selector permutations. Each removes one
  initialization or raw-authority lane independently. Acceptance matches exactly
  post-swizzle xyz for DP3 and x for RCP/RSQ, independent of the written lane.
  Citation: `native-audit.json`:10 (sha256
  `6a194c2e92589f5391b68d2124a5915c8ee011b1d99b03f8383a518aef7d4cb6`).
- P2/P3 HELD: 42 independently authored GPU programs,672 vectors and2,688 draws
  passed10,752 exact/fraction/isqrt checks on Apple M4 Max hardware. Added four
  edge programs/176draws/704checks exercise2^-126 and2^126 and nearby binades.
  Written lanes replicate; aliases use pre-write shadows, untouched lanes remain
  exact and simultaneously captured raw carriers agree with numeric words.
  Citation: `current-gpu-check.json`:2–7 and `edges-gpu-check.json`:2–7; raw result
  digests are explicitly recorded there. No cross-stage/exceptions guarantees.
- P5 HELD: current and independently rebuilt parent match all2,083 predecessor
  cases except the two literal DP3 admissions. All162 pair results match current,
  parent and historical full baseline. All19 original full results remain equal,
  including12successes. Citation: `native-audit.json`:50750,52696,52700.
- P6 HELD: source review confirms contemporary scalar source masks/REPL rules and
  the documented pinned RCP shortcut discrepancy; all ten capture operations are
  in PRECISE-bearing originals. Citation: `native-audit.json`:52797 and
  `primary-source-notes.md` with source digests.
- P9 sabotage HELD: isolated compiler snapshot using xy DP3 instead of xyz failed
  1,644 checks; first observed65/16 versus exact445/32. An isolated reciprocal
  multiplication/sqrt mutation failed3,292 checks; first RCP observed31/8 against
  the reciprocal enclosure. Citation: `sabotage-dot-gpu-check.json`:5–17 and
  `sabotage-reciprocal-gpu-check.json`:5–17; complete raw GPU digests at199–200.
- P7/P8/P10 NEEDS FINAL EVIDENCE: prepared `check-compatibility.py` reconstructs
  the predecessor stream independently and attacks eleven receipt mutations.
  Frozen worker exact-head/coverage/browser/compatibility evidence and the final
  pristine-clone run remain to audit. The current runtime findings carry forward
  only if their source/dependency/evidence digests remain unchanged.

No implementation or shared build output was changed. No task status or verdict
commit has been made. These are interim findings, not task verification.
