VERDICT: verified

Fresh medium-risk review of `codex/omarchy-residency-cap1024..a4df45de`, with
the worker runtime/test submission frozen at
`37a269d490543b3c2970de600d60f7f055c6acac`. Later worker commits contain only
evidence and task status. The accepted claim is a measured negative investigation
and retained regression/measurement harness. No additional emulator speedup,
desktop response, or release acceptance is inferred.

- **P1 — HELD, canonical guest execution.** Before inspecting the trace, predicted
  192 retirements yield mtime 3, phase 0, x5 2, x6 64, and PC `0x80000000`.
  Generated all 192 canonical lines independently from the three instruction
  encodings. Every recorded baseline/candidate line matches: rdtime first becomes
  1 at line 67, becomes 2 at line 130, and line 190 reads 2. Trace SHA-256 is
  `f8cb47ab87213e6d1f0e613d6130babdc3af7fb91a749e9a51c66117143701a9`.
  Final `clock-investigation-r1/final/control/report.json:3075` holds the predicted
  final state and full-resume SHA-256
  `38d6ede041ba09b56aea2905768d601b94ec2ae4508e724ec905dbb7eab374f0`.
  Fresh native execution reproduces both digests in `runtime-control/report.json:3075`.

- **P2 — HELD, independent overflow/restored-phase oracles.** Predicted divider
  `u64::MAX`, restored phase `u64::MAX-1`, starting mtime `u64::MAX-1`, and
  192 retirements leave phase 191 and mtime `u64::MAX`. The independent instruction
  fingerprint is `c0294a3bbfa58ab6`; the worker log agrees for uncached, cached,
  and cached/batched execution at `clock-investigation-r1/final/focused-gates.log:95`.
  Recomputed all 72 native trace fingerprints from independent Python integers,
  instruction encodings, and wrapping arithmetic, including the phase-zero,
  largest-divider and mtime-wrap cases. RAM SHA is independently derived from
  the 4096-byte fixture image: `c7d032c22b596d220102600fedf6e5de9e0f7e38487e0367eb4b8a7d4b51f7c4`.
  Before running a promoted fixed-value test, also predicted: `(MAX+MAX)/64`
  with initial mtime `MAX-1` leaves phase 62 and time 576460752303423485;
  a single retirement with divider/phase/time all MAX leaves phase 1 and time 0;
  zero-divider clamp with phase/span/time MAX leaves phase 0 and time MAX-2.
  All hold in `focused-gates.log:22`. The original direct tests exercise zero
  and varied dividers, restored invalid phase, 64-bit addition overflow, wrapping
  mtime, varied schedules, wall mode, and missing CLINT. Shared guest tests exercise
  eight split budgets and byte-exact resume at retirement 101 in native and WASM.
  Worker prose is corrected to **72 native configurations plus the same 72 in
  WASM**; divider 1 repeats phase 0, so there are 66 distinct tuples per target.

- **P3 — HELD, paired timing/state and actual compiled execution.** Predicted
  each native timed run retires 8,000,000 instructions with x5/x6/x7 equal to
  2,000,000/4,000,000/6,000,000, PC at DRAM, and exact divider quotient/residue.
  Predicted browser runs retire the 20,000 prefix plus 4,000,000 interpreted or
  40,000,000 compiled instructions, with exact clock arithmetic; an armed
  executor alone cannot pass. Independently recounted all four exploratory
  reports, the frozen control, and one fresh actual collector run: **150 native
  pairs and 150 browser pairs**, 360 native and 420 browser observations including
  warmups. Five alternating pairs and the expected arm orders hold per configuration.
  Every paired state, native register/full-resume receipt, and browser CPU/CLINT/
  CLOCK/RAM receipt matches. Actual JIT arms have a compiled block, executor calls,
  executed blocks and at least 40,019,748 compiled retirements of 40,020,000 total;
  all non-JIT arms have zero compiled retirements. Citation:
  `runtime-control/report.json:9616`, SHA-256
  `ad08bf21678adcd7c99b7eb9a683d0af4502db5548997b7c43a635c2b5b38e05`;
  full independent reconstruction and every fixture log point are in `audit.json`.
  Medians are sorted and recomputed from the five timings per arm, excluding warmups.

