---
id: E2-T17
epic: 2
title: syscon poweroff/reboot device — clean shutdown propagated to the host/JS
priority: 217
status: pending
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
(empty)
