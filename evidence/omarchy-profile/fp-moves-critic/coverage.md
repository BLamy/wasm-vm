# T03t changed-hunk evidence map

Independent critic, 2026-09-15. Runtime scope is
`ecb958dc..c7a3c38b84d462eba585c9f7081c70c88cdd2534`. Subsequent changes are
recording, tests, documentation, and publication metadata. This map records
source-to-test execution paths; it does not claim instrumented line-hit counts.
The repo's guest/deterministic-test evidence waiver applies on this Mac.

## Runtime

| Changed boundary | Executed evidence and source assertion |
| --- | --- |
| FRegs default, clone, identity, architectural equality, local write version | `acceptance.log:14`–`:23` executes the five FRegs tests. `independent-native.log:7` and `:9` show 1,024 distinct identities across four concurrent creators. The shared handoff fixture executes interpreter writes through `write_raw`; the promoted identity-only replacement is recorded separately. |
| CpuStateHandoff FPR range, metadata key, prepare copy and elision | `acceptance.log:5`–`:10` executes exact offsets, initial 256-byte copy, unchanged zero-byte copy, changed-register refresh, f0/f31 little-endian bytes, and the unchanged 568-byte span (`crates/core/src/jit.rs:958`). The returned byte count follows the actual copy branch at `:149`, rather than a separate synthetic ledger. |
| FP control refresh and executed dirty-mask commit | The same handoff test commits mask bits 0 and 31, preserves f1, marks FS dirty, clears old dirty metadata, and verifies zero-byte/zero-version-change no-op commit. Directed native and wasm tests cover FS 0–3, frm 0–7, nonzero flags, same-value writes, and read-only moves. The promoted CSR-only FS-Off recheck isolates control refresh from both register versions. |
| Exit9 decoding and core precise retirement/trap delivery | `acceptance.log:43` records prefix1, PC `80000004`, illegal cause2, raw mtval `20209053`. `:44` records FP prefix1, PC `80000104`, load fault5, mtval `deadbeec`. `tests/support/jit_fp_moves.rs::runloop` asserts JIT execution increased, exact JIT retirement, x5/FPR/FS/flags/frm, MEPC/MCAUSE/MTVAL. |
| Translator ABI constants and integer source/destination masks | Native directed cases exercise the frozen private-memory ABI; actual browser and wasm direct-chain tests exercise inline/shared ABI and same-/cross-module successors. FMV.W.X consumes an integer source and FMV.X.W produces an integer destination in the six-op successor fixture. |
| Selected-op filter and generated per-block FS guard | `acceptance.log:28`–`:32` holds the remaining FP rejection families. All five selected encodings run under the independent 3,840-case corpus, including 960 first-op FS-Off traps (`independent-native.log:13`). Native/core prefix and browser successor trap receipts cover both taken and untaken generated guards. |
| Raw loads, NaN-box checks, J/JN/JX, boxing and immediate masked FPR stores | Worker native corpus: 1,984 cases, guest-state FNV `dc6031f4c37c7ec3` (`acceptance.log:46`). Independent integer-reference corpus: 3,840 cases, FNV `ba4ecacfdc4b9707` (`independent-native.log:13`). All source/destination alias classes, boxed/unboxed values, and exact NaN payloads execute generated WASM. |
| Integer-only emission requirement | `independent-native.log:8` parses and validates the generated all-five-operation module: 649 bytes, 194 instructions, only integer/control/memory WASM operations. The old production browser negative control records only 441 JIT retirements and fails the explicit 2,800 threshold despite matching guest state. The candidate records 3,639/4,000. |
| Native normal and precise-memory-fault FP commit calls | `fp_moves_native_directed`, `fp_moves_native_handoff_reuse`, and `fp_moves_native_precise_runloop` all pass (`acceptance.log:42`–`:49`). The directed fault block performs an FP write before the load fault and leaves a later f31 write unexecuted. |
| Browser private/shared normal and fault commit calls | All six BrowserExecutor tests pass (`acceptance.log:91`). Private directed/runloop tests enter `copy_from_module`; inline same-/cross-module tests enter direct `commit_registers`. Root FP write → successor FMV.X.W → fault records retired 4, PC `80000010`, f31 `ffffffffffa01234`, preserved f0/flags/frm (`:79`–`:80`). |
| Direct successor write visibility, f31 high dirty bit, and budget refusal | Same-module lines 69–72 and cross-module lines 85–88 record FS-Off retired 2/PC `80000008`, budget refusal retired 2/unchanged FP destinations, and enabled retired 6/PC `80000018`. The chained fault fixture proves a root-produced FPR is consumed before the precise successor fault. |

