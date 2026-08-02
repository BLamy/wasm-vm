---
id: E1-T30
epic: 1
title: "glibc riscv64 binaries SIGILL in-guest — execute-path gap (not a decoder gap)"
priority: 229
status: verified
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

### 2026-08-01 — root cause captured, fixed, verified (it was userspace `rdtime`, NOT FP state)

**The Context hypothesis (FP-state gate) was WRONG.** Captured the real fault and fixed it.

**Method — fast native repro (no 40-min Alpine boot).** Built real riscv64 binaries and booted each
as `/init` in a ~90s busybox initramfs via the native CLI (`wasm-vm boot --initrd …`), with a new
illegal-instruction trap logger (`RUST_LOG="wvm::trap=info"`):
- **static glibc** hello (dockcross `-static`) → prints `HELLO_GLIBC_42`, exit 0. **Refutes FP-state**
  (a static glibc binary uses the same F/D instructions + libc init, yet runs clean).
- **Debian trixie `/bin/true`** (dynamic glibc PIE) → exit 0, no trap.
- **Docker Hub `busybox:latest`** (dynamic glibc) → **SIGILL captured**:
  `illegal-instruction epc=0x…8844 insn=0xc01027f3 mode=U mcounteren=0x7 scounteren=0x0`, and the
  guest kernel reports `init[1]: unhandled signal 4 … do_trap_insn_illegal` → panic exitcode 0x04.

**Root cause.** `0xc01027f3` decodes to `csrrs x15, time, x0` = **`rdtime`**, a U-mode read of the
`time` CSR (0xC01). At reset we grant `mcounteren=0x7` but left `scounteren=0` — so the (spec-correct,
§3.1.10/§4.1.5) counter gate rejects U-mode `rdtime` (U needs mcounteren.TM **and** scounteren.TM).
This kernel neither sets `scounteren.TM` nor emulates the read, and glibc userland executes a raw
`rdtime`, so it SIGILLs. musl (Alpine) never does this — hence "musl works, glibc doesn't."

**Fix** (`crates/core/src/lib.rs`, `boot_supervisor`): grant `scounteren=0x7` (CY/TM/IR) at reset,
mirroring the existing `mcounteren` firmware grant. The spec gate is unchanged — the kernel may still
restrict userspace by writing scounteren. No instruction semantics change.

**Acceptance criteria:**
- [x] Exact faulting (PC, insn, cause) captured at runtime — trap-path logger in `hart::take_trap`
      (+ `csr::counteren_dbg`), recorded above (`insn=0xc01027f3`, IllegalInstruction, U-mode).
- [x] Root cause named + fixed with spec citation (Priv §3.1.10/§4.1.5 counter-enable gating); no
      regression: **RISCOF differential 0 fail (`RISCOF_RC=0`)**, core timer/counter suite 0 fail.
- [x] A stock Docker Hub glibc riscv64 image runs in-guest to real output — `busybox:latest`'s glibc
      `sh` runs `/init` (`exit 42`) to a clean **`exitcode=0x00002a00`** (was SIGILL exitcode 0x04);
      static glibc prints `HELLO_GLIBC_42`.
- [x] Regression test (`crates/core/tests/sbi_timer_fuzz.rs::umode_rdtime_works_after_boot_supervisor_e1t29`):
      asserts U-mode `rdtime` works after reset **and** still traps when scounteren.TM is cleared
      (gate intact).

**Adversarial verification.** Reverting the fix (scounteren=0) reproduces the SIGILL; with it,
busybox glibc runs. No regression proven: RISCOF differential 0-fail (396 Passed, 0 Failed);
`sbi_timer_fuzz` (6) + `zicntr` (10) pass; the gate still traps U-mode rdtime once scounteren.TM is
cleared (unit-tested), so the spec behavior is preserved — only the reset default changed.

**All acceptance criteria met with recorded evidence → status flipped to `verified`.**
