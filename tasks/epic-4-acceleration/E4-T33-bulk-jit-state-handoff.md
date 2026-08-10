---
id: E4-T33
epic: 4
title: Bulk JIT CPU-state handoff and bounded browser handle lifetime
priority: 432
status: in-progress
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

### 2026-08-10 — verifier — VERDICT: refuted

- P1 browser zero-allocation state handoff — **FAILED**. Predicted one retained typed-array view on
  each side and zero per-dispatch view construction. `BrowserExecutor::invoke` calls
  `state.copy_from` / `copy_to` at `crates/wasm/src/jit_browser.rs:471,493,503`; the frozen built glue
  lowers both directions through `getArrayU8FromWasm0(...).subarray(...)` at
  `web/dist/pkg/wasm_vm_wasm.js:1562-1564,1613-1615,1971-1973`. The promoted direct-execution test
  observed exactly **2** `Uint8Array.prototype.subarray` calls for one clean compiled dispatch
  (`browser_dispatch_reuses_memory_views_without_subarray_allocation`, failure at
  `crates/wasm/tests/jit_browser_parity.rs:395`). The worker's K+2 externref invariant cannot see
  these JS-local temporaries. Retain/rebind the outer-Wasm handoff view too and make the counter zero.
- P6 private native registry probe tail — **FAILED**. Predicted the replacement mixer would not
  admit a crafted long probe cluster. Because it is seedless and invertible, the promoted test made
  1,024 distinct aligned keys share the same low 15 bucket bits and SwissTable h2 tag, then measured
  **1,024 equality probes** on one miss (`deterministic_jit_hasher_resists_chosen_probe_clusters`,
  `crates/jit-runtime/src/lib.rs:1150`). A second crafted set stayed inside the default 128 MiB mapped
  DRAM range and measured a **128-entry probe cluster** from 128 aligned PCs
  (`mapped_dram_pcs_do_not_form_chosen_probe_clusters`, `crates/jit-runtime/src/lib.rs:1188`). Use a
  fast per-executor randomized mixer or another registry with a bounded lookup tail, and make both
  tests green.
- P2 precise dirty-register fault state — **HELD**. Native and Node browser tests dirtied x1..x30,
  faulted the x31 load, and preserved x0, x1..x30, x31 sentinel, virtual fault PC, cause, tval, and
  caller-owned PC exactly.
- P3 browser ownership/eviction churn — **HELD**. The explicit 4,096-cycle, two-batch-budget Node run
  preserved the exact K+2 ownership algebra, active eviction/retranslation, full x0..x31 state,
  per-call exits, invalidate floor, and post-drop baseline.
- P4 exact-work performance — **HELD for the stated workload**. A fresh five-sample release rerun at
  this loaded verifier host measured 15.414 interpreter / 88.657 JIT MIPS on the exact 64-op workload
  (**5.752x**) and 14.555 / 19.679 MIPS on the six-op diagnostic (**1.352x**); all architectural work
  assertions passed. This does not waive P1/P6.
- P7 guarded executor protocol — **HELD**. Promoted native and browser tests prove an uncompiled
  `execute` returns `None` before changing cache stats, execution count, registers, or PC. This locks
  down the public `is_compiled` / `execute` guard that the worker restored before submission.
- P8 fixed state memory — **HELD**. SoftMMU single/batch modules parse as min=max=1, InlineTlb remains
  imported/growable, and the browser rejected `memory.grow(1)` without replacing/detaching the cached
  view. Sabotaging both SoftMMU declarations back to unbounded made the directed parser test fail
  (`maximum: None` versus `Some(1)`), after which the runtime diff was restored to zero.
- COVERAGE — every changed little-endian production exit/lifecycle path was exercised by the focused
  native/Node gates. Big-endian codec branches are waived as target-specific code unavailable on this
  Apple Silicon verifier; generic `Hasher::write` is waived because all four production registries use
  only the exercised `u64`/`u32` specializations. The browser glue allocation was missing from the
  worker's source-only coverage model and is now a permanent failing regression test.
- SUITE: promoted the two browser-view/miss tests, the native pure-miss test, and both crafted-cluster
  tests in `b75a2d4783fcf85c687b4c241935915cb1d417f4`.

Commands: `cargo test -p wasm-vm-core --lib
jit::tests::cpu_state_handoff_pins_frozen_layout_endian_and_x0 -- --exact`; focused native precise
trap / guard tests; focused Node browser precise-fault / guard / 4,096-churn tests; release
`perf_handoff`; translator fixed-memory parser test plus sabotage; promoted refutation tests. Pristine
clone: `/private/tmp/wasm-vm-e4t33-verifier.7nxRyt/repo`, submission head
`7ad65fb90327925a66662c96abef99556b435ea6`, verifier-test head
`b75a2d4783fcf85c687b4c241935915cb1d417f4`, scrubbed of `RUSTFLAGS`, `RUST_LOG`, and `CARGO_*` build
overrides. The cold clone reproduced the browser failure as exactly 2 subarray calls versus 0 and
the native failures as exactly 1,024 and 128 equality probes.