Paths in the table without a directory prefix are in
`evidence/omarchy-profile/fp-moves-r1/` for `acceptance.log`, or this critic
directory for independent logs. SHA-256 receipts are collected in the final
evidence manifest; browser/physical hashes are also in `artifact-audit.json`.

### Narrow waivers

- The big-endian conversion branch in `prepare_fp_registers` is not executed by
  aarch64 macOS or wasm32, both little-endian. No big-endian deployment claim is
  made; the unchanged little-endian public byte contract is directly asserted.
- `FRegs`' identity-space-exhaustion panic is not exercised: it requires creation
  of 2^64 register files. Normal allocation uniqueness, clone behavior, and the
  atomic concurrent boundary are directly tested; this fail-closed diagnostic is
  outside any reachable acceptance workload.
- Type declarations, doc comments, and constant definitions execute through
  consumers/builds, rather than having standalone runtime hit points.
- Snapshot serialization is unchanged and explicitly serializes only raw FPR
  words (`crates/core/src/hart/mod.rs:268`), restoring via `write_raw` (`:312`).
  The new host identity/version cannot enter its byte stream. The browser RAM
  state digest includes guest spills of f0/f31; it is not misrepresented as a
  direct digest of all FPRs. Full-register comparisons come from directed tests.

## Harness, demo, and metadata

- All new fixture/test functions are called by the committed acceptance target.
  No new ignored test or test-only runtime semantics were added. The independent
  corpus uses its own splitmix generator and integer reference, not JIT helpers.
- The exact golden sabotage in an isolated test crate fails at
  `sabotage.log:12`–`:16`: observed `0xffffffffff812345` versus deliberately
  corrupted `0xffffffffff812344`. Repository implementation/test bytes were not
  replaced during this run. The clean promoted test passed before the sabotage.
- The actual browser script executes a guest-authored mixed FP loop, compares
  interpreter/JIT register state, RAM digest and retirement, then runs the full
  current ISA suite. `browser-r2/suite.png` visibly shows 127/127 and no failures.
  `capability-inspection.png` is explicitly an inspection of the existing hidden
  legacy capability container; it is not passed off as ordinary desktop layout.
- The manifest recorder repair captures the actual `route.fetch` response bytes
  and fulfills that same response. The physical report's manifest identity was
  independently rehashed against the exact R3 source artifact. Defensive recorder
  failure propagation is waived as diagnostic-only; success-path response
  forwarding and identity binding were exercised by the owned physical rerun.
- Roadmap/policy/architecture/task changes describe the five-operation subset
  and preserve the separate responsive-mode gate. They carry no broader FP or
  desktop performance claim. Generated `web/dist` WASM bytes hash to
  `55557d7a158bb274d214692a76a2a876bbe56ecd7798cbc9adfcbb4bfc9a0c40`.
- The pristine clone at b4b7c70d completed the committed acceptance, including
  the promoted independent test and actual Chrome suite. `cold/report.json`
  records a clean checkout, scrubbed CARGO_*/Rust flags, exit 0 for each command,
  and byte-identical rebuilt WASM. The critic inspected `cold/runner.py` and
  compared all six runtime source files in that clone against c7a3c38b.
- Cloudflare deployed the tested capability to immutable deployment
  `2a2104a3.wasm-vm.pages.dev`; `cloudflare-public.json` records exact production
  and immutable WASM plus JS/roadmap/app identities. `artifact-audit.json`
  independently checks the local expected bytes and all recorded hashes.
