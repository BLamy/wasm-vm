---
id: E5-T32
epic: 5
title: Replay Chrome 157 for riscv64, unbundled driver, client-shippable (planning parent)
priority: 0.385
status: cancelled
depends_on: [E5-T31]
estimate: L
risk: high
capstone: false
---

User request (2026-11-22): build Replay Chrome 157 (`replayio/chromium`
`157.0.8103.0-replay`, head `93a038b117568051f1697caba2f334ced9329d51` on
2026-11-17) for riscv64 Linux in the most optimized way, to ship to the client
with no backend `src/cpp` material (E5-T31). Split into:

- E5-T32a — shallow source sync, Chromium-pinned clang/rust host toolchains for the
  arm64 build VM, RISC-V sysroot refresh, workspace manifest (risk medium).
- E5-T32b — port and build `chrome` 157 for riscv64 (rv64gc, LP64D), unbundled driver,
  optimized release (`is_official_build`-class flags, ThinLTO where the linker fits
  in RAM), privacy-scanned, QEMU smoke (risk high: sandbox is a security boundary).

Disk constraint recorded 2026-11-22: the Mac has ~85 GiB free and the build VM
~70 GiB free; use a no-history checkout and drop the 108 `out/` only after the
E0-T34 archival record is confirmed sufficient.
