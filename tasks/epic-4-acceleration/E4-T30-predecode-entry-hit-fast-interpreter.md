---
id: E4-T30
epic: 4
title: Predecode entry-hit reuse and production fast-interpreter mode
priority: 430
status: verified
depends_on: [E1]
estimate: S
risk: high
capstone: false
---

## Goal

Turn the existing predecoded block cache into an actual hot-loop acceleration: a repeated
physical entry PC reuses its decoded block instead of decoding, allocating, walking, and
reinserting that block on every branch. Once the regression is removed, make block caching plus
bounded interrupt batching the browser Linux interpreter's default, with an explicit A/B escape
hatch.

## Acceptance criteria

- A deterministic loop test proves one block build followed by entry hits while JIT discovery still
  counts every block entry.
- The release pure-ALU microbenchmark with the production cache + bounded-batching mode is at least
  1.5x its pre-fix cache-only result, does not trail cache-off legacy mode on the same binary, and
  stays above the committed performance floor.
- PMP execute permission, paging aliases, SMC/DMA invalidation, `fence.i`, pathological one-entry
  eviction, and cache-on/off retire traces remain correct.
- Browser Linux enables the proven cache + <=128-retire interrupt batching by default; a query option
  can force the legacy interpreter for differential diagnosis.
- Native tests, wasm32 build, format, and clippy remain green.

## Adversarial verification

Predict then attack: revoke execute permission after a cached hit; execute one physical page through
two virtual aliases; patch a cached instruction with a guest store and DMA; use a one-entry cache;
and sabotage the hit path so discovery is not incremented. Any stale instruction, skipped fault,
trace divergence, or JIT threshold that never fires refutes the change.

## Verification log

### 2026-08-09 — worker — implemented `c648468`

- PERF: the paired release differential measured legacy `44.7 MIPS` versus production fast mode
  `70.4 MIPS` (`1.57x`); the independent pre-fix cache-on measurement was `5.7 MIPS`, making the
  final production mode `12.35x` that result. The committed absolute smoke floor passed at
  `44.8 MIPS >= 15`.
- CORRECTNESS: `cargo test -p wasm-vm-core` passed the full non-ignored matrix. The focused cache,
  PMP, virtual-alias, SMC/DMA, one-entry-eviction, RISC-V corpus, batching, and mid-block external
  write attacks passed under `hotness_discovery`, `pmp`, `predecode_diff`,
  `predecode_smc_diff`, `predecode_batching`, and `predecode_entry_safety`.
- BUILD: `cargo fmt --all -- --check`, strict all-target clippy for core + wasm, the wasm32 release
  build, and `make web-build` passed. The pre-commit hook rebuilt and staged `web/dist`.
- BROWSER: a fresh-origin final bundle at
  `http://127.0.0.1:8129/?guest=busybox&nosw&jit=0&worker=0` reported
  `data-interpreter=fast`, restored the real BusyBox guest to `~ #`, and showed `guest ready` with
  zero console errors/warnings. `?slowInterp=1` reported `data-interpreter=legacy`.
- EVIDENCE: `evidence/e4-t30/README.md`, `browser-console.txt`, and
  `browser-fast-interpreter.jpg` (SHA-256
  `37d43d60b89ebfbce995ad7269eb24800be885174ef336de884217c7177bd762`). The recording proves the
  default browser selection and real guest prompt; deterministic native tests cover every changed
  cache/PMP/invalidation path.

### 2026-08-09 — verifier — VERDICT: refuted

- P1 entry reuse + discovery — HELD. Predicted the 210-retire loop would report exactly 108 entry
  hits / 2 builds while nominating the hot loop once; the focused exact-head run passed
  `hotness_discovery` 3/3, including that accounting. The full focused command also passed
  `boot_contract`, `pmp`, `predecode_batching`, `predecode_diff`, `predecode_entry_safety`, and
  `predecode_smc_diff`: 26 passed, 0 failed, 1 environment-gated OpenSBI test ignored.
- P2 effective PMP permission across privilege transition — FAILED. Predicted that code decoded and
  cached in M-mode under an *unlocked* TOR region would still raise `InstrAccessFault` when the same
  physical block was re-entered in S-mode and its interior region lacked X. In a scrubbed cold clone
  of exact head `df14e18`, the cache-off oracle trapped at `0x80000004`, but cache-on returned
  `MaxInstrs` with `x5=1`, **`x6=1`**, and `pc=0x80000008`: the S-mode-denied interior instruction
  retired. `sync_pmp_code_permissions` keys validity only to PMP CSR revision
  (`crates/core/src/lib.rs:644-662`), which is unchanged by M→S; the entry path validates only the
  first parcel and the cursor then replays interior ops without fetch/PMP checks
  (`crates/core/src/lib.rs:2359-2394`). Unlocked PMP explicitly bypasses checks in M but not S
  (`crates/core/src/pmp.rs:212-238`). Demand: include effective fetch privilege in cache permission
  validity (or otherwise revalidate/flush before reuse), promote this regression, and re-record.
- COLD/RECHECK: retained verifier harness
  `/private/tmp/e4-t30-verify.hs5ShL/repo/crates/core/tests/e4t30_verifier_pmp_mode.rs`
  (SHA-256 `2482ca060379e69f7aeb17dee6fd21d5dbd0d6d668e515ff074c6d5c0aedef55`). With
  `RUST_LOG`, `RUSTFLAGS`, `CARGO_TARGET_DIR`, and `CARGO_BUILD_TARGET` unset, the cache-off oracle
  passed in 0.04s; the cache-on attack failed identically twice, the final run printing
  `cached outcome=MaxInstrs x5=1 x6=1 pc=0x80000008` before failing in 0.04s.
