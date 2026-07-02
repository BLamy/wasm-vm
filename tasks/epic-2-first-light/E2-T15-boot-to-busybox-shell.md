---
id: E2-T15
epic: 2
title: Milestone — unmodified Linux boots to an interactive busybox shell (native CLI)
priority: 215
status: pending
depends_on: [E2-T02, E2-T06, E2-T07, E2-T13, E2-T14]
estimate: L
capstone: false
---

## Goal
The first light itself, minimal form: the pinned unmodified kernel + busybox initramfs
boots on the native CLI build to an interactive shell on ttyS0 — proving entry contract,
DTB, SBI (all extensions), CLINT/PLIC, and UART work together as a system.

## Context
This is an integration task: expect zero new device code and days of debugging existing
code with E2-T14's playbook. Boot line: kernel Image at `0x8020_0000`, initrd + DTB per
E2-T13 layout, `bootargs = "console=ttyS0 earlycon=sbi"`, entry with a0=0, a1=DTB per
E2-T03. CLI: `wasm-vm --kernel Image --initrd initramfs.cpio.gz [--append ...]`. Success
means the full dmesg parade: SBI probe lines ("SBI specification v2.0", each extension),
"Machine model: ...our DTB model string...", memory init, riscv-intc/PLIC/clint probes,
8250 console registration, initramfs unpack, "Run /init as init process", shell prompt.
Then the shell must actually *work*: interactive input via UART interrupts, `ps aux`,
`cat /proc/cpuinfo` (shows rv64imafdc), `cat /proc/interrupts` (riscv-timer and ttyS0
counts increasing), `vi /tmp/x` usable, `date` (will be 1970 — RTC comes in E2-T16; note
it). Fix bugs where they live (upstream task's crate) and append what was found to this
task's log — this task's diff should be mostly glue and fixes, not features.

## Deliverables
- Working `wasm-vm boot` CLI path + a `tools/boot-busybox.sh` one-liner using released
  artifacts.
- An expect-style scripted smoke test (`tests/boot_busybox.rs` driving the CLI pty):
  boots, runs 5 commands, asserts on outputs, under a wall-clock timeout.
- Bug notes in this file's log for every upstream fix made (traceability).

## Acceptance criteria
- [ ] Cold `tools/boot-busybox.sh` reaches a shell prompt; scripted smoke test passes.
- [ ] dmesg shows SBI v2.0 detected with TIME/IPI/RFENCE/HSM/DBCN probe lines, zero
      WARN/BUG/Oops/"unhandled" lines, zero rcu stall warnings.
- [ ] `/proc/interrupts`: riscv-timer increments ~CONFIG_HZ at idle; ttyS0 increments with
      keystrokes; no interrupt count exploding (>10^4/s at idle).
- [ ] `vi` opens, edits, saves a file in /tmp; ^C kills a `yes` loop without killing sh.
- [ ] Boot is deterministic: 5 consecutive runs, same dmesg modulo timestamps (scripted
      diff with timestamp normalization).

## Adversarial verification
Boot the identical artifact triple (Image, initrd, our DTB) under
`qemu-system-riscv64 -M virt -dtb ours.dtb` and diff normalized dmesg — unexplained lines
present in QEMU but missing on wasm-vm (or vice versa) must each be accounted for in
writing; an unexplained diff refutes. Run the whole boot with `--trace-last` active and
with the PC histogram on: any >20% histogram bucket in a busy-wait outside WFI at idle
refutes the "no storm" claim. Type during boot (before the shell) — early input must not
oops or deadlock the 8250 probe. Hold a key down (autorepeat) in `vi` for 30 s. Set
`--append "init=/bin/false"` and confirm the kernel panics *identically* to QEMU (panic
parity is evidence the machine, not luck, is booting).

## Verification log
(empty)
