---
id: E4-T37
epic: 4
title: Bounded multi-target JALR return PIC
priority: 437
status: verified
depends_on: [E4-T35]
estimate: S
risk: high
capstone: false
---

## Goal

Replace one-entry monomorphic return behavior with a bounded two- or four-target PIC and explicit
hysteresis while keeping target authority validation in generated code.

## Acceptance criteria

- Fresh Node telemetry reports attempts, hits, refusals, retargets, live entries, and installs.
- Retarget bursts do not repeatedly arm/tear down dispatchers, and live state plateaus.
- Precise traps, interrupts, SMC, and checksum output remain identical to the interpreter.

## Adversarial verification

Alternate four return addresses, inject a target permission/PA mismatch, exhaust fuel at the target,
and invalidate one target while another remains hot. No stale call-indirect target may execute.

## Verification log

### 2026-09-03 — verifier — VERDICT: verified

- Bounded multi-target coverage — HELD. Predicted four distinct compiled JALR targets hashing to
  one set would remain live simultaneously, while a fifth target would not replace a way after one
  observation and would replace exactly one LRU way after the second. The fresh Node parity run
  observed `live_entries=4`, `installs=4`, then `live_entries=4`, `installs=5`, `retargets=1`.
- Generated authority — HELD. Predicted a live key/table-index pair with a corrupted expected
  host-page word would refuse before entering the target. `browser_inline_dynamic_jalr_links_switch_and_unlinks`
  observed the caller-only two-instruction exit and an unchanged target register.
- Safety/parity — HELD. Predicted target fuel exhaustion, one-target invalidation with a hot
  sibling, stale-target lookup, and whole-cache reset would preserve precise caller retirement and
  never call an invalid target. The same Node run held all assertions; the existing core, translator,
  wrapper, SMC, interrupt, and checksum suites remained green.
- Telemetry/coverage — HELD. Predicted generated probes would report attempts, hits, refusals,
  retargets, live entries, and installs, and the wrapper would expose all six `jitStats` fields. The
  fresh Node runs asserted those counters and field names; the changed Rust cache, translator,
  ABI, wrapper, tests, roadmap, and generated dist hunks were exercised or are declarative wiring.
- SUITE: promoted the four-way/hysteresis, fuel, invalidation, authority-mismatch, stale-target,
  reset, and telemetry assertions in `crates/wasm/tests/jit_browser_parity.rs` and
  `crates/wasm/tests/wrapper.rs`; evidence: `evidence/e4-t37/README.md`.

Commit: `e1a1be2`.

Commands: `cargo fmt --check`; `cargo clippy -p wasm-vm-core -p wasm-vm-jit-translate -- -D warnings`;
`cargo clippy -p wasm-vm-wasm --target wasm32-unknown-unknown -- -D warnings`;
`cargo check -p wasm-vm-wasm --target wasm32-unknown-unknown`; `cargo test -p wasm-vm-core`;
`cargo test -p wasm-vm-jit-translate`; `wasm-pack test --node crates/wasm --test jit_browser_parity`
(`34 passed, 0 failed, 1 ignored`); `wasm-pack test --node crates/wasm --test wrapper`
(`9 passed, 0 failed`); `make web-dist`.
