---
id: E4-T33
epic: 4
title: Bulk JIT CPU-state handoff and bounded browser handle lifetime
priority: 432
status: implemented
depends_on: [E4-T31]
estimate: S
risk: high
capstone: false
---

## Goal

Remove the per-register host boundary from both JIT executors. Marshal the frozen CPU-state region
in one bulk write and one bulk read per compiled block, and retain a stable browser typed-array view
instead of constructing/cloning JS handles on every register access and dispatch.

## Acceptance criteria

- Native and browser executors perform O(1) state-copy calls per block, with no per-register memory
  reads/writes and no per-dispatch browser `Function`/memory-view clone.
- The release JIT pure-ALU benchmark is faster than the interpreter on the same frozen head and the
  before/after MIPS ratio is recorded against the now-exact E4-T31 work budget.
- A long browser-executor stress run completes with bounded live modules/handles, active eviction,
  no `addToExternrefTable0` growth failure, and identical final architectural state.
- Precise traps, I/M/A parity, SMC invalidation, eviction, and integrated CLI JIT tests remain green.

## Adversarial verification

Force a memory fault after dirty register writeback, evict while repeatedly retranslating, set a tiny
cache budget, and run enough hot blocks to exceed the old failure point. Any lost register, imprecise
trap, unbounded live handle count, or JIT slowdown refutes the change.

## Verification log

### 2026-08-10 — worker — implemented

Runtime/test commit: `f725abf23f85ba2e98d6fa13d07affce07737ec4`. Full evidence and
diff-to-test coverage audit: `evidence/e4-t33/README.md`. Browser artifacts:
`evidence/e4-t33/browser-bulk-jit.jpg` and `evidence/e4-t33/browser-roadmap.jpg`.

The unchanged-runtime benchmark baseline is `73d1e88ad60f0e548edc98bdb41b34e6347ce097`.
The identical five-sample, exact-budget 64-op workload measured 76.083 interpreter / 238.552 scalar
JIT MIPS at baseline and 81.092 interpreter / 608.741 bulk JIT MIPS at the frozen runtime commit:
2.551x same-workload JIT uplift and 7.507x final JIT/interpreter. The six-op boundary diagnostic
also moved from 10.267 JIT / 26.773 interpreter (0.383x) to 87.625 / 62.692 (1.398x).

Final worker commands:

```text
cargo fmt --all -- --check
cargo clippy -p wasm-vm-core -p wasm-vm-jit-translate -p wasm-vm-jit-runtime \
  -p wasm-vm-cli --all-targets -- -D warnings
cargo clippy -p wasm-vm-wasm --lib --target wasm32-unknown-unknown --release -- -D warnings
cargo test -p wasm-vm-core
cargo test -p wasm-vm-jit-translate
cargo test -p wasm-vm-jit-runtime
cargo test -p wasm-vm-cli
cargo build -p wasm-vm-wasm --target wasm32-unknown-unknown --release
wasm-pack test --node crates/wasm
cargo test -p wasm-vm-jit-runtime --release --test perf_handoff \
  -- --ignored --nocapture --test-threads=1
wasm-pack test --node crates/wasm --test jit_browser_parity -- \
  browser_handles_remain_bounded_across_retranslation_churn \
  --include-ignored --exact --nocapture
make web-build
```

All passed. A strengthened post-audit precise-fault test dirties x1 through x30 before faulting a
load into the x31 sentinel and is green in both native and browser executors. The explicit 4,096
cycle, two-batch-budget browser attack passed with active eviction/retranslation, exact K+2 batch
ownership, bounded externref counts, full x0..x31 parity, exact exits, and baseline handle counts
after invalidation/drop. Native I/M/A, precise-trap, SMC invalidation, chaining, eviction, timing,
integrated CLI, and full Node Wasm suites remained green.

The fresh COOP/COEP demo at port 8147 restored BusyBox to a real `~ #` in 0.41 seconds, reported
`126 passed`, surfaced exactly one filtered E4-T33 roadmap issue, and emitted zero console errors or
warnings. Aggressive main-thread `jit=1&jitThreshold=1` loaded without console errors but saturated
DOM automation; responsive worker-default JIT remains E4-T32 and is not claimed here. The E4-T33
roadmap capability deliberately remains `in-progress` pending this task's separate adversarial
verifier. No deployment was performed.
