VERDICT: verified

E5.5-T03be is verified as a **negative investigation**. No runtime optimization or
browser, native-emulator, BusyBox, or Omarchy speedup is retained or established.
The final worker submission is `80384256`; runtime and shared fixtures were frozen
at `26f63873`, with the isolated native JSON formatting repair at `a3afda72`.
Predictions were written before inspecting the recordings in `predictions.md`.

- **P0 provenance/restoration — HELD.** The production prefix of `regs.rs` is
  byte-identical to `ec178d57`; the entire shipped wasm matches both parent and
  original main, SHA-256
  `f8b40d93039a9bb454250df40592e8c1d62144cac600bdcd82ea74098d7bb516`.
  See `audit.json:3` and `publication-audit.json`. Every saved candidate source,
  historical harness, raw report and locally retained native binary matches its
  recorded digest. The worker's 52-file `SHA256SUMS` validates, with manifest digest
  `b0dbe06515c31cac58fa399ff8ba463a684c398458fc2b0439f61985835cb7a1`.
- **P1 exact masks/transport — HELD.** The shared 10,598-mask oracle passed native,
  Node wasm and actual Chrome. Independently recomputing its state in Python gives
  `4dace58378d14297762d010665b9d3bf1ac0fd376e5565ccbe4f122f34e6d1f2`,
  matching `novel-native.log:7`. x0, selected/unselected full-width words, source
  bytes, PC and per-commit stamp assertions all execute. This oracle does not
  derive its expected array by calling the production commit method.
- **P2 high bit/dense/wrap — HELD.** `../sparse-handoff-final/gate.log:15` records
  the new stamp regression: masks 0/1 preserve `u64::MAX`, mask `0x80000003`
  commits x1/x31 and wraps once to zero, then the full mask advances once to one.
  The independent composition fixture additionally exercises every writable
  population, rotated holes including x31, and both x0 settings. The rejected
  candidates' density-branch predictions are not claims about the restored code.
- **P3 bounded guest state — HELD.** Python independently reconstructs all 40
  ADDI/JAL instruction hashes, not merely the worker's summary. Chrome and Node
  produce identical guest-trace and snapshot lines. At 8,614 instructions,
  `novel-wasm.log:46` has x31-loop trace `31d16c87c0807df6` and snapshot
  `a9592b0d6965395a1ddfe4a2b9ac02ff59922ebe055baee311330379f8a373b5`;
  the independent state is x31=4,275 and PC=`0x80000000`. The sparse loop at
  line 57 has trace `7d9a352100bbf53f`, snapshot
  `ff070ca8295248d71fbae53c92744c8b5984a33224c5a8b0456ae2878293122d`,
  x1=2,152/x7=2,146/x31=2,121 and PC=`0x80000008`. Empty and full loops also
  match the prewritten predictions. Actual compiled block counts are 69/69/68/67.
  This timer-free fixture makes no new clock claim; production benchmark records
  independently compare CPU, RAM, CLINT and clock state with a timer enabled.
- **P4 fault prefixes — HELD.** Actual Chrome passes
  `bulk_handoff_preserves_all_registers_and_virtual_pc_on_precise_fault` at
  `chrome-jit_browser_parity.txt:12`: the assertion point requires load fault
  tval=`0x50000000`, next PC=`0x40001078`, unchanged caller PC, x1..x29=seed+1,
  x30=`0x50000000`, and uncommitted x31. The same/cross-module FP fault-prefix
  assertions also pass at `../sparse-handoff-final/gate.log:132` and `:135`.
  Actual Chrome totals 41 passes, one pre-existing ignored long churn test, and
  zero page errors (`chrome-fixtures.json`); no new ignore or disabled assertion
  was introduced.
- **P5 performance eligibility — FAILED for retained optimization; HELD for
  rejection.** Independent raw-pair medians reproduce every selection row.
  Sparse ratios are 1.0104538, 1.0088355, 1.0112875, 1.0157738, 1.0042680,
  then 1.0200539 in the inlining screen and 1.0138260 in its identical-source,
  identical-wasm repeat (`audit.json:1079`, `:1326`). The repeat misses the
  unchanged >1.02 gate; earlier near-dense/mixed regressions also disqualify
  candidates. Historical BusyBox paired boot/shell ratios are 0.9965143/1.0257801
  with JIT and 0.9922597/0.9867528 without JIT. They describe the rejected bulk-copy
  candidate only. The restored identical-artifact control is correctness evidence
  and correctly rejects speedup eligibility; its concurrent timings are not used.
