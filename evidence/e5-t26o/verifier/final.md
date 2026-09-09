VERDICT: verified

Fresh independent verifier of E5-T26o only. Reviewed implemented submission
`b0b37de34c7355faeb3279f147ca58fa0c174236`; runtime/test/gate code is unchanged from final
clone head `aaa8d40625eaf3a2bf9ba6a5dbe4ef0909495ca0`. Predictions were frozen in `plan.md`;
word-derived guest checkpoints preceded raw-log inspection in `guest-source-predictions.md`.
Detailed source/coverage reasoning remains in `provisional-findings.md`.

Below, G means `evidence/e5-t26o/main-gates/07-final-clone.log`, read completely:627 lines,
independently hashed SHA256
`0aa00c3c134abf74209dae64b4f45691eb61c08a6c98fe1ccc36a826f0390597`.
Other evidence paths are relative to `evidence/e5-t26o/`.

- **P0 HELD — scope.** The sole production hunk is `crates/core/src/dev/plic.rs:167`:
  local `pending() & enable[context] & !1u32`, guarded trailing-zero selection and low-bit
  removal. Ascending IDs preserve strict unsigned priority ties/thresholds. EIP still delegates;
  state, restore, gateway, MMIO, counters, polling and timing remain unchanged. Production SHA256
  `9f5def69ccf6e98fb72185a9a2714c00caa5de16fe97c218d5555f93f4dc55f1` matches main and clone.
- **P1 HELD — equivalence.** Independent full-range oracle matches both contexts across12
  explicit and64 seeded states,152 context cases (G:312–315). Empty/disabled, sparse/dense,
  source31, ties, zero/equal/high-bit/MAX priorities and thresholds exercise both loop and
  comparison outcomes. Promoted tie exhaustion returns1,31,0 in each context (G:449).
- **P2 HELD — hostile restore.** Public156-byte restore retains arbitrary accepted behavioral
  bytes, including source0 and full-u32 fields. Bit0-only yields no interrupt; hostile0MAX
  cannot hide eligible31. Exact snapshots, raw readback, all counters and dirty counter reset
  are asserted (worker shared source:208–245,340–365; G:230–233,284,312–315).
- **P3 HELD — gateway/accounting.** Real-bus sequence records27 hits and count31=2 before
  restore, then zero counts (G:284–286); thresholds, invalid/owner completions, held-high
  re-pend and deasserted completion match. Direct EIP is observational. P6 separately verifies
  suppression with both contexts eligible, not merely a threshold-masked second context.
- **P4 HELD — invalid context.** Empty and pending direct context2 calls produce the expected
  caught bounds panics at selector167 (G:277–285). The unchanged array access precedes the
  empty guard. Invalid MMIO context remains zero/no-op with normal hits. No wider invalid-index
  execution or WASM panic-capture claim is made.
- **P5 HELD — guest architecture.** G:287–310 matches the entire independently derived21-record
  trace: MEI enters0x80000100, MEPC0x8000003c, cause0x800000000000000b, MSTATUS0xa00001880,
  retired16. Encoded claim returns31 once; authentic device deassertion precedes completion.
  MRET returns parkedPC/modeM with MSTATUS0xa00000088, x10/x11=31, cycles/retirements21,
  count31=1 and pending31 clear. Source assertions prove these separately from RAM-only digest
  `c055e21cdc4ae3b9a55ddee3919d9bbc6fe2d7340a5830370a4aa3d79f6bc891`. Actual WASM executes
  the same fixture (G:609–617). Existing chained-delivery regression passes (G:529–531);
  its bounded delivery/JIT assertions are not interpreter/JIT counter equality.
- **P6 HELD — independent attack.** Reserved seed0x260f0031 gives128 context claims:69 nonempty,
  59 empty. Reversed both-claimed completion preserves the other bank's authority; wrong-bank
  completion is inert, owner completion reopens31. Final count31=1,139 exact hits (G:448–458).
  All136 recorded P6/P1 lines match the original critic run; promoted native/WASM tests pass
  (G:458,624), with unchanged promoted-file hashes.
- **P7 HELD — sabotage.** Main's single executed scratch mask-removal mutant fails EIP
  false versus independent true (`main-gates/06-mask-sabotage-complete.log:83–95`, SHA256
  `964edaac68021bd2ee95d221818fe5db40c69c2d0fd0401246fea9fe0102b1b9`). Ordered source identifies
  hostile row11; bit0-only is insufficient. Restored scratch/main hashes match
  (`verifier/record-crosscheck.log:1–2`). The earlier incomplete-workspace attempt executed no tests.
- **P8 HELD — submission.** G:1–6,627 proves exact-head clean checkout, no alternates, fresh
  target, scrubbed overrides and exit0. Scoped fmt/clippy/builds and31 native +4 WASM tests
  pass. Demo JSON and viewed PNG show126/0, taskO and no non-favicon console/HTTP errors;
  built WASM SHA256 remains20f58e0d… (no deployment claimed).

Coverage: every executable selector addition is exercised; cfg/import/type/comment scaffolding
is waived as non-executable. No new ignored test or self-derived runtime oracle. Both setup
failures remain recorded; final proof supersedes them. The narrative's stale fixture hash is
corrected. Permanent shared/wrapper tests and `make verify-E5-T26o` retain the proof.

No outstanding demand. Carry unchanged M/N/image/observer/harness boundaries. F remains
unverified; no speedup, F deadline, new boot, merge or deployment is established.
