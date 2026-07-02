---
id: E2-T14
epic: 2
title: Boot debugging playbook — earlycon, initcall_debug, trace bisection of hangs
priority: 214
status: pending
depends_on: [E2-T04, E2-T12]
estimate: S
capstone: false
---

## Goal
A written, tool-backed playbook that turns "the kernel hangs somewhere" from a day of
guessing into a 15-minute bisection — plus the emulator-side tooling (trace windowing,
System.map symbolization) the playbook depends on.

## Context
The debugging ladder, in order: (1) `earlycon=sbi` on the command line — output before any
driver probes; if nothing prints, the bug is in entry state, DTB address/magic, or SBI
DBCN/legacy console; (2) `earlycon=uart8250,mmio,0x10000000` to isolate SBI-console vs
UART issues; (3) `console=ttyS0 loglevel=8 ignore_loglevel keep_bootcon` — losing output at
the earlycon→console handover points at 8250 probe or PLIC wiring; (4) `initcall_debug` —
the last `calling ...` line names the hanging subsystem. Known hang map to document with
symptoms → cause: silence (entry contract/DTB), stop after "Booting Linux on hartid 0"
(memory node/paging), hang at clocksource/sched_clock (E2-T05 STIP), hang after "Serial:
8250/16550 driver" (IIR/THRE bug in E2-T07), "Unable to mount root fs" (initrd placement
E2-T13 or virtio E2-T08..11), rcu_sched stall warnings (timer storm or lost interrupts).
Emulator tooling: ring-buffer instruction trace with `--trace-last N` dumped on hang
detection (no retirement for X ms), a PC-histogram mode ("where is it spinning"), and a
`tools/symbolize.py` that maps trace PCs through `System.map`.

## Deliverables
- `docs/boot-debugging.md`: the ladder, the symptom→cause table, worked examples with real
  transcripts, how to diff a boot log against QEMU's (`qemu ... -d guest_errors`).
- Emulator flags: `--trace-last`, `--pc-histogram`, hang watchdog (no-retirement timer).
- `tools/symbolize.py` (System.map lookup, annotates trace and histogram output).

## Acceptance criteria
- [ ] Each documented symptom has been *reproduced deliberately* (break the thing, capture
      the transcript, restore it) — the doc contains the actual output, not hypotheticals.
- [ ] PC histogram over a hung boot names the spinning function via System.map in one
      command.
- [ ] Hang watchdog fires on a `1: j 1b` bare-metal binary within the documented window
      and dumps the last-N trace.
- [ ] Playbook tested by someone/something other than its author following it verbatim on
      an injected fault, reaching the right conclusion.

## Adversarial verification
Inject three faults the doc does NOT explicitly list (e.g., DTB `timebase-frequency` off by
10x, PLIC priority threshold stuck at 7, initrd end address short by one page) and follow
the playbook mechanically. If the ladder + histogram + symbolizer fail to localize any of
them to the right subsystem, the playbook is refuted — it must generalize, not just replay
its examples. Also verify the tooling claims: `--trace-last 100000` during a full Linux
boot must not slow boot by more than the documented overhead factor, and symbolize must
handle PCs in modules-less kernel range and in userspace (graceful "unknown").

## Verification log
(empty)
