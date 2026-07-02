---
id: E6-T22
epic: 6
title: Developer image — rustc, cargo, clang, git preinstalled with vendored crates
priority: 622
status: pending
depends_on: [E5]
estimate: L
capstone: false
---

## Goal
A purpose-built Alpine riscv64 disk image with the complete toolchain to build wasm-vm
inside the guest — rustc/cargo (with wasm32 std), clang/lld, git, make, wasm-bindgen-cli
— plus the repo's entire crate graph vendored for fully offline builds, sized and
chunk-streamed realistically for browser delivery.

## Context
This image is the launchpad for the self-hosting arc (T23/T24/T28), so every toolchain
gap gets resolved *here*, at image-build time under QEMU, not discovered in-guest at
1/10 speed. Toolchain reality on Alpine riscv64 (musl): `apk add rust cargo` gives a
native rustc; wasm32-unknown-unknown std comes from Alpine's `rust-wasm` package —
*verify it exists for riscv64 in the pinned release*; fallbacks, in preference order:
vendor the wasm32 std from another arch's rust-wasm (target std is host-independent —
validate it actually links), or `rust-src` + `cargo -Zbuild-std` (nightly-only — record
implications). wasm-bindgen-cli must *run on riscv64*: build it from source during image
prep, pinned to the exact wasm-bindgen version in the core crate's lockfile — CLI/crate
version skew is a hard failure by design. Vendoring: `cargo vendor` the full workspace
into `/opt/wasm-vm/vendor` with a committed `.cargo/config.toml` (`replace-with =
"vendored-sources"`, `offline = true`); the registry index must never be needed. Sizing:
≤ 4 GiB expanded ext4, ≤ 1.3 GiB compressed chunks over the Epic 3 streaming path;
document what was cut (docs, LLVM static libs, duplicate toolchains).

## Deliverables
- `images/dev/`: reproducible image build script (Dockerfile or alpine-make-rootfs based,
  runnable in CI under qemu-user emulation), pinned Alpine release + apk versions,
  ext4 output + chunk manifest for streaming.
- wasm-bindgen-cli riscv64 binary build recipe with version pin check (`wasm-bindgen
  --version` gate against the lockfile at image build).
- Vendored crate tree + cargo config; an image-build-time smoke test compiling a hello
  crate natively and for wasm32 with networking disabled.
- `docs/dev-image.md`: contents manifest, size accounting table, gap log (every
  workaround taken, e.g. build-std, with rationale), rebuild instructions.

## Acceptance criteria
- [ ] In QEMU riscv64 (fast reference environment), the image boots and `rustc
      --version`, `cargo --version`, `clang --version`, `git --version`,
      `wasm-bindgen --version` all succeed; wasm-bindgen version matches the lockfile.
- [ ] With the network device *absent*, `cargo build` of a test crate depending on ≥5
      of wasm-vm's heaviest deps succeeds natively and with
      `--target wasm32-unknown-unknown` (proving vendor completeness and wasm32 std).
- [ ] Compressed chunk total ≤ 1.3 GiB; the image cold-streams into the browser VM and
      reaches a login prompt (JIT on) in < 60 s on the reference connection.
- [ ] Image build script runs in CI from a clean checkout and produces a bit-identical
      chunk manifest on consecutive runs (reproducibility within documented exceptions,
      e.g. timestamps normalized).
- [ ] `cc hello.c`, `make`, and `git clone` of a local bare repo all work in-guest.

## Adversarial verification
Attack vendor completeness with cold caches: in the guest with no network, delete
`~/.cargo` and `target/`, then build the *actual wasm-vm workspace* (via 9p, not the
test crate) — any `failed to load source for dependency` refutes; watch
build-dependencies, proc-macros, and target-gated deps (`getrandom`'s wasm feature,
`web-sys`) that `cargo vendor` only captures with correct flags. Attack the wasm32 std
claim: compile and link a wasm32 crate using HashMap plus `panic = "abort"` profile
overrides — a missing std component or panic-runtime mismatch refutes. Attack version
skew: bump wasm-bindgen in a scratch lockfile and confirm the pinned CLI *refuses*
loudly, per design. Re-run the image build on a different host OS and diff manifests —
undocumented irreproducibility refutes. Boot at 512 MB RAM and run the smoke build: if
it OOMs, the doc must already state the minimum RAM, else refuted for honesty.

## Verification log
(empty)
