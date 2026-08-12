---
id: E4-T33
epic: 4
title: Bulk JIT CPU-state handoff and bounded browser handle lifetime
priority: 432
status: verified
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

### 2026-08-10 — worker — repaired implementation

Runtime/test/build commit: `8ef240df8ee9690a1f7f0a36af99de208ead04bf`. Full repaired evidence,
diff coverage, exact command results, rr-soft manifests, browser artifacts, pristine-clone proof,
and deployment URLs: `evidence/e4-t33/README.md`.

The P1 repair retains a Box-stable 568-byte host image and one outer-Wasm `Uint8Array`, using one
direct TypedArray `set` each way. The promoted clean dispatch now observes zero `subarray` calls;
pre-call growth, mid-call clean growth, and mid-call precise-fault growth refresh the detached view
without changing the externref floor. Unrecorded browser exceptions and native Wasmtime traps now
fail closed after host-pointer cleanup, so already-observed MMIO is never replayed by the interpreter.
The P6 repair keys the private integer mixer once per executor; both 1,024-key arbitrary-alignment
and 128-PC mapped-DRAM chosen-cluster attacks pass while u64/u32 hot lookups remain one keyed mix.

Final release evidence on the exact work budget measured 61.026 interpreter / 439.354 JIT MIPS for
the 64-op acceptance workload (7.199x), versus the unchanged-runtime 238.552 JIT baseline (1.842x
same-workload uplift). The six-op boundary diagnostic measured 41.698 / 55.233 MIPS (1.325x), versus
the 10.267 JIT baseline (5.380x uplift). All counter, PC, register, and exact-budget assertions passed.

Final gates:

```text
cargo fmt --all -- --check
git diff --check
cargo clippy -p wasm-vm-core -p wasm-vm-jit-translate -p wasm-vm-jit-runtime \
  -p wasm-vm-cli --all-targets -- -D warnings
cargo clippy -p wasm-vm-wasm --lib --target wasm32-unknown-unknown --release -- -D warnings
cargo build -p wasm-vm-wasm --target wasm32-unknown-unknown --release
cargo test -p wasm-vm-jit-runtime
cargo test -p wasm-vm-cli --test run
cargo test -p wasm-vm-core --test async_compile_pipeline \
  interpreter_progresses_while_compiler_stalled -- --exact
bash tools/check-zero-cost.sh --selftest
wasm-pack test --node crates/wasm
wasm-pack test --node crates/wasm --test jit_browser_parity -- \
  browser_handles_remain_bounded_across_retranslation_churn \
  --include-ignored --exact --nocapture
cargo test -p wasm-vm-jit-runtime --release --test perf_handoff \
  -- --ignored --nocapture --test-threads=1
make web-build
cd web && E3_T17_DEMO=1 npx playwright test \
  tests/e3-t17-demo-proof.spec.js --reporter=list
```

All passed. Runtime totals include lib 4/4, batching 3/3, chaining 6/6, eviction 3/3,
invalidation 13/13, JIT execution 20/20, lockstep 3/3, precise traps 5/5, and timekeeping 3/3;
CLI integration passed 22/22. The full Node/Wasm matrix passed, and the explicit ignored stress
passed 1/1 after 4,096 exact-state churn cycles with active eviction/retranslation and K+2 batch
ownership. The real browser compliance gate passed 1/1 with `126 passed, 0 failed, complete` and
zero console errors.

On `ssh dev`, rr-soft 5.9.0 `-W --chaos` recordings of the native fail-closed MMIO path, keyed-cache
collision attack, and precise all-register fault all passed, packed, and autopilot-replayed. Their
manifest SHA-256 values are `ae567b153e85bd165c2fdb2d486a56befe040d434853941a31fa2648f887849b`,
`559b78b2fb4bee8424bff0e6aa96801434b8d39a5666b7b`, and
`64e928674c1cbe1fdb3e852b0ba7bff75457a31f5e668d45429201a9226993e1` under
`rr-traces/e4-t33-repair/`.

A pristine archive of `8ef240d` contains the generated inline snippet referenced by the committed
Wasm glue. Cloudflare deployed the exact build at `https://719132bb.wasm-vm.pages.dev` and production
`https://wasm-vm.pages.dev`; the live app reached `guest ready` and a real `~ #` with zero console
errors/warnings, and the deployed snippet returned HTTP 200 with the byte-identical committed hash.
The E4-T33 roadmap capability remains `in-progress` pending a fresh adversarial verifier.

### 2026-08-10 — verifier — VERDICT: verified

