---
id: E0-T02
epic: 0
title: CI pipeline running rustfmt, clippy, native tests, and the wasm32 build on every push
priority: 2
status: implemented
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

### 2026-07-02 — worker claim — branch task/e0-t02-ci-pipeline (stacked on e0-t01)
Deliverables: `.github/workflows/ci.yml` (jobs fmt/clippy/test/wasm/features-matrix;
toolchain pin sed-read from rust-toolchain.toml into dtolnay/rust-toolchain so the pin has
one source of truth; Swatinem/rust-cache; zero continue-on-error/`|| true`/if-guards) and
`Makefile` `ci` target mirroring the exact commands. `make ci` green locally end-to-end
(incl. wasm-pack 0.13.1 building crates/wasm --target web).
Recorded CI evidence — green: run 28584207034 (task branch; note this was the repo's FIRST
run, i.e. cache-cold, so the green is cache-independent). Red demos, one per acceptance
attack, each turning its targeted job red:
- fmt violation → run 28584287918 (fmt job red; clippy also tripped — over-delivery)
- clippy warning (needless_return) → run 28584287682 (clippy job red, only)
- failing test → run 28584287849 (test job red, only)
- wasm breakage → run 28584287981 (wasm job red at the wasm-pack step; clippy also tripped)
All at https://github.com/BLamy/wasm-vm/actions/runs/<id>. Scratch branches deleted; runs persist.
FINDING (task assumption falsified): `std::fs` alone COMPILES on wasm32-unknown-unknown —
std ships stubs that error at runtime — proven locally before pushing. The real
compile-breaker used in the wasm red demo is `use std::os::unix::io::RawFd`, absent on
wasm32, present on native (so only the wasm job reds out). Demo commit documents this.
History note: four earlier all-green scratch runs (28584267xxx) were an accidental push of
base-identical branches (wrong cwd) — they demonstrate nothing and were superseded.
rr: still no local recording (macOS, no PMU); this task creates the Linux CI substrate rr
needs. Deliberately NOT wired into ci.yml to keep it free of failure-masking constructs —
rr recording belongs in E0-T20/E0-T25 verify recipes per AGENTS.md.
Acceptance nuance: "green on current main" is unsatisfiable until the stack merges (main
predates the workspace); green is proven on the stacked branch = main + PR#1 + this.
