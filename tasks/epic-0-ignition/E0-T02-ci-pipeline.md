---
id: E0-T02
epic: 0
title: CI pipeline running rustfmt, clippy, native tests, and the wasm32 build on every push
priority: 2
status: in-progress
depends_on: [E0-T01]
estimate: S
capstone: false
---

## Goal
A GitHub Actions pipeline (plus an identical local `make ci` entry point) that fails the
build on any formatting drift, clippy warning, native test failure, or
`wasm32-unknown-unknown` build breakage — so the native/wasm dual-target invariant is
enforced by a machine, not by discipline.

## Context
The whole Epic 0 thesis is "every bug is observable." A wasm build that silently rots
while everyone develops natively is the classic failure mode of dual-target Rust projects.
CI is also the substrate for the adversarial-verification targets added in E0-T25.

## Deliverables
- `.github/workflows/ci.yml` with jobs: `fmt` (`cargo fmt --all --check`), `clippy`
  (`cargo clippy --workspace --all-targets --all-features -- -D warnings`), `test`
  (`cargo test --workspace`), `wasm` (`cargo build -p wasm-vm-core --no-default-features
  --target wasm32-unknown-unknown` and `wasm-pack build crates/wasm --target web`).
- Toolchain installed via `dtolnay/rust-toolchain` respecting `rust-toolchain.toml`;
  `Swatinem/rust-cache` for caching; wasm target added explicitly.
- A feature-matrix step: `cargo build -p wasm-vm-core` with default, `--no-default-features`,
  and `--all-features`.
- `Makefile` target `ci` that runs the same commands locally in the same order.

## Acceptance criteria
- [ ] CI runs on push and PR and is green on the current main branch.
- [ ] A commit with a rustfmt violation, a clippy warning, or a failing test turns CI red
      (demonstrated once each on a scratch branch; link the red runs).
- [ ] The wasm job fails if `wasm-vm-wasm` stops compiling for `wasm32-unknown-unknown`
      (demonstrated with a scratch commit adding a `std::fs` call to the wasm crate).
- [ ] `make ci` passes locally on a cold clone and runs the identical command set.

## Adversarial verification
Do not trust the green badge. Attack angles: (1) push a scratch branch with a deliberate
clippy lint (`let x = 5; let _ = &x;` style) in *each* of the three crates — any crate that
CI lets slide refutes the `--workspace --all-targets` claim; (2) put a failing
`#[cfg(test)]` test inside `crates/wasm` — confirm the test job compiles wasm-crate tests
natively too; (3) inspect `ci.yml` for `continue-on-error`, `|| true`, or job-level `if:`
guards that could mask failure; (4) run `make ci` on a machine without the wasm target
preinstalled — it must either install it or fail loudly, not skip; (5) confirm cache
poisoning can't fake green: rerun the wasm job with caches disabled.

## Verification log
(empty)