- **P4 — HELD, honest rejection and timing control.** Recomputed the four browser
  cached/divider-64 ratios as 0.9949322459, 0.9788884123, 0.9755331793 and
  0.9966413874. Each exploratory collector stopped at its explicit speed gate
  (`passed=false`, the preserved speed-gate assertion), after complete state
  comparisons; none is runtime implementation evidence. Reconstructed the exact
  exploratory collector bytes from the final collector by restoring its old
  different-byte assertion, speed-gate assertion and summary; SHA-256
  `8d88939b4357db3a2a958f0cf034d054fbf7e3ba9e94ee3096f43829905db142`
  matches every exploratory report. Final control ratio 0.9822989497 and fresh
  control ratio 0.9905524074 both record `unchanged-runtime-control` and
  `acceptanceHeld=false` (`runtime-control/report.json:11181`). Predicting an
  identical-byte ratio of 1.5 still must fail acceptance, the promoted test executes
  the actual collector statements and proves that result. Removing only the
  identity acceptance guard in an isolated copy makes exactly that test fail
  (one failure, two passes), as predicted; see `control-sabotage.log:1` and
  `attacks.json`. These synthetic edits are collector attacks, not browser evidence.

- **P5 — HELD, final runtime/artifact identity and admission attack.** Predicted
  removal of only the cfg(test) module declaration makes the final core source
  equal to current main, and production WASM is byte-identical. Byte comparison
  holds; no production core/wasm runtime file has another changed hunk.
  Main, frozen submission, current dist, preserved production baseline and its
  rebuilt module all have WASM SHA-256
  `f8b40d93039a9bb454250df40592e8c1d62144cac600bdcd82ea74098d7bb516`.
  Preserved and fresh native production rlibs are identical at
  `0bc05d399cb856cbc88d81f727a9563fca082e7a4ef85b32386e1556ebb906dd`.
  Both arms use one public producer, preserved Rust crate filename and explicit
  matching fat-LTO/codegen flags. All 14 final sealed files and source/producer/
  collector hashes match. Bounded novel attack: append bytes to a copy of the
  preserved rlib. Predicted rejection before any timing; actual process exits 1
  at collector SHA admission (`baseline-tamper.log:1`, collector line 21), with
  no report or browser run. Original artifacts remain untouched.

- **P6 — HELD, relevant gates/demo and preserved environmental limit.** The
  promoted acceptance command passes formatting, JS syntax and all three
  collector attacks, strict affected clippy, five direct native clock tests,
  72 native guest configurations and the same 72 in the WASM fixture
  (`focused-gates.log:28,109,130`). No added test is ignored. The sealed frozen
  clone command/exit-0 receipt and guest digests carry forward because production,
  producer, collector, dependency boundaries and original fixture semantics are
  unchanged. Clone reflog confirms its frozen checkout before the later main
  checkout for the seccomp baseline reproduction; no unrelated cold clone is
  repeated. The built demo receipt is 127 passed, 0 failed, zero relevant console/
  HTTP errors; favicon 404 is the explicit allowance. Personally inspected the
  actual PNG, SHA-256 `6765ab538ed0241123fb249806ad25f6e5964c9661d994b2a3a547702060aede`,
  showing E5-T26j verified. Both roadmap source/dist now explain the four rejected
  candidates and no additional speedup; status, timer defaults, guest artifacts
  and desktop deadline are unchanged. The four macOS seccomp errors in the
  worker gauntlet match the untouched-main reproduction. No complete gauntlet,
  Linux portability, deployment or desktop response pass is claimed.

Coverage is complete for the retained boundary:

