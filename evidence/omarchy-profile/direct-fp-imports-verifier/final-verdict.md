VERDICT: verified

Applies only to E5.5-T03ao, the direct pure FP import boundary and its measured
finite workload. Desktop responsiveness is still unsolved. The actual physical
trial failed and T03q must remain gated.

## Exact subject

- Worker submission: `7d648143e92b7fe861fa4ae7b1f34c0a84451f39`.
- Runtime/harness freeze: `8c302e1d6cd084ba1034cfd58c7efb9677dc3e46`.
- Artifact, sole cold clone and sole physical trial:
  `a3beb0e8dc5da21374a6d59e25658f5db5ce79da`.
- Shipped and reproduced WASM:
  `36b4f1ccf9e1437f687eae552aca3290fab7c555dfd7fa9fac6cc3862d87a916`.
- Worker seal: 89 files, index
  `e9160dbff703ac19aa5d4fb591fa1cc4651738916f04c0535905b189e53c2bbf`.
  Every entry was rehashed and compared with the submission commit.

Evidence paths below are relative to `evidence/omarchy-profile/`; unprefixed
inspection files are in `direct-fp-imports-verifier/`. Predictions were recorded
before worker evidence in `predictions.md` (SHA `904a3ecf19e907b3090fb92cb5d627113481f2507df90361787ca591cf8b21dd`)
and `benchmark-predictions.md` (SHA `4140a7aca9d80a52369757997206a929def94d01116dbef5d2e0f65339e373c6`).

## Predictions and findings

- **P1 — HELD, scoped diff.** Predicted only five pure exports/import bindings
  would replace FP Closure bodies and owners. The production diff is confined
  to `crates/wasm/src/jit_browser.rs:63` and its constructor binding at line
  1221. Core helpers, softfloat, translator, native runtime, memory/atomic
  closures, cache and scheduling retain their bytes/behavior. `carry-inspection.json`
  checks the whole unchanged tracked boundary and 19 named files; `frozen-inspection.json`
  and `submission-inspection.json` bind all 52 source/harness and six artifact
  files. No scope rework required.
- **P2 — HELD, actual identity/types.** Every captured generated-module import
  is strictly identical to the corresponding owning main-instance raw export.
  Six actual modules per private/shared mode import all five families. All five
  correct scalar types link; all 22 individual parameter/result type mutations
  per mode fail `WebAssembly.LinkError`. Actual optimized release exports are
  locally defined and independently parsed. Points: `direct-fp-imports-r1/acceptance.log:61`
  and `:64`, `exports-preflight.json`, `production-preflight.json`,
  `suites-frozen-inspection.json`; the sole cold log reproduces every critic
  line. No import-identity gap remains.
- **P3 — HELD, independent results/full i64.** The 22 literal answers include
  high i64 bits, signed/unsigned integer conversion, exact cancellation and
  flags. Captured imports pass 132 literal probes per mode with digest
  `f5c775ff0b743b09`; optimized release passes independently without an active
  guest. The predeclared `(2^32+1)` RNE, `(2^63+1)` RUP and fused cancellation
  answers hold. Points: promoted test literal table and the same two raw log
  receipts; `production-preflight.json`. No numerical rework required.
- **P4 — HELD, ownership.** Nine actual compiled mixed-block executions per
  mode span three executors, two simultaneous live guests, invalidation and
  reinstall, originating-executor drop and replacement, then a real 65536-byte
  memory growth. Captured functions remain callable after every guest/executor
  is dropped. Points: `crates/wasm/tests/jit_fp_direct_imports_verifier.rs:319`,
  raw log lines 61/64, `suites-frozen-inspection.json` and cold counterpart.
  No lifetime coverage gap remains.
- **P5 — HELD, carry and rerun.** All 83 AN worker and 59 AN critic sealed
  evidence files rehash correctly; unchanged native/translator/numerical proof
  carries. All five independent FP verifier suites rerun on private/shared
  WASM, with the new identity fixture giving 32 passed, zero failed/ignored.
  Guards, aliases, dynamic rounding, faults, chain budgets and growth remain
  covered. Points: `carry-inspection.json`, `suites-frozen-inspection.json`,
  `suites-cold-inspection.json`; final acceptance log SHA
  `978dc14e620cb93717a9ae9c4798605e237d94c8007c3909abcd92611c38ca03`.
  No repeated unrelated gates were demanded.
- **P6 — HELD, bounded performance.** Independent ELF/opcode/RAM/register
  reconstruction matches every run, SHA
  `c55029e8cbc137ddab4624cc75bfd853a46c1d385f29b173028ac388de31fd94`.
  Both arms warm twice before five alternating pairs; every run retires 500065
  instructions, 499760 compiled. Derived helper occurrences and conservative
  compiled lower bounds prove all five families reach compiled execution:
  at least 49695 calls each for arith/from-int/to-word/div and 199695 FMADD.
  Final medians 24.2200000286 versus 14.2349998951 ms give ratio
  **0.5877374020759919**; cold ratio **0.5949656768504615**. Points:
  `benchmark-frozen-inspection.json:5`, `:41`, `:48`, `:220` and cold counterpart.
  This proves improvement for the stated workload, with no desktop speed claim.
