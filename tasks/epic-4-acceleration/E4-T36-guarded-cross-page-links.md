---
id: E4-T36
epic: 4
title: Guarded cross-page direct links
priority: 436
status: verified
depends_on: [E4-T35]
estimate: S
risk: high
capstone: false
---

## Goal

Link high-value direct-control-flow edges across physical pages only after authoritative VA+PA
observation and validate the target with the generated EXEC-TLB predicate.

## Acceptance criteria

- Cross-page links preserve checksum, exact retire counts, timer/device boundaries, and SMC removal.
- The fresh Node fixture reaches at least 7.3 logical blocks per engine call without a live-module or
  retranslation storm.

## Adversarial verification

Change the target mapping after publication, invalidate the target page, deny execute permission,
and force a remaining-budget tail at the link boundary. Every refusal must fall back exactly once.

## Verification log

### 2026-09-03 — verifier — VERDICT: verified

- EXEC-TLB authority guard — HELD. Predicted a published cross-page edge would call its target only
  when the target VA tag and generated addend still resolve to the recorded host page. The Node
  parity run observed the guarded edge refusing after a competing VA-to-PA observation changed the
  EXEC-TLB addend, then rearming and executing after the authoritative mapping was restored
  (`browser_inline_static_guard_rejects_remapped_target_page`).
- Invalidation, permission, and budget boundaries — HELD. Predicted target-page invalidation,
  revoked execute permission, and a target tail that exceeds remaining fuel would each return once
  at the caller boundary without entering stale target code. The Node run observed exact caller-only
  retirement and unchanged target registers in
  `browser_inline_static_link_unlinks_and_rearms_after_target_reinstall`,
  `browser_inline_static_link_refuses_after_execute_permission_change`, and
  `browser_inline_static_cross_page_tail_refuses_before_target_entry`.
- Acceptance throughput and parity — HELD. Predicted the fresh Node chain fixture would preserve
  architectural results while reaching at least 7.3 logical blocks per engine call. The warm
  eight-block fixture retired all 16 instructions with `direct_chain_entries >= 8` and
  `direct_chain_links >= 7`; the same run also covered load/store, precise-fault, timer/device
  boundary, and SMC paths.
- Diff coverage — HELD. The changed translator, core publication, PMP revision, browser cache, and
  parity-test paths are exercised by the recorded Node run and the native/wasm target gates listed
  in `evidence/e4-t36/README.md`.
- SUITE: promoted the deterministic Node parity cases and the exact-head evidence record at
  `evidence/e4-t36/README.md`.

Commit: `61a3654`

Evidence: `evidence/e4-t36/README.md`

Commands: `cargo fmt --all --check`; `cargo clippy -p wasm-vm-core -p wasm-vm-jit-translate -- -D warnings`; `cargo clippy --target wasm32-unknown-unknown -p wasm-vm-wasm --lib -- -D warnings`; `cargo check -p wasm-vm-core -p wasm-vm-jit-translate`; `cargo check --target wasm32-unknown-unknown -p wasm-vm-wasm --lib`; `cargo test -p wasm-vm-core`; `cargo test -p wasm-vm-jit-translate`; `wasm-pack test --node crates/wasm --test jit_browser_parity`; `bash tools/build-web-dist.sh`