- Incremental test-only commits 3a068128 and 9e89c516 repair the stale input
  fixture and isolate FPR identity/CSR-only refresh. Their focused native/wasm
  receipts pass; the frozen runtime and cold acceptance remain unchanged. No
  final task verdict is recorded by this coverage map.

## Regression wall limits

The local `make -k ci` log remains an honest failed aggregate. It encountered
Linux-only `wvseccomp` libc calls on macOS, all-feature dead-code lint errors in
`dispatch.rs`/`hart/mod.rs`, and the stale input capability fixture. A separate
native-compatible clippy attempt encountered an unrelated `display_metrics`
unused variable in `cli/src/boot.rs`. The critic confirmed an empty diff from
verified 37c7ffa1 through b4b7c70d for each of those runtime source paths. These
pre-existing paths do not refute the FP boundary; affected production-feature
checks and the corrected input fixture must be reported with their own results.

The native-compatible workspace run later stopped at `no_stdout_in_core`, a
lexical scanner that also scans existing test code. Its six detections are in
unchanged `decoded_cache_capacity_tests.rs`, `gpu/reset_verifier_tests.rs`, and
`gpu/resources.rs`; the latter eprintln is counted twice by overlapping string
patterns. `make ci`'s determinism scanner likewise rejects existing test-only
Instant/Duration calls in `gpu/resources.rs:1225`/`:1242` (`ci.log:528`). The
critic confirmed these files and both scanner boundaries are outside the FP
diff. They are recorded failures, not new FP findings.

The `zicsr-stub` wasm aggregate does not compile because existing BrowserExecutor
unit tests call `boot_supervisor` and `enable_builtin_sbi` while that feature
removes those methods (`ci.log:473`–`:499`). The T03t BrowserExecutor diff is
limited to the prepare/commit sites at lines 913 and 949, separate from those
unchanged tests. Production-feature clippy, actual browser suite, and directed
wasm FP acceptance pass.

The initial perf smoke recorded 12.3 MIPS below its 15 MIPS floor while the
workspace and cold build competed (`ci.log:541`); the first follow-up recorded
14.3 (`perf-isolated.log`). Both failures remain in the record. Once task-owned
builds/tests ended, the fixed baseline-candidate-candidate-baseline comparison
recorded 26.0, 25.7, 25.8, and 25.4 MIPS respectively, with all four exit codes 0.
Both candidate samples clear the unchanged floor. `perf-comparison.json` pins
commands, host, binaries and their SHA-256 values; the critic rehashed both
binaries and independently verified all 226 baseline core/config git blobs plus
retained dependency versions/checksums. This resolves the performance item.

After all 354 core unit tests and the changed-path acceptance passed, the extra
core-remaining sweep reached repeated pure-interpreter ISA/predecode comparisons.
The worker and critic agreed to stop that unrelated expansion and explicitly
retain its incomplete status. No changed core hunk depends on those remaining
targets: FRegs metadata and handoff code are covered by units/corpora/identity
tests, snapshot restore is exercised by the physical run, and exit9 accounting
is covered by precise native/browser runloop assertions. This does not turn the
aggregate workspace run green. The full affected JIT/runtime result follows.

The affected native JIT/runtime suite finished successfully, including the
446.54-second timekeeping churn case (`native-remaining.log:204`). The aggregate
command ends 101 because an existing wasm admission fixture still expected
FMV.W.X to be unsupported. Commit ac773549 repairs only that cfg(test) fixture
and its acceptance invocation: FMV.W.X now must be supported, FADD.S must remain
unsupported, and CSR exclusion/raw bytes/count assertions remain. The focused
test passed (`admission-fixture.log:8`–`:10`) and formatting passed. The critic
compares the entire wasm lib source outside that test module against c7a3c38b
and finds it identical. The repaired assertion adds no production code and
does not invalidate the cold or physical proof.

## Desktop evidence limit

The physical R2 report has 128 trusted keyboard transitions and 256 true event
acknowledgements, but 13 completed independent readbacks report an absent file.
The last readback is incomplete. Enter and failure are exactly 120,000ms apart.
The nonce never appears in serial-input bytes. This is a failed physical trial;
the responsive-desktop objective remains unresolved.
