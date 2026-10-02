VERDICT: verified

Reviewed submission `35448100affd89128c1579662851265f076b1dac` against parent
`a6ae84fd1c71c76ecadcff9000c40ed6319ef4b5`. Runtime remains byte-identical to
frozen `9123bc06`; later changes are tests, acceptance/demo tooling, metadata and
recordings. Predictions were recorded before evidence inspection in
`evidence/mips-integer-replay/verifier/predictions.md` (SHA256
`a33e9824d9124d396f6a83e8de66449798cb2b3f08fc3dca11568203105e1e7f`). The earlier
HELD results carry forward because their code, dependencies and digests are
unchanged. All evidence paths below are relative to `evidence/mips-integer-replay/`.

- **P1–P3 — HELD.** All 43 specialized variants preserve the parent semantics and
  match the deferred allow-list. Literal expected values independently check all
  opcodes, division zero/overflow paths, high products, W sign extension, masked
  shifts and comparisons, with a value-observable deferred target in both capture
  modes. The independently rerun five-test fixture passed (`verifier/unsabotaged.log`).
  `guest/integer-boundaries.trace:1,29,36,43,85` shows zero division, MIN/-1,
  zero remainder, W zero division and high product outcomes; trace SHA256
  `351c42e4d7a7f8bd3c31a28e2ae07821d1034396ab4551aa22459bc314f07ae5`.
  Opcode trace SHA256 is `92edf427357e284f1d747473ace567557fffc68544f84881cdd3382397cb4dce`.
  Saved arithmetic traces are reference-path recordings; optimized-path equality
  is directly asserted by the deterministic fixtures, not misrepresented as a
  separately retained trace of every candidate mode.
- **P4 — HELD.** Compressed lengths, original trace PC/bits, x0 discard and
  wrapping PC are correct. The verifier found and closed the original wrap
  fixture's narrow coverage gap with a prefix that reaches actual deferred
  writeback. `verifier/guest/integer-deferred-wrap.trace:5-8,13-16` records full
  and compressed cached retirement to PC=0, with x5=4092 and x5=1 respectively;
  SHA256 `6598d6945c5ea57e928d6042f31bdea0e978736cbe689825f9aa93a90f306e9c`.
- **P5–P7 — HELD.** Serialized hart/RAM comparisons preserve FP/CSR/reservation
  state; full/split/zero-budget and traced/unit modes agree. Integer-prefix traps
  retire only their prefix, and patched cached code is observed on resume
  (`guest/integer-invalidation.trace:2,4`, x4=10 then 11; SHA256
  `4b7e6c14394e1cc95a3f762185304469b3b8ca874c60fd7ad842b1f8b78690cb`).
  Existing affected recordings cover accounting/replay, precise exceptions,
  FS-Off fallback, capture and guest self-modifying aliases
  (`gates/affected-native-tests.log:493,495,1062,1177,1277,1426`).
- **P8 — HELD.** Independent raw-record recomputation checks alternating order,
  equal micro work/state/clocks and actual artifacts. Two five-pair batches give
  cached native ratios 1.204010x/1.201703x and browser ratios
  1.095829x/1.099390x. Real workload raw and paired medians remain within the
  5% time-regression bound. Legacy native boot is **2.393% slower** and median
  browser JIT shell **1.584% slower**; native uncached micro and browser JIT
  controls do not establish a gain. See `verifier/final-audit.json` and
  `verifier/performance-review.md`. No desktop-latency claim is inferred.
- **P9 — HELD.** Independently recomputed 12 guest artifact hashes, six
  trace-FNV/state groups and all six parent/candidate fixed-RTC oracle pairs
  (`verifier/artifact-audit.json`). Four oracle modes trace actual retirements;
  two JIT modes prove counter/state equality only. The scrubbed pristine clone
  passed its frozen acceptance command and produced identical guest artifacts
  (`cold-clone/receipt.json`). Subsequent promoted tests passed in the separate
  verifier checkout and the final acceptance; runtime/dependency hashes did not
  change. All submission-binding hashes match the submitted source/build.
- **P10 — HELD with recorded pre-existing failures.** Raw logs recount 1,294
  passes, one unchanged stdout-hygiene failure and 16 existing ignored tests.
  Final task acceptance passes seven native and five actual wasm tests. Affected
  strict clippy, formatting and six feature builds pass. `make ci` was attempted
  and stops on Linux-only wvseccomp under macOS; determinism-hazards finds
  unchanged GPU test timing. All five implicated files were independently
  compared byte-for-byte to the parent. The full gauntlet is **not** reported as
  passing (`gates/diagnostics.json`, `verifier/final-audit.json`).
- **P11 — HELD.** Deployment `32d61ee9` succeeded. The verifier independently
  fetched production wasm, roadmap and task inventory; all bytes match committed
  dist and the worker receipt (`verifier/publication-audit.json`). Live wasm
  SHA256 is `70de75fd1a2cfb6b51893773a394c0276189a1e54fe9a57dca1fbc47dea1f873`.
  The live recording has 127/127 ISA passes, 67/67 integer+M capability passes,
  zero unexpected errors, and an explicitly URL-attributed favicon 404
  (`demo-live-worker/demo-suite.json`). Screenshot inspected and SHA256 checked:
  `b5aeed8adddebe256e90a1bb0433f0f7efa7071a85eb88f5717e502661a76990`.
  The pre-verdict capture still displays the earlier task status; the coordinator
  will publish this verdict's metadata next. The capability itself is live.
- **NOVEL ATTACK — HELD.** A physically cached AUIPC block reused through two
  virtual aliases, overlapping source/destination arithmetic and eight mixed
  capture/resume schedules preserves literal intermediate results, all prefix
  states and counters. `verifier/guest/integer-virtual-alias.trace:1-9,12,18,25,27,32,36`
  records the same final state SHA256
  `37200e0f3f6333c5b903cc9d2488a7f4027313baf173efd0a417a3c58e456cf7`;
  trace SHA256 `eca4d9ba3aa696b36bdc3017f0d1502cd32a09241b8f0791886fa06bcb98fbd4`.
- **SABOTAGE — HELD.** Isolated DIVUW zero-extension made the new literal test
  fail: observed 4294967295, expected 18446744073709551615
  (`verifier/divuw-sabotage.log:7-10`, exit 101). The mutation was restored exactly
  and never touched the worker checkout; receipt and patch retained.
- **COVERAGE/SUITE.** Every changed runtime hunk is executed by the recorded
  deterministic fixtures or existing affected suites. The exhaustive unreachable
  integer match is waived as a structural assertion after the identical helper
  allow-list; declarations/comments/metadata are non-executable. The demo-tool
  capability assertion executed in both local and live captures. Full hunk
  dispositions are in `verifier/correctness-review.md`. Promoted
  `crates/core/tests/integer_replay_alias.rs` and the shared 43-opcode fixture are
  permanent regression tests; `make verify-E5.5-T03bf` includes both native files
  and actual wasm coverage. No semantic refutation or remaining evidence gap.

Verifier commands: independent frozen-clone native fixture/alias tests and strict
clippy (exact commands in `verifier/{novel,sabotage}-receipt.json`),
`python3 evidence/mips-integer-replay/verifier/audit-final.py`, independent SHA/FNV
recomputation, three production artifact fetches (exact arrays in
`verifier/publication-audit.json`), `python3 tools/check_task_policy.py`, then
`python3 tools/build_queue.py`. No runtime changes, merges, or CI actions.
