---
id: E0-T01
epic: 0
title: Scaffold the cargo workspace with no_std-friendly core, wasm wrapper, and native CLI crates
priority: 1
status: verified
depends_on: []
estimate: M
capstone: false
---

## Goal
A three-crate cargo workspace exists and builds on stable Rust for both native and
`wasm32-unknown-unknown`: `crates/core` (`wasm-vm-core`, the emulator, zero web
dependencies, `no_std`-friendly), `crates/wasm` (`wasm-vm-wasm`, the `wasm-bindgen`
boundary), and `crates/cli` (`wasm-vm-cli`, the native runner).

## Context
Architectural bet #2 in `ROADMAP.md`: the core is a pure Rust crate testable natively at
native speed, with everything browser-specific behind the wasm wrapper. Getting the crate
boundaries and feature flags right *now* prevents `web-sys`/`js-sys` types from ever
leaking into the core. Every later Epic 0 task lands inside this skeleton.

## Deliverables
- Workspace `Cargo.toml` (`resolver = "2"`), `rust-toolchain.toml` pinning a stable version.
- `crates/core`: `#![cfg_attr(not(feature = "std"), no_std)]`, `extern crate alloc`,
  `std` as a default feature; placeholder `Machine::new(ram_bytes: usize)` and `version()`.
- `crates/wasm`: `crate-type = ["cdylib", "rlib"]`, depends on `wasm-bindgen` and core only.
- `crates/cli`: binary crate using `clap` (derive), calls `wasm-vm-core::version()`.
- `.gitignore` covering `target/`, `pkg/`, `node_modules/`.

## Acceptance criteria
- [ ] `cargo build --workspace` and `cargo test --workspace` succeed on a cold clone.
- [ ] `cargo build -p wasm-vm-core --no-default-features` succeeds (proves no_std+alloc).
- [ ] `cargo build -p wasm-vm-core --no-default-features --target wasm32-unknown-unknown` succeeds.
- [ ] `cargo build -p wasm-vm-wasm --target wasm32-unknown-unknown` succeeds.
- [ ] `cargo tree -p wasm-vm-core -e normal` contains no `wasm-bindgen`, `js-sys`, or `web-sys`.
- [ ] `cargo fmt --check` and `cargo clippy --workspace --all-targets -- -D warnings` are clean.

## Adversarial verification
Clone into a fresh directory (no `~/.cargo` reuse assumptions beyond crates.io) and run
every acceptance command from that cold clone. Attack angles: (1) run
`cargo tree -p wasm-vm-core -e normal,build` and refute if any web/js crate appears even
as a build dep; (2) grep `crates/core/src` for `std::` — any hit not behind
`#[cfg(feature = "std")]` that breaks the `--no-default-features` build is a refutation
(prove it by building); (3) delete `Cargo.lock` and rebuild — a version-resolution failure
refutes the pin story; (4) confirm `rust-toolchain.toml` is honored via `rustup show
active-toolchain` inside the repo; (5) build on macOS *and* Linux (or the T13 Docker image)
— platform-specific breakage refutes.

## Verification log

### 2026-07-02 — worker claim — commit c38ee3f (branch task/e0-t01-cargo-workspace)
Three-crate workspace scaffolded per deliverables. Commands run, all green:
`cargo fmt --all --check` · `cargo clippy --workspace --all-targets -- -D warnings` ·
`cargo build --workspace` · `cargo test --workspace` (3 tests in core) ·
`cargo build -p wasm-vm-core --no-default-features` (native + wasm32) ·
`cargo build -p wasm-vm-wasm --target wasm32-unknown-unknown` ·
`cargo tree -p wasm-vm-core -e normal,build` → core has zero dependencies ·
`cargo run -p wasm-vm-cli -- --ram-bytes 1048576` prints version + RAM size.
Toolchain pin exercised for real: first build downloaded 1.96.0 + wasm32 target via
rust-toolchain.toml. Evidence layer: deterministic test output only (early Epic 0 — no
guest trace infra yet, rr unavailable on this macOS host per AGENTS.md platform table).