- **P6 gates/isolation/publication — HELD.** `receipt-audit.json` independently
  counts 50 focused, 1,098 core and 34 native-JIT passes. The recorded clean-clone
  acceptance succeeds at `26f63873`; its current detached `a3afda72` checkout is
  still clean after the narrow formatting/producer build and exact-u64 check.
  The final producer and clone each preserve all 256 expected register words as
  hex strings. Existing macOS wvseccomp build and GPU stdout-lint failures were
  reproduced on untouched main; no full `make ci` pass is claimed. Curl independently
  refetched all six immutable/production wasm, roadmap and task files and matched
  committed bytes. `demo-live/demo-suite.json` records the immutable live suite
  at **127 passed / 0 failed**, with zero relevant console/HTTP errors and the
  negative-result task visible. Screenshot SHA-256:
  `e5aac704b5cfcc8c3936a58ebb5d2b1e3b90ab5548d4af188f547cbbbde98c03`.
- **P8 novel attack/sabotage — HELD.** The promoted disjoint-mask composition
  attack covers 5,952 cases under three independent xorshift seeds, every rotated
  density, poisoned x0, and repeated identical-value commits. Python independently
  reproduces digest
  `091a8d5c6853b91d309bae75e9c8b6f7a88b6291f5fd9771e48127942f567d64`
  from `novel-native.log:9`. The control scratch module passes. Dropping bit31 in
  a scratch copy makes the task's new regression fail with x31=0 instead of
  `18446744073709551615` (`sabotage-drop-bit31.log:7-10`, exit 101).
  `sabotage.json` proves production bytes were unchanged before/after; no runtime
  implementation was edited by this verifier.

## P7 — final diff coverage

| Changed hunk | Classification and evidence |
|---|---|
| `crates/core/src/hart/regs.rs` | Executed: the only net hunk is the new `cfg(test)` stamp regression, including wrap, empty/x0 and full masks. No production hunk survives. |
| `crates/core/tests/jit_sparse_handoff.rs` | Executed: both tests pass native and wasm/Chrome; independent Python digests and the composition attack interrogate the expectations. Imports/attributes/comments are waived as test metadata. |
| `crates/wasm/tests/jit_sparse_handoff.rs` | Executed: both interpreter/JIT setup arms, every loop shape and all ten budgets; snapshots, register assertions, trace counts and compiled counts are recorded in Node and actual Chrome. |
| `crates/core/examples/jit_handoff_probe.rs` | Executed: empty/x0/sparse/high/dense cases run; final hex mapping is checked for 256 exact words locally and in the clean clone. Command-line unwrap failures are waived as fixture-input preconditions, outside the claim. |
| `tools/verify/jit-sparse-handoff-benchmark.mjs` | Executed: historical matching harnesses and final repeat/control cover compile, warmups, alternating pairs, state/oracle checks, measurements, summaries, eligible/ineligible gates and cleanup. Invalid-path/IO failure exits in the localhost fixture server are waived: transport guards do not change emulator behavior and no general server reliability/security claim is made. |
| `Makefile` | Executed: the acceptance target passes in the worker checkout and clean clone, including the promoted test through the shared fixture. |
| Docs, task/queue, roadmap/task inventory/service-worker metadata | Waived as declarative/reporting changes. Negative wording was read and displayed in the built/live page; served bytes were independently checked. |
| Saved rejected sources and report archive | Waived as inert evidence, never compiled into the final runtime. Their source/harness/report hashes are audited. |

No final runtime hunk remains unexecuted or unproven. Historical rounded native
JSON values are only previews: their exact Rust assertions and independent array
oracles provide precision; the retained producer now emits lossless hex. The first
historical BusyBox sample in each arm contains the same generic 404 and is not
cited as zero-error demo proof. These qualifications are explicit in the worker
claim and report.

## Permanent suite and commands

Promoted `disjoint_rotated_masks_compose_without_losing_same_value_stamps` in
commit `26f63873`; the existing shared native/wasm acceptance target runs it.
Retain the worker's all-mask, stamp-wrap and bounded-resume tests and benchmark
collector. Retain rejected candidate reports for future investigations, without
turning their results into a performance claim.

Verifier commands: `cargo fmt --all --check`; strict clippy for
`--test jit_sparse_handoff --features trace`; native shared fixture;
`wasm-pack test --node crates/wasm --test jit_sparse_handoff -- --nocapture`;
`python3 .../sabotage.py`; `python3 .../audit.py`;
`node .../chrome-fixtures.mjs`; `python3 .../publication-audit.py`; and one
immutable-deployment load using `tools/verify/e5-t18e-demo-smoke.mjs`.
`SHA256SUMS` seals this verifier's evidence. Large historical native binaries were
hashed on this machine and remain local; the archived audit explicitly reports
whether those bytes are available when rerun. No PR was merged.
