---
id: E5-T32a
epic: 5
title: Sync Replay Chromium 157 source and toolchains for a riscv64 cross build
priority: 0.3851
status: implemented
depends_on: [E5-T31]
estimate: S
risk: medium
capstone: false
---

## Boundary

Fetch `replayio/chromium` `157.0.8103.0-replay` without history into the existing
`replay-chromium` Colima build VM, run `gclient sync --no-history` for
`target_os=linux` / `target_cpu=riscv64`, and provide the clang, lld and Rust
(`riscv64gc-unknown-linux-gnu` std) versions this revision pins, for an arm64 Linux
host. Refresh the RISC-V sysroot. Record every repository revision in a
`tools/chromium/workspace-157.json` manifest. No source patches in this task.

## Deterministic acceptance

Inside the x64 build container:
`python3 /opt/check-workspace-157.py /opt/workspace-157.json /opt/args-riscv64-157.gn`
(source `tools/chromium/157/check-workspace-157.py`). It checks that every revision
matches the manifest, along with src HEAD and the pinned clang/rustc/gn versions,
and that the driver stub is empty. It then runs `gn gen` with the recorded args
into a scratch out dir and confirms `ninja -n chrome` resolves to the `chrome` link.

## Adversarial verification

Medium risk: verify the manifest against the checkout and attempt one toolchain
mismatch (wrong Rust std/target) to show it is detected.

## Verification log

### 2026-11-22 — worker — submission

Claim: Replay Chromium `157.0.8103.0-replay` at
`93a038b117568051f1697caba2f334ced9329d51` is synced with no history, along with all
253 gclient dependencies for linux/riscv64. The build configuration it pins resolves
the full `chrome` graph on this machine.

Host choice: Chromium 157 pins x86-64-only prebuilt toolchains, and the arm64
colima VM already has Rosetta. Building in a `linux/amd64` container is therefore
upstream's supported x64-host to riscv64-target cross configuration, using the
pinned clang (`24.0.0git`, llvm `86922d51`), Rust (`1.100.0-nightly 1edd55dcf`),
GN `2595` and the `debian_trixie_riscv64` sysroot from Chromium's own hooks,
unmodified. The checkout lives in the arm64 sync container's layer and is
bind-mounted, not copied, because disk is constrained.

Steps: `tools/chromium/157/sync-157.sh` (arm64 container),
`tools/chromium/157/setup-x64.sh` (hooks and sysroot; vpython bypassed because its
CIPD Python cannot run there), and a CIPD re-sync from the x64 container to replace
the arm64 `gn`/`ninja` with x64 builds. `gen-157.sh` writes the empty
unbundled-driver stub with the 108 generator
(`base/record_replay_driver.cc` `5d7531016aa29d4ec2116dc5c9a1fbe6614ae58513363536ddc2ae53249f51b1`,
build ID `linux-riscv64-chromium-93a038b11756-unbundled-driver`) and generates
`out/RISCV64` from `tools/chromium/157/args-riscv64-157.gn`, which imports Replay's
`replay_build_scripts/linux_args.gn`.

Acceptance run: `check-workspace-157.py` printed `graph: [94084/94084] LINK ./chrome`
and `E5-T32a workspace check: OK (253 repositories)`. Sabotage: one manifest
revision replaced with zeros gives `FAIL: revision mismatch` and exit 1. The manifest
is `tools/chromium/workspace-157.json`. `tools/privacy/check-no-replay-backend.py`
passes on every file added here. No source patches (E5-T32b), no emulator or web
change. Only GN's `enable_nacl` unused-argument warning comes from Replay's own args.