- **P7 — HELD, shipped evidence.** All six affected commands pass. Built and
  sole pristine-clone browser runs pass 127/0 and no errors; independent
  arithmetic reconstruction and real growth hold, and all six suite/capability/
  task images were personally viewed. Cold exact WASM and scrubbed/pristine
  guards hold. Twelve independent public fetches match preview/canonical bytes.
  The two failed large-snapshot downloads remain recorded; recovery's 49 ranges,
  full pinned hash and identical final Pages command were audited. Full CI
  remains **exit 2**, in the same five inherited categories, with native ISA
  128/128 and 58.8 MIPS. Points: `production-inspection.json`,
  `cold-production-inspection.json`, `cold-inspection.json`, `public-inspection.json`,
  `recovery-inspection.json`, `ci-inspection.json:2`, `submission-inspection.json`.
  No green-workspace claim is accepted.
- **P8 — HELD as a preserved negative, desktop gate FAILED.** Actual AJ R2
  pair/cap256/recycling and original deadlines match. Startup is 38108 ms;
  128 trusted events match 256 unique positive keyboard/sync acknowledgments.
  Enter at 09:55:39.631Z, deadline 09:57:39.631Z and failure 09:57:39.632Z;
  all 37 completed independent reads return exit 75, none pending, no nonce.
  Frames 2→3; personally viewed initial/prepared/failure images show no typed
  command and returned prompt. Normal cleanup takes 170 ms, no watchdog or
  forced close. Raw report SHA
  `6ab46d14d2b0b037c59a1c13673609c94590c7432beeb2efbaffedeaa66a75af`,
  points `direct-fp-imports-r1/physical-input/desktop/report.json:31373`,
  `:31378`, `:31380`, `:31451`; `physical-inspection.json`,
  `physical-fidelity.json`, `visual-physical-inspection.json`.
  **Keep T03q gated; further measured work is required.**
- **P9 — HELD, bounded sabotage.** Substituting an equivalent JS trampoline
  only in a copied actual import dictionary preserves the scalar result but
  triggers `CRITIC_DIRECT_FP_IDENTITY fp_from_int_s`. Restoration passes in
  both modes. The wrong-typed trampoline links while a raw function rejects
  that signature, showing why checking numerical equality alone is inadequate.
  Points: promoted test line 137 and raw acceptance lines 61/64. No production
  file was sabotaged; the negative control is a permanent test.

## Geometry correction and diagnostic profile

The original physical wrapper fails an inherited post-run assertion that
requires every damage rectangle to fill the display. This failure is retained.
Unchanged `Resource::flush_rect` at `crates/core/src/dev/virtio/gpu/resources.rs:65`
and the tracking sink at `crates/wasm/src/lib.rs:2336` establish that later
rectangles represent changed pixels. Actual canvas/GPU stay 1280×800, resource
1280×832, final damage (10,36,118,28). My independent offline validator accepts
the two real states and rejects 15 malformed geometry/error controls. It also
parses the remaining raw input-fence/profile/cleanup evidence independently.
The worker separately rejects 16 controls. This closes a proof-harness gap;
it does not turn the failed physical trial into success or require a new run.

The post-verdict profile is separately bound: all eleven non-custom executable
sections and 1912 function names match the release. Independent tree/sample
recount gives 19977 samples, 5211 nodes, 30022968 µs span and 30022150 weighted
µs; all worker self/inclusive totals match. Profile SHA
`24a461f002de9a6a22c22088a6162599546793889f7a5652690b796e0fcf4256`;
`profile-inspection.json:8`, `:77`, `:80`. The 8.743% flush_page self share is
diagnostic and does not locate input loss or establish causality.

## Coverage and suite

`coverage.md` classifies every changed boundary as executed, carried or waived.
No unexecuted AO behavior remains. Lookup failure guards are waived because
the checked artifact provides all five exports and the constructor uses a new
ordinary object. Types/comments/metadata and deleted Closure bodies need no
invented runtime branch proof.

Promote `crates/wasm/tests/jit_fp_direct_imports_verifier.rs` (SHA
`0ac8b08bf56d981e6a0f80cccf54e2032abbfeacfaba1ddb4535f22564a0fa18`)
and keep `make verify-E5_5-T03ao` as the repeatable gate. Independent audit
scripts and all original failures remain sealed. The critic's Xcode-selection,
mstatus-oracle and cold-path checker mistakes are retained and explained;
none required product changes. Root may apply this verdict/status and queue
commit administratively; this critic changed no implementation or task status.
