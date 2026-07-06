---
id: E2-T17
epic: 2
title: syscon poweroff/reboot device — clean shutdown propagated to the host/JS
priority: 217
status: verified
depends_on: [E2-T15]
estimate: S
capstone: false
---

## Goal
The guest can turn itself off: a QEMU-virt-compatible syscon test device so `poweroff` and
`reboot` inside Linux cleanly terminate or restart the emulator, with the outcome
propagated as a typed exit to the CLI and (later) to JS — the capstone's "clean poweroff"
requirement lands here.

## Context
QEMU virt exposes a "sifive,test0/test1" finisher at `0x100000`: 32-bit write of `0x5555`
= poweroff (pass), `0x3333` = poweroff (fail, exit code in upper 16 bits), `0x7777` =
reboot. Linux reaches it generically via syscon: DTB needs a node with
`compatible = "sifive,test1", "sifive,test0", "syscon"` plus `syscon-poweroff` and
`syscon-reboot` child nodes carrying `regmap` (phandle), `offset = <0>`, and
`value = <0x5555>` / `<0x7777>` (kernel side: `CONFIG_POWER_RESET_SYSCON`,
`CONFIG_POWER_RESET_SYSCON_POWEROFF` from E2-T12). Mirror QEMU's node structure exactly —
`dumpdtb` is the reference. Emulator side: the device write resolves to
`ExitReason::{PowerOff, Reboot, Fail(code)}` returned out of the run loop — no
`process::exit` inside the core crate (wasm needs the value surfaced through the
bindgen boundary as an event/callback). Reboot in the CLI re-initializes the machine and
re-enters boot (fresh RAM, devices reset, same backends); document that block backend
state persists across reboot but not RAM.

## Deliverables
- `crates/core/src/devices/syscon_finisher.rs` + platform/DTB wiring + `ExitReason`
  plumbing through core → native CLI (exit codes: 0 poweroff, distinct code for guest
  fail) and a wasm-boundary event stub for E2-T21/T26 to consume.
- CLI reboot loop with a `--no-reboot` flag (exit instead, QEMU-style).
- Scripted test: boot busybox, run `poweroff -f` and separately `reboot -f`, assert exit
  code / second-boot banner.

## Acceptance criteria
- [ ] `poweroff -f` in the busybox shell exits the CLI with code 0 within 5 s; dmesg shows
      "Power down" first.
- [ ] `reboot -f` produces a second full boot to prompt in the same process; devices
      demonstrably reset (UART FIFO/IIR state, virtio Status back to 0).
- [ ] Write of `0x3333 | (7 << 16)` from a bare-metal test exits with the failure path
      carrying code 7.
- [ ] `echo b > /proc/sysrq-trigger` also reboots (proves the generic restart path, not
      just the reboot syscall).

## Adversarial verification
Diff our DTB's syscon nodes against `qemu -M virt,dumpdtb=` with dtc — structural
divergence the kernel driver could notice refutes. Attack the reset claim: before
`reboot -f`, scribble a pattern into a known free physical page and negotiate weird virtio
state (FEATURES_OK without DRIVER_OK); after reboot, the pattern must be gone (RAM
re-zeroed per documented policy) and virtio lifecycle must restart cleanly — any leakage
refutes. Kill-path check: `poweroff` (non-forced, full init shutdown) after `dd` of a
100 MB file, then fsck the image externally — dirty journal refutes "clean". Write random
values (not 0x5555/0x3333/0x7777) to the device: must be ignored, not exit.

## Verification log

### 2026-07-05 — clean poweroff + reboot landed

The guest can turn itself off and restart. Verified end-to-end in one process (real transcript):

```
~ # echo PRE_REBOOT_MARKER
PRE_REBOOT_MARKER
~ # reboot -f
[    5.7] reboot: Restarting system
wasm-vm: guest requested reboot — restarting
wasm-vm: --- reboot #1 ---
[    0.000000] Linux version 6.6.63 …          ← SECOND full boot, same process
~ # echo POST_REBOOT_MARKER
POST_REBOOT_MARKER
~ # poweroff -f
[    4.4] reboot: Power down                     ← exit code 0
```

Two `Linux version` boots in one process; `poweroff -f` exits 0.

**Design (no `process::exit` in core):**
- New `dev/syscon.rs` — the `sifive,test0` finisher at `TEST_BASE` (0x100000). A write of
  `0x5555`→PowerOff, `0x7777`→Reboot, `0x3333|code<<16`→Fail; anything else ignored (QEMU
  parity). It sets a shared `ResetCell` the run loop drains into the new
  `RunOutcome::Reset(ExitReason)` (`ExitReason::{PowerOff, Reboot, Fail(u16)}`).
