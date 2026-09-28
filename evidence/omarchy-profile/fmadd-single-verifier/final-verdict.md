VERDICT: verified

Scope: **E5.5-T03an FMADD.S correctness and its required recorded trial**.
Desktop responsiveness is **not solved**. T03q remains gated.

Worker submission: `1479a26360eb5ee70144440a25941a8d10ee4493`.
Runtime/harness freeze: `618286f3b1431990bbeddb9ef40d894b67be0605`.
Published/cold/physical head: `c531ceffb9b7adc8de9f5ebc927d00076a26f1dd`.
WASM: `0f9b1213fa160f31d4f35503f6b35b4caf7193668eac3c369ac4a75611b6fced`.

## Predictions

- **P1–P3 HELD — single rounding, special values and boundary flags.** An
  independent Fraction oracle fixes 175 triples / 875 mode results. Final
  native/private/shared paths each pass 12,250 literal/sticky publications,
  including fused cancellation `a8800000/00`, zero×infinity+qNaN `7fc00000/10`,
  signed zero, tininess-to-normal and directed finite overflow. Wide-gap
  `2^128 ± minsubnormal` and normal-from-above cases attack the status repair.
  Worker `acceptance.log:42,85,105`; `oracle-review.md`, `goldens.json`.
  The original 24 worker flag failures remain preserved; no result-bit mismatch
  was concealed by interpreter/JIT agreement.
- **P4–P5 HELD — aliases, publication and precise purity.** 6,144 independent
  seeded states cover all source/destination equality partitions, f0/f31,
  boxes/modes/FS. 20,480 instrumented states observe exactly 10,800 legal
  helper calls and zero illegal calls, exact arguments/masks/full state bytes,
  original parcel/virtual PC and completed prefixes. Worker
  `acceptance.log:40,46,48`; committed verifier support/native tests.
- **P6 HELD — optional indices/admission.** All 16 prior-helper subsets and
  a real five-helper chain pass, including actual parsed call/export indices;
  all 15 unrelated family guards remain rejecting (`acceptance.log:44`).
- **P7 HELD — browser boundaries.** Same/cross-module successors enforce
  budgets and later memory faults. Real memory grows by 65,536 bytes inside
  an MMIO callback between FMADDs in private/shared paths, including both fault
  positions (`acceptance.log:80-120`). Final clean clone reproduces all 33
  critic receipts exactly (`cold-inspection.json`).
- **P8 HELD — independent attack and sabotage.** Generated-module call/state
  instrumentation is independent of the worker harness. In an isolated copy,
  changing only the cancellation expectation to zero fails at
  `sabotage-mutant.log:19-31` (exit 101); restored assertion passes at
  `sabotage-restored.log:18` (exit 0). The final fixture adds two literals;
  frozen audit proves the sabotaged first literal/assertion unchanged.
- **P9 HELD — frozen source, coverage and reproduction.** All 83 worker
  evidence files rehash and equal committed bytes; all 54 frozen source/harness
  files and six artifacts remain equal. AM's 70 sealed files and unchanged
  recorder boundary carry forward. The actual renderer-page audit independently
  decodes 24 FMADD.S parcels and checks page pins/walk witness without claiming
  per-PC dynamic attribution. Production and cold browser ELF/register/RAM
  reconstruction agree: RAM SHA `3510fa25cda976048c595e95ae16fabadebe668f0170d9615ac68c103430003e`,
  4,570/5,000 JIT retirements, actual growth, 127/0 suite, zero errors. All six
  browser images were personally viewed; twelve independent public downloads
  match. See `coverage.md`, `submission-inspection.json`, `frozen-inspection.json`,
  `page-inspection.json`, `production-inspection.json`, `cold-production-inspection.json`,
  `public-inspection.json`. Broad CI remains **exit 2** in the five carried,
  byte-unchanged AL categories (`ci-inspection.json`), not a green workspace claim.
- **P10 HELD — faithful negative physical result.** The unchanged AJ R2 pair,
  cap256/recycling ON, geometry and deadlines bind to AM. Independently parsed
  wire evidence shows 128 trusted events, 256 acknowledged keyboard/sync calls,
  eleven completed exit-75 reads and no nonce; frames remain 2→2. Enter
  `08:42:17.860Z`, deadline `08:44:17.860Z`, failure `08:44:17.862Z`.
  Raw report SHA `31b9e015b5f16c70cff14342357c77704e371294bec9a050c52f2e2139ae8fea`,
  `physical-input/desktop/report.json:23810-23830`. I personally viewed the
  baseline/prepared/failure images: all show only the initial Foot prompt and
  are byte-identical (`visual-inspection.json`). No responsiveness promotion.

## Qualifications, coverage and permanent proof

The browser-server close exceeded its internal 10s deadline. The existing owned
kill fallback succeeded; total cleanup was 10,138ms within the unchanged 30s
budget, with client closed and no parent watchdog. The initially carried parser
assumed graceful exit; its rejected log and source-justified correction are
retained (`physical-parser-adaptation.json`). The failure verdict predates the
30,012.977ms diagnostic profile. All 11 executable sections and 1,915 names bind;
the independent recount matches all 19,792 samples and worker aggregates. There
is no post-verdict guest input and no speedup claim.

`coverage.md` maps every changed boundary to executed proof or a narrow type,
declaration or unchanged-path waiver. No semantic hunk remains unproven or dead.
Promoted proof lives in `tests/support/jit_fp_fmadd_verifier.rs`,
`crates/jit-runtime/tests/fp_fmadd_verifier.rs` and
`crates/wasm/tests/jit_fp_fmadd_verifier.rs`, exercised by the committed
`make verify-E5_5-T03an` target. No second guest trial, cold clone, or full CI was
run by the critic; no implementation, task status or GitHub state was changed.

No scoped refutation or evidence gap remains. The next responsiveness experiment
requires its own bounded task and fresh evidence; this verdict does not prove it.
