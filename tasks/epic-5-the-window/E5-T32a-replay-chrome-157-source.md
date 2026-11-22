---
id: E5-T32a
epic: 5
title: Sync Replay Chromium 157 source and toolchains for a riscv64 cross build
priority: 0.3851
status: in-progress
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

`gn gen out/RISCV64-157` with the recorded args succeeds and
`ninja -C out/RISCV64-157 -n chrome` resolves the full graph, with every revision
matching the manifest.

## Adversarial verification

Medium risk: verify the manifest against the checkout and attempt one toolchain
mismatch (wrong Rust std/target) to show it is detected.

## Verification log

(empty)
