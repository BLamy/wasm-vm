---
id: E0-T01
epic: 0
title: Scaffold the cargo workspace with no_std-friendly core, wasm wrapper, and native CLI crates
priority: 1
status: in-progress
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
(empty)
