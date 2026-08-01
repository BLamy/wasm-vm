---
id: E1-T29
epic: 1
title: "glibc riscv64 binaries SIGILL in-guest — execute-path gap (not a decoder gap)"
priority: 229
status: pending
depends_on: [E1-T28]
estimate: M
risk: medium
capstone: false
---

## Goal
Make **glibc/Debian** riscv64 userland run in the interpreted guest. Today musl/Alpine binaries
run perfectly, but stock Docker Hub riscv64 images (which are glibc) die with `Illegal instruction`
(SIGILL) the moment their `ld-linux-riscv64-lp64d.so.1` / `libc.so.6` starts. Fixing this unlocks
running the vast majority of off-the-shelf container images (E3.5/E3.6), not just Alpine-sourced ones.

## Context — investigation already done (2026-08-01, during E3.5-T05d)
The E3.5-T05d RUN-gate (`crates/cli/tests/boot_bake_gate.rs`) proved: `wvrun run` of Alpine (musl)
bundles succeeds (`echo` marker returns), while Docker Hub busybox/memcached/caddy (all **glibc**,
`Requesting program interpreter: /lib/ld-linux-riscv64-lp64d.so.1`) → **`Illegal instruction`**.

Ruled OUT — **it is NOT a missing ISA extension / decoder gap.** `crates/core/tests/isa_scan.rs`
fed every instruction in busybox, `ld-linux-riscv64`, and `libc.so.6` `.text` through the
interpreter's own `decode()` / `expand_c()`: **100% decode, zero undecodable opcodes** (only
`0x0000` padding). The busybox `Tag_RISCV_arch` is plain `rv64gc` (i/m/a/f/d/c + zicsr/zifencei),
no exotic extension.

So the SIGILL is a **decoded-but-execute-REJECTED** instruction on a glibc-specific code path.
Prime suspect: the FP-state gate in `crates/core/src/hart/mod.rs:816` — every F/D instruction traps
`IllegalInstruction` when `mstatus.FS == Off`, relying on the guest kernel to lazily enable FP and
re-execute. glibc's `ld.so` uses FP (lp64d) earlier/differently than musl, likely exposing a gap in
that lazy-enable handshake (or a `sstatus.FS` dirty-tracking / trap-and-retry issue). Secondary
suspect: an unimplemented CSR read (`csr.rs:950`) that glibc issues and musl does not.

## Acceptance criteria
- [ ] The exact faulting (PC, instruction, trap cause) is captured at runtime — instrument the
      core trap path (or a TraceSink hook) to log the escaping/delivered `IllegalInstruction` with
      the raw insn, boot a glibc bundle, and record it. Root cause named.
- [ ] Root cause fixed (likely FP-state lazy-enable, or the missing CSR) with a spec citation; the
      fix does not regress the RISCOF differential suite (E1-T28) or Alpine boot (E2-T19).
- [ ] `wvrun run /opt/containers/<glibc-image> -- <smoke>` runs a stock Docker Hub glibc riscv64
      image (e.g. `busybox:latest`, `redis:latest`) to real output in-guest — recorded.
- [ ] A regression test asserts a minimal glibc riscv64 binary runs (or the FP-state/CSR unit case).

## Adversarial verification
Confirm the fix is the real cause, not a mask: with the fix reverted the glibc bundle SIGILLs; with
it, it runs. Prove no regression: RISCOF differential still 0-fail, Alpine boots 3× (E2-T19 harness).
If the cause is FP-state, add a unit test that executes an FP op with `mstatus.FS=Off` and asserts
the trap+re-enable path matches the spec (Priv §3.1.6 FS field).

## Verification log
_(none yet — investigation recorded in Context; capture + fix pending)_