- P1 retained browser handoff — **HELD**. Predicted two steady clean dispatches would construct zero
  `Uint8Array` views, a detached pre-call view would rebind exactly once, clean and precise-fault
  mid-call growth would each rebind exactly once, and all four paths would make zero `subarray`
  calls. The promoted Node oracles held, including zero constructors/subarrays for an unexpected
  primitive JavaScript exception. Replacing the detach guard with an unconditional rebuild made the
  clean oracle fail with **4 constructors versus 0**, then the runtime diff was restored.
- P6 private keyed registries — **HELD**. Predicted independent executors would not reuse one public
  permutation, repeated `Hasher` writes would retain keyed prefix/order, and the old 1,024-key
  aligned plus 128-PC mapped-DRAM attacks would remain bounded. Eight real executors produced
  distinct keyed outputs, both repeated-write paths held, and 64 independent processes passed both
  collision attacks. Fixing the secret to a public constant made the promoted executor oracle fail.
- P9 fail-closed post-MMIO traps — **HELD**. Native and browser malicious dispatches each performed
  exactly one MMIO write, committed no dirty module register/PC image, returned no replayable
  `None`, cleared host state, and allowed a later clean dispatch. The packed native trace reached the
  fail-closed branch at rr event **1003** (`crates/jit-runtime/src/lib.rs:851`) with the malicious
  test on its stack, then replayed to PASS 1/1.
- P2 precise state and P3 bounded ownership — **HELD incrementally**. The repaired clean/fault growth
  tests preserve exact registers, virtual PC, cause, tval, and caller-owned PC. The explicit 4,096
  install/execute/evict cycle attack passed with active retranslation, exact K+2 ownership, unchanged
  externref floors, and exact final architectural state. The precise-fault rr trace entered its
  all-register oracle at event **488** and replayed to PASS 1/1.
- P4 exact-work performance — **HELD**. A scrubbed five-sample release rerun measured **40.437
  interpreter / 267.104 JIT MIPS (6.606x)** on the 64-op acceptance workload and **32.323 / 48.546
  MIPS (1.502x)** on the six-op boundary diagnostic. Every 6.4M/6.0M budget, counter, PC, register,
  IRQ, and JIT-retirement assertion held.
- P5 cold-clone/deploy portability — **HELD**. Exact submission clone
  `/private/tmp/wasm-vm-e4t33-reverify.HQwtwn/repo` rebuilt/imported the web package with the tracked
  inline snippet present. The fresh build, committed dist, and immutable Cloudflare preview all
  contained the same 170-byte snippet with SHA-256
  `b42727c1c9a8e533cd165ce533824d67bd20bd55e690e123787965f164fde04d`.
- HOST EVIDENCE — **HELD**. Every file in the three packed rr-soft traces matched its adjacent
  manifest and all three autopilot replays passed. Correct manifest digests are
  `ae567b153e85bd165c2fdb2d486a56befe040d434853941a31fa2648f887849b`,
  `559b78b2fb4bee8424bff0e6aa9683f08ba91e988fe92801434b8d39a5666b7b`, and
  `64e928674c1cbe1fdb3e852b0ba7bff75457a31f5e668d45429201a9226993e1`; the worker log truncated
  the middle digest, but the cited trace and manifest themselves are intact and replayable. Changed
  native source files in the Linux recording tree were byte-identical to runtime `8ef240d`.
- COVERAGE — **HELD**. Browser clean/pre-growth/mid-growth/precise-fault/unexpected-exception,
  native precise/fail-closed, u64/u32/generic hashing, cache churn, build packaging, and generated
  glue paths all executed. The statistically inaccessible `secret == 0` normalization is waived as
  a defensive branch; docs, dev-dependency metadata, and generated bytes are waived after direct
  build/import/hash checks. No claimed behavioral hunk remains unexecuted.
- SUITE: promoted constructor/rebind/exception allocation oracles plus repeated-write and actual
  per-executor secret oracles in `335c0a5bf6dc89bb85a2fb85c18b44c02e10e221`.

Commands: scrubbed cold-clone runtime lib 6/6; full Node browser parity 15/15 plus one intentional
ignore; explicit ignored 4,096-cycle churn 1/1; release `perf_handoff` 2/2; native all-target and
wasm32 test-target strict clippy; format/diff checks; 64 independent-process aligned/DRAM attacks;
unconditional-rebind and fixed-secret sabotage; `make web-build`; cold-clone module import; packed
rr-soft manifest verification, `rr replay -W -a`, and event breakpoints. Submission head
`64c6b24b74dacc3f9a931904abe212e5b8f68cd4`; runtime head
`8ef240df8ee9690a1f7f0a36af99de208ead04bf`.