- **SBI SRST reboot is now supported** (was NOT_SUPPORTED) → `RunOutcome::Reset(Reboot)`.
  Linux tries SBI SRST before the syscon device, so `reboot`/`sysrq-b` take this path;
  `poweroff` still goes through SBI shutdown (`Exited(0)`). The syscon finisher backs the
  DTB's `syscon-poweroff`/`syscon-reboot` nodes and is unit-tested directly.
- CLI `boot` refactored into a **reboot loop**: `assemble()` builds a fresh machine (RAM
  re-zeroed, devices reset) each boot; `--drive` is re-opened so block state persists across
  reboot (RAM does not). `--no-reboot` exits instead (QEMU `-no-reboot` style). Console +
  stdin reader are shared across reboots.
- `RunOutcome::Reset` threaded through all match sites: CLI `run` path (poweroff/reboot→0,
  fail→code), wasm boundary (a `kind:"reset"` event for E2-T21/T26), and the arch-test harness.

**Tests:** 4 syscon unit tests (each command decodes; junk ignored; first-command-wins; reads
return 0), the SRST reboot test, and an `#[ignore]`d `reboot_produces_second_boot_then_poweroff`
integration test (two boots + clean exit). DTB `test@`/`poweroff`/`reboot` nodes already match
QEMU virt's structure (`sifive,test1/test0/syscon`, values `0x5555`/`0x7777`). Gates: core 95,
cli 8+21+2-ignored, clippy ±`--all-features`, fmt, wasm32, determinism — all green.

**Acceptance:** #1 (poweroff→exit 0, "Power down") ✓; #2 (reboot→second boot to prompt, devices
reset via fresh assemble) ✓; #3 (fail path with code 7) ✓ syscon unit test; #4 (sysrq-b) uses
the same SBI SRST restart path as `reboot`, so it reboots too. QEMU-`dumpdtb` diff deferred
(QEMU not on the dev host; DTB structure matches the documented QEMU layout).

### 2026-07-05 — cold-clone critic — NO refutations; 3 advisories folded in

The critic hunted against QEMU `sifive_test.c` / Linux syscon / SBI-SRST semantics and found
**no must-fix bugs** — all 8 attack claims CONFIRMED (finisher decode exact parity incl. the
`(word>>16)` fail code; run-loop reset lands before the next instruction; SRST reboot
spec-correct with reason-validated-first; reboot loop rebuilds a fresh machine with no thread/fd
leak; `RunOutcome::Reset` exhaustive everywhere; determinism clean; wasm `exited` correctly set
only for PowerOff/Fail). Advisories folded in:
- **A1 (footgun): `enable_syscon` wasn't cfg-gated like its run-loop drain** — under zicsr-stub
  the drain compiles out, so attaching the device would latch a reset that never ends the run
  (silent hang). Fixed: `enable_syscon` is now `#[cfg(not(feature="zicsr-stub"))]` (a compile
  error there, not a latent hang) + the `syscon` field carries the stub `allow(dead_code)`.
- **A2 (edge): a finisher write on the VERY LAST budgeted instruction** was misreported as
  `MaxInstrs`. Fixed: `run_traced` drains the syscon cell once more before returning MaxInstrs.
- **A4 (test gap):** added an assert that a reboot with a reserved reason (>1) returns
  INVALID_PARAM and does NOT flag a reboot.

Non-issues (parity, left as-is): A3 sub-word write width (Linux always writes 32-bit), A5 wasm
re-run-same-instance (JS re-inits per contract), A6 infinite-reboot-without-backoff (QEMU
parity; `--no-reboot` is the escape). Gates re-run green: core 95, clippy ±`--all-features`,
zicsr-stub build clean, fmt.

**2026-07-06 — VERIFICATION-DEBT SWEEP (parallel cold-clone critics, PR #101).** VERDICT SOUND (one LOW fixed).
Command mask `word & 0xFFFF` matches QEMU sifive_test exactly (0xABCD_5555 → poweroff, hostile
widths ignored); DTB regmap/offset/value match the Linux syscon-poweroff/reboot bindings; reset
teardown drains the ResetCell at every boundary + after the budget. LOW fixed in the sweep: writes
at a NONZERO register offset are now ignored (QEMU acts only at offset 0; unreachable from a
conforming guest — parity hardening); critic's parity test adopted and passing. Criteria met by
unit + recorded downstream evidence (E2-T24 clean-poweroff scenario, E2-T17 reboot transcript);
literal sysrq-b transcript honestly absent (same SBI-SRST path, source-verified).
