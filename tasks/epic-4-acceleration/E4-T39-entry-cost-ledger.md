---
id: E4-T39
epic: 4
title: Compiled entry-path cost ledger
priority: 439
status: verified
depends_on: [E4-T35]
estimate: S
risk: high
capstone: false
---

## Goal

Measure the cost of state copy, indirect table dispatch, authority checks, memory-split exits, and
device boundaries separately so future changes target the dominant term.

## Acceptance criteria

- The exact Node run emits bounded counters/timers for each entry-path term and the same checksum.
- The report identifies a dominant term with a reproducible delta; threshold or quantum changes alone
  do not count as a fix.

## Adversarial verification

Run interpreter, JIT, JALR-off, and region-off controls with the same restored image. Reject any
report that lacks a runtime digest, first-command boundary, or exact retired/checksum oracle.

## Verification log

### 2026-09-03 — verifier — VERDICT: verified

- **Exact controls and oracle — HELD.** Predicted interpreter, JIT, JALR-off, and region-off would
  all run the same restored Node image, reach the first-command boundary, and produce the exact
  `node -e 'console.log(3)'` frame. The four Chromium legs all exited `0`, printed `3`, retained
  checksum `ad4b946b14f0c58ad9fba24ba36b8ea60b38dc9f1647a9e45e8296577447e5d5`, and retired
  `243,490,289`–`243,490,303` guest instructions. Each report contains a distinct runtime digest
  and first-command boundary (`18,153.815`–`24,871.235 ms`).
- **Entry-path ledger — HELD.** Predicted the JIT legs would expose bounded state-copy, engine-entry,
  indirect-dispatch, authority-check, memory-split, and device-boundary measurements, with the
  expected zero indirect count when regions are disabled. The exact report records nonzero JIT
  counters/timers for every required term, including `stateCopyCalls`, `stateCopyBytes`,
  `stateCopyNs`, `engineEntryNs`, `indirectTableDispatches`, `authorityChecks`,
  `memorySplitExits`, `deviceBoundaries`, and `deviceBoundaryNs`; the region-off leg records
  `indirectTableDispatches=0`.
- **Reproducible dominant term — HELD.** Predicted one control delta would dominate the measured
  ledger rather than a threshold-only change. The report selects state-copy as dominant: region-off
  adds `30,017,522` state-copy calls (`9,374,888` in that leg), while the next largest deltas are
  authority checks `2,071,801` and indirect dispatches `975,042`. All five term deltas are nonzero.
- **Coverage — HELD.** The four exact browser controls exercised the new Rust ABI counters,
  generated probes, handoff byte accounting, timers, JIT controls, loader query parsing, main-page
  diagnostics, roadmap entry, and deployable wasm/JS output. The core suite passed `175`, the
  translator check passed, and the wasm browser parity suite passed `34` with `1` ignored. The
  generated `web/dist` files were rebuilt from this head.
- **SUITE:** promoted `web/tests/e4-t39-entry-cost-ledger.spec.js` and the exact JSON ledger as the
  repeatable verification artifacts. rr, independent machines, and WebKit were not used per the
  current evidence policy and the user's explicit direction.

Implementation/evidence commit: `e677c7f`.

Evidence: `evidence/e4-t39/entry-cost-ledger-2026-09-03.json` (SHA-256
`9f6b2e2765093c68b444f37b482a62e544c7d480b2d9d2b5a3ff7179d5d9f293`).

Commands: `cargo fmt --all`; `cargo check -p wasm-vm-core --lib`; `cargo check
-p wasm-vm-jit-translate --lib`; `cargo check -p wasm-vm-wasm --target wasm32-unknown-unknown
--lib`; `cargo clippy -p wasm-vm-core --lib -- -D warnings`; `cargo clippy -p wasm-vm-wasm
--target wasm32-unknown-unknown --lib -- -D warnings`; `cargo test -p wasm-vm-core --lib`
(`175 passed`); `cargo test -p wasm-vm-jit-translate --lib`; `wasm-pack test --node crates/wasm
--test jit_browser_parity` (`34 passed, 1 ignored`); `make web-build`; `make web-dist`; the exact
Playwright command in the implementation notes (`1 passed`); `node --check` on the changed
JavaScript files; `python3 tools/check_task_policy.py`; `python3 tools/build_queue.py`; and
`make tasks-json`. The broad all-features workspace clippy remains blocked by pre-existing macOS
`wvseccomp` libc API errors and unrelated dead-code warnings; no T39 source was changed to mask
them.
