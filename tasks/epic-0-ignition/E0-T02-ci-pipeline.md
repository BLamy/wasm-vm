---
id: E0-T02
epic: 0
title: CI pipeline running rustfmt, clippy, native tests, and the wasm32 build on every push
priority: 2
status: verified
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

### 2026-07-02 — adversarial verifier (fresh session) — VERDICT: verified
- P1 clippy-workspace-coverage — HELD. Predicted distinct default-on lints in each crate turn the clippy job red with the lint named; observed: core via worker run 28584287682 (needless_return, crates/core), wasm via run 28585027403 ("returning the result of a `let` binding" → crates/wasm/src/lib.rs:40), cli via run 28585027659 on the UNMODIFIED claimed ci.yml ("equality checks against true" → crates/cli/src/main.rs:15, bool_comparison). Design note: lints were placed one-per-run in leaf/root positions because a root-crate clippy error blocks leaf units via dep ordering (reproduced locally) — a naive 3-lints-one-branch attack is inconclusive by construction, not a CI gap.
- P2 wasm-crate-tests-compile-natively — HELD. Predicted test job red naming the probe; observed run 28585027403 test job: `verifier_probe_tests::e0_t02_verifier_wasm_crate_native_test_probe ... FAILED`, panic at crates/wasm/src/lib.rs:47 — `cargo test --workspace` does compile and run wasm-crate tests natively.
- P3 masking-audit (ci.yml + Makefile) — HELD. Predicted and confirmed zero `continue-on-error`, `|| true`, `if:` guards, or `fail-fast: false` in ci.yml; Makefile's only guard (`@command -v wasm-pack`) explicitly exits 1. Matrix fail-fast cancelled sibling legs in run 28585027403 (cancelled, not green) — cancellation can hide a *second* failure but never fakes green. Minor robustness note (no-fire): the sed toolchain-pin read emits empty on a reformatted rust-toolchain.toml, but an empty `toolchain:` input makes dtolnay/rust-toolchain fail loudly, not skip.
- P4 make-ci-without-wasm-toolchain (Linux container) — HELD. Predicted loud failure, never silent skip; observed in rust:1.96-slim (ships ONLY host target, no rustfmt/clippy/wasm-pack — verified against the bare image): rust-toolchain.toml drove rustup to auto-provision 1.96.0 + rustfmt + clippy + wasm32 target, fmt/clippy/test/wasm32-build all ran, then `error: wasm-pack is not installed.` + install instructions, `make: *** [Makefile:23: wasm] Error 1`, MAKE_CI_EXIT=2.
- P5 cache-poisoning — HELD, with one nuance the claim glosses. "Repo's FIRST run" confirmed (full run list: 28584207034 at 10:46:01Z is earliest; attempt=1), but its `features ("")` leg logged "Cache hit ... full match: true" — actions-cache API shows that cache was created at 10:46:22.594Z by the SAME run/ref (sibling matrix leg saving first; all three legs share one rust-cache key). Intra-run, same-commit → not a poisoning vector. Independently re-proven: my run 28585027403 bumped `prefix-key` (verify-e0t02-cold); every job logged "No cache found" and all red/green outcomes held cache-cold.
- P6 make-ci-cold-clone (macOS) — HELD. Predicted exit 0; observed MAKE_CI_EXIT=0 from a pristine clone at cde374e with CARGO_*/RUSTFLAGS/RUST_LOG scrubbed, incl. wasm-pack 0.13.1 building crates/wasm.
- P7 std::fs-finding replication — HELD (worker's finding CONFIRMED). `std::fs::read` call in crates/wasm compiles for wasm32-unknown-unknown (exit 0); `use std::os::unix::io::RawFd` fails on wasm32 (E0433: cannot find `unix` in `os`) and compiles natively — the task's original assumption was indeed false and the worker's substitute breaker is correct.
- rr — SKIPPED (macOS host, no PMU; rr impossible locally). Mitigation: this task creates the Linux CI substrate rr needs; worker's decision to keep rr OUT of ci.yml is sound — the audit confirms ci.yml is genuinely free of the conditional constructs rr wiring would have required.
- COVERAGE: ci.yml — fmt red (28584287918) + green; clippy red (28584287682, 28585027403, 28585027659) + green; test red (28584287849, 28585027403) + green; wasm red at wasm-pack step (28584287981) AND at first cargo-build step (28585027403) + green; features --no-default-features leg red (28585027403, novel) + green; features ""/--all-features legs green-only → WAIVED (same step/recipe as red-proven sibling leg, differing only in a flag); `on: pull_request` trigger never fired (all 12 repo runs are push-event) → needs-evidence-lite: exercised automatically when the stacked PR opens. Makefile — green path (local exit 0) and red path (docker guard exit 2) both exercised; command set verified IDENTICAL to ci.yml line-by-line (fmt/clippy/test byte-identical; features matrix = the 3 Makefile builds; wasm = same 2 commands, differing only in wasm-pack provisioning: CI installs, Makefile checks-and-exits-1 — documented in both files). tasks/ changes waived (bookkeeping).
- MOCK/HONESTY: all 5 claimed runs exist with claimed conclusions AND claimed per-job failure sets (fmt demo also red in clippy — explained: `items after a test module` lint on the appended fn; wasm demo also red in clippy — as disclosed); all 4 demo-commit patches fetched via API match the claim verbatim (RawFd breaker with std::fs caveat documented in the commit itself); dd5314e→cde374e is tasks-only, and cde374e has its own green run 28584424669 (stronger than claimed); the disclosed "four accidental all-green scratch runs" match history exactly (28584267xxx at 10:47:08, superseded 23s later); "green on current main unsatisfiable until merge" is accurate for a stacked branch.
- NOVEL: (1) features-matrix leg discrimination — `#[cfg(not(feature = "std"))] compile_error!` in core (a red demo the worker never did for the features job): predicted and observed ONLY the --no-default-features leg + the wasm job's first step red, ""/--all-features legs not-failed (run 28585027403) — the matrix genuinely distinguishes feature configurations, and feature unification (`--workspace --all-features` turns core's std on; `-p wasm-vm-wasm` alone does not, since the workspace dep pins default-features=false) behaves exactly as the pipeline assumes. (2) Cache-origin forensics via the actions-cache API (created_at + ref per cache) to adjudicate the first-run claim instead of trusting logs. (3) Container attack run against an image with NO rustfmt/clippy either — stronger than the task's "no wasm target" framing.
- SUITE: promote (recommendation for E0-T25) — a `make verify-ci-parity` script asserting the Makefile and ci.yml command sets are identical; today that invariant is comment-enforced only. rework — none. discard — all four probe edits (deliberate-red code cannot live green in the tree; the two runs are the permanent artifact). Scratch branches verify/e0-t02-clippy-3crates and verify/e0-t02-clippy-cli deleted from GitHub and locally (branch list re-checked: none remain); runs persist.
Commands: gh run view {28584207034,28584287918,28584287682,28584287849,28584287981,28585027403,28585027659} -R BLamy/wasm-vm --json conclusion,jobs / --log(-failed); gh api repos/BLamy/wasm-vm/commits/<demo-sha>; gh api repos/BLamy/wasm-vm/actions/caches; gh run list -R BLamy/wasm-vm -L 100 (chronological + event census); local: cargo clippy --workspace --all-targets --all-features -- -D warnings; cargo build -p wasm-vm-core --no-default-features [--target wasm32-unknown-unknown]; make ci (scrubbed env, exit 0); docker run rust:1.96-slim ... make ci (exit 2). Probe runs: 28585027403, 28585027659 — worker runs: 28584207034, 28584287918, 28584287682, 28584287849, 28584287981, 28584424669.