### 2026-07-02 — adversarial verifier (fresh session) — VERDICT: verified
- P1 workspace build+test — HELD. Predicted exit 0 with exactly 3 passing tests in wasm-vm-core, 0 elsewhere; observed exactly that (cargo build --workspace; cargo test --workspace: "3 passed; 0 failed; 0 ignored", four other suites "0 passed; 0 failed").
- P2 core no_std native — HELD. Predicted exit 0; observed Finished, exit 0 (cargo build -p wasm-vm-core --no-default-features).
- P3 core no_std wasm32 — HELD. Predicted exit 0; observed exit 0 (cargo build -p wasm-vm-core --no-default-features --target wasm32-unknown-unknown).
- P4 wasm crate wasm32 — HELD. Predicted exit 0 + cdylib artifact; observed exit 0 and target/wasm32-unknown-unknown/debug/wasm_vm_wasm.wasm (2,696,638 bytes).
- P5 dep-tree purity — HELD. Predicted a single node; observed exactly "wasm-vm-core v0.0.1" with zero deps under both -e normal and -e normal,build — no wasm-bindgen/js-sys/web-sys (task attack 1 included).
- P6 fmt+clippy — HELD. Predicted clean; observed fmt exit 0, clippy --workspace --all-targets -- -D warnings exit 0.
- P7 std:: grep (task attack 2) — HELD. Predicted zero hits; observed grep -rn "std::" crates/core/src exit 1 (no matches).
- P8 lockfile deletion (task attack 3) — HELD. Predicted successful re-resolution; observed rebuild exit 0 and the regenerated Cargo.lock byte-identical to the committed one (git diff empty) — pin story exact, not just compatible.
- P9 toolchain pin (task attack 4) — HELD. Predicted 1.96.0; observed "1.96.0-aarch64-apple-darwin (overridden by <clone>/rust-toolchain.toml)"; rustc/cargo both 1.96.0.
- P10 CLI flow-through — HELD. Predicted --ram-bytes reaches Machine::new; observed "machine up with 4096 / 0 / 8388608 bytes" for those flags and 134217728 for the default (cargo run -p wasm-vm-cli).
- P11 .gitignore deliverable — HELD with nuance. Pre-existing line is root-anchored "/target" not "target/"; git check-ignore confirms target/ and target/debug/wasm-vm ignored, pkg/ and node_modules/ ignored, and git status --porcelain is empty after all builds. Substance holds; not raisable.
- P12 Linux build (task attack 5) — HELD, NOT SKIPPED. rust:1.96-slim (aarch64-linux) container over the read-only clone: pin honored ("1.96.0-aarch64-unknown-linux-gnu"), workspace build exit 0, same 3 tests pass, core no_std wasm32 build exit 0.
- rr — SKIPPED: host is macOS and rr needs Linux PMU access (unavailable natively and in Docker Desktop on Apple Silicon per AGENTS.md platform table). Mitigation: deterministic cargo test output is the sanctioned evidence layer for early Epic 0; rr arrives with Linux CI in E0-T02.
- COVERAGE: Cargo.toml/Cargo.lock/rust-toolchain.toml — exercised by every acceptance command plus attacks 3/4. crates/core/Cargo.toml — builds + tree audits + S1. crates/core/src/lib.rs — fully executed: Machine::new/ram_len/version via tests and 4 CLI runs; the no_std attribute via P2/P3. crates/cli/* — executed via P10. crates/wasm/Cargo.toml — P4 + N1. crates/wasm/src/lib.rs — WAIVED: compiled on native (P1) and wasm32 (P4) but bodies never executed — they are 1-line delegations to natively-executed core code, no JS test runner exists at this task, and N2 confirms the exports are physically in the artifact; demand a wasm-bindgen-test smoke once the JS harness lands.
- SABOTAGE: (S1) smuggled wasm-bindgen = "0.2" into core's [dependencies] → cargo tree -e normal immediately lists wasm-bindgen v0.2.126, gate red; (S2) unguarded std::string::String in core → --no-default-features build fails E0433 "cannot find module or crate `std`", gate red; (S3) Machine::new allocating ram_bytes/2 → machine_allocates_requested_ram FAILED at lib.rs:57, gate red. All reverted; clone pristine after.
- MOCK HUNT: version_matches_manifest's first assertion is self-licking — version() is literally env!("CARGO_PKG_VERSION") compared against the same macro; it can never fail. Not a refutation (build-level criteria unaffected; the other two tests are real and sabotage-proven) but flagged for SUITE. No seeded RNG, no cfg(test) semantic leaks, no env dependence: scrubbed-env cold clone and a fresh Linux container both green.
- NOVEL: (N1) cargo tree -p wasm-vm-wasm --depth 1 --target wasm32-unknown-unknown → direct deps are exactly wasm-vm-core + wasm-bindgen, and core resolves with features=[] inside the wasm build, i.e. the browser path really ships no_std core (stronger than the criteria demand). (N2) strings on the built cdylib → version, wasmmachine_new, wasmmachine_ramLen, wasmmachine_free all present: the bindgen surface exists in the shipped artifact, not just in source.
- SUITE: promote machine_allocates_requested_ram and machine_tolerates_zero_ram as-is (sabotage-verified). Rework version_matches_manifest — assert against the literal "0.0.1" (or drop the tautological half, keep !is_empty). Promote the dep-purity audit (cargo tree -p wasm-vm-core -e normal,build | grep -E "wasm-bindgen|js-sys|web-sys" must be empty) into E0-T25's make verify — it fired instantly under S1. Discard nothing.
Commands: git clone --branch task/e0-t01-cargo-workspace (cold clone, env scrubbed of RUSTFLAGS/RUST_LOG/CARGO_*); rustup show active-toolchain; cargo build --workspace; cargo test --workspace; cargo build -p wasm-vm-core --no-default-features [--target wasm32-unknown-unknown]; cargo build -p wasm-vm-wasm --target wasm32-unknown-unknown; cargo tree -p wasm-vm-core -e normal | -e normal,build; cargo fmt --all --check; cargo clippy --workspace --all-targets -- -D warnings; grep -rn "std::" crates/core/src; rm Cargo.lock && cargo build --workspace; cargo run -p wasm-vm-cli -- --ram-bytes {4096,0,8388608,default}; git check-ignore -v; docker run rust:1.96-slim (build+test+wasm32); 3x sabotage+revert; cargo tree -p wasm-vm-wasm --depth 1 --target wasm32-unknown-unknown; strings wasm_vm_wasm.wasm

### 2026-07-02 — post-verdict suite rework (worker)
Applied the verifier's SUITE recommendation: version_matches_manifest now asserts the
golden literal "0.0.1" instead of the tautological env! self-comparison. Gates re-earned
after the change: fmt + clippy + cargo test --workspace re-run green (see PR).
