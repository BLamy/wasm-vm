---
id: E4-T30
epic: 4
title: Predecode entry-hit reuse and production fast-interpreter mode
priority: 430
status: implemented
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
