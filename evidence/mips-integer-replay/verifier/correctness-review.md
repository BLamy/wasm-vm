# Correctness review of frozen E5.5-T03bf runtime

This is an intermediate review, **not a task verdict**. Timing, final gate receipts,
and publication evidence remain pending. Predictions were fixed in `predictions.md`
(SHA256 `a33e9824d9124d396f6a83e8de66449798cb2b3f08fc3dca11568203105e1e7f`)
before inspecting worker evidence. Runtime reviewed at
`9123bc06cec84f4c581aa877b1126babff245a99` against
`a6ae84fd1c71c76ecadcff9000c40ed6319ef4b5`.

## Predictions already held

- **P1/P2/P3 HELD.** All 43 accepted `integer_result` variants match the existing
  `retire_deferrable` allow-list. The extracted expressions match their parent
  semantics. The fixture uses 43 literal opcode results plus 25 edge cases; every
  target writes nonzero rd3 both at block entry and after an integer prefix, then
  executes an x0 variant and dependent read. All cache/batching combinations,
  capture modes and full/sliced budgets assert literal values and serialized
  architecture. The verifier reran all five new tests independently in the frozen
  scratch checkout (`unsabotaged.log`: successful five-test result).
  `guest/integer-opcodes.trace` has 301 retires, FNV `0x8fda1ff71b29377d`, SHA256
  `92edf427357e284f1d747473ace567557fffc68544f84881cdd3382397cb4dce`;
  `guest/integer-boundaries.trace` has 175 retires, FNV `0x18ec5c9b6882fa8d`, SHA256
  `351c42e4d7a7f8bd3c31a28e2ae07821d1034396ab4551aa22459bc314f07ae5`.
  Division-by-zero is visible at boundary trace lines 1, 8, 15, 22; signed
  MIN/-1 quotient/remainder at lines 29 and 36; W zero/overflow at lines 43-84;
  high products at lines 85-105. Arithmetic traces retained by the worker come
  from the cache-disabled reference; candidate equality is deterministic-test
  evidence (`integer_replay.rs:366-379`), not a claim that those saved records
  were directly produced by deferred execution.
- **P4 HELD, with a promoted coverage extension.** The original wrap test starts
  at the final instruction and calls `run(1)`; it does not exercise deferred PC
  wrapping. The verifier added `integer_replay_alias.rs` independently, including
  a compressed prefix before final-page AUIPC/C.ADDI and one uninterrupted
  two-instruction run. `verifier/guest/integer-deferred-wrap.trace:5-8` records
  cached full-width AUIPC at `0xfffffffffffffffc`, x5=4092, final PC=0;
  lines 13-16 record cached compressed ADDI at `0xfffffffffffffffe`, x5=1,
  final PC=0, both traced and unit-capture variants. SHA256
  `6598d6945c5ea57e928d6042f31bdea0e978736cbe689825f9aa93a90f306e9c`.
  Worker compressed trap trace preserves 2/2/2/4 lengths and excludes EBREAK;
  x0 records have no destination and no integer record has memory metadata.
- **P5/P6/P7 HELD.** `integer_result` only immutably reads the hart; its callers
  write only the integer destination/PC before normal capture/accounting.
  Seeded FP registers, CSRs, reservation and memory participate in the fixture's
  full serialized-state comparisons. Existing frozen affected tests include
  `deferred_retire_accounting_is_unobservable` and `replay_block_tail_is_unobservable`
  (`gates/affected-native-tests.log:493,495`), retirement capture/fault tests
  (lines 1177-1194), FP-disabled traps (line 1277), precise exceptions (line 1062),
  entry invalidation (line 1096) and guest SMC through a writable virtual alias
  (line 1426). Worker invalidation trace lines 2 and 4 show new immediates taking
  effect after an interrupted cached prefix, x4=10 then 11; SHA256
  `4b7e6c14394e1cc95a3f762185304469b3b8ca874c60fd7ad842b1f8b78690cb`.
