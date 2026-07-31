---
id: E2-T26a
epic: 2
title: "xv6-riscv boots to a $ shell in the browser (descoped follow-up from E2-T26)"
priority: 227
status: cancelled
depends_on: [E2-T26]
estimate: M
capstone: false
---

## CANCELLED (Brett 2026-07-31) — off the critical path to Docker-in-the-browser

xv6-riscv is a teaching kernel with **no Linux container substrate** — no namespaces, cgroups,
overlayfs, `pivot_root`, seccomp, or capabilities — so it can never run OCI/Docker workloads,
which are the project's goal. Its faster boot is irrelevant: CPU-layer optimizations (JIT, etc.)
speed up *every* guest equally, and a fast boot of a non-container-capable OS yields nothing.
The real "faster than Alpine while still Docker-capable" lever is a stripped-down **Linux**
(minimal kernel config + musl userland + lean init), not xv6. Cancelled rather than deferred.

## Goal
Boot **xv6-riscv** (the teaching OS) to its `$` shell in the browser tab and run `ls`, as a
second, minimal-guest capstone alongside the full-OS Alpine proof. Split out of E2-T26 on
2026-07-31 (Brett) so it no longer blocks the flagship Alpine-in-browser capstone, which is
verified.

## Context
xv6-riscv is a bare-metal riscv64 kernel — it is NOT Linux, so it exercises a different guest
surface (its own trap/UART/virtio-blk assumptions) than the Alpine path. It needs its own
kernel + fs.img artifact in `releases/` (none exists yet) and a browser boot path that can
load a bare-metal image (Layer A + minimal Layer B), distinct from `WasmLinux.newDisk`.

## Acceptance criteria
- [ ] An xv6-riscv kernel + fs.img artifact is built and pinned under `releases/` (documented,
      content-hashed like the Linux artifacts).
- [ ] Fresh clone + documented commands → the browser boots xv6-riscv to its `$` shell and
      `ls` lists the expected files, captured in a recorded transcript/screenshot.
- [ ] The bare-metal browser boot path is covered by an automated e2e (Playwright) that asserts
      the `$` prompt and `ls` output.

## Verification log
_(none yet — pending)_
