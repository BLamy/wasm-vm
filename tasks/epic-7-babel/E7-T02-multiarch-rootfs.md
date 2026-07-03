---
id: E7-T02
epic: 7
title: Multi-arch rootfs — x86_64 loader and libraries alongside the riscv64 userland
priority: 702
status: pending
depends_on: [E7-T01]
estimate: M
capstone: false
---

## Goal
A guest root filesystem that carries an **x86_64 dynamic-linker + core libraries** (the
x86_64 musl or glibc runtime, `ld-linux-x86-64.so.2`, libc, libstdc++, libm, etc.) next to
the native riscv64 userland, so box64 can resolve the shared-library dependencies of real
dynamic x86_64 binaries. Without this, only fully-static x86_64 binaries would run.

## Context
box64 loads an x86_64 ELF, then needs to satisfy its `DT_NEEDED` libraries with *x86_64*
`.so` files (box64 maps and translates them like any other x86 code; it does not use the
riscv64 libc for the guest program). The cleanest source is a Debian/Ubuntu riscv-hosting
setup or an Alpine `x86_64` sysroot mounted under a prefix (e.g. `/opt/x86_64`), with
box64 pointed at it via `BOX64_LD_LIBRARY_PATH` / `BOX64_PATH`. Decide and document: musl vs
glibc for the x86_64 side (glibc is broader-compatible for real-world binaries; musl is
smaller), and how the image stays within the size budget (chunked per E3-T01, x86_64 libs
lazily fetched). This task provisions the libraries and wiring; running a binary is E7-T03.

## Deliverables
- Rootfs build step adding the x86_64 runtime under a documented prefix, with box64 env
  (`BOX64_PATH`, `BOX64_LD_LIBRARY_PATH`) preconfigured in `/etc/box64.conf` / profile.
- A decision record: musl vs glibc for the x86_64 side, with the compatibility/size rationale.
- The x86_64 libraries chunked into the E3 disk-image pipeline (lazy-fetchable, not a blob).

## Acceptance criteria
- [ ] The x86_64 dynamic loader and core libs are present and correct-arch (`file` on each →
      `x86-64`); box64's configured search paths resolve them (`BOX64_LOG=1` shows the libs
      being found and mapped, not "not found").
- [ ] Image size stays within the documented budget; x86_64 libs are lazy chunks, verified by
      a cold boot fetching only what a first x86_64 run needs.

## Adversarial verification
Point box64 at a deliberately missing library and confirm a clear "library not found"
diagnostic (not a silent crash) — then restore it and confirm resolution. Verify no accidental
arch mixing: assert the riscv64 userland still uses riscv64 libs (`ldd /bin/busybox`) while
the x86_64 prefix is entirely x86_64 — a cross-contaminated loader path refutes. Confirm the
size budget on a *cold* profile (fresh cache), not warm.

## Verification log
(empty)
