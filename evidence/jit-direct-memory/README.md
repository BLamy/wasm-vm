# E5.5-T03bg evidence guide

**VERDICT: verified**, recorded by the independent critic in `a50516b6`.
The runtime is published; verified demo metadata is being refreshed. Two final microbenchmark batches and the five-pair real-workload
matrix are complete. Preliminary screens, submission gate failures and unrun
targets are retained below. No claim of 300 MIPS on real workloads or improved
desktop latency is made.

## Runtime and artifact identity

The only production runtime change is the browser JIT import boundary in
[`jit_browser.rs`](../../crates/wasm/src/jit_browser.rs): generated modules now
import the owning wasm instance's scalar `__jit_load`, `__jit_store`,
`__jit_amo`, `__jit_lr` and `__jit_sc` exports directly. Each export rejects an
inactive HOST context with the existing JS `null` sentinel before accessing
pointers. Existing translation, permissions, device dispatch, precise faults,
reservation handling, invalidation and atomic chain-abort helpers remain in use.
Native runtime source trees are unchanged from the parent.

- Parent: `96f30bdee9d0a98672336b223004054677baee36` (PR #401 runtime).
- Frozen implementation: `7e51177d966e05f7ae8b3ae23c7d5d0d028c404b`.
- Parent wasm SHA-256: `70de75fd1a2cfb6b51893773a394c0276189a1e54fe9a57dca1fbc47dea1f873`.
- Candidate committed wasm SHA-256: `4f1005a174e6dba3cf698d503a21a10168f4ff37db2c2419fbae86fb2f8a787b`.
- Candidate runtime-source SHA-256: `8d592c91c45dbffba8958648542d255cb8e69256f65a1a17de5e7de4fb1116ed`.

[frozen.json](frozen.json) binds the implementation, compiler, runtime, both new
test files, benchmark harness and `web/dist/pkg/wasm_vm_wasm_bg.wasm`.
[baseline.json](baseline.json) binds the preserved parent. The verifier
[independently checked](verifier/static-review.md) both parent hashes against
`git show`, and both preserved baseline wasm copies match the committed parent.

The screens were recorded before the implementation commit, with HEAD
`0447e1c2` plus uncommitted changes. Their recorded candidate source, harness and
wasm hashes match the frozen mapping; they must not be described as executions
from a pristine frozen checkout. The verifier's subsequent cold-clone acceptance
does run at the exact frozen head. The preserved benchmark baseline lives at
`/tmp/wasm-vm-direct-memory-baseline`: `pkg/` serves the microbenchmark, `web/`
serves real workloads, and `baseline.json` supplies the hash assertions. Its lack
of `.git` causes the retained browser-screen metadata warning; the explicit
committed-artifact hashes provide the identity proof.

## Correctness and coverage already recorded

[`make verify-E5.5-T03bg`](../../Makefile) passes in
[acceptance-screen.log](acceptance-screen.log) and again in the independent
[cold-clone log](verifier/cold-clone.log): format, strict clippy on the three
affected wasm test targets, 5 worker tests, 2 verifier tests and 38 existing
browser parity tests. One existing long eviction-churn test remains ignored.

- Each private SoftMMU / imported-memory InlineTLB mode proves all five actual
  generated imports equal their owner exports, accepts five frozen signatures,
  rejects 19 scalar type mutations and detects an isolated JS trampoline
  substitution. Inline load/store aliases receive the same identity checks.
- Fifty literal/reference cases per mode cover all seven load kinds, four store
  widths, high bits, misaligned scalar accesses, all nine AMO operations at both
  widths, LR/SC success and reservation mismatches, and precise helper faults
  after an observable prefix. Full serialized hart state and all RAM match the
  interpreter. Each case records a state SHA-256 and a reference instruction-state
  trace SHA-256; the latter hashes PC/raw word/before-and-after state plus any trap.
  It is explicitly an oracle trace digest, not a fabricated JIT retirement trace.
- Both 50-case aggregates are
  `ee01061fe9fb4cf5612d065557c1dc7c2d33a01567748aa516d145bd3c4c80bc`.
  All three successful atomic helpers also stop before a linked successor;
  a non-atomic control proves that edge can actually execute.
- Worker guard probes make 20 inactive calls per mode. The independent lifetime
  attack adds 55 per mode and eight compiled executions, alternating two guests,
  retaining separate reservations, dropping one guest and resuming the other
  after 65,536-byte owning-memory growth. Both receipts record an `ArrayBuffer`:
  shared here means memory imported between wasm modules, not SharedArrayBuffer
  or concurrent execution.
- Existing browser parity covers MMIO, permissions/remapping, inline misses and
  refills, self-modifying code, store logging and memory growth during successful
  and faulting compiled calls. [Verifier review](verifier/review.md) maps changed
  hunks and predictions to exact log lines.

[cold-clone.json](verifier/cold-clone.json) records an initially absent target
directory, scrubbed Rust/Cargo overrides, clean initial/final git status and exit
0 at the frozen head. Its log SHA-256 is
`4360885099d147e34e19643b3b59f1f31149a629f47e50dba30da08277dc8063`.
In that isolated clone, the verifier then removed only the load export's active
guard. The test rejected the resulting wrong exception/null dereference;
restoring the file restored a passing test and clean checkout. See
[sabotage receipt](verifier/guard-sabotage.json), [patch](verifier/guard-sabotage.patch),
[failure](verifier/guard-sabotage.log) and [restored run](verifier/guard-restored.log).

## Final performance and remaining evidence

Two final seven-pair batches at the frozen implementation head are recorded in
[micro-final-1/report.json](micro-final-1/report.json) and
[micro-final-2/report.json](micro-final-2/report.json). Both bind the parent and
candidate wasm hashes above, report no browser errors and pass exact
CPU/CLINT/clock/RAM state and retirement assertions. Each uses fixed instruction
budgets, alternating sample order and host `performance.now()`. The earlier
[screen](screen-1/report.json) is retained separately.

| Workload | Batch 1 parent → candidate MIPS | Batch 1 speedup / paired median | Batch 2 parent → candidate MIPS | Batch 2 speedup / paired median |
|---|---:|---:|---:|---:|
| AMO add | 15.82 → 19.08 | 1.206× / 1.202× | 16.04 → 19.16 | 1.195× / 1.195× |
| LR/SC | 23.23 → 31.74 | 1.366× / 1.362× | 23.30 → 32.10 | 1.378× / 1.378× |
| InlineTLB collisions | 41.48 → 103.71 | 2.500× / 2.493× | 41.97 → 105.81 | 2.521× / 2.526× |
| InlineTLB hit control | 393.58 → 401.89 | 1.021× / 1.021× | 389.52 → 396.79 | 1.019× / 1.014× |
| Integer control | 635.63 → 655.76 | 1.032× / 1.034× | 635.60 → 657.03 | 1.034× / 1.037× |

Speedup is baseline median duration divided by candidate median duration; paired
median is the median of the seven per-pair ratios. All three affected workloads
clear the predeclared 1.02× threshold by both calculations in both batches.
Controls show small improvements and no >5% regression. This supports the scoped
import-heavy gain.

The [final browser matrix](browser-final/browser.json) contains five alternating
pairs for each JIT/interpreter configuration (20 successful runs). Host-time
medians and candidate/baseline duration ratios are:

| Real workload phase | Parent seconds | Candidate seconds | Duration ratio | Paired median ratio |
|---|---:|---:|---:|---:|
| BusyBox JIT boot | 4.8691 | 4.7844 | 0.9826 | 0.9832 |
| BusyBox JIT shell | 3.9198 | 3.8679 | 0.9868 | 0.9914 |
| BusyBox interpreter boot | 4.6833 | 4.7249 | 1.0089 | 1.0086 |
| BusyBox interpreter shell | 2.8573 | 2.8689 | 1.0041 | 1.0005 |

These real results are approximately neutral: JIT medians are 1–2% faster;
interpreter boot is 0.89% slower and shell 0.41% slower. Every phase meets the
declared <=5% regression limit by both calculations.
[performance-acceptance.json](performance-acceptance.json) records the complete
passing budget/state/error evaluation against [final-timing-plan.json](final-timing-plan.json).
[final-timing-receipt.json](final-timing-receipt.json) binds exact commands,
exit codes, log hashes and unchanged runtime/harness/wasm hashes before and after
all final timing runs. There was no post-hoc sample filtering.

Candidate JIT throughput is 83.78 MIPS during boot and 42.92 during the shell
region. The same candidate shell workload runs at 57.86 MIPS with JIT disabled
(2.8689 versus 3.8679 seconds). That result supports investigating mixed-workload
JIT/tier/host-handoff overhead; it does not isolate which component dominates,
and it is not evidence of desktop improvement. Live RTC means boot work can
differ; real results compare host durations, not deterministic guest equivalence.
No run fetched a boot snapshot. Raw errors remain recorded; the acceptance
analysis allows only errors explicitly identified as favicon requests.

The [three-pair BusyBox JIT screen](browser-screen/browser.json) is approximately
neutral for boot (4.7458 → 4.7220 seconds), while shell median time is **3.24%
longer** (3.7019 → 3.8219 seconds). This initial screen is retained as preliminary
evidence and is not replaced or pooled into the predeclared final matrix.

Completed submission diagnostics: [gate summary](gates/summary.md) and
[command/hash record](gates/submission-diagnostics.json).
Native wasm-wrapper tests (33 passed), all six feature builds, no-host-float and
strict affected library/fixture clippy passed. Native cfg-skipped wasm tests are
not actual-wasm coverage. Broad wasm
clippy stops at the unchanged `hart.rs` collapsible-match warning; the initial
worker broad-clippy attempt also encountered unchanged `hart_ctrl.rs`'s unused
import. `make ci` stops in Linux-specific `wvseccomp` on this Mac.
The determinism-hazards scan flags existing `Instant`/`Duration` use in GPU tests.
[Parent/current file identities](gates/preexisting-file-identity.json) retain the
relevant pre-existing comparisons. The first full-wasm invocation mistakenly
forwarded `--no-fail-fast` to `cargo build`; its failure is retained, and the
corrected full suite is recorded in [full-wasm-tests-retry.log](gates/full-wasm-tests-retry.log).
That run records **248 passed, 1 inherited snapshot failure and 1 ignored**, then
stops at `reserved_section_is_refused_as_unsupported_on_wasm32` in `resume`.
It reached 60 of 79 integration targets; **19 later targets and doctests did not run**.
[wasm-test-counts.json](gates/wasm-test-counts.json) lists every unrun target.
The gate summary cites the identical historical snapshot failure and the
parent/current hashes of both the test and its supported-section predicate.
These partial full-suite counts are distinct from the successful directed
acceptance and frozen cold-clone proof above.
**The scoped verdict does not claim that all broad gates pass.**

The frozen local [demo receipt](demo-frozen/demo-suite.json) records 127/127 ISA
cases, the direct-memory roadmap capability live at 31/31, and zero unexpected
errors. The raw console retains an explicitly identified `/favicon.ico` 404.
[Screenshot](demo-frozen/demo-suite.png). Live publication and deployed artifact hashes are recorded below. The fresh
verifier marked the task verified in `a50516b6`; final status metadata follows.

## Reproduction

Run from the frozen checkout with the pinned Rust toolchain, wasm32 target,
Node and wasm-pack available (recorded: Rust 1.96.0, Node 24.20.0, wasm-pack
0.15.0). Deterministic acceptance needs neither boot assets nor Chrome:

```sh
make verify-E5.5-T03bg
```

For a fresh-clone reproduction, clone without sharing the original target
directory, detach at the frozen hash, then execute with inherited overrides
removed. This is the scrub used by the acceptance contract, not a request to
repeat already-held verification without a changed boundary:

```sh
git clone --no-local /path/to/wasm-vm /tmp/direct-memory-clean-repro
cd /tmp/direct-memory-clean-repro
git checkout --detach 7e51177d966e05f7ae8b3ae23c7d5d0d028c404b
python3 - <<'PY'
import os, subprocess
env = {k: v for k, v in os.environ.items()
       if k not in {'RUSTFLAGS', 'RUST_LOG'} and not k.startswith('CARGO_')}
subprocess.run(['make', 'verify-E5.5-T03bg'], env=env, check=True)
PY
```

Browser timing additionally needs Playwright in `web/node_modules`, system
Chrome, candidate `web/pkg` matching the frozen committed wasm hash, and the
preserved baseline directory described above. BusyBox needs the same local
`releases/` boot artifacts for both roots; the harness withholds boot snapshots.
Use new output directories and run sequentially on a quiet host:

```sh
node tools/verify/jit-direct-memory-benchmark.mjs \
  evidence/jit-direct-memory/repro-micro-1 /tmp/wasm-vm-direct-memory-baseline
node tools/verify/jit-direct-memory-benchmark.mjs \
  evidence/jit-direct-memory/repro-micro-2 /tmp/wasm-vm-direct-memory-baseline
node tools/perf/bench-browser.mjs \
  --root baseline=/tmp/wasm-vm-direct-memory-baseline \
  --root candidate=. --releases releases \
  --out evidence/jit-direct-memory/repro-browser \
  --samples 5 --cases busybox-jit,busybox-nojit
```

The micro harness's `passed` field proves completion/state assertions, not the
performance thresholds; recompute those against `final-timing-plan.json`.
Earlier failures remain in `acceptance-screen-attempt1-unrelated-clippy.log` and
`acceptance-screen-attempt2-fixture-expectations.log`; the second records corrected
test assumptions about InlineTLB import aliases and branch exit codes, with no
runtime repair. See [responsiveness-analysis.md](responsiveness-analysis.md) for
why faster memory imports alone do not establish a responsive software-rendered
desktop or a comparable v86/WebVM MIPS rating.

## Worker publication

`bash tools/deploy-cloudflare.sh` completed at
https://134c1d26.wasm-vm.pages.dev (production https://wasm-vm.pages.dev).
[Deployment log](deploy-worker.log) retains exact boot-asset validation;
[published manifests](published-manifests/) preserve the R2 rewrites.
[Live hashes](live-worker-hashes.json) match wasm, roadmap, tasks and service
worker bytes to committed frozen artifacts. [Live browser proof](demo-live-worker/demo-suite.json)
records 127/127 ISA cases, 31/31 direct-memory capability and no unexpected
errors; [screenshot](demo-live-worker/demo-suite.png). Task metadata still says
in progress in this first runtime deployment; the final verified metadata is
published after the separate critic verdict. Draft [PR #402](https://github.com/BLamy/wasm-vm/pull/402)
remains open and unmerged.