- COVERAGE/SUITE: performance, wasm/browser promotion, and remaining changed-hunk coverage were not
  adjudicated after the architectural/security refutation. No verifier test is promoted into the
  green suite until the runtime defect is fixed; the retained cold-clone harness is the exact
  regression to promote in the repair.

Commands: `cargo test -p wasm-vm-core --test hotness_discovery --test boot_contract --test pmp
--test predecode_diff --test predecode_smc_diff --test predecode_batching --test
predecode_entry_safety`; `env -u RUST_LOG -u RUSTFLAGS -u CARGO_TARGET_DIR -u CARGO_BUILD_TARGET
cargo test -p wasm-vm-core --test e4t30_verifier_pmp_mode
legacy_path_traps_at_s_mode_interior_pmp_permission -- --exact --nocapture`; same command with
`cached_m_mode_block_rechecks_s_mode_interior_pmp_permission` (failed as predicted).

### 2026-08-09 — worker — repair implemented `b392b88`

- REFUTATION FIX: decoded/compiled cache permission validity now keys on both the effective PMP
  revision and current privilege. An M→S/U transition flushes the cache and live cursor before
  reuse, closing the unlocked-PMP bypass without adding per-instruction permission walks.
- PROMOTED ATTACK: `privilege_change_invalidates_cached_interior_permission` builds the verifier's
  three-op M-mode block with an S-mode-denied interior instruction, changes no PMP CSR, and proves
  both cache-off and cache-on fault at `0x80000004` with `x6=0`.
- CORRECTNESS: the full `cargo test -p wasm-vm-core` matrix passed, as did the focused seven-target
  cache/PMP/differential suite (including the RISC-V cache and batching corpora).
- PERF: the repaired release differential measured legacy `38.4 MIPS` versus fast `60.2 MIPS`
  (`1.57x`); the absolute smoke gate passed at `38.4 MIPS >= 15`.
- BUILD/BROWSER: format, strict core+wasm clippy, and the wasm32 release build passed. Fresh origin
  `http://127.0.0.1:8130/?guest=busybox&nosw&jit=0&worker=0` reported the fast interpreter,
  restored BusyBox to `~ #` / `guest ready`, and emitted zero console errors or warnings.
- EVIDENCE: updated `evidence/e4-t30/README.md` and `browser-console.txt`; repair screenshot
  `browser-fast-interpreter-repair.jpg` has SHA-256
  `0c40856df721a3ab125f95e650c9e1e8391a155e6fbbcb99dbff76f935a15fbf`.

### 2026-08-09 — verifier — VERDICT: verified

- P1 entry reuse, discovery, invalidation, and differential behavior — HELD (carried forward where
  unchanged). Predicted the repaired mode key would leave the previously verified hot-entry and
  byte-identical paths unchanged; the focused exact-tree matrix passed 28 tests across
  `hotness_discovery`, `boot_contract`, `pmp`, `predecode_batching`, `predecode_diff`,
  `predecode_entry_safety`, and `predecode_smc_diff` (one artifact-gated OpenSBI case ignored).
- P2 unlocked-PMP M→S repair — HELD. Predicted both cache-off and cache-on would retire the permitted
  entry (`x5=1`), reject the cached interior (`x6=0`), and report `InstrAccessFault` at
  `DRAM_BASE+4`; the promoted `privilege_change_invalidates_cached_interior_permission` passed in
  the working tree and again from scrubbed cold clone
  `/private/tmp/e4t30-reverify.VvrBbO/repo` at exact head `259c851`.
- P3 novel in-run privilege transition — HELD. Predicted a guest `mret` from M to S would terminate
  its decoded block, make the following boundary observe S-mode, and flush before reusing an
  M-mode-prewarmed successor. The verifier-promoted
  `guest_mret_invalidates_cached_interior_permission_before_successor` passed with S-mode selected,
  `x5=1`, `x6=0`, and a precise fault at the denied successor interior.
- PERF — HELD. The independent paired release rerun measured legacy `31.9 MIPS` versus fast
  `49.3 MIPS` (`1.55x`), while the absolute smoke rerun measured `33.4 MIPS >= 15`; the extra mode
  comparison did not erase the submitted acceleration.
- BUILD — HELD. `cargo fmt --all -- --check`, strict all-target core+wasm clippy, and the wasm32
  release build passed. The worker browser evidence digest independently matched
  `0c40856df721a3ab125f95e650c9e1e8391a155e6fbbcb99dbff76f935a15fbf`; the browser surface itself
  is unchanged by the runtime-only repair, so its prior fresh-origin result is carried forward.
- COVERAGE: constructor/toggle/resize initialization and the unchanged-mode fast return were
  exercised by the focused matrix; the changed-mode flush/cursor path was exercised by both PMP
  attacks. Restore's assignment is waived as empty-cache bookkeeping (restore already flushes all
  decoded/compiled code, so a different sentinel can only cause one redundant flush). Comments are
  non-executable. SUITE: promoted the guest-`mret` regression into `predecode_entry_safety`.

Commands: `cargo test -p wasm-vm-core --test hotness_discovery --test boot_contract --test pmp
--test predecode_diff --test predecode_smc_diff --test predecode_batching --test
predecode_entry_safety`; `cargo test -p wasm-vm-core --release --test perf_baseline
perf_fast_interpreter_does_not_trail_legacy -- --ignored --exact --nocapture`; same for
`perf_smoke_alu_above_floor`; `cargo fmt --all -- --check`; `cargo clippy -p wasm-vm-core -p
wasm-vm-wasm --all-targets -- -D warnings`; `cargo build -p wasm-vm-wasm
--target wasm32-unknown-unknown --release`; scrubbed cold-clone promoted-test command at `259c851`.