- **P9 artifact/oracle portion HELD.** The verifier independently recomputed all
  12 guest artifact SHA256s, six canonical-trace FNVs and retired counts, six
  state-list hashes, and all six parent/candidate Linux digest-file equalities.
  Four interpreter-mode oracle cases have real retirement-record fingerprints;
  the two JIT cases are explicitly counter/state-only, as marked by the worker.
  Both runtime source hashes in the earlier diagnostic receipt match the frozen
  head byte for byte. The pristine clone ran fmt and `make verify-E5.5-T03bf`
  successfully on `9123bc06`; all its guest artifacts match. See
  `artifact-audit.json` and `cold-clone/receipt.json`.

## Novel attack and sabotage

The virtual-alias test warms the block at VA `0x10000000`, then reuses the same
physical cache entry at VA `0xffffffc020000000`. It executes AUIPC, rd=rs1=rs2
ADD and SRA, W sign-extension, x0 discard and a dependent read with eight
full/split/mixed-capture schedules. The expected intermediate values are literals.
Each prefix matches uncached serialized state; trace records match the VA-derived
oracle; all schedules retire 14 total instructions, hit the physical cache once,
and produce state SHA256
`37200e0f3f6333c5b903cc9d2488a7f4027313baf173efd0a417a3c58e456cf7`.
See `verifier/guest/integer-virtual-alias.trace:1-9` for the uninterrupted modes
and lines 10-36 for split modes, trace file SHA256
`eca4d9ba3aa696b36bdc3017f0d1502cd32a09241b8f0791886fa06bcb98fbd4`.

In isolated `/tmp/wasm-vm-mips-verifier-9123bc`, DIVUW was deliberately changed
from sign-extension to zero-extension. The new 43-opcode regression failed at
`divuw prefix=0`: observed 4294967295, expected 18446744073709551615
(`divuw-sabotage.log:7-10`, exit 101). This demonstrates the literal oracle catches
a corruption shared by cached and ordinary execution. The mutation never touched
the worker checkout and was restored exactly to source SHA256
`ad30a3bd92fd2f0070eb5e286b9e3645f75e932f5d8f9350fa4e1a40178b3bae`.
See `divuw-sabotage.patch` and `sabotage-receipt.json`.

Both independent tests passed; their format check and strict clippy passed.
`novel-receipt.json` records commands/artifact hashes. The test file is promoted
as `crates/core/tests/integer_replay_alias.rs`; no runtime or worker fixture changed.

## Changed-hunk coverage disposition

| Changed hunk | Disposition |
| --- | --- |
| `hart/mod.rs:1623-1770` shared integer helper, all accepted variants and divide branches | Executed: 43+25 literal fixtures, entry/deferred, traced/unit; None fallback exercised by fault/capture/memory/FP suites. |
| `hart/mod.rs:1793-1797` early ordinary writeback/PC/capture | Executed by cache-disabled and one-op fixtures, full-width/compressed/wrapping cases. |
| `hart/mod.rs:1816-1861` exhaustive unreachable integer alternatives | Waived as defensive exhaustiveness: accepted variants exactly match helper alternatives and return before this match. No independent runtime behavior to exercise. |
| `lib.rs:4177-4190` compact deferred writeback/capture | Executed by all opcode prefix=1 cases in both capture modes, plus promoted actual-wrap and virtual-alias tests. Debug assertions remain enabled during native fixtures. |
| `lib.rs:4192-4202` ordinary fallback after moved branch | Executed by first-op integers, EBREAK and existing memory/CSR/FP/fault/capture suites. |
| Arithmetic fixture and wasm include | Executed native 5/5 and wasm 5/5; six fingerprint groups are identical. |
| New verifier fixture | Executed 2/2 independently, strict clippy and fmt pass. |
| Make recipe | Executed in pristine clone; no environment-dependent generated prerequisite needed for deterministic task acceptance. |
| Documentation, task metadata, roadmap declaration | No emulator execution required; publication proof remains pending. |
| Generated wasm/dist | Artifact identity and browser proof to be finalized with publication evidence. |

No semantic refutation or remaining correctness coverage gap was found. Do not
mark the whole task verified until P8, remaining P9/P10 receipts, and P11 are
resolved by the final performance/gate/publication evidence.