| Changed hunk | Executed evidence or narrow waiver |
| --- | --- |
| Make acceptance recipe | Worker frozen/cold logs; fresh `focused-gates.log` including promoted collector tests. |
| Core test-module declaration | All five direct clock tests execute. Production absence is proven by source normalization and identical WASM/rlib bytes. |
| Direct clock tests | All loops/oracles, invalid/normal phase, overflow, zero clamp, mtime/compare/software-bit preservation, varied schedule and wall/missing-CLINT branches execute; fixed numeric cases promoted. |
| Native guest fixture | All helpers, restored phases/time, three cache/batching combinations, eight budgets, retirement-101 resume and all 192 trace records execute. Every native trace hash is independently predicted. |
| WASM fixture import | The same guest function executes via wasm-bindgen-test; one test pass covers 72 loop configurations. |
| Public probe | Cache on/off, CLINT/no-CLINT, arithmetic-loop/rdtime-trace, argument-based clock and phase arithmetic, snapshot sections and digest production all execute. Invalid-argument parse/assert panic branches are waived as fail-closed CLI diagnostics. |
| Collector production path | Artifact admission, native LTO builds, warmups, arm alternation, trace hashes, both browser module imports, all five configurations, snapshot state extraction, compiled/noncompiled checks, state comparisons, medians, report emission and browser cleanup execute in the fresh actual run. |
| Collector negative/positive choice | All identical/unequal-byte and slower/equal/faster decision branches execute in promoted synthetic tests. Matching-but-wrong mtime and forged zero JIT retirement receipts are rejected by the actual collector statements. |
| Defensive collector guards | Baseline-rLIB hash guard exercised by tampering. Invalid snapshot length/missing-section exceptions, unrelated server traversal/read-error guards and general producer-error catch are waived as fail-closed diagnostics: valid pinned modules produce valid snapshots, and this task makes no malformed-snapshot, hosting-security or recovery claim. Normal server requests and favicon 404 execute. |
| Roadmap evidence string | Source/dist identity reviewed; actual built demo receipt/PNG inspected. Static prose is waived from guest execution. |
| Generated tasks, queue, service-worker namespace, task prose and evidence | Declarative/generated/log metadata, waived from guest instruction coverage. No JIT default, guest artifact, deadline or production runtime change. |

Fixture/environment audit found no code-under-test-derived golden clock values:
oracles use wide integer arithmetic; instruction fingerprints and RAM image are
reconstructed independently. Paired equality alone is not accepted: independent
mtime/phase/register/retirement checks are executed. All four direct RNG seeds
and 40,000 varied schedules remain deterministic. The macOS Chrome path is an
explicit local measurement dependency, with browser version recorded; no
cross-host collector portability is asserted.

Promoted suite: one fixed-value overflow/zero-clamp/wrap regression in
`crates/core/src/clock_advance_tests.rs`, three collector attack tests in
`tools/verify/clock-fast-path-benchmark.test.mjs`, and their inclusion in
`make verify-E5.5-T03bd`. Existing canonical trace/digests remain permanent
fixtures. No rejected runtime code was restored and no implementation was fixed.

Commands (cwd `/tmp/wasm-vm-current-speed-work`):

```text
python3 evidence/omarchy-profile/clock-investigation-verifier-r1/audit.py
python3 evidence/omarchy-profile/clock-investigation-verifier-r1/attacks.py
node --test tools/verify/clock-fast-path-benchmark.test.mjs
cargo test -p wasm-vm-core --lib clock_advance_tests
node tools/verify/clock-fast-path-benchmark.mjs \
  evidence/omarchy-profile/clock-investigation-verifier-r1/runtime-control \
  /tmp/wasm-vm-clock-current-baseline
make verify-E5.5-T03bd
git diff --check
python3 tools/check_task_policy.py
python3 tools/build_queue.py
```

Independent evidence is sealed in `sha256.json`. Native measurement binaries
and Cargo's build manifest are ephemeral; the collector records their digests,
and the verifier checked the fresh native binary digests before excluding them
from the retained log/trace evidence. Original checkout and unrelated artifacts
were not modified. No PR merge or deployment was performed by this verifier.
The staged whitespace check reports only the untouched raw Node assertion output's
two space-only lines and the raw gate log's final blank line. These recorded bytes
are retained under the seal; the scoped code/test/task whitespace check passes.
The verifier-only commit uses the hook's documented `SKIP_WEB_BUILD=1` because
its core change is cfg(test) code; the coordinator owns the subsequent task
metadata/dist refresh, and production byte identity has already been verified.
